# Agent 01 — logging-sites

- **hasCentralLogger**: true
- **loggerLocation**: `packages/server/src/logger.ts`

`initFileLogger()` patches `console.log/warn/error`. It already prepends `[HH:MM:SS]` (`formatTime()`) when
writing to the **log file** (`writeToFile`), but the **stdout** copy (`origLog/origWarn/origError`) is untouched →
live console & `preview_logs` show no timestamp.

## Log-site census (~190 raw `console.*`, full list in raw.json)
By file:
- `packages/server/src/index.ts` — ~70 sites (boot banner, `[Time]`, `[Move]`, `[Decision]`, `[MURDER]`, `[Goal]`,
  `[Reflection]`, `[Clock]`, `[Save]`, …). Line 592 = the NPC↔NPC `onLine` sink. Line 660 = `onLlmCall`.
- `packages/server/src/server.ts` — `[WS]`, `[IL]`, `[Evidence]`, `[Shop]`, `[Journal]`. (Player chat reply NOT logged.)
- `packages/server/src/world-loader.ts`, `trait-randomizer.ts`, `position-manager.ts`, `llm-usage-tracker.ts`.
- `packages/engine/src/*` — `il.ts` (~22 `[IL]` sites), `world.ts` (~30: `[MasterClock]`, `[Queue]`, `[Mood]`,
  `[Discovery]`, `[SceneResidue]`, …), `volition.ts` (`[AL:*]`), `conversation.ts` (`[Conv:SKIP]`/`[Conv:ECHO]`),
  `agent.ts` (`[LLM:FAIL]`), `beliefs.ts`, `memory.ts`, `llm-client.ts` (`[LLM:classify|generate|generateStream|embed]`),
  `llm-registry.ts`, `cg-engine.ts`, `evidence.ts`, `goals.ts`, `processing-queue.ts`, `event-registry.ts`.

## Recommendation
Three options; recommended hybrid:
- **Option 3 (fast, chosen)**: extend the existing console patch in `initFileLogger()` to also prepend
  `[HH:MM:SS]` to the **stdout** call (not just the file). One edit, global coverage, zero per-site churn.
- Option 1+2 (later, optional): export `log/warn/error` helpers from `logger.ts` and migrate sites gradually for
  fine-grained control (e.g. ability to strip timestamps). Not needed now.
