import { registerStepHandler, addItem, removeItems, countItems, getAttributeValue } from '@clwa/engine';
import type { StepExecutionContext, GoalActionResult, World } from '@clwa/engine';
import { getPrice, BASE_PRICE } from './pricing';
import { recordDebt, getDebt, clearDebt, LOAN_AMOUNT, LOAN_INTEREST, DEBT_FLOOR } from './debt';

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

  // offer_loan: lender (owner) advances LOAN_AMOUNT to a needy borrower (target), records a debt at interest,
  // and lowers the borrower's gold floor so repayment can overdraft (E2) before defaulting.
  registerStepHandler('offer_loan', async (ctx: StepExecutionContext): Promise<GoalActionResult | null> => {
    const { goal, owner, agents } = ctx;
    const step = ctx.step as EcoStep;
    const base = { goalId: goal.id, goalType: goal.type, ownerId: goal.ownerId, ownerName: owner.profile.name };
    const borrower = step.targetId ? agents.get(step.targetId) : undefined;
    if (!borrower || !borrower.state.alive || owner.state.location !== borrower.state.location || !economyWorld) {
      goal.state = 'failed';
      return { ...base, action: 'offer_loan', description: `${owner.profile.name}: no borrower available` };
    }
    if (getDebt(borrower.profile.id)) { goal.currentStep++; return { ...base, action: 'offer_loan', description: `${owner.profile.name}: ${borrower.profile.name} already owes` }; }
    if (!economyWorld.transferAttribute(owner.profile.id, borrower.profile.id, 'gold', LOAN_AMOUNT)) {
      goal.state = 'failed';
      return { ...base, action: 'offer_loan', description: `${owner.profile.name}: not enough coin to lend` };
    }
    const g = borrower.state.attributes?.gold; if (g) g.min = DEBT_FLOOR; // E2: may overdraft to repay later
    const owed = Math.round(LOAN_AMOUNT * LOAN_INTEREST);
    recordDebt(borrower.profile.id, owner.profile.id, owed);
    await owner.observe(`I lent ${LOAN_AMOUNT} coin to ${borrower.profile.name}. They owe me ${owed} now.`, step.importance ?? 3);
    if (ctx.onEmitEvent) await ctx.onEmitEvent({ type: 'LOAN_GRANTED', subject: owner.profile.id, object: borrower.profile.id, location: owner.state.location, importance: step.importance ?? 3, payload: { amount: LOAN_AMOUNT, owed } });
    goal.currentStep++;
    return { ...base, action: 'offer_loan', description: `${owner.profile.name} lent ${LOAN_AMOUNT} coin to ${borrower.profile.name} (owes ${owed})` };
  });

  // demand_payment: creditor (owner) collects from the debtor (target). The debtor pays via the E2 overdraft
  // transfer — gold may go negative to its floor. If even that can't cover it → DEBT_DEFAULT, which the
  // cross-module CG (cg-rules.ts) turns into a PERSONAL_GRUDGE motive: debt → crime.
  registerStepHandler('demand_payment', async (ctx: StepExecutionContext): Promise<GoalActionResult | null> => {
    const { goal, owner, agents } = ctx;
    const step = ctx.step as EcoStep;
    const base = { goalId: goal.id, goalType: goal.type, ownerId: goal.ownerId, ownerName: owner.profile.name };
    const debtor = step.targetId ? agents.get(step.targetId) : undefined;
    const debt = step.targetId ? getDebt(step.targetId) : undefined;
    if (!debtor || !debt || debt.creditorId !== owner.profile.id || owner.state.location !== debtor.state.location || !economyWorld) {
      goal.state = 'failed';
      return { ...base, action: 'demand_payment', description: `${owner.profile.name}: no debtor to collect from` };
    }
    const owed = Math.round(debt.amount);
    if (economyWorld.transferAttribute(debtor.profile.id, owner.profile.id, 'gold', owed, { allowOverdraft: true })) {
      clearDebt(debtor.profile.id);
      await owner.observe(`${debtor.profile.name} paid back the ${owed} coin they owed me.`, step.importance ?? 3);
      goal.currentStep++;
      return { ...base, action: 'demand_payment', description: `${owner.profile.name} collected ${owed} coin from ${debtor.profile.name}` };
    }
    // Default: even overdrafting can't cover it → grudge (cross-module CG: DEBT_DEFAULT → DEBT_GRUDGE → PERSONAL_GRUDGE).
    clearDebt(debtor.profile.id);
    await owner.observe(`${debtor.profile.name} defaulted on the ${owed} coin they owed me. I won't forget this.`, (step.importance ?? 4) + 1);
    if (ctx.onEmitEvent) await ctx.onEmitEvent({ type: 'DEBT_DEFAULT', subject: debtor.profile.id, object: owner.profile.id, location: owner.state.location, importance: (step.importance ?? 4) + 1, payload: { affectedTargets: [owner.profile.id], debtorName: debtor.profile.name, creditorName: owner.profile.name } });
    goal.state = 'failed';
    return { ...base, action: 'demand_payment', description: `${owner.profile.name}: ${debtor.profile.name} DEFAULTED on ${owed} coin`, emittedEvent: { type: 'DEBT_DEFAULT', targetId: debtor.profile.id, targetName: debtor.profile.name } };
  });
}
