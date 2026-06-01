# Adversarial Stress Test — Lens: MOOD &lt;-&gt; PLASTICITY coexistence + INV-06

## Verdict
INV-06 itself is **NOT broken** by the design — and that is partly because the design quietly *backs away* from real unification. The spec's DD-PP-02 explicitly **does not** migrate mood onto ScalarAttribute; mood keeps its own `baseMood + Σ MoodModifier` machinery (world.ts:507-554), and personality joins a *separate* `trait:` ScalarAttribute namespace. So there is no new direct `agent.state.mood` write, no third deformation physics. The "ONE deformation physics" claim in the brief is satisfied only by **analogy/reuse**, not by literal unification — which is the safe call, but the spec oversells it.

The real damage is in the **seam between the two stores**, and it is significant.

## The core problem: `baseMood` is an orphaned third disposition store
`baseMood` (agent-types.ts:149) is documented as `0.3 - N×0.4 + E×0.2` — i.e. it **is** a trait-derived permanent baseline. But:
- It is a **raw `number`**, not a `ScalarAttribute` — so `applyPlasticShift` (which only writes `trait:`/`pp:` keys via `adjustAttributeBase`) **cannot touch it**.
- It is **seeded once** from the SEED (`index.ts:302`, load-fallback `world.ts:1988`) and **never recomputed** from effective traits.
- DD-PP-09 **deliberately freezes** it on the seed to avoid double-counting.

Consequence: the headline use-case — "lived trauma permanently raises neuroticism, so the agent is permanently gloomier" — is a **silent no-op on mood**. Shifting `trait:N` moves the AL personality channel (al.ts:451) and *maybe* the live social-stress `ps` factor (world.ts:536, if migrated), but **not the mood baseline**. The agent's *resting* mood is unchanged. The spec papers over this with "a module wires N→baseMood explicitly" and specifies no mechanism. This is MUST-FIX #1 and #2.

## The split-brain the spec claims to have killed, reborn inside mood
The single-accessor `trait()` design genuinely prevents split-brain *across* read sites. But `_computeMoodTick` reads `profile.bigFive` **live every tick** for social-stress (`ps = N*1.5 + (1-A)*0.5 + (1-H)*0.3`, world.ts:536) and loneliness reads `bigFive.extraversion` (world.ts:578); `moodCurve` reads `bigFive.honesty` (al.ts:457). The migration list says switch these to `trait()`. If they switch but `baseMood` stays seed-frozen, then **within a single mood computation** the baseline reads frozen-N and the pressure terms read deformed-N — a real split-brain. Either unify (one N everywhere, with the coupling formula written down) or deliberately split temperament(seed)-vs-character(deformed) and **document it**. SHOULD-FIX #4.

## Elastic/plastic boundary is NOT unambiguous on a shared axis
The spec puts BOTH `addTraitModifier` (elastic, decaying) AND `applyPlasticShift` (plastic, base set) on the same `trait:` axis, PLUS `anneal` (drift the base back). `anneal` writes `ScalarAttribute.drift`, which is an **axis-global single field** (attributes.ts:35) applied unconditionally by `driftAttribute` (attributes.ts:76). So (a) a long-duration elastic modifier and an annealing plastic shift are observationally identical with no rule for which to use, and (b) two plastic shifts with different `anneal.toward` on one axis silently overwrite/compound. The regime boundary needs to be stated as a hard rule and `anneal` belongs on `TraitAxisDef`, not per-shift. SHOULD-FIX #3.

## Factual correction the spec author must absorb
`advanceMoodMath` (world.ts:806) **writes `agent.state.mood`** every tick — it is side-effect-free of *attribute decay* only, NOT of mood (the world.ts:551-553 comment is narrowly about attributes). The spec's DD-PP-02 rationale ("side-effect-free calibration helper") is imprecise and, once `_computeMoodTick` reads deformed `trait()`, calibration silently starts folding plastic shifts into the curve AND leaves them written into `state.mood`. SHOULD-FIX #5.

## What holds up
- INV-06 single-writer discipline is preserved: mood stays computed; plastic writes go through `adjustAttributeBase` (world.ts:674), elastic through `addAttributeModifier` — both finite-guarded, both clamped. No new direct mood mutation. 
- Reuse of the existing decay/drift loop (world.ts:592) and the attributes save/load path (world.ts:1992-2004) is correctly identified and genuinely zero-new-physics for the `trait:` axes.
- `'trait:'` key prefix does not collide with the existing TS `trait:` field names in al.ts:33/134 (those are object-field names, not Record keys).

## Priority order for the author
1. (MUST) Define the `trait → baseMood` coupling mechanism or explicitly decouple — currently the flagship feature is a mood no-op.
2. (MUST) Give `baseMood` a legal plastic path (migrate it into a reserved attribute key, or add `applyPlasticBaseMoodShift`).
3. (SHOULD) Nail the elastic/plastic/anneal regime rules; move `anneal` to the axis def.
4. (SHOULD) Pin which version of each trait the mood terms read; fix the "side-effect-free" rationale.
5. (NICE) Forbid modifiers/drift on `pp:` accumulators.