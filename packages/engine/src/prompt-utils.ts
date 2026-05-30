/**
 * Shared prompt utilities — used by conversation.ts and interaction.ts.
 */
import type { Agent } from './agent';

/** Build a concise speech style reminder with one random example */
/** Shared voice-example pool: structured `fewShotExamples` ∪ inline "Example:" lines parsed from speechStyle.
 *  Single source of truth for both speechReminder (NPC↔NPC) and Agent.voiceExample (player chat).
 *  Takes primitives (not an Agent) to keep it dependency-free and avoid an import cycle with agent.ts. */
export function buildExamplePool(speechStyle: string, fewShotExamples?: string[]): string[] {
  const inline = speechStyle.split('\n')
    .filter((l) => l.startsWith('Example:'))
    .map((l) => l.replace(/^Example:\s*/, '').trim());
  return [...(fewShotExamples ?? []), ...inline].filter(Boolean);
}

export function speechReminder(agent: Agent): string {
  const description = agent.profile.speechStyle.split('\n')[0] ?? '';
  const pool = buildExamplePool(agent.profile.speechStyle, agent.profile.fewShotExamples);
  if (pool.length === 0) return description;
  const example = pool[Math.floor(Math.random() * pool.length)];
  return `${description} — e.g. ${example}`;
}
