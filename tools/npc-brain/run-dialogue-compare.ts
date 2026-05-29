/**
 * Phase 1 validation: dialogue BASELINE vs LAYERED prompt, same scenarios × 3 models.
 * Proves (or refutes) that the layered design lifts Qwen free-text dialogue before porting into the engine.
 *   bun tools/npc-brain/run-dialogue-compare.ts   (env MODELS=..., JUDGE_RUNS=2)
 */
import { runCall, dispose, type ModelKey } from './models';
import { FIXTURES, type Fixture } from './fixtures';
import { LAYERED } from './fixtures-layered';
import { scoreOutput, JUDGE_MODEL } from './judge';

const models = (process.env.MODELS?.split(',').map(s => s.trim()) as ModelKey[] | undefined) ?? ['qwen', 'haiku', 'sonnet'];
const JUDGE_RUNS = Number(process.env.JUDGE_RUNS ?? 2);
const RUNS = Number(process.env.RUNS ?? 1); // generations per fixture×model — averages out temperature variance
const baseDialogue = FIXTURES.filter(f => f.task === 'dialogue');

async function evalFixture(fx: Fixture, model: ModelKey) {
  const scores: number[] = []; let groundedCount = 0, judged = 0; let sample = ''; let ms = 0;
  for (let run = 0; run < RUNS; run++) {
    const r = await runCall(model, { system: fx.system, user: fx.user, maxTokens: fx.maxTokens, sampling: fx.sampling });
    ms = r.latencyMs;
    if (!r.ok || !r.content) { sample = sample || 'ERR:' + (r.error ?? r.finishReason); continue; }
    sample = r.content.replace(/\s+/g, ' ').trim().slice(0, 130);
    for (let j = 0; j < JUDGE_RUNS; j++) {
      const jdg = await scoreOutput(fx, r.content);
      if (jdg.ok && jdg.score > 0) { scores.push(jdg.score); judged++; if (jdg.grounded) groundedCount++; }
    }
  }
  const score = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  const grounded = judged ? groundedCount / judged >= 0.5 : false;
  return { score, grounded, sample, ms };
}

console.log(`\n═══ dialogue: BASELINE vs LAYERED ═══ models=[${models.join(', ')}] JUDGE_RUNS=${JUDGE_RUNS} judge=${JUDGE_MODEL}\n`);
for (const base of baseDialogue) {
  const lay = LAYERED.find(l => l.id === base.id);
  console.log(`■ ${base.id}`);
  for (const model of models) {
    const b = await evalFixture(base, model);
    const l = lay ? await evalFixture(lay, model) : null;
    const d = l ? (l.score - b.score >= 0 ? '+' : '') + (l.score - b.score).toFixed(1) : '—';
    console.log(`  ${model.padEnd(6)} base=${b.score.toFixed(1)} → layered=${l ? l.score.toFixed(1) : '—'} (Δ${d})  grounded ${b.grounded ? 'Y' : 'n'}→${l ? (l.grounded ? 'Y' : 'n') : '-'}`);
    if (l) console.log(`         base:    ${b.sample}`);
    if (l) console.log(`         layered: ${l.sample}`);
  }
  console.log();
}
await dispose();
