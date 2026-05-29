/**
 * NPC-brain comparison harness — model layer.
 * One uniform `runCall(model, req)` over the three CLWA routes: Qwen (LM Studio, local),
 * Haiku + Sonnet (claude-code subscription CLI). No paid Anthropic API.
 *
 * Captures the metrics the spec's Phase 0 needs: content, finishReason, latencyMs, tokens, costUsd,
 * and schema-validity (for structured tasks). Used by run-baseline.ts and cache-check.ts.
 */
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { LMStudioProvider } from '../../packages/providers/lm-studio/src/index';
import { ClaudeCodeProvider } from '../../packages/providers/claude-code/src/index';
import type { LlmCallRequest, LlmCallResponse, LlmProvider } from '../../packages/engine/src/llm-types';

const QWEN = 'qwen3.5-9b-abliterated';
const NPCS_ROOT = path.join(import.meta.dir, '../../packages/server/data/claude-npcs');
// claude-code uses <npcsRoot>/<agentId> as the spawn cwd (+ auto-loads CLAUDE.local.md there). The harness
// has no real NPC folders, so we use a clean dedicated cwd — persona comes entirely from the fixture's system
// prompt (no hidden ambient context = fairer baseline). The dir MUST exist or Bun.spawn → ENOENT.
const HARNESS_AGENT = 'harness';
mkdirSync(path.join(NPCS_ROOT, HARNESS_AGENT), { recursive: true });

const lmstudio: LlmProvider = new LMStudioProvider({ baseUrl: process.env.LMSTUDIO_URL ?? 'http://localhost:1234', maxConcurrency: 2 });
const CLAUDE_BIN = process.env.CLAUDE_BIN ?? Bun.which('claude') ?? 'claude';
const claude: LlmProvider = new ClaudeCodeProvider({ npcsRoot: NPCS_ROOT, sessionIdleMs: 1_800_000, maxConcurrency: 4, claudeBinary: CLAUDE_BIN });

export type ModelKey = 'qwen' | 'haiku' | 'sonnet';

export const MODELS: Record<ModelKey, { provider: LlmProvider; model: string; label: string }> = {
  qwen:   { provider: lmstudio, model: QWEN,     label: 'lm-studio/qwen' },
  haiku:  { provider: claude,   model: 'haiku',  label: 'claude-code/haiku' },
  sonnet: { provider: claude,   model: 'sonnet', label: 'claude-code/sonnet' },
};

export interface RunResult {
  ok: boolean;
  content: string;
  finishReason: string;
  latencyMs: number;
  promptTokens: number;
  completionTokens: number;
  cacheReadTokens: number;
  costUsd: number;
  /** null when the fixture has no jsonSchema; otherwise whether content parsed as JSON. */
  schemaValid: boolean | null;
  error?: string;
}

/** Pull the first balanced JSON object out of free text (mirrors the engine's tolerant parse). */
function extractJson(s: string): string {
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  return a >= 0 && b > a ? s.slice(a, b + 1) : s;
}

export async function runCall(modelKey: ModelKey, req: Omit<LlmCallRequest, 'model'>): Promise<RunResult> {
  const m = MODELS[modelKey];
  const start = Date.now();
  // claude-code needs an existing cwd (per-agent dir); default to the harness dir when the fixture has none.
  const agentContext = req.agentContext ?? (modelKey === 'qwen' ? undefined : { id: HARNESS_AGENT });
  try {
    const res: LlmCallResponse = await m.provider.call({ ...req, model: m.model, agentContext });
    const latencyMs = Date.now() - start;
    let schemaValid: boolean | null = null;
    if (req.jsonSchema) {
      schemaValid = false;
      try { JSON.parse(extractJson(res.content)); schemaValid = true; } catch { /* invalid */ }
    }
    return {
      ok: res.finishReason !== 'error',
      content: res.content,
      finishReason: res.finishReason,
      latencyMs,
      promptTokens: res.usage?.promptTokens ?? 0,
      completionTokens: res.usage?.completionTokens ?? 0,
      cacheReadTokens: res.usage?.cacheReadTokens ?? 0,
      costUsd: res.usage?.costUsd ?? 0,
      schemaValid,
    };
  } catch (e) {
    return {
      ok: false, content: '', finishReason: 'error', latencyMs: Date.now() - start,
      promptTokens: 0, completionTokens: 0, cacheReadTokens: 0, costUsd: 0,
      schemaValid: req.jsonSchema ? false : null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function dispose(): Promise<void> {
  await lmstudio.dispose?.();
  await claude.dispose?.();
}
