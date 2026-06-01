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