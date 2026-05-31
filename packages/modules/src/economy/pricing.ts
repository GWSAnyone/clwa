import { registerTickPhaseHandler, createAttribute, getAttributeValue, removeItems, hasCapability } from '@clwa/engine';
import type { Agent } from '@clwa/engine';

/**
 * Dynamic pricing + needs (M7 P4) — both ride the E1 attribute-drift primitive: the engine's per-tick
 * driftAttribute() moves `base` toward a target, this module only sets the target/rate. Pure module content.
 *   - price:KIND attribute per merchant — drift.toward = supply-driven market price (scarcer → pricier).
 *   - hunger attribute per agent — drifts UP toward 1 (need pressure); eating food resets it.
 */

export const BASE_PRICE = 5;
/** Module-defined edible kinds (v1 — a proper `edible` item property is deferred). Eating one satisfies hunger. */
const FOOD_KINDS = new Set(['bread', 'herb_calm', 'tea_fortune', 'potion_heal', 'antidote', 'potion_minor', 'spice_valdris']);
const HUNGER_RATE = 0.0005;   // exp approach toward 1 — reaches ~0.5 over a game-day (1440 min)
const HUNGER_EAT_DROP = 0.6;  // eating drops hunger by this
const EAT_THRESHOLD = 0.5;    // eat once hunger crosses this
const PRICE_RATE = 0.02;      // price approaches its supply target over a few hours
const PRICE_TICK_MIN = 30;    // recompute supply→price every 30 game-min

/** Supply-driven market price target: scarcer = pricier. supply 0 → ~3× base; supply ≥ ~33 → 0.6× base floor. */
export function computePriceTarget(supply: number): number {
  const factor = Math.max(0.6, Math.min(3, 1 + (10 - supply) * 0.12));
  return +(BASE_PRICE * factor).toFixed(2);
}

/** Current unit price a seller charges for a kind — its drifting price:KIND attribute, else the base price. */
export function getPrice(seller: Agent, kind: string): number {
  const v = getAttributeValue(seller.state.attributes, `price:${kind}`);
  return v !== undefined && v > 0 ? Math.round(v) : BASE_PRICE;
}

export function registerEconomyTickHandlers(): void {
  registerTickPhaseHandler(async (ctx) => {
    // ── Needs: hunger drifts UP via E1 (set drift once; the engine tick moves base). Eat when hungry + has
    //    food. INV-16 bilateral — applies to every agent (player gets hungry too). ──
    for (const [, agent] of ctx.agents) {
      if (!agent.state.alive) continue;
      if (!agent.state.attributes) agent.state.attributes = {};
      let hunger = agent.state.attributes['hunger'];
      if (!hunger) { hunger = createAttribute(0, 0, 1); agent.state.attributes['hunger'] = hunger; }
      if (!hunger.drift) hunger.drift = { ratePerMinute: HUNGER_RATE, toward: 1 };
      if (hunger.base >= EAT_THRESHOLD && agent.state.inventory) {
        const food = agent.state.inventory.find((it) => it.quantity > 0 && FOOD_KINDS.has(it.kind));
        if (food && removeItems(agent.state.inventory, food.kind, 1)) {
          hunger.base = Math.max(0, hunger.base - HUNGER_EAT_DROP);
        }
      }
    }

    // ── Dynamic pricing: every PRICE_TICK_MIN recompute supply per kind → set each merchant's price:KIND
    //    drift target. The engine's driftAttribute then evolves the base smoothly toward it (E1). ──
    if (ctx.gameMinute % PRICE_TICK_MIN !== 0) return; // INV-19 absolute gameMinute
    const supply = new Map<string, number>();
    const merchants: Agent[] = [];
    for (const [, agent] of ctx.agents) {
      if (!agent.state.alive || !hasCapability(agent.profile, 'isMerchant')) continue;
      merchants.push(agent);
      for (const it of agent.state.inventory ?? []) supply.set(it.kind, (supply.get(it.kind) ?? 0) + it.quantity);
    }
    for (const m of merchants) {
      if (!m.state.attributes) m.state.attributes = {};
      for (const it of m.state.inventory ?? []) {
        const key = `price:${it.kind}`;
        const target = computePriceTarget(supply.get(it.kind) ?? 0);
        let p = m.state.attributes[key];
        if (!p) { p = createAttribute(BASE_PRICE, 1, 999); m.state.attributes[key] = p; }
        p.drift = { ratePerMinute: PRICE_RATE, toward: target };
      }
    }
  });
}
