# Cold-start fidelity — synthesis

I have what I need. The critical cross-spec verification is done: both specs carry the `onActionExecuted` signature **byte-identical** (M8 line 350, M9 lines 558-559), both annotate it "CANONICAL signature shared verbatim ... (audit MF1)," and the `usedOverrideId: string` contract is consistent on both sides (M9 passes `override.id`, M8 matches via `when.abilityUse === usedOverrideId`). One genuine cross-spec asymmetry surfaced that neither single-spec report flagged: the **SF4 "consequential step" filter is documented ONLY in M8** (line 349) and is **absent from M9's emission description** (lines 270, 563-565), where M9 actually owns the player-path emission point.

Here is the synthesized assessment.

---

# Cold-Start Fidelity — SPEC-personality-plasticity (M8) + SPEC-affordance-modifier (M9)

## Overall verdict

**Both specs are cold-start-implementable to a HIGH degree of design fidelity.** A fresh session handed only the spec + standard project context (codebase, Serena memories, CLAUDE.md) would build the intended **diamond architecture** — engine-law primitives reused, module-data discipline enforced, genre-neutral (zero `Negation`/`trauma`/`wound`/`curfew` literals in engine), correctly phased additive-before-destructive — **without re-deriving the architecture and without needing the original design conversation or `CONCEPT_Negation.md`.** The "Negation world" is correctly inert in both (a breadth-compass / success-test, never build content).

The drift that remains is **not architectural** — it is **local guessing at integration seams**, concentrated in a handful of under-pinned wiring points. Two of those produce *silent* bugs (pass their own phase green, fail later), which is the most dangerous failure mode for a cold session because nothing tells the implementer they drifted.

| Spec | Cold-start fidelity | Dominant risk |
|---|---|---|
| **M8 — Plasticity** | **86 / 100** | `onActionExecuted` consequential-step predicate (SF4) underspecified; `applyPlasticShift` lazy-create unbounds `[−∞,∞]` |
| **M9 — Affordance-modifier** | **84 / 100** | Live player-gate has no affordanceId mapping (front-loaded into P1); `ctx.zoneOverridesFor` closure untyped |
| **Pair (sequenced M8→M9)** | **≈ 83 / 100** | The shared `onActionExecuted` seam is consistent in *signature* but the *emission predicate* lives in only one spec — see below |

The pair scores slightly *below* the weaker member because the cross-cutting seam introduces one consistency hazard that neither single-spec audit could see in isolation.

---

## Cross-cutting drift-risks (only visible with BOTH specs open)

**1. The shared `onActionExecuted` signature is consistent — verified byte-identical.**
M8 line 350 and M9 lines 558-559 declare the identical 4-arg shape; both label it "CANONICAL ... shared verbatim (audit MF1)"; both nail `usedOverrideId: string` (not the object) so the M8 engine hook carries zero forward-dependency on M9's `AffordanceOverride` type. The consumer contract is coherent end-to-end: M9 passes `override.id` → M8 matches `when.abilityUse === usedOverrideId`. **This is the strongest part of the seam and a cold session would not desync the type.**

**2. THE seam hazard: the *emission predicate* is documented in M8 only, but the player-path *emission point* is owned by M9.**
The "fire ONLY on a consequential action-step, not on move/dialogue steps" rule (SF4) appears **only in M8** (line 349). M9's emission description (lines 270, 563-565) says the hook fires "в точке исполнения (NPC goal-path И player-path)" with **no consequential-step filter mentioned** — and M9 is the spec that wires the *player* emission. A cold session implementing M9-P4 from M9 alone would emit on every player action-step; a session implementing M8 would gate NPC emission to consequential steps. Result: **NPC and player plasticity fire on different step-classes** — a bilateral-invariant (INV-16) violation that *both specs claim to honor*, born purely from the predicate living in the wrong spec. This is the single highest-leverage cross-cutting fix.

**3. M8→M9 ordering is correct and explicitly managed — but absolute for M9-P4.**
`onActionExecuted` / `PlasticityRule.when.abilityUse` exist **only in the two spec files, not in `packages/`** (verified). M9-P4 hard-blocks on M8 having shipped the hook + consumer. Both specs flag this (M9 header + P4 precondition line 703/731; M8 P4 line 476 notes the decoupling direction — PP does *not* block on M9). A session given *both* and told the sequence is fine; a session given *only M9* walls at P4. **Correctly sequenced, not a defect — but the dependency is hard, not soft.**

**4. The unresolved M8-vs-Politics ordering (M8 Open Q #1) is a user decision, not a code blocker.** `SPEC-economy.md:197` also pencils Politics as M8; the spec correctly escalates rather than self-deciding. Does not block *this* code.

**5. Needs-both-specs-open to implement correctly:** only the seam in (1)+(2). Everything else in each spec is independently buildable. So the *only* artifact a cold implementer must cross-reference is the `onActionExecuted` hook — and today they'd get the signature right but the emission *condition* wrong.

---

## Spec-hardening — prioritized

### MUST (blocks faithful cold execution)

1. **Replicate the SF4 consequential-step predicate into M9, in code terms, on the player-path.** State the exact `GoalActionResult` discriminator (e.g. "fire iff `action.emittedEvent != null && action.movement == null`, or final goal action-step") in **both** specs' World-API sections, and explicitly state the *same* predicate governs the player emission M9 owns. Closes the #2 bilateral-desync and M8's own top risk simultaneously. *(Highest leverage of any fix.)*

2. **M9: specify the live player-gate concretely (DD-AM-06).** Give one worked example mapping a pressure speech-act (`threaten`/`bribe`) → an `affordanceId` consumed by `isAffordanceForbidden`, and name the live wiring point (`server/src/index.ts:161-202`). Without this, the implementer ships the gate into dead `validatePlayerAction` (theater) or invents an ad-hoc map — defeating the spec's central INV-16/17 bilateral claim. *(Front-loaded into P1.)*

3. **M8: make `applyPlasticShift` seed-with-bounds explicit.** One line: "if `attributes['trait:'+axis]` is absent, create via the registry `{min,max,seed}`, NOT the `adjustAttributeBase` `[−∞,∞]` lazy default, before shifting." Otherwise un-seeded/module axes silently go unbounded — a silent bug.

4. **M9: type the `AffordanceContext` extension + `zoneOverridesFor` closure.** Give the signature (e.g. `zoneOverridesFor: (locId: string) => AffordanceOverride[]`) and the per-pass projected-override index shape. Otherwise the implementer re-scans per-affordance (kills the "oracle provably unchanged" O(1) early-out) or makes it optional (the silent-no-op hole DD-AM-05 forbids).

5. **M9: reconcile the `permit`-scope contradiction.** Test-plan line 633 ("lifts engine universal gates") contradicts §2.1 line 488 ("does NOT lift period/mood/suppress"). Pick line 488 (intended) and fix 633, or a cold session ships an over-powerful `permit`.

### NICE (raises fidelity, not blocking)

6. **M8: give `derivedRecompute` a one-line reference body** for the N→baseMood case (`applyPlasticBaseMoodShift(id, computeBaseMoodFromTraits(newN,newE) − computeBaseMoodFromTraits(oldN,oldE))`), so the no-double-count guarantee is mechanical.
7. **M8: pin `anneal` precedence** — registry `TraitAxisDef.anneal` is the axis default; `rule.anneal` applies only if the axis has no drift yet.
8. **M9: specify `processGoalTick` re-gate threading** — whether `ctx` (or a `(actorId, affordanceId)=>boolean` checker) is added to its arg list, or the check runs in `world.ts` before the call.
9. **M9: fix the new INV-14 grep test** to exclude the pre-existing `world-types.ts:237` "traumatic event" comment — verbatim, the test goes RED on arrival (`trauma` matches `traumatic`).
10. **M8: soften "`WorldEvent` has no `gameMinute`"** — `TickPhaseContext.gameMinute` exists (event-registry.ts:675); current phrasing could imply tick handlers lack time.

---

## Bottom line

These are unusually implementation-ready specs: 13/13 (M8) and 12/12 (M9) spot-checked code anchors are current, the decision tables are near-complete with full TypeScript signatures, the diamond architecture and genre-neutral discipline are spelled out, and the phasing is genuinely additive-before-destructive so each phase ships green. A cold session would land the architecture faithfully — its losses are five localized integration-seam guesses, not architectural re-derivation, and the most dangerous (the `onActionExecuted` emission predicate and the M9 live-player-gate) are dangerous precisely because they pass their own phase green and fail silently later. **Do the five MUST fixes — above all, push the SF4 consequential-step predicate into M9 so both sides of the shared hook emit on the same step-class — and the pair moves from ~83 to mid-90s, i.e. copy-paste-faithful cold execution.** Until then, brief the implementer on exactly those five seams; everything else they can build straight from the specs.

Key files: `C:\Ledevia\Projects\CLWA\docs\specs\SPEC-personality-plasticity.md`, `C:\Ledevia\Projects\CLWA\docs\specs\SPEC-affordance-modifier.md`, `C:\Ledevia\Projects\CLWA\packages\engine\src\al.ts`, `C:\Ledevia\Projects\CLWA\packages\engine\src\world.ts`, `C:\Ledevia\Projects\CLWA\packages\engine\src\beliefs.ts`, `C:\Ledevia\Projects\CLWA\packages\engine\src\attributes.ts`, `C:\Ledevia\Projects\CLWA\packages\server\src\index.ts`, `C:\Ledevia\Projects\CLWA\tests\architecture.test.ts`.

---

## Cold-read: Plasticity

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

---

## Cold-read: Affordance-Modifier

Final confirmations:
- `onActionExecuted` / `abilityUse` / `PlasticityRule` exist ONLY in the two specs and workflow docs — NOT in `packages/`. This confirms the M8 seam is **proposed, not implemented**. M9-P4 hard-depends on M8 shipping `onActionExecuted` first. This is correctly flagged in the spec ("sequenced ПОСЛЕ M8", P4 precondition).
- `architecture.test.ts:123` `CRIME_PROSE` regex and `:206` `STRONG` regex — exact match to spec's INV-14 anchors. The spec's claim that new literals (`forbid`/`permit`/`agent`/`zone`) don't trip these guards is verifiable-correct (none of those words are in either regex).
- The only `trauma`-adjacent hit in engine is a comment in `world-types.ts:237` ("traumatic event") — pre-existing, unrelated. The spec's new grep test (`Negation|trauma|wound|debt|curfew`) would actually FLAG this existing comment. Worth noting as a minor snag.

I have everything needed. Let me compile the assessment.

---

# Fidelity Assessment — SPEC-affordance-modifier.md (M9) for a Cold-Start Implementer

**Verdict up front:** This is one of the most implementation-ready specs I've audited in this codebase. 43 code anchors, ~12 spot-checked, all current and accurate. A cold session would execute the intended diamond architecture with high fidelity. The remaining risk is concentrated in two seams (M8 dependency, "revive the dead player-gate") and a handful of under-pinned wiring details, not in the core model.

## 1. SELF-SUFFICIENCY — PASS (with one cross-spec dependency)

The spec is self-contained against **spec + codebase + standard context**. It does NOT lean on `CONCEPT_Negation.md` for anything load-bearing:
- `CONCEPT_Negation` is explicitly framed as a "breadth-компас (НЕ требования)" (lines 16-17, 50-52). The "Отрицание" world (§"Module-realizability", lines 741-771) is a **success-test of expressiveness**, not build content. A cold implementer can ignore it entirely and still build every engine primitive. Confirmed: the data model, gate, carriers, save/load, and tests are all derivable without the concept doc.
- The 7 "критические находки против реального кода" (lines 99-127) are the load-bearing context, and they are **re-derived inline from the real code** with anchors — so a cold session doesn't need the design conversation; the spec hands it the conclusions AND the evidence.

**The one real external dependency that can block:** **M8 (`SPEC-personality-plasticity`) must ship first.** I verified `onActionExecuted`, `PlasticityRule.when.abilityUse`, and the `usedOverrideId` string contract exist **only in the two specs** — not in `packages/`. The spec's DD-AM-11 / §5 assert the hook signature is "shared verbatim with SPEC-personality-plasticity (audit MF1)." A cold implementer doing M9-P4 in isolation would have to either (a) read M8's spec to get the exact `onActionExecuted` signature, or (b) get stuck. The spec **names** this dependency clearly (header line 6, P4 precondition line 731), so it's a managed dependency, not a hidden one — but P4 is genuinely not shippable without M8's hook landing. This is correct sequencing, not a defect.

## 2. AMBIGUITY / DRIFT-RISK

**HIGH — "Revive the live player-gate" (DD-AM-06, §2.1 player wiring, lines 205-218, 479-482).** This is the single largest drift surface. The spec correctly proves `validatePlayerAction` is dead (verified: only def at `al.ts:510` + re-export at `index.ts:57`, zero `packages/` callers) and that the live player path is IL pressure-handlers (`server/src/index.ts:161-202`, verified — they `storeEvent`/`observe` with no affordance-gate). But it then says "add `isAffordanceForbidden`-проверку **в точке, где живой player-path исполняет действие**" — and the live path is *emotional pressure speech-acts*, which don't map cleanly onto an `affordanceId`. A cold implementer must INVENT the mapping from "threaten/bribe pressure" → "which affordance is being gated." The spec gives no concrete affordanceId resolution for the pressure path. **Drift:** the implementer is likely to do the easy thing — wire the gate into the dead `validatePlayerAction` (which the spec explicitly rejects as "теоретический паритет") and quietly skip the live path, OR invent an ad-hoc pressure→affordance map that diverges from intent. The test plan (line 637-638) demands "post threaten через WS/IL под zone-forbid гейтится," but the spec never says *which* affordance `threaten` resolves to. This is the place most likely to ship as theater.

**MED — `permit` scope / wire-position ordering (§2.1 "Scope of permit", lines 483-488).** The spec is unusually careful here (calls it audit MF2), pinning `isAffordanceForbidden` AFTER universal pre-target gates and BEFORE `checkRegistryRequirements`. Verified the real gate order at `al.ts:313-318` matches. But the consequence — "permit lifts ONLY override-forbid, not period/mood/suppress, not module checkers" — is subtle and the test plan has a contradiction: line 633 says permit restores an action "(scope DD-AM-05: lifts engine universal gates + override-forbid only)" while line 488 says permit does NOT lift period/mood/suppress. **These two statements conflict.** A cold implementer reading line 633 might wire permit to bypass period gates; reading line 488 they wouldn't. Drift toward an over-powerful `permit`.

**MED — Per-pass projected-override hoist + `ctx.zoneOverridesFor` closure (§2.1 lines 466-469, DD-AM-05 line 192).** The spec mandates a "per-pass index `location → projectedOverrides`" built in `buildAffordanceContext` and a "**mandatory** engine-populated closure `ctx.zoneOverridesFor`," but gives NO type signature for either the closure or the hoisted index, and no concrete description of how `isAffordanceForbidden(aff, agent, ctx)` reaches the pre-built list (its signature takes only `ctx`). A cold implementer must design the `AffordanceContext` extension shape themselves. Confirmed `AffordanceContext` (`al.ts:152-176`) has no such field today. **Drift:** plausible the implementer re-scans co-present agents per-affordance (the O(affordances·agents) cost the spec explicitly warns against), losing the "provably unchanged oracle" early-out, OR makes the closure optional (which DD-AM-05 explicitly rejects as a silent-no-op correctness hole).

**MED — Execution-time re-gate plumbing (DD-AM-10, §2.4 lines 505-510).** Spec says re-call `isAffordanceForbidden` in the `processGoalTick` loop (`world.ts:1236`, verified) "перед исполнением консеквентного шага" using `goal.data.affordanceId` (`volition.ts:185`). But `processGoalTick` is called inside `goalManager` with a fixed argument list (verified at `world.ts:1236-1240`); it does not currently receive an `AffordanceContext` or a forbid-checker. The implementer must thread `ctx` (or a gate callback) into `goalManager.processGoalTick` or relocate the check. No signature guidance given. **Drift:** implementer may put the re-gate at the wrong layer (in `world.ts` before the call vs. inside `goals.ts`), or skip it because the plumbing is fiddly.

**LOW — Self-belief subject semantics (§1.3 caveat lines 442-445, Open Q #3).** Genuinely subtle: `getMaxConfidenceFor(subject, matcher)` filters by `belief.subject` not by holder (verified `beliefs.ts:82-90`). The spec documents that "self-belief" = beliefs whose SUBJECT the module designates as self, and the code sample passes `bearer.profile.id` as subject (line 426). A cold implementer following the sample verbatim is fine; one reasoning from scratch might pass the wrong key. The sample defuses most of the risk.

**LOW — `decayOverrides` dt and the permanent/timed distinction.** §4 says reuse dt=5 in `_tickMoodSystem` (verified the mood loop decays attributes with dt=5 at `world.ts:592`). The `decayOverrides` sample (lines 540-546) guards on `o.duration > 0`, so `remaining=0`+`duration=0` permanent overrides never decay — matches DD-AM intent. But note: the `AffordanceOverride` doc comment says "`remaining: 0 = permanent`" (line 388) while decay keys off `duration > 0`. A timed override authored with `remaining>0, duration=0` would be treated as permanent — a footgun, but the modifier model has the same convention, so an implementer familiar with `decayAttribute` won't trip.

## 3. DECISION-COMPLETENESS — STRONG

- **Data model (§1.1):** Fully concrete TypeScript. `AffordanceOverride`, `AffordanceMatch`, `AffordanceStrengthScale`, `ZoneState` are all spelled out with field-level intent. The `usedOverrideId: string` (not object) decision (lines 555-560) is precisely the kind of cross-spec coupling decision a cold session would otherwise get wrong — it's nailed.
- **Gate + carrier model:** Complete. The gate/scoring split (DD-AM-01) is anchored to the verified `computeUtility` gate-independence (`al.ts:447`, rel-read at `:461` verified, `c(aff, agent)` at `:486` verified). The forbid/permit precedence fold (DD-AM-04/12) is specified as an order-independent set operation with an explicit specificity ladder (`affordanceIds > categories > tags > minSeverity > empty`, fail-closed on tie) — executable without re-derivation.
- **`resolveOverrideStrength` (§1.3):** Given as full source. ADDITIVE model (DD-AM-08) is correct and verified against the real `getMaxConfidenceFor` returning 0 (`beliefs.ts:83`). No re-derivation needed.
- **API/registry signatures (§6):** All present including the `Omit<…,'id'|'sourceKind'|'sourceId'>` input shapes and the `getZoneState` (no-create) vs `getOrCreateZoneState` distinction for save-cleanliness.
- **Save/load (§7):** Concrete, with omit-when-empty and `clear()`-before-load anchored to verified siblings (`affordanceCooldowns.clear()` `:1938`, `sceneResidues.clear()` `:1954`, SL-07 finite-filter pattern `:1989-2002`).

**Underspecified / left implicit (the gaps that force design work):**
1. `AffordanceContext` extension shape for the hoisted index + `zoneOverridesFor` closure (see HIGH/MED above) — **no signature given.**
2. The pressure→affordanceId mapping for the live player gate — **the load-bearing gap.**
3. How `ctx`/forbid-checker reaches `processGoalTick` — plumbing not specified.
4. `isAffordanceForbidden` internal signature vs. the hoisted list: the public sig is `(aff, agent, ctx)` but the collection is "hoisted once per (agent, decision)" — where the per-decision collection lives and how the per-`aff` call reads it is left to the implementer.

## 4. CODE-ANCHOR RELIABILITY — EXCELLENT (12/12 spot-checked accurate)

| Spec anchor | Real code | Status |
|---|---|---|
| `AffordanceDefinition` starts `al.ts:93`; `severity` `:97`; no `tags` | `al.ts:93`, `:97`; no `tags` field | ✅ exact |
| `checkRequirements` `al.ts:304`; gates `:313-318`; `findTarget` after | `al.ts:304`, gates `:313-318`, `findTarget` `:320` | ✅ exact |
| `checkRequirementsReactive` `al.ts:333`; mood-relaxed `:342` | `al.ts:333`; comment `:342` | ✅ exact |
| `ScoringContributorFn = (aff, agent) => number` `al.ts:437`; call `:486` | `al.ts:437`; `c(aff, agent)` `:486` | ✅ exact (confirms DD-AM-07 need) |
| `computeUtility` `al.ts:447`; rel-read `:461` | `al.ts:447`, `:461` | ✅ exact |
| `validatePlayerAction` `al.ts:510`; no `checkPostTargetRequirements`; DEAD | def `:510`, self-iterates `:532`, no post-target call, zero `packages/` callers | ✅ exact (DD-AM-06 dead-code claim TRUE) |
| `getMaxConfidenceFor` `beliefs.ts:82` returns 0; floor 0.1 only in `decayBeliefs:115` | `beliefs.ts:82-90` `let max=0`; `:115` `Math.max(0.1,…)` | ✅ exact (DD-AM-08 TRUE) |
| `getCoPresent` `perception.ts:55` | `perception.ts:55` | ✅ exact |
| `buildAffordanceContext` `world.ts:1772`; reactive `:258`; proactive `:1174` | all three exact | ✅ exact |
| `processGoalTick` `world.ts:1236`; `onGoalAction` `:1242`; `onMoodChange` `:63`/`596` | all exact | ✅ exact |
| `decayAttribute` `attributes.ts:61`; `getAttributeValue` `:94` | `:61`, `:94` exact; splice idiom matches `decayOverrides` | ✅ exact |
| Save/load `clear()` siblings `:1938`/`:1954`; SL-07 filter; `createAttribute` re-clamp | `:1938`, `:1954`, `:1989-2002`, `:1996` | ✅ exact |
| `architecture.test.ts:123` `CRIME_PROSE`, `:206` `STRONG` | `:123`, `:206` exact; new literals don't trip them | ✅ exact |

Anchors are current to the commit a cold session would check out. No stale anchors found. The "43/43 verified" header claim is credible based on this sample.

**One INV-14 snag the spec missed:** the proposed new grep test (`Negation|trauma|wound|debt|curfew`, lines 686-687) would FLAG an existing pre-spec comment at `world-types.ts:237` ("traumatic event (default: 1440 = 24h)"). A cold implementer adding that test verbatim gets a RED suite from day one through no fault of their own. Minor, but it would cause a confusing wall on P4. (`trauma` matches `traumatic`.)

## 5. PHASING EXECUTABILITY — STRONG, with one inter-phase precondition

P0→P4 is genuinely additive-before-destructive and each phase is independently shippable:
- **P0** (caveat-pin, doc-only) — already done.
- **P1** (gate + self-override) — self-contained; the early-out keeps the oracle green (verified the gate-order claim). Ships alone. **But P1 bundles the HIGH-risk "revive player-gate" (DD-AM-06).** This is the one phase where a cold implementer could hit a wall or ship theater, because the live-path wiring is underspecified (§2 above). P1 is "smallest shippable" on paper but carries the spec's hardest unsolved plumbing.
- **P2** (strength/scoring) — clean additive; `ScoringContributorFn` widening is backward-compatible (verified existing contributors ignore arg 3).
- **P3** (zone) — additive; depends on P1's revived player-gate as a "hard precondition" (line 729) so zone-forbid hits the player. Correctly sequenced.
- **P4** (cross-agent + plasticity) — **hard-blocked on M8 `onActionExecuted` existing.** Verified it does not exist in code yet. If M8 hasn't shipped, P4 stalls. The spec states this; a cold session following the header would not be surprised, but a session handed *only M9* would hit a wall at P4.

`tsc 0 + tests green` per phase is plausible given the optional-everywhere carrier design (INV-21) and the verified omit-when-empty save pattern. The only test that won't be green out-of-box is the new `trauma` grep (snag above).

---

## FIDELITY SCORE: **84 / 100**

A cold session would produce something very close to the intended diamond architecture. The data model, gate/scoring separation, precedence fold, strength resolution, save/load, and INV-14 discipline would land faithfully because they're fully specified and anchor-verified. The ~16 points lost are concentrated in: the underspecified live-player-gate wiring (HIGH drift, and it's front-loaded into P1), the `AffordanceContext` closure/hoist shape left to the implementer, the `permit`-scope test/prose contradiction, and the unspecified `processGoalTick` re-gate plumbing. None of these cause architectural re-derivation — they cause *local guessing* at integration points, and one of them (player gate) is exactly where the spec's own bilateral invariant (INV-16/17) lives.

## TOP DRIFT-RISKS
1. **Live player-gate (DD-AM-06)** — pressure-handler path has no specified affordanceId mapping; likely shipped as a no-op into the dead `validatePlayerAction`, defeating the spec's central bilateral claim. *Front-loaded into P1.* (HIGH)
2. **`ctx.zoneOverridesFor` closure + per-pass hoist** — no type signature; implementer may re-scan per-affordance (kills the "oracle provably unchanged" early-out) or make it optional (silent-no-op hole DD-AM-05 forbids). (MED)
3. **`permit` scope contradiction** — test plan line 633 vs. spec line 488 disagree on whether permit lifts engine-universal gates; risk of an over-powerful permit. (MED)
4. **Execution re-gate plumbing** — `processGoalTick` doesn't currently receive `ctx`/a forbid-checker; threading is unspecified, may land at wrong layer or be skipped. (MED)
5. **M8 dependency for P4** — `onActionExecuted` exists only in specs; P4 walls without M8. Correctly flagged but absolute. (MED, managed)

## SPEC-HARDENING RECOMMENDATIONS (only the ones that materially raise fidelity)
1. **Specify the live player-gate concretely.** Add the exact `AffordanceContext`/closure signature AND name how a pressure speech-act (`threaten`/`bribe`) resolves to an `affordanceId` for `isAffordanceForbidden`. This is the single highest-leverage fix — it converts the HIGH-risk P1 item into a copy-paste. Even one worked example ("pressure `threaten` gates against affordance X via mapping Y") would close most of the gap.
2. **Give the `AffordanceContext` extension a typed signature.** e.g. `zoneOverridesFor: (locId: string) => AffordanceOverride[]` and the per-decision projected-override collection shape, so the hoist and the O(1) early-out aren't re-invented.
3. **Reconcile the `permit`-scope contradiction** between test line 633 ("lifts engine universal gates") and §2.1 line 488 ("does NOT lift period/mood/suppress"). Pick one (line 488 is the intended one) and fix line 633.
4. **Specify the `processGoalTick` re-gate threading** — state whether `ctx` (or a `(actorId, affordanceId) => boolean` checker) is added to `processGoalTick`'s argument list or the check runs in `world.ts` before the call.
5. **Fix the new INV-14 grep test** to exclude the pre-existing `world-types.ts:237` "traumatic" comment (scope to code literals / rename the comment), so P4's architecture test isn't red on arrival.

Relevant files: `C:\Ledevia\Projects\CLWA\docs\specs\SPEC-affordance-modifier.md`, `C:\Ledevia\Projects\CLWA\packages\engine\src\al.ts`, `C:\Ledevia\Projects\CLWA\packages\engine\src\beliefs.ts`, `C:\Ledevia\Projects\CLWA\packages\engine\src\attributes.ts`, `C:\Ledevia\Projects\CLWA\packages\engine\src\world.ts`, `C:\Ledevia\Projects\CLWA\packages\engine\src\perception.ts`, `C:\Ledevia\Projects\CLWA\packages\server\src\index.ts`, `C:\Ledevia\Projects\CLWA\tests\architecture.test.ts`, `C:\Ledevia\Projects\CLWA\docs\specs\SPEC-personality-plasticity.md`.