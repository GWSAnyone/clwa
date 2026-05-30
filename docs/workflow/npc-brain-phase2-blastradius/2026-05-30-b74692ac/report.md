# Report — Phase 2 blast radius + plan (context-assembly fixes)

3 parallel readers mapped belief ranking, memory recall scoring, and dialogue history. Per-agent verbatim in
`raw.json` + `agents/`. Synthesis + the concrete Phase 2 plan below.

## Decisive findings

### Beliefs (agent 01)
- **THREE divergent rankings**: `summarizeForPrompt` → `getAllBeliefs` (confidence DESC **only**, no recency);
  `serializeMemoryState` (`agent.ts`) → inline `confidence × recencyFactor` (1/(1+days*0.1)), top-30; crime role
  builder → `getAllBeliefs` filtered, top-1. Same beliefs, three orderings.
- `getAllBeliefs()` is the single source, called **~20×** across crime-justice — `getTopBeliefs` must **add** a
  ranked accessor, not replace `getAllBeliefs`.
- Beliefs have **no `importance` field** (only confidence/lastUpdated/gameDay) → `decay.ts compositeScore` doesn't
  fit beliefs directly; recency for beliefs is its own `1/(1+days*k)` curve.
- **Silent null-drop**: `summarizeForPrompt`/`summarizeForMemory` call `getEventLabel` and `return null` on miss →
  `filter(Boolean)` drops the belief silently. `getEventLabelSafe` (warn + 'an incident' fallback) already exists.
- **Per-event phrasing is already supported** (`registerBeliefPhrasing`, first-non-null-wins by `ctx.eventType`);
  crime registers ONE blanket fn ("committed {verb} against {target}") — replace with per-event functions.
- **Dedup**: "## What you know" and the crime role section ("## ACTIVE DUTY"/"## How you feel") narrate the SAME
  top belief in different words.
- Two different certainty ladders (prompt vs memory) for the same beliefs.

### Memory recall (agent 02)
- **Two composite formulas diverge**: `decay.ts compositeScore` = `rel*0.4 + (decayedImp/10)*0.4 + fresh*0.2`
  (EXPORTED, imported in memory.ts… but **NEVER CALLED — dead**); `memory.ts recall` inline = `rel*0.4 +
  decayedImp*0.4 + fresh*0.2` (**raw, ACTIVE**). Result: a fresh importance-10 memory scores `10*0.4=4.0`,
  swamping relevance (max 0.4) and freshness (max 0.2) → **relevance barely matters**.
- Recency = **creation day** (gameDay), no last-access field anywhere.
- Cap = 5 (default `recall` sig + 3 literals in agent.ts + `slice(0,topK)` memory.ts:182). Over-fetch ×3 then rerank.
- Eviction (memory.ts:278) uses raw decayedImportance — consistent with the active path; **don't touch it**.
- Degenerate (too-short) queries are unguarded — embed of empty/short string returns importance-topped junk.

### History (agent 03)
- `Agent._chatHistory` (engine buffer, trim-12, chatStream only) and the **warm per-NPC Claude session** (provider,
  keyed by agentId) are **disconnected**.
- **`clearChatHistory()` exists but has ZERO callers** (dead). Server's `chatAgentId` is **per-message-local** → it
  can't detect an NPC switch; must be promoted to per-connection state.
- **No per-agent session reset** in the provider — only `dispose()` (kills ALL). Need `resetAgentSession(agentId)`
  (kill+remove from `pool`, sweep `structuredPool` compound keys `agentId::`), optional on `LlmProvider`, + façade.
- `history-summary` task = mechanical: `registerLlmTask('history-summary', {})` + a **Qwen** route (different
  semaphore than claude `dialogue` → won't block the in-flight stream, INV-01).
- NPC↔NPC: `buildFollowUpPrompt` already RECEIVES the full `lines[]` but uses only the last; thread `lines.slice(-3)`.
- The `Player said.../I replied...` transcript is stored verbatim every turn (agent.ts:99 chat + :143 chatStream) — dedup target.

## Phase 2 plan (verify tsc 0 + bun test after each step; no LM Studio)

1. **Memory normalization (smallest, highest-leverage)**: replace the inline composite at `memory.ts:179` with a call
   to `decay.ts compositeScore()` (÷10 normalization lives ONLY there) — kills the divergence + importance-domination;
   remove the dead import; add a degenerate-query guard at `recall` entry. Keep eviction + cap as-is (5 is fine; the
   bug was normalization, not count). last-access recency = DEFERRED (needs a new MemoryEntry field + save/Qdrant migration).
2. **Belief ranking + phrasing**: add `BeliefManager.getTopBeliefs(k, {topic?})` (composite confidence × recency,
   optional topic/eventType filter), have `summarizeForPrompt` + `serializeMemoryState` both rank through it (one
   ordering); add a recency cue to the belief line; swap the silent `getEventLabel` null-drop for `getEventLabelSafe`;
   crime module → per-event `registerBeliefPhrasing` functions (theft→"stole from Y", attack→"attacked Y") instead of
   the blanket "committed {verb} against {target}"; dedup the top belief between "## What you know" and the role section.
3. **History hygiene**: promote server `chatAgentId` to per-connection state and call `clearChatHistory()` + a new
   `resetAgentSession(agentId)` on NPC switch; add `resetAgentSession` to `ClaudeCodeProvider` (kill+remove pool +
   sweep structuredPool prefix) + optional `LlmProvider.resetAgentSession?` + engine façade; register + Qwen-route a
   `history-summary` task and summarize dropped turns when trimming >12; thread `lines.slice(-3)` into
   `buildFollowUpPrompt` for NPC↔NPC; dedup the double transcript store.

## Risks
- `getTopBeliefs` ADDS a ranked accessor — do NOT break the ~20 `getAllBeliefs` call sites.
- The memory composite fix changes recall ordering → may shift which memories surface; bun test has no recall-order
  snapshot, so verify behavior is sane (and the user's live eval is the final check).
- `resetAgentSession` touches the provider contract (`LlmProvider`) — keep it optional so other providers (lm-studio)
  needn't implement it.
- `history-summary` MUST route to Qwen (separate semaphore) or it blocks the streaming dialogue (INV-01).
- Per-event belief phrasing in the crime module is module-owned (INV-14 stays clean); the engine fallback stays neutral.
