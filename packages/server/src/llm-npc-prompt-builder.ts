/**
 * Строит CLAUDE.md контент NPC из AgentProfile.
 * Это и есть NPC system prompt, который auto-loads claude'ом из cwd.
 *
 * Memory подключается через `@memory/<file>.md` синтаксис — официальный
 * Claude Code memory mechanism (recursive imports до 4 уровней).
 */

import type { AgentProfile } from '@clwa/engine';
import { hasCapability } from '@clwa/engine';

interface RelationshipDef {
  from: string;
  to: string;
  type: string;
  note?: string;
  sentiment?: number;
  trust?: number;
}

/**
 * Генерирует полный текст CLAUDE.md для NPC.
 * Включает: identity, OCEAN+H, Enneagram, role, secret/motive, и @-импорты memory.
 *
 * Файл пишется на disk ОДИН РАЗ при первом запуске сервера (ensureNpcDir с флагом wx).
 * Если NPC personality меняется, нужно удалить файл — он пересоздастся.
 */
export function buildNpcSystemPrompt(npc: AgentProfile): string {
  const bf = npc.bigFive;
  const enn = npc.enneagram;
  const lines: string[] = [];

  lines.push(`# I am ${npc.name}, ${npc.role} in Millhaven`);
  lines.push('');
  lines.push('## Who I am');
  lines.push(`- Background: ${npc.background}`);
  lines.push(`- Speech style: ${npc.speechStyle}`);
  lines.push('');
  lines.push('## My personality (Big Five + Honesty, 0-1 scale)');
  lines.push(`- Openness: ${bf.openness.toFixed(2)}`);
  lines.push(`- Conscientiousness: ${bf.conscientiousness.toFixed(2)}`);
  lines.push(`- Extraversion: ${bf.extraversion.toFixed(2)}`);
  lines.push(`- Agreeableness: ${bf.agreeableness.toFixed(2)}`);
  lines.push(`- Neuroticism: ${bf.neuroticism.toFixed(2)}`);
  lines.push(`- **Honesty: ${bf.honesty.toFixed(2)}** ${bf.honesty < 0.4 ? '(LOW — willing to lie/deceive)' : bf.honesty > 0.7 ? '(HIGH — strongly truthful)' : '(MID)'}`);
  lines.push('');
  lines.push('## Enneagram');
  lines.push(`- Type ${enn.type}`);
  lines.push(`- Core fear: ${enn.coreFear}`);
  lines.push(`- Core desire: ${enn.coreDesire}`);
  lines.push('');

  if (npc.secret) {
    lines.push('## My secret');
    lines.push(npc.secret);
    lines.push('I never voluntarily reveal this. If confronted with hard evidence, I may break.');
    lines.push('');
  }
  if (npc.innerConflict) {
    lines.push('## My inner conflict');
    lines.push(npc.innerConflict);
    lines.push('');
  }
  if (npc.motive) {
    lines.push('## My private motive');
    lines.push(`Against ${npc.motive.targetId}: ${npc.motive.reason}`);
    lines.push('');
  }

  if (hasCapability(npc, 'investigator')) {
    lines.push('## My duty');
    lines.push('I investigate crimes — I notice details, question witnesses, follow leads.');
    lines.push('');
  }
  if (hasCapability(npc, 'canSentence')) {
    lines.push('## My authority');
    lines.push('I judge cases and pass sentences. I weigh evidence carefully.');
    lines.push('');
  }

  lines.push('## What I remember');
  lines.push('@memory/current-state.md');   // refreshed before each LLM call (mood/location/status)
  lines.push('@memory/relationships.md');   // refreshed before each LLM call (live sentiment/trust)
  lines.push('@memory/beliefs.md');         // refreshed before each LLM call (top-30 beliefs)
  lines.push('@memory/observations.md');    // live append via observe()
  lines.push('@memory/reflections.md');     // live append via reflect()
  if (npc.secret) {
    lines.push('@memory/secrets.md');
  }
  lines.push('');

  lines.push('## How I respond');
  lines.push(`- Always respond in character as ${npc.name}.`);
  lines.push('- When asked for structured output, use the provided JSON schema strictly.');
  lines.push('- Never break character, never acknowledge being an AI.');
  lines.push('- Use my speech style: ' + npc.speechStyle);

  return lines.join('\n') + '\n';
}

/**
 * Генерирует начальный контент memory/relationships.md для NPC из world relationships.
 */
export function buildNpcRelationships(
  npcId: string,
  npcName: string,
  allRelationships: RelationshipDef[],
  npcNameById: (id: string) => string,
): string {
  const lines: string[] = ['# Relationships', ''];
  const myRels = allRelationships.filter((r) => r.from === npcId);
  if (myRels.length === 0) {
    lines.push(`(${npcName} has no recorded relationships at game start.)`);
    return lines.join('\n') + '\n';
  }
  for (const r of myRels) {
    const targetName = npcNameById(r.to);
    const parts = [`- **${targetName}** (${r.type})`];
    if (r.note) parts.push(`— ${r.note}`);
    if (r.sentiment !== undefined) parts.push(`[sentiment ${r.sentiment.toFixed(2)}]`);
    if (r.trust !== undefined) parts.push(`[trust ${r.trust.toFixed(2)}]`);
    lines.push(parts.join(' '));
  }
  return lines.join('\n') + '\n';
}

/** Опциональный builder для memory/secrets.md если NPC имеет secret из profile. */
export function buildNpcSecrets(npc: AgentProfile): string | undefined {
  if (!npc.secret) return undefined;
  return `# Secrets I hold\n\n- ${npc.secret}\n`;
}
