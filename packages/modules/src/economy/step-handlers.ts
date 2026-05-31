import { registerStepHandler, addItem, removeItems, countItems, getAttributeValue } from '@clwa/engine';
import type { StepExecutionContext, GoalActionResult, World } from '@clwa/engine';
import { getPrice, BASE_PRICE } from './pricing';

/** Black market pays a premium over the (dynamic) market price. Unit prices come from pricing.ts (E1 drift). */
const BLACK_MARKET_PRICE = 10;

/** Late-bound World — step handlers register at module init (before the World exists), and
 *  StepExecutionContext carries no World ref, so the server calls setEconomyWorld(world) once the World is
 *  built (createGameContext). Gold transfers go through it to reuse E2's conserved transferAttribute. */
let economyWorld: World | null = null;
export function setEconomyWorld(w: World): void { economyWorld = w; }

type EcoStep = { targetId?: string; importance?: number };

export function registerEconomyStepHandlers(): void {
  // buy_goods: owner (buyer) pays the seller (target) and receives one unit of stock. Conserved gold + items.
  registerStepHandler('buy_goods', async (ctx: StepExecutionContext): Promise<GoalActionResult | null> => {
    const { goal, owner, agents } = ctx;
    const step = ctx.step as EcoStep;
    const base = { goalId: goal.id, goalType: goal.type, ownerId: goal.ownerId, ownerName: owner.profile.name };
    const seller = step.targetId ? agents.get(step.targetId) : undefined;
    if (!seller || !seller.state.alive || owner.state.location !== seller.state.location) {
      goal.state = 'failed';
      return { ...base, action: 'buy_goods', description: `${owner.profile.name}: no seller available — buy failed` };
    }
    const kind = (seller.state.inventory ?? []).find((it) => it.quantity > 0)?.kind;
    const price = kind ? getPrice(seller, kind) : BASE_PRICE; // dynamic market price (E1 drift)
    if (!kind || (getAttributeValue(owner.state.attributes, 'gold') ?? 0) < price || !economyWorld) {
      goal.state = 'failed';
      return { ...base, action: 'buy_goods', description: `${owner.profile.name}: cannot afford or nothing to buy` };
    }
    const paid = economyWorld.transferAttribute(owner.profile.id, seller.profile.id, 'gold', price);
    if (paid && seller.state.inventory && removeItems(seller.state.inventory, kind, 1)) {
      if (!owner.state.inventory) owner.state.inventory = [];
      addItem(owner.state.inventory, kind, 1);
    }
    await owner.observe(`I bought ${kind} from ${seller.profile.name} for ${price} coin.`, step.importance ?? 2);
    if (ctx.onEmitEvent) await ctx.onEmitEvent({ type: 'TRADE_COMPLETED', subject: owner.profile.id, object: seller.profile.id, location: owner.state.location, importance: step.importance ?? 2, payload: { kind, price } });
    goal.currentStep++;
    return { ...base, action: 'buy_goods', description: `${owner.profile.name} bought ${kind} from ${seller.profile.name} (${price} coin)`, emittedEvent: { type: 'TRADE_COMPLETED', targetId: seller.profile.id, targetName: seller.profile.name } };
  });

  // sell_goods: owner (seller) gives one unit to the buyer (target) for coin.
  registerStepHandler('sell_goods', async (ctx: StepExecutionContext): Promise<GoalActionResult | null> => {
    const { goal, owner, agents } = ctx;
    const step = ctx.step as EcoStep;
    const base = { goalId: goal.id, goalType: goal.type, ownerId: goal.ownerId, ownerName: owner.profile.name };
    const buyer = step.targetId ? agents.get(step.targetId) : undefined;
    if (!buyer || !buyer.state.alive || owner.state.location !== buyer.state.location) {
      goal.state = 'failed';
      return { ...base, action: 'sell_goods', description: `${owner.profile.name}: no buyer available — sell failed` };
    }
    const kind = (owner.state.inventory ?? []).find((it) => it.quantity > 0)?.kind;
    const price = kind ? getPrice(owner, kind) : BASE_PRICE; // seller's dynamic price (E1 drift)
    if (!kind || (getAttributeValue(buyer.state.attributes, 'gold') ?? 0) < price || !economyWorld) {
      goal.state = 'failed';
      return { ...base, action: 'sell_goods', description: `${owner.profile.name}: nothing to sell or buyer broke` };
    }
    const paid = economyWorld.transferAttribute(buyer.profile.id, owner.profile.id, 'gold', price);
    if (paid && owner.state.inventory && removeItems(owner.state.inventory, kind, 1)) {
      if (!buyer.state.inventory) buyer.state.inventory = [];
      addItem(buyer.state.inventory, kind, 1);
    }
    await owner.observe(`I sold ${kind} to ${buyer.profile.name} for ${price} coin.`, step.importance ?? 2);
    if (ctx.onEmitEvent) await ctx.onEmitEvent({ type: 'TRADE_COMPLETED', subject: owner.profile.id, object: buyer.profile.id, location: owner.state.location, importance: step.importance ?? 2, payload: { kind, price } });
    goal.currentStep++;
    return { ...base, action: 'sell_goods', description: `${owner.profile.name} sold ${kind} to ${buyer.profile.name} (${price} coin)`, emittedEvent: { type: 'TRADE_COMPLETED', targetId: buyer.profile.id, targetName: buyer.profile.name } };
  });

  // haggle_with: a soft social action — price-talk flavor + a memory, no state transfer.
  registerStepHandler('haggle_with', async (ctx: StepExecutionContext): Promise<GoalActionResult | null> => {
    const { goal, owner, agents } = ctx;
    const step = ctx.step as EcoStep;
    const base = { goalId: goal.id, goalType: goal.type, ownerId: goal.ownerId, ownerName: owner.profile.name };
    const target = step.targetId ? agents.get(step.targetId) : undefined;
    if (!target || owner.state.location !== target.state.location) { goal.state = 'failed'; return { ...base, action: 'haggle_with', description: `${owner.profile.name}: no one to haggle with` }; }
    await owner.observe(`I haggled with ${target.profile.name} over prices.`, step.importance ?? 1);
    goal.currentStep++;
    return { ...base, action: 'haggle_with', description: `${owner.profile.name} haggled with ${target.profile.name}` };
  });

  // craft_goods: produce one unit of generic 'goods' from skill/time (production).
  registerStepHandler('craft_goods', async (ctx: StepExecutionContext): Promise<GoalActionResult | null> => {
    const { goal, owner } = ctx;
    const step = ctx.step as EcoStep;
    const base = { goalId: goal.id, goalType: goal.type, ownerId: goal.ownerId, ownerName: owner.profile.name };
    if (!owner.state.inventory) owner.state.inventory = [];
    addItem(owner.state.inventory, 'goods', 1);
    await owner.observe(`I crafted goods to sell.`, step.importance ?? 2);
    goal.currentStep++;
    return { ...base, action: 'craft_goods', description: `${owner.profile.name} crafted goods (${countItems(owner.state.inventory, 'goods')} in stock)` };
  });

  // hoard_goods: hold stock back from the market (withholding flavor — no transfer).
  registerStepHandler('hoard_goods', async (ctx: StepExecutionContext): Promise<GoalActionResult | null> => {
    const { goal, owner } = ctx;
    const step = ctx.step as EcoStep;
    const base = { goalId: goal.id, goalType: goal.type, ownerId: goal.ownerId, ownerName: owner.profile.name };
    await owner.observe(`I'm holding my stock back — prices will be better soon.`, step.importance ?? 1);
    goal.currentStep++;
    return { ...base, action: 'hoard_goods', description: `${owner.profile.name} hoarded stock` };
  });

  // smuggle_goods: move a unit on the black market — lose one good, gain premium coin from an off-screen buyer.
  registerStepHandler('smuggle_goods', async (ctx: StepExecutionContext): Promise<GoalActionResult | null> => {
    const { goal, owner } = ctx;
    const step = ctx.step as EcoStep;
    const base = { goalId: goal.id, goalType: goal.type, ownerId: goal.ownerId, ownerName: owner.profile.name };
    const kind = (owner.state.inventory ?? []).find((it) => it.quantity > 0)?.kind;
    if (!kind || !owner.state.inventory || !economyWorld) { goal.state = 'failed'; return { ...base, action: 'smuggle_goods', description: `${owner.profile.name}: nothing to smuggle` }; }
    removeItems(owner.state.inventory, kind, 1);
    economyWorld.adjustAttributeBase(owner.profile.id, 'gold', BLACK_MARKET_PRICE);
    await owner.observe(`I moved ${kind} on the black market for ${BLACK_MARKET_PRICE} coin. No questions asked.`, step.importance ?? 4);
    if (ctx.onEmitEvent) await ctx.onEmitEvent({ type: 'SMUGGLING', subject: owner.profile.id, location: owner.state.location, importance: step.importance ?? 4, payload: { kind, price: BLACK_MARKET_PRICE } });
    goal.currentStep++;
    return { ...base, action: 'smuggle_goods', description: `${owner.profile.name} smuggled ${kind} (+${BLACK_MARKET_PRICE} coin)` };
  });
}
