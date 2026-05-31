/**
 * Economy module (M7 P3) — affordance registration, requirement checkers, and the need/debt scoring
 * contributor that makes NPCs take economic decisions. Pure (no LLM/network).
 *
 * Run: bun test tests/economy.test.ts
 */
import { describe, test, expect, beforeAll } from 'bun:test';
import {
  Agent, VectorMemory, BeliefManager, RelationshipGraph,
  AFFORDANCE_REGISTRY, REQUIREMENT_CHECKERS, computeUtility, createAttribute,
} from '@clwa/engine';
import type { AgentProfile, AffordanceDefinition, AffordanceTarget } from '@clwa/engine';
import { registerEconomyModule, computePriceTarget } from '@clwa/modules';

beforeAll(() => { registerEconomyModule(); }); // idempotent

function makeAgent(id: string, opts?: { gold?: number; hunger?: number; debt?: number; location?: string; merchant?: boolean }): Agent {
  const profile: AgentProfile = {
    id, name: id, role: 'villager', background: 't', speechStyle: 't',
    bigFive: { openness: 0.5, conscientiousness: 0.5, extraversion: 0.5, agreeableness: 0.5, neuroticism: 0.5, honesty: 0.5 },
    enneagram: { type: 5, wing: 4, coreFear: 't', coreDesire: 't', stressType: 7, growthType: 8 },
    capabilities: opts?.merchant ? { isMerchant: true } : {},
  };
  const a = new Agent(profile, {
    alive: true, location: opts?.location ?? 'market-square', mood: 0, baseMood: 0, moodModifiers: [], status: undefined,
    currentDay: 1, knownFacts: [], beliefs: new BeliefManager(), relationships: new RelationshipGraph(),
    processingState: 'idle', inTransit: false,
  }, new VectorMemory(id, { maxCapacity: 20 }), {});
  a.state.attributes = {};
  if (opts?.gold !== undefined) a.state.attributes.gold = createAttribute(opts.gold, 0, 9999);
  if (opts?.hunger !== undefined) a.state.attributes.hunger = createAttribute(opts.hunger, 0, 1);
  if (opts?.debt !== undefined) a.state.attributes.debt = createAttribute(opts.debt, 0, 1);
  return a;
}

describe('Economy module registration (P3)', () => {
  test('registers exactly the 6 trade affordances, all category "economic"', () => {
    const eco = AFFORDANCE_REGISTRY.filter((a) => a.category === 'economic');
    const ids = eco.map((a) => a.id).sort();
    expect(ids).toEqual(['buy', 'haggle', 'hoard', 'produce', 'sell', 'smuggle']);
  });

  test('every economy affordance has its actionVerb (INV-10 — needed for LLM constrained decoding)', () => {
    const eco = AFFORDANCE_REGISTRY.filter((a) => a.category === 'economic');
    for (const a of eco) expect(typeof a.actionVerb).toBe('string');
  });
});

describe('Economy requirement checkers (P3)', () => {
  test('hasCapital honors the minCapital param from the requires bag', () => {
    const check = REQUIREMENT_CHECKERS.get('hasCapital');
    expect(check).toBeDefined();
    const rich = makeAgent('rich', { gold: 100 });
    const poor = makeAgent('poor', { gold: 10 });
    const ctx = {} as never;
    expect(check!(rich, ctx, { minCapital: 50 } as never)).toBe(true);
    expect(check!(poor, ctx, { minCapital: 50 } as never)).toBe(false);
    expect(check!(poor, ctx, { minCapital: 1 } as never)).toBe(true); // 10 >= 1
  });

  test('atMarket gates on the agent being at a market venue', () => {
    const check = REQUIREMENT_CHECKERS.get('atMarket');
    expect(check).toBeDefined();
    const ctx = {} as never;
    expect(check!(makeAgent('a', { location: 'market-square' }), ctx, {} as never)).toBe(true);
    expect(check!(makeAgent('b', { location: 'town-gate' }), ctx, {} as never)).toBe(false);
  });

  test('isMerchant reads the capability flag (not the role string)', () => {
    const check = REQUIREMENT_CHECKERS.get('isMerchant');
    expect(check).toBeDefined();
    const ctx = {} as never;
    expect(check!(makeAgent('m', { merchant: true }), ctx, {} as never)).toBe(true);
    expect(check!(makeAgent('v'), ctx, {} as never)).toBe(false);
  });
});

describe('Economy decision-making — scoring contributor (P3)', () => {
  // category 'economic' affordance with no trait weights → isolates the need/debt channel.
  const ECO_AFF: AffordanceDefinition = {
    id: 'buy', label: 'Buy', category: 'economic', severity: 0,
    requires: {}, weights: [], moodWeight: 0, relationshipWeight: 0, goalType: 'buy', goalPriority: 3,
  };
  const target: AffordanceTarget = { targetId: 'seller', targetName: 'Seller', targetLocation: 'market-square' };

  test('hunger raises the utility of an economic affordance (NPC acts on need)', () => {
    const hungry = makeAgent('hungry', { gold: 50, hunger: 0.8 });
    const sated = makeAgent('sated', { gold: 50, hunger: 0.0 });
    expect(computeUtility(ECO_AFF, hungry, target)).toBeGreaterThan(computeUtility(ECO_AFF, sated, target));
  });

  test('debt raises economic utility too (debt×0.5 channel)', () => {
    const indebted = makeAgent('indebted', { gold: 50, debt: 0.8 });
    const solvent = makeAgent('solvent', { gold: 50, debt: 0.0 });
    expect(computeUtility(ECO_AFF, indebted, target)).toBeGreaterThan(computeUtility(ECO_AFF, solvent, target));
  });

  test('the contributor does NOT touch non-economic affordances', () => {
    const social: AffordanceDefinition = { ...ECO_AFF, id: 'chat', category: 'social' };
    const hungry = makeAgent('h2', { gold: 50, hunger: 0.9, debt: 0.9 });
    const sated = makeAgent('s2', { gold: 50, hunger: 0.0, debt: 0.0 });
    // same score regardless of need — economy's contributor is scoped to category 'economic'
    expect(computeUtility(social, hungry, target)).toBeCloseTo(computeUtility(social, sated, target), 5);
  });
});

describe('Economy dynamic pricing law (P4 — E1 drift target)', () => {
  test('price target falls as supply rises (scarce → pricier), clamped to [0.6×, 3×] base', () => {
    const scarce = computePriceTarget(0);
    const normal = computePriceTarget(10);
    const glut = computePriceTarget(50);
    expect(scarce).toBeGreaterThan(normal);
    expect(normal).toBeGreaterThan(glut);
    expect(glut).toBeGreaterThanOrEqual(3);   // floor 0.6× base
    expect(scarce).toBeLessThanOrEqual(15);   // cap 3× base
  });

  test('at the reference supply (10) the price target equals the base price (5)', () => {
    expect(computePriceTarget(10)).toBe(5);
  });
});
