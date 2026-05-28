/**
 * LlmUsageTracker + façade emit tests — Stage 7c.
 *
 * Покрывает:
 *   1. tracker.record + readAll round-trip (JSONL persistence)
 *   2. flush() ждёт queue (race-condition fix)
 *   3. getStats aggregation by task / provider / agent
 *   4. corrupt JSONL lines пропускаются
 *   5. _emitUsage срабатывает из façade для всех 4 примитивов
 *   6. cost gate блокирует когда возвращает reason
 *   7. cumulative cost tally (in-memory без disk read)
 */

import { describe, test, expect, beforeAll, beforeEach, afterAll } from 'bun:test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  classify,
  generate,
  generateStream,
  embed,
  registerLlmProvider,
  registerLlmTask,
  registerLlmRouter,
  registerLlmUsageRecorder,
  registerLlmCostGate,
  validateLlmRouterContract,
  disposeAllLlmProviders,
} from '@clwa/engine';
import type { LlmUsageEvent } from '@clwa/engine';
import { LlmUsageTracker } from '../packages/server/src/llm-usage-tracker';
import { FakeLlmProvider } from './fixtures/fake-llm-provider';

const TMP_DIR = path.join(import.meta.dir, '.tmp-usage-test');
const LOG_FILE = path.join(TMP_DIR, 'llm-usage.jsonl');

beforeAll(async () => {
  await fs.mkdir(TMP_DIR, { recursive: true });
});

afterAll(async () => {
  await fs.rm(TMP_DIR, { recursive: true, force: true }).catch(() => {});
});

function makeEvent(overrides?: Partial<LlmUsageEvent>): LlmUsageEvent {
  return {
    timestamp: Date.now(),
    task: 'volition',
    providerId: 'fake',
    modelId: 'fake-model',
    finishReason: 'stop',
    promptTokens: 100,
    completionTokens: 50,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    costUsd: 0.001,
    latencyMs: 250,
    hadSchema: true,
    ...overrides,
  };
}

describe('LlmUsageTracker — file persistence', () => {
  test('record + readAll round-trip preserves all fields', async () => {
    const tracker = new LlmUsageTracker(path.join(TMP_DIR, 'round-trip.jsonl'));
    await tracker.clear();
    const event = makeEvent({ task: 'verdict', costUsd: 0.0532 });
    await tracker.record(event);
    await tracker.flush();
    const events = await tracker.readAll();
    expect(events.length).toBe(1);
    expect(events[0].task).toBe('verdict');
    expect(events[0].costUsd).toBe(0.0532);
    expect(events[0].promptTokens).toBe(100);
  });

  test('flush() waits for pending writes (race-condition guard)', async () => {
    const tracker = new LlmUsageTracker(path.join(TMP_DIR, 'flush-race.jsonl'));
    await tracker.clear();
    // Записываем не дожидаясь await — типичный fire-and-forget pattern из façade
    void tracker.record(makeEvent({ task: 'a' }));
    void tracker.record(makeEvent({ task: 'b' }));
    void tracker.record(makeEvent({ task: 'c' }));
    await tracker.flush();
    const events = await tracker.readAll();
    expect(events.length).toBe(3);
  });

  test('corrupt JSONL lines are silently skipped', async () => {
    const file = path.join(TMP_DIR, 'corrupt.jsonl');
    await fs.writeFile(file, '{"task":"good","timestamp":1,"providerId":"p","modelId":"m","finishReason":"stop","promptTokens":1,"completionTokens":1,"cacheReadTokens":0,"cacheCreationTokens":0,"costUsd":0,"latencyMs":1,"hadSchema":false}\nnot-json-garbage\n{"task":"good2","timestamp":2,"providerId":"p","modelId":"m","finishReason":"stop","promptTokens":1,"completionTokens":1,"cacheReadTokens":0,"cacheCreationTokens":0,"costUsd":0,"latencyMs":1,"hadSchema":false}\n');
    const tracker = new LlmUsageTracker(file);
    const events = await tracker.readAll();
    expect(events.length).toBe(2);
    expect(events[0].task).toBe('good');
    expect(events[1].task).toBe('good2');
  });

  test('returns [] when file does not exist', async () => {
    const tracker = new LlmUsageTracker(path.join(TMP_DIR, 'never-existed.jsonl'));
    expect(await tracker.readAll()).toEqual([]);
  });

  test('mkdir on parent dir is idempotent', async () => {
    const deep = path.join(TMP_DIR, 'nested', 'dir', 'log.jsonl');
    const tracker = new LlmUsageTracker(deep);
    await tracker.record(makeEvent());
    await tracker.flush();
    const events = await tracker.readAll();
    expect(events.length).toBe(1);
  });
});

describe('LlmUsageTracker — getStats aggregation', () => {
  test('aggregates by task / provider / agent', async () => {
    const tracker = new LlmUsageTracker(path.join(TMP_DIR, 'agg.jsonl'));
    await tracker.clear();
    await tracker.record(makeEvent({ task: 'verdict', agentId: 'magistrate', costUsd: 0.05 }));
    await tracker.record(makeEvent({ task: 'verdict', agentId: 'magistrate', costUsd: 0.07 }));
    await tracker.record(makeEvent({ task: 'volition', agentId: 'mark', costUsd: 0, providerId: 'lm-studio' }));
    await tracker.flush();

    const stats = await tracker.getStats();
    expect(stats.eventCount).toBe(3);
    expect(stats.totalCostUsd).toBeCloseTo(0.12, 4);
    expect(stats.byTask['verdict'].count).toBe(2);
    expect(stats.byTask['verdict'].costUsd).toBeCloseTo(0.12, 4);
    expect(stats.byTask['volition'].count).toBe(1);
    expect(stats.byProvider['fake'].count).toBe(2);
    expect(stats.byProvider['lm-studio'].count).toBe(1);
    expect(stats.byAgent['magistrate'].count).toBe(2);
    expect(stats.byAgent['mark'].count).toBe(1);
  });

  test('filters by sinceMs / untilMs window', async () => {
    const tracker = new LlmUsageTracker(path.join(TMP_DIR, 'window.jsonl'));
    await tracker.clear();
    await tracker.record(makeEvent({ timestamp: 1000, task: 'a' }));
    await tracker.record(makeEvent({ timestamp: 2000, task: 'b' }));
    await tracker.record(makeEvent({ timestamp: 3000, task: 'c' }));
    await tracker.flush();
    const stats = await tracker.getStats({ sinceMs: 1500, untilMs: 2500 });
    expect(stats.eventCount).toBe(1);
    expect(stats.byTask['b']).toBeDefined();
    expect(stats.byTask['a']).toBeUndefined();
    expect(stats.byTask['c']).toBeUndefined();
  });

  test('errors counted separately', async () => {
    const tracker = new LlmUsageTracker(path.join(TMP_DIR, 'errors.jsonl'));
    await tracker.clear();
    await tracker.record(makeEvent({ finishReason: 'stop' }));
    await tracker.record(makeEvent({ finishReason: 'error' }));
    await tracker.record(makeEvent({ finishReason: 'schema_violation' }));
    await tracker.flush();
    const stats = await tracker.getStats();
    expect(stats.errorCount).toBe(2);
  });

  test('cumulative cost since boot tracks in-memory', async () => {
    const tracker = new LlmUsageTracker(path.join(TMP_DIR, 'cumulative.jsonl'));
    await tracker.clear();
    expect(tracker.getCumulativeCostSinceBoot().costUsd).toBe(0);
    await tracker.record(makeEvent({ costUsd: 0.1 }));
    await tracker.record(makeEvent({ costUsd: 0.2 }));
    await tracker.flush();
    expect(tracker.getCumulativeCostSinceBoot().costUsd).toBeCloseTo(0.3, 4);
    tracker.resetCumulative();
    expect(tracker.getCumulativeCostSinceBoot().costUsd).toBe(0);
  });
});

describe('Façade emits usage events for all 4 primitives', () => {
  let captured: LlmUsageEvent[] = [];

  beforeEach(async () => {
    captured = [];
    await disposeAllLlmProviders();
    registerLlmProvider(new FakeLlmProvider());
    registerLlmTask('embeddings', { requiresEmbeddings: true });
    registerLlmTask('volition', {});
    registerLlmTask('dialogue', { requiresStreaming: true });
    registerLlmTask('verdict', { requiresStructuredOutput: true });
    registerLlmRouter({
      default: { provider: 'fake', model: 'fake-model' },
      routes: {
        embeddings: { provider: 'fake', model: 'fake-embed' },
      },
    });
    registerLlmUsageRecorder((e) => { captured.push(e); });
    validateLlmRouterContract();
  });

  test('classify emits event', async () => {
    await classify('verdict', {
      system: 's', user: 'u',
      schema: { name: 'x', schema: { type: 'object', properties: { x: { type: 'string' } }, required: ['x'] } },
      agentContext: { id: 'mark' },
    });
    expect(captured.length).toBe(1);
    expect(captured[0].task).toBe('verdict');
    expect(captured[0].hadSchema).toBe(true);
    expect(captured[0].agentId).toBe('mark');
  });

  test('generate emits event', async () => {
    await generate('volition', { system: 's', user: 'u', agentContext: { id: 'bess' } });
    expect(captured.length).toBe(1);
    expect(captured[0].task).toBe('volition');
    expect(captured[0].hadSchema).toBe(false);
    expect(captured[0].agentId).toBe('bess');
  });

  test('generateStream emits event', async () => {
    await generateStream('dialogue', {
      system: 's', user: 'u', onToken: () => {},
    });
    expect(captured.length).toBe(1);
    expect(captured[0].task).toBe('dialogue');
  });

  test('embed emits event', async () => {
    await embed('text');
    expect(captured.length).toBe(1);
    expect(captured[0].task).toBe('embeddings');
  });
});

describe('Cost gate blocks calls when limit exceeded', () => {
  beforeEach(async () => {
    await disposeAllLlmProviders();
    registerLlmProvider(new FakeLlmProvider());
    registerLlmTask('embeddings', { requiresEmbeddings: true });
    registerLlmTask('volition', {});
    registerLlmTask('verdict', { requiresStructuredOutput: true });
    registerLlmRouter({
      default: { provider: 'fake', model: 'fake-model' },
      routes: { embeddings: { provider: 'fake', model: 'fake-embed' } },
    });
    validateLlmRouterContract();
  });

  test('classify returns null when gate blocks', async () => {
    registerLlmCostGate(async () => ({ reason: 'budget exceeded' }));
    const result = await classify('verdict', {
      system: 's', user: 'u',
      schema: { name: 'x', schema: { type: 'object', properties: { x: { type: 'string' } }, required: ['x'] } },
    });
    expect(result).toBeNull();
  });

  test('generate returns null when gate blocks', async () => {
    registerLlmCostGate(async () => ({ reason: 'budget exceeded' }));
    const result = await generate('volition', { system: 's', user: 'u' });
    expect(result).toBeNull();
  });

  test('embed returns null when gate blocks', async () => {
    registerLlmCostGate(async () => ({ reason: 'budget exceeded' }));
    const result = await embed('text');
    expect(result).toBeNull();
  });

  test('gate sees task and agentId', async () => {
    let seenTask: string | undefined;
    let seenAgent: string | undefined;
    registerLlmCostGate(async (task, agentId) => {
      seenTask = task;
      seenAgent = agentId;
      return null; // allow
    });
    await generate('volition', { system: 's', user: 'u', agentContext: { id: 'ted' } });
    expect(seenTask).toBe('volition');
    expect(seenAgent).toBe('ted');
  });

  test('gate throwing exception does NOT block call (fail-open)', async () => {
    registerLlmCostGate(async () => { throw new Error('gate crashed'); });
    const result = await generate('volition', { system: 's', user: 'u' });
    expect(result).not.toBeNull(); // call still went through
  });
});
