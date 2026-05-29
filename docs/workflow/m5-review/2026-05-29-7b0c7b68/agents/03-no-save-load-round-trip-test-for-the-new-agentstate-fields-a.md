# No save/load round-trip test for the NEW AgentState fields (attributes/factions/inventory/standing) through World.toJSON/loadState

- **Dimension**: tests
- **Severity**: major · **Category**: save-load
- **Location**: `tests/save-load.test.ts:136`
- **Adversarial verdict**: confirmed

## Issue
World.toJSON serializes attributes/factions/inventory conditionally (world.ts:1875-1877) and loadState restores them (world.ts:1978-1980), but NO test exercises this path. createTestWorld() never sets any of these fields, so the canonical 'toJSON -> loadState -> toJSON produces identical output' test (line 136) passes VACUOUSLY: every field is undefined on both sides and the spread `...(x ? {x} : {})` omits the key in both directions. The dedicated pure-helper tests (attributes/inventory/relationships-factions) build fresh Worlds and read back from the SAME in-memory instance -- they never JSON.stringify+parse+loadState. Relationship.standing has the same gap (it rides along in getAllRelationships() but is never asserted to survive a round-trip). A regression in the loadState restore lines (e.g. dropping `if (saved.inventory)`) would NOT be caught by any test. ScalarAttribute carries min/max plus nested timed AttributeModifiers (remaining/duration) -- exactly where save bugs hide.

## Suggested fix
Add a save-load test that sets world.setAttribute('alice','gold',75,0,9999)+addAttributeModifier, world.joinFaction('alice','guild'), world.giveItem('alice','sword',1,{durability:80})+a fungible stack, and relationships.adjustStanding('bob',0.4); then toJSON -> JSON round-trip -> loadState into world2 and assert getAttribute===75, modifier survives, getFactions, countItem, item.state.durability, and standing===0.4. Also populate these in the fixture so the identical-output test stops being vacuous.

## Adversarial verification
Verified against current source on feature/engine-generalization.

SERIALIZATION PATH EXISTS AND IS CONDITIONAL (so an undefined field is simply omitted from both snapshots):
- world.ts:1875-1877 — toJSON emits `...(agent.state.attributes ? { attributes: ... } : {})`, same pattern for factions and inventory. WorldSaveAgentData (world.ts:96-98) types attributes?/factions?/inventory? as optional.
- world.ts:1978-1980 — loadState restores via `if (saved.attributes) ...`, `if (saved.factions) ...`, `if (saved.inventory) ...`. Removing any of these `if` guards or the restore line would silently drop the field on load with no failing test.

FIXTURE NEVER POPULATES THE NEW FIELDS:
- createTestWorld()/makeAgent()/makeState() (save-load.test.ts:60-124) set only alive/status/location/mood/baseMood/moodModifiers/currentDay/knownFacts/beliefs/relationships. No setAttribute/joinFaction/giveItem/adjustStanding anywhere. So the canonical "toJSON -> loadState -> toJSON produces identical output" test (save-load.test.ts:136-150) compares two snapshots that both OMIT attributes/factions/inventory entirely — it passes vacuously for these fields.

NO TEST EXERCISES THE NEW ROUND-TRIP:
- Grep of tests/save-load.test.ts for attributes|factions|inventory|standing => no matches.
- The three dedicated pure-helper tests (tests/attributes.test.ts, tests/inventory.test.ts, tests/relationships-factions.test.ts — the ONLY files referencing these primitives) contain zero references to toJSON|loadState|JSON.stringify|JSON.parse. They read back from the same in-memory World, never through serialization.
- git diff master..feature/engine-generalization --stat shows save-load.test.ts was NOT modified on the M5 branch; only the three new helper test files were added (+342 lines), none touching World save/load.

STANDING GAP CONFIRMED:
- Relationship.standing is optional (relationships.ts:13-15), set by adjustStanding (relationships.ts:94-97). RelationshipGraph.toJSON() returns the full Relationship[] (relationships.ts:120-122) and fromJSON re-adds whole objects via addRelationship (relationships.ts:48-50,125-129), so standing DOES survive a round-trip — but no test asserts it. A regression that strips standing on save/load would go uncaught.

SCALARATTRIBUTE RISK IS REAL: attributes?: Record<string, ScalarAttribute> (world.ts:96) carries base/min/max plus nested timed modifiers — exactly the nested shape where save bugs hide, and it is currently restored by a blind object assignment (`agent.state.attributes = saved.attributes`) with no test.

NOT AN ACCEPTED RESIDUAL: this is none of the documented known items (untyped event.payload, crime:scene WS contract, A7b shop->inventory migration). It is a genuine missing-test gap on net-new, conditionally-serialized save/load paths. Severity major is justified: silent data loss on load with a vacuously-green oracle. Suggested fix (populate the fixture so the identical-output test stops being vacuous, plus a dedicated round-trip asserting getAttribute, surviving modifier, getFactions, countItem, item.state, and standing) is correct.
