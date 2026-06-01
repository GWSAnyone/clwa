# Adversarial Review — Lens: COMPOSITION + COMPLETENESS across SPEC 1 (Personality Plasticity) + SPEC 2 (Affordance-Space Modifier)

Verdict: The two designs are individually plausible and reuse the right primitives, but the **inter-spec seam is the weakest, least-implementable part of the whole proposal**, and several load-bearing "ride the existing X" claims are wrong about the actual code. The "Negation world is expressible as pure module data" success criterion is **not yet true** as specified — it depends on (a) a trigger seam that has no emission/consumption point on either side, (b) a permit scope that excludes the common module-gated case, and (c) an unenforced "no one does both" convention.

All claims below were checked against source.

## A. Is the SPEC1↔SPEC2 seam coherent and concretely specified on BOTH sides? — NO (3 MUST-FIX)

The seam "using an affordance-modifier costs a piece of yourself" is the single most important composition point, and it is hand-waved on both ends:

- **No emission point.** Choosing/executing an affordance emits no WorldEvent in the proactive path (`volition.ts:160-162` scores and returns; nothing is appended). The only action-tied event emission in the engine is `goals.ts:522-537`, gated on `emitEventType && transferred.length>0` (belief-transfer steps only). So there is no "use-event" for `when.abilityUse` to match and no execution success signal for `onAffordanceOverrideUsed`.
- **No consumption point.** SPEC 1's evaluator is a `registerTickPhaseHandler`, but `TickPhaseContext` (`event-registry.ts:670-690`) has no per-tick or per-agent event list — only `eventStore` + `processEvent`. The claim "ability-use events are visible without new plumbing" is false.
- **Wrong store granularity.** `EventQuery` (`event-types.ts:4-12`) is day-resolution; `WorldEvent` has `gameDay` but no `gameMinute` (`cg-types.ts:5-14`); `getAll()` is unbounded. A per-tick (dt=5 min) re-scan is both impossible at minute resolution and O(all-events).

Fix: define ONE shared execution hook (e.g. `World.onActionExecuted(actorId, affordanceId, target, usedOverride?)`) fired in both the NPC and player execution paths, and route BOTH the plasticity evaluator and `onAffordanceOverrideUsed` through it. This is the linchpin; without it neither Type-I cost nor event-driven plasticity fires.

## B. Are belief/sentiment scaling defined consistently in both? — MOSTLY, with one semantic trap (1 SHOULD-FIX)

- Sentiment: both correctly choose RAW `getRelationship(id).sentiment` over the crime-tuned `sentimentCurve` (al.ts:426) and both default missing-relationship to 0 (matches al.ts:461). Consistent. Good.
- Belief: both wrap `getMaxConfidenceFor` (beliefs.ts:82) but neither notes it is **subject-keyed** — it returns confidence of beliefs whose `subject` (the doer) is the passed id, i.e. "beliefs that name ME as the actor", not a generic "how strongly I believe things". Calling it "self-belief confidence" in both specs without this caveat will produce surprising module behavior. The 0.1 floor (beliefs.ts:115) is noted in SPEC 2 but only glancingly in SPEC 1.
- **Implementation contradiction (MUST-FIX, finding #3):** SPEC 2 routes sentiment-to-TARGET scaling through `registerScoringContributor`, but `ScoringContributorFn = (aff, agent) => number` (al.ts:437) has no target — so `fromSentimentToTarget` is unresolvable in the scoring channel as designed. `computeUtility` itself has the target (al.ts:447,461); the contributor does not.

## C. Is "Negation" expressible as pure module data on these layers? — NOT YET (2 MUST-FIX + 2 SHOULD-FIX block it)

- Type I (self affordance-override + plasticity cost): blocked by the missing trigger seam (B/A above) AND by **DEC-5** — permit does not bypass module `REQUIREMENT_CHECKERS`, but the interesting "grant an otherwise-forbidden action" cases are typically module-gated (isInvestigator etc., `validatePlayerAction` al.ts:532, genre-neutrality.test.ts:95). So a power that unlocks a module-gated action is not expressible via permit as specified.
- Type II (cross-agent/zone forbid scaled by sentiment): blocked by the scoring-contributor target gap (#3) and by `isAffordanceForbidden` having **no zone-state access path** from `AffordanceContext` (#5).
- Bilateral parity for both Types rests on `validatePlayerAction`, which is **dead code** in production (#4) — the player does not flow through it.
- "No one does both" is an **unenforceable convention** (#10): a single AffordanceOverride can legally carry both `plasticityTrigger` and `strengthScale`, and registries are flat arrays with no cross-validation seam.
- The neutrality proof both specs cite (engine has no Negation/trauma/wound/debt strings) **does not exist** — architecture.test.ts scans crime/trade words only (#8). It must be added.

## D. Migration / completeness gaps

- **Boot-order claim is wrong (#6):** "fresh seeder skipped on load" is false. `createGameContext` seeds attributes (index.ts:728) on every boot, THEN `loadState` does `agent.state.attributes = clean` (world.ts:2004, wholesale replace). Un-saved axes are WIPED on load and survive only via the `trait()`→profile-seed fallback (profile re-randomized deterministically from the restored seed, index.ts:376/770). The fallback is the real mechanism; the spec's narrative must be corrected and a test added. If seeded module axes must survive load, loadState must MERGE, not replace.
- **Blast radius undercounted (#7):** not "~17 engine + 4 module" — it is ~13 engine + ~20 module/server (full list in finding). Several sites destructure the whole bigFive struct (agent.ts:267, topic-engine.ts:238-239, world.ts:536) or serialize it whole (routes.ts:118,819) and need a synthetic-view adapter, not a 1:1 `trait()` swap. Missing any site reintroduces split-brain.

## What MUST be nailed before implementation (priority order)
1. The shared action-execution hook (the actual seam) — finding #1.
2. The per-tick/per-event data source for plasticity triggers — finding #2.
3. ScoringContributor target access (or fold into computeUtility) — finding #3.
4. The real player action chokepoint (validatePlayerAction is unused) — finding #4.
5. Zone-state accessor on AffordanceContext, required + populated bilaterally — finding #5.
6. permit-vs-module-requirement scope decision (gates Type-I realizability) — finding #9.

## What holds up (credit where due)
- ScalarAttribute reuse for trait axes and zone attributes is sound (attributes.ts is genuinely generic; drift/decay run bilaterally at world.ts:592).
- Raw-sentiment (not sentimentCurve) and null→0 choices are consistent and code-accurate.
- INV-14 prefixes (`trait:`/`pp:`/`forbid`/`permit`/`threshold`/`accumulation`) are NOT tripped by any existing architecture guard (verified vs lines 123/661/677) — the neutrality stance is achievable once the new guard test is added.
- Save/load via the existing `attributes` round-trip path (world.ts:1892/1992-2004, SL-07) is a real, correct reuse for trait/pp axes (zoneStates needs its own omit-when-empty care, #12).
