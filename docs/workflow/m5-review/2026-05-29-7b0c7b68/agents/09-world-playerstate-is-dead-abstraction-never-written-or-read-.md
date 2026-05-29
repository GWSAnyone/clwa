# world.playerState is dead abstraction — never written or read in production

- **Dimension**: consistency-perf
- **Severity**: major · **Category**: abstraction
- **Location**: `packages/engine/src/world.ts:149,1907,1959`
- **Adversarial verdict**: confirmed

## Issue
A10 intended the engine to carry an opaque world.playerState that it persists for module-owned state (the PlayerJournal). But the server persists the journal in its OWN save envelope (index.ts: savedData.journal = ctx.journal.toJSON(); restored via PlayerJournal.fromJSON) and never touches world.playerState. The field is serialized as empty {} on every save (world.ts:1907) and restored to {} (1959). The field, its WorldSaveData slot, and its save/load round-trip are all dead code. The documented design diverges from the implementation.

## Suggested fix
Either route the journal through world.playerState (server writes world.playerState.journal = journal.toJSON() before save, reads it back on load) to honor the A10 opaque-state contract, OR delete the playerState field + its save/load wiring since the server already owns persistence. Do not keep a documented-but-unused abstraction.

## Adversarial verification — world.playerState is a dead abstraction — never written or read in production
Both factual claims hold against current source on feature/engine-generalization.

(1) world.playerState is dead. A full-repo grep (excluding node_modules) for `playerState` returns ONLY: packages/engine/src/world.ts:114 (WorldSaveData type slot `playerState?: Record<string, unknown>`), :149 (field `playerState: Record<string, unknown> = {}`), :1907 (`playerState: this.playerState` in toJSON), :1959 (`this.playerState = data.playerState ?? {}` in loadState), plus two SPEC doc references. There is no write to world.playerState anywhere — not in engine, not in modules, not in server. No setter/getter method either. The field is initialized to {} (world.ts:149), serialized as-is (still {}) on every save, and restored to {} on load — a vacuous round-trip.

(2) The server persists the journal in its OWN envelope, bypassing playerState. packages/server/src/index.ts defines SaveData with a dedicated `journal?: ReturnType<PlayerJournal['toJSON']>` slot (:255), writes it via `journal: ctx.journal.toJSON()` (:267), and restores via `if (savedData.journal) { ctx.journal = PlayerJournal.fromJSON(savedData.journal); }` (:747). At runtime the journal is fed back into the engine through the onPlayerObserve callback (world.ts:74 declaration, :1455 fire site -> index.ts:648 handler) and the generic registerDialogueEffectHandler hook (il.ts:89; consumed by crime-justice/investigation.ts:412). Neither path ever references world.playerState.

(3) The divergence is self-documented. investigation.ts:5-7 states the engine "exposes only a generic registerDialogueEffectHandler hook + an opaque player-state slot; this module fills them" — but then immediately admits "The journal instance is owned by the SERVER (it persists it...)". So the documented A10 opaque-state contract has zero production users; the slot is filled by nobody. world.ts:147-148 likewise documents the field as round-tripped for module-owned state, which is never exercised.

This is NOT the accepted/known residual (the accepted list covers untyped event.payload keys and the WS crime:scene contract — not this). It is a genuine dead/leaky abstraction: a documented contract diverging from implementation. The suggested fix is valid (either route the journal through world.playerState to honor A10, or delete the field + WorldSaveData slot + save/load wiring since the server already owns persistence).

Calibration note: severity 'major' is slightly high. The empty round-trip is harmless (no save/load hazard, no behavior change vs the crime game, no per-tick cost — toJSON/loadState run once per save/load). It is correctly categorized as an abstraction wart of low blast radius; 'minor' would be a fairer severity. But the finding's factual substance is fully correct, so the verdict is confirmed.
