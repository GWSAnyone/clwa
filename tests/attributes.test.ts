/**
 * Scalar-attribute subsystem tests (M5 Phase B / B1) — the universal quantified-state primitive
 * (gold / HP / standing / needs). Covers the pure math, the World API (declare/adjust/modifier/transfer),
 * the CG `attr` condition op, and the computeUtility scoring-contributor channel.
 *
 * Run: bun test tests/attributes.test.ts
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import {
  Agent, VectorMemory, BeliefManager, RelationshipGraph, World, ConsequenceEngine, InMemoryEventStore,
  createAttribute, attributeEffective, decayAttribute, getAttributeValue,
  registerScoringContributor, clearScoringContributors, computeUtility,
} from '@clwa/engine';
import type { AgentProfile, AffordanceDefinition, AffordanceTarget, ConsequenceRule, WorldEvent, WorldContext } from '@clwa/engine';
import { setupFakeLlm } from './fixtures/fake-llm-provider';

beforeAll(setupFakeLlm);
// Teardown (M5 review #8): SCORING_CONTRIBUTORS is a process-global array with no production registrations;
// this file registers one, so clear it after the file to keep computeUtility deterministic elsewhere.
afterAll(clearScoringContributors);

function makeProfile(id: string): AgentProfile {
  return {
    id, name: id.charAt(0).toUpperCase() + id.slice(1), role: 'villager', background: 't', speechStyle: 't',
    bigFive: { openness: 0.5, conscientiousness: 0.5, extraversion: 0.5, agreeableness: 0.5, neuroticism: 0.5, honesty: 0.5 },
    enneagram: { type: 5, wing: 4, coreFear: 't', coreDesire: 't', stressType: 7, growthType: 8 },
  };
}
function makeAgent(id: string): Agent {
  return new Agent(makeProfile(id), {
    alive: true, location: 'market-square', mood: 0, baseMood: 0, moodModifiers: [], status: undefined,
    currentDay: 1, knownFacts: [], beliefs: new BeliefManager(), relationships: new RelationshipGraph(),
    processingState: 'idle', inTransit: false,
  }, new VectorMemory(id, { maxCapacity: 20 }), {});
}
function makeWorld(agents: Map<string, Agent>, rules: ConsequenceRule[] = []): World {
  const locations = new Map();
  locations.set('market-square', { id: 'market-square', name: 'Market Square', connections: [] });
  return new World(agents, new InMemoryEventStore(), new ConsequenceEngine(rules), {}, {}, locations);
}

describe('Scalar attribute math (pure)', () => {
  test('effective = base + decayed modifiers, clamped to [min,max]', () => {
    const gold = createAttribute(50, 0, 1000);
    expect(attributeEffective(gold)).toBe(50);
    gold.modifiers.push({ id: 'm1', source: 'sale', category: 'trade', magnitude: 20, remaining: 0, duration: 0, decay: 'none' });
    expect(attributeEffective(gold)).toBe(70);
    gold.modifiers.push({ id: 'm2', source: 'fine', category: 'trade', magnitude: -200, remaining: 0, duration: 0, decay: 'none' });
    expect(attributeEffective(gold)).toBe(0); // clamped at min
  });

  test('createAttribute clamps the base into range', () => {
    expect(attributeEffective(createAttribute(-10, 0, 100))).toBe(0);
    expect(attributeEffective(createAttribute(500, 0, 100))).toBe(100);
  });

  test('linear/exponential modifiers decay toward zero', () => {
    const hp = createAttribute(100, 0, 100);
    hp.modifiers.push({ id: 'w', source: 'wound', category: 'combat', magnitude: -40, remaining: 5, duration: 10, decay: 'linear' });
    expect(attributeEffective(hp)).toBeCloseTo(80, 5); // -40 * (5/10) = -20
    decayAttribute(hp, 5);                              // remaining 5 -> 0, modifier dropped
    expect(hp.modifiers.length).toBe(0);
    expect(attributeEffective(hp)).toBe(100);
  });

  test('getAttributeValue returns undefined for undeclared keys', () => {
    expect(getAttributeValue(undefined, 'gold')).toBeUndefined();
    expect(getAttributeValue({ hp: createAttribute(10) }, 'gold')).toBeUndefined();
    expect(getAttributeValue({ hp: createAttribute(10) }, 'hp')).toBe(10);
  });
});

describe('World attribute API', () => {
  test('setAttribute / getAttribute / adjustAttributeBase clamp to range', () => {
    const a = makeAgent('aldric');
    const world = makeWorld(new Map([['aldric', a]]));
    world.setAttribute('aldric', 'gold', 100, 0, 9999);
    expect(world.getAttribute('aldric', 'gold')).toBe(100);
    expect(world.adjustAttributeBase('aldric', 'gold', -30)).toBe(70);
    expect(world.adjustAttributeBase('aldric', 'gold', -1000)).toBe(0); // clamped at min
    expect(world.getAttribute('aldric', 'gold')).toBe(0);
    expect(world.getAttribute('aldric', 'unknown')).toBeUndefined();
  });

  test('addAttributeModifier stacks and decays via the tick', () => {
    const a = makeAgent('bess');
    const world = makeWorld(new Map([['bess', a]]));
    world.setAttribute('bess', 'hp', 100, 0, 100);
    world.addAttributeModifier('bess', 'hp', { source: 'poison', category: 'combat', magnitude: -30, remaining: 100, duration: 100, decay: 'none' });
    expect(world.getAttribute('bess', 'hp')).toBe(70);
  });

  test('transferAttribute is atomic + conserved, rejects insufficient funds', () => {
    const buyer = makeAgent('buyer');
    const seller = makeAgent('seller');
    const world = makeWorld(new Map([['buyer', buyer], ['seller', seller]]));
    world.setAttribute('buyer', 'gold', 100, 0, 9999);
    world.setAttribute('seller', 'gold', 0, 0, 9999);

    expect(world.transferAttribute('buyer', 'seller', 'gold', 40)).toBe(true);
    expect(world.getAttribute('buyer', 'gold')).toBe(60);
    expect(world.getAttribute('seller', 'gold')).toBe(40); // value conserved (100 total)

    expect(world.transferAttribute('buyer', 'seller', 'gold', 1000)).toBe(false); // insufficient → no-op
    expect(world.getAttribute('buyer', 'gold')).toBe(60);
    expect(world.getAttribute('seller', 'gold')).toBe(40);
  });

  test('transferAttribute rejects missing agent, non-positive amount, and self-transfer is value-preserving', () => {
    const buyer = makeAgent('buyer');
    const seller = makeAgent('seller');
    const world = makeWorld(new Map([['buyer', buyer], ['seller', seller]]));
    world.setAttribute('buyer', 'gold', 100, 0, 9999);
    world.setAttribute('seller', 'gold', 10, 0, 9999);

    // missing SOURCE → false, nothing mutated
    expect(world.transferAttribute('ghost', 'seller', 'gold', 5)).toBe(false);
    // missing TARGET → false, source untouched (atomic: no half-applied debit)
    expect(world.transferAttribute('buyer', 'ghost', 'gold', 5)).toBe(false);
    expect(world.getAttribute('buyer', 'gold')).toBe(100);
    expect(world.getAttribute('seller', 'gold')).toBe(10);

    // non-positive amounts → false, no-op (guards the conservation contract against zero/negative)
    expect(world.transferAttribute('buyer', 'seller', 'gold', 0)).toBe(false);
    expect(world.transferAttribute('buyer', 'seller', 'gold', -50)).toBe(false);
    expect(world.getAttribute('buyer', 'gold')).toBe(100);
    expect(world.getAttribute('seller', 'gold')).toBe(10);

    // self-transfer on a plain base (no modifiers, amount within range) nets zero — value conserved.
    expect(world.transferAttribute('buyer', 'buyer', 'gold', 40)).toBe(true);
    expect(world.getAttribute('buyer', 'gold')).toBe(100);
  });

  test('transferAttribute checks BASE not effective — a +modifier is not transferable (conservation)', () => {
    const rich = makeAgent('rich');
    const poor = makeAgent('poor');
    const world = makeWorld(new Map([['rich', rich], ['poor', poor]]));
    world.setAttribute('rich', 'gold', 50, 0, 9999);
    world.setAttribute('poor', 'gold', 0, 0, 9999);
    // A temporary +30 buff inflates effective to 80, but BASE (transferable wealth) is still 50.
    world.addAttributeModifier('rich', 'gold', { source: 'blessing', category: 'buff', magnitude: 30, remaining: 100, duration: 100, decay: 'none' });
    expect(world.getAttribute('rich', 'gold')).toBe(80); // effective

    // Transferring 80 (the inflated effective) must be REJECTED — base is only 50.
    expect(world.transferAttribute('rich', 'poor', 'gold', 80)).toBe(false);
    expect(world.getAttribute('rich', 'gold')).toBe(80); // untouched
    expect(world.getAttribute('poor', 'gold')).toBe(0);

    // Transferring 50 (the full base) succeeds and conserves base: 50 → 0 / 0 → 50 (+ rich's buff persists).
    expect(world.transferAttribute('rich', 'poor', 'gold', 50)).toBe(true);
    const richGold = world.agents.get('rich')!.state.attributes!.gold;
    expect(richGold.base).toBe(0);
    expect(world.getAttribute('rich', 'gold')).toBe(30); // base 0 + buff 30 (buff not transferred)
    expect(world.agents.get('poor')!.state.attributes!.gold.base).toBe(50);
  });
});

describe('CG `attr` condition op — quantitative gates', () => {
  test('filters consequence targets by a numeric attribute value', async () => {
    const rule: ConsequenceRule = {
      id: 'flag-low-gold', trigger: 'AUDIT', targetMode: 'location',
      conditions: [{ op: 'attr', field: 'gold', comparator: '<', value: 10, of: 'target' }],
      consequence: { type: 'FLAGGED', importance: 5, delayDays: 0, probability: 1.0 },
      maxChainDepth: 3,
    } as ConsequenceRule;
    const poor = makeAgent('poor'); poor.state.attributes = { gold: createAttribute(5, 0, 9999) };
    const rich = makeAgent('rich'); rich.state.attributes = { gold: createAttribute(50, 0, 9999) };
    const engine = new ConsequenceEngine([rule]);
    const ctx = { agents: new Map([['poor', poor], ['rich', rich]]) } as unknown as WorldContext;
    const event: WorldEvent = { id: 'e1', type: 'AUDIT', subject: 'auditor', object: undefined, location: 'market-square', gameDay: 1, importance: 5, payload: {} };

    const results = await engine.process(event, ctx);
    const flagged = results.find((r) => r.rule.id === 'flag-low-gold');
    expect(flagged).toBeDefined();
    expect(flagged!.targets).toContain('poor');   // gold 5 < 10 → flagged
    expect(flagged!.targets).not.toContain('rich'); // gold 50 → filtered out by attr gate
  });

  test('attr op: an agent that never declared the attribute is excluded (undefined → false at filter level)', async () => {
    // Guards the cg-engine `if (v === undefined) return false` branch AT THE FILTER, not just the helper:
    // a refactor dropping it would wrongly match every agent lacking the attribute.
    const rule = {
      id: 'rich-only', trigger: 'CENSUS', targetMode: 'location',
      conditions: [{ op: 'attr', field: 'gold', comparator: '>=', value: 100, of: 'target' }],
      consequence: { type: 'TAXED', importance: 3, delayDays: 0, probability: 1.0 }, maxChainDepth: 3,
    } as ConsequenceRule;
    const wealthy = makeAgent('wealthy'); wealthy.state.attributes = { gold: createAttribute(100, 0, 9999) };
    const exactlyAt = makeAgent('exact'); exactlyAt.state.attributes = { gold: createAttribute(100, 0, 9999) };
    const noGold = makeAgent('nogold'); // never declares gold → undefined
    const engine = new ConsequenceEngine([rule]);
    const ctx = { agents: new Map([['wealthy', wealthy], ['exact', exactlyAt], ['nogold', noGold]]) } as unknown as WorldContext;
    const event: WorldEvent = { id: 'e2', type: 'CENSUS', subject: 'state', object: undefined, location: 'market-square', gameDay: 1, importance: 3, payload: {} };

    const taxed = (await engine.process(event, ctx)).find((r) => r.rule.id === 'rich-only');
    expect(taxed!.targets).toContain('wealthy');
    expect(taxed!.targets).toContain('exact');     // '>=' boundary: 100 >= 100 → included
    expect(taxed!.targets).not.toContain('nogold'); // undefined attr → excluded, never matches
  });

  test('attr op: omitted comparator means equality (the default branch)', async () => {
    const rule = {
      id: 'broke', trigger: 'CENSUS', targetMode: 'location',
      conditions: [{ op: 'attr', field: 'gold', value: 0, of: 'target' }], // no comparator → equality default
      consequence: { type: 'RELIEF', importance: 2, delayDays: 0, probability: 1.0 }, maxChainDepth: 3,
    } as ConsequenceRule;
    const broke = makeAgent('broke'); broke.state.attributes = { gold: createAttribute(0, 0, 9999) };
    const solvent = makeAgent('solvent'); solvent.state.attributes = { gold: createAttribute(5, 0, 9999) };
    const engine = new ConsequenceEngine([rule]);
    const ctx = { agents: new Map([['broke', broke], ['solvent', solvent]]) } as unknown as WorldContext;
    const event: WorldEvent = { id: 'e3', type: 'CENSUS', subject: 'state', object: undefined, location: 'market-square', gameDay: 1, importance: 2, payload: {} };

    const relief = (await engine.process(event, ctx)).find((r) => r.rule.id === 'broke');
    expect(relief!.targets).toContain('broke');       // gold == 0 → matched by equality default
    expect(relief!.targets).not.toContain('solvent'); // gold 5 ≠ 0 → excluded
  });
});

describe('computeUtility scoring contributor (B1)', () => {
  test('a registered contributor adds a resource-driven channel to the score', () => {
    const aff: AffordanceDefinition = {
      id: 'eco_smuggle', label: 'Smuggle', category: 'economy', severity: 3,
      requires: {}, weights: [], moodWeight: 0, relationshipWeight: 0, goalType: 'eco_smuggle', goalPriority: 5,
    };
    const target: AffordanceTarget = { targetId: 'x', targetName: 'X', targetLocation: 'market-square' };
    const poor = makeAgent('poor'); poor.state.attributes = { debt: createAttribute(0.8, 0, 1) };
    const solvent = makeAgent('solvent'); solvent.state.attributes = { debt: createAttribute(0.0, 0, 1) };

    // contributor: higher debt → higher smuggling utility
    registerScoringContributor((a, agent) => a.id === 'eco_smuggle' ? (getAttributeValue(agent.state.attributes, 'debt') ?? 0) * 0.5 : 0);

    const poorScore = computeUtility(aff, poor, target);
    const solventScore = computeUtility(aff, solvent, target);
    expect(poorScore).toBeGreaterThan(solventScore);
    expect(poorScore).toBeCloseTo(0.4, 5); // 0.8 * 0.5, clamped [0,1]
  });
});
