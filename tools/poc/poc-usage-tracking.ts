/**
 * Stage 6 verification: cost/usage tracking end-to-end.
 *
 * 1. Wire LlmUsageTracker через registerLlmUsageRecorder
 * 2. Сделать несколько vyzov: verdict (Claude/Sonnet), npc-dialogue (LM Studio), embed (LM Studio)
 * 3. Прочитать JSONL → проверить что каждый записан со своими полями
 * 4. getStats() — проверить агрегацию by task / provider / agent
 *
 * Запуск: bun run packages/server/src/poc-usage-tracking.ts
 */

import path from 'node:path';
import { promises as fs } from 'node:fs';
import {
  classify,
  embed,
  registerLlmProvider,
  registerLlmTask,
  registerLlmRouter,
  registerLlmUsageRecorder,
  validateLlmRouterContract,
  disposeAllLlmProviders,
} from '@clwa/engine';
import { LMStudioProvider } from '../../packages/providers/lm-studio/src/index';
import { ClaudeCodeProvider } from '../../packages/providers/claude-code/src/index';
import { LlmUsageTracker } from '../../packages/server/src/llm-usage-tracker';
import { buildDefaultRouter } from '../../packages/server/src/llm-defaults';

const NPCS_ROOT = path.join(import.meta.dir, '../../packages/server/data/claude-npcs');
const USAGE_FILE = path.join(import.meta.dir, '../../packages/server/data/llm-usage-poc.jsonl');

// Clean slate
try { await fs.unlink(USAGE_FILE); } catch { /* ok */ }

const tracker = new LlmUsageTracker(USAGE_FILE);

// Boot
registerLlmProvider(new LMStudioProvider({ baseUrl: 'http://localhost:1234' }));
registerLlmProvider(new ClaudeCodeProvider({ npcsRoot: NPCS_ROOT, maxConcurrency: 1 }));
registerLlmTask('verdict', { requiresStructuredOutput: true });
registerLlmTask('npc-dialogue', {});
registerLlmRouter(buildDefaultRouter());
registerLlmUsageRecorder((e) => tracker.record(e));
validateLlmRouterContract();

console.log('═══ Triggering 3 LLM calls of different kinds ═══\n');

// 1. Embedding (LM Studio, fast, cheap)
console.log('  [1/3] embed("test text for vector")...');
const vec = await embed('test text for vector retrieval');
console.log(`    → ${vec ? `${vec.length}-dim vector` : 'null'}`);

// 2. NPC dialogue classification (LM Studio + json_schema)
console.log('  [2/3] classify("npc-dialogue") on Mark...');
const reply = await classify<{ greeting: string; mood: 'happy' | 'neutral' | 'gloomy' }>('npc-dialogue', {
  system: 'You are Mark. Greet the customer briefly.',
  user: 'A customer approaches your stall.',
  schema: {
    name: 'mark_greeting',
    schema: {
      type: 'object',
      properties: {
        greeting: { type: 'string' },
        mood: { type: 'string', enum: ['happy', 'neutral', 'gloomy'] },
      },
      required: ['greeting', 'mood'],
      additionalProperties: false,
    },
  },
  agentContext: { id: 'mark' },
});
console.log(`    → ${JSON.stringify(reply)}`);

// 3. Verdict via Claude (Sonnet route — самое дорогое)
console.log('  [3/3] classify("verdict") on Magistrate...');
const verdict = await classify<{ verdict: string; reasoning: string }>('verdict', {
  system: 'You are Magistrate Theron. Deliver a brief verdict.',
  user: 'A merchant sold common herbs as exotic spices. Strong evidence. Severity 4/10. What is your verdict?',
  schema: {
    name: 'verdict',
    schema: {
      type: 'object',
      properties: {
        verdict: { type: 'string', enum: ['release', 'warning', 'fine', 'imprisonment', 'exile'] },
        reasoning: { type: 'string' },
      },
      required: ['verdict', 'reasoning'],
      additionalProperties: false,
    },
  },
  agentContext: { id: 'magistrate' },
});
console.log(`    → ${JSON.stringify(verdict)}`);

// Façade emit_usage — fire-and-forget. Ждём флаш чтобы JSONL был синхронизирован с диском.
await tracker.flush();

console.log('\n═══ Reading JSONL log ═══\n');

const events = await tracker.readAll();
console.log(`File: ${USAGE_FILE}`);
console.log(`Events written: ${events.length}`);
for (const e of events) {
  console.log(`  • ${new Date(e.timestamp).toISOString()} task=${e.task} provider=${e.providerId} model=${e.modelId} agent=${e.agentId ?? '-'} cost=$${e.costUsd.toFixed(4)} latency=${e.latencyMs}ms tokens=${e.promptTokens}/${e.completionTokens} cache_read=${e.cacheReadTokens}`);
}

console.log('\n═══ getStats() aggregate ═══\n');
const stats = await tracker.getStats();
console.log(JSON.stringify(stats, null, 2));

console.log('\n═══ Validation ═══');
console.log(`  ✓ event_count == 3: ${events.length === 3 ? 'OK' : `FAIL got ${events.length}`}`);
console.log(`  ✓ all events have providerId: ${events.every(e => e.providerId) ? 'OK' : 'FAIL'}`);
console.log(`  ✓ all events have task: ${events.every(e => e.task) ? 'OK' : 'FAIL'}`);
console.log(`  ✓ verdict event has cost > 0 (Claude paid): ${events.find(e => e.task === 'verdict')?.costUsd! > 0 ? 'OK' : `FAIL got ${events.find(e => e.task === 'verdict')?.costUsd}`}`);
console.log(`  ✓ embed event has cost = 0 (LM Studio local): ${events.find(e => e.task === 'embeddings')?.costUsd === 0 ? 'OK' : 'FAIL'}`);
console.log(`  ✓ stats.byTask has 3 keys: ${Object.keys(stats.byTask).length === 3 ? 'OK' : 'FAIL'}`);
console.log(`  ✓ stats.byAgent has Mark and Magistrate: ${stats.byAgent['mark'] && stats.byAgent['magistrate'] ? 'OK' : 'FAIL'}`);

await disposeAllLlmProviders();
