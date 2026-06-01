# Adversarial Stress: SAVE/LOAD + World-Editor + INV-21

Lens applied to BOTH specs. I read the real code (world.ts toJSON/loadState, attributes.ts, agent-types.ts, server index.ts boot path, trait-randomizer.ts, world-loader.ts, world-editor server.ts + app.js, save-load.test.ts, al.ts gates, cg-engine.ts, genre/architecture tests). Verdict: the specs are largely sound on persistence REUSE, but three MUST-FIX issues center on the actual fresh-vs-loaded boot sequencing, which the specs describe inaccurately.

## What the specs got RIGHT (verified)
- Reusing `AgentState.attributes` for trait axes genuinely gives free round-trip: toJSON omit-when-empty (world.ts:1892), loadState SL-07 finite-filter + createAttribute re-clamp + drift preservation (world.ts:1992-2004) all already exist. INV-21 fallback (`if (saved.attributes)`) is real.
- World-editor edits ONLY the seed: server.ts:152 writes NPC JSON verbatim; app.js:376 edits `data.personality[O..H]`; world-loader.ts:229-235 maps `personality.{O..H}` → `profile.bigFive`. The editor never touches live state — SPEC-1's seed≠state claim holds. No editor change needed for v1.
- SPEC-2's pre-target shared-gate decision (DEC-2) is correct: validatePlayerAction (al.ts:510-536) re-implements requirement iteration and never calls checkPostTargetRequirements, so a post-target override WOULD skip the player. A pre-target shared `isAffordanceForbidden` is the right call. `buildAffordanceContext` (world.ts:1772) is a World method, so the proposed `ctx.zoneOverridesFor` closure has a clean wiring point.
- New engine literals (`trait:`,`pp:`,`forbid`,`permit`,`threshold`,`accumulation`) do NOT trip the architecture INV-14 grep, which targets crime nouns (architecture.test.ts:123/206). Adding a `Negation/trauma/wound/debt` grep is additive and sound. SPEC-1 plastic writes go through adjustAttributeBase (world.ts:674), not `.mood =`, so INV-06's mood-mutation guard (architecture.test.ts:278) is not tripped.

## The core defect (MUST-FIX #1 & #2): the 'XOR-boot' story is wrong
The spec repeatedly claims trait axes are 'seeded on FRESH boot, the fresh-seeder is SKIPPED on load'. That skip does not exist. The attributes/factions seeder (index.ts:728-742) is inside `createGameContext`, which runs on EVERY boot, fresh or loaded. The only reason loaded state survives is that `loadState` does a FULL REPLACEMENT of `agent.state.attributes` (world.ts:2004) — but ONLY `if (saved.attributes)` is present. Consequences:
- NEW save with shifted `trait:N`: survives (full replace). OK.
- OLD save with `attributes:{gold}` (no trait keys): the freshly-seeded trait axes are WIPED by the full replace → agent falls back to profile seed (reads OK) but is now state-less for traits.
- OLD save with NO attributes (bob): `if (saved.attributes)` is false → block skipped → bob KEEPS its seeded trait axes.
Net: two agents in the same loaded old save end up in DIFFERENT representations (state-backed vs seed-fallback). Not corruption (fallback saves reads) but an inconsistency the spec's design did not anticipate. Fix by choosing ONE canonical representation and enforcing it post-load (merge-seed missing engine axes, OR never eager-seed and rely on the accessor fallback as single source).

## SPEC-2 persistence gaps
- zoneStates restore needs an explicit `this.zoneStates.clear()` before rebuild (every other loadState collection clears first — world.ts:1938/1954); otherwise a boot-seeded zone absent from the save survives as a ghost. (MUST-FIX #4)
- Cross-agent overrides stored on a source that is dead/absent after load can still gate the target until decay; lifecycle on source-death/load is unspecified. (SHOULD-FIX)
- `validatePlayerAction` has NO live caller — the player affordance gate the bilateral proof depends on is dormant at runtime today; overrides round-trip but never gate a player action. (SHOULD-FIX)

## Reserved-namespace collision (SHOULD-FIX)
Authored NPC `attributes` keys flow verbatim through world-loader.ts:286 → index.ts:729 `setAttribute`. An author can write `\"trait:O\"` or `\"pp:x\"` in JSON (editor allows free-text open keys) and clobber engine plasticity axes. Spec must reserve the prefixes (boot-seeder skip + world-data test).

## Round-trip test exposure (MUST-FIX #3)
Keep trait-axis seeding out of the engine Agent constructor/makeState (seed only in server boot) so save-load.test.ts agents (built directly, never seeded) stay byte-identical and the 'empty bob round-trips cleanly' test (save-load.test.ts:327) keeps passing. Add Phase-1 tests for seeded-axis round-trip + unseeded-agent emptiness + old-save (gold-only) load.