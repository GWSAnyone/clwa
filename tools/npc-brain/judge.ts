/**
 * NPC-brain harness — LLM-as-judge (SPEC-npc-brain Phase 0).
 * POINTWISE rubric scoring (1-5) — chosen over pairwise to sidestep position bias and the worst of
 * self-preference (the auditor's main concern was pairwise). Judge model is configurable via JUDGE_MODEL
 * (default 'haiku' — cheapest frontier; set to a non-contestant like 'opus' to fully remove self-preference).
 * run-baseline calls this J times per output and averages; divergence is reported.
 */
import { runCall, type ModelKey } from './models';
import type { Fixture } from './fixtures';
import type { LlmJsonSchema } from '../../packages/engine/src/llm-types';

export const JUDGE_MODEL = (process.env.JUDGE_MODEL as ModelKey) ?? 'haiku';

const JUDGE_SCHEMA: LlmJsonSchema = {
  name: 'judgement', strict: true,
  schema: { type: 'object', properties: {
    score: { type: 'integer', minimum: 1, maximum: 5, description: '1=broken/off-character/hallucinated, 3=acceptable, 5=excellent in-character & grounded' },
    inCharacter: { type: 'boolean' },
    grounded: { type: 'boolean', description: 'true if it only uses facts present in the input; false if it invents names/events' },
    issues: { type: 'string', description: 'one short line: the main flaw, or "none"' },
  }, required: ['score', 'inCharacter', 'grounded', 'issues'], additionalProperties: false },
};

export interface Judgement { score: number; inCharacter: boolean; grounded: boolean; issues: string; ok: boolean; }

export async function scoreOutput(fx: Fixture, output: string): Promise<Judgement> {
  const system = `You are a strict, impartial evaluator of game NPC AI outputs. You did NOT generate the output. Score it 1-5 against the rubric. Reward in-character voice and factual grounding; punish hallucinated names/events, breaking character, wrong format, and over/under-extraction. Respond ONLY with valid JSON.`;
  const user = `TASK: ${fx.task}
SCENARIO: ${fx.about}

RUBRIC (what a 5 looks like):
${fx.rubric}

--- INPUT GIVEN TO THE NPC ---
[system]
${fx.system}
[user]
${fx.user}

--- NPC OUTPUT TO JUDGE ---
${output || '(empty)'}

Score it. 5=excellent, 3=acceptable, 1=broken/off-character/hallucinated.`;
  // warm: the judge system prompt is CONSTANT across all judgements → one warm session is reused (cold-spawn
  // only once, then ~3-5s instead of ~70s). No-op for lm-studio judge.
  const r = await runCall(JUDGE_MODEL, { system, user, maxTokens: 200, sampling: { temperature: 0.0 }, jsonSchema: JUDGE_SCHEMA, warm: true });
  if (!r.ok || !r.content) return { score: 0, inCharacter: false, grounded: false, issues: 'judge-error: ' + (r.error ?? 'empty'), ok: false };
  try {
    const a = r.content.indexOf('{'); const b = r.content.lastIndexOf('}');
    const j = JSON.parse(r.content.slice(a, b + 1));
    return { score: Number(j.score) || 0, inCharacter: !!j.inCharacter, grounded: !!j.grounded, issues: String(j.issues ?? ''), ok: true };
  } catch {
    return { score: 0, inCharacter: false, grounded: false, issues: 'judge-parse-fail', ok: false };
  }
}
