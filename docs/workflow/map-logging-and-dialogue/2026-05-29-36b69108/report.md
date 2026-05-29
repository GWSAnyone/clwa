# Report — Logging, dialogue flows & LLM metadata map

Groundwork for the roleplay-quality milestone: to tune prompts/context and compare models we must first **see**
the real prompts, NPC replies, and per-call token/cost/latency. This run mapped exactly where to add that
visibility with minimal churn.

## 1. Logging — timestamps (request #1)

- **There is already a central logger**: `packages/server/src/logger.ts`. `initFileLogger()` monkey-patches
  `console.log/warn/error` and already writes `[HH:MM:SS]` to the **file** (`writeToFile` → `formatTime()`),
  but the **stdout** copy (`origLog(...)`) has no timestamp.
- **Lowest-churn fix**: prepend `[HH:MM:SS]` inside the console patch so the live console (and `preview_logs`)
  also carries the timestamp. One edit covers all ~190 log sites — no per-call changes.
- ~190 raw `console.*` sites enumerated across `server/src` + `engine/src` (see agent 01) — no need to touch
  them individually.

## 2. Player↔NPC reply text (request #2a) — NOT currently logged

- Flow is entirely in the **WS handler** in `packages/server/src/server.ts` (the `msg.type === 'chat'` branch),
  **not** `routes.ts` and **not** `conversation.ts`.
- The reply `fullReply` is produced at `server.ts:308` (`await agent.chatStream(...)`), streamed to the client
  (`chat:token` / `chat:done`) and stored in memory — but **never printed to the server console**.
- **Add one log right after `server.ts:312`** where `fullReply`, `agent` (speaker), `playerAgent` (listener),
  `meaning.speechAct`, and `npcTrust` are all in scope. Include speaker→listener, location, day/minute, speechAct,
  trust, and the flattened reply.

## 3. NPC↔NPC reply text (request #2b) — logged, but weak

- Two engine paths: casual `runConversation` (`conversation.ts`) and goal-driven `runInteraction`
  (`interaction.ts`). Both funnel lines to the server sink `index.ts:592`, which logs **speaker only** (no
  listener) and only the cleaned/`'...'`-degraded text.
- **Why "nothing shows"**: casual NPC↔NPC pairs rarely fire (scheduler `findPair` returns null without a
  co-located eligible pair / cooldown), and Qwen sometimes returns empty → the turn is skipped with `[Conv:SKIP]`
  before reaching the sink.
- **Add a rich engine-level log** at `conversation.ts:156` (both ids + both reply texts + topic + location all in
  scope) and a mirror at `interaction.ts:104` for goal-driven (purpose + both lines). Keep it genre-neutral
  (INV-14 — uses only `Agent` fields).

## 4. LLM per-call metadata (request #2c "useful info") — captured, not shown

- **No `LlmResult` type.** Real types in `llm-types.ts`: `LlmCallResponse` (`content`, `finishReason`, `usage?`,
  `providerId`, `modelId`), `LlmStreamChunk`, and `LlmUsageEvent` — the per-call telemetry record **already
  emitted after every call** and persisted to `data/llm-usage.jsonl` by `LlmUsageTracker.record()`.
- `LlmUsageEvent` already carries: `timestamp, task, agentId, providerId, modelId, finishReason, promptTokens,
  completionTokens, cacheReadTokens, cacheCreationTokens, costUsd, latencyMs, hadSchema`. **Latency is already
  measured** (`Date.now()` around the provider round-trip). Cost is exact for claude-code, 0 for lm-studio.
- **Single chokepoint to surface it**: add a human-readable `console.log` inside `LlmUsageTracker.record()`
  (`llm-usage-tracker.ts:77`) — every emit path (classify / generate / stream / embed) routes through here, so
  one line gives a per-call console summary: `task provider/model ms=… in=… out=… cost=$… finish=…`.
- Optional: add `warm` / `schemaInPrompt` to `LlmUsageEvent` (the only two route flags not yet recorded).

### Gotchas (from agent 04)
- Façade never throws — errors collapse to an event with `finishReason='error'` and zeroed tokens.
- A fallback route emits **multiple** usage events for one logical call (primary error + the answerer).
- Cost-gate-blocked calls emit a near-0-latency `error` event — distinguish if noise.
- lm-studio **streaming** has no usage → `completionTokens` approximated as `len/4`, cost 0.
- `embed` path inlines `_emitUsage` twice (does not use the `emitUsage` helper) — but still routes through
  `record()`, so the single console line there covers it.

## Implementation plan (4 edits)
1. `logger.ts` — timestamp the stdout copy in the console patch. *(global, request #1)*
2. `server.ts` after :312 — `[Chat]` player→NPC reply + meta. *(request #2a)*
3. `conversation.ts:156` + `interaction.ts:104` — `[NPC↔NPC]` rich line. *(request #2b)*
4. `llm-usage-tracker.ts:77` `record()` — per-call `[LLM]` metadata line. *(request #2c)*
