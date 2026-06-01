# SPEC 1 — Personality Plasticity: Canonical Diamond Design

## The one-line law
Personality joins the SAME deformation physics that already backs mood and ScalarAttributes: `effective = clamp(base + Σ decaying modifiers, min, max)`. ELASTIC = a decaying modifier; PLASTIC = a permanent shift of `base`. The engine does NOT invent a third physics — it routes personality through the EXISTING `ScalarAttribute` primitive (`packages/engine/src/attributes.ts`).

## The single safest decision that unlocks everything
Store trait axes in the **existing** `AgentState.attributes` map under a reserved `trait:<axis>` key namespace (and plasticity accumulators under `pp:<ruleId>`), keeping `profile.bigFive` as the **immutable seed**.

This one choice collapses the entire risk surface the code maps flagged:
- PERSISTENCE GAP (the highest risk): SOLVED with zero new code — `attributes` already round-trips through `toJSON` (`world.ts:1892`) and `loadState` with SL-07 NaN defense (`world.ts:1992-2004`). No new `WorldSaveAgentData` field, no new INV-21 branch.
- ANNEALING: free — `driftAttribute` already runs every real tick at `world.ts:592` for every attribute. The optional `anneal` knob writes the existing `ScalarAttribute.drift` field; absent = irreversible (the locked default).
- CG-gateable + scoreable: the existing `attr` CG op (`cg-engine.ts:292`) and SCORING_CONTRIBUTORS channel read these axes for free.

## No split-brain: one accessor
Add `Agent.trait(axis)` = `attributeEffective(state.attributes['trait:'+axis]) ?? profile.bigFive[map] ?? 0.5`. ALL ~17 engine + 4 module `profile.bigFive` read sites switch to it (verified list: `al.ts:451,457`, `instinct-builder.ts:205`, `volition.ts:385`, `agent.ts:267/408/524`, `cg-engine.ts:344`, `world.ts:536/578/1988`, `il.ts:626-627`, `topic-engine.ts:238-239`, `scheduler.ts:133-134`, `social/topic-sources.ts:664`, crime-justice index/step-handlers/investigation, `routes.ts`). The fallback chain makes the switch **byte-identical** until state axes are seeded.

## Open axes without breaking tsc-0
`registerTraitAxis(key,...)` is the open registry; the engine seeds OCEAN+H itself (universal psychometrics, INV-14-clean). The **closed `BigFive` interface stays** as the typed seed shape, so `keyof BigFive` typings keep compiling; module axes are reached only via the string-keyed `trait()` / CG `attr` path. `cg-engine.checkTrait` is already string-keyed and becomes the natural module-axis reader.

## The four engine knobs (law) vs module data (values)
TRIGGER (`when` incl. `abilityUse` = SPEC-2 seam) · MODE (`threshold | accumulation`) · MAGNITUDE (`step × magnitudeScale` from belief/sentiment) · REVERSIBILITY (`anneal` → drift; default irreversible). One module-agnostic evaluator runs in the EXISTING `registerTickPhaseHandler` loop (bilateral, event-aware — `event-registry.ts:670-700`). Plastic writes go through the EXISTING `adjustAttributeBase` (`world.ts:674`).

## The three seams (all thin wrappers, INV-14 preserved)
- **SPEC-2 ability-use** → `when.abilityUse` matches a use-event SPEC 2 emits; no coupling code.
- **Beliefs** → `selfBeliefConfidence` wraps `getMaxConfidenceFor(self,...)` (`beliefs.ts:82`); matcher is module-supplied; optional `emitBelief` writes via `addBelief` with a module-distinct source.
- **Relationships** → `sentimentTo` wraps `getRelationship(id).sentiment` (`relationships.ts:64`), RAW (not the crime-tuned `sentimentCurve`).
- **Enneagram** is NOT a seam: it is elastic prose keyed off live mood (`personality-prose.ts:46`); plasticity composes with it only indirectly (a plastic baseMood/stability shift changes which Enneagram band mood falls into). No double-counting, no code change.

## INV proofs
- **INV-06**: traits inherit the single-writer rule — effective is derived, never stored; elastic via `addTraitModifier`, plastic via `applyPlasticShift`→`adjustAttributeBase`. Mood machinery untouched.
- **INV-14**: only `trait:`/`pp:` prefixes and `threshold`/`accumulation` enter the engine — universal terms; the words Negation/trauma/wound/debt never appear. Triggers, matchers, self-id semantics, axis names beyond OCEAN+H are all module-supplied.
- **INV-16**: the PP evaluator iterates `ctx.agents` including the player; the player is fresh-seeded with `trait:` axes — player has plasticity and is a valid source/target. No NPC-only filter added.
- **INV-21**: old saves lack `trait:`/`pp:` keys → `trait()` falls back to the profile seed → no zeroing; empty agents stay clean via the existing omit-when-empty pattern.

## Migration ordering trap (resolved)
`trait-randomizer.ts:67` mutates `profile.bigFive` every boot. Keep it writing the seed unchanged; seed state axes FROM the seed only on FRESH boot (the attributes/factions XOR-boot pattern at `index.ts:728`); on LOADED boot, `loadState` restores axes and the seeder is skipped — so saved plastic shifts survive re-randomization.

## Phasing (additive before destructive)
P0 accessor + read-site switch (behavior-identical) → P1 state-back axes on fresh boot → P2 PlasticityRule + evaluator + World API (no rules = no change) → P3 belief/sentiment seams → P4 SPEC-2 ability-use seam. **No destructive step**: `profile.bigFive` and the `BigFive` interface are never removed (the naive "delete bigFive from profile" step is consciously rejected — keeping the seed is what makes the migration reversible and INV-21-trivial).

## Quality bar
tsc 0 after every phase (closed typings preserved); `bun test` green; crime + economy oracle unchanged through P0/P1 (zero rules registered); new `tests/plasticity.test.ts` uses a neutral synthetic domain with `clearPlasticityRules` hygiene mirroring `clearScoringContributors`.

## Files touched (all absolute)
- `C:\Ledevia\Projects\CLWA\packages\engine\src\attributes.ts` (reused as-is; drift = anneal)
- `C:\Ledevia\Projects\CLWA\packages\engine\src\agent-types.ts` (no new field — reuse `attributes`; `BigFive` kept)
- `C:\Ledevia\Projects\CLWA\packages\engine\src\agent.ts` (new `trait()` accessor)
- `C:\Ledevia\Projects\CLWA\packages\engine\src\al.ts` (read-site switch + optional scoring; `computeUtility` :447)
- `C:\Ledevia\Projects\CLWA\packages\engine\src\world.ts` (`getTrait`/`applyPlasticShift`/`addTraitModifier`/`onTraitChange`; read-site switches :536/:578)
- `C:\Ledevia\Projects\CLWA\packages\engine\src\event-registry.ts` (PlasticityRule registry + evaluator via tick-phase)
- `C:\Ledevia\Projects\CLWA\packages\engine\src\{instinct-builder,volition,personality-prose,cg-engine,il,topic-engine,scheduler}.ts` (read-site switches)
- `C:\Ledevia\Projects\CLWA\packages\server\src\index.ts` (fresh-boot trait-axis seeder, NPC + player)
- `C:\Ledevia\Projects\CLWA\packages\server\src\routes.ts` (serialize effective traits)
- `C:\Ledevia\Projects\CLWA\tests\plasticity.test.ts` (new) + extend `tests\save-load.test.ts`