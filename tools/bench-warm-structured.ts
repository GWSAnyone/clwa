/**
 * Verifies + measures the OPT-IN warm structured-call path (ClaudeCodeProvider.call with warmSessionMs>0).
 * N structured calls (same agent+model+schema): turn 1 cold-spawns, turns 2..N reuse the warm session.
 *
 *   bun tools/bench-warm-structured.ts          # 5 calls, haiku
 *   bun tools/bench-warm-structured.ts 6 sonnet
 */
import path from 'node:path';
import { ClaudeCodeProvider } from '../packages/providers/claude-code/src/index';
import type { LlmJsonSchema } from '@clwa/engine';

const N = Math.max(2, parseInt(process.argv[2] ?? '5', 10));
const MODEL = process.argv[3] ?? 'haiku';
const NPCS_ROOT = path.join(import.meta.dir, '../packages/server/data/claude-npcs');

// warmSessionMs>0 turns the path ON (30 min idle here).
const provider = new ClaudeCodeProvider({ npcsRoot: NPCS_ROOT, warmSessionMs: 1_800_000, maxConcurrency: 2 });

const SYSTEM = 'You are Mark, a gruff merchant in Millhaven. Reply in character.';
const SCHEMA: LlmJsonSchema = {
  name: 'npc_line',
  schema: { type: 'object', properties: {
    line: { type: 'string' }, mood: { type: 'string', enum: ['friendly', 'gruff', 'wary'] },
  }, required: ['line', 'mood'], additionalProperties: false },
};
const PROMPTS = [
  'A traveler asks what you sell.', 'They ask if prices are fair.', 'They mention Bess.',
  'They ask about the guard.', 'They say goodbye.', 'A new customer asks for spices.',
];

console.log(`\n═══ Warm STRUCTURED call path — ${MODEL}, ${N} calls (NPC: mark) ═══\n`);
const rows: { n: number; warm: boolean; ms: number; ok: boolean }[] = [];

for (let i = 0; i < N; i++) {
  const start = Date.now();
  const r = await provider.call({ model: MODEL, system: SYSTEM, user: PROMPTS[i % PROMPTS.length], jsonSchema: SCHEMA, agentContext: { id: 'mark' } });
  const ms = Date.now() - start;
  let ok = false, preview = '';
  try { const o = JSON.parse(r.content); ok = typeof o.line === 'string' && !!o.mood; preview = `${o.mood}: ${String(o.line).slice(0, 44)}`; } catch { preview = r.content.slice(0, 44); }
  rows.push({ n: i + 1, warm: i > 0, ms, ok });
  console.log(`  call ${String(i + 1).padStart(2)} ${i > 0 ? 'WARM' : 'COLD'}  ${String(ms).padStart(6)}ms  ${ok ? 'valid' : 'INVALID'}  → ${preview}`);
}

await provider.dispose();

const cold = rows.find((r) => !r.warm)!;
const warm = rows.filter((r) => r.warm);
const avg = (xs: number[]) => xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length) : 0;
console.log(`\n═══ SUMMARY ═══`);
console.log(`  COLD (call 1):            ${cold.ms}ms`);
console.log(`  WARM (calls 2..${N}, avg):   ${avg(warm.map((r) => r.ms))}ms`);
console.log(`  valid structured output: ${rows.every((r) => r.ok) ? 'ALL OK' : rows.filter((r) => !r.ok).length + ' INVALID'}`);
console.log(`  → vs cold-spawn-per-call (~19s) the warm path is the win for repeated structured calls.`);
