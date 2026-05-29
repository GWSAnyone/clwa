# Attribute decay uses for...in on a plain object (prototype pollution risk)

- **Dimension**: invariants
- **Severity**: minor · **Category**: consistency
- **Location**: `packages/engine/src/world.ts:558`
- **Adversarial verdict**: confirmed

## Issue
`for (const key in agent.state.attributes) decayAttribute(...)` uses for...in which iterates inherited prototype properties. While agent.state.attributes is created as a plain `{}` literal (safe in practice), this is inconsistent with the rest of the codebase which uses `for...of Object.entries/keys` or Map iteration. If any library or polyfill ever modifies Object.prototype, this becomes a real bug.

## Suggested fix
Replace with `for (const key of Object.keys(agent.state.attributes))` or use `Object.values` if the key isn't needed.

## Adversarial verification — Attribute decay uses for...in on a plain object (consistency wart, prototype-pollution framing overstated)
Verified against current source on feature/engine-generalization. world.ts:558 reads `for (const key in agent.state.attributes) decayAttribute(agent.state.attributes[key], 5);` — exactly as cited. A Grep for `for (const X in ...)` across all of packages/ returns this as the SOLE hit, so the "inconsistent with the rest of the codebase" claim is accurate: world.ts otherwise uses Object.entries/keys/values (5 occurrences) and Map iteration (`for (const [, agent] of this.agents)`). The claim that `attributes` is a plain `{}` literal is correct — it is created via `agent.state.attributes = {}` at world.ts:669/678/689 and assigned from JSON.parse output on load at world.ts:1978; both carry only the standard Object.prototype (no enumerable own props), so the loop is functionally safe today. This is therefore a genuine, correctly-scoped MINOR consistency/naming wart at a real location, and it is NOT on the known/accepted residual list. Caveat: the "prototype pollution risk / real bug" justification is overstated — there is no polyfill or dependency mutating Object.prototype in this Bun runtime, and were one to exist that would be the bug, not this loop; the loop iterates a typed `Record<string, ScalarAttribute>`. It is also purely additive B1 state, unused by the crime game, so there is no behavior change vs the regression oracle and no save/load or per-tick hazard introduced. The suggested fix (`for (const key of Object.keys(...))`) is correct and trivial. Confirmed on the consistency merits; the security framing should be discounted.
