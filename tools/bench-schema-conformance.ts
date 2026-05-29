/**
 * Does Haiku reliably follow a JSON Schema when it's INJECTED INTO THE PROMPT (free-text, no --json-schema)?
 * Tests the prompt-injection approach in isolation (no native-schema fallback masking failures): for each
 * case we send `prompt + schema-instruction` as a free-text warm call, extract the JSON, and validate it
 * against the schema (parseable / required present / types / enums / no extra keys).
 *
 *   bun tools/bench-schema-conformance.ts            # 2 prompts × cases, haiku
 *   bun tools/bench-schema-conformance.ts sonnet 3   # model, reps per prompt
 */
import path from 'node:path';
import { ClaudeCodeProvider } from '../packages/providers/claude-code/src/index';

const MODEL = process.argv[2] ?? 'haiku';
const REPS = Math.max(1, parseInt(process.argv[3] ?? '2', 10));
const NPCS_ROOT = path.join(import.meta.dir, '../packages/server/data/claude-npcs');
const provider = new ClaudeCodeProvider({ npcsRoot: NPCS_ROOT, warmSessionMs: 1_800_000 });

type Schema = { schema: Record<string, any> };
const suffix = (s: Schema) => `Respond with ONLY a single JSON object — no prose, no markdown fences — strictly conforming to this JSON Schema:\n${JSON.stringify(s.schema)}`;
function extractJson(text: string): string | null {
  const start = text.indexOf('{'); if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) { const c = text[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true; else if (c === '{') depth++; else if (c === '}') { if (--depth === 0) { const cand = text.slice(start, i + 1); try { JSON.parse(cand); return cand; } catch { return null; } } } }
  return null;
}
/** Minimal validator for the schema subset we use (object/properties/type/enum/required/additionalProperties). */
function validate(obj: any, schema: Record<string, any>): string | null {
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return 'not an object';
  const props = schema.properties ?? {};
  for (const req of (schema.required ?? [])) if (!(req in obj)) return `missing required '${req}'`;
  if (schema.additionalProperties === false) for (const k of Object.keys(obj)) if (!(k in props)) return `extra key '${k}'`;
  for (const [k, v] of Object.entries(obj)) { const p = props[k]; if (!p) continue;
    if (p.enum && !p.enum.includes(v)) return `'${k}'=${JSON.stringify(v)} not in enum`;
    if (p.type === 'string' && typeof v !== 'string') return `'${k}' not string`;
    if (p.type === 'number' && typeof v !== 'number') return `'${k}' not number`;
    if (p.type === 'boolean' && typeof v !== 'boolean') return `'${k}' not boolean`;
    if (p.type === 'array' && !Array.isArray(v)) return `'${k}' not array`;
  }
  return null;
}

const CASES: { name: string; system: string; schema: Schema; prompts: string[] }[] = [
  { name: 'volition (6-enum)', system: 'You are Mark, a gruff merchant. Decide your next action.',
    schema: { schema: { type: 'object', properties: { action: { type: 'string', enum: ['trade','argue','threaten','steal','go_home','gossip'] }, target: { type: 'string' }, reason: { type: 'string' } }, required: ['action','target','reason'], additionalProperties: false } },
    prompts: ['Evening, market closing, mood low, Bess nearby.', 'Morning, busy market, you feel cheerful, a customer browses.'] },
  { name: 'npc-dialogue', system: 'You are Mark. Reply in character.',
    schema: { schema: { type: 'object', properties: { line: { type: 'string' }, mood: { type: 'string', enum: ['friendly','gruff','wary'] } }, required: ['line','mood'], additionalProperties: false } },
    prompts: ['A traveler asks what you sell.', 'A guard eyes your stall suspiciously.'] },
  { name: 'il-extract', system: 'Extract the structured meaning of the player utterance.',
    schema: { schema: { type: 'object', properties: { speechAct: { type: 'string', enum: ['inform','question','accuse','threaten','greet'] }, subject: { type: 'string' }, pressure: { type: 'string', enum: ['none','threat','guilt','bribe'] } }, required: ['speechAct','subject','pressure'], additionalProperties: false } },
    prompts: ['"I know you robbed Bess — confess or I call the guard."', '"Good morning! Lovely weather, isn\'t it?"'] },
  { name: 'number+boolean', system: 'You are a town guard assessing a situation.',
    schema: { schema: { type: 'object', properties: { threatLevel: { type: 'number' }, willIntervene: { type: 'boolean' }, note: { type: 'string' } }, required: ['threatLevel','willIntervene','note'], additionalProperties: false } },
    prompts: ['Two drunks shoving each other outside the tavern.', 'A child crying alone in the square.'] },
  { name: 'array+number', system: 'You are an investigator summarizing a case.',
    schema: { schema: { type: 'object', properties: { suspects: { type: 'array', items: { type: 'string' } }, topConfidence: { type: 'number' } }, required: ['suspects','topConfidence'], additionalProperties: false } },
    prompts: ['Evidence points to Mark and Ted; Mark is most likely.', 'No suspects yet, only a bloodied knife.'] },
  { name: 'verdict (5-enum)', system: 'You are Magistrate Theron. Deliver a verdict.',
    schema: { schema: { type: 'object', properties: { verdict: { type: 'string', enum: ['release','warning','fine','imprisonment','exile'] }, severity: { type: 'number' }, reasoning: { type: 'string' } }, required: ['verdict','severity','reasoning'], additionalProperties: false } },
    prompts: ['Merchant sold fake spices, strong evidence, minor harm.', 'Murder with witnesses, overwhelming evidence.'] },
];

console.log(`\n═══ Schema conformance via PROMPT INJECTION — ${MODEL}, ${REPS}×/prompt ═══\n`);
let total = 0, pass = 0;
for (const c of CASES) {
  for (const p of c.prompts) {
    for (let r = 0; r < REPS; r++) {
      total++;
      const res = await provider.call({ model: MODEL, system: c.system, user: `${p}\n\n${suffix(c.schema)}`, agentContext: { id: 'mark' } });
      const json = extractJson(res.content);
      let verdict = 'NO-JSON';
      if (json) { const err = validate(JSON.parse(json), c.schema.schema); verdict = err ? `BAD: ${err}` : 'OK'; if (!err) pass++; }
      console.log(`  ${c.name.padEnd(18)} ${verdict === 'OK' ? '✓' : '✗'} ${verdict.padEnd(28)} ${json ? json.slice(0, 60) : res.content.slice(0, 50)}`);
    }
  }
}
await provider.dispose();
console.log(`\n═══ CONFORMANCE: ${pass}/${total} = ${Math.round(pass / total * 100)}% schema-valid ═══`);
console.log(`  (prompt-injection, free-text, NO --json-schema. <100% → keep native --json-schema or add retry.)`);
