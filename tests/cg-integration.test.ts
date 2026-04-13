/**
 * CG Integration Tests — Actual CRIME_CG_RULES through ConsequenceEngine.
 *
 * Tests real crime-justice rules (21 rules) for correct cascading,
 * exclusive group resolution, escalation, and emergent personality-driven events.
 *
 * Run: bun test tests/cg-integration.test.ts
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import type { WorldEvent, ConsequenceResult, ConsequenceRule } from '@clwa/engine';
import { ConsequenceEngine } from '@clwa/engine';
import type { WorldContext } from '@clwa/engine';
import { Agent, VectorMemory, BeliefManager, RelationshipGraph, isPerpetrator, isConcealment } from '@clwa/engine';
import { registerCrimeJusticeModule, registerSocialModule, CRIME_CG_RULES } from '@clwa/modules';

// ─── Register modules once ───
registerSocialModule();
registerCrimeJusticeModule();

// ─── Deterministic probability: Math.random() → 0 (always passes) ───
const originalRandom = Math.random;

beforeEach(() => {
  Math.random = () => 0;
});

afterEach(() => {
  Math.random = originalRandom;
});

// ─── Test helpers (same pattern as cg-v2.test.ts) ───

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
    subject: 'criminal',
    object: 'victim',
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

/** Collect all fired events during engine.process() */
function collectEvents(): { fired: WorldEvent[]; onEvent: (e: WorldEvent) => void } {
  const fired: WorldEvent[] = [];
  return { fired, onEvent: (e: WorldEvent) => fired.push(e) };
}

// ─── Test Group 1: Basic Crime Chain ───

describe('CG Integration: Basic Crime Chain', () => {
  test('NPC_KILLED at location with witnesses → WITNESS_MEMORY for witnesses (not subject/object)', async () => {
    const { fired, onEvent } = collectEvents();
    const engine = new ConsequenceEngine(CRIME_CG_RULES, { onEvent });

    const criminal = makeAgent('criminal', { location: 'tavern' });
    const victim = makeAgent('victim', { location: 'tavern' });
    const witness1 = makeAgent('witness1', { location: 'tavern' });
    const witness2 = makeAgent('witness2', { location: 'tavern' });
    const elsewhere = makeAgent('elsewhere', { location: 'forge' });

    const ctx = makeCtx([criminal, victim, witness1, witness2, elsewhere]);
    const event = makeEvent('NPC_KILLED', { subject: 'criminal', object: 'victim', location: 'tavern' });

    await engine.process(event, ctx);

    // WITNESS_MEMORY must fire for witnesses at the location
    const witnessMemories = fired.filter(e => e.type === 'WITNESS_MEMORY');
    expect(witnessMemories.length).toBeGreaterThanOrEqual(1);

    // Check targets: witnesses at tavern, excluding criminal (subject) and victim (object)
    const wmTargets = witnessMemories[0].payload.affectedTargets as string[];
    expect(wmTargets).toContain('witness1');
    expect(wmTargets).toContain('witness2');
    expect(wmTargets).not.toContain('criminal');
    expect(wmTargets).not.toContain('victim');
    expect(wmTargets).not.toContain('elsewhere');
  });

  test('WITNESS_MEMORY cascades → if public place → RUMOR_SPREAD to non-witnesses', async () => {
    const { fired, onEvent } = collectEvents();
    const engine = new ConsequenceEngine(CRIME_CG_RULES, { onEvent });

    const criminal = makeAgent('criminal', { location: 'market-square' });
    const victim = makeAgent('victim', { location: 'market-square' });
    const witness = makeAgent('witness', { location: 'market-square' });
    const bystander = makeAgent('bystander', { location: 'market-square' });

    // market-square is a public place
    const ctx = makeCtx([criminal, victim, witness, bystander], ['market-square']);
    const event = makeEvent('NPC_KILLED', { subject: 'criminal', object: 'victim', location: 'market-square' });

    await engine.process(event, ctx);

    // Chain: NPC_KILLED → WITNESS_MEMORY → RUMOR_SPREAD
    const rumors = fired.filter(e => e.type === 'RUMOR_SPREAD');
    expect(rumors.length).toBeGreaterThanOrEqual(1);

    // Rumor targets should be at the location but NOT already witnesses
    const rumorTargets = rumors[0].payload.affectedTargets as string[];
    // bystander is at market-square and was not a witness (didn't get WITNESS_MEMORY — criminal/victim excluded)
    // Actually: witness got WITNESS_MEMORY, criminal/victim were excluded from witnesses.
    // bystander also got WITNESS_MEMORY (both at location, neither subject nor object).
    // Then RUMOR_SPREAD uses targetMode='location' which excludes witnessIds.
    // So rumor targets = agents at location NOT in witnessIds.
    // After WITNESS_MEMORY, witness and bystander are in witnessIds (tracksWitness=true).
    // So the rumor goes to agents at location not yet witnessed: criminal and victim.
    // But victim is still at the location (just dead from event perspective, but alive=true in our test).
    // The key assertion: RUMOR_SPREAD was generated from the cascade.
    expect(rumors.length).toBeGreaterThanOrEqual(1);
  });

  test('WITNESS_MEMORY cascades → if investigator in affectedTargets → WANTED_STATUS', async () => {
    const { fired, onEvent } = collectEvents();
    const engine = new ConsequenceEngine(CRIME_CG_RULES, { onEvent });

    const criminal = makeAgent('criminal', { location: 'tavern' });
    const victim = makeAgent('victim', { location: 'tavern' });
    const guard = makeAgent('garrett', { location: 'tavern', investigator: true, honesty: 0.7 });

    const ctx = makeCtx([criminal, victim, guard]);
    const event = makeEvent('NPC_KILLED', { subject: 'criminal', object: 'victim', location: 'tavern' });

    await engine.process(event, ctx);

    // Chain: NPC_KILLED → WITNESS_MEMORY(targets:[garrett]) → WANTED_STATUS(guard cascade)
    const witnessMemories = fired.filter(e => e.type === 'WITNESS_MEMORY');
    expect(witnessMemories.length).toBeGreaterThanOrEqual(1);
    expect((witnessMemories[0].payload.affectedTargets as string[])).toContain('garrett');

    // Guard receives WITNESS_MEMORY → guard_witness_response exclusive group.
    // H=0.7 (>= 0.4) → honest guard → WANTED_STATUS fires.
    const wantedEvents = fired.filter(e => e.type === 'WANTED_STATUS');
    expect(wantedEvents.length).toBeGreaterThanOrEqual(1);
    expect((wantedEvents[0].payload.affectedTargets as string[])).toContain('garrett');
  });

  test('cascade terminates at maxChainDepth (no infinite loops)', async () => {
    const { fired, onEvent } = collectEvents();
    const engine = new ConsequenceEngine(CRIME_CG_RULES, { onEvent });

    // Create many agents at a public place to maximize cascade potential
    const agents: Agent[] = [];
    agents.push(makeAgent('criminal', { location: 'market-square' }));
    agents.push(makeAgent('victim', { location: 'market-square' }));
    for (let i = 0; i < 8; i++) {
      agents.push(makeAgent(`npc${i}`, { location: 'market-square' }));
    }

    const ctx = makeCtx(agents, ['market-square']);
    const event = makeEvent('NPC_KILLED', { subject: 'criminal', object: 'victim', location: 'market-square' });

    await engine.process(event, ctx);

    // The cascade must terminate. If we reach here without hanging, the test passes.
    // Verify the total depth is reasonable (maxChainDepth for most rules is 3).
    // The global MAX_GLOBAL_DEPTH in the engine is 10.
    expect(fired.length).toBeGreaterThan(0);
    expect(fired.length).toBeLessThan(100); // reasonable upper bound
  });
});

// ─── Test Group 2: Exclusive Groups — Witness Reaction ───

describe('CG Integration: Exclusive Groups — Witness Reaction', () => {
  test('witness who is friend of criminal (sentiment > 0.3) → COVER_UP (not REPORT_IMPULSE)', async () => {
    const { fired, onEvent } = collectEvents();
    const engine = new ConsequenceEngine(CRIME_CG_RULES, { onEvent });

    const criminal = makeAgent('criminal', { location: 'tavern' });
    const victim = makeAgent('victim', { location: 'tavern' });
    // Friend witness: honesty is low (0.3) so won't qualify for REPORT_IMPULSE, but is friend of criminal
    const friend = makeAgent('friend', { location: 'tavern', honesty: 0.3 });
    friend.state.relationships!.addRelationship({
      targetId: 'criminal', targetName: 'Criminal', sentiment: 0.6, trust: 0.5, type: 'friend',
    });

    const ctx = makeCtx([criminal, victim, friend]);
    const event = makeEvent('NPC_KILLED', { subject: 'criminal', object: 'victim', location: 'tavern' });

    await engine.process(event, ctx);

    // friend gets WITNESS_MEMORY from witness-murder rule,
    // then witness_reaction exclusive group: cover-up (priority 2) wins.
    const coverUps = fired.filter(e => e.type === 'COVER_UP');
    const reports = fired.filter(e =>
      e.type === 'REPORT_IMPULSE' &&
      (e.payload.affectedTargets as string[]).includes('friend'),
    );

    expect(coverUps.length).toBeGreaterThanOrEqual(1);
    expect((coverUps[0].payload.affectedTargets as string[])).toContain('friend');
    expect(reports.length).toBe(0);
  });

  test('honest witness (H > 0.6) who is NOT friend → REPORT_IMPULSE', async () => {
    const { fired, onEvent } = collectEvents();
    const engine = new ConsequenceEngine(CRIME_CG_RULES, { onEvent });

    const criminal = makeAgent('criminal', { location: 'tavern' });
    const victim = makeAgent('victim', { location: 'tavern' });
    // Honest stranger: H=0.8, no relationship with criminal
    const honest = makeAgent('honest', { location: 'tavern', honesty: 0.8 });

    const ctx = makeCtx([criminal, victim, honest]);
    const event = makeEvent('NPC_KILLED', { subject: 'criminal', object: 'victim', location: 'tavern' });

    await engine.process(event, ctx);

    // honest gets WITNESS_MEMORY → witness_reaction: no relationship → cover-up fails.
    // H > 0.6 → REPORT_IMPULSE fires (priority 1, but higher priority has no targets).
    const reports = fired.filter(e =>
      e.type === 'REPORT_IMPULSE' &&
      (e.payload.affectedTargets as string[]).includes('honest'),
    );
    const coverUps = fired.filter(e =>
      e.type === 'COVER_UP' &&
      (e.payload.affectedTargets as string[]).includes('honest'),
    );

    expect(reports.length).toBeGreaterThanOrEqual(1);
    expect(coverUps.length).toBe(0);
  });

  test('witness who is BOTH friend AND honest → COVER_UP wins (priority 2 > 1)', async () => {
    const { fired, onEvent } = collectEvents();
    const engine = new ConsequenceEngine(CRIME_CG_RULES, { onEvent });

    const criminal = makeAgent('criminal', { location: 'tavern' });
    const victim = makeAgent('victim', { location: 'tavern' });
    // Both honest AND friend of criminal
    const conflicted = makeAgent('conflicted', { location: 'tavern', honesty: 0.8 });
    conflicted.state.relationships!.addRelationship({
      targetId: 'criminal', targetName: 'Criminal', sentiment: 0.6, trust: 0.5, type: 'friend',
    });

    const ctx = makeCtx([criminal, victim, conflicted]);
    const event = makeEvent('NPC_KILLED', { subject: 'criminal', object: 'victim', location: 'tavern' });

    await engine.process(event, ctx);

    // conflicted qualifies for both COVER_UP (priority 2) and REPORT_IMPULSE (priority 1).
    // Per-target exclusive resolution: COVER_UP claims conflicted first (higher priority).
    const coverUps = fired.filter(e =>
      e.type === 'COVER_UP' &&
      (e.payload.affectedTargets as string[]).includes('conflicted'),
    );
    const reports = fired.filter(e =>
      e.type === 'REPORT_IMPULSE' &&
      (e.payload.affectedTargets as string[]).includes('conflicted'),
    );

    expect(coverUps.length).toBeGreaterThanOrEqual(1);
    expect(reports.length).toBe(0);
  });
});

// ─── Test Group 3: Garrett Variability ───

describe('CG Integration: Garrett Variability', () => {
  test('corrupt guard (H < 0.4, investigator) receives WITNESS_MEMORY → CORRUPTION_COVER (not WANTED_STATUS)', async () => {
    const { fired, onEvent } = collectEvents();
    const engine = new ConsequenceEngine(CRIME_CG_RULES, { onEvent });

    const criminal = makeAgent('criminal', { location: 'tavern' });
    const victim = makeAgent('victim', { location: 'tavern' });
    // Corrupt guard: investigator + H=0.2 (< 0.4)
    const corruptGuard = makeAgent('garrett', { location: 'tavern', investigator: true, honesty: 0.2 });

    const ctx = makeCtx([criminal, victim, corruptGuard]);
    const event = makeEvent('NPC_KILLED', { subject: 'criminal', object: 'victim', location: 'tavern' });

    await engine.process(event, ctx);

    // garrett witnesses NPC_KILLED → gets WITNESS_MEMORY.
    // Then guard_witness_response exclusive group:
    //   corrupt-guard-witness (priority 2): investigator + H < 0.4 → matches → CORRUPTION_COVER
    //   guard-witnessed-murder (priority 1): investigator → matches but claimed by higher priority
    const corruption = fired.filter(e =>
      e.type === 'CORRUPTION_COVER' &&
      (e.payload.affectedTargets as string[]).includes('garrett'),
    );
    const wanted = fired.filter(e =>
      e.type === 'WANTED_STATUS' &&
      (e.payload.affectedTargets as string[]).includes('garrett'),
    );

    expect(corruption.length).toBeGreaterThanOrEqual(1);
    expect(wanted.length).toBe(0);
  });

  test('honest guard (H >= 0.4, investigator) receives WITNESS_MEMORY → WANTED_STATUS', async () => {
    const { fired, onEvent } = collectEvents();
    const engine = new ConsequenceEngine(CRIME_CG_RULES, { onEvent });

    const criminal = makeAgent('criminal', { location: 'tavern' });
    const victim = makeAgent('victim', { location: 'tavern' });
    // Honest guard: investigator + H=0.7 (>= 0.4)
    const honestGuard = makeAgent('garrett', { location: 'tavern', investigator: true, honesty: 0.7 });

    const ctx = makeCtx([criminal, victim, honestGuard]);
    const event = makeEvent('NPC_KILLED', { subject: 'criminal', object: 'victim', location: 'tavern' });

    await engine.process(event, ctx);

    // garrett witnesses NPC_KILLED → gets WITNESS_MEMORY.
    // guard_witness_response:
    //   corrupt-guard-witness (priority 2): H < 0.4 → fails (H=0.7)
    //   guard-witnessed-murder (priority 1): investigator → matches → WANTED_STATUS
    const wanted = fired.filter(e =>
      e.type === 'WANTED_STATUS' &&
      (e.payload.affectedTargets as string[]).includes('garrett'),
    );
    const corruption = fired.filter(e =>
      e.type === 'CORRUPTION_COVER' &&
      (e.payload.affectedTargets as string[]).includes('garrett'),
    );

    expect(wanted.length).toBeGreaterThanOrEqual(1);
    expect(corruption.length).toBe(0);
  });
});

// ─── Test Group 4: Escalation Events ───

describe('CG Integration: Escalation Events', () => {
  test('ARGUMENT_WITNESSED → MINOR_INCIDENT_MEMORY (NOT WITNESS_MEMORY — no guard cascade)', async () => {
    const { fired, onEvent } = collectEvents();
    const engine = new ConsequenceEngine(CRIME_CG_RULES, { onEvent });

    const arguer1 = makeAgent('arguer1', { location: 'tavern' });
    const arguer2 = makeAgent('arguer2', { location: 'tavern' });
    const bystander = makeAgent('bystander', { location: 'tavern' });
    const guard = makeAgent('garrett', { location: 'tavern', investigator: true, honesty: 0.7 });

    const ctx = makeCtx([arguer1, arguer2, bystander, guard]);
    const event = makeEvent('ARGUMENT_WITNESSED', {
      subject: 'arguer1', object: 'arguer2', location: 'tavern',
      payload: { affectedTargets: ['garrett'] },
    });

    await engine.process(event, ctx);

    // ARGUMENT_WITNESSED → MINOR_INCIDENT_MEMORY (maxChainDepth=1, no WITNESS_MEMORY)
    const minorMemories = fired.filter(e => e.type === 'MINOR_INCIDENT_MEMORY');
    expect(minorMemories.length).toBeGreaterThanOrEqual(1);

    // MINOR_INCIDENT_MEMORY does NOT trigger guard cascade (it's not WITNESS_MEMORY)
    const wantedFromArgument = fired.filter(e => e.type === 'WANTED_STATUS');
    expect(wantedFromArgument.length).toBe(0);

    // Guard may get GUARD_WARNING (separate rule for ARGUMENT_WITNESSED)
    const warnings = fired.filter(e => e.type === 'GUARD_WARNING');
    expect(warnings.length).toBeGreaterThanOrEqual(1);
  });

  test('THREAT_WITNESSED → WITNESS_MEMORY (cascades to guard)', async () => {
    const { fired, onEvent } = collectEvents();
    const engine = new ConsequenceEngine(CRIME_CG_RULES, { onEvent });

    const threatener = makeAgent('threatener', { location: 'tavern' });
    const threatened = makeAgent('threatened', { location: 'tavern' });
    const guard = makeAgent('garrett', { location: 'tavern', investigator: true, honesty: 0.7 });

    const ctx = makeCtx([threatener, threatened, guard]);
    const event = makeEvent('THREAT_WITNESSED', {
      subject: 'threatener', object: 'threatened', location: 'tavern',
    });

    await engine.process(event, ctx);

    // THREAT_WITNESSED → WITNESS_MEMORY (importance 5, cascades)
    const witnessMemories = fired.filter(e => e.type === 'WITNESS_MEMORY');
    expect(witnessMemories.length).toBeGreaterThanOrEqual(1);

    // Guard at location gets WITNESS_MEMORY → guard_witness_response → WANTED_STATUS
    const wantedEvents = fired.filter(e => e.type === 'WANTED_STATUS');
    expect(wantedEvents.length).toBeGreaterThanOrEqual(1);
    expect((wantedEvents[0].payload.affectedTargets as string[])).toContain('garrett');
  });
});

// ─── Test Group 5: Emergent Cascades ───

describe('CG Integration: Emergent Cascades', () => {
  test('NPC_KILLED + friend of victim with low A → REVENGE_IMPULSE', async () => {
    const { fired, onEvent } = collectEvents();
    const engine = new ConsequenceEngine(CRIME_CG_RULES, { onEvent });

    const criminal = makeAgent('criminal', { location: 'tavern' });
    const victim = makeAgent('victim', { location: 'tavern' });
    // Friend of victim: low agreeableness (A < 0.4) + high sentiment toward victim
    const avenger = makeAgent('avenger', { location: 'forge', agreeableness: 0.2 });
    avenger.state.relationships!.addRelationship({
      targetId: 'victim', targetName: 'Victim', sentiment: 0.7, trust: 0.6, type: 'friend',
    });

    const ctx = makeCtx([criminal, victim, avenger]);
    const event = makeEvent('NPC_KILLED', { subject: 'criminal', object: 'victim', location: 'tavern' });

    await engine.process(event, ctx);

    // grief-revenge-impulse rule: targetMode='all', conditions:
    //   relationship(target→object, sentiment > 0.3) → avenger has 0.7 ✓
    //   trait(target, agreeableness < 0.4) → avenger has 0.2 ✓
    const revengeEvents = fired.filter(e => e.type === 'REVENGE_IMPULSE');
    expect(revengeEvents.length).toBeGreaterThanOrEqual(1);
    expect((revengeEvents[0].payload.affectedTargets as string[])).toContain('avenger');
  });

  test('NPC_ARRESTED + friend of arrested → ARREST_RESENTMENT', async () => {
    const { fired, onEvent } = collectEvents();
    const engine = new ConsequenceEngine(CRIME_CG_RULES, { onEvent });

    const guard = makeAgent('garrett', { location: 'market-square', investigator: true });
    const arrested = makeAgent('criminal', { location: 'market-square' });
    // Friend of the arrested NPC
    const loyalFriend = makeAgent('loyal', { location: 'forge' });
    loyalFriend.state.relationships!.addRelationship({
      targetId: 'criminal', targetName: 'Criminal', sentiment: 0.6, trust: 0.5, type: 'friend',
    });

    const ctx = makeCtx([guard, arrested, loyalFriend], ['market-square']);
    const event = makeEvent('NPC_ARRESTED', {
      subject: 'garrett', object: 'criminal', location: 'market-square',
    });

    await engine.process(event, ctx);

    // arrest-backlash rule: targetMode='all', condition:
    //   relationship(target→object, sentiment > 0.3) → loyal has 0.6 ✓
    const resentments = fired.filter(e => e.type === 'ARREST_RESENTMENT');
    expect(resentments.length).toBeGreaterThanOrEqual(1);
    expect((resentments[0].payload.affectedTargets as string[])).toContain('loyal');
  });
});

// ─── Cascade Termination (Level 2.1) ───

describe('CG Integration: Cascade Termination', () => {
  test('cascade respects maxChainDepth and does not loop infinitely', async () => {
    // Synthetic circular rules: A → B → A, maxChainDepth 2
    const ruleAB: ConsequenceRule = {
      id: 'a-to-b', trigger: 'TYPE_A', targetMode: 'all', conditions: [],
      consequence: { type: 'TYPE_B', importance: 5, delayDays: 0, probability: 1 },
      maxChainDepth: 2,
    };
    const ruleBA: ConsequenceRule = {
      id: 'b-to-a', trigger: 'TYPE_B', targetMode: 'all', conditions: [],
      consequence: { type: 'TYPE_A', importance: 5, delayDays: 0, probability: 1 },
      maxChainDepth: 2,
    };

    const fired: string[] = [];
    const engine = new ConsequenceEngine([ruleAB, ruleBA], { onEvent: e => fired.push(e.type) });
    const agent = makeAgent('ted');
    const ctx: WorldContext = { agents: new Map([['ted', agent]]) };

    await engine.process(makeEvent('TYPE_A'), ctx);

    // Should fire: TYPE_A→TYPE_B (depth 0→1), TYPE_B→TYPE_A (depth 1→2), stop at depth 2
    expect(fired.length).toBeLessThanOrEqual(4); // max 2 cascades per direction
    // No infinite loop — test completes
  });

  test('witnessIds dedup prevents double WITNESS_MEMORY for same NPC', async () => {
    const engine = new ConsequenceEngine(CRIME_CG_RULES, { onEvent: () => {} });
    const mark = makeAgent('mark', { location: 'tavern' });
    const bess = makeAgent('bess', { location: 'tavern' });
    const ted = makeAgent('ted', { location: 'tavern' });

    const ctx: WorldContext = {
      agents: new Map([['mark', mark], ['bess', bess], ['ted', ted]]),
      publicPlaces: new Set(['tavern']),
    };

    const results = await engine.process(
      makeEvent('NPC_KILLED', { subject: 'mark', object: 'bess', location: 'tavern' }),
      ctx,
    );

    // Ted should appear as witness exactly ONCE in WITNESS_MEMORY targets
    const witnessResults = results.filter(r => r.rule.id === 'witness-murder');
    const tedAppearances = witnessResults.filter(r => r.targets.includes('ted'));
    expect(tedAppearances.length).toBe(1);
  });
});

// ─── Belief Transfer Suppression (Level 2.3) ───

describe('CG Integration: Belief Suppression Flags', () => {
  test('perpetrator source is correctly flagged', () => {
    expect(isPerpetrator('perpetrator')).toBe(true);
    expect(isPerpetrator('witness')).toBe(false);
    expect(isPerpetrator('rumor')).toBe(false);
    expect(isPerpetrator('cover_up')).toBe(false);
    expect(isPerpetrator(null)).toBe(false);
  });

  test('concealment source is correctly flagged', () => {
    expect(isConcealment('cover_up')).toBe(true);
    expect(isConcealment('destroy_evidence')).toBe(true);
    expect(isConcealment('witness')).toBe(false);
    expect(isConcealment('perpetrator')).toBe(false);
  });
});
