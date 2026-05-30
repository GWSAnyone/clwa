# Agent 4 — LLM routing: task→model assignment (llm-defaults.ts buildDefaultRouter + worlds/millhaven/world.json config.llm override)

## Map: LLM routing (task→model) — buildDefaultRouter vs world.json config.llm

**TL;DR:** Routing is a per-task table (`LlmRouterConfig`). The code default lives in `llm-defaults.ts:buildDefaultRouter`, but a world's `world.json config.llm` **fully replaces** it (not a merge) — so for Millhaven the LIVE routing is `world.json:466-559`, and `llm-defaults.ts` (plus all `CLWA_*` env switches) is dead code for that world. The two tables have drifted: live `dialogue`=claude/**haiku**, live `npc-dialogue`=claude/**haiku** — whereas the code default has dialogue=sonnet and npc-dialogue=Qwen.

**Architecture:**
- `llm-defaults.ts:buildDefaultRouter()` — code default router; consulted ONLY if `world.json` has no `config.llm` (`server/src/llm-defaults.ts:44`).
- `world.json config.llm` — per-world override, a complete `LlmRouterConfig` (`worlds/millhaven/world.json:466-559`).
- `index.ts:368-369` — `registerLlmRouter(llmConfig ?? buildDefaultRouter())` → `??` = full replace.
- `llm-registry.ts:67-72 registerLlmRouter` — `LLM_ROUTER = config` (wholesale assign, no merge).
- `llm-registry.ts:139-144 _resolveRoute` — `routes[task] ?? default`; missing task → `default` (Qwen).
- `agent.ts:72 / agent-types.ts:91 npc.llm` — per-NPC `Partial<LlmPersonality>` (sampling only; NOT routing).

**Data flow:**
world.json `config.llm` → world-loader → `worldData.config.llm` → `index.ts:368` → `registerLlmRouter` (`LLM_ROUTER`) → `validateLlmRouterContract` (`index.ts:370`) → at call time engine `_resolveRoute(task)` → `routes[task] ?? default` → provider call (+`fallback` chain on error).

**Current LIVE routes (Millhaven world.json — what actually runs):**
| task | provider/model | flags |
|---|---|---|
| volition | lm-studio / qwen | maxTokens 100, temp 0.35 |
| il | lm-studio / qwen | maxTokens 400, temp 0.15 |
| embeddings | lm-studio / nomic-embed | — |
| **dialogue** | **claude-code / haiku** | warm; **no fallback** |
| **npc-dialogue** | **claude-code / haiku** | warm, schemaInPrompt, Qwen fallback |
| **reflection** | **claude-code / sonnet** | warm, Qwen fallback |
| **verdict** | **claude-code / sonnet** | warm, schemaInPrompt, Qwen fallback |

**Code default (`buildDefaultRouter`, NOT live for Millhaven):** dialogue=claude/**sonnet**; npc-dialogue=**lm-studio/qwen**; reflection=claude/sonnet; verdict=claude/sonnet. (Differs from live in dialogue model + npc-dialogue provider.)

**Referenced answers:**
- Q: Is dialogue already on Claude? / A: Yes — both tables. Live Millhaven = claude-code/**haiku** (warm); code default = claude-code/sonnet.
- Q: haiku or sonnet for dialogue? / A: **haiku.** Baseline says haiku ≈ sonnet on dialogue and is cheaper. Live Millhaven already uses haiku — correct. The code default (sonnet) is the outlier to align if you want fresh worlds to match.
- Q: What must change given the baseline? / A: (1) dialogue→Claude: already done (haiku) — keep. (2) reflection→Claude: already done (sonnet) — keep. (3) **npc-dialogue→Qwen**: live Millhaven wrongly pays Claude/haiku → flip `world.json:505-522` to lm-studio/qwen to hit $0 and remove freeze risk (code default already does this). (4) **verdict→Qwen** if you accept baseline ($0 competitive) → flip `world.json:540-557`; or keep on Claude but drop sonnet→haiku for cost — judgment call.
- Q: Per-world override mechanism for data-not-hardcode? / A: Edit `worlds/millhaven/world.json config.llm.routes` (lines 466-559). It fully overrides `llm-defaults.ts`; editing the .ts alone won't change Millhaven. `npc.llm` is sampling-only and can't reassign models; `CLWA_*` env switches don't reach a world that has `config.llm`.

**Gotchas:**
- Full-replace, not merge: `world.json config.llm` shadows the entire code table + env switches (`index.ts:368`, `registry.ts:71`). The drift between the two tables is invisible at runtime.
- Live `dialogue` has no Qwen fallback (`world.json:496-504`) — unlike the other Claude routes.
- `npc-dialogue` is the hot, high-volume path; live route on Claude risks the documented cold-spawn world-freeze (`llm-defaults.ts:54`). Qwen is both cheaper and safer here.
- `validateLlmRouterContract()` gates boot (`index.ts:370`) — keep all 7 task keys when editing JSON.

**Not explored:** provider implementations (claude-code session/warm mechanics, lm-studio adapter), the cost-gate/usage-tracker callbacks, and how `il`/`volition` prompts are built — out of scope for the routing-table question.
