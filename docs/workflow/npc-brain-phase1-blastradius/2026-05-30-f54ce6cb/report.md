# Report — Phase 1 blast radius + port plan (layered/localized dialogue prompt → engine)

5 parallel readers mapped the exact plumbing. Per-agent verbatim reports in `raw.json`. Synthesis + the concrete,
low-risk port plan below.

## Decisive findings

1. **Agent does NOT hold WorldConfig.** It only gets `profile/state/memory + AgentOptions` (resolvers/hooks). World
   values reach it via `AgentOptions` (e.g. `locationResolver`, `nameResolver`). → thread `language` the same way.
2. **Both prompt paths funnel through `Agent.buildSystemPrompt`**: player-chat (`chatStream`) AND NPC↔NPC
   (`generateResponse`). So giving the **Agent** a `language` field localizes BOTH — no need to touch `World`/
   `conversation.ts`/the inline World config for language. (`reflect()` builds its own prompt — out of scope.)
3. **`buildSystemPrompt` is private**, sig `(memories, additionalContext?)`, returns one monolithic SYSTEM string.
   3 internal callers: `chat` (no external callers, dead-ish), `chatStream` (player; only path with multi-turn
   `history`), `generateResponse` (NPC↔NPC; never sends history). Public signatures can stay unchanged → zero
   external blast radius.
4. **For the L1/L2/L3 split**: SYSTEM = L1 scaffold(Rules) + L2 persona (name/role/background/personality/motivation/
   speech-style DESCRIPTION/secret/innerConflict) — **byte-stable per NPC**. USER = L3 volatile (current-state/mood,
   stress-growth, roleDirective beliefs+relationships+currentMotive, recalled memories, rotated voice example,
   additionalContext) + the message. CRITICAL for claude-code: warm-session identity = `(model, system)` — so the
   system MUST be byte-stable between turns (no live data, even invisible). Moving L3 to user also fixes the
   documented "lost middle". In `chatStream`, push the RAW userMessage to `_chatHistory` (not the L3-wrapped one).
5. **speechReminder** (`prompt-utils.ts:7`) parses `speechStyle` for `Example:` lines and returns description + ONE
   random example. Used only NPC↔NPC. Player-chat dumps the WHOLE `speechStyle` verbatim (`agent.ts:340`) → the
   verbatim-copy bug. Fix: keep the DESCRIPTION in L2 (stable), put a ROTATED single example in L3/user (rotates per
   turn → no verbatim copy + keeps system byte-stable). Add optional `fewShotExamples?: string[]` to AgentProfile
   (default `[]`), merge into the example pool. Avoid an agent↔prompt-utils import cycle (inline the sampler in
   `buildSystemPrompt`/`buildUserContext`, or update speechReminder to read the field).
6. **Routing**: Millhaven's LIVE routes are in `world.json config.llm` (FULL REPLACE of `llm-defaults.ts` + env). 
   Live: dialogue=claude/haiku(warm, **no fallback**), npc-dialogue=claude/haiku, reflection=claude/sonnet,
   verdict=claude/sonnet, volition/il=Qwen. Per baseline: **npc-dialogue → Qwen** ($0, removes cold-spawn freeze
   risk, baseline-competitive); dialogue stays haiku (baseline-optimal) + add a Qwen fallback; verdict stays sonnet
   (rare/high-value — judgment call). Change is DATA (edit world.json), not code.
7. **Tests / tripwires**: NO test asserts exact Rules text → localization is assertion-safe. The only indirect guard
   is `architecture.test.ts:134` scanning engine string literals for 8 English crime words (Latin regex; Russian is
   invisible to it) — keep new English prompt text free of those words. `fewShotExamples?` is optional → the 7 inline
   `AgentProfile` literals don't break. Don't rename LLM task keys (fake-llm fixture + `validateLlmRouterContract`).
   Don't touch the consolidation prompt (`llm-consolidation.test.ts` pins it). Green-keeping run: architecture,
   world-data, save-load, genre-neutrality, llm-consolidation, investigation.

## Port plan (engine first, then wiring, then content) — verify `tsc 0` + `bun test` after each, no LM Studio

- **E1 (agent.ts + world-types.ts)**: `AgentOptions.language` + Agent field/ctor (default 'en'); split
  `buildSystemPrompt()` (L1+L2, byte-stable) + `buildUserContext(memories, additionalContext)` (L3); localized
  scaffold table (en/ru) — knowledge-boundary, language-lock, positive self-name, anti-AI, no-narration, concision,
  softened (no ALL-CAPS); rotated voice example in L3; update 3 callers (keep public sigs); `WorldConfig.language` +
  `DEFAULT_WORLD_CONFIG.language='en'`; `AgentProfile.fewShotExamples?`.
- **E2 (server)**: `world-loader` widen `WorldJson.config` (language) + `NpcJson` (fewShotExamples) + profile default
  `[]`; `index.ts` pass `language: worldData.config.language ?? 'en'` to NPC (`:406`) + player (`:537`) Agents.
- **E3 (prompt-utils)**: merge `fewShotExamples` into `speechReminder` pool (one source of truth for NPC↔NPC too).
- **C1 (millhaven content)**: `world.json config.language='ru'`; routing: npc-dialogue→Qwen + dialogue Qwen fallback;
  Russian `fewShotExamples` per NPC (user sanctioned translation; the validated v2 prototype used target-language
  few-shot). The critical language-lock is the LAST line of the L3 user turn ("Ответь на русском …").
- **V (verify)**: full `bun test` (272) green + `tsc 0` + `clwa-auditor` on the diff (INV-14 genre-neutral scaffold,
  INV-16 bilateral, byte-stable-system). Live model eval deferred to the user's final playthrough (no LM Studio now).

## Key risks (from the maps)
- System must be byte-stable per NPC or claude-code warm-cache thrashes (`session id=(model,system)`); keep ALL
  volatile (incl. mood-derived stress/growth) out of system.
- `chatStream` must push RAW userMessage to `_chatHistory`; L3 wrapper only on the passed user.
- Two user-assembly sites (stateful chatStream vs stateless generateResponse) — two edit points.
- Don't reintroduce English crime words into engine prompt literals (`architecture.test.ts:134`).
- `world.json config.llm` fully replaces defaults — edit the JSON, not `llm-defaults.ts`, for Millhaven.
