Both confirmed:
- instinct-builder.ts:205 reads `bigFive[rt.trait]` — confirms the `getResistanceVoice` site (spec says :205, exact) that DD-PP-04 part 3 wants to convert to an axis-reader.
- personality-prose.ts:46 `getStressGrowthDirective(mood, enn)` — confirmed; reads `mood` only (not traits directly), elastic + prose-only, mutates nothing. Spec's "NOT a seam — disambiguation" framing is accurate.

I have verified 13+ anchors across the most load-bearing claims. I have everything needed to write the assessment.

# Cold-Start Fidelity Assessment — SPEC-personality-plasticity.md (M8)

## 1. SELF-SUFFICIENCY

**Verdict: HIGH self-sufficiency. The spec is implementable from spec + standard context alone.** No load-bearing dependency on `docs/CONCEPT_Negation.md` or the unstated design conversation.

- The "Negation world" is referenced exactly as the spec frames it — a non-binding "breadth compass" and an out-of-scope success-test. Every place it appears (Цель §, 3-pillar §, Seams §) restates the same point: it must be expressible as *module data*, but the engine "никогда не содержит слов Negation/trauma/wound/debt." Nothing the implementer must *build* requires reading CONCEPT_Negation. The Type I/Type II distinction is illustrative, not a build target. **No blocking external dependency.**
- The two genuine *external* dependencies are both named and bounded: (a) `SPEC-affordance-modifier` (M9) — but the spec is explicit and correct that PP does **not** block on it (Seam A is decoupled; PP subscribes to `onActionExecuted`, M9 emits it; verified the hook doesn't exist yet so it's net-new in both). (b) the **player-action emission point** for `onActionExecuted` — correctly flagged as a deferred shared-workstream prerequisite (Open Q #2), with NPC-side fully shippable meanwhile.
- All reused primitives are real and the spec points at them accurately (verified below). A cold implementer has `ScalarAttribute`, `adjustAttributeBase`, `addAttributeModifier`, `getMaxConfidenceFor`, `registerScoringContributor`/`clearScoringContributors` as concrete templates.

The only thing a cold implementer cannot independently resolve is **Open Q #1 (M8 ordering, plasticity vs politics)** — correctly escalated to the user, not a blocker for *this* spec's code.

## 2. AMBIGUITY / DRIFT-RISK

**HIGH:**
- **SF4 "consequential action-step" filter is underspecified.** The spec says fire `onActionExecuted` only on a consequential step (`GoalActionResult` "с заполненным `emittedEvent`, либо финальный action-шаг цели") — NOT on move/dialogue steps. But the real loop at `world.ts:1242` fires `onGoalAction?.(action)` on **every** chained action including movement. The spec gives the *intent* but not the exact `GoalActionResult` field predicate, and I did not see `GoalActionResult`'s shape documented in the spec. A cold implementer must reverse-engineer the discriminator (`action.emittedEvent != null`? `action.movement == null`? final-step detection?). Guessing wrong → either every movement step falsely triggers plasticity rules, or consequential actions get missed. This is the single highest behavioral-divergence risk.
- **`applyPlasticShift` clamp bounds depend on seed ordering.** Data Model says `trait:O` is `min=0 max=1`. But `applyPlasticShift` wraps `adjustAttributeBase`, which (verified `world.ts:679`) lazy-creates a missing attribute as `createAttribute(0)` → **`min=-Infinity, max=Infinity`**. So a plastic shift on an axis that was never seeded (e.g. a module axis, or an engine axis on an old/un-seeded agent) silently gets unbounded `[-∞,∞]` clamp instead of `[0,1]`. The spec relies on Phase 1 seeding running first, but never states "applyPlasticShift must seed-with-bounds if the axis is absent." A cold implementer following the wrapper literally produces an un-clamped trait. MED→HIGH.

**MED:**
- **`derivedRecompute` delta semantics.** DD-PP-09 says "реаплаит **дельту**" via the single `computeBaseMoodFromTraits(N,E)` formula, but `applyPlasticBaseMoodShift` takes an absolute `delta` and clamps. How `derivedRecompute` computes the delta (recompute full baseMood from new N/E and diff against old? apply `formula(newN)-formula(oldN)`?) is described by *signature* `(agent, axis, oldEff, newEff)` but the body is left to the implementer. The "no double-count" guarantee hinges on getting this exactly right, and the spec hands a callback signature, not the body. Risk of double-counting or drift from the boot seed.
- **`magnitudeScale` canonical formula is "recommended, module-free."** DD-PP-07 gives `scale = 1 + weightBelief*conf + weightRel*max(0,sent)` but explicitly says the module is free to do otherwise. For the *engine* this is fine (additive default 1.0 is concrete). But a cold implementer writing the **test fixtures** (test #7) must invent a fixture rule; if they write a pure-multiplicative one they reproduce the dead-rule footgun the spec warns about. LOW for engine, MED for test authoring.
- **`anneal` "set once, last-write-warns" location.** DD-PP-05 says anneal is set in `registerTraitAxis` OR on first shift, then immutable. The exact write-point ("only if axis has no drift yet") is stated, but the interaction between an axis-level `registerTraitAxis({anneal})` and a per-rule `rule.anneal` (both exist in the schema) is "last-wins-at-axis-level." Which wins on conflict (registry vs rule) isn't pinned. MED.

**LOW:**
- `effectiveBigFive(agent)` adapter is named and its shape given, but the precise list of struct-consumers needing it (`bigFiveToDescription`, topic-engine, routes, llm-prompt-builder) is enumerated — low risk.
- `getTrait`/`trait()` normalization (single-letter OR full name) is concrete via `TRAIT_NAME_TO_AXIS`.

## 3. DECISION-COMPLETENESS

**Strong overall — this is an unusually complete spec.** 12 DDs each with Решение/Rationale/Rejected, full TypeScript signatures for the registry, `PlasticityRule`, `PlasticityTriggerCtx`, and all 5 new `World`/`Agent` methods. The bigFive→state migration is concrete: profile.bigFive stays immutable seed, state axes seed from it, loadState merge-fills missing OCEAN+H. The seam model (3 thin wrappers over `getMaxConfidenceFor`/`getRelationship`/`onActionExecuted`) is concrete and the 0-vs-floor semantics are correctly nailed.

**Underspecified / left implicit:**
- The `onActionExecuted` **consequential-step predicate** (see §2 HIGH) — the seam's emission *condition* is the least-concrete part of the whole spec.
- **`adjustAttributeBase` clamp-bounds gap** (§2) — DD-PP-01 asserts `min=0 max=1` as if guaranteed, but the wrapper path doesn't enforce it for lazy-created axes.
- **`derivedRecompute` body** — signature given, semantics described, body not (§2 MED).
- **`registerTraitAxis` defaults application** — `getTraitAxes` must "always present OCEAN+H," and `clearTraitAxes` "re-seeds OCEAN+H." The seed *values* for the 6 engine axes (presumably 0.5? or from where?) aren't given — but since per-agent seed comes from `profile.bigFive`, the registry-level `seed` for OCEAN+H is only a fallback; the implementer must pick (likely 0.5, matching the `trait()` fallback). Minor.
- **Where `onActionExecuted` is *declared*** vs the existing `onGoalAction` callback pattern is clear (parallels `world.ts:63/596` `onMoodChange`), so the callback plumbing itself is well-anchored.

A cold implementer would **not** need to re-derive architecture — the diamond (engine law / module data) is spelled out and the reuse-not-reinvent discipline is enforced by DD-PP-01/02/10. The risk is local execution detail, not architectural drift.

## 4. CODE-ANCHOR RELIABILITY

**Spot-checked 13 anchors — uniformly current, at most ±1–2 line drift. Navigable, not misleading.** This is the strongest part of the spec.

| Spec anchor | Real | Verdict |
|---|---|---|
| `attributes.ts:26-36` ScalarAttribute, `:54-58` effective, `:60-68` decay, `:76-91` drift | exact | ✅ incl. the two-branch drift (linear vs exp-toward) DD-PP-05 relies on |
| `beliefs.ts:81-89` getMaxConfidenceFor returns 0, keyed by `subject` | exact (`:82-90`) | ✅ confirms DD-PP-07 "no 0.1 floor on read-path" |
| `beliefs.ts:~115` `Math.max(0.1,...)` in decayBeliefs | exact (`:115`) | ✅ |
| `al.ts:30` OceanHTrait, `:33` AffordanceWeight.trait, `:391/451` TRAIT_MAP, `:457` moodCurve(H) | exact | ✅ confirms closed-union scoring constraint |
| `cg-engine.ts:341-346` checkTrait reads bigFive by full name → undefined→false | `:342-347` (+1) | ✅ confirms the "checkTrait is string-keyed natively = FALSE" adversarial claim |
| `world.ts:536-537` social-stress ps formula | exact | ✅ DD-PP-12 temperament read |
| `world.ts:550-553` advanceMoodMath comment | exact | ✅ confirms DD-PP-02 correction |
| `world.ts:578` loneliness extraversion, `:592` decay+drift loop, `:595-596` onMoodChange >0.0005 | exact | ✅ |
| `world.ts:673-681` adjustAttributeBase | `:674-682` (+1) | ✅ but exposes the `[-∞,∞]` lazy-create gap (§2) |
| `world.ts:1242` onGoalAction hook | exact | ✅ but fires on every step (SF4 gap) |
| `world.ts:1890/1992-2004` toJSON/loadState | `:1892` (+2)/`:1992-2004` exact | ✅ confirms "seed-then-replace, full map replace at :2004" — DD-PP-08 |
| `world.ts:1988` baseMood formula | exact | ✅ DD-PP-09 extraction target |
| `event-registry.ts:670-690` TickPhaseContext, `:692-698` registerTickPhaseHandler | exact | ✅ confirms "no per-tick event list" |
| `boot-smoke.test.ts:317/497` validTraits hardcode | exact | ✅ SHOULD-FIX is real |
| `instinct-builder.ts:205`, `personality-prose.ts:46` | exact | ✅ |
| `index.ts:728-739` seeding (NPC + player :738), `:283` version gate | exact | ✅ |

One spec claim worth flagging: DD-PP-06 says "`WorldEvent` не имеет `gameMinute`" — but `TickPhaseContext` itself **does** carry `gameMinute` (event-registry.ts:675). This doesn't break the argument (the point is the *event* lacks per-event minute and there's no per-tick event list), but the phrasing could mislead someone into thinking time is unavailable in tick handlers. Cosmetic.

## 5. PHASING EXECUTABILITY

**Strong. Each phase is independently shippable and the additive-before-destructive claim holds — verified against real code.**

- **Phase 0 (read-seam)** is genuinely byte-identical: `trait()` falls back to `profile.bigFive` when no state axis exists, and the `attributeEffective`-based read on a seed-equal base is identical to the current direct `bigFive[X]` read. The DD-PP-12 carve-out (mood terms stay on seed) is the one subtlety, but it's explicitly enumerated by file:line (`world.ts:536/578`, `al.ts:457`). A cold implementer following the migration list will not break the oracle. The boot-smoke `validTraits` registry-driven swap is correctly in P0 (else P0 itself could fail once an open axis appears).
- **Phase 1 (state-back)** rides existing save/load round-trip with zero new persistence code — verified (`toJSON:1892` omit-when-empty, `loadState:1992-2004` full-replace). The merge-seed fix is the one net-new branch and it's well-justified by DD-PP-08. INV-21 holds (old saves lack `trait:` keys → fallback).
- **Phase 2 (law)** adds the registry/evaluator/World API with zero registered rules → no behavior change. The one wall-risk is the `onActionExecuted` emission filter (§2 HIGH) — if the implementer wires it to fire on every goal step, Phase 2's "behavior unchanged with no rules" still passes (no rules → no shifts), but the *first* registered rule in Phase 3/4 misbehaves. So the wall is deferred, not hit in-phase — which is actually a subtle trap: P2 looks green even with the bug latent.
- **Phase 3 (seams)** and **Phase 4 (M9 + player execution)** are correctly decoupled; PP never blocks on M9.
- **No destructive step** — `profile.bigFive` and `BigFive` interface survive forever, keeping `keyof BigFive` typings compiling (tsc-0). Verified that `TRAIT_MAP` and the instinct-builder inline type depend on this.

A cold implementer can follow P0→P4 in order without an architectural wall. The only "soft wall" is the SF4 emission predicate surfacing as a Phase 3/4 test failure rather than a Phase 2 one.

---

## FIDELITY SCORE: **86 / 100**

A cold session would implement this very close to the intended diamond architecture. The spec is anchor-accurate (13/13 verified), DD-complete, genre-neutral-disciplined, and correctly phased. It loses points only on a handful of *execution-detail* gaps where a literal reading diverges from intent — none of which are architectural, but two of which produce silent behavioral bugs.

### TOP DRIFT-RISKS
1. **`onActionExecuted` consequential-step filter (SF4)** — spec states intent but not the `GoalActionResult` predicate; real loop fires on every step incl. movement. Wrong guess → movement steps falsely trigger plasticity, and the bug hides until a rule is registered (Phase 3/4), passing Phase 2 green. **Highest divergence risk.**
2. **`applyPlasticShift` clamp bounds** — wrapping `adjustAttributeBase` lazy-creates `[-∞,∞]`, not the Data-Model-promised `[0,1]`. Un-seeded/module axes silently go unbounded.
3. **`derivedRecompute` body / delta math** — callback signature given, body left implicit; the "no double-count baseMood" guarantee depends on the implementer deriving the delta correctly.
4. **`anneal` registry-vs-rule conflict resolution** — both `TraitAxisDef.anneal` and `PlasticityRule.anneal` exist; "last-wins-at-axis-level" doesn't pin which wins between the two sources.
5. **Test-fixture `magnitudeScale`** — test #7 author could reproduce the dead-rule (pure-multiplicative) footgun the spec warns about, since the canonical formula is "recommended, not mandated."

### SPEC-HARDENING (only the materially fidelity-raising ones)
- **Pin the SF4 predicate in code terms.** State the exact `GoalActionResult` discriminator for "consequential step" (e.g. "fire iff `action.emittedEvent != null` and `action.movement == null`") rather than prose, and add it to the World-API §, not just the Engine-Law §. This is the single highest-leverage fix.
- **Make `applyPlasticShift` seed-with-bounds explicit.** Add one line: "if `attributes['trait:'+axis]` is absent, `applyPlasticShift` MUST create it via the registry's `{min,max,seed}` (not the `adjustAttributeBase` `[-∞,∞]` default) before shifting." Otherwise `adjustAttributeBase`'s lazy default silently unbounds the axis.
- **Give `derivedRecompute` a one-line reference body** for the canonical N→baseMood case, e.g. `applyPlasticBaseMoodShift(id, computeBaseMoodFromTraits(newN,newE) - computeBaseMoodFromTraits(oldN,oldE))`, so the no-double-count guarantee is mechanical, not re-derived.
- **One sentence on anneal precedence:** registry-level `TraitAxisDef.anneal` is the axis default; `rule.anneal` applies only if the axis has no drift yet (consistent with the "set once" rule) — pin which is authoritative.
- Minor: soften the "`WorldEvent` has no `gameMinute`" phrasing to avoid implying tick handlers lack time (TickPhaseContext.gameMinute exists at event-registry.ts:675).