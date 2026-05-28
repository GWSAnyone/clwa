/**
 * Stage 1f Proof-of-Concept.
 *
 * Цель: end-to-end проверка что цепочка работает:
 *   façade classify('verdict', {agentContext:{id:'mark'},...})
 *     → registry _resolveRoute → ClaudeCodeProvider
 *     → Bun.spawn `claude -p` в data/claude-npcs/mark/
 *     → парсинг structured_output
 *     → возврат типизированного результата в caller'а
 *
 * Запуск: `bun run packages/server/src/poc-claude-code.ts`
 * Требует: `claude` CLI в PATH, логин через `claude /login` claude.ai (НЕ через API key).
 */

import path from 'node:path';
import {
  classify,
  registerLlmProvider,
  registerLlmRouter,
  registerLlmTask,
  validateLlmRouterContract,
  disposeAllLlmProviders,
} from '@clwa/engine';
import { LMStudioProvider } from '../../packages/providers/lm-studio/src/index';
import { ClaudeCodeProvider } from '../../packages/providers/claude-code/src/index';
import { NpcMemoryManager } from '../../packages/server/src/npc-memory-manager';
import { buildNpcSystemPrompt, buildNpcRelationships, buildNpcSecrets } from '../../packages/server/src/llm-npc-prompt-builder';
import { buildDefaultRouter } from '../../packages/server/src/llm-defaults';
import type { AgentProfile } from '@clwa/engine';

const NPCS_ROOT = path.join(import.meta.dir, '../../packages/server/data/claude-npcs');

// 1. Регистрируем провайдеры (LMStudio — для embeddings/прочего, не используется в PoC)
registerLlmProvider(new LMStudioProvider({ baseUrl: 'http://localhost:1234' }));
registerLlmProvider(new ClaudeCodeProvider({ npcsRoot: NPCS_ROOT, maxConcurrency: 4 }));

// 2. Регистрируем доменные task'и (в production это сделают модули — для PoC регистрируем вручную)
registerLlmTask('verdict', { requiresStructuredOutput: true });

// 3. Конфигурируем router. По умолчанию verdict → lm-studio. Для PoC переключаем на claude-code.
const router = buildDefaultRouter();
router.routes.verdict = {
  provider: 'claude-code',
  model: 'haiku',
  maxTokens: 600,
};
registerLlmRouter(router);

// 4. Валидируем
validateLlmRouterContract();

// 5. Готовим Mark NPC folder из заранее построенного AgentProfile
const markProfile: AgentProfile = {
  id: 'mark',
  name: 'Mark',
  role: 'merchant',
  background:
    'Traveling merchant who set up shop at the Market Square. Deals in exotic goods and rare spices. Has connections in three kingdoms. Always looking for profit.',
  speechStyle:
    'Weighs every word like a coin. Drops distant city names casually. Slightly condescending to those without money.',
  bigFive: {
    openness: 0.5,
    conscientiousness: 0.3,
    extraversion: 0.7,
    agreeableness: 0.3,
    neuroticism: 0.6,
    honesty: 0.2, // LOW
  },
  enneagram: {
    type: 3,
    wing: 2,
    stressType: 9,
    growthType: 6,
    coreFear: 'Being worthless or a failure',
    coreDesire: 'To be admired and seen as successful',
  },
  secret:
    'Some of the "exotic spices" you sell are actually common herbs from the next town over, marked up tenfold.',
  innerConflict:
    'You tell yourself it is just business, but Old Bess knows. She keeps hinting, smiling that knowing smile.',
  motive: {
    targetId: 'bess',
    reason: 'Old Bess figured out your exotic spices are common herbs. She hinted she might tell everyone.',
  },
  investigator: false,
  detersCrime: false,
  canSentence: false,
};

const memoryManager = new NpcMemoryManager(NPCS_ROOT);
await memoryManager.ensureNpcDir('mark', {
  personality: buildNpcSystemPrompt(markProfile),
  relationships: buildNpcRelationships('mark', 'Mark', [
    { from: 'mark', to: 'bess', type: 'acquaintance', note: 'she knows too much about herbs', sentiment: -0.7, trust: 0.0 },
    { from: 'mark', to: 'hilda', type: 'colleague', note: 'resents paying full price for materials', sentiment: -0.15 },
    { from: 'mark', to: 'garrett', type: 'acquaintance', note: 'avoids the guard when possible', sentiment: -0.1 },
  ], (id) => ({ bess: 'Old Bess', hilda: 'Hilda', garrett: 'Garrett' }[id] ?? id)),
  secrets: buildNpcSecrets(markProfile),
});

console.log('[PoC] NPC folder prepared at:', memoryManager.npcDir('mark'));
console.log('[PoC] Starting classify("verdict") with Mark in confrontation scenario…');

// 6. Симулируем сценарий: Bess подошла к торговому стенду Mark'а и сказала странное
//    Используем "verdict" task для теста структурированного output (хотя семантика — не verdict)
interface MarkDecision {
  decision: 'confess' | 'deflect' | 'attack' | 'placate';
  reasoning: string;
  speech: string;
  emotionalState: 'calm' | 'nervous' | 'angry' | 'panicked';
}

const decisionSchema = {
  name: 'mark_decision',
  schema: {
    type: 'object',
    properties: {
      decision: {
        type: 'string',
        enum: ['confess', 'deflect', 'attack', 'placate'],
        description: 'What Mark decides to do',
      },
      reasoning: { type: 'string', description: 'Inner reasoning (not spoken)' },
      speech: { type: 'string', description: 'What Mark says out loud (in character)' },
      emotionalState: {
        type: 'string',
        enum: ['calm', 'nervous', 'angry', 'panicked'],
      },
    },
    required: ['decision', 'reasoning', 'speech', 'emotionalState'],
    additionalProperties: false,
  },
};

const start = Date.now();
const result = await classify<MarkDecision>('verdict', {
  system:
    'You are Mark, the merchant. A confrontation just happened. Respond in character with structured decision.',
  user:
    'Old Bess just walked into your market stall while three customers were browsing your spices. ' +
    'She said loudly, smiling that knowing smile: "Mark, dear, these `exotic` spices smell remarkably similar ' +
    'to common roadside herbs. Are you sure they are imported?" The customers turned to look at you. ' +
    'What do you do?',
  schema: { name: decisionSchema.name, schema: decisionSchema.schema },
  agentContext: { id: 'mark' },
});
const elapsed = Date.now() - start;

console.log(`\n[PoC] Inference took ${elapsed}ms`);
console.log('[PoC] Result:', JSON.stringify(result, null, 2));

if (!result) {
  console.error('[PoC] FAIL — null result. Check stderr above for provider errors.');
  process.exit(1);
}

console.log('\n[PoC] Validation:');
console.log(`  - decision in enum: ${['confess', 'deflect', 'attack', 'placate'].includes(result.decision) ? 'OK' : 'FAIL'}`);
console.log(`  - emotionalState in enum: ${['calm', 'nervous', 'angry', 'panicked'].includes(result.emotionalState) ? 'OK' : 'FAIL'}`);
console.log(`  - speech in character (mentions Valdris/trade/imports/etc.): ${
  /valdris|import|exotic|trade|spice|kingdom/i.test(result.speech) ? 'OK' : 'maybe — verify manually'
}`);
console.log(`  - Mark's low honesty drives decision (NOT confess): ${
  result.decision !== 'confess' ? 'OK (deflect/attack/placate consistent with H=0.2)' : 'unexpected — Mark confessed?'
}`);

console.log('\n[PoC] Cleaning up provider connections…');
await disposeAllLlmProviders();
console.log('[PoC] Done.');
