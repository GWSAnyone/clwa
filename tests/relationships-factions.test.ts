/**
 * Relationship-richness + faction tests (M5 Phase B / B3).
 * - Open RelationType + registry-backed bond-type defaults (trust/sentiment/grief).
 * - `standing` axis on Relationship (court/politics win-condition).
 * - Faction membership primitive + CG `faction` condition op.
 *
 * Run: bun test tests/relationships-factions.test.ts
 */
import { describe, test, expect, beforeAll } from 'bun:test';
import {
  Agent, VectorMemory, BeliefManager, RelationshipGraph, World, ConsequenceEngine, InMemoryEventStore,
  registerRelationshipType, getRelationshipDefaults,
} from '@clwa/engine';
import type { AgentProfile, ConsequenceRule, WorldEvent, WorldContext } from '@clwa/engine';
import { setupFakeLlm } from './fixtures/fake-llm-provider';

beforeAll(setupFakeLlm);

function makeAgent(id: string): Agent {
  const profile: AgentProfile = {
    id, name: id.charAt(0).toUpperCase() + id.slice(1), role: 'villager', background: 't', speechStyle: 't',
    bigFive: { openness: 0.5, conscientiousness: 0.5, extraversion: 0.5, agreeableness: 0.5, neuroticism: 0.5, honesty: 0.5 },
    enneagram: { type: 5, wing: 4, coreFear: 't', coreDesire: 't', stressType: 7, growthType: 8 },
  };
  return new Agent(profile, {
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

describe('Relationship bond-type registry (B3a)', () => {
  test('universal bonds carry engine defaults; unknown bonds get neutral fallback', () => {
    expect(getRelationshipDefaults('family')).toEqual({ trust: 0.9, sentiment: 0.7, grief: -0.4 });
    expect(getRelationshipDefaults('rival').sentiment).toBe(-0.3);
    // unknown bond → neutral fallback (no crash, no engine edit)
    expect(getRelationshipDefaults('totally_new_bond')).toEqual({ trust: 0.4, sentiment: 0, grief: -0.05 });
  });

  test('a module registers a new bond type (e.g. betrothed) with zero engine edit', () => {
    registerRelationshipType('betrothed', { trust: 0.9, sentiment: 0.9, grief: -0.6 });
    expect(getRelationshipDefaults('betrothed')).toEqual({ trust: 0.9, sentiment: 0.9, grief: -0.6 });
  });

  test('getGriefPenalty reads the bond registry and skips enemies', () => {
    const a = makeAgent('a');
    a.state.relationships!.addRelationship({ targetId: 'b', targetName: 'B', type: 'family', sentiment: 0.7, trust: 0.9 });
    expect(a.state.relationships!.getGriefPenalty('b')).toBe(-0.4);
    a.state.relationships!.addRelationship({ targetId: 'c', targetName: 'C', type: 'rival', sentiment: -0.3, trust: 0.2 });
    expect(a.state.relationships!.getGriefPenalty('c')).toBe(0); // enemy → no grief
  });

  test('standing axis is adjustable and clamped (-1..1)', () => {
    const a = makeAgent('a');
    a.state.relationships!.addRelationship({ targetId: 'monarch', targetName: 'Monarch', type: 'colleague', sentiment: 0.3, trust: 0.6 });
    a.state.relationships!.adjustStanding('monarch', 0.5);
    expect(a.state.relationships!.getRelationship('monarch')!.standing).toBeCloseTo(0.5, 5);
    a.state.relationships!.adjustStanding('monarch', 0.9);
    expect(a.state.relationships!.getRelationship('monarch')!.standing).toBe(1); // clamped
  });
});

describe('Faction membership primitive (B3b)', () => {
  test('join / leave / isFactionMember / getFactions', () => {
    const a = makeAgent('aldric');
    const world = makeWorld(new Map([['aldric', a]]));
    expect(world.isFactionMember('aldric', 'house_valois')).toBe(false);
    world.joinFaction('aldric', 'house_valois');
    world.joinFaction('aldric', 'house_valois'); // idempotent
    world.joinFaction('aldric', 'merchants_guild');
    expect(world.isFactionMember('aldric', 'house_valois')).toBe(true);
    expect(world.getFactions('aldric').sort()).toEqual(['house_valois', 'merchants_guild']);
    world.leaveFaction('aldric', 'house_valois');
    expect(world.isFactionMember('aldric', 'house_valois')).toBe(false);
    expect(world.getFactions('aldric')).toEqual(['merchants_guild']);
  });
});

describe('CG `faction` condition op (B3b)', () => {
  test('gates consequence targets by faction membership', async () => {
    const rule: ConsequenceRule = {
      id: 'rally-house', trigger: 'DECREE', targetMode: 'location',
      conditions: [{ op: 'faction', value: 'house_valois', of: 'target' }],
      consequence: { type: 'RALLIED', importance: 5, delayDays: 0, probability: 1.0 },
      maxChainDepth: 3,
    } as ConsequenceRule;
    const member = makeAgent('member'); member.state.factions = ['house_valois'];
    const outsider = makeAgent('outsider'); outsider.state.factions = ['merchants_guild'];
    const engine = new ConsequenceEngine([rule]);
    const ctx = { agents: new Map([['member', member], ['outsider', outsider]]) } as unknown as WorldContext;
    const event: WorldEvent = { id: 'e1', type: 'DECREE', subject: 'monarch', object: undefined, location: 'market-square', gameDay: 1, importance: 5, payload: {} };
    const results = await engine.process(event, ctx);
    const rallied = results.find((r) => r.rule.id === 'rally-house');
    expect(rallied).toBeDefined();
    expect(rallied!.targets).toContain('member');
    expect(rallied!.targets).not.toContain('outsider');
  });
});
