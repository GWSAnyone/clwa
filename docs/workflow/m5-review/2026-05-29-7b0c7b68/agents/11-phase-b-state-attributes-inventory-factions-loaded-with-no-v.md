# Phase B state (attributes/inventory/factions) loaded with no validation — double standard vs SL-07

- **Dimension**: consistency-perf
- **Severity**: major · **Category**: save-load
- **Location**: `packages/engine/src/world.ts:1978-1980`
- **Adversarial verdict**: confirmed

## Issue
moodModifiers are filtered on load for finite magnitude/remaining (world.ts:1976-1977, the SL-07 invariant). The new attributes/factions/inventory are assigned raw from save JSON with no NaN/Infinity guard on attribute.base or modifier magnitudes and no clamp re-validation. A corrupted or hand-edited save with NaN in an attribute base propagates through attributeEffective (clamp(NaN)=NaN) and the decay loop never repairs it. This is the exact double standard the project disallows for new conserved-state primitives.

## Suggested fix
Apply the SL-07 finite-filter on load: drop attribute modifiers with non-finite magnitude/remaining, coerce/clamp attribute.base into [min,max] (re-run createAttribute clamp), and validate inventory quantities are finite positive integers.

## Adversarial verification — Phase B state (attributes/inventory/factions) loaded with no SL-07 finite/clamp validation — double standard vs moodModifiers
Mechanism verified against current source on feature/engine-generalization.

ASYMMETRY (the double standard): world.ts:1973-1977 applies SL-07 load validation to mood state — `agent.state.mood = Math.max(-1, Math.min(1, saved.mood))` (clamp) and `moodModifiers = (saved.moodModifiers ?? []).filter(m => Number.isFinite(m?.magnitude) && Number.isFinite(m?.remaining))` (finite filter), under the explicit comment "Validate numeric ranges on load (SL-07)". The immediately following lines world.ts:1978-1980 assign the new Phase B primitives raw: `if (saved.attributes) agent.state.attributes = saved.attributes; if (saved.factions) agent.state.factions = saved.factions; if (saved.inventory) agent.state.inventory = saved.inventory;` — no finite guard, no clamp re-validation, no positive-integer check.

NaN PROPAGATION CONFIRMED: attributes.ts:40-42 `clamp(n,min,max)=Math.max(min,Math.min(max,n))`; with n=NaN, Math.min(max,NaN)=NaN → Math.max(min,NaN)=NaN. So attributeEffective (attributes.ts:49-53) returns NaN for a NaN base. The decay loop decayAttribute (attributes.ts:56-64) mutates only m.remaining and never touches attr.base, and the per-tick caller world.ts:557-558 (`for (const key in agent.state.attributes) decayAttribute(...)`) likewise never repairs base — so a NaN base persists indefinitely, exactly as the finding states. attributeEffective also feeds CG op 'attr' and the scoring-contributor channel, so NaN leaks into utility/rule evaluation.

The primitive is explicitly the generalized MoodModifier (attributes.ts:1-8 "Generalizes the MoodModifier pattern... clamped"), so the SL-07 reasoning transfers directly and was simply not carried over. World writers clamp on the way in (createAttribute attributes.ts:45; setAttribute world.ts:670; adjustAttributeBase world.ts:681) but addAttributeModifier (world.ts:692) pushes mod with NO finite check — unlike mood's addModifier which guards at world.ts:616 — so even a non-corrupt runtime path can write a non-finite attribute modifier that then survives save/load unfiltered. relationships.ts standing/sentiment/trust and inventory.ts quantity have the same raw-load exposure (RelationshipGraph.fromJSON relationships.ts:125-131 stores rels verbatim; inventory assigned raw).

NOT AN ACCEPTED RESIDUAL: the task's known/accepted list is untyped payload keys, the WS crime:scene contract, and the A7b shop→inventory migration — load-time validation of Phase B state is not among them. CLAUDE.md rule #7 "No Double Standards" and the user's memory rule ("default is VIOLATION") make this a tracked violation, not a non-issue.

TEST GAP CORROBORATES: save-load.test.ts has zero round-trip coverage for attributes/inventory/factions and no corrupted-load (NaN/Infinity) test for any field — the SL-07 filter itself is untested.

Severity nuance (honest adversarial discount): in the current regression-oracle crime game these three fields are unused, so there is NO behavior change vs the crime game and no live bug — a NaN base requires a corrupted/hand-edited save or the unguarded addAttributeModifier path. So "major" overstates live impact; "minor/robustness + test gap" is more accurate. But the finding's core claim — an unvalidated load asymmetry that is the exact double standard the project disallows for a new conserved-state primitive — holds with concrete file:line evidence. Suggested fix (drop non-finite attribute modifiers, re-clamp attr.base into [min,max] via createAttribute, validate inventory quantities as finite positive integers) is correct and proportionate.
