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