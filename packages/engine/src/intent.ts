import { llmSemaphore } from './agent';

export type IntentType =
  | 'smalltalk'
  | 'ask_about_npc'
  | 'accuse'
  | 'threaten'
  | 'insult'
  | 'compliment'
  | 'bribe'
  | 'confide'
  | 'trade';

export interface IntentResult {
  intent: IntentType;
  /** Target NPC name if the intent is about someone specific */
  targetNpc?: string;
  /** Brief detail about what was said */
  detail?: string;
}

const VALID_INTENTS = new Set<IntentType>([
  'smalltalk', 'ask_about_npc', 'accuse', 'threaten',
  'insult', 'compliment', 'bribe', 'confide', 'trade',
]);

/**
 * Classify a player's chat message into a structured intent.
 * Uses a lightweight LLM call via the native LM Studio API.
 */
export async function classifyIntent(
  message: string,
  npcNames: string[],
): Promise<IntentResult> {
  const prompt = [
    `Classify this player message into one intent type.`,
    ``,
    `Player said: "${message}"`,
    ``,
    `Known NPCs: ${npcNames.join(', ')}`,
    ``,
    `Intent types:`,
    `- smalltalk: casual conversation, greetings, questions about self`,
    `- ask_about_npc: asking about another NPC by name`,
    `- accuse: accusing someone of a crime or wrongdoing`,
    `- threaten: threatening violence or harm`,
    `- insult: verbal attack, mockery, disrespect`,
    `- compliment: praise, flattery, kind words`,
    `- bribe: offering money/goods for a favor`,
    `- confide: sharing secrets or personal information`,
    `- trade: wanting to buy, sell, or trade items/goods/weapons/supplies`,
    ``,
    `Respond ONLY with JSON: {"intent":"type","targetNpc":"Name or null","detail":"brief reason"}`,
  ].join('\n');

  await llmSemaphore.acquire();
  try {
    const res = await fetch('http://127.0.0.1:1234/api/v1/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'qwen/qwen3.5-9b',
        system_prompt: 'You are a message classifier. Respond ONLY with valid JSON, no other text.',
        input: prompt,
        reasoning: 'off',
        temperature: 0.2,
        max_output_tokens: 100,
      }),
    });

    if (!res.ok) {
      console.error(`  [Intent] LLM error: ${res.status}`);
      return { intent: 'smalltalk' };
    }

    const data = await res.json() as { output: Array<{ type: string; content?: string }> };
    const msg = data.output?.find((o: { type: string }) => o.type === 'message');
    let content = msg?.content?.trim() ?? '';
    if (!content) return { intent: 'smalltalk' };

    // Extract JSON from possible markdown code block
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) content = jsonMatch[1].trim();

    const parsed = JSON.parse(content) as {
      intent?: string;
      targetNpc?: string | null;
      detail?: string;
    };

    const intent = VALID_INTENTS.has(parsed.intent as IntentType)
      ? (parsed.intent as IntentType)
      : 'smalltalk';

    return {
      intent,
      targetNpc: parsed.targetNpc ?? undefined,
      detail: parsed.detail ?? undefined,
    };
  } catch (err) {
    console.error(`  [Intent] Classification failed:`, err);
    return { intent: 'smalltalk' };
  } finally {
    llmSemaphore.release();
  }
}
