/**
 * PoC: real-time memory awareness test.
 *
 * Цель: проверить что Claude в `-p` режиме читает per-NPC файлы памяти СВЕЖИМИ на каждом вызове
 * (file-based memory persistence без перезапуска процесса). Indirect questions — не просим Claude
 * "прочитай файл", а косвенно прощупываем знание из in-character диалога.
 *
 * 3 шага:
 *   1. PLANT — записываем новое observation в memory/observations.md, спрашиваем косвенно
 *   2. EDIT  — добавляем second observation в тот же файл, спрашиваем "что необычного видишь"
 *   3. ADD   — создаём НОВЫЙ файл memory/rumors.md + добавляем @-импорт в CLAUDE.md, спрашиваем
 *
 * Каждый шаг отдельный claude -p вызов (cold spawn). Если файлы читаются на cwd-load —
 * информация должна "просочиться" в ответ. Если кэш — Claude ответит без свежих данных.
 */

import path from 'node:path';
import { promises as fs } from 'node:fs';
import {
  generate,
  registerLlmProvider,
  registerLlmTask,
  registerLlmRouter,
  validateLlmRouterContract,
  disposeAllLlmProviders,
} from '@clwa/engine';
import { LMStudioProvider } from '../../packages/providers/lm-studio/src/index';
import { ClaudeCodeProvider } from '../../packages/providers/claude-code/src/index';

const NPCS_ROOT = path.join(import.meta.dir, '../../packages/server/data/claude-npcs');
const MARK_DIR = path.join(NPCS_ROOT, 'mark');

// ─── Boot ──────────────────────────────────────────────────────────

registerLlmProvider(new LMStudioProvider({ baseUrl: 'http://localhost:1234' }));
registerLlmProvider(new ClaudeCodeProvider({ npcsRoot: NPCS_ROOT, maxConcurrency: 1 }));
registerLlmTask('npc-dialogue', {});
registerLlmRouter({
  default: { provider: 'claude-code', model: 'haiku', maxTokens: 400 },
  routes: {
    'npc-dialogue': { provider: 'claude-code', model: 'haiku', maxTokens: 400 },
    // embeddings обязательно на провайдере с embeddings=true (engine task bootstrap)
    embeddings: { provider: 'lm-studio', model: 'text-embedding-nomic-embed-text-v1.5@q8_0' },
  },
});
validateLlmRouterContract();

// Helper: ask Mark a question, return reply
async function askMark(question: string): Promise<string> {
  const start = Date.now();
  const reply = await generate('npc-dialogue', {
    system: 'You are Mark. Stay in character. Respond to the customer briefly.',
    user: question,
    agentContext: { id: 'mark' },
  });
  console.log(`  [${Date.now() - start}ms] Mark: ${reply}`);
  return reply ?? '';
}

// Helper: detect keyword case-insensitive
function mentions(text: string, ...needles: string[]): string[] {
  const hits: string[] = [];
  const lower = text.toLowerCase();
  for (const n of needles) if (lower.includes(n.toLowerCase())) hits.push(n);
  return hits;
}

// ─── Test 1: PLANT a new observation, ask indirectly ───────────────

console.log('\n═══ TEST 1: Plant new observation, query indirectly ═══');

// Reset observations file to a single specific item Claude couldn't know otherwise
const plantedObservation = `# Observations
- [m720] Yesterday at the tavern, you overheard Garrett bitterly complaining: "These cheating merchants don't pay enough taxes. Theron looks the other way for coin." He'd had several drinks.
`;
await fs.writeFile(path.join(MARK_DIR, 'memory', 'observations.md'), plantedObservation);
console.log('  [planted] observations.md: Garrett complained about merchants & magistrate corruption');

const q1 = 'Hey Mark, you spend time at the tavern, right? Anything bothering Garrett lately? He seemed off when I saw him.';
console.log(`  [you] ${q1}`);
const r1 = await askMark(q1);
const hits1 = mentions(r1, 'tavern', 'complain', 'tax', 'merchant', 'Garrett', 'pay', 'drink', 'wine', 'ale', 'overheard', 'Theron', 'corrupt');
console.log(`  ✓ keyword hits: [${hits1.join(', ')}]`);
console.log(`  → ${hits1.length >= 3 ? 'PASS — Mark уцепил ≥3 свежих ключей из observations.md' : 'WEAK — мало ключей, возможно Claude не прочёл свежий файл'}`);

// ─── Test 2: EDIT — append another observation, ask different angle ───

console.log('\n═══ TEST 2: Edit memory (append), query different angle ═══');

const additionalObservation = `- [m900] Today you saw Garrett at your stall, buying a expensive Valdris spice. He paid in fresh silver coin — unusual given how he complains about poverty.
`;
await fs.appendFile(path.join(MARK_DIR, 'memory', 'observations.md'), additionalObservation);
console.log('  [edited] appended: Garrett bought expensive spice in silver coin');

const q2 = 'Mark, the guard has been acting strange around your stall today. Did you notice anything?';
console.log(`  [you] ${q2}`);
const r2 = await askMark(q2);
const hits2 = mentions(r2, 'spice', 'silver', 'coin', 'buy', 'purchase', 'paid', 'expensive', 'Valdris', 'stall', 'unusual', 'odd', 'poverty');
console.log(`  ✓ keyword hits: [${hits2.join(', ')}]`);
console.log(`  → ${hits2.length >= 2 ? 'PASS — Mark подцепил appended observation' : 'WEAK — appended запись не читается'}`);

// ─── Test 3: ADD a new memory file + new @-import in CLAUDE.md ────

console.log('\n═══ TEST 3: New file + @-import, query indirectly ═══');

const rumorsContent = `# Rumors I've heard
- [m480] Old Bess whispered to me at dawn: she saw Magistrate Theron entering the courthouse alone at midnight last night. "Strange hour for a judge," she said.
`;
await fs.writeFile(path.join(MARK_DIR, 'memory', 'rumors.md'), rumorsContent);

// Append @-import to CLAUDE.md
const claudeMdPath = path.join(MARK_DIR, 'CLAUDE.md');
const claudeMdContent = await fs.readFile(claudeMdPath, 'utf-8');
if (!claudeMdContent.includes('@memory/rumors.md')) {
  const updated = claudeMdContent.replace('@memory/reflections.md', '@memory/reflections.md\n@memory/rumors.md');
  await fs.writeFile(claudeMdPath, updated);
  console.log('  [added] memory/rumors.md + @-import line in CLAUDE.md');
} else {
  console.log('  [skip] @memory/rumors.md already imported, file content updated');
}

const q3 = 'Mark, between you and me — is there anything odd happening in town at strange hours? I just have a feeling.';
console.log(`  [you] ${q3}`);
const r3 = await askMark(q3);
const hits3 = mentions(r3, 'midnight', 'night', 'late', 'magistrate', 'Theron', 'courthouse', 'Bess', 'whisper', 'judge', 'strange hour', 'dark');
console.log(`  ✓ keyword hits: [${hits3.join(', ')}]`);
console.log(`  → ${hits3.length >= 2 ? 'PASS — Claude подтянул новый файл rumors.md через @-import' : 'WEAK — новый @-импорт не читается'}`);

// ─── Test 4 (control): ask something the memory does NOT contain ──

console.log('\n═══ TEST 4 (control): question with no memory backing ═══');

const q4 = 'Mark, what color is the moon tonight?';
console.log(`  [you] ${q4}`);
const r4 = await askMark(q4);
console.log('  → Если Claude уверенно соврал бы про midnight Theron здесь — значит он галлюцинирует. Если в характере отшил вопрос — модель здорова.');

// ─── Summary ───────────────────────────────────────────────────────

console.log('\n═══ Summary ═══');
console.log(`Test 1 (plant):  ${hits1.length} hits`);
console.log(`Test 2 (edit):   ${hits2.length} hits`);
console.log(`Test 3 (add):    ${hits3.length} hits`);
console.log('\nЧтобы подтвердить, что чтение СВЕЖЕЕ а не кэш: каждый из 3 ответов содержит детали из ТОЛЬКО соответствующего файла.');

await disposeAllLlmProviders();
