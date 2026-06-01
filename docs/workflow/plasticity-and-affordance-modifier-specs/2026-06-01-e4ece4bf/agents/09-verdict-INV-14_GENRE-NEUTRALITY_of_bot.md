# INV-14 Genre-Neutrality Stress Test — Both Engine Layers

**Verdict:** Both designs are *mostly* genre-neutral and well-grounded in the real code, but SPEC 1 has a **load-bearing flaw** that defeats its own locked "OPEN axes" decision, and several leak-adjacent assumptions in both specs need explicit scoping.

## What holds up (verified against source)
- **Naming is clean.** Every proposed engine identifier (`PlasticityRule`, `applyPlasticShift`, `trait:`/`pp:` prefixes, `AffordanceOverride`, `isAffordanceForbidden`, `forbid`/`permit`, `zoneStates`, `plasticityTrigger`, etc.) was run against the live architecture-test regexes (`STRONG`, `CRIME_PROSE`, `TRADE_PROSE` in architecture.test.ts:123/164/206) — **zero trips**. No Negation/trauma/wound/debt/crime/trade vocabulary in the proposed surface.
- **Reuse claims are real.** `ScalarAttribute` (attributes.ts) + `driftAttribute`/`decayAttribute` run on EVERY attribute every tick (world.ts:591-592), so the anneal-for-free and persistence-for-free claims are accurate. The `attributes` save path (world.ts:1892, 1992-2004) has the SL-07 NaN defense the spec cites, so `trait:`/`pp:` keys round-trip with zero new save/load code.
- **SPEC 2's bilateral-gate reasoning is correct.** `validatePlayerAction` (al.ts:510-562) iterates only `REQUIREMENT_CHECKERS` (al.ts:532) and never `POST_TARGET_REQUIREMENT_CHECKERS` / `checkPostTargetRequirements` — so DEC-2 (override gate must be a shared *pre-target* engine function, not a post-target checker) is the right call for INV-16/17 parity.
- **SPEC 2's zone justification is correct.** `LocationDef` (world-types.ts:25) is static config (id/name/connections/isPublic), no mutable state, not in the tick loop — a parallel `zoneStates` map is genuinely the only home for a stateful zone.
- **Seam primitives exist as claimed.** `getCoPresent` (perception.ts:55), `getMaxConfidenceFor(subject, matcher)` (beliefs.ts:82), the 0.1 confidence floor (beliefs.ts:115), raw `getRelationship().sentiment` — all real.

## Where neutrality actually breaks

### SPEC 1: the open-axis registry is only HALF-open (MUST-FIX)
`registerTraitAxis` lets a module *declare* `'stability'`/`'wound'`/`'devotion'`, but **every consumer that makes a trait matter is hard-closed to the 6 OCEAN+H keys**:
- `computeUtility` scores via `TRAIT_MAP: Record<OceanHTrait, keyof bigFive>` (al.ts:391, 451) — `AffordanceWeight.trait` is the closed union `OceanHTrait` (al.ts:30,33).
- `cg-engine.checkTrait` reads `profile.bigFive` (cg-engine.ts:342-347) — the literal 6-key seed object (agent-types.ts:1-8), **not** `state.attributes['trait:...']`. The spec's report claim that checkTrait "reads module axes natively" is **false**; `trait:'stability'` returns `undefined → false`.
- `resistTraits` is a closed OCEAN+H string union (al.ts:134).

So a module axis is unreachable by scoring, CG gating, and resistance prose — i.e. exactly the channels the Negation world needs for a `wound`/`devotion` axis. **The fix must widen all three consumption paths**, not just add `Agent.trait()`.

### SPEC 1: existing tests block actual open-axis use (SHOULD-FIX)
boot-smoke.test.ts:316-327 and :495-504 hard-assert the closed `validTraits` set for `resistTraits` and CG `{op:'trait'}` conditions. The engine compiles, but the first module that *uses* a new axis fails the suite. Spec phasing omits any change here — it must drive `validTraits` from `getTraitAxes()`.

### SPEC 1: OCEAN-coupling in non-registry engine code (SHOULD-FIX, scoping)
`baseMood` from neuroticism/extraversion (world.ts:1988), loneliness from extraversion (world.ts:578), social-stress from neuroticism/agreeableness/honesty (world.ts:536-538), and fixed OCEAN+Enneagram prose (personality-prose.ts:4-50) are unconditional. This is a **pre-existing, test-blessed stance** (genre-neutrality.test.ts:137 calls it "pure OCEAN+H psychology" = universal) and is acceptable — but the spec must STATE it as an explicit boundary, not imply full openness. A genre wanting none of OCEAN seeds all 6 to 0.5 and ignores them.

### SPEC 2: opaque-string discipline must be an invariant (MUST-FIX, preventive)
The override layer's structure is neutral, but the spec proposes an engine-shipped scoring contributor and a `validatePlayerAction` reason string. These must NEVER `=== <literal>` against `source`/`category`; matching must be purely structural (`match.affordanceIds`/`categories`/`tags` set membership + numeric `minSeverity`). Promote the spec's own "synthetic-module override of a brand-new category honored with zero engine edits" test from testPlan to a hard architecture gate.

### SPEC 2: minSeverity smuggles a perception assumption (SHOULD-FIX)
`AffordanceDefinition.severity` is documented as "1-10, for witness reactions" (al.ts:97) — a perception-tuned scale, not a universal restrictability ordering. `match.minSeverity` reuses it as a generic "forbid all severe actions" key, importing the assumption higher==more-restrictable. Document it as a pure numeric ordering with no semantic claim, and prefer `tags`/`categories` as the primary neutral selector.

## "Could an unrelated genre use these unchanged?" — answer
- **SPEC 2: YES**, after the opaque-string invariant is pinned. The forbid/permit-on-state primitive carries no domain semantics; a puzzle game's "this door is sealed until you hold the key" is a `forbid` override scaled from a `fromAttribute` clause — no engine edit.
- **SPEC 1: NOT YET.** As written, an unrelated genre can declare a custom axis but cannot score, gate, or describe with it (half-open registry), and cannot escape the built-in OCEAN-coupled mood/stress derivations. After widening the three consumption paths + driving the test validTraits from the registry + documenting the OCEAN-coupling boundary, it reaches YES.

## Bottom line
No outright crime/trauma/Negation **vocabulary** leaks into either engine design — the static guards all pass. The genuine INV-14 failures are **structural**: SPEC 1's openness is cosmetic until the OCEAN-closed consumer paths are widened, and both specs have hidden domain assumptions (severity-as-restrictability; OCEAN-coupled mood math) that must be made explicit scoping decisions rather than silent couplings.