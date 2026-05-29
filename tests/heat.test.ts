/**
 * Heat System Tests — verify criminal danger awareness computation.
 *
 * Run: bun test tests/heat.test.ts
 */
import { describe, test, expect, beforeAll } from 'bun:test';
import { setupFakeLlm } from './fixtures/fake-llm-provider';
beforeAll(setupFakeLlm);
import { Agent, VectorMemory, BeliefManager, RelationshipGraph } from '@clwa/engine';
import { registerCrimeJusticeModule, registerSocialModule } from '@clwa/modules';
import { computeHeat, getHeatLevel } from '../packages/modules/src/crime-justice/heat';

// Register modules once
registerSocialModule();
registerCrimeJusticeModule();

function makeTestAgent(id: string, overrides?: {
  location?: string;
  honesty?: number;
  currentDay?: number;
}): Agent {
  const beliefs = new BeliefManager();
  const relationships = new RelationshipGraph();
  const memory = new VectorMemory(id);
  return new Agent(
    {
      id,
      name: id.charAt(0).toUpperCase() + id.slice(1),
      role: 'villager',
      background: 'test',
      speechStyle: 'test',
      bigFive: { openness: 0.5, conscientiousness: 0.5, extraversion: 0.5, agreeableness: 0.5, neuroticism: 0.5, honesty: overrides?.honesty ?? 0.5 },
      enneagram: { type: 5, wing: 4, coreFear: 'test', coreDesire: 'test', stressType: 7, growthType: 8 },
    },
    {
      alive: true,
      location: overrides?.location ?? 'market-square',
      mood: 0,
      baseMood: 0,
      moodModifiers: [],
      status: undefined,
      currentDay: overrides?.currentDay ?? 1,
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
      lastInteractionMinute: undefined,
    },
    memory,
    {},
  );
}

describe('Heat System', () => {
  test('non-perpetrator has zero heat', () => {
    const agent = makeTestAgent('ted');
    const heat = computeHeat(agent, { agents: new Map([['ted', agent]]) });
    expect(heat).toBe(0);
  });

  test('perpetrator has non-zero heat (time-based paranoia)', () => {
    const agent = makeTestAgent('mark', { currentDay: 2 });
    agent.state.beliefs!.addBelief({
      id: crypto.randomUUID(), eventType: 'NPC_KILLED',
      subject: 'mark', object: 'bess', location: 'tavern',
      confidence: 0.95, source: 'perpetrator', sourceNpcId: null,
      gameDay: 1, lastUpdated: 1,
    });
    const heat = computeHeat(agent, { agents: new Map([['mark', agent]]) });
    expect(heat).toBeGreaterThan(0);
    expect(heat).toBeLessThan(0.3); // just time-based, no witnesses
  });

  test('perpetrator with rumors about self has higher heat', () => {
    const agent = makeTestAgent('mark');
    agent.state.beliefs!.addBelief({
      id: crypto.randomUUID(), eventType: 'NPC_KILLED',
      subject: 'mark', object: 'bess', location: 'tavern',
      confidence: 0.95, source: 'perpetrator', sourceNpcId: null,
      gameDay: 1, lastUpdated: 1,
    });
    // Criminal heard a rumor about themselves
    agent.state.beliefs!.addBelief({
      id: crypto.randomUUID(), eventType: 'NPC_KILLED',
      subject: 'Mark', object: 'bess', location: 'tavern',
      confidence: 0.4, source: 'rumor', sourceNpcId: 'ted',
      gameDay: 1, lastUpdated: 1,
    });
    const heat = computeHeat(agent, { agents: new Map([['mark', agent]]) });
    expect(heat).toBeGreaterThan(0.1); // rumor adds heat
  });

  test('guard at criminal location increases heat', () => {
    const criminal = makeTestAgent('mark', { location: 'market-square' });
    criminal.state.beliefs!.addBelief({
      id: crypto.randomUUID(), eventType: 'NPC_KILLED',
      subject: 'mark', object: 'bess', location: 'tavern',
      confidence: 0.95, source: 'perpetrator', sourceNpcId: null,
      gameDay: 1, lastUpdated: 1,
    });
    const guard = makeTestAgent('garrett', { location: 'market-square' });
    (guard.profile as any).investigator = true;

    const agents = new Map([['mark', criminal], ['garrett', guard]]);
    const heatWithGuard = computeHeat(criminal, { agents });

    // Compare to heat without guard
    const heatWithoutGuard = computeHeat(criminal, { agents: new Map([['mark', criminal]]) });
    expect(heatWithGuard).toBeGreaterThan(heatWithoutGuard);
  });

  test('getHeatLevel returns correct levels', () => {
    expect(getHeatLevel(0.05)).toBe('safe');
    expect(getHeatLevel(0.25)).toBe('uneasy');
    expect(getHeatLevel(0.45)).toBe('anxious');
    expect(getHeatLevel(0.65)).toBe('panicked');
    expect(getHeatLevel(0.85)).toBe('desperate');
  });
});
