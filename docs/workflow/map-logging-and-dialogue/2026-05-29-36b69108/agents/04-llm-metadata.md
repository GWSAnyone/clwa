# Agent 04 — LLM call metadata

## Result shape (`packages/engine/src/llm-types.ts`)
There is **no** `LlmResult/LlmCallResult/LlmStreamResult`. Actual types:
- **`LlmCallResponse`** (:87, non-stream): `content`, `finishReason` (`stop|length|schema_violation|error`),
  `usage?` `{promptTokens, completionTokens, cacheReadTokens?, cacheCreationTokens?, costUsd?}`, `providerId`, `modelId`.
- **`LlmStreamChunk`** (:117): `type` (`token|done|error`), `content?`, `error?`, `usage?` (only on final `done`).
- **`LlmUsageEvent`** (:160): `timestamp, task, agentId?, providerId, modelId, finishReason, promptTokens,
  completionTokens, cacheReadTokens, cacheCreationTokens, costUsd, latencyMs, hadSchema` — emitted after **every** call.
- `LlmRoute` (:201): `provider, model, maxTokens?, sampling?, fallback?, warm?, schemaInPrompt?`.

## Usage & latency
- **hasUsage**: true. Fields: promptTokens, completionTokens, cacheRead/CreationTokens, costUsd, providerId,
  modelId, finishReason.
- **hasLatency**: true — `const startMs = Date.now()` right after semaphore acquire (queue-wait excluded);
  `latencyMs = Date.now() - startMs`.
- Cost: exact for claude-code (`result.total_cost_usd`); 0 for lm-studio (local).

## Chokepoints
- **Telemetry funnel (non-stream)**: `emitUsage()` helper `llm-client.ts:31-56` → `_emitUsage()` `llm-registry.ts:87`.
- **Stream**: `generateStream()` inline `_emitUsage` `llm-client.ts:254-268`.
- **Provider-call**: classify → `llm-registry.ts:188/204`; generate → `llm-client.ts:168`.
- **Single console chokepoint for ALL paths**: `LlmUsageTracker.record()` `llm-usage-tracker.ts:77` — classify,
  generate, stream, embed all route here. One `console.log` here = per-call line for free.
- Task name + resolved provider/model in scope at every emit (`route.*` requested vs `resp.*` answerer). `warm`
  and `schemaInPrompt` available on `route` but **not currently** in the event.

## Suggested
Everything except `warm`/`schemaInPrompt` is already in `LlmUsageEvent` & persisted to `data/llm-usage.jsonl`.
Add a human-readable `console.log` in `record()`:
`[LLM] <task> <provider>/<model> ms=<latency> in=<prompt> out=<completion> cost=$<cost> finish=<reason>`.
Optionally add `warm`/`schemaInPrompt` to `LlmUsageEvent` + thread through the emit helpers.

## Gotchas
- Façade never throws → error ⇒ event `finishReason='error'`, zeroed tokens.
- Fallback route ⇒ **multiple** events per logical call (primary error + answerer).
- Cost-gate-blocked ⇒ near-0 latency `error` event (not a real call).
- lm-studio stream has no usage ⇒ `completionTokens ≈ len/4`, cost 0.
- `embed` inlines `_emitUsage` twice (skips the helper) — but still hits `record()`.
- `_emitUsage` is fire-and-forget (not awaited); recorder errors swallowed.
