# Workflow: Personality Plasticity + Affordance-Space Modifier — design synthesis

> Run `wf_e4ece4bf-8d2` · 2026-06-01 · 22 agents · see `agents/` for every agent report, `raw.json` for the full return.

## Synthesis — Personality Plasticity

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

---

## Synthesis — Affordance-Space Modifier

# SPEC 2 — Affordance-Space Modifier: Canonical Diamond Design

## What this is
A genre-neutral engine primitive: an agent's or a zone's STATE can override the SET OF POSSIBLE ACTIONS for a target (self / another agent / a zone of co-present agents), as pure registered data. The engine evaluates these through the SAME requirement gate that already governs NPC and player actions. The engine never contains the words Negation/trauma/wound/debt — those are module data.

## Code-grounded findings (verified against source)
- **Single bilateral gate exists already, but is split**: `checkRequirements` (al.ts:304) and `validatePlayerAction` (al.ts:510) both iterate `REQUIREMENT_CHECKERS`, but `validatePlayerAction` does NOT call `checkPostTargetRequirements` (al.ts:323). So the override gate MUST be a shared *pre-target* engine function (`isAffordanceForbidden`) called by both paths + the reactive path — never a post-target checker. This is the linchpin of bilateral parity (INV-16/17).
- **No zone carrier exists**: `LocationDef` (world-types.ts:24) is static config (id/name/connections/isPublic), held as `readonly locations: LocationGraph` (world.ts:126), not iterated by the tick loop. A zone-as-active-object needs a NEW parallel `World.zoneStates: Map<locationId, ZoneState>`, reusing the `ScalarAttribute` primitive (attributes.ts) so zones get the same deformation math as agents with zero new physics.
- **Deformation/lifecycle idiom is reusable verbatim**: `AttributeModifier`/`MoodModifier` share an identical remaining/duration/decay model and a splice-on-expiry decay (attributes.ts:61, world.ts:592). Overrides reuse this exact idiom — no new lifecycle machinery.
- **Tick loop is bilateral** (world.ts:561 iterates all agents incl. player): override decay hooks here for agents; zones need a separate small loop (not agents).
- **Scoring vs gate are physically separate** (computeUtility al.ts:447 is gate-independent): possibility-toggling rides the binary requirement gate; strength scaling rides `registerScoringContributor` (al.ts:439). Conflating them is the central error avoided (DEC-1).
- **Strength-scaling reads exist**: `beliefs.getMaxConfidenceFor` (beliefs.ts:82, floor 0.1 at :115), raw `relationships.getRelationship().sentiment`, `getAttributeValue` (attributes.ts:94). Module supplies the keys; engine stays neutral (INV-14).

## Design in one line (engine law)
Forbid/permit overrides on agent-or-zone STATE re-shape the possible set for a target through one shared pre-target gate; possibility is binary, attractiveness is continuous, the two never mix; using an override may trigger a permanent plasticity shift via an opaque forwarded blob (SPEC-1 seam).

## Invariant proof
- **INV-06** (mood single-writer): untouched — overrides are a separate carrier; no direct mood mutation.
- **INV-14** (engine/module boundary): override records carry only module strings (source/category/match); the engine evaluates structure, never vocabulary; `plasticityTrigger` is opaque. Architecture test greps engine for forbidden strings + a synthetic-module probe.
- **INV-16/17** (bilateral): ONE `isAffordanceForbidden` consulted by NPC, reactive, AND player paths → no split-brain; player is fully gateable as override target.
- **INV-21** (default-on-load): all new fields optional; old saves load to empty → zero behavior change; omit-when-empty keeps the identical-output round-trip test green.

## Phasing (each independently tsc-0, test-green)
1. Gate + agent self-override (realizes Type-I). 2. Strength scaling + scoring. 3. Zone carrier (ZoneState, reused ScalarAttribute). 4. Cross-agent + plasticity seam (realizes Type-II + SPEC-1 bridge).

## Conflicts resolved
10 numbered decisions (DEC-1..10). Key ones: gate-vs-score separation (DEC-1); engine-owned universal gate not a module checker (DEC-2); store-on-source / evaluate-on-target (DEC-3); specificity precedence, fail-closed on ties (DEC-4); permit scope bounded to possibility space, not requirement-nullification (DEC-5); gate runs reactively too (DEC-6); zone as parallel state store, not Agent and not on LocationDef (DEC-9); plasticity via opaque one-way callback (DEC-10).

## Module-realizability
The Negation world is fully expressible after Phase 4 as pure module data: Type I = self `permit` override + `plasticityTrigger`; Type II = cross-agent/zone `forbid` with `strengthScale.fromSelfBelief`/`fromSentimentToTarget`; 'no one does both' = a module rule about which overrides carry triggers vs scales. Engine contains zero Negation/trauma vocabulary.

## Files touched (paths)
- NEW: C:\Ledevia\Projects\CLWA\packages\engine\src\affordance-modifier.ts
- EDIT: packages\engine\src\al.ts (tags field; 3× isAffordanceForbidden insertion; reason string)
- EDIT: packages\engine\src\agent-types.ts (AgentState.affordanceOverrides; ZoneState)
- EDIT: packages\engine\src\world.ts (zoneStates map + World API; tick decay; toJSON/loadState; WorldSaveAgentData/WorldSaveData; onAffordanceOverrideUsed)
- REUSE (unchanged): attributes.ts, beliefs.ts, relationships.ts, perception.ts, event-registry.ts