/**
 * A/B benchmark: Claude Haiku (claude-code) vs local Qwen (lm-studio) as the NPC model.
 * Runs the SAME representative prompts through both, N times each, and tabulates
 * latency / prompt-tokens (context) / completion-tokens / cost.
 *
 *   bun tools/bench-haiku-vs-qwen.ts          # N=3 per case
 *   bun tools/bench-haiku-vs-qwen.ts 5        # N=5
 *
 * Requires: LM Studio up on :1234 (qwen) + claude CLI logged in (haiku via subscription, no paid API).
 */
import path from 'node:path';
import { promises as fs } from 'node:fs';
import {
  classify, registerLlmProvider, registerLlmTask, registerLlmRouter,
  registerLlmUsageRecorder, validateLlmRouterContract, disposeAllLlmProviders,
} from '@clwa/engine';
import { LMStudioProvider } from '../packages/providers/lm-studio/src/index';
import { ClaudeCodeProvider } from '../packages/providers/claude-code/src/index';
import { LlmUsageTracker } from '../packages/server/src/llm-usage-tracker';

const N = Math.max(1, parseInt(process.argv[2] ?? '3', 10));
const NPCS_ROOT = path.join(import.meta.dir, '../packages/server/data/claude-npcs');
const USAGE_FILE = path.join(import.meta.dir, '../packages/server/data/bench-usage.jsonl');
const QWEN = 'qwen3.5-9b-abliterated';

try { await fs.unlink(USAGE_FILE); } catch { /* ok */ }
const tracker = new LlmUsageTracker(USAGE_FILE);

registerLlmProvider(new LMStudioProvider({ baseUrl: process.env.LMSTUDIO_URL ?? 'http://localhost:1234' }));
registerLlmProvider(new ClaudeCodeProvider({ npcsRoot: NPCS_ROOT, maxConcurrency: 2 }));

// Two routes for the SAME work — one per model under test.
registerLlmTask('bench-qwen', { requiresStructuredOutput: true });
registerLlmTask('bench-haiku', { requiresStructuredOutput: true });
registerLlmRouter({
  default: { provider: 'lm-studio', model: QWEN },
  routes: {
    'bench-qwen': { provider: 'lm-studio', model: QWEN, maxTokens: 120, sampling: { temperature: 0.35 } },
    'bench-haiku': { provider: 'claude-code', model: 'haiku', maxTokens: 120, sampling: { temperature: 0.35 } },
    embeddings: { provider: 'lm-studio', model: 'text-embedding-nomic-embed-text-v1.5@q8_0' },
  },
});
registerLlmUsageRecorder((e) => tracker.record(e));
validateLlmRouterContract();

// ─── Representative cases (mirror the hot NPC tasks currently on Qwen) ───
const PERSONA = `You are Mark, a merchant in the town of Millhaven. Greedy, low honesty, anxious about debts.
You sell spices and cloth. You resent Bess the herbalist (she undercuts you). The town has a guard (Garrett)
and a magistrate (Theron). Stay in character; be concise.`;

const CASES = [
  {
    key: 'volition',
    system: PERSONA + '\nDecide your next action given your mood and situation.',
    user: 'It is evening, the market is closing. Your mood is low (-0.4). Bess is alone nearby. Choose one action.',
    schema: { name: 'decision', schema: { type: 'object', properties: {
      action: { type: 'string', enum: ['trade', 'argue', 'threaten', 'steal', 'go_home', 'gossip'] },
      target: { type: 'string' }, reason: { type: 'string' } },
      required: ['action', 'target', 'reason'], additionalProperties: false } },
  },
  {
    key: 'il-extract',
    system: 'Extract the structured meaning of the player\'s utterance to an NPC. Be precise.',
    user: 'Player says to Mark: "I know you stole from Bess. Tell me the truth or I go to the guard."',
    schema: { name: 'meaning', schema: { type: 'object', properties: {
      speechAct: { type: 'string', enum: ['inform', 'question', 'accuse', 'threaten', 'greet'] },
      subject: { type: 'string' }, pressure: { type: 'string', enum: ['none', 'threat', 'guilt', 'bribe'] } },
      required: ['speechAct', 'subject', 'pressure'], additionalProperties: false } },
  },
  {
    key: 'dialogue',
    system: PERSONA + '\nReply to the customer in one short in-character line.',
    user: 'A traveler approaches your stall and asks what you are selling.',
    schema: { name: 'line', schema: { type: 'object', properties: {
      line: { type: 'string' }, mood: { type: 'string', enum: ['friendly', 'gruff', 'wary'] } },
      required: ['line', 'mood'], additionalProperties: false } },
  },
] as const;

console.log(`\n═══ Haiku vs Qwen — ${N}× per case (${CASES.length} cases) ═══\n`);

for (const c of CASES) {
  for (const model of ['bench-qwen', 'bench-haiku'] as const) {
    for (let i = 0; i < N; i++) {
      process.stdout.write(`  ${c.key.padEnd(11)} ${model === 'bench-qwen' ? 'qwen ' : 'haiku'} ${i + 1}/${N} ... `);
      try {
        const r = await classify(model, { system: c.system, user: c.user, schema: c.schema, agentContext: { id: 'mark' } });
        process.stdout.write(r ? 'ok\n' : 'null\n');
      } catch (e) {
        process.stdout.write(`ERR ${(e as Error).message?.slice(0, 60)}\n`);
      }
    }
  }
}

await tracker.flush();

// ─── Aggregate ───
const events = await tracker.readAll();
type Agg = { n: number; lat: number; pt: number; ct: number; cost: number; cache: number };
const byModel = new Map<string, Agg>();
for (const e of events) {
  const k = `${e.providerId}/${e.modelId}`;
  const a = byModel.get(k) ?? { n: 0, lat: 0, pt: 0, ct: 0, cost: 0, cache: 0 };
  a.n++; a.lat += e.latencyMs; a.pt += e.promptTokens; a.ct += e.completionTokens; a.cost += e.costUsd; a.cache += e.cacheReadTokens ?? 0;
  byModel.set(k, a);
}

console.log(`\n═══ RESULTS (avg per call, ${events.length} calls) ═══\n`);
console.log('  model'.padEnd(32) + 'calls  avgLatency  promptTok  complTok  cacheRead   $/call    $/1k-calls');
console.log('  ' + '─'.repeat(98));
for (const [k, a] of byModel) {
  const row = '  ' + k.padEnd(30)
    + String(a.n).padStart(5)
    + (Math.round(a.lat / a.n) + 'ms').padStart(12)
    + String(Math.round(a.pt / a.n)).padStart(11)
    + String(Math.round(a.ct / a.n)).padStart(10)
    + String(Math.round(a.cache / a.n)).padStart(11)
    + ('$' + (a.cost / a.n).toFixed(5)).padStart(10)
    + ('$' + (a.cost / a.n * 1000).toFixed(2)).padStart(13);
  console.log(row);
}

// Per-case latency split
console.log('\n  per-case avg latency (ms):');
for (const c of CASES) {
  const q = events.filter((e) => e.task === 'bench-qwen' && e.agentId === 'mark');
  const h = events.filter((e) => e.task === 'bench-haiku' && e.agentId === 'mark');
  // tracker doesn't carry case key; approximate by interleaving order is unreliable → skip per-case, show task split
  void c; break;
}
const qEv = events.filter((e) => e.task === 'bench-qwen');
const hEv = events.filter((e) => e.task === 'bench-haiku');
const avg = (xs: number[]) => xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length) : 0;
console.log(`    qwen : latency ${avg(qEv.map((e) => e.latencyMs))}ms  prompt ${avg(qEv.map((e) => e.promptTokens))}tok  compl ${avg(qEv.map((e) => e.completionTokens))}tok  cost $0 (local)`);
console.log(`    haiku: latency ${avg(hEv.map((e) => e.latencyMs))}ms  prompt ${avg(hEv.map((e) => e.promptTokens))}tok  compl ${avg(hEv.map((e) => e.completionTokens))}tok  total cost $${hEv.reduce((s, e) => s + e.costUsd, 0).toFixed(4)}`);

console.log(`\n  raw log: ${USAGE_FILE}`);
await disposeAllLlmProviders();
