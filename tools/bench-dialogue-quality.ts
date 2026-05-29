/**
 * A/B dialogue quality: the SAME NPC conversation through Haiku vs Sonnet, side by side.
 * Mirrors the live `dialogue` path (free-text, in-character, no stage directions) so the comparison is
 * "combat-realistic". Prints both transcripts; you judge roleplay/intelligence.
 *
 *   bun tools/bench-dialogue-quality.ts
 */
import path from 'node:path';
import { ClaudeCodeProvider } from '../packages/providers/claude-code/src/index';

const NPCS_ROOT = path.join(import.meta.dir, '../packages/server/data/claude-npcs');
const provider = new ClaudeCodeProvider({ npcsRoot: NPCS_ROOT, sessionIdleMs: 1_800_000, maxConcurrency: 4 });

// Faithful Elara system prompt — mirrors engine/agent.ts buildSystemPrompt structure + the dialogue Rules.
const SYSTEM = `You are Elara, a bard.

## Background
A traveling bard who performs at the Silver Flagon most evenings. She collects stories and gossip from every corner of town. Nothing escapes her sharp ears. Loves drama and intrigue.

## Personality
Very open and extraverted, playful, theatrical. Moderately agreeable. Average honesty.

## Your deepest drives
- Your deepest fear: Being insignificant and forgotten
- Your deepest desire: To be remarkable and leave a lasting impression

## Speech style
Theatrical, vivid — treats everything as a story unfolding. Playful and curious.

## Current state
- Location: Silver Flagon Tavern
- Mood: content

## What I remember
- The locals: Ted runs this tavern (my friend, knows everyone), Garrett is the town guard, Father Aldric tends the Temple of Dawn, Old Bess sells herbs at the market, Mark is a merchant, Hilda the blacksmith.
- I've watched Garrett closely — a guard who once took a bribe.
- I arrived two years ago; I love this village now.

## Rules
- Output ONLY spoken words — no stage directions, gestures, or actions in asterisks/parentheses. Your actions are shown visually, not narrated in text.
- Reply in the SAME language the player speaks; never mix languages.
- Only reference people, places, and events that exist in your world. Do NOT invent names you don't know.
- Never refer to yourself by your own name. Use "I", "me", "my".
- Stay in character. React per your personality and mood.
- Keep responses concise — speak naturally, not in essays.`;

const TURNS = [
  'Снова привет, напомни что я у тебя недавно спрашивал?',
  'да ничего особенно, спрашивал что ты знаешь о местных жителях',
  'расскажи про Гарретта',
];

async function runConversation(model: string): Promise<string[]> {
  const history: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  const replies: string[] = [];
  for (const turn of TURNS) {
    const r = await provider.call({
      model, system: SYSTEM, user: turn,
      history: history.length ? [...history] : undefined,
      maxTokens: 350, sampling: { temperature: 0.9 },
      agentContext: { id: 'elara' }, warm: true,
    });
    const reply = (r.content || '').trim();
    replies.push(reply);
    history.push({ role: 'user', content: turn });
    history.push({ role: 'assistant', content: reply });
  }
  return replies;
}

console.log('\n═══ Dialogue A/B — Elara, Haiku vs Sonnet (same conversation) ═══');
const [haiku, sonnet] = await Promise.all([runConversation('haiku'), runConversation('sonnet')]);
await provider.dispose();

for (let i = 0; i < TURNS.length; i++) {
  console.log(`\n┌─ Player: ${TURNS[i]}`);
  console.log(`│\n├─ HAIKU  (${haiku[i].length} ch): ${haiku[i]}`);
  console.log(`│\n├─ SONNET (${sonnet[i].length} ch): ${sonnet[i]}`);
  console.log('└' + '─'.repeat(70));
}
