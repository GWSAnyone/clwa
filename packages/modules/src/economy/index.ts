/**
 * Economy / Trade Module — the second genre on the CLWA engine (M7).
 *
 * Registers economic CONTENT (intents, affordances, events, pricing, debt, CG rules) through engine
 * registries. The engine NEVER imports this module (INV-14). Built on the M5 substrate (scalar attributes /
 * inventory / factions / capabilities) + the M7 universal primitives:
 *   - E1 ScalarAttribute.drift  → price evolution + need growth (P4)
 *   - E2 overdraft transfer     → loans / debt (P5)
 *   - E3 INTENT_KIND registry   → the 'trade' player intent (below)
 *
 * This is CONTENT (what trading IS), not ENGINE (how decisions/transfers are computed).
 */

import {
  registerIntentKind,
  AFFORDANCE_REGISTRY, REQUIREMENT_CHECKERS, registerScoringContributor, registerActionVerbs,
  registerEventCategory, registerEventTypeFlagsBatch, registerEventLabels,
  registerEventMoodShifts, registerGoalMoodBoost,
  hasCapability, getAttributeValue,
} from '@clwa/engine';
import type { ConsequenceRule } from '@clwa/engine';
import { ECONOMY_AFFORDANCES } from './affordances';
import { registerEconomyTargetFinders } from './target-finders';
import { registerEconomyStepHandlers } from './step-handlers';

export { setEconomyWorld } from './step-handlers';

/** Economy consequence-graph rules — consumed by the server (merged with CRIME_CG_RULES into the engine),
 *  NOT self-registered (mirrors crime-justice's CRIME_CG_RULES). Filled in P5 (shortage→pressure,
 *  stock-theft→guild alarm, debt-default→grudge). Empty until then. */
export const ECONOMY_CG_RULES: ConsequenceRule[] = [];

let registered = false;

/** Idempotent registration hub (mirrors registerCrimeJusticeModule). Fills engine registries at boot. */
export function registerEconomyModule(): void {
  if (registered) return;
  registered = true;

  // ── E3: 'trade' player intent (the economy owns trade vocabulary as DATA — INV-14/15) ──
  registerIntentKind({
    key: 'trade',
    speechActs: ['trade'],
    verbs: ['buy', 'sell', 'browse', 'trade'],
    schemaProperties: { category: { type: 'string' }, itemName: { type: 'string' } },
    promptLines: ['player wants to buy, sell, or browse goods / ask about prices. category: weapon, armor, potion, food, general; itemName: specific item if named.'],
  });

  // ── Affordances (the trade action space) + verbs (INV-10) ──
  AFFORDANCE_REGISTRY.push(...ECONOMY_AFFORDANCES);
  registerActionVerbs({
    buy: ['buy'], sell: ['sell'], haggle: ['haggle'], produce: ['produce'], hoard: ['hoard'], smuggle: ['smuggle'],
  });

  // ── Target finders (who to trade with) ──
  registerEconomyTargetFinders();

  // ── Requirement checkers (module gates; the whole `requires` bag is passed as params) ──
  // Self-sufficient (a pure-economy world needs no crime module): notGuard is a generic capability check.
  REQUIREMENT_CHECKERS.set('notGuard', (agent) => !hasCapability(agent.profile, 'investigator'));
  REQUIREMENT_CHECKERS.set('isMerchant', (agent) => hasCapability(agent.profile, 'isMerchant'));
  REQUIREMENT_CHECKERS.set('canProduce', (agent) => hasCapability(agent.profile, 'canProduce'));
  REQUIREMENT_CHECKERS.set('atMarket', (agent) => (agent.state.location ?? '').includes('market'));
  REQUIREMENT_CHECKERS.set('hasGoodsToSell', (agent) => (agent.state.inventory ?? []).some((it) => it.quantity > 0));
  REQUIREMENT_CHECKERS.set('hasCapital', (agent, _ctx, params) =>
    (getAttributeValue(agent.state.attributes, 'gold') ?? 0) >= (Number((params as { minCapital?: number })?.minCapital) || 1));

  // ── Economic decision-making: need/debt pressure raises the utility of economic affordances ──
  // Scoped to category 'economic' so it never touches crime/social scoring. debt drives smuggle/sell (raise
  // coin), hunger drives buy (acquire food). Proven mechanic: attributes.test.ts:218-235.
  registerScoringContributor((aff, agent) => {
    if (aff.category !== 'economic') return 0;
    const debt = getAttributeValue(agent.state.attributes, 'debt') ?? 0;
    const hunger = getAttributeValue(agent.state.attributes, 'hunger') ?? 0;
    return debt * 0.5 + hunger * 0.4;
  });

  // ── Events (INV-08 flags) + labels ──
  registerEventCategory('economy', ['TRADE_COMPLETED', 'SMUGGLING']);
  registerEventTypeFlagsBatch(['TRADE_COMPLETED'], { informationOnly: true }); // info-only: no reactive volition
  registerEventTypeFlagsBatch(['SMUGGLING'], { transferable: true });          // gossipable wrongdoing
  registerEventLabels({ TRADE_COMPLETED: 'a trade', SMUGGLING: 'smuggling' });

  // ── Mood (INV-06: applied via addMoodModifier in handlers) ──
  registerEventMoodShifts({ TRADE_COMPLETED: 0.1, SMUGGLING: -0.05 });
  registerGoalMoodBoost({ buy: 0.05, sell: 0.1, produce: 0.08, smuggle: 0.05 });

  // ── Step handlers (move real gold via E2 transferAttribute + inventory via add/removeItems) ──
  registerEconomyStepHandlers();

  console.log(`[Economy] Registered ${ECONOMY_AFFORDANCES.length} affordances + trade intent + ${ECONOMY_CG_RULES.length} CG rules`);
}
