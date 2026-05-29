# No save/load round-trip test for attributes, factions, and inventory

- **Dimension**: invariants
- **Severity**: minor · **Category**: test-gap
- **Location**: `tests/attributes.test.ts:1`
- **Adversarial verdict**: confirmed

## Issue
The B1/B2/B3 test files (attributes.test.ts, inventory.test.ts, relationships-factions.test.ts) thoroughly test API correctness and CG integration but do NOT include an explicit test that exercises World.toJSON() -> World.loadState() -> verify attributes/factions/inventory survive the round-trip with correct values. Mood modifiers have this coverage implicitly via existing save-load tests, but the new primitives lack it. A serialization regression (e.g. optional field omission) would go undetected.

## Suggested fix
Add a 'save-load round-trip' describe block to each test file: create world with attributes/factions/inventory, call world.toJSON(), create a new world, call loadState, assert values match. Include at least one attribute with active modifiers to verify modifier persistence.

## Adversarial verification
CONFIRMED. Read all three B-test files in full: attributes.test.ts, inventory.test.ts, relationships-factions.test.ts. None contains any `world.toJSON()`/`loadState` round-trip — they only test pure helpers, the World API, and the CG `attr`/`faction` ops. Grep across tests/ proves the disjointness: the files that call toJSON/loadState are {save-load, investigation, position-movement}; the files that set attributes/factions/inventory/standing are {attributes, inventory, relationships-factions}. Zero overlap, and investigation.test.ts + position-movement.test.ts have no matches for attribute/inventory/faction/standing at all.

The existing save-load.test.ts (read in full) covers beliefs, relationships (only sentiment/trust at lines 174-177 — NOT the new `standing` axis), moodModifiers, alive/status/location, gameMinute/tickCount, cooldowns, and VectorMemory. Its createTestWorld() (lines 84-124) never sets attributes, factions, inventory, or standing, so the `toJSON → loadState → toJSON` identity test (lines 136-150) passes vacuously for the new primitives.

This is NOT a phantom gap: the serialization code genuinely exists and would be the thing under test. world.ts:1875-1877 conditionally spreads attributes/factions/inventory into the snapshot (omitted when absent); world.ts:1978-1980 conditionally reapplies them on load; relationships.ts:13-15 declares `standing?` and toJSON (relationships.ts:120-121) returns full objects so standing round-trips. Because all four are persisted via brittle conditional spreads / optional fields, a regression (dropping a conditional, or a new field on ScalarAttribute/Item/Relationship not being serialized) would pass tsc and the entire 249-test suite undetected.

Not the accepted/known residual — the known list (untyped payload keys, WS crime:scene contract, A7b shop→inventory migration) does not include this. Severity minor is appropriate: code currently works; the gap is purely a missing regression guard. The suggested fix (a 'save-load round-trip' describe block per file, including an attribute with active modifiers to verify modifier persistence) is sound and directly addresses the brittleness.
