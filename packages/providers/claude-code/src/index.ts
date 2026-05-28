/**
 * ClaudeCodeProvider — uses the `claude` CLI in headless `-p` mode.
 *
 * Authentication: subscription OAuth (no ANTHROPIC_API_KEY — explicitly stripped from env).
 * Billing: до 15 июня 2026 — subscription pool. После — отдельный SDK credit pool.
 *
 * Per-NPC isolation: each agent has its own folder under <npcsRoot>/<agentId>/ with:
 *   - CLAUDE.md         (NPC system prompt, auto-loaded from cwd)
 *   - .mcp.json         ({"mcpServers":{}} — empty, blocked via --strict-mcp-config)
 *   - .claude/settings.json  ({"autoMemoryEnabled": false})
 *   - memory/*.md       (CLWA-curated memory, referenced via @ imports in CLAUDE.md)
 *
 * Structured output via Claude Code's native --json-schema flag (uses internal
 * StructuredOutput MCP tool with input_schema + retry).
 */

import path from 'node:path';
import type {
  LlmProvider,
  LlmCallRequest,
  LlmCallResponse,
  LlmCapabilities,
  LlmEmbedRequest,
  LlmEmbedResponse,
  LlmStreamChunk,
  LlmStreamRequest,
} from '@clwa/engine';

export interface ClaudeCodeProviderOptions {
  /** Корень с папками NPC. CLWA создаёт <npcsRoot>/<agentId>/ через NpcMemoryManager. */
  npcsRoot: string;
  /** Опциональный override пути к бинарю claude. По умолчанию — 'claude' (ищем в PATH). */
  claudeBinary?: string;
  /** Сколько параллельных `claude -p` процессов держим. По умолчанию 8 (по числу NPC). */
  maxConcurrency?: number;
  /** Папка-fallback для вызовов без agentContext. По умолчанию '_default'. */
  fallbackAgentDir?: string;
  /**
   * Called RIGHT BEFORE Bun.spawn — server wires это к NpcMemoryManager.snapshotState,
   * чтобы current-state.md/relationships.md/beliefs.md были свежими к моменту когда Claude
   * читает CLAUDE.md и @-импорты на spawn.
   *
   * Exceptions из onBeforeCall логируются и НЕ блокируют call() — Claude видит файлы такими
   * какие есть (stale, но рабочие).
   */
  onBeforeCall?: (agentId: string) => Promise<void>;
}

interface ClaudeCodeOutput {
  type: 'system' | 'assistant' | 'user' | 'result' | 'rate_limit_event';
  terminal_reason?: 'completed' | 'max_tokens';
  result?: string;
  structured_output?: unknown;
  is_error?: boolean;
  total_cost_usd?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
}

const STRIPPED_ENV_KEYS = new Set([
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_API_KEY_HELPER',
  'ANTHROPIC_BASE_URL',
]);

function stripApiKeyEnv(env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (STRIPPED_ENV_KEYS.has(k) || v == null) continue;
    out[k] = v;
  }
  return out;
}

export class ClaudeCodeProvider implements LlmProvider {
  readonly id = 'claude-code';
  readonly capabilities: LlmCapabilities;
  private readonly claudeBinary: string;
  private readonly fallbackAgentDir: string;

  constructor(private readonly opts: ClaudeCodeProviderOptions) {
    this.claudeBinary = opts.claudeBinary ?? 'claude';
    this.fallbackAgentDir = opts.fallbackAgentDir ?? '_default';
    this.capabilities = {
      structuredOutput: 'json_schema', // через --json-schema (под капотом StructuredOutput tool с retry)
      streaming: false, // -p --output-format json = single result. Streaming не поддерживается.
      embeddings: false, // Claude не даёт embeddings — роутить на lm-studio
      multiTurnHistory: false, // каждый -p вызов изолирован. История — через CLAUDE.md @-импорты memory/
      sampler: {
        temperature: false,
        topP: false,
        topK: false,
        repeatPenalty: false,
        frequencyPenalty: false,
        presencePenalty: false,
      },
      maxConcurrency: opts.maxConcurrency ?? 8,
      maxOutputTokens: 8192,
    };
  }

  async call(req: LlmCallRequest): Promise<LlmCallResponse> {
    const agentId = req.agentContext?.id ?? this.fallbackAgentDir;
    const npcDir = path.join(this.opts.npcsRoot, agentId);

    // Stage 5: refresh per-NPC snapshot files before spawn — Claude читает их через @-impors при startup
    if (this.opts.onBeforeCall && req.agentContext?.id) {
      try {
        await this.opts.onBeforeCall(req.agentContext.id);
      } catch (err) {
        console.warn(`[claude-code] onBeforeCall failed for agent='${agentId}':`, err);
        // Не блокируем call — Claude увидит stale snapshots, что приемлемая degradation
      }
    }

    const args: string[] = [
      '-p',
      '--strict-mcp-config',
      '--mcp-config',
      '{"mcpServers":{}}',
      // Disable ALL built-in tools (Read/Edit/Bash/...) — an NPC needs none.
      // Drops their schemas from context (~9k tokens/call). --json-schema structured
      // output is unaffected. Variadic flag: keep it before non-variadic flags.
      '--tools',
      '',
      '--setting-sources',
      'project,local',
      '--output-format',
      'json',
      '--model',
      req.model,
    ];
    if (req.system) {
      // --system-prompt REPLACES Claude Code's coding-agent system prompt (vs --append).
      // CLAUDE.md + @-imports still auto-load from cwd, so persona/memory survive.
      // With --tools '' this cuts ~24k tokens of agent boilerplate per verdict (28k → ~5k).
      args.push('--system-prompt', req.system);
    }
    if (req.jsonSchema) {
      args.push('--json-schema', JSON.stringify(req.jsonSchema.schema));
    }
    // User prompt передаётся через stdin (не позиционно): variadic --tools/--mcp-config
    // иначе «съедают» позиционный аргумент. claude -p без позиционного промпта читает stdin.

    let proc;
    try {
      proc = Bun.spawn([this.claudeBinary, ...args], {
        cwd: npcDir,
        env: stripApiKeyEnv({
          ...process.env,
          CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
        }),
        stdin: new TextEncoder().encode(req.user),
        stdout: 'pipe',
        stderr: 'pipe',
      });
    } catch (err) {
      console.error(`[claude-code] spawn failed for agent='${agentId}':`, err);
      return { content: '', finishReason: 'error', providerId: this.id, modelId: req.model };
    }

    const stdoutText = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0 || !stdoutText) {
      const stderrText = proc.stderr ? await new Response(proc.stderr).text() : '';
      console.error(
        `[claude-code] exit ${exitCode} for agent='${agentId}' stderr:`,
        stderrText.slice(0, 500),
      );
      return { content: '', finishReason: 'error', providerId: this.id, modelId: req.model };
    }

    let parsed: ClaudeCodeOutput[];
    try {
      parsed = JSON.parse(stdoutText) as ClaudeCodeOutput[];
    } catch (err) {
      console.error(
        `[claude-code] failed to parse stdout for agent='${agentId}':`,
        err,
        stdoutText.slice(0, 200),
      );
      return { content: '', finishReason: 'error', providerId: this.id, modelId: req.model };
    }

    const result = parsed.find((e) => e.type === 'result');
    if (!result || result.is_error) {
      return { content: '', finishReason: 'error', providerId: this.id, modelId: req.model };
    }

    // structured_output если был --json-schema; иначе result.result (текст)
    const content = req.jsonSchema
      ? JSON.stringify(result.structured_output ?? {})
      : result.result ?? '';

    return {
      content,
      finishReason: result.terminal_reason === 'completed' ? 'stop' : 'length',
      usage: result.usage
        ? {
            // input_tokens — это «новые» токены без cache; промпт-кэш отдельно
            promptTokens:
              (result.usage.input_tokens ?? 0) + (result.usage.cache_read_input_tokens ?? 0),
            completionTokens: result.usage.output_tokens ?? 0,
            cacheReadTokens: result.usage.cache_read_input_tokens ?? 0,
            cacheCreationTokens: result.usage.cache_creation_input_tokens ?? 0,
            // Claude Code CLI выдаёт total_cost_usd прямо в result event — exact cost
            costUsd: result.total_cost_usd ?? 0,
          }
        : undefined,
      providerId: this.id,
      modelId: req.model,
    };
  }

  async *stream(_req: LlmStreamRequest): AsyncIterable<LlmStreamChunk> {
    yield {
      type: 'error',
      error: new Error(
        'ClaudeCodeProvider does not support streaming. Route dialogue/npc-dialogue to lm-studio.',
      ),
    };
  }

  async embed(_req: LlmEmbedRequest): Promise<LlmEmbedResponse> {
    throw new Error('ClaudeCodeProvider does not support embeddings. Route embeddings to lm-studio.');
  }
}
