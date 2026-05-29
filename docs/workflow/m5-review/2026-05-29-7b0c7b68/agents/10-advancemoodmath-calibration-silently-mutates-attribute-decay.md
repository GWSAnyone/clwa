# advanceMoodMath calibration silently mutates attribute decay timers

- **Dimension**: consistency-perf
- **Severity**: major · **Category**: behavior-change
- **Location**: `packages/engine/src/world.ts:556-559`
- **Adversarial verdict**: confirmed

## Issue
decayAttribute was added to _computeMoodTick, which is shared between the real tick (_tickMoodSystem) and advanceMoodMath (world.ts:790), a pure calibration what-if helper exposed at debug route routes.ts:1000 and documented 'Advance mood math only... not behavior testing'. advanceMoodMath loops `ticks` times, so each call now ages every agent's attribute modifiers and drops expired ones — mutating real conserved state during a simulation. Latent for the crime game (no attributes), but any attribute-using module's HP/needs/buffs get silently decayed by hitting the calibration endpoint.

## Suggested fix
Move the attribute-decay step out of _computeMoodTick into _tickMoodSystem only (the real-tick path), so the 'mood math only' calibration helper stays side-effect-free on the new Phase B state.

## Adversarial verification — advanceMoodMath calibration silently decays attribute modifiers (B1 conserved state)
All concrete claims verified against current source on feature/engine-generalization.

1. The attribute-decay step is in the SHARED helper. world.ts:556-559 (_computeMoodTick): `if (agent.state.attributes) { for (const key in agent.state.attributes) decayAttribute(agent.state.attributes[key], 5); }`. git diff master..feature shows this block was *added* by M5 (the diff hunk at @@ -545 shows the three new lines appended after the mood computation).

2. The calibration helper calls that shared helper in a loop over real state. world.ts:790 advanceMoodMath; line 797 iterates `this.agents.entries()` (the live agents, no clone); line 800 `const before = agent.state.mood`; lines 803-805 `for (let t = 0; t < ticks; t++) { this._computeMoodTick(agent, ms); curve.push(agent.state.mood); }`. So each of `ticks = Math.floor(minutes/5)` iterations runs the attribute decay against the live agent object.

3. decayAttribute mutates conserved state irreversibly. attributes.ts:56-64: decrements `m.remaining -= dtMinutes` (line 60) and `attr.modifiers.splice(i,1)` on expiry (line 61). Unlike mood (which drifts back toward equilibrium and is clamped), an expired/spliced attribute modifier — a wound debuff, HP-regen tick, buff, decaying need — is permanently consumed.

4. The endpoint is exactly the documented calibration what-if. routes.ts:1000 `world.advanceMoodMath(body.minutes, body.npcId)`; routes.ts:1002 warning: 'Mood math only. No LLM, conversations, or events processed. Use for calibration, not behavior testing.' Calling it nonetheless ages real Phase B state.

5. No test guards this: Grep for advanceMoodMath/advance-mood/decayAttribute across *.test.ts returns no matches; decayAttribute has exactly one call site (world.ts:558). The 249 green tests do not cover the interaction.

Counter-argument considered and rejected as non-negating: I checked master (git show master:.../world.ts) — advanceMoodMath ALREADY called the shared _computeMoodTick (master line 675) and that helper already mutated live mood (modifier splice + social-stress drift + agent.state.mood) on the real agent. So "calibration mutates live state" is a pre-existing property for the mood subsystem and is NOT newly introduced by M5. However the finding's substantive harm IS new: M5 extended the side-effect to a distinct, non-self-correcting class of conserved state (B1 attributes). The finding correctly scopes this as latent for the crime game (INV-14: no attributes there) and a real hazard for any attribute-using module. The leak is real (a debug 'mood math' route now ages economy/combat/needs state) and the suggested fix — hoist the decay loop out of _computeMoodTick into _tickMoodSystem (the real-tick path only) — is correct and minimal; the loneliness step at world.ts:577-586 already establishes the precedent of real-tick-only logic living in _tickMoodSystem rather than the shared helper.

Severity 'major' is defensible (silent conserved-state corruption via a debug route advertised as side-effect-free), though it is latent until an attribute module ships.
