# Adversarial Stress Test — Lens: HOT-PATH Performance + Correctness

Both designs are architecturally sound and the reuse-of-ScalarAttribute / shared-gate strategies are correct. But several load-bearing claims are **wrong against the real code**, and two hot-path cost claims are under-stated. Verified against source below.

## MUST-FIX (correctness — these break as written)

### 1. The 0.1 belief-confidence floor does not exist on the read path (both specs)
`getMaxConfidenceFor` (beliefs.ts:81-89) returns **0** when no matching belief exists. The `Math.max(0.1, …)` at beliefs.ts:115 is inside `decayBeliefs` and only floors an **already-existing** belief during day-decay. Both SPEC-1 (Seam B) and SPEC-2 (§1.3, DEC-7) assert "confidence floored at 0.1, never 0, so 'no self-belief ⇒ zero strength' is false." That is backwards. With a purely multiplicative `magnitudeScale`/`resolveOverrideStrength`, an agent with no matching belief gets a **0 multiplier** → the rule/override silently does nothing. Fix: belief must be an **additive bonus** over a base of 1.0 (or `step`), not a multiplier — or modules must be told a no-belief multiplicative scale is a dead rule.

### 2. SPEC-1 Seam A "no new plumbing" is false — no per-tick event stream exists
`TickPhaseContext` (event-registry.ts:670-690, built at world.ts:1369-1382) has **no** this-tick `events` array. `approaches` is an output buffer handlers push to; `eventStore` is the full history (re-scanning it per tick per agent is O(agents×events), unbounded). The PP evaluator cannot "see ability-use events without new plumbing." Fix: add a `recentEvents` window to TickPhaseContext, OR fire threshold rules from the event-processing path (processCascade / handleEventForGoals) instead of a tick sweep.

### 3. cg-engine.checkTrait key-convention mismatch → silent split-brain in CG gating
`checkTrait` (cg-engine.ts:342-346) keys `bigFive` by **full name** (`openness`); SPEC-1 stores axes as `trait:O`…`trait:H` (single letter, per `TRAIT_MAP` al.ts:391). The migration's "redirect checkTrait to read state axis first" would look up `trait:openness`, miss every seeded axis, and fall through to the frozen profile seed — exactly the split-brain DD-PP-03 claims to prevent. Because CG drives crime cascades, this is **oracle-drift risk**. Fix: define ONE canonical axis-key space + a shared name→axis map used by both computeUtility and checkTrait; spec the exact translation.

### 4. SPEC-2 gate cost on the tightest loop is under-stated
`computeUtility`/`checkRequirements` run per-affordance × per-agent × per-decision (volition.ts:154-165). `isAffordanceForbidden` (DEC-3/§1.5) must scan self + zone + **co-present projectors** (getCoPresent is O(allAgents), perception.ts:54-65) inside that loop → O(A·N) per agent → **O(A·N²) per proactive sweep** at MMO scale. Fix: hoist the projected-override set to once-per-(agent,decision); add an **O(1) early-out** when the agent's location has no ZoneState and no co-present agent carries any override (the universal crime/economy zero-override case). Spec the early-out explicitly.

## SHOULD-FIX (perf regressions / latent footguns)
- **5.** Per-tick `Object.values(attributes)` decay/drift loop (world.ts:589-593) grows from ~1 entry/agent today to 6 trait axes + N accumulators on **every** agent — for axes that, by default (irreversible), do nothing. Skip frozen/no-modifier axes; lazy-create `pp:` accumulators.
- **6.** `pp:` accumulator stored as ScalarAttribute **base** never decays (decayAttribute only ticks modifiers) → unbounded growth / "never forgets". Store the accumulator as a decaying **modifier**, not base, to reuse the elastic decay path.
- **7.** `computeUtility` swapping the direct `bigFive[…]` field read (al.ts:451,457) for `agent.trait(axis)` adds `'trait:'+axis` string-alloc + attributeEffective clamp + ?? chain per weight per affordance per decision. Precompute the 6-trait vector **once per decision**; intern axis keys.
- **8.** SPEC-2 reactive gate (DEC-6) compounds the cross-agent scan onto the per-reactor × per-affordance reactive loop (volition.ts:227-263). Same hoist + early-out.
- **9.** `AffordanceContext` has no World/zoneStates ref; the `zoneOverridesFor?` closure must be set at `buildAffordanceContext` (world.ts:1772, the single production chokepoint) or zone curfews silently no-op on some paths without tripping tsc.

## NICE
- **10.** Confirm player override composes with the pre/post-target asymmetry (validatePlayerAction never calls checkPostTargetRequirements, al.ts:510-562 — SPEC-2's pre-target DEC-2 is correct; add an explicit test).
- **11.** The new engine file must avoid the literal `curfew`/`power` examples the specs themselves use in comments — they'd fail the specs' own INV-14 grep.

## What checks out
- ScalarAttribute reuse, save/load free round-trip (world.ts:1892, 1992-2004 with SL-07 finite guards) — verified correct; trait:/pp: ride the existing attributes path with no new save code.
- driftAttribute/decayAttribute NaN defenses (attributes.ts:76-91) are solid; no NaN/clamp bug introduced by routing traits through them.
- `buildAffordanceContext` (world.ts:1772) is a genuine single chokepoint for the bilateral paths (proactive world.ts:1174, reactive world.ts:258, player server.ts:237 / routes.ts:1056).
- DEC-1 gate-vs-score separation is correct: a forbidden action returns null in checkRequirements (al.ts:321) before computeUtility (al.ts:447) ever runs — no "scored but impossible".
- Phase-0 byte-identical claim holds for the genre-neutrality test (genre-neutrality.test.ts:137-158 builds agents with bigFive and NO attributes → exercises exactly the trait() fallback path).
- Current scale is 8 agents / 8 locations; the O(N²) concerns are about the stated MMO target, not today's world.