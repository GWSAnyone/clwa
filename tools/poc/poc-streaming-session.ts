/**
 * Stage 11 PoC — streaming player↔NPC dialogue via persistent Claude sessions.
 *
 * Verifies:
 *   1. ClaudeCodeProvider.stream() streams tokens (stream-json + --include-partial-messages).
 *   2. Persistent session: 2nd turn to the SAME NPC reuses the warm process → low time-to-first-token.
 *   3. Multi-NPC: talking to a different NPC spawns a SEPARATE session (both coexist).
 *
 * Run: bun run tools/poc/poc-streaming-session.ts
 * Requires: `claude` logged in (OAuth), LM Studio on :1234 (embeddings route only).
 */

import path from 'node:path';
import {
  generateStream,
  registerLlmProvider,
  registerLlmTask,
  registerLlmRouter,
  validateLlmRouterContract,
  disposeAllLlmProviders,
} from '@clwa/engine';
import { LMStudioProvider } from '../../packages/providers/lm-studio/src/index';
import { ClaudeCodeProvider } from '../../packages/providers/claude-code/src/index';

const NPCS_ROOT = path.join(import.meta.dir, '../../packages/server/data/claude-npcs');

registerLlmProvider(new LMStudioProvider({ baseUrl: 'http://localhost:1234' }));
registerLlmProvider(
  new ClaudeCodeProvider({ npcsRoot: NPCS_ROOT, sessionIdleMs: 600_000, maxConcurrency: 4 }),
);

registerLlmTask('dialogue', { requiresStreaming: true });
registerLlmRouter({
  default: { provider: 'claude-code', model: 'sonnet', maxTokens: 250 },
  routes: {
    dialogue: { provider: 'claude-code', model: 'sonnet', maxTokens: 250, sampling: { temperature: 0.7 } },
    embeddings: { provider: 'lm-studio', model: 'text-embedding-nomic-embed-text-v1.5@q8_0' },
  },
});
validateLlmRouterContract();

const SYSTEM = 'You are Mark the merchant. Stay in character. Reply to the customer in 1-2 sentences.';

async function turn(npc: string, system: string, user: string): Promise<void> {
  let ttft = 0;
  const start = Date.now();
  process.stdout.write(`\n[${npc}] you: ${user}\n[${npc}] npc: `);
  const reply = await generateStream('dialogue', {
    system,
    user,
    agentContext: { id: npc },
    onToken: (t) => {
      if (ttft === 0) ttft = Date.now() - start;
      process.stdout.write(t);
    },
  });
  const total = Date.now() - start;
  process.stdout.write(`\n   ⏱ TTFT=${ttft}ms  total=${total}ms  len=${reply.length}\n`);
}

console.log('═══ Test 1: first turn to Mark (COLD spawn expected) ═══');
await turn('mark', SYSTEM, 'Good day. What exotic wares do you have from Valdris today?');

console.log('\n═══ Test 2: second turn to Mark (WARM session — TTFT should drop sharply) ═══');
await turn('mark', SYSTEM, 'Hmm. And is that price... negotiable for a regular?');

console.log('\n═══ Test 3: turn to a DIFFERENT NPC, Bess (separate cold session) ═══');
await turn('bess', 'You are Old Bess the herbalist. Stay in character, 1-2 sentences.', 'Bess, you look like you know everyone\'s secrets in this town.');

console.log('\n═══ Test 4: back to Mark (still warm? same session reused) ═══');
await turn('mark', SYSTEM, 'Very well. I shall take the pepper. A pleasure as always.');

console.log('\n═══ Done — disposing (kills warm sessions) ═══');
await disposeAllLlmProviders();
console.log('Disposed. If TTFT on Test 2/4 << Test 1, persistent sessions work.');
