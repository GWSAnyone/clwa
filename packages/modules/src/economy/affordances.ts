import type { AffordanceDefinition } from '@clwa/engine';

/**
 * Economy affordances — the action space of the trade genre. All `category: 'economic'` so the scoring
 * contributor (index.ts) can scope its need/debt-driven channel to them. Weights are OCEAN+H: greed reads as
 * low Honesty / low Agreeableness; diligence as high Conscientiousness; desperation comes from the scorer
 * (debt/hunger), not a trait. Requirements beyond the universal ones (period/mood/...) are module keys
 * resolved via REQUIREMENT_CHECKERS; the whole `requires` bag is passed as params, so a key carries its value.
 */
export const ECONOMY_AFFORDANCES: AffordanceDefinition[] = [
  {
    id: 'buy',
    actionVerb: 'buy',
    actionDescription: 'buy goods from a trader',
    label: 'Buy what you need from a trader at the market',
    instinctContext: 'You need goods and {targetName} is selling. Coin in hand, you weigh the price.',
    targetFinder: 'trade_seller',
    category: 'economic',
    severity: 0,
    requires: { notGuard: true, atMarket: true, hasCapital: true, minCapital: 1 },
    weights: [
      { trait: 'C', direction: 'high', multiplier: 0.15 },
      { trait: 'O', direction: 'high', multiplier: 0.05 },
    ],
    moodWeight: 0.05,
    relationshipWeight: 0.05,
    goalType: 'buy',
    goalPriority: 3,
    stepTemplates: [
      { action: 'move_to', location: '$target', skipIfAt: true },
      { action: 'buy_goods', targetId: '$target', importance: 2 },
    ],
  },
  {
    id: 'sell',
    actionVerb: 'sell',
    actionDescription: 'sell goods to someone',
    label: 'Sell some of your goods for coin',
    instinctContext: 'You have goods to spare and coin is always useful. {targetName} might be a buyer.',
    targetFinder: 'trade_buyer',
    category: 'economic',
    severity: 0,
    requires: { notGuard: true, atMarket: true, hasGoodsToSell: true },
    weights: [
      { trait: 'E', direction: 'high', multiplier: 0.15 },
      { trait: 'C', direction: 'high', multiplier: 0.05 },
    ],
    moodWeight: 0.05,
    relationshipWeight: 0.05,
    goalType: 'sell',
    goalPriority: 3,
    stepTemplates: [
      { action: 'move_to', location: '$target', skipIfAt: true },
      { action: 'sell_goods', targetId: '$target', importance: 2 },
    ],
  },
  {
    id: 'haggle',
    actionVerb: 'haggle',
    actionDescription: 'haggle over a price',
    label: 'Haggle hard — you will not be overcharged',
    instinctContext: '{targetName} is asking too much. You can talk them down — you always do.',
    targetFinder: 'trade_seller',
    category: 'economic',
    severity: 1,
    requires: { notGuard: true, atMarket: true },
    weights: [
      { trait: 'A', direction: 'low', multiplier: 0.2 },
      { trait: 'H', direction: 'low', multiplier: 0.1 },
      { trait: 'E', direction: 'high', multiplier: 0.1 },
    ],
    moodWeight: 0.05,
    relationshipWeight: 0.1,
    goalType: 'haggle',
    goalPriority: 2,
    stepTemplates: [
      { action: 'move_to', location: '$target', skipIfAt: true },
      { action: 'haggle_with', targetId: '$target', importance: 2 },
    ],
  },
  {
    id: 'produce',
    actionVerb: 'produce',
    actionDescription: 'craft goods to sell',
    label: 'Make goods from your stock — idle hands earn nothing',
    instinctContext: 'You have the materials and the skill. Time to make something worth selling.',
    targetFinder: 'eco_self',
    category: 'economic',
    severity: 0,
    requires: { notGuard: true, canProduce: true },
    weights: [
      { trait: 'C', direction: 'high', multiplier: 0.25 },
      { trait: 'O', direction: 'high', multiplier: 0.05 },
    ],
    moodWeight: 0.05,
    relationshipWeight: 0,
    goalType: 'produce',
    goalPriority: 3,
    stepTemplates: [
      { action: 'move_to', location: '$home', skipIfAt: true },
      { action: 'craft_goods', importance: 2 },
    ],
  },
  {
    id: 'hoard',
    actionVerb: 'hoard',
    actionDescription: 'hold goods back from sale',
    label: 'Hold your stock back — prices will climb',
    instinctContext: 'Goods are getting scarce. Sit on what you have; let the price rise before you sell.',
    targetFinder: 'eco_self',
    category: 'economic',
    severity: 1,
    requires: { notGuard: true, hasGoodsToSell: true },
    weights: [
      { trait: 'A', direction: 'low', multiplier: 0.2 },
      { trait: 'N', direction: 'high', multiplier: 0.1 },
      { trait: 'C', direction: 'high', multiplier: 0.05 },
    ],
    moodWeight: 0.05,
    relationshipWeight: 0,
    beliefModifiers: [{ eventType: 'SHORTAGE', weight: 0.3 }],
    goalType: 'hoard',
    goalPriority: 2,
    stepTemplates: [
      { action: 'move_to', location: '$home', skipIfAt: true },
      { action: 'hoard_goods', importance: 2 },
    ],
  },
  // NOTE: `lend` + `collect_debt` affordances live in P5 (debt/credit) — they need the debtLedger + the E2
  // overdraft mechanics, which is the P5 phase. P3 ships the 6 working trade affordances below.
  {
    id: 'smuggle',
    actionVerb: 'smuggle',
    actionDescription: 'move goods on the black market',
    label: 'Run goods under the table — desperate coin spends the same',
    instinctContext: 'Honest trade is not paying the bills. The black market pays more and asks no questions.',
    targetFinder: 'eco_self',
    category: 'economic',
    suppressNearPlayer: true,
    severity: 4,
    resistTraits: [{ trait: 'honesty', direction: 'high' }],
    requires: { notGuard: true, period: ['night', 'evening'], hasGoodsToSell: true },
    weights: [
      { trait: 'H', direction: 'low', multiplier: 0.3 },
      { trait: 'C', direction: 'low', multiplier: 0.1 },
    ],
    moodWeight: 0.15,
    relationshipWeight: 0,
    beliefModifiers: [{ eventType: 'SHORTAGE', weight: 0.2 }],
    goalType: 'smuggle',
    goalPriority: 4,
    stepTemplates: [
      { action: 'move_to', location: '$home', skipIfAt: true },
      { action: 'smuggle_goods', importance: 4 },
    ],
  },
];
