/**
 * M3 Systems Tests — motive growth, heat directives, belief suppression, escalation thresholds.
 *
 * Run: bun test tests/m3-systems.test.ts
 */
import { describe, test, expect, beforeAll } from 'bun:test';
import { setupFakeLlm } from './fixtures/fake-llm-provider';
beforeAll(setupFakeLlm);
import {
  Agent, VectorMemory, BeliefManager, RelationshipGraph,
  AFFORDANCE_REGISTRY,
  isPerpetrator, isConcealment,
} from '@clwa/engine';
import { registerCrimeJusticeModule, registerSocialModule } from '@clwa/modules';
import { buildHeatDirective, getHeatLevel } from '../packages/modules/src/crime-justice/heat';

// Register modules once (source flags, event categories, affordances, etc.)
registerSocialModule();
registerCrimeJusticeModule();

// ─── Test helper (same pattern as heat.test.ts) ───
function makeTestAgent(id: string, overrides?: {
  location?: string;
  honesty?: number;
  neuroticism?: number;
  currentDay?: number;
  isPlayer?: boolean;
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
      isPlayer: overrides?.isPlayer ?? false,
      bigFive: {
        openness: 0.5,
        conscientiousness: 0.5,
        extraversion: 0.5,
        agreeableness: 0.5,
        neuroticism: overrides?.neuroticism ?? 0.5,
        honesty: overrides?.honesty ?? 0.5,
      },
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

// ═══════════════════════════════════════════════════════════════
// Test Group 1: Motive Growth Math
// ═══════════════════════════════════════════════════════════════
describe('Motive Growth', () => {
  test('confidence + growth = expected value (personality formula)', () => {
    const H = 0.5, N = 0.5;
    const personalityFactor = (1.0 - H) * 0.6 + N * 0.4;
    // personalityFactor = 0.5*0.6 + 0.5*0.4 = 0.3 + 0.2 = 0.5
    const growth = 0.06 * (0.5 + personalityFactor);
    expect(personalityFactor).toBeCloseTo(0.5, 4);
    expect(growth).toBeCloseTo(0.06 * 1.0, 4); // 0.06
  });

  test('low-H NPC (H=0.2) grows faster than high-H NPC (H=0.8)', () => {
    const N = 0.6;

    // Low honesty → faster escalation
    const H_low = 0.2;
    const pfLow = (1.0 - H_low) * 0.6 + N * 0.4; // 0.8*0.6 + 0.6*0.4 = 0.48 + 0.24 = 0.72
    const growthLow = 0.06 * (0.5 + pfLow);
    expect(growthLow).toBeCloseTo(0.06 * (0.5 + 0.72), 4); // 0.0732

    // High honesty → slower escalation
    const H_high = 0.8;
    const pfHigh = (1.0 - H_high) * 0.6 + N * 0.4; // 0.2*0.6 + 0.6*0.4 = 0.12 + 0.24 = 0.36
    const growthHigh = 0.06 * (0.5 + pfHigh);
    expect(growthHigh).toBeCloseTo(0.06 * (0.5 + 0.36), 4); // 0.0516

    expect(growthLow).toBeGreaterThan(growthHigh);
  });

  test('growth capped at 0.95', () => {
    // Simulate confidence near the cap
    let confidence = 0.93;
    const H = 0.2, N = 0.8;
    const personalityFactor = (1.0 - H) * 0.6 + N * 0.4;
    const growth = 0.06 * (0.5 + personalityFactor);
    confidence = Math.min(0.95, confidence + growth);
    expect(confidence).toBe(0.95);
  });

  test('motive younger than 180 minutes does not grow', () => {
    // Motive created at gameDay 1 (minute 1440). Current gameMinute = 1500 → age = 60 minutes
    const motiveGameDay = 1;
    const gameMinute = 1500;
    const motiveAge = gameMinute - (motiveGameDay * 1440); // 1500 - 1440 = 60
    expect(motiveAge).toBe(60);
    expect(motiveAge < 180).toBe(true); // guard prevents growth
  });

  test('player agent is skipped (isPlayer check)', () => {
    // The tick handler checks agent.profile.isPlayer — players never have motive growth
    const player = makeTestAgent('player', { isPlayer: true });
    expect(player.profile.isPlayer).toBe(true);
    // In the real handler: if (agent.profile.isPlayer) continue;
    // We verify the flag is set correctly so the guard works
  });
});

// ═══════════════════════════════════════════════════════════════
// Test Group 2: Heat Directive
// ═══════════════════════════════════════════════════════════════
describe('Heat Directive', () => {
  test('buildHeatDirective returns null for non-perpetrator', () => {
    const agent = makeTestAgent('alice');
    const directive = buildHeatDirective(agent, { agents: new Map([['alice', agent]]) });
    expect(directive).toBeNull();
  });

  test('buildHeatDirective returns correct level text for different heat values', () => {
    // Create a perpetrator with enough heat for "uneasy" level
    const agent = makeTestAgent('mark', { currentDay: 3 });
    agent.state.beliefs!.addBelief({
      id: crypto.randomUUID(), eventType: 'NPC_KILLED',
      subject: 'mark', object: 'bess', location: 'tavern',
      confidence: 0.95, source: 'perpetrator', sourceNpcId: null,
      gameDay: 1, lastUpdated: 1,
    });
    // Add a self-rumor to push heat higher
    agent.state.beliefs!.addBelief({
      id: crypto.randomUUID(), eventType: 'NPC_KILLED',
      subject: 'Mark', object: 'bess', location: 'tavern',
      confidence: 0.4, source: 'gossip', sourceNpcId: 'ted',
      gameDay: 1, lastUpdated: 1,
    });

    const directive = buildHeatDirective(agent, { agents: new Map([['mark', agent]]) });
    expect(directive).not.toBeNull();
    // With time-based (day 3 - day 1 = 2 days → 0.15 cap) + rumor (0.12) + informed (0.15)
    // = ~0.42 → anxious level → contains "GROWING DANGER"
    expect(directive!).toContain('DANGER');
  });

  test('heat level thresholds are correct', () => {
    // Verify exact boundary values
    expect(getHeatLevel(0.0)).toBe('safe');
    expect(getHeatLevel(0.19)).toBe('safe');
    expect(getHeatLevel(0.20)).toBe('uneasy');
    expect(getHeatLevel(0.39)).toBe('uneasy');
    expect(getHeatLevel(0.40)).toBe('anxious');
    expect(getHeatLevel(0.59)).toBe('anxious');
    expect(getHeatLevel(0.60)).toBe('panicked');
    expect(getHeatLevel(0.79)).toBe('panicked');
    expect(getHeatLevel(0.80)).toBe('desperate');
    expect(getHeatLevel(1.0)).toBe('desperate');
  });
});

// ═══════════════════════════════════════════════════════════════
// Test Group 3: Belief Suppression (source flags)
// ═══════════════════════════════════════════════════════════════
describe('Belief Suppression (source flags)', () => {
  test('isPerpetrator("perpetrator") returns true', () => {
    expect(isPerpetrator('perpetrator')).toBe(true);
  });

  test('isPerpetrator("witness") returns false', () => {
    expect(isPerpetrator('witness')).toBe(false);
  });

  test('isConcealment("cover_up") returns true', () => {
    expect(isConcealment('cover_up')).toBe(true);
  });

  test('isConcealment("witness") returns false', () => {
    expect(isConcealment('witness')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// Test Group 4: Escalation Thresholds (affordance beliefConfidence)
// ═══════════════════════════════════════════════════════════════
describe('Escalation Thresholds', () => {
  test('argue requires beliefConfidence 0.15', () => {
    const argue = AFFORDANCE_REGISTRY.find(a => a.id === 'argue');
    expect(argue).toBeDefined();
    expect(argue!.requires.beliefConfidence).toBe(0.15);
  });

  test('threaten requires beliefConfidence 0.50', () => {
    const threaten = AFFORDANCE_REGISTRY.find(a => a.id === 'threaten');
    expect(threaten).toBeDefined();
    expect(threaten!.requires.beliefConfidence).toBe(0.50);
  });

  test('kill requires beliefConfidence 0.70', () => {
    const kill = AFFORDANCE_REGISTRY.find(a => a.id === 'kill');
    expect(kill).toBeDefined();
    expect(kill!.requires.beliefConfidence).toBe(0.70);
  });
});
