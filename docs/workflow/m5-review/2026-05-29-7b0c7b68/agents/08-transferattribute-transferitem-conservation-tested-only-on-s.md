# transferAttribute / transferItem conservation tested only on success+insufficient, not missing source agent, amount<=0, or self-transfer

- **Dimension**: tests
- **Severity**: minor · **Category**: test-gap
- **Location**: `tests/attributes.test.ts:90`
- **Adversarial verdict**: confirmed

## Issue
Good coverage of happy path and insufficient-funds no-op. But transferAttribute (world.ts:697-704) guards `!agents.has(fromId) || !agents.has(toId)` and amount<=0; the attribute test covers neither (the inventory test does cover missing-target at inventory.test.ts:89). Neither suite covers a self-transfer (from===to): transferAttribute would adjust base down then up (net zero) and transferItem remove-then-give is net no-op -- both currently unverified despite 'atomic + conserved' being a headline guarantee.

## Suggested fix
Add: transferAttribute to/from a nonexistent agent returns false and mutates nothing; transferAttribute(amount<=0) returns false; a self-transfer leaves totals unchanged for both inventory and attributes.

## Adversarial verification
Read the actual current source on feature/engine-generalization. Every factual claim holds:

1. Guards exist as described. transferAttribute (world.ts:697-704): line 698 `if (amount <= 0) return false;`, line 699 `if (!this.agents.has(fromId) || !this.agents.has(toId)) return false;`, line 700 insufficient-funds guard. So amount<=0 and missing-source/target are real, untested code paths.

2. Attribute test gap confirmed. The only transferAttribute test (attributes.test.ts:90-104) asserts exactly two cases: success (line 97, returns true, 60/40 conserved) and insufficient funds (line 101, returns false, no-op). It never exercises a missing agent, amount<=0, or a self-transfer.

3. Inventory does cover missing-target — finding's parenthetical is accurate. inventory.test.ts:89 `world.transferItem('seller', 'ghost', 'grain', 1)` asserts false (missing target no-op). But transferItem (world.ts:767-773) line 768 `quantity <= 0` and self-transfer remain untested; line 769 only guards missing target (missing source is handled implicitly via removeItem returning false on line 770, also untested).

4. Self-transfer is genuinely unverified for both. transferAttribute self-transfer would adjustAttributeBase(-amount) then (+amount) on the same agent (world.ts:701-702) → net zero; transferItem self-transfer would removeItem then giveItem on the same agent (world.ts:770-771) → net no-op. Both plausibly net-zero but never asserted, despite 'atomic + conserved' being the literal headline of both test titles (attributes.test.ts:90, inventory.test.ts:75) and the doc comments (world.ts:695, 765). Note a latent subtlety the fix would surface: adjustAttributeBase clamps at each step (world.ts:681), so when the guard passes on effective value (base+modifiers) while base alone is below amount, the intermediate down-clamp at min can lose value — a self-transfer test with a modifier-inflated attribute would expose it.

5. Exhaustive grep across tests/ (git grep transferAttribute|transferItem) returns only those 7 lines — no coverage exists elsewhere.

6. Not a pre-accepted residual: the M5 brief's known/accepted list (untyped payload keys, WS crime:scene contract, A7b shop->inventory migration) does not touch transfer-conservation test coverage.

Severity 'minor' and category 'test-gap' are correct: this is missing/weak test coverage of explicitly-advertised guarantees, not a behavior change or INV violation. Suggested fix (assert false+no-mutation for nonexistent agent and amount<=0, and net-unchanged totals for self-transfer in both suites) is sound. Only nit: the finding writes 'guards ... amount<=0' attributing both guards to the 697-704 range, which is correct, though the precise lines are 698/699/700.
