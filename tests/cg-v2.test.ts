/**
 * CG v2 Tests — Target selection pipeline, NPC-state conditions, exclusive groups.
 *
 * Tests the three core changes in cg-engine.ts:
 * 1. resolveTargets + gate/filter condition pipeline
 * 2. trait, relationship, belief condition ops
 * 3. Exclusive groups with priority
 *
 * Run: bun test tests/cg-v2.test.ts
 */
import { describe, test, expect } from 'bun:test';
import type { ConsequenceRule, WorldEvent, RuleCondition } from '@clwa/engine';
import { ConsequenceEngine } from '@clwa/engine';
import type { WorldContext } from '@clwa/engine';
import { Agent, VectorMemory, BeliefManager, RelationshipGraph } from '@clwa/engine';
import { registerCrimeJusticeModule, registerSocialModule } from '@clwa/modules';

// ─── Register modules once ───
registerSocialModule();
registerCrimeJusticeModule();

// ─── Test helpers ───

function makeAgent(id: string, overrides?: {
  location?: string;
  honesty?: number;
  agreeableness?: number;
  investigator?: boolean;
  alive?: boolean;
}): Agent {
  const beliefs = new BeliefManager();
  const relationships = new RelationshipGraph();
  const memory = new VectorMemory(id, { lmStudioUrl: 'http://localhost:1234/v1', maxCapacity: 200 });
  const agent = new Agent(
    {
      id,
      name: id.charAt(0).toUpperCase() + id.slice(1),
      role: 'villager',
      background: 'test',
      speechStyle: 'test',
      bigFive: {
        openness: 0.5,
        conscientiousness: 0.5,
        extraversion: 0.5,
        agreeableness: overrides?.agreeableness ?? 0.5,
        neuroticism: 0.5,
        honesty: overrides?.honesty ?? 0.5,
      },
      enneagram: { type: 5, wing: 4, coreFear: 'test', coreDesire: 'test', stressType: 7, growthType: 8 },
      investigator: overrides?.investigator,
    },
    {
      alive: overrides?.alive ?? true,
      location: overrides?.location ?? 'market-square',
      mood: 0,
      baseMood: 0,
      moodModifiers: [],
      status: undefined,
      currentDay: 1,
      knownFacts: [],
      beliefs,
      relationships,
      currentActivity: undefined,
      inPlayerChat: false,
      processingState: 'idle',
      lastInteractionOutcome: undefined,
      currentMotive: undefined,
      inTransit: false,
      transitTo: undefined,
      transitPath: undefined,
      transitProgress: 0,
      transitStartMinute: 0,
      transitDuration: 0,
      lastInteractionMinute: undefined,
    },
    memory,
    { lmStudioUrl: 'http://localhost:1234/v1', model: 'test' },
  );
  return agent;
}

function makeEvent(type: string, overrides?: Partial<WorldEvent>): WorldEvent {
  return {
    id: crypto.randomUUID(),
    type,
    subject: 'mark',
    object: 'bess',
    location: 'market-square',
    gameDay: 1,
    importance: 7,
    payload: { affectedTargets: [] },
    ...overrides,
  };
}

function makeCtx(agents: Agent[], publicPlaces?: string[]): WorldContext {
  const map = new Map<string, Agent>();
  for (const a of agents) map.set(a.profile.id, a);
  return {
    agents: map,
    publicPlaces: publicPlaces ? new Set(publicPlaces) : undefined,
  };
}

// ─── Tests ───

describe('CG v2: Target Selection Pipeline', () => {
  test('targetMode witnesses excludes subject, object, and known witnesses', async () => {
    const rule: ConsequenceRule = {
      id: 'test-witnesses',
      trigger: 'TEST_EVENT',
      targetMode: 'witnesses',
      conditions: [],
      consequence: { type: 'TEST_RESULT', importance: 5, delayDays: 0, probability: 1.0 },
      maxChainDepth: 3,
    };

    const mark = makeAgent('mark', { location: 'tavern' });   // subject
    const bess = makeAgent('bess', { location: 'tavern' });   // object
    const ted = makeAgent('ted', { location: 'tavern' });     // witness
    const elara = makeAgent('elara', { location: 'tavern' }); // witness
    const hilda = makeAgent('hilda', { location: 'forge' });  // different location

    const engine = new ConsequenceEngine([rule]);
    const ctx = makeCtx([mark, bess, ted, elara, hilda]);
    const event = makeEvent('TEST_EVENT', { subject: 'mark', object: 'bess', location: 'tavern' });

    const results = await engine.process(event, ctx);
    expect(results.length).toBe(1);
    expect(results[0].targets).toContain('ted');
    expect(results[0].targets).toContain('elara');
    expect(results[0].targets).not.toContain('mark');   // subject excluded
    expect(results[0].targets).not.toContain('bess');   // object excluded
    expect(results[0].targets).not.toContain('hilda');  // wrong location
  });

  test('targetMode location includes all at location except known witnesses', async () => {
    const rule: ConsequenceRule = {
      id: 'test-location',
      trigger: 'TEST_EVENT',
      targetMode: 'location',
      conditions: [],
      consequence: { type: 'TEST_RESULT', importance: 5, delayDays: 0, probability: 1.0 },
      maxChainDepth: 3,
    };

    const mark = makeAgent('mark', { location: 'market-square' });
    const bess = makeAgent('bess', { location: 'market-square' });
    const ted = makeAgent('ted', { location: 'market-square' });

    const engine = new ConsequenceEngine([rule]);
    const ctx = makeCtx([mark, bess, ted]);
    ctx.witnessIds = new Set(['mark']); // mark already a witness

    const event = makeEvent('TEST_EVENT', { location: 'market-square' });
    const results = await engine.process(event, ctx);

    expect(results[0].targets).toContain('bess');
    expect(results[0].targets).toContain('ted');
    expect(results[0].targets).not.toContain('mark'); // already witnessed
  });

  test('targetMode all returns all alive agents', async () => {
    const rule: ConsequenceRule = {
      id: 'test-all',
      trigger: 'TEST_EVENT',
      targetMode: 'all',
      conditions: [],
      consequence: { type: 'TEST_RESULT', importance: 5, delayDays: 0, probability: 1.0 },
      maxChainDepth: 3,
    };

    const mark = makeAgent('mark');
    const bess = makeAgent('bess');
    const dead = makeAgent('dead', { alive: false });

    const engine = new ConsequenceEngine([rule]);
    const ctx = makeCtx([mark, bess, dead]);
    const event = makeEvent('TEST_EVENT');
    const results = await engine.process(event, ctx);

    expect(results[0].targets).toContain('mark');
    expect(results[0].targets).toContain('bess');
    expect(results[0].targets).not.toContain('dead');
  });
});

describe('CG v2: NPC-State Conditions', () => {
  test('trait filter: only targets with matching trait pass', async () => {
    const rule: ConsequenceRule = {
      id: 'test-trait-filter',
      trigger: 'TEST_EVENT',
      targetMode: 'all',
      conditions: [
        { op: 'trait', of: 'target', trait: 'honesty', comparator: '>', value: 0.6 },
      ],
      consequence: { type: 'TEST_RESULT', importance: 5, delayDays: 0, probability: 1.0 },
      maxChainDepth: 3,
    };

    const honest = makeAgent('honest', { honesty: 0.8 });
    const dishonest = makeAgent('dishonest', { honesty: 0.3 });

    const engine = new ConsequenceEngine([rule]);
    const ctx = makeCtx([honest, dishonest]);
    const event = makeEvent('TEST_EVENT');
    const results = await engine.process(event, ctx);

    expect(results[0].targets).toContain('honest');
    expect(results[0].targets).not.toContain('dishonest');
  });

  test('trait gate: subject trait check fails → entire rule rejected', async () => {
    const rule: ConsequenceRule = {
      id: 'test-trait-gate',
      trigger: 'TEST_EVENT',
      targetMode: 'all',
      conditions: [
        { op: 'trait', of: 'subject', trait: 'honesty', comparator: '<', value: 0.3 },
      ],
      consequence: { type: 'TEST_RESULT', importance: 5, delayDays: 0, probability: 1.0 },
      maxChainDepth: 3,
    };

    const subject = makeAgent('mark', { honesty: 0.8 }); // H=0.8, fails < 0.3
    const target = makeAgent('bess');

    const engine = new ConsequenceEngine([rule]);
    const ctx = makeCtx([subject, target]);
    const event = makeEvent('TEST_EVENT', { subject: 'mark' });
    const results = await engine.process(event, ctx);

    expect(results.length).toBe(0); // gate failed
  });

  test('relationship filter: targets with matching relationship pass', async () => {
    const rule: ConsequenceRule = {
      id: 'test-rel-filter',
      trigger: 'TEST_EVENT',
      targetMode: 'all',
      conditions: [
        { op: 'relationship', actor: 'target', toward: 'subject', field: 'sentiment', comparator: '>', value: 0.3 },
      ],
      consequence: { type: 'TEST_RESULT', importance: 5, delayDays: 0, probability: 1.0 },
      maxChainDepth: 3,
    };

    const criminal = makeAgent('mark');
    const friend = makeAgent('ted');
    const enemy = makeAgent('hilda');

    // Ted likes Mark (sentiment 0.6), Hilda dislikes Mark (sentiment -0.4)
    friend.state.relationships!.addRelationship({ targetId: 'mark', targetName: 'Mark', sentiment: 0.6, trust: 0.5, type: 'friend' });
    enemy.state.relationships!.addRelationship({ targetId: 'mark', targetName: 'Mark', sentiment: -0.4, trust: 0.3, type: 'rival' });

    const engine = new ConsequenceEngine([rule]);
    const ctx = makeCtx([criminal, friend, enemy]);
    const event = makeEvent('TEST_EVENT', { subject: 'mark' });
    const results = await engine.process(event, ctx);

    expect(results[0].targets).toContain('ted');     // friend passes
    expect(results[0].targets).not.toContain('hilda'); // enemy fails
    expect(results[0].targets).not.toContain('mark');  // mark has no rel to self
  });

  test('belief filter: targets with matching beliefs pass', async () => {
    const rule: ConsequenceRule = {
      id: 'test-belief-filter',
      trigger: 'TEST_EVENT',
      targetMode: 'all',
      conditions: [
        { op: 'belief', of: 'target', eventType: 'NPC_KILLED', minConfidence: 0.5 },
      ],
      consequence: { type: 'TEST_RESULT', importance: 5, delayDays: 0, probability: 1.0 },
      maxChainDepth: 3,
    };

    const knows = makeAgent('knows');
    const ignorant = makeAgent('ignorant');

    knows.state.beliefs!.addBelief({
      id: crypto.randomUUID(), eventType: 'NPC_KILLED',
      subject: 'mark', object: 'bess', location: 'tavern',
      confidence: 0.8, source: 'witness', sourceNpcId: null,
      gameDay: 1, lastUpdated: 1,
    });

    const engine = new ConsequenceEngine([rule]);
    const ctx = makeCtx([knows, ignorant]);
    const event = makeEvent('TEST_EVENT');
    const results = await engine.process(event, ctx);

    expect(results[0].targets).toContain('knows');
    expect(results[0].targets).not.toContain('ignorant');
  });

  test('is_public_place gate blocks rule if location is not public', async () => {
    const rule: ConsequenceRule = {
      id: 'test-public-gate',
      trigger: 'TEST_EVENT',
      targetMode: 'location',
      conditions: [
        { op: 'is_public_place' },
      ],
      consequence: { type: 'TEST_RESULT', importance: 5, delayDays: 0, probability: 1.0 },
      maxChainDepth: 3,
    };

    const ted = makeAgent('ted', { location: 'forge' });

    const engine = new ConsequenceEngine([rule]);
    // forge is NOT a public place
    const ctx = makeCtx([ted], ['market-square', 'tavern']);
    const event = makeEvent('TEST_EVENT', { location: 'forge' });
    const results = await engine.process(event, ctx);

    expect(results.length).toBe(0); // gate blocks
  });

  test('has_capability filter works on affected targets', async () => {
    const rule: ConsequenceRule = {
      id: 'test-cap-filter',
      trigger: 'TEST_EVENT',
      targetMode: 'affected',
      conditions: [
        { op: 'has_capability', value: 'investigator' },
      ],
      consequence: { type: 'TEST_RESULT', importance: 5, delayDays: 0, probability: 1.0 },
      maxChainDepth: 3,
    };

    const guard = makeAgent('garrett', { investigator: true });
    const villager = makeAgent('ted');

    const engine = new ConsequenceEngine([rule]);
    const ctx = makeCtx([guard, villager]);
    const event = makeEvent('TEST_EVENT', {
      payload: { affectedTargets: ['garrett', 'ted'] },
    });
    const results = await engine.process(event, ctx);

    expect(results[0].targets).toContain('garrett');
    expect(results[0].targets).not.toContain('ted');
  });
});

describe('CG v2: Exclusive Groups', () => {
  test('exclusive group: highest priority fires, lower is skipped', async () => {
    const fired: string[] = [];

    const highPriority: ConsequenceRule = {
      id: 'high-priority',
      trigger: 'TEST_EVENT',
      targetMode: 'all',
      conditions: [],
      consequence: { type: 'HIGH_RESULT', importance: 5, delayDays: 0, probability: 1.0 },
      exclusive: 'test_group',
      priority: 2,
      maxChainDepth: 1,
    };

    const lowPriority: ConsequenceRule = {
      id: 'low-priority',
      trigger: 'TEST_EVENT',
      targetMode: 'all',
      conditions: [],
      consequence: { type: 'LOW_RESULT', importance: 5, delayDays: 0, probability: 1.0 },
      exclusive: 'test_group',
      priority: 1,
      maxChainDepth: 1,
    };

    const engine = new ConsequenceEngine([lowPriority, highPriority], {
      onEvent: (e) => fired.push(e.type),
    });
    const agent = makeAgent('ted');
    const ctx = makeCtx([agent]);
    const event = makeEvent('TEST_EVENT');

    await engine.process(event, ctx);

    expect(fired).toContain('HIGH_RESULT');
    expect(fired).not.toContain('LOW_RESULT');
  });

  test('exclusive group: if high priority conditions fail, lower fires', async () => {
    const fired: string[] = [];

    const highPriority: ConsequenceRule = {
      id: 'high-priority-fails',
      trigger: 'TEST_EVENT',
      targetMode: 'all',
      conditions: [
        { op: 'trait', of: 'target', trait: 'honesty', comparator: '>', value: 0.99 }, // impossible
      ],
      consequence: { type: 'HIGH_RESULT', importance: 5, delayDays: 0, probability: 1.0 },
      exclusive: 'test_group',
      priority: 2,
      maxChainDepth: 1,
    };

    const lowPriority: ConsequenceRule = {
      id: 'low-priority-passes',
      trigger: 'TEST_EVENT',
      targetMode: 'all',
      conditions: [],
      consequence: { type: 'LOW_RESULT', importance: 5, delayDays: 0, probability: 1.0 },
      exclusive: 'test_group',
      priority: 1,
      maxChainDepth: 1,
    };

    const engine = new ConsequenceEngine([lowPriority, highPriority], {
      onEvent: (e) => fired.push(e.type),
    });
    const agent = makeAgent('ted', { honesty: 0.5 }); // fails > 0.99
    const ctx = makeCtx([agent]);
    const event = makeEvent('TEST_EVENT');

    await engine.process(event, ctx);

    expect(fired).toContain('LOW_RESULT');
    expect(fired).not.toContain('HIGH_RESULT');
  });

  test('independent rules fire alongside exclusive groups', async () => {
    const fired: string[] = [];

    const exclusive: ConsequenceRule = {
      id: 'exclusive-rule',
      trigger: 'TEST_EVENT',
      targetMode: 'all',
      conditions: [],
      consequence: { type: 'EXCLUSIVE_RESULT', importance: 5, delayDays: 0, probability: 1.0 },
      exclusive: 'test_group',
      priority: 1,
      maxChainDepth: 1,
    };

    const independent: ConsequenceRule = {
      id: 'independent-rule',
      trigger: 'TEST_EVENT',
      targetMode: 'all',
      conditions: [],
      consequence: { type: 'INDEPENDENT_RESULT', importance: 5, delayDays: 0, probability: 1.0 },
      maxChainDepth: 1,
    };

    const engine = new ConsequenceEngine([exclusive, independent], {
      onEvent: (e) => fired.push(e.type),
    });
    const agent = makeAgent('ted');
    const ctx = makeCtx([agent]);
    const event = makeEvent('TEST_EVENT');

    await engine.process(event, ctx);

    expect(fired).toContain('EXCLUSIVE_RESULT');
    expect(fired).toContain('INDEPENDENT_RESULT');
  });
});

describe('CG v2: Trigger Index', () => {
  test('only rules matching event type are evaluated', async () => {
    const fired: string[] = [];

    const rule1: ConsequenceRule = {
      id: 'matches',
      trigger: 'CORRECT_TYPE',
      targetMode: 'all',
      conditions: [],
      consequence: { type: 'MATCH_RESULT', importance: 5, delayDays: 0, probability: 1.0 },
      maxChainDepth: 1,
    };

    const rule2: ConsequenceRule = {
      id: 'no-match',
      trigger: 'WRONG_TYPE',
      targetMode: 'all',
      conditions: [],
      consequence: { type: 'WRONG_RESULT', importance: 5, delayDays: 0, probability: 1.0 },
      maxChainDepth: 1,
    };

    const engine = new ConsequenceEngine([rule1, rule2], {
      onEvent: (e) => fired.push(e.type),
    });
    const agent = makeAgent('ted');
    const ctx = makeCtx([agent]);
    const event = makeEvent('CORRECT_TYPE');

    await engine.process(event, ctx);

    expect(fired).toContain('MATCH_RESULT');
    expect(fired).not.toContain('WRONG_RESULT');
  });
});
