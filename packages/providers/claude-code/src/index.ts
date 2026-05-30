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
import { ClaudeSession, ClaudeSessionPool } from './session';

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
  /**
   * Persistent session idle TTL in ms. >0: keep a warm per-NPC `claude` process between the
   * player's turns, evict after this much inactivity (default 600000 = 10 min). 0: ephemeral —
   * spawn a fresh process per turn (still streams, but pays cold-spawn every message).
   * Env: CLWA_CLAUDE_SESSION_IDLE_MS. WHETHER a task uses a warm session is per-route (config.llm `warm`),
   * not a global flag — this is only the idle-TTL tuning knob (default 30 min). A warm route reuses a
   * per-(agent,model,schema) `claude` process so only the first call pays cold-spawn (~7s); the rest run
   * ~3-5s instead of ~19s. Silent past the TTL → the session closes and respawns on the next call.
   */
  sessionIdleMs?: number;
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

/** Compact transcript to seed a freshly-(re)spawned session with prior conversation turns. */
function formatHistorySeed(history: Array<{ role: 'user' | 'assistant'; content: string }>): string {
  const lines = history.map((h) => `${h.role === 'user' ? 'Player' : 'You'}: ${h.content}`);
  return `[Earlier in this conversation:\n${lines.join('\n')}]`;
}

/** Prompt-mode schema instruction — appended to the user turn when warmSchemaInPrompt is on. */
function schemaPromptSuffix(schema: { schema: Record<string, unknown> }): string {
  return `Respond with ONLY a single JSON object — no prose, no explanation, no markdown code fences — `
    + `that strictly conforms to this JSON Schema:\n${JSON.stringify(schema.schema)}`;
}

/** Extract the first balanced top-level JSON object from free text (handles ```fences``` + surrounding
 *  prose). Returns the JSON substring, or null if none parses. Brace-scan respects string literals/escapes. */
function extractJsonObject(text: string): string | null {
  if (!text) return null;
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        const candidate = text.slice(start, i + 1);
        try { JSON.parse(candidate); return candidate; } catch { return null; }
      }
    }
  }
  return null;
}

export class ClaudeCodeProvider implements LlmProvider {
  readonly id = 'claude-code';
  readonly capabilities: LlmCapabilities;
  private readonly claudeBinary: string;
  private readonly fallbackAgentDir: string;
  private readonly sessionIdleMs: number;
  private readonly pool = new ClaudeSessionPool();          // streaming dialogue sessions
  private readonly structuredPool = new ClaudeSessionPool(); // warm structured-call sessions (opt-in)

  constructor(private readonly opts: ClaudeCodeProviderOptions) {
    this.claudeBinary = opts.claudeBinary ?? 'claude';
    this.fallbackAgentDir = opts.fallbackAgentDir ?? '_default';
    this.sessionIdleMs = opts.sessionIdleMs ?? 1_800_000; // 30 min idle TTL for warm sessions
    this.capabilities = {
      structuredOutput: 'json_schema', // через --json-schema (под капотом StructuredOutput tool с retry)
      streaming: true, // stream-json + --include-partial-messages; persistent sessions per NPC. Toggle via config.llm route.
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
    // Warm path is per-ROUTE (req.warm, set from config.llm) — not a global flag. Reuse a per-(agent,model,
    // schema) warm session so repeat calls skip cold-spawn. On any miss/error fall through to cold below.
    if (req.warm && req.agentContext?.id) {
      const warm = await this.callWarmStructured(req).catch(() => null);
      if (warm) return warm;
    }

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
      // Pin low reasoning effort: NPC decisions/verdicts are fast in-character calls, not
      // deep agentic reasoning. Default is already ~low, but pinning guards against a future
      // CLI default flipping to high (which measured ~25% slower with no quality gain here).
      '--effort',
      'low',
      // `local` only: loads the NPC's own CLAUDE.local.md persona, but NOT the parent CLAUDE.md chain
      // (project dev-instructions) that `project` would walk up and inject (~3k wasted tokens/call).
      '--setting-sources',
      'local',
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

  /** Warm structured-call path (opt-in via warmSessionMs>0). Reuses a per-(agent,model,schema) warm
   *  `claude` session; returns null on any miss/error so call() falls back to the cold-spawn path. */
  private async callWarmStructured(req: LlmCallRequest): Promise<LlmCallResponse | null> {
    const agentId = req.agentContext!.id;
    const npcDir = path.join(this.opts.npcsRoot, agentId);
    // Prompt-mode (schema injected as free text): the session is NOT schema-pinned, so ONE warm session
    // per (agent, model) serves every task. Native mode pins the schema → key includes its name.
    const promptMode = !!req.schemaInPrompt && !!req.jsonSchema;
    const key = `${agentId}::${req.model}::${promptMode ? '_prompt' : (req.jsonSchema?.name ?? '_text')}`;
    let session = this.structuredPool.get(key);
    // Identity is (model, systemPrompt) — a changed persona/model discards & respawns.
    if (session && (session.model !== req.model || session.systemPrompt !== req.system)) {
      await session.kill();
      this.structuredPool.remove(key);
      session = undefined;
    }
    if (!session) {
      if (this.opts.onBeforeCall) {
        try { await this.opts.onBeforeCall(agentId); }
        catch (err) { console.warn(`[claude-code] onBeforeCall (warm) failed for '${agentId}':`, err); }
      }
      try {
        session = new ClaudeSession(
          {
            binary: this.claudeBinary,
            args: this.buildStructuredStreamArgs(req, promptMode),
            cwd: npcDir,
            env: stripApiKeyEnv({ ...process.env, CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' }),
          },
          req.model,
          req.system,
          this.sessionIdleMs,
          () => this.structuredPool.remove(key),
        );
      } catch (err) {
        console.error(`[claude-code] warm spawn failed for '${agentId}':`, err);
        return null;
      }
      this.structuredPool.set(key, session);
    }
    // In prompt-mode the schema rides in the user turn (free-text session); native mode already pinned it.
    const userText = promptMode ? `${req.user}\n\n${schemaPromptSuffix(req.jsonSchema!)}` : req.user;
    const res = await session.request(userText);
    if (res.finishReason === 'error') {
      await session.kill();
      this.structuredPool.remove(key);
      return null; // fall back to cold spawn
    }
    // Prompt-mode returns free text — extract the JSON object (engine's classify then parses + retries).
    const content = promptMode ? extractJsonObject(res.content) : res.content;
    if (promptMode && content === null) {
      return null; // no parseable JSON → fall back to cold (native --json-schema) for this call
    }
    return { content: content ?? res.content, finishReason: res.finishReason, usage: res.usage, providerId: this.id, modelId: req.model };
  }

  /** Spawn args for a warm structured-call session: stream-json I/O. Native mode pins --json-schema;
   *  prompt mode skips it (free-text, schema injected per-turn). No --include-partial-messages (final result only). */
  private buildStructuredStreamArgs(req: LlmCallRequest, promptMode: boolean): string[] {
    const args = [
      '-p',
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--verbose',
      '--strict-mcp-config',
      '--mcp-config', '{"mcpServers":{}}',
      '--tools', '',
      '--effort', 'low',
      '--setting-sources', 'local',
      '--model', req.model,
    ];
    if (req.system) args.push('--system-prompt', req.system);
    if (req.jsonSchema && !promptMode) args.push('--json-schema', JSON.stringify(req.jsonSchema.schema));
    return args;
  }

  /**
   * Streaming player↔NPC dialogue. Reuses a warm per-NPC session (persistent mode) so only
   * the first turn pays cold-spawn; subsequent turns stream immediately. The session's
   * (model, systemPrompt) is fixed at creation — a change discards and respawns it.
   */
  async *stream(req: LlmStreamRequest): AsyncIterable<LlmStreamChunk> {
    const agentId = req.agentContext?.id ?? this.fallbackAgentDir;
    const npcDir = path.join(this.opts.npcsRoot, agentId);
    // Persist only when the route opts in (req.warm) and we have a real agent. Idle TTL = sessionIdleMs.
    const persistent = !!req.warm && this.sessionIdleMs > 0 && !!req.agentContext?.id;

    let session = persistent ? this.pool.get(agentId) : undefined;
    // A conversation's persona/model is fixed at start — respawn if either changed.
    if (session && (session.model !== req.model || session.systemPrompt !== req.system)) {
      await session.kill();
      this.pool.remove(agentId);
      session = undefined;
    }
    const reusedWarm = !!session; // a warm session already holds the conversation in-process

    if (!session) {
      // Fresh session — snapshot memory once, right before spawn (Claude reads CLAUDE.md + @-imports at startup).
      if (this.opts.onBeforeCall && req.agentContext?.id) {
        try {
          await this.opts.onBeforeCall(req.agentContext.id);
        } catch (err) {
          console.warn(`[claude-code] onBeforeCall failed for agent='${agentId}':`, err);
        }
      }
      try {
        session = new ClaudeSession(
          {
            binary: this.claudeBinary,
            args: this.buildStreamArgs(req),
            cwd: npcDir,
            env: stripApiKeyEnv({ ...process.env, CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' }),
          },
          req.model,
          req.system,
          persistent ? this.sessionIdleMs : 0,
          () => this.pool.remove(agentId),
        );
      } catch (err) {
        console.error(`[claude-code] stream spawn failed for agent='${agentId}':`, err);
        yield { type: 'error', error: err instanceof Error ? err : new Error(String(err)) };
        return;
      }
      if (persistent) this.pool.set(agentId, session);
    }

    // A warm session already remembers the conversation (claude keeps it in-process), so we send
    // only the new turn. A freshly (re)spawned session does not — seed it with prior turns so the
    // NPC keeps continuity after an idle-eviction respawn. The first-ever turn has empty history.
    const userText =
      !reusedWarm && req.history && req.history.length > 0
        ? `${formatHistorySeed(req.history)}\n\n${req.user}`
        : req.user;
    try {
      yield* session.send(userText);
    } finally {
      // Ephemeral sessions are one-shot — tear down after the turn.
      if (!persistent) await session.kill();
    }
  }

  /** Spawn args for a streaming session. Mirrors call()'s Stage 10 optimization (--system-prompt + --tools ""). */
  private buildStreamArgs(req: LlmStreamRequest): string[] {
    const args = [
      '-p',
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      '--include-partial-messages',
      '--verbose',
      '--strict-mcp-config',
      '--mcp-config',
      '{"mcpServers":{}}',
      '--tools',
      '',
      '--effort',
      'low', // fast conversational replies — no extended thinking (see call())
      // `local` only: loads the NPC's own CLAUDE.local.md persona, but NOT the parent CLAUDE.md chain
      // (project dev-instructions) that `project` would walk up and inject (~3k wasted tokens/call).
      '--setting-sources',
      'local',
      '--permission-mode',
      'acceptEdits',
      '--model',
      req.model,
    ];
    if (req.system) {
      args.push('--system-prompt', req.system);
    }
    return args;
  }

  async embed(_req: LlmEmbedRequest): Promise<LlmEmbedResponse> {
    throw new Error('ClaudeCodeProvider does not support embeddings. Route embeddings to lm-studio.');
  }

  /** Kill all warm sessions on shutdown. Called by disposeAllLlmProviders(). */
  async dispose(): Promise<void> {
    await Promise.all([this.pool.disposeAll(), this.structuredPool.disposeAll()]);
  }

  /** Kill + drop this agent's warm sessions across both pools so a fresh conversation does not resume stale
   *  in-session memory (called on NPC switch via the engine's resetAgentSessions façade). No-op if none warm. */
  async resetAgentSession(agentId: string): Promise<void> {
    await Promise.all([this.pool.killAgent(agentId), this.structuredPool.killAgent(agentId)]);
  }
}
