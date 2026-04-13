/**
 * Regression Tests — specific bugs found during development.
 * Each test documents a bug, why it happened, and verifies the fix.
 * These MUST NEVER be removed — they prevent re-introduction.
 *
 * Run: bun test tests/regression.test.ts
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import type { ConsequenceRule } from '@clwa/engine';
import { ConsequenceEngine, Agent, VectorMemory, BeliefManager, RelationshipGraph } from '@clwa/engine';
import { registerCrimeJusticeModule, registerSocialModule, CRIME_CG_RULES } from '@clwa/modules';
import { isPerpetrator, isConcealment } from '@clwa/engine';
import { LocationHistory } from '../packages/server/src/game-context';

registerSocialModule();
registerCrimeJusticeModule();

// Mock Math.random for deterministic tests
const origRandom = Math.random;
beforeEach(() => { Math.random = () => 0; }); // always passes probability
afterEach(() => { Math.random = origRandom; });

function makeAgent(id: string, opts?: { location?: string; honesty?: number; agreeableness?: number; investigator?: boolean }) {
  return new Agent(
    {
      id, name: id.charAt(0).toUpperCase() + id.slice(1), role: 'villager',
      background: 'test', speechStyle: 'test',
      bigFive: { openness: 0.5, conscientiousness: 0.5, extraversion: 0.5, agreeableness: opts?.agreeableness ?? 0.5, neuroticism: 0.5, honesty: opts?.honesty ?? 0.5 },
      enneagram: { type: 5, wing: 4, coreFear: 'test', coreDesire: 'test', stressType: 7, growthType: 8 },
      investigator: opts?.investigator,
    },
    {
      alive: true, location: opts?.location ?? 'market-square', mood: 0, baseMood: 0, moodModifiers: [],
      status: undefined, currentDay: 1, knownFacts: [], beliefs: new BeliefManager(),
      relationships: new RelationshipGraph(), currentActivity: undefined, inPlayerChat: false,
      processingState: 'idle', lastInteractionOutcome: undefined, currentMotive: undefined,
      inTransit: false, transitTo: undefined, transitPath: undefined, transitProgress: 0,
      transitStartMinute: 0, transitDuration: 0, lastInteractionMinute: undefined,
    },
    new VectorMemory(id, { lmStudioUrl: 'http://localhost:1234/v1' }),
    { lmStudioUrl: 'http://localhost:1234/v1', model: 'test' },
  );
}

// ─── Regression 1: Argument Cascade → WANTED_STATUS ───

describe('Regression: argument cascade (commit a75bb6b)', () => {
  test('ARGUMENT_WITNESSED produces MINOR_INCIDENT_MEMORY, not WITNESS_MEMORY', async () => {
    const fired: string[] = [];
    const engine = new ConsequenceEngine(CRIME_CG_RULES, { onEvent: e => fired.push(e.type) });
    const witness = makeAgent('ted', { location: 'tavern' });
    const ctx = { agents: new Map([['mark', makeAgent('mark', { location: 'tavern' })], ['bess', makeAgent('bess', { location: 'tavern' })], ['ted', witness]]) };
    await engine.process({ id: '1', type: 'ARGUMENT_WITNESSED', subject: 'mark', object: 'bess', location: 'tavern', gameDay: 1, importance: 3, payload: {} }, ctx);

    expect(fired).toContain('MINOR_INCIDENT_MEMORY');
    expect(fired).not.toContain('WITNESS_MEMORY');
    expect(fired).not.toContain('WANTED_STATUS');
  });

  test('THREAT_WITNESSED DOES cascade to WITNESS_MEMORY → guard', async () => {
    const fired: string[] = [];
    const engine = new ConsequenceEngine(CRIME_CG_RULES, { onEvent: e => fired.push(e.type) });
    const guard = makeAgent('garrett', { location: 'tavern', investigator: true, honesty: 0.8 });
    const ctx = {
      agents: new Map([['mark', makeAgent('mark', { location: 'tavern' })], ['bess', makeAgent('bess', { location: 'tavern' })], ['garrett', guard]]),
      publicPlaces: new Set(['tavern']),
    };
    await engine.process({ id: '1', type: 'THREAT_WITNESSED', subject: 'mark', object: 'bess', location: 'tavern', gameDay: 1, importance: 5, payload: {} }, ctx);

    expect(fired).toContain('WITNESS_MEMORY');
    // Guard cascade fires WANTED_STATUS or CORRUPTION_COVER depending on honesty
    expect(fired.some(t => t === 'WANTED_STATUS' || t === 'CORRUPTION_COVER')).toBe(true);
  });
});

// ─── Regression 2: Perpetrator Belief Leakage ───

describe('Regression: perpetrator belief leakage (commit e61a377)', () => {
  test('isPerpetrator blocks perpetrator source beliefs', () => {
    expect(isPerpetrator('perpetrator')).toBe(true);
    expect(isPerpetrator('witness')).toBe(false);
    expect(isPerpetrator('rumor')).toBe(false);
  });

  test('isConcealment blocks cover_up source beliefs', () => {
    expect(isConcealment('cover_up')).toBe(true);
    expect(isConcealment('witness')).toBe(false);
    expect(isConcealment('perpetrator')).toBe(false);
  });
});

// ─── Regression 3: Exclusive Group Per-Target Resolution ───

describe('Regression: exclusive group per-target (commit 9aefea9)', () => {
  test('different NPCs in same exclusive group get different rules', async () => {
    const high: ConsequenceRule = {
      id: 'r-high', trigger: 'T', targetMode: 'all',
      conditions: [{ op: 'trait', of: 'target', trait: 'honesty', comparator: '>', value: 0.7 }],
      consequence: { type: 'HIGH', importance: 5, delayDays: 0, probability: 1 },
      exclusive: 'g', priority: 2, maxChainDepth: 1,
    };
    const low: ConsequenceRule = {
      id: 'r-low', trigger: 'T', targetMode: 'all',
      conditions: [{ op: 'trait', of: 'target', trait: 'agreeableness', comparator: '<', value: 0.3 }],
      consequence: { type: 'LOW', importance: 5, delayDays: 0, probability: 1 },
      exclusive: 'g', priority: 1, maxChainDepth: 1,
    };

    const fired: Array<{ type: string; targets: string[] }> = [];
    const engine = new ConsequenceEngine([low, high], {
      onEvent: e => fired.push({ type: e.type, targets: (e.payload?.affectedTargets as string[]) ?? [] }),
    });

    const honest = makeAgent('a', { honesty: 0.9 });
    const aggressive = makeAgent('b', { honesty: 0.3, agreeableness: 0.2 });
    const ctx = { agents: new Map([['a', honest], ['b', aggressive]]) };

    await engine.process({ id: '1', type: 'T', subject: 'x', location: 'y', gameDay: 1, importance: 5, payload: {} }, ctx);

    const highResult = fired.find(f => f.type === 'HIGH');
    const lowResult = fired.find(f => f.type === 'LOW');
    expect(highResult?.targets).toContain('a');
    expect(highResult?.targets).not.toContain('b');
    expect(lowResult?.targets).toContain('b');
    expect(lowResult?.targets).not.toContain('a');
  });
});

// ─── Regression 4: CG Payload Spread Overwrites affectedTargets ───

describe('Regression: payload spread order (commit 9aefea9)', () => {
  test('CG consequence affectedTargets NOT overwritten by parent payload', async () => {
    const rule: ConsequenceRule = {
      id: 'test', trigger: 'PARENT', targetMode: 'all',
      conditions: [],
      consequence: { type: 'CHILD', importance: 5, delayDays: 0, probability: 1 },
      maxChainDepth: 1,
    };

    const fired: Array<{ targets: string[] }> = [];
    const engine = new ConsequenceEngine([rule], {
      onEvent: e => fired.push({ targets: (e.payload?.affectedTargets as string[]) ?? [] }),
    });

    const agent = makeAgent('ted');
    const ctx = { agents: new Map([['ted', agent]]) };
    // Parent has affectedTargets: ['old'] — CG should override with actual targets ['ted']
    await engine.process({
      id: '1', type: 'PARENT', subject: 'x', location: 'y', gameDay: 1, importance: 5,
      payload: { affectedTargets: ['old'] },
    }, ctx);

    expect(fired[0].targets).toContain('ted');
    expect(fired[0].targets).not.toContain('old');
  });
});

// ─── Regression 5: LocationHistory Early Query ───

describe('Regression: LocationHistory early query (commit b3567f1)', () => {
  test('query before first recorded minute returns null', () => {
    const history = new LocationHistory();
    history.record('npc1', 420, 'market-square');
    history.record('npc1', 480, 'tavern');

    // Query at minute 100 — before tracking started at 420
    expect(history.getLocationAt('npc1', 100)).toBeNull();
    // Query at 420 — exact match
    expect(history.getLocationAt('npc1', 420)).toBe('market-square');
    // Query at 450 — between entries
    expect(history.getLocationAt('npc1', 450)).toBe('market-square');
    // Query at 480 — second entry
    expect(history.getLocationAt('npc1', 480)).toBe('tavern');
  });
});
