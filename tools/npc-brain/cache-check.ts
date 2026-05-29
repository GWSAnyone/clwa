/**
 * Empirical LM Studio prompt-cache probe (SPEC-npc-brain Phase 0, auditor finding P1).
 * Sends a LONG, byte-identical system prefix 10× with maxTokens=1 so wall-clock ≈ prompt-eval time.
 * If req 2..10 are NOT meaningfully faster than req 1, KV-cache reuse is not helping for Qwen3.5 in
 * LM Studio → treat L1/L2 byte-stability as code discipline, not a cost lever (claude-code cache is separate/real).
 *
 *   bun tools/npc-brain/cache-check.ts
 */
import { runCall, dispose } from './models';

// ~2k-token stable prefix (cache only matters above the provider's min prefix length).
const PARA = 'You are an NPC living in the medieval village of Millhaven. You have a rich inner life, relationships, secrets, and daily routines. You speak naturally and stay in character at all times. ';
const SYSTEM = PARA.repeat(40);
const USER = 'Reply with the single word: ok.';

const lat: number[] = [];
const pt: number[] = [];
for (let i = 0; i < 10; i++) {
  const r = await runCall('qwen', { system: SYSTEM, user: USER, maxTokens: 1, sampling: { temperature: 0.2 } });
  lat.push(r.latencyMs);
  pt.push(r.promptTokens);
  console.log(`  req ${String(i + 1).padStart(2)}: ${String(r.latencyMs).padStart(5)}ms  promptTokens=${r.promptTokens} ok=${r.ok}${r.error ? ' ERR:' + r.error : ''}`);
}

const first = lat[0];
const rest = lat.slice(1);
const avgRest = rest.reduce((a, b) => a + b, 0) / rest.length;
const minRest = Math.min(...rest);
console.log(`\n  prefix promptTokens≈${pt[0]}  first=${first}ms  avg(2..10)=${avgRest.toFixed(0)}ms  min(2..10)=${minRest}ms  ratio=${(avgRest / first).toFixed(2)}`);
console.log(
  avgRest < first * 0.7
    ? '  => CACHE LIKELY WORKING: later identical-prefix calls are notably faster. Byte-stable prefix IS a cost lever.'
    : '  => NO CLEAR PROMPT-CACHE BENEFIT on LM Studio/Qwen3.5: keep byte-stability as code discipline only, do not size ROI on it.',
);

await dispose();
