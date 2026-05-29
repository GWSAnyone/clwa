# M5 Diamond-Bar Review — feature/engine-generalization

**Scope:** Phase A (genre-neutralization, INV-14) + Phase B (universal primitives: attributes/inventory/relationships-factions), branched off `master`.
**Build state verified:** branch is `feature/engine-generalization`; diff stat shows the expected A+B surface; per brief tsc 0, 249 tests green.

## Overall Verdict: SHIP WITH FIXES

M5 is disciplined, high-quality work. Phase A is behavior-preserving by construction — registry delegation plus verbatim prose moved into `crime-justice/`. Phase B is purely additive optional state. **No confirmed finding is a live bug or a behavior change against the crime regression oracle.** All 14 confirmed items are latent hazards, double-standard omissions, dead/leaky abstractions, naming warts, or test gaps. There are **0 critical**.

Two themes deserve attention before this engine carries a real attribute/inventory module:

1. **Thin test surface on net-new conserved state.** The B1/B2/B3 primitives have **zero save/load round-trip coverage**, and the load-bearing A4b dialogue-effect extraction seam is only registry-tested. The crime game's behavior-preservation claim for evidence/accusation prose rests on no automated check.
2. **Three real consistency/abstraction defects** accreted in the engine: a shared-helper side effect leaking through a debug route, an SL-07 load-validation double standard, and a fully dead `world.playerState` abstraction.

I independently re-verified the six highest-impact findings against current source (decay-in-shared-helper, advanceMoodMath path, SL-07 asymmetry, dead playerState, trivial A4b test, CRIME_PROSE scope, sole for...in, save-load test gap) — all hold verbatim.

---

## Single Most Important Fix

**Move the attribute-decay step out of the shared `_computeMoodTick` into the real-tick `_tickMoodSystem` only** — `world.ts:556-559`.

`decayAttribute()` now runs inside `_computeMoodTick`, which is also invoked in a `ticks`-long loop by `advanceMoodMath` (`world.ts:803`) — the debug calibration what-if at `routes.ts:1000`, documented *"Mood math only... Use for calibration, not behavior testing."* It iterates the **live** `this.agents` (no clone), so hitting that endpoint silently ages and expires every agent's attribute modifiers, permanently consuming non-self-correcting conserved state (HP regen, wound debuffs, buffs, needs). Latent for the crime game (no attributes), a real corruption vector for any attribute module. The loneliness step already lives in `_tickMoodSystem` (world.ts:577-586) — same precedent, one-line lift.

---

## Confirmed Findings, Ranked

### MAJOR

| # | Finding | Location | Fix |
|---|---------|----------|-----|
| 1 | advanceMoodMath silently decays B1 modifiers (behavior-change via debug route) | `world.ts:556-559` ← `world.ts:803` ← `routes.ts:1000` | Hoist decay block into `_tickMoodSystem`; add a test that `advanceMoodMath` leaves attribute modifiers untouched. |
| 2 | Phase B load has no SL-07 finite/clamp validation — double standard vs mood | `world.ts:1978-1980` vs `world.ts:1973-1977` | Drop non-finite attribute modifiers, re-clamp `attr.base` via `createAttribute`, validate inventory qty as finite positive int; add a finite guard to `addAttributeModifier` (world.ts:692) matching mood's `addModifier` (world.ts:616). |
| 3 | No save/load round-trip test for new AgentState fields — identical-output oracle is **vacuous** | `tests/save-load.test.ts:136`; fixture `createTestWorld` 60-124 | Populate fixture with attributes(+modifier)/factions/inventory/standing so line-136 test stops passing vacuously; add a dedicated round-trip asserting `getAttribute`, surviving modifier remaining/duration, `getFactions`, `countItem`, `item.state`, `standing`. |
| 4 | A4b dialogue hook not tested end-to-end through `applyDialogueMeaning` | `tests/investigation.test.ts:98`; call site `il.ts:549-550`; real handler `crime-justice/investigation.ts:411-419` | Probe-handler round-trip test through `applyDialogueMeaning`, plus one test driving the real `registerInvestigationModule` handler with `presentedEvidence`/`playerJournal` to lock the verbatim evidence/accusation prose. |
| 5 | Genre-neutrality guard can false-pass (prose regex scans only string literals; symbol blocklist enumerated; no concept-level assertion) | `tests/architecture.test.ts:121` + 132-143 + 148-161 | Scan identifiers too (tighter word set) OR assert engine source is free of `PlayerJournal`/`getCaseSummary`/`buildAccusationContext`/`processEvidencePresentation`; add a self-test that `CRIME_PROSE` fires on a known-bad fixture. |
| 6 | `world.playerState` is a dead abstraction — never written/read in production | `world.ts:114,149,1907,1959` | Either route the journal through `world.playerState` to honor A10, or delete field + WorldSaveData slot + save/load wiring (server already owns persistence: `index.ts:255/267/747`). *Honest severity ≈ minor — empty `{}` round-trip is harmless; ranked here for visibility.* |

### MINOR

| # | Finding | Location | Fix |
|---|---------|----------|-----|
| 7 | Residual crime nouns after SceneResidue rename | `event-registry.ts:567` (`DiscoveryContext.victimId`); `world.ts:55` (`onAgentDeath` params); `world.ts:1529` (`perpetratorName` key) | Rename `victimId`->`affectedId` (and `killerId`->`actorId`; also `processAgentDeath` params world.ts:1657, call site 1541). Leave payload keys as the accepted untyped residual. |
| 8 | New tests pollute global registries with no teardown (order-dependent false-pass) | `tests/genre-neutrality.test.ts:136`; `tests/attributes.test.ts:140`; `SCORING_CONTRIBUTORS` al.ts:438 | Expose `clearScoringContributors()` etc., call in `afterAll`; at minimum pop the pushed `AFFORDANCE_REGISTRY` entry. Mirror `cg-integration.test.ts`/`regression.test.ts` teardown. |
| 9 | `for...in` in per-tick decay loop (sole one in engine) | `world.ts:558` | `for (const attr of Object.values(agent.state.attributes)) decayAttribute(attr, 5)`. *(Dedupes the "prototype pollution" framing of the same line — discount the security angle; no Object.prototype mutator exists in this Bun runtime.)* |
| 10 | transfer conservation tested only on success+insufficient | `tests/attributes.test.ts:90`; guards `world.ts:698-699`, `767-773` | Add: nonexistent-agent -> false + no mutation; amount<=0 -> false; self-transfer net-unchanged (both suites). Watch the per-step clamp at world.ts:681 on a modifier-inflated self-transfer. |
| 11 | CG `attr`/`faction` ops miss undefined-state + comparator branches | `tests/attributes.test.ts:108`; `tests/relationships-factions.test.ts:85`; impl `cg-engine.ts:290-303` | Add undefined-attr-excluded (filter-level), `>=`/`==` comparators, factions-undefined-excluded, and a `cond.field`-only faction rule. |
| 12 | `attr` op equality not expressible via the typed comparator union | `cg-engine.ts:297-303`; `cg-types.ts:53` | Add explicit `'=='` to the union+case, or document equality as the comparator-omitted default. Same fallback in `compare()` (cg-engine.ts:374). |
| 13 | Redundant cast leftover from EmotionalPressure union->string | `il.ts:348` | Drop `as EmotionalPressure['type']`; `String(ep.type)` already yields string. |

---

## Dedupe Notes
- The brief's three separate "no save/load round-trip test" entries (`attributes.test.ts:1`, `save-load.test.ts:136`, and the consistency-perf duplicate) describe **one** gap — collapsed into **#3** (canonical major). The minor framings are subsumed.
- The two `world.ts:558` entries ("prototype pollution" consistency + "perf for...in") are the **same line** — collapsed into **#9**; the prototype-pollution/security framing is discounted (no prototype mutator in runtime).

## Uncertain Findings
None. The adversarial pass returned an empty `uncertain` array; every finding was confirmed against source.

## Accepted Residuals (correctly NOT reported)
`event.payload` keys `perpetratorName`/`affectedName` (untyped-payload residual); the client/server WS `crime:scene`/`crimeType` contract (game-UI layer); the full A7b shop->inventory migration (deliberate follow-up gated on an economy module). No finding intrudes on these.