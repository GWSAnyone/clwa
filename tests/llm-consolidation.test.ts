/**
 * NpcMemoryManager.consolidateObservations tests — Stage 8a.
 *
 * Покрывает edge cases:
 *   1. Trigger: > keepRecent + consolidateOldest entries → консолидация
 *   2. No-op: при count < threshold (важно — не должен срабатывать преждевременно)
 *   3. LLM returns null → no-op (НЕ удаляет данные, иначе data loss при сбое LLM)
 *   4. Atomic: после успешной консолидации observations.md содержит header + последние keepRecent
 *   5. Order: consolidated entries — oldest (FIFO), не random
 *   6. Append: reflections.md дополняется, не перезаписывается
 *   7. Header preserved: '# Observations' header сохраняется
 *   8. Empty file → no-op
 */

import { describe, test, expect, beforeAll, beforeEach, afterAll } from 'bun:test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { NpcMemoryManager } from '../packages/server/src/npc-memory-manager';

const TMP_DIR = path.join(import.meta.dir, '.tmp-consolidation-test');
const NPCS_ROOT = path.join(TMP_DIR, 'claude-npcs');

beforeAll(async () => {
  await fs.mkdir(NPCS_ROOT, { recursive: true });
});

afterAll(async () => {
  await fs.rm(TMP_DIR, { recursive: true, force: true }).catch(() => {});
});

async function setupNpc(id: string, observationLines: string[]): Promise<NpcMemoryManager> {
  const mgr = new NpcMemoryManager(NPCS_ROOT);
  await mgr.ensureNpcDir(id, { personality: '# Test NPC' });
  const obsFile = path.join(NPCS_ROOT, id, 'memory', 'observations.md');
  await fs.writeFile(obsFile, ['# Observations', ...observationLines].join('\n'));
  // Сбросить reflections.md в фиксированный header, чтобы изолировать тесты
  const reflFile = path.join(NPCS_ROOT, id, 'memory', 'reflections.md');
  await fs.writeFile(reflFile, '# Reflections\n');
  return mgr;
}

function lines(file: string): Promise<string[]> {
  return fs.readFile(file, 'utf-8').then((s) => s.split('\n'));
}

describe('NpcMemoryManager.consolidateObservations', () => {
  test('triggers consolidation when count >= keepRecent + consolidateOldest', async () => {
    const id = 'trigger-test';
    const entries = Array.from({ length: 50 }, (_, i) => `- [m${i * 60}] observation ${i}`);
    const mgr = await setupNpc(id, entries);
    const did = await mgr.consolidateObservations(id, async () => 'consolidated insight', {
      keepRecent: 25,
      consolidateOldest: 25,
      gameMinute: 1000,
    });
    expect(did).toBe(true);
  });

  test('no-op when count < threshold (preserve data, no premature LLM call)', async () => {
    const id = 'below-threshold';
    const entries = Array.from({ length: 30 }, (_, i) => `- obs ${i}`);
    const mgr = await setupNpc(id, entries);
    let llmCalled = false;
    const did = await mgr.consolidateObservations(
      id,
      async () => {
        llmCalled = true;
        return 'should not be called';
      },
      { keepRecent: 25, consolidateOldest: 25, gameMinute: 100 },
    );
    expect(did).toBe(false);
    expect(llmCalled).toBe(false);
  });

  test('LLM returns null → no-op (CRITICAL: no data loss on LLM failure)', async () => {
    const id = 'llm-null';
    const entries = Array.from({ length: 50 }, (_, i) => `- obs ${i}`);
    const mgr = await setupNpc(id, entries);
    const did = await mgr.consolidateObservations(id, async () => null, {
      keepRecent: 25,
      consolidateOldest: 25,
      gameMinute: 100,
    });
    expect(did).toBe(false);
    // Файл должен остаться нетронутым
    const obsLines = await lines(path.join(NPCS_ROOT, id, 'memory', 'observations.md'));
    expect(obsLines[0]).toBe('# Observations');
    const entryCount = obsLines.filter((l) => l.startsWith('-')).length;
    expect(entryCount).toBe(50);
  });

  test('after consolidation: observations.md keeps header + most recent N', async () => {
    const id = 'truncation';
    const entries = Array.from({ length: 50 }, (_, i) => `- obs-${i}`);
    const mgr = await setupNpc(id, entries);
    await mgr.consolidateObservations(id, async () => 'summary', {
      keepRecent: 25,
      consolidateOldest: 25,
      gameMinute: 100,
    });
    const obsLines = await lines(path.join(NPCS_ROOT, id, 'memory', 'observations.md'));
    expect(obsLines[0]).toBe('# Observations');
    const entries2 = obsLines.filter((l) => l.startsWith('-'));
    expect(entries2.length).toBe(25);
    // Последние 25 — это obs-25 ... obs-49
    expect(entries2[0]).toBe('- obs-25');
    expect(entries2[24]).toBe('- obs-49');
  });

  test('consolidated entries are oldest (FIFO order preserved)', async () => {
    const id = 'fifo';
    const entries = Array.from({ length: 50 }, (_, i) => `- obs-${i}`);
    const mgr = await setupNpc(id, entries);
    let llmGotPrompt = '';
    await mgr.consolidateObservations(
      id,
      async (prompt) => {
        llmGotPrompt = prompt;
        return 'summary';
      },
      { keepRecent: 25, consolidateOldest: 25, gameMinute: 100 },
    );
    // LLM должен получить obs-0..obs-24, не obs-25..obs-49
    expect(llmGotPrompt).toContain('obs-0');
    expect(llmGotPrompt).toContain('obs-24');
    expect(llmGotPrompt).not.toContain('obs-25');
    expect(llmGotPrompt).not.toContain('obs-49');
  });

  test('reflections.md is APPENDED (not overwritten)', async () => {
    const id = 'append-refl';
    const entries = Array.from({ length: 50 }, (_, i) => `- obs-${i}`);
    const mgr = await setupNpc(id, entries);
    // Pre-existing reflection
    const reflFile = path.join(NPCS_ROOT, id, 'memory', 'reflections.md');
    await fs.writeFile(reflFile, '# Reflections\n- [m50] earlier insight\n');

    await mgr.consolidateObservations(id, async () => 'new insight from consolidation', {
      keepRecent: 25,
      consolidateOldest: 25,
      gameMinute: 1500,
    });

    const reflLines = await lines(reflFile);
    expect(reflLines[0]).toBe('# Reflections');
    const insights = reflLines.filter((l) => l.startsWith('-'));
    expect(insights.length).toBe(2); // earlier + new
    expect(insights[0]).toContain('earlier insight');
    expect(insights[1]).toContain('new insight from consolidation');
    expect(insights[1]).toContain('m1500'); // gameMinute marker
  });

  test('reflection line contains "consolidated from N observations" marker', async () => {
    const id = 'marker';
    const entries = Array.from({ length: 50 }, (_, i) => `- obs-${i}`);
    const mgr = await setupNpc(id, entries);
    await mgr.consolidateObservations(id, async () => 'distilled wisdom', {
      keepRecent: 25,
      consolidateOldest: 25,
      gameMinute: 200,
    });
    const reflText = await fs.readFile(path.join(NPCS_ROOT, id, 'memory', 'reflections.md'), 'utf-8');
    expect(reflText).toContain('consolidated from 25 observations');
    expect(reflText).toContain('distilled wisdom');
  });

  test('empty observations.md → no-op', async () => {
    const id = 'empty';
    const mgr = new NpcMemoryManager(NPCS_ROOT);
    await mgr.ensureNpcDir(id, { personality: '# Empty' });
    // observations.md создан с просто header'ом '# Observations\n'
    const did = await mgr.consolidateObservations(id, async () => 'should not call', {
      keepRecent: 25,
      consolidateOldest: 25,
      gameMinute: 100,
    });
    expect(did).toBe(false);
  });

  test('exact threshold (50 entries, keepRecent=25, consolidateOldest=25) — triggers', async () => {
    const id = 'exact-threshold';
    const entries = Array.from({ length: 50 }, (_, i) => `- obs-${i}`);
    const mgr = await setupNpc(id, entries);
    const did = await mgr.consolidateObservations(id, async () => 's', {
      keepRecent: 25,
      consolidateOldest: 25,
      gameMinute: 100,
    });
    expect(did).toBe(true);
  });

  test('one less than threshold (49) — no-op', async () => {
    const id = 'just-below';
    const entries = Array.from({ length: 49 }, (_, i) => `- obs-${i}`);
    const mgr = await setupNpc(id, entries);
    const did = await mgr.consolidateObservations(id, async () => 's', {
      keepRecent: 25,
      consolidateOldest: 25,
      gameMinute: 100,
    });
    expect(did).toBe(false);
  });

  test('observations.md non-existent → no-op (no crash)', async () => {
    const mgr = new NpcMemoryManager(NPCS_ROOT);
    // НЕ вызываем ensureNpcDir — папки нет
    const did = await mgr.consolidateObservations('ghost-npc', async () => 's', {
      keepRecent: 25,
      consolidateOldest: 25,
      gameMinute: 100,
    });
    expect(did).toBe(false);
  });
});
