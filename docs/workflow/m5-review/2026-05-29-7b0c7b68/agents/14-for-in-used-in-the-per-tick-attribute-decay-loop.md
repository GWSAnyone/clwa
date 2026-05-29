# for...in used in the per-tick attribute decay loop

- **Dimension**: consistency-perf
- **Severity**: minor · **Category**: perf
- **Location**: `packages/engine/src/world.ts:558`
- **Adversarial verdict**: confirmed

## Issue
The decay loop uses `for (const key in agent.state.attributes)` — the only for...in in the engine. It is the slower idiom (prototype-chain enumeration) and stylistically inconsistent with the codebase's for...of/index loops. Guarded by an existence check so zero-cost for the crime game, but it is on the per-agent-per-5-game-minute hot path for attribute-using modules.

## Suggested fix
Iterate `for (const attr of Object.values(agent.state.attributes)) decayAttribute(attr, 5)`, or store attributes as a Map for the hot path.

## Adversarial verification
Verified every sub-claim against current source on feature/engine-generalization.

1. The loop exists verbatim. world.ts:558 — `for (const key in agent.state.attributes) decayAttribute(agent.state.attributes[key], 5);` inside `_computeMoodTick` step 4 (lines 556-559).

2. It is the ONLY for...in in the engine. Grep for `for (const \w+ in ` across packages/engine/src returned exactly one hit (world.ts:558). The codebase otherwise uses for...of / reverse-index loops — e.g. world.ts:519 (`for (let i = mods.length-1...`), world.ts:533 (`for (const rel of ...)`), world.ts:553 (`for (const m of mods)`), attributes.ts:51 and 57. So the stylistic-inconsistency claim holds.

3. It is on the hot path. `_computeMoodTick` is invoked from `_tickMoodSystem` (world.ts:575), which loops over every agent (world.ts:567 `for (const [, agent] of this.agents)`), and `_tickMoodSystem` runs every 5 game minutes via the master clock guard `if (this._gameMinute % 5 === 0)` (world.ts:388-390). The doc comment at world.ts:502 confirms "Called every 5 game minutes." So "per-agent-per-5-game-minute hot path" is accurate.

4. Guarded / zero-cost for crime game. Line 557 `if (agent.state.attributes)` — the crime game declares no attributes, so the property is absent/undefined and the loop body never executes. Correct.

5. attributes is a plain object, not a Map. attributes.ts:67 types it `Record<string, ScalarAttribute>`, so `for...in` enumerates string keys (and would walk the prototype chain in general), and `decayAttribute` (attributes.ts:56-64) is the per-modifier inner loop. The suggested fix `for (const attr of Object.values(agent.state.attributes)) decayAttribute(attr, 5)` is behaviorally equivalent and avoids the prototype-chain idiom.

Caveats on severity (this is genuinely minor, as the finding itself states): the object is created via object literals (createAttribute / save-load), so no enumerable prototype pollution exists in practice, and the loop is fully skipped for the crime game — there is no measurable perf regression today. The finding is real as a naming/consistency wart plus a latent micro-perf idiom on the hot path for future attribute-using modules, which is exactly the (minor) bar the finding claims. Confirmed on its own terms.
