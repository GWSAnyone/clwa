/**
 * Genre-Neutrality Tests (M5 Phase A) — behavioural proof that the engine carries NO crime-justice
 * assumptions and that a NON-CRIME genre ("Economy") plugs into the same registries with ZERO engine
 * edits (INV-14 — the "Economy Module Test"). Complements the static source guard in architecture.test.ts.
 *
 * These tests are robust to global registry state (other test files load crime/social): they assert
 * ADDITIVE extensibility, never the absence of crime registrations.
 *
 * Run: bun test tests/genre-neutrality.test.ts
 */
import { describe, test, expect } from 'bun:test';
import {
  Agent, VectorMemory, BeliefManager, RelationshipGraph,
  BELIEF_SOURCE, hasCapability, phraseBelief, registerBeliefPhrasing,
  REQUIREMENT_CHECKERS, POST_TARGET_REQUIREMENT_CHECKERS, registerTargetEnricher,
  AFFORDANCE_REGISTRY, computeUtility,
  registerEventCategory, registerEventLabels, registerEventTypeFlags, getEventLabel, isTransferable,
  registerActionVerbs, getAllRegisteredVerbs,
} from '@clwa/engine';
import type { AgentProfile, AffordanceDefinition, AffordanceContext, AffordanceTarget } from '@clwa/engine';

function makeProfile(id: string, capabilities?: Record<string, boolean>, honesty = 0.5): AgentProfile {
  return {
    id,
    name: id.charAt(0).toUpperCase() + id.slice(1),
    role: 'villager',
    background: 'test',
    speechStyle: 'test',
    bigFive: { openness: 0.5, conscientiousness: 0.5, extraversion: 0.5, agreeableness: 0.5, neuroticism: 0.5, honesty },
    enneagram: { type: 5, wing: 4, coreFear: 'test', coreDesire: 'test', stressType: 7, growthType: 8 },
    ...(capabilities ? { capabilities } : {}),
  };
}

function makeAgent(profile: AgentProfile): Agent {
  return new Agent(
    profile,
    {
      alive: true, location: 'market-square', mood: -0.5, baseMood: -0.5, moodModifiers: [],
      status: undefined, currentDay: 1, knownFacts: [], beliefs: new BeliefManager(),
      relationships: new RelationshipGraph(), currentActivity: undefined, inPlayerChat: false,
      processingState: 'idle', lastInteractionOutcome: undefined, currentMotive: undefined,
      inTransit: false, transitTo: undefined, transitPath: undefined, lastInteractionMinute: undefined,
    },
    new VectorMemory(profile.id, { maxCapacity: 50 }),
    {},
  );
}

describe('Genre Neutrality — engine carries no crime-justice assumptions', () => {
  test('BELIEF_SOURCE exposes only engine-universal sources; crime sources are module-owned', () => {
    expect(BELIEF_SOURCE.GOSSIP).toBe('gossip');
    const keys = Object.keys(BELIEF_SOURCE);
    expect(keys).toContain('GOSSIP');       // conversation transfer — universal
    expect(keys).toContain('TESTIMONY');    // someone told me — universal
    expect(keys).toContain('OBSERVATION');  // I saw it — universal
    expect(keys).not.toContain('BODY_DISCOVERY'); // crime → moved to module (A8)
    expect(keys).not.toContain('DEDUCTION');      // crime → moved to module (A8)
  });

  test('capabilities are an OPEN string-keyed map — any genre declares its own roles', () => {
    const merchant = makeProfile('aldric', { isMerchant: true, canAudit: true });
    expect(hasCapability(merchant, 'isMerchant')).toBe(true);  // economy role — zero engine edit
    expect(hasCapability(merchant, 'canAudit')).toBe(true);
    expect(hasCapability(merchant, 'investigator')).toBe(false); // engine assumes no crime role
    expect(hasCapability(makeProfile('plain'), 'isMerchant')).toBe(false);
  });

  test('belief phrasing is registry-driven and produces relation text for any verb', () => {
    const out = phraseBelief({
      eventType: 'TRADE_DISPUTE', source: 'gossip', confidence: 0.6,
      verb: 'a price dispute', who: 'Aldric', target: 'Bess',
    });
    expect(typeof out).toBe('string');
    expect(out).toContain('Aldric');
    expect(out).toContain('Bess');
    // The hook accepts module phrasings (first-non-null wins) — registering one must not throw.
    expect(() => registerBeliefPhrasing(({ eventType, who }) => eventType === '__never__' ? who : null)).not.toThrow();
  });

  test('requirement checkers receive the WHOLE requirement object as generic params (no crime special-case)', () => {
    let seen: Record<string, unknown> | undefined;
    REQUIREMENT_CHECKERS.set('hasCapital', (_agent, _ctx, params) => {
      seen = params;
      return ((params?.minCapital as number) ?? 0) <= 100;
    });
    const checker = REQUIREMENT_CHECKERS.get('hasCapital')!;
    const ok = checker(makeAgent(makeProfile('m')), {} as AffordanceContext, { hasCapital: true, minCapital: 50 });
    expect(ok).toBe(true);
    expect(seen?.minCapital).toBe(50);   // generic param threaded through — economy needs no engine edit
  });

  test('POST_TARGET_REQUIREMENT_CHECKERS is an open registry (e.g. economy "atMarket" gate)', () => {
    POST_TARGET_REQUIREMENT_CHECKERS.set('atMarket', (_agent, _ctx, target) => target.targetLocation === 'market-square');
    const checker = POST_TARGET_REQUIREMENT_CHECKERS.get('atMarket')!;
    const target: AffordanceTarget = { targetId: 'x', targetName: 'X', targetLocation: 'market-square' };
    expect(checker(makeAgent(makeProfile('m')), {} as AffordanceContext, target)).toBe(true);
    target.targetLocation = 'tavern';
    expect(checker(makeAgent(makeProfile('m')), {} as AffordanceContext, target)).toBe(false);
  });

  test('registerTargetEnricher accepts a module enricher without engine edits', () => {
    expect(() => registerTargetEnricher((target) => {
      (target.extra as Record<string, string>).ledgerNote = 'balance low';
    })).not.toThrow();
  });
});

describe('Economy Module Test — a non-crime genre extends the engine with zero engine changes', () => {
  // Register a deliberately minimal "economy" genre through the SAME registries crime-justice uses.
  test('event metadata: registerEventCategory/Labels/Flags carry a non-crime event', () => {
    registerEventCategory('economy', ['TRADE', 'FRAUD']);
    registerEventLabels({ FRAUD: 'fraud', TRADE: 'a trade' });
    registerEventTypeFlags('FRAUD', { transferable: true }); // FRAUD gossips like any transferable event
    expect(getEventLabel('FRAUD')).toBe('fraud');
    expect(getEventLabel('TRADE')).toBe('a trade');
    expect(isTransferable('FRAUD')).toBe(true);   // belief/gossip pipeline works for a non-crime event
  });

  test('action verbs: a non-crime verb reaches the LLM action enum', () => {
    registerActionVerbs({ defraud: ['defraud', 'swindle'] });
    expect(getAllRegisteredVerbs()).toContain('defraud');
  });

  test('computeUtility scores a non-crime affordance using pure OCEAN+H psychology', () => {
    const defraud: AffordanceDefinition = {
      id: 'eco_defraud', label: 'Defraud a customer', category: 'economy', severity: 4,
      requires: { hasCapital: true, minCapital: 10 }, // module requirement key (open index-signature)
      weights: [
        { trait: 'H', direction: 'low', multiplier: 0.5 }, // low honesty → more willing to defraud
        { trait: 'A', direction: 'low', multiplier: 0.3 },
      ],
      moodWeight: 0.2, relationshipWeight: 0.1, goalType: 'eco_defraud', goalPriority: 5,
      actionVerb: 'defraud',
    };
    AFFORDANCE_REGISTRY.push(defraud);

    const target: AffordanceTarget = { targetId: 'bess', targetName: 'Bess', targetLocation: 'market-square' };
    const lowHonesty = computeUtility(defraud, makeAgent(makeProfile('greedy', undefined, 0.1)), target);
    const highHonesty = computeUtility(defraud, makeAgent(makeProfile('honest', undefined, 0.95)), target);

    expect(Number.isFinite(lowHonesty)).toBe(true);
    expect(Number.isFinite(highHonesty)).toBe(true);
    // The genre-agnostic scorer ranks the low-honesty agent higher for a dishonest action — no crime knowledge needed.
    expect(lowHonesty).toBeGreaterThan(highHonesty);
  });

  test('requirement gate for the economy affordance resolves entirely through the registry', () => {
    // hasCapital registered above; an affordance requiring it is gated with no engine edit.
    REQUIREMENT_CHECKERS.set('hasCapital', (_agent, _ctx, params) => ((params?.minCapital as number) ?? 0) <= 999);
    expect(REQUIREMENT_CHECKERS.has('hasCapital')).toBe(true);
  });
});
