# No save/load round-trip test for any Phase B state

- **Dimension**: consistency-perf
- **Severity**: minor · **Category**: test-gap
- **Location**: `tests/attributes.test.ts, tests/inventory.test.ts, tests/relationships-factions.test.ts`
- **Adversarial verdict**: confirmed

## Issue
The Phase B test files exercise World API and pure helpers but never call world.toJSON()/loadState(). save-load.test.ts was not modified. The conditional-spread serialization (world.ts:1872-1874) and the unvalidated load (1978-1980) — load-bearing new code paths — are entirely untested, including the playerState round-trip.

## Suggested fix
Add a round-trip test: set attributes (base + a timed modifier), inventory (one fungible stack + one unique state-bearing instance), and factions on an agent; toJSON → new World → loadState; assert all three survive byte-for-byte (and modifier remaining/duration preserved).

## Adversarial verification
The finding holds on every point.

(1) save-load.test.ts is NOT in the master..feature/engine-generalization diff stat — unmodified, confirmed.

(2) The three Phase B test files exercise only pure helpers + World API + CG ops + computeUtility and never serialize: `git grep -c "toJSON|loadState"` over tests/attributes.test.ts, tests/inventory.test.ts, tests/relationships-factions.test.ts returns ZERO matches. tests/attributes.test.ts:39-147, tests/inventory.test.ts:35-92, tests/relationships-factions.test.ts:37-103 contain no save/load.

(3) No incidental coverage from the existing round-trip suite. The fixture createTestWorld (tests/save-load.test.ts:84-124, makeState 60-74) sets only beliefs, one `rival` relationship (no `standing`), and one mood modifier — it never sets attributes, inventory, factions, relationship.standing, or a non-empty playerState. Therefore the new conditional-spread serialization at world.ts:1875-1877 (`...(agent.state.attributes ? { attributes: ... } : {})`, likewise factions/inventory) always takes the empty branch, and the new load guards at world.ts:1978-1980 (`if (saved.attributes) agent.state.attributes = saved.attributes;` etc.) are never executed by any test. playerState round-trip (toJSON world.ts:1907, loadState 1959) is likewise only ever exercised with the default `{}`.

(4) The cited code paths are real and load-bearing — the finding's line numbers (1872-1874 / 1978-1980) are ~3 off for the toJSON block (actual 1875-1877) but the code is verbatim as described; the load block is exactly at 1978-1980.

(5) `standing` is a genuine persisted axis (relationships.ts:15, adjustStanding 97) flowing through relationships.toJSON() — also entirely untested in round-trip, reinforcing the suggested fix to assert modifier remaining/duration and a state-bearing inventory instance survive byte-for-byte.

This is a real test gap on newly added, otherwise-untested serialization branches, not the accepted untyped-payload or shop-migration residual. The severity 'minor' is fair (Phase B is additive and the code reads correct on inspection), but the gap is concrete and the suggested fix is sound.
