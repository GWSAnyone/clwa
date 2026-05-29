/**
 * Investigation subsystem tests (A10 + A4b) — the PlayerJournal + dialogue-effect hook now live in the
 * crime-justice module, not the engine. These cover the deterministic logic that moved out.
 *
 * Run: bun test tests/investigation.test.ts
 */
import { describe, test, expect } from 'bun:test';
import { PlayerJournal } from '@clwa/modules';
import { getDialogueEffectHandlers, registerDialogueEffectHandler } from '@clwa/engine';

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
});
