/**
 * Measures the speed win of a PERSISTENT (warm) Claude streaming session vs cold-spawn.
 * Drives ClaudeCodeProvider.stream() with N sequential turns for one NPC: turn 1 pays the cold-spawn,
 * turns 2..N reuse the in-process session (no respawn) — "max speed without the Claude start cost".
 *
 *   bun tools/bench-warm-session.ts          # 5 turns (1 cold + 4 warm), model haiku
 *   bun tools/bench-warm-session.ts 6 sonnet
 *
 * Requires: claude CLI logged in. (No LM Studio needed — this is claude-code only.)
 */
import path from 'node:path';
import { ClaudeCodeProvider } from '../packages/providers/claude-code/src/index';

const TURNS = Math.max(2, parseInt(process.argv[2] ?? '5', 10));
const MODEL = process.argv[3] ?? 'haiku';
const NPCS_ROOT = path.join(import.meta.dir, '../packages/server/data/claude-npcs');

const provider = new ClaudeCodeProvider({ npcsRoot: NPCS_ROOT, sessionIdleMs: 600_000, maxConcurrency: 2 });

const SYSTEM = `You are Mark, a gruff merchant in Millhaven. Reply in ONE short in-character sentence.`;
const PROMPTS = [
  'A traveler asks what you sell.',
  'They ask if your prices are fair.',
  'They mention Bess the herbalist.',
  'They ask about the guard Garrett.',
  'They say goodbye.',
  'A new customer asks for spices.',
  'They haggle on the price.',
  'They ask where to find the magistrate.',
];

function now(): number { return Date.now(); } // ms

console.log(`\n═══ Warm persistent session vs cold-spawn — ${MODEL}, ${TURNS} turns (NPC: mark) ═══\n`);

type Row = { turn: number; warm: boolean; firstTokenMs: number; totalMs: number; chars: number };
const rows: Row[] = [];

for (let t = 0; t < TURNS; t++) {
  const user = PROMPTS[t % PROMPTS.length];
  const start = now();
  let firstToken = -1;
  let chars = 0;
  let reply = '';
  try {
    for await (const chunk of provider.stream({ model: MODEL, system: SYSTEM, user, agentContext: { id: 'mark' } })) {
      if (chunk.type === 'token' && chunk.content) {
        if (firstToken < 0) firstToken = now() - start;
        chars += chunk.content.length;
        reply += chunk.content;
      } else if (chunk.type === 'error') {
        console.log(`  turn ${t + 1}: ERROR ${chunk.error?.message?.slice(0, 80)}`);
        break;
      }
    }
  } catch (e) {
    console.log(`  turn ${t + 1}: THROW ${(e as Error).message?.slice(0, 80)}`);
    continue;
  }
  const total = now() - start;
  const warm = t > 0; // turn 1 is the cold spawn; the pool keeps the session warm afterwards
  rows.push({ turn: t + 1, warm, firstTokenMs: Math.round(firstToken), totalMs: Math.round(total), chars });
  console.log(`  turn ${String(t + 1).padStart(2)} ${warm ? 'WARM' : 'COLD'}  first-token ${String(Math.round(firstToken)).padStart(6)}ms  total ${String(Math.round(total)).padStart(6)}ms  → "${reply.slice(0, 50).replace(/\n/g, ' ')}"`);
}

await provider.dispose();

// ─── Summary ───
const cold = rows.find((r) => !r.warm);
const warm = rows.filter((r) => r.warm);
const avg = (xs: number[]) => xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length) : 0;
console.log(`\n═══ SUMMARY ═══`);
if (cold) console.log(`  COLD  (turn 1, incl. claude spawn): first-token ${cold.firstTokenMs}ms · total ${cold.totalMs}ms`);
if (warm.length) {
  console.log(`  WARM  (turns 2..${TURNS}, reused session): first-token ${avg(warm.map(r => r.firstTokenMs))}ms · total ${avg(warm.map(r => r.totalMs))}ms (avg of ${warm.length})`);
  if (cold) {
    const speedup = (cold.totalMs / Math.max(1, avg(warm.map(r => r.totalMs)))).toFixed(1);
    console.log(`  → warm is ~${speedup}× faster end-to-end; the cold-spawn cost (~${cold.totalMs - avg(warm.map(r => r.totalMs))}ms) is paid ONCE per conversation, not per turn.`);
  }
}
