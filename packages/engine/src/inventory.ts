/**
 * Inventory / item-instance subsystem (M5 Phase B / B2) — conserved, ownable, transferable goods.
 *
 * Complements the scalar-attribute layer (B1: fungible value like gold) with discrete item instances.
 * `kind` is a free string the engine assigns no meaning to (module-defined: weapon / food / coin /
 * contraband / letter). Backs real trade/theft/loot/crafting — a step that "steals goods" now moves
 * actual conserved state instead of only emitting an event. INV-14: no domain item names in the engine.
 */

export interface Item {
  id: string;
  /** Module-defined item kind (free string). */
  kind: string;
  /** Stack size for fungible kinds; 1 for unique state-bearing instances. */
  quantity: number;
  /** Optional module-defined per-instance state (durability, owner-mark, enchantment…). */
  state?: Record<string, unknown>;
}

/** Total quantity of a kind across an inventory (sums fungible stacks + unique instances). */
export function countItems(inventory: Item[] | undefined, kind: string): number {
  if (!inventory) return 0;
  let total = 0;
  for (const it of inventory) if (it.kind === kind) total += it.quantity;
  return total;
}

/** Add `quantity` of a fungible kind (stacks into an existing stateless stack), or push a unique
 *  state-bearing instance. Returns the affected Item. */
export function addItem(inventory: Item[], kind: string, quantity = 1, state?: Record<string, unknown>): Item {
  if (!state) {
    const existing = inventory.find((it) => it.kind === kind && it.state === undefined);
    if (existing) { existing.quantity += quantity; return existing; }
  }
  const item: Item = { id: crypto.randomUUID(), kind, quantity, ...(state ? { state } : {}) };
  inventory.push(item);
  return item;
}

/** Remove `quantity` of a fungible kind across stacks. Returns false (no-op) if the total is insufficient. */
export function removeItems(inventory: Item[], kind: string, quantity = 1): boolean {
  if (quantity <= 0) return false;
  if (countItems(inventory, kind) < quantity) return false;
  let remaining = quantity;
  for (let i = inventory.length - 1; i >= 0 && remaining > 0; i--) {
    const it = inventory[i];
    if (it.kind !== kind) continue;
    const take = Math.min(it.quantity, remaining);
    it.quantity -= take;
    remaining -= take;
    if (it.quantity <= 0) inventory.splice(i, 1);
  }
  return true;
}
