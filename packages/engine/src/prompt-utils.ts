/**
 * Shared prompt utilities — used by conversation.ts and interaction.ts.
 */
import type { Agent } from './agent';

/** Build a concise speech style reminder with one random example */
export function speechReminder(agent: Agent): string {
  const lines = agent.profile.speechStyle.split('\n');
  const description = lines[0] ?? '';
  // Include one random example prefixed with "e.g." to prevent verbatim copying
  const examples = lines.filter(l => l.startsWith('Example:'));
  if (examples.length === 0) return description;
  const example = examples[Math.floor(Math.random() * examples.length)];
  const exampleText = example.replace(/^Example:\s*/, '');
  return `${description} — e.g. ${exampleText}`;
}
