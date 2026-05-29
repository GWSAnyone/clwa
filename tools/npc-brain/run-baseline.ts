/**
 * NPC-brain harness — baseline runner (SPEC-npc-brain Phase 0).
 * Feeds every fixture to each model, judges each output (pointwise, J runs), aggregates
 * quality + tokens/cost/latency + schema-pass, writes JSON + markdown report.
 *
 *   bun tools/npc-brain/run-baseline.ts
 * Env: MODELS=qwen,haiku,sonnet  TASKS=dialogue,il,...  RUNS=1  JUDGE_RUNS=1  OUT=<path>
 * Real baseline (auditor): JUDGE_RUNS=3 (divergence reported); a quick pipeline check uses defaults.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { runCall, dispose, type ModelKey } from './models';
import { FIXTURES, type Fixture } from './fixtures';
import { scoreOutput, JUDGE_MODEL, type Judgement } from './judge';

const ALL_MODELS: ModelKey[] = ['qwen', 'haiku', 'sonnet'];
const models = (process.env.MODELS?.split(',').map(s => s.trim()) as ModelKey[] | undefined)?.filter(m => ALL_MODELS.includes(m)) ?? ALL_MODELS;
const tasksFilter = process.env.TASKS?.split(',').map(s => s.trim());
const RUNS = Number(process.env.RUNS ?? 1);
const JUDGE_RUNS = Number(process.env.JUDGE_RUNS ?? 1);
const fixtures = FIXTURES.filter(f => !tasksFilter || tasksFilter.includes(f.task));

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pct = (n: number, d: number) => (d ? Math.round((100 * n) / d) : 0);

interface Cell {
  scores: number[]; inChar: number; grounded: number; judged: number; judgeDiverge: number;
  latencies: number[]; costs: number[]; promptTok: number[]; complTok: number[];
  ok: number; schemaPass: number; schemaTotal: number; n: number; sample: string; sampleErr: string;
}
const blank = (): Cell => ({ scores: [], inChar: 0, grounded: 0, judged: 0, judgeDiverge: 0, latencies: [], costs: [], promptTok: [], complTok: [], ok: 0, schemaPass: 0, schemaTotal: 0, n: 0, sample: '', sampleErr: '' });
const grid: Record<string, Record<ModelKey, Cell>> = {};

console.log(`\n═══ NPC-brain BASELINE ═══  models=[${models.join(', ')}]  fixtures=${fixtures.length}  RUNS=${RUNS}  JUDGE_RUNS=${JUDGE_RUNS}  judge=${JUDGE_MODEL}\n`);

for (const fx of fixtures) {
  const key = `${fx.task}/${fx.id}`;
  grid[key] ??= { qwen: blank(), haiku: blank(), sonnet: blank() };
  for (const model of models) {
    const cell = grid[key][model];
    for (let run = 0; run < RUNS; run++) {
      const r = await runCall(model, { system: fx.system, user: fx.user, maxTokens: fx.maxTokens, sampling: fx.sampling, jsonSchema: fx.jsonSchema });
      cell.n++;
      cell.latencies.push(r.latencyMs); cell.costs.push(r.costUsd); cell.promptTok.push(r.promptTokens); cell.complTok.push(r.completionTokens);
      if (r.ok) cell.ok++;
      if (r.schemaValid !== null) { cell.schemaTotal++; if (r.schemaValid) cell.schemaPass++; }
      if (!cell.sample && r.ok) cell.sample = r.content.replace(/\s+/g, ' ').trim().slice(0, 180);
      if (!r.ok && !cell.sampleErr) cell.sampleErr = r.error ?? r.finishReason;

      if (r.ok && r.content) {
        const js: Judgement[] = [];
        for (let j = 0; j < JUDGE_RUNS; j++) js.push(await scoreOutput(fx, r.content));
        const valid = js.filter(j => j.ok && j.score > 0);
        if (valid.length) {
          const s = valid.map(j => j.score);
          cell.scores.push(avg(s));
          cell.inChar += valid.filter(j => j.inCharacter).length / valid.length;
          cell.grounded += valid.filter(j => j.grounded).length / valid.length;
          cell.judged++;
          if (Math.max(...s) - Math.min(...s) >= 2) cell.judgeDiverge++;
        }
      }
    }
    const c = cell;
    console.log(`  ${key.padEnd(34)} ${model.padEnd(6)} score=${avg(c.scores).toFixed(2)} ok=${c.ok}/${c.n} schema=${c.schemaTotal ? pct(c.schemaPass, c.schemaTotal) + '%' : '—'} ${Math.round(avg(c.latencies))}ms $${avg(c.costs).toFixed(4)}${c.sampleErr ? ' ERR:' + c.sampleErr : ''}`);
  }
}

// ── Report ──
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = process.env.OUT ?? path.join(import.meta.dir, 'out');
mkdirSync(outDir, { recursive: true });
const jsonPath = path.join(outDir, `baseline-${stamp}.json`);
const mdPath = path.join(outDir, `baseline-${stamp}.md`);
writeFileSync(jsonPath, JSON.stringify({ models, RUNS, JUDGE_RUNS, judge: JUDGE_MODEL, stamp, grid }, null, 2));

let md = `# NPC-brain baseline — ${stamp}\n\nmodels: ${models.join(', ')} · RUNS=${RUNS} · JUDGE_RUNS=${JUDGE_RUNS} · judge=${JUDGE_MODEL}\n\nScore 1-5 (judge pointwise). schema = JSON-parse pass rate (structured tasks only).\n`;
for (const key of Object.keys(grid)) {
  md += `\n## ${key}\n\n| model | score | inChar | grounded | schema | ms | cost$ | in/out tok | sample |\n|---|---|---|---|---|---|---|---|---|\n`;
  for (const model of models) {
    const c = grid[key][model];
    const sample = (c.sample || (c.sampleErr ? 'ERR: ' + c.sampleErr : '')).replace(/\|/g, '\\|');
    md += `| ${model} | ${avg(c.scores).toFixed(2)} | ${pct(Math.round(c.inChar), c.judged)}% | ${pct(Math.round(c.grounded), c.judged)}% | ${c.schemaTotal ? pct(c.schemaPass, c.schemaTotal) + '%' : '—'} | ${Math.round(avg(c.latencies))} | ${avg(c.costs).toFixed(4)} | ${Math.round(avg(c.promptTok))}/${Math.round(avg(c.complTok))} | ${sample} |\n`;
  }
}
writeFileSync(mdPath, md);
console.log(`\n  report → ${mdPath}\n          ${jsonPath}`);
await dispose();
