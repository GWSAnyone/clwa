/**
 * Shared prompt utilities — used by conversation.ts and interaction.ts.
 */
import type { Agent } from './agent';

/** Build a concise speech style reminder with one random example */
export function speechReminder(agent: Agent): string {
  const lines = agent.profile.speechStyle.split('\n');
  const description = lines[0] ?? '';
  // Pool = structured fewShotExamples ∪ inline "Example:" lines. One sampled per call to prevent verbatim copying.
  const inline = lines.filter(l => l.startsWith('Example:')).map(l => l.replace(/^Example:\s*/, ''));
  const pool = [...(agent.profile.fewShotExamples ?? []), ...inline].filter(Boolean);
  if (pool.length === 0) return description;
  const example = pool[Math.floor(Math.random() * pool.length)];
  return `${description} — e.g. ${example}`;
}
