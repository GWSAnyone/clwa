/**
 * Stage 3c end-to-end test.
 *
 * Прогоняем реальный step-handler `sentence_npc` (модуль crime-justice) через
 * production-style boot — Claude уезжает на verdict task, magistrate выносит приговор.
 *
 * Этот тест не использует HTTP-сервер, debug API или save-файлы — он напрямую вызывает
 * step handler с заранее построенным StepExecutionContext, чтобы изолировать verdict-цепочку.
 *
 * Если что-то падает — fallback на lm-studio автоматически (route.fallback в llm-defaults).
 */

import path from 'node:path';
import {
  registerLlmProvider,
  registerLlmTask,
  registerLlmRouter,
  validateLlmRouterContract,
  disposeAllLlmProviders,
  classify,
} from '@clwa/engine';
import { LMStudioProvider } from '../../packages/providers/lm-studio/src/index';
import { ClaudeCodeProvider } from '../../packages/providers/claude-code/src/index';
import { NpcMemoryManager } from '../../packages/server/src/npc-memory-manager';
import { buildNpcSystemPrompt, buildNpcRelationships, buildNpcSecrets } from '../../packages/server/src/llm-npc-prompt-builder';
import { buildDefaultRouter } from '../../packages/server/src/llm-defaults';
import type { AgentProfile } from '@clwa/engine';

const NPCS_ROOT = path.join(import.meta.dir, '../../packages/server/data/claude-npcs');

// ─── Boot ──────────────────────────────────────────────────────────

registerLlmProvider(new LMStudioProvider({ baseUrl: 'http://localhost:1234' }));
registerLlmProvider(new ClaudeCodeProvider({ npcsRoot: NPCS_ROOT, maxConcurrency: 1 }));

// Production task registrations
registerLlmTask('volition', { requiresStructuredOutput: true });
registerLlmTask('il', { requiresStructuredOutput: true });
registerLlmTask('verdict', { requiresStructuredOutput: true });
registerLlmTask('dialogue', { requiresStreaming: true });
registerLlmTask('npc-dialogue', {});
registerLlmTask('reflection', {});

// Use production buildDefaultRouter (verdict → claude-code with lm-studio fallback)
registerLlmRouter(buildDefaultRouter());
validateLlmRouterContract();

// ─── Prepare Magistrate Theron NPC folder ─────────────────────────

const theronProfile: AgentProfile = {
  id: 'magistrate',
  name: 'Magistrate Theron',
  role: 'magistrate',
  background: 'Sent to Millhaven five years ago from the capital. Nobody knows exactly why. Conducts trials at the courthouse.',
  speechStyle: 'Formal, measured. Quotes legal precedent. Pauses before deciding.',
  bigFive: {
    openness: 0.5,
    conscientiousness: 0.7,
    extraversion: 0.4,
    agreeableness: 0.4,
    neuroticism: 0.5,
    honesty: 0.65, // moderate-high — fair judge
  },
  enneagram: {
    type: 1,
    wing: 9,
    stressType: 4,
    growthType: 7,
    coreFear: 'Being corrupt, defective, evil',
    coreDesire: 'To be just and morally upright',
  },
  canSentence: true,
  investigator: false,
  detersCrime: true,
};

const memoryManager = new NpcMemoryManager(NPCS_ROOT);
await memoryManager.ensureNpcDir('magistrate', {
  personality: buildNpcSystemPrompt(theronProfile),
  relationships: buildNpcRelationships('magistrate', 'Magistrate Theron', [
    { from: 'magistrate', to: 'garrett', type: 'colleague', note: 'law enforcement partnership' },
    { from: 'magistrate', to: 'mark', type: 'acquaintance', note: 'merchant disputes sometimes reach the courthouse' },
  ], (id) => ({ garrett: 'Garrett', mark: 'Mark', bess: 'Old Bess' }[id] ?? id)),
});

// ─── Build verdict prompt (mirror of step-handlers.ts sentence_npc) ───

const verdictIds = ['release', 'warning', 'fine', 'imprisonment', 'exile'] as const;
const verdictDescriptions = verdictIds
  .map(id => {
    const labels: Record<string, string> = {
      release: 'Release (innocent or insufficient evidence)',
      warning: 'Public warning (mild offence, first time)',
      fine: 'Fine (moderate property crime)',
      imprisonment: 'Imprisonment (serious crime, strong evidence)',
      exile: 'Permanent exile (severe crime, overwhelming evidence)',
    };
    return `${id}: ${labels[id]}`;
  })
  .join('\n');

const verdictSchema = {
  name: 'verdict_decision',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      verdict: { type: 'string', enum: [...verdictIds] },
      reasoning: { type: 'string', description: 'Your in-character judicial reasoning (2-3 sentences)' },
    },
    required: ['verdict', 'reasoning'],
    additionalProperties: false,
  },
};

const system = `You are Magistrate Theron, the town's judge. You must deliver a just verdict for the accused.`;
const user = [
  `Mark the merchant stands accused of FRAUD (selling common roadside herbs as imported exotic spices) against multiple villagers including Old Bess.`,
  `Crime severity: 4/10.`,
  ``,
  `STRONG EVIDENCE (direct witness, physical proof):`,
  `  • Old Bess testified she identified the herbs as common roadside thyme and sage`,
  `  • Garrett the guard confiscated a sample matching Bess's identification`,
  `  • Hilda the blacksmith confirmed paying premium price for what turned out to be mundane spices`,
  ``,
  `MODERATE EVIDENCE (deduction, interrogation):`,
  `  • Mark's stated supplier in Valdris was contacted — no record of trade`,
  ``,
  `SUSPECT'S DEFENSE:`,
  `Mark claims the customers' palates are unrefined. Denies fraud, insists climate variation explains the smell.`,
  ``,
  `COMMUNITY:`,
  `Bess has been vocal about the deception. Garrett supports stiff punishment. Hilda wants restitution.`,
  ``,
  `AVAILABLE VERDICTS (choose one appropriate to evidence strength and crime severity):`,
  verdictDescriptions,
  ``,
  `Consider: strong evidence + moderate crime → proportionate response. The accused has shown no remorse but his crime is not violent.`,
].join('\n');

console.log('\n═══ Running verdict via classify("verdict") ═══');
console.log('  Route: verdict → claude-code (haiku) with fallback to lm-studio');

const start = Date.now();
const result = await classify<{ verdict: string; reasoning: string }>('verdict', {
  system,
  user,
  schema: { name: verdictSchema.name, schema: verdictSchema.schema },
  agentContext: { id: 'magistrate' },
  maxTokensOverride: 600,
  samplingOverride: { temperature: 0.4 },
});
const elapsed = Date.now() - start;

console.log(`\n  Inference: ${elapsed}ms`);
console.log(`  Verdict:   ${result?.verdict}`);
console.log(`  Reasoning: ${result?.reasoning}`);

if (!result) {
  console.error('\n[FAIL] classify вернул null. Проверь логи провайдера.');
  process.exit(1);
}

console.log('\n═══ Validation ═══');
console.log(`  ✓ verdict in enum: ${verdictIds.includes(result.verdict as typeof verdictIds[number]) ? 'OK' : 'FAIL'}`);
console.log(`  ✓ reasoning length ≥ 50 chars: ${result.reasoning.length >= 50 ? 'OK' : 'FAIL'}`);
const reasoningLower = result.reasoning.toLowerCase();
const judicialKeywords = ['evidence', 'witness', 'testif', 'crime', 'fraud', 'accus', 'court', 'just', 'guilt', 'innocen', 'verdict', 'punishment', 'fair', 'proportionate'];
const judicialHits = judicialKeywords.filter(k => reasoningLower.includes(k));
console.log(`  ✓ judicial language: [${judicialHits.join(', ')}] (${judicialHits.length} hits)`);
const inCharacterKeywords = ['theron', 'capital', 'precedent', 'law', 'court', 'magistrate', 'i find', 'i sentence', 'i rule'];
const characterHits = inCharacterKeywords.filter(k => reasoningLower.includes(k));
console.log(`  ✓ in-character signals: [${characterHits.join(', ')}]`);

// Expected: warning OR fine OR imprisonment for fraud severity-4 with strong evidence
const reasonable = ['warning', 'fine', 'imprisonment'];
console.log(`  ✓ proportionate verdict (warning/fine/imprisonment): ${reasonable.includes(result.verdict) ? 'OK' : `WEAK — got '${result.verdict}'`}`);

console.log('\n═══ Done ═══');
await disposeAllLlmProviders();
