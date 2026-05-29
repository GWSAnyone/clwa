# New tests permanently pollute global registries with no teardown -- order-dependent, latent false-pass hazard

- **Dimension**: tests
- **Severity**: minor · **Category**: test-gap
- **Location**: `tests/genre-neutrality.test.ts:136`
- **Adversarial verdict**: confirmed

## Issue
The new tests mutate process-global singletons with no afterEach/afterAll cleanup (grep confirms none): AFFORDANCE_REGISTRY.push(defraud) (line 136) permanently adds an affordance; REQUIREMENT_CHECKERS.set / POST_TARGET_REQUIREMENT_CHECKERS.set / registerScoringContributor / registerEventCategory all leak. SCORING_CONTRIBUTORS (al.ts:438) is a never-cleared module array, so the attributes test's contributor (attributes.test.ts:140) and the genre contributors stay registered for the rest of the process. They are written defensively (contributors guard on aff.id, checkers re-set the same key) so it is green today, but: (a) bun test file order is not contractually stable and a future test calling computeUtility on an arbitrary affordance silently gets extra contributor score; (b) a future test asserting AFFORDANCE_REGISTRY size would be corrupted. Latent flakiness, not a current failure.

## Suggested fix
Expose test-only reset helpers (e.g. clearScoringContributors()) and call them in afterAll, or at minimum add an afterAll that pops the pushed AFFORDANCE_REGISTRY entry to keep registry sizes deterministic across files; document the deliberate leak where it remains.

## Adversarial verification — New tests permanently pollute global registries with no teardown — order-dependent, latent false-pass hazard
Verified against current source on feature/engine-generalization.

NO TEARDOWN: tests/genre-neutrality.test.ts imports only `{ describe, test, expect }` (line 11) — no lifecycle hooks at all. A repo-wide grep for afterEach|afterAll|beforeEach in tests/ returns hooks ONLY in cg-integration.test.ts, regression.test.ts, llm-consolidation.test.ts, llm-usage.test.ts — never in genre-neutrality.test.ts or attributes.test.ts. No clear/reset helper exists anywhere (grep for clear|reset|teardown in al.ts: no matches). So the finding's "grep confirms none" is accurate.

THE LEAKS ARE INTO LIVE MUTABLE MODULE SINGLETONS:
- AFFORDANCE_REGISTRY is `export const AFFORDANCE_REGISTRY: AffordanceDefinition[] = []` (al.ts:148). genre-neutrality.test.ts:136 does `AFFORDANCE_REGISTRY.push(defraud)` with no pop. This array is iterated wholesale by the live volition tick: volition.ts:154 (`for (const aff of AFFORDANCE_REGISTRY)`), volition.ts:233, and world.ts:1849. So a leaked `eco_defraud` persists process-wide and would be scored/checkRequirements'd in any later test that drives a full tick.
- SCORING_CONTRIBUTORS is `const SCORING_CONTRIBUTORS: ScoringContributorFn[] = []` (al.ts:438), a never-cleared array; registerScoringContributor just `.push`es (al.ts:439); computeUtility iterates it on every call (al.ts:481 `for (const c of SCORING_CONTRIBUTORS) contributorScore += c(aff, agent)`). attributes.test.ts:140 registers a contributor with no removal.
- REQUIREMENT_CHECKERS.set('hasCapital', ...) (genre-neutrality.test.ts:83,150) and POST_TARGET_REQUIREMENT_CHECKERS.set('atMarket', ...) (line 94), registerEventCategory/Labels/Flags (lines 112-114), registerActionVerbs (line 122), registerTargetEnricher (line 103) all leak with no teardown.

GREEN-TODAY DEFENSIVE WRITING (also as the finding states): the attributes contributor guards on id — `(a, agent) => a.id === 'eco_smuggle' ? ...*0.5 : 0` (attributes.test.ts:140), returning 0 for any other affordance; the genre file re-`.set`s the same checker key rather than appending. So no current cross-test corruption.

LATENT, NOT CURRENT: the existing size assertion at boot-smoke.test.ts:92 is `expect(AFFORDANCE_REGISTRY.length).toBeGreaterThan(10)` — it tolerates the extra pushed entry today, which is precisely why this is latent. A future exact-size assertion, or a future test invoking computeUtility/the volition tick on an arbitrary affordance, would silently pick up the leaked entry/contributor. Bun runs these files in one shared process and file order is not contractually pinned, so this is a real order-dependent false-pass hazard.

This is NOT on the accepted/known residual list (untyped payload keys; WS crime:scene contract) and is a genuine test-hygiene defect. Severity minor / test-gap is appropriate. The suggested fix (expose clearScoringContributors() + afterAll that pops the AFFORDANCE_REGISTRY entry / resets the set keys) is sound and consistent with how cg-integration.test.ts and regression.test.ts already restore global state in afterEach.
