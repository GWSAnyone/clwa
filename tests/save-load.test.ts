/**
 * Save/Load Round-Trip Test — serialization integrity.
 * Constructs a minimal World, modifies state, serializes,
 * deserializes, re-serializes, and compares.
 *
 * Run: bun test tests/save-load.test.ts
 */
import { describe, test, expect, beforeAll } from 'bun:test';
import {
  World,
  Agent,
  ConsequenceEngine,
  InMemoryEventStore,
  BeliefManager,
  RelationshipGraph,
  registerEventCategory,
  registerSpeechActs,
  registerClaimSources,
  registerILTradeVerbs,
  registerPressureTypes,
} from '@clwa/engine';
import { registerCrimeJusticeModule, registerSocialModule, CRIME_CG_RULES } from '@clwa/modules';
import type { AgentProfile, AgentState } from '@clwa/engine';

// ─── Bootstrap ───

let registered = false;
beforeAll(() => {
  if (registered) return;
  registerSocialModule();
  registerCrimeJusticeModule();
  registerEventCategory('player_action', ['PLAYER_ACTION']);
  registerSpeechActs([
    { act: 'inform' }, { act: 'question' }, { act: 'accuse', accusation: true },
    { act: 'threaten' }, { act: 'greet', benign: true },
  ]);
  registerClaimSources(['witnessed', 'heard']);
  registerILTradeVerbs(['buy', 'sell']);
  registerPressureTypes(['threat', 'bribe']);
  registered = true;
});

// ─── Test Fixtures ───

function makeProfile(id: string, name: string, overrides?: Partial<AgentProfile>): AgentProfile {
  return {
    id, name,
    role: 'villager',
    background: 'test background',
    speechStyle: 'plain',
    bigFive: { openness: 0.5, conscientiousness: 0.5, extraversion: 0.5, agreeableness: 0.5, neuroticism: 0.5, honesty: 0.5 },
    enneagram: { type: 5, wing: 4, coreFear: 'incompetence', coreDesire: 'knowledge', stressType: 7, growthType: 8 },
    ...overrides,
  };
}

function makeState(location: string, overrides?: Partial<AgentState>): AgentState {
  return {
    alive: true,
    status: null as any,
    location,
    mood: 0.1,
    baseMood: 0.1,
    moodModifiers: [],
    currentDay: 1,
    knownFacts: [],
    beliefs: new BeliefManager(),
    relationships: new RelationshipGraph(),
    ...overrides,
  };
}

function makeAgent(id: string, name: string, location: string): Agent {
  const profile = makeProfile(id, name);
  const state = makeState(location);
  // VectorMemory requires Qdrant — use a stub
  const memory = { recall: async () => [], observe: async () => {}, toJSON: () => [], loadState: () => {} } as any;
  return new Agent(profile, state, memory);
}

function createTestWorld(): World {
  const agents = new Map<string, Agent>();
  agents.set('alice', makeAgent('alice', 'Alice', 'market-square'));
  agents.set('bob', makeAgent('bob', 'Bob', 'tavern'));

  // Add some state complexity
  const alice = agents.get('alice')!;
  alice.state.beliefs!.addBelief({
    id: 'test-belief-1',
    eventType: 'NPC_KILLED',
    subject: 'bob',
    object: 'alice',
    location: 'market-square',
    confidence: 0.8,
    source: 'witnessed',
  });
  alice.state.relationships!.addRelationship({
    targetId: 'bob', targetName: 'Bob', type: 'rival', sentiment: -0.3, trust: 0.3,
  });
  alice.state.moodModifiers.push({
    id: 'test-mod',
    source: 'test',
    category: 'social',
    magnitude: -0.15,
    duration: 10,
    remaining: 8,
    decay: 'linear',
  });

  const eventStore = new InMemoryEventStore();
  const engine = new ConsequenceEngine(CRIME_CG_RULES);

  const locations = new Map();
  locations.set('market-square', { id: 'market-square', name: 'Market Square', connections: ['tavern'] });
  locations.set('tavern', { id: 'tavern', name: 'Tavern', connections: ['market-square'] });

  return new World(agents, eventStore, engine, {}, {}, locations);
}

// ─── Transient fields that should NOT appear in serialized agent state ───

const TRANSIENT_FIELDS = [
  'processingState', 'inTransit', 'transitTo', 'transitPath',
  'transitProgress', 'transitStartMinute', 'transitDuration',
  'lastInteractionMinute', 'inPlayerChat', 'lastInteractionOutcome',
];

// ─── Tests ───

describe('Save/Load Round-Trip', () => {
  test('toJSON → loadState → toJSON produces identical output', () => {
    const world = createTestWorld();

    const snap1 = world.toJSON();
    const json1 = JSON.stringify(snap1);

    // Create a fresh world and load the snapshot
    const world2 = createTestWorld();
    world2.loadState(JSON.parse(json1));

    const snap2 = world2.toJSON();
    const json2 = JSON.stringify(snap2);

    expect(json2).toEqual(json1);
  });

  test('beliefs survive round-trip', () => {
    const world = createTestWorld();
    const snap = world.toJSON();

    const world2 = createTestWorld();
    world2.loadState(JSON.parse(JSON.stringify(snap)));

    const aliceBeliefs = world2.agents.get('alice')!.state.beliefs!.getAllBeliefs();
    expect(aliceBeliefs.length).toBeGreaterThan(0);
    const belief = aliceBeliefs.find(b => b.id === 'test-belief-1');
    expect(belief).toBeDefined();
    expect(belief!.confidence).toBe(0.8);
    expect(belief!.source).toBe('witnessed');
  });

  test('relationships survive round-trip', () => {
    const world = createTestWorld();
    const snap = world.toJSON();

    const world2 = createTestWorld();
    world2.loadState(JSON.parse(JSON.stringify(snap)));

    const rel = world2.agents.get('alice')!.state.relationships!.getRelationship('bob');
    expect(rel).toBeDefined();
    expect(rel!.sentiment).toBeCloseTo(-0.3, 2);
    expect(rel!.trust).toBeCloseTo(0.3, 2);
  });

  test('mood modifiers survive round-trip', () => {
    const world = createTestWorld();
    const snap = world.toJSON();

    const world2 = createTestWorld();
    world2.loadState(JSON.parse(JSON.stringify(snap)));

    const mods = world2.agents.get('alice')!.state.moodModifiers;
    expect(mods.length).toBeGreaterThan(0);
    const mod = mods.find(m => m.id === 'test-mod');
    expect(mod).toBeDefined();
    expect(mod!.magnitude).toBe(-0.15);
    expect(mod!.remaining).toBe(8);
  });

  test('agent alive/status/location survive round-trip', () => {
    const world = createTestWorld();
    const snap = world.toJSON();

    const world2 = createTestWorld();
    world2.loadState(JSON.parse(JSON.stringify(snap)));

    const alice = world2.agents.get('alice')!;
    expect(alice.state.alive).toBe(true);
    expect(alice.state.location).toBe('market-square');

    const bob = world2.agents.get('bob')!;
    expect(bob.state.alive).toBe(true);
    expect(bob.state.location).toBe('tavern');
  });

  test('gameMinute and tickCount survive round-trip', () => {
    const world = createTestWorld();
    const snap = world.toJSON();

    expect(snap.gameMinute).toBeDefined();
    expect(snap.tickCount).toBeDefined();

    const world2 = createTestWorld();
    world2.loadState(JSON.parse(JSON.stringify(snap)));

    const snap2 = world2.toJSON();
    expect(snap2.gameMinute).toBe(snap.gameMinute);
    expect(snap2.tickCount).toBe(snap.tickCount);
  });

  test('multiple beliefs with different sources coexist', () => {
    const world = createTestWorld();
    const alice = world.agents.get('alice')!;

    // Add a second belief about same event but different source (dedup key = eventType+object+source)
    alice.state.beliefs!.addBelief({
      id: 'test-belief-2',
      eventType: 'NPC_KILLED',
      subject: 'bob',
      object: 'alice',
      location: 'tavern',
      confidence: 0.5,
      source: 'heard',
    });

    const snap = world.toJSON();
    const world2 = createTestWorld();
    world2.loadState(JSON.parse(JSON.stringify(snap)));

    const beliefs = world2.agents.get('alice')!.state.beliefs!.getAllBeliefs();
    const npcKilledBeliefs = beliefs.filter(b => b.eventType === 'NPC_KILLED');
    expect(npcKilledBeliefs.length).toBe(2);
  });

  test('empty state round-trips cleanly', () => {
    const world = createTestWorld();
    // Bob has no beliefs, no relationships, no modifiers
    const snap = world.toJSON();
    const world2 = createTestWorld();
    world2.loadState(JSON.parse(JSON.stringify(snap)));

    const bob = world2.agents.get('bob')!;
    expect(bob.state.alive).toBe(true);
    expect(bob.state.moodModifiers.length).toBe(0);
    expect(bob.state.beliefs!.getAllBeliefs().length).toBe(0);
  });

  test('dead agent state persists correctly', () => {
    const world = createTestWorld();
    const bob = world.agents.get('bob')!;
    bob.state.alive = false;
    bob.state.mood = -0.8;

    const snap = world.toJSON();
    const world2 = createTestWorld();
    world2.loadState(JSON.parse(JSON.stringify(snap)));

    expect(world2.agents.get('bob')!.state.alive).toBe(false);
    expect(world2.agents.get('bob')!.state.mood).toBeCloseTo(-0.8, 2);
  });
});

// ─── Serialization Format Checks ───

describe('Serialization Format', () => {
  test('toJSON output is JSON-serializable (no undefined, no functions, no circular refs)', () => {
    const world = createTestWorld();
    const snap = world.toJSON();
    // This will throw if not serializable
    const json = JSON.stringify(snap);
    expect(json).toBeTruthy();
    const parsed = JSON.parse(json);
    expect(parsed).toBeDefined();
  });

  test('agents section contains all agent IDs', () => {
    const world = createTestWorld();
    const snap = world.toJSON();
    expect(Object.keys(snap.agents)).toContain('alice');
    expect(Object.keys(snap.agents)).toContain('bob');
  });

  test('agent state has required fields in snapshot', () => {
    const world = createTestWorld();
    const snap = world.toJSON();
    for (const [id, agentSnap] of Object.entries(snap.agents)) {
      expect(agentSnap).toHaveProperty('alive');
      expect(agentSnap).toHaveProperty('location');
      expect(agentSnap).toHaveProperty('mood');
      expect(agentSnap).toHaveProperty('baseMood');
      expect(typeof agentSnap.alive).toBe('boolean');
      expect(typeof agentSnap.mood).toBe('number');
    }
  });

  test('transient fields are NOT present in serialized snapshot', () => {
    const world = createTestWorld();
    // Set some transient fields
    const alice = world.agents.get('alice')!;
    alice.state.processingState = 'executing_goal';
    alice.state.inTransit = true;
    alice.state.transitTo = 'tavern';
    alice.state.inPlayerChat = true;
    alice.state.lastInteractionMinute = 42;

    const snap = world.toJSON();
    for (const [id, agentSnap] of Object.entries(snap.agents)) {
      for (const field of TRANSIENT_FIELDS) {
        expect((agentSnap as any)[field]).toBeUndefined();
      }
    }
  });

  test('mood values are in valid range after round-trip', () => {
    const world = createTestWorld();
    // Push mood to extreme
    const alice = world.agents.get('alice')!;
    alice.state.mood = -0.95;
    alice.state.baseMood = -0.2;
    alice.state.moodModifiers.push({
      id: 'extreme-mod',
      source: 'test',
      category: 'test',
      magnitude: -0.5,
      duration: 100,
      remaining: 50,
      decay: 'exponential',
    });

    const snap = world.toJSON();
    const world2 = createTestWorld();
    world2.loadState(JSON.parse(JSON.stringify(snap)));

    const a2 = world2.agents.get('alice')!;
    expect(a2.state.mood).toBeGreaterThanOrEqual(-1);
    expect(a2.state.mood).toBeLessThanOrEqual(1);
    expect(a2.state.baseMood).toBeGreaterThanOrEqual(-1);
    expect(a2.state.baseMood).toBeLessThanOrEqual(1);
  });
});
