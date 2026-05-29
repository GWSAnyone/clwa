/**
 * Investigation subsystem tests (A10 + A4b) — the PlayerJournal + dialogue-effect hook now live in the
 * crime-justice module, not the engine. These cover the deterministic logic that moved out.
 *
 * Run: bun test tests/investigation.test.ts
 */
import { describe, test, expect, beforeAll } from 'bun:test';
import { PlayerJournal, registerInvestigationModule } from '@clwa/modules';
import {
  getDialogueEffectHandlers, registerDialogueEffectHandler, applyDialogueMeaning,
  Agent, VectorMemory, BeliefManager, RelationshipGraph, InMemoryEventStore,
} from '@clwa/engine';
import type { AgentProfile, DialogueMeaning, ILEffectContext } from '@clwa/engine';
import { setupFakeLlm } from './fixtures/fake-llm-provider';

beforeAll(setupFakeLlm);

function makeAgent(id: string, name: string, isPlayer = false): Agent {
  const profile: AgentProfile = {
    id, name, role: 'villager', background: 't', speechStyle: 't',
    bigFive: { openness: 0.5, conscientiousness: 0.5, extraversion: 0.5, agreeableness: 0.5, neuroticism: 0.5, honesty: 0.5 },
    enneagram: { type: 5, wing: 4, coreFear: 't', coreDesire: 't', stressType: 7, growthType: 8 },
    ...(isPlayer ? { isPlayer: true } : {}),
  };
  return new Agent(profile, {
    alive: true, location: 'tavern', mood: 0, baseMood: 0, moodModifiers: [], status: undefined,
    currentDay: 1, knownFacts: [], beliefs: new BeliefManager(), relationships: new RelationshipGraph(),
    processingState: 'idle', inTransit: false,
  }, new VectorMemory(id, { maxCapacity: 20 }), {});
}

/** Minimal IL scenario: an NPC being talked to (with a relationship to the player) + the player. */
function makeIlScenario(): { ctx: ILEffectContext; meaning: DialogueMeaning } {
  const npc = makeAgent('guard', 'Guard');
  const player = makeAgent('hero', 'Hero', true);
  npc.state.relationships!.addRelationship({ targetId: 'hero', targetName: 'Hero', type: 'acquaintance', sentiment: 0.1, trust: 0.5 });
  const agents = new Map([['guard', npc], ['hero', player]]);
  const ctx: ILEffectContext = {
    targetAgent: npc, playerAgent: player, agents, eventStore: new InMemoryEventStore(),
    gameDay: 1, effects: [],
  };
  const meaning: DialogueMeaning = { speechAct: 'inform', extractionConfidence: 1 };
  return { ctx, meaning };
}

describe('PlayerJournal — case-summary scoring (moved to crime-justice, A10)', () => {
  test('quality tiers map to combined evidence weight, capped at 1.0', () => {
    const strong = new PlayerJournal();
    const e = strong.addClue('a bloodstain', 'tavern', 1, 0, undefined, ['mark']);
    e.evidenceCategory = 'trace';
    e.evidenceWeight = 0.8;
    const sStrong = strong.getCaseSummary('mark', 'Mark');
    expect(sStrong.totalScore).toBeCloseTo(0.8, 5);
    expect(sStrong.quality).toBe('strong');     // >= 0.7
    expect(sStrong.evidence.trace).toBe(1);
    expect(sStrong.perpetratorName).toBe('Mark');

    const insufficient = new PlayerJournal();
    insufficient.addTestimony('heard something', 'Bess', 'bess', 'square', 1, 0, ['mark']); // default 0.12
    expect(insufficient.getCaseSummary('mark', 'Mark').quality).toBe('insufficient'); // 0.12 < 0.2

    const weak = new PlayerJournal();
    const w = weak.addClue('x', 'square', 1, 0, undefined, ['mark']);
    w.evidenceWeight = 0.3;
    expect(weak.getCaseSummary('mark', 'Mark').quality).toBe('weak'); // 0.2..0.4
  });

  test('weight caps at 1.0 regardless of evidence volume', () => {
    const j = new PlayerJournal();
    for (let i = 0; i < 20; i++) {
      const e = j.addClue('clue ' + i, 'square', 1, i, undefined, ['mark']);
      e.evidenceWeight = 0.5;
    }
    const s = j.getCaseSummary('mark', 'Mark');
    expect(s.totalScore).toBe(1.0);
    expect(s.quality).toBe('strong');
  });

  test('only entries related to the suspect count', () => {
    const j = new PlayerJournal();
    const a = j.addClue('about mark', 'square', 1, 0, undefined, ['mark']); a.evidenceWeight = 0.8;
    const b = j.addClue('about ted', 'square', 1, 1, undefined, ['ted']); b.evidenceWeight = 0.8;
    expect(j.getCaseSummary('mark', 'Mark').entries.length).toBe(1);
    expect(j.getEntriesForSuspect('ted').length).toBe(1);
  });
});

describe('PlayerJournal — suspect tracking + persistence round-trip', () => {
  test('markSuspect toggles', () => {
    const j = new PlayerJournal();
    expect(j.markSuspect('mark')).toBe(true);
    expect(j.isSuspect('mark')).toBe(true);
    expect(j.getSuspects()).toEqual(['mark']);
    expect(j.markSuspect('mark')).toBe(false); // toggle off
    expect(j.isSuspect('mark')).toBe(false);
  });

  test('canPresent / markPresented gate evidence presentation per NPC', () => {
    const j = new PlayerJournal();
    const e = j.addClue('the knife', 'tavern', 1, 0, undefined, ['mark']);
    e.evidenceCategory = 'weapon';
    expect(j.canPresent(e.id, 'bess')).toBe(true);
    expect(j.markPresented(e.id, 'bess')).toBe(true);
    expect(j.canPresent(e.id, 'bess')).toBe(false);  // already presented
    expect(j.markPresented(e.id, 'bess')).toBe(false);
    expect(j.canPresent(e.id, 'ted')).toBe(true);    // different NPC still open
  });

  test('toJSON/fromJSON preserves entries, suspects, and presentedTo', () => {
    const j = new PlayerJournal();
    const e = j.addTestimony('saw it happen', 'Bess', 'bess', 'tavern', 2, 5, ['mark']);
    e.evidenceWeight = 0.5;
    j.markSuspect('mark');
    j.markPresented(e.id, 'aldric');

    const restored = PlayerJournal.fromJSON(j.toJSON());
    expect(restored.count).toBe(1);
    expect(restored.getSuspects()).toEqual(['mark']);
    expect(restored.getCaseSummary('mark', 'Mark').totalScore).toBeCloseTo(0.5, 5);
    expect(restored.canPresent(e.id, 'aldric')).toBe(false); // presentedTo survived
    expect(restored.canPresent(e.id, 'ted')).toBe(true);
  });

  test('fromJSON accepts the legacy flat-array save shape', () => {
    const legacy = [{ id: 'x', type: 'clue' as const, text: 't', source: 'loc', relatedNpcs: ['mark'], gameDay: 1, tick: 0 }];
    const restored = PlayerJournal.fromJSON(legacy);
    expect(restored.count).toBe(1);
    expect(restored.getEntriesForSuspect('mark').length).toBe(1);
  });
});

describe('Dialogue-effect hook (A4b) — engine delegates genre dialogue effects to modules', () => {
  test('registerDialogueEffectHandler adds a handler; engine exposes the registry', () => {
    const before = getDialogueEffectHandlers().length;
    const probe = () => ['__probe__'];
    registerDialogueEffectHandler(probe);
    const after = getDialogueEffectHandlers();
    expect(after.length).toBe(before + 1);
    expect(after).toContain(probe);
  });

  test('applyDialogueMeaning CALLS registered handlers with the real (meaning, ctx) and merges their output', async () => {
    // The registry test above only proves the array grew. This proves the load-bearing contract: the engine
    // actually invokes the handler with the live meaning/ctx and splices its return into the structured output.
    // Sentinel-gated so the (un-removable) global registration stays inert for every real/other dialogue call.
    let receivedMeaning: DialogueMeaning | undefined;
    let receivedCtx: ILEffectContext | undefined;
    registerDialogueEffectHandler((meaning, ctx) => {
      if (!(meaning as unknown as { __e2eProbe?: boolean }).__e2eProbe) return [];
      receivedMeaning = meaning;
      receivedCtx = ctx;
      return ['__E2E_SECTION__'];
    });

    const { ctx, meaning } = makeIlScenario();
    (meaning as unknown as { __e2eProbe?: boolean }).__e2eProbe = true;

    const out = await applyDialogueMeaning(meaning, ctx);
    expect(receivedMeaning).toBe(meaning); // engine passed the REAL meaning object…
    expect(receivedCtx).toBe(ctx);         // …and the REAL ctx (not a copy)
    expect(out).toContain('__E2E_SECTION__'); // handler return merged into applyDialogueMeaning output
  });

  test('the real registerInvestigationModule handler emits verbatim evidence-presentation prose through the seam', async () => {
    // Locks the crime regression-oracle behavior at the extraction point: the relocated evidence-presentation
    // prose must still render when presentedEvidence rides in ctx and the engine dispatches the module handler.
    registerInvestigationModule(); // idempotent for a .toContain assertion (duplicate section still contains)
    const { ctx, meaning } = makeIlScenario();
    ctx.presentedEvidence = [
      { id: 'ev1', text: 'a bloodied knife', eventType: 'NPC_KILLED', evidenceCategory: 'weapon', evidenceWeight: 0.8, perpetratorName: 'Mark', suspectId: 'mark' },
    ];

    const out = await applyDialogueMeaning(meaning, ctx);
    expect(out).toContain('[EVIDENCE PRESENTED]');
    expect(out).toContain('a bloodied knife');
    expect(out).toContain('pointing to Mark');
    expect(out).toContain('not just hearsay');               // verbatim crime-scene framing
    expect(ctx.effects.some((e) => e.type === 'belief_created')).toBe(true); // the mechanical effect fired
  });
});
