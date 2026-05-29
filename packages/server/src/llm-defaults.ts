/**
 * ╔═══════════════════════════════════════════════════════════════════════════════════════════╗
 * ║  LLM ROUTING CONTROL PANEL                                                                    ║
 * ╚═══════════════════════════════════════════════════════════════════════════════════════════╝
 * One place to assign a provider+model to every LLM task. Engine knows none of these strings — they
 * live here (server domain). Per-world override: `world.json` → `config.llm` (full LlmRouterConfig).
 *
 * SPEED / COST TIERS (measured — tools/bench-haiku-vs-qwen.ts, bench-warm-session.ts):
 *   • lm-studio / qwen    — LIGHTNING. ~1.6s, $0, local. Use for HOT, high-volume tasks (every tick).
 *   • claude-code / haiku — quality, ~$13/1k. ~7s COLD-spawn, ~3-5s on a WARM persistent session.
 *                           Cold-spawn per call (classify/generate) is ~19s → NEVER on a hot loop.
 *                           Only viable where a warm session is reused (streaming `dialogue`).
 *   • claude-code / sonnet— best judgment, ~$70/1k, ~8s cold. RARE high-value calls (verdict).
 *
 * PERSISTENT SESSION (the speed lever — avoids per-call cold-spawn; see GitHub claude-agent-sdk #34):
 *   env CLWA_CLAUDE_SESSION_IDLE_MS  (default 600000 = 10 min; 0 = ephemeral/cold every call).
 *   Today ONLY the streaming `dialogue` route reuses a warm session. Routing a classify/generate task
 *   (volition / il / npc-dialogue) to claude-code = cold-spawn each call until a warm structured-call
 *   path lands — so those stay on Qwen below.
 *
 * EASY GLOBAL SWITCHES (flip a whole route without editing the table — env-overridable):
 */
import type { LlmRouterConfig, LlmRoute } from '@clwa/engine';

const QWEN = 'qwen3.5-9b-abliterated';
const EMBED_MODEL = 'text-embedding-nomic-embed-text-v1.5@q8_0';

// Provider/model per "interactive" route, overridable by env so you can flip lm-studio↔claude-code
// (and the model) at launch without touching code. Default = the tuned hybrid.
const env = (k: string, d: string) => process.env[k] ?? d;
// warm: reuse a per-NPC warm claude session (skips cold-spawn). schemaInPrompt: inject schema as free text
// (fast, ~3-5s) for structured calls instead of native --json-schema (~11s). Both are no-ops for lm-studio.
const PLAYER_DIALOGUE: LlmRoute = { provider: env('CLWA_DIALOGUE_PROVIDER', 'claude-code'), model: env('CLWA_DIALOGUE_MODEL', 'sonnet'), maxTokens: 250, sampling: { temperature: 0.7 }, warm: true };
const VERDICT: LlmRoute = { provider: env('CLWA_VERDICT_PROVIDER', 'claude-code'), model: env('CLWA_VERDICT_MODEL', 'sonnet'), maxTokens: 800, sampling: { temperature: 0.4 }, warm: true, schemaInPrompt: true,
  fallback: { provider: 'lm-studio', model: QWEN, maxTokens: 300, sampling: { temperature: 0.4 } } };
const REFLECTION: LlmRoute = { provider: env('CLWA_REFLECTION_PROVIDER', 'claude-code'), model: env('CLWA_REFLECTION_MODEL', 'sonnet'), maxTokens: 150, sampling: { temperature: 0.7 }, warm: true,
  fallback: { provider: 'lm-studio', model: QWEN, maxTokens: 150, sampling: { temperature: 0.7 } } };
// NPC↔NPC dialogue: warm + schemaInPrompt make Haiku viable (~3-5s vs ~19s cold). Defaults to Qwen here;
// flip to claude-code/haiku per-world in config.llm / the World Editor (warm/schema toggles are right there).
const NPC_DIALOGUE: LlmRoute = { provider: env('CLWA_NPC_DIALOGUE_PROVIDER', 'lm-studio'), model: env('CLWA_NPC_DIALOGUE_MODEL', QWEN), maxTokens: 200, sampling: { temperature: 0.7 }, warm: true, schemaInPrompt: true,
  fallback: { provider: 'lm-studio', model: QWEN, maxTokens: 200, sampling: { temperature: 0.7 } } };

/** Pure-default router (used if world.json config.llm is absent). The table below is the control panel. */
export function buildDefaultRouter(): LlmRouterConfig {
  return {
    default: { provider: 'lm-studio', model: QWEN, sampling: { temperature: 0.7 } },
    routes: {
      // ── HOT / high-volume → local Qwen (lightning, $0) ──
      volition:   { provider: 'lm-studio', model: QWEN, maxTokens: 100, sampling: { temperature: 0.35 } },
      il:         { provider: 'lm-studio', model: QWEN, maxTokens: 400, sampling: { temperature: 0.15 } },
      embeddings: { provider: 'lm-studio', model: EMBED_MODEL },
      // ── Interactive / rare → Claude (quality), flippable via the env switches above ──
      dialogue:        PLAYER_DIALOGUE,  // player↔NPC chat — streams through a WARM persistent session
      'npc-dialogue':  NPC_DIALOGUE,     // NPC↔NPC — Qwen for now (cold-spawn would freeze the world)
      reflection:      REFLECTION,
      verdict:         VERDICT,
    },
  };
}
