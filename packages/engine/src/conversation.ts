import type { Agent } from './agent';
import type { IEventStore } from './event-types';
import type { WorldEvent } from './cg-types';
import type { ConversationResult, ConversationLine, WorldConfig } from './world-types';
import type { TopicProposal } from './topic-engine';
import type { LlmJsonSchema } from './llm-client';
import { getRelationshipLabel } from './event-registry';
import { buildSecretDirectives } from './secret-directives';

/** Max tokens for structured dialogue output (JSON overhead ~20 + speech ~25 + gesture ~5) */
const CONVERSATION_MAX_TOKENS = 80;

/** Structured output schema — separates speech from gesture, prevents narration */
const DIALOGUE_SCHEMA: LlmJsonSchema = {
  name: 'npc_dialogue',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      speech: { type: 'string', description: 'ONLY the words you speak aloud. No actions, no *gestures*. Max 12 words. Fresh wording.' },
      gesture: { type: 'string', description: 'Physical action like *nods* or *sighs*. Max 4 words. Empty string if none.' },
    },
    required: ['speech', 'gesture'],
    additionalProperties: false,
  },
};

/** Parse structured dialogue JSON → display text. Handles malformed JSON from LLM. */
function parseDialogue(raw: string): string {
  try {
    const d = JSON.parse(raw);
    const speech = (d.speech ?? '').trim().replace(/^["']+|["']+$/g, '');
    const gesture = (d.gesture ?? '').trim();
    if (!speech) return gesture || '...';
    return gesture ? `${gesture} ${speech}` : speech;
  } catch {
    // Fallback: extract speech from malformed JSON via regex
    const speechMatch = raw.match(/"speech"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (speechMatch) {
      const speech = speechMatch[1].replace(/\\"/g, '"').replace(/^["']+|["']+$/g, '').trim();
      const gestureMatch = raw.match(/"gesture"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      const gesture = gestureMatch?.[1]?.trim() || '';
      return gesture ? `${gesture} ${speech}` : speech;
    }
    // Last resort: strip JSON artifacts and return cleaned text
    return raw.replace(/[{}"]/g, '').replace(/speech\s*:|gesture\s*:/gi, '').trim() || '...';
  }
}

/** Extract only speech portion (for memory storage, impact analysis) */
function extractSpeech(raw: string): string {
  try {
    return (JSON.parse(raw).speech ?? '').trim() || raw;
  } catch {
    return raw;
  }
}

/**
 * Run an NPC-to-NPC conversation: initiator speaks, responder replies.
 * Each exchange = 2 LLM calls. Returns the full conversation result.
 */
export async function runConversation(
  initiator: Agent,
  responder: Agent,
  eventStore: IEventStore,
  config: WorldConfig,
  topic: TopicProposal,
  options?: {
    onLine?: (line: ConversationLine) => void;
    agents?: Map<string, Agent>;
  },
): Promise<ConversationResult> {
  const lines: ConversationLine[] = [];
  const gameDay = initiator.state.currentDay;
  const location = initiator.state.location;

  // Build secret directives for both participants
  const allAgents = options?.agents ?? new Map([[initiator.profile.id, initiator], [responder.profile.id, responder]]);
  const initSecrets = buildSecretDirectives(initiator, allAgents, eventStore);
  const respSecrets = buildSecretDirectives(responder, allAgents, eventStore);

  for (let exchange = 0; exchange < config.exchangeCount; exchange++) {
    // --- Initiator speaks ---
    const initiatorPrompt = exchange === 0
      ? buildInitiatorPrompt(initiator, responder, topic)
      : buildFollowUpPrompt(initiator, responder, lines, topic);

    const initiatorRaw = await initiator.generateResponse(initiatorPrompt, {
      maxTokens: CONVERSATION_MAX_TOKENS,
      additionalContext: initSecrets || undefined,
      jsonSchema: DIALOGUE_SCHEMA,
    });
    const initiatorLine = parseDialogue(initiatorRaw);
    const iLine: ConversationLine = {
      speaker: initiator.profile.id,
      speakerName: initiator.profile.name,
      text: initiatorLine,
    };
    lines.push(iLine);
    options?.onLine?.(iLine);

    // --- Responder replies ---
    const responderPrompt = buildResponderPrompt(responder, initiator, initiatorLine, topic);
    const responderRaw = await responder.generateResponse(responderPrompt, {
      maxTokens: CONVERSATION_MAX_TOKENS,
      additionalContext: respSecrets || undefined,
      jsonSchema: DIALOGUE_SCHEMA,
    });
    const responderLine = parseDialogue(responderRaw);
    const rLine: ConversationLine = {
      speaker: responder.profile.id,
      speakerName: responder.profile.name,
      text: responderLine,
    };
    lines.push(rLine);
    options?.onLine?.(rLine);
  }

  // Determine importance: topic weight + content keywords
  const importance = estimateImportance(lines, topic);

  // NOTE: Memory storage (observe) moved to world.ts — importance is adjusted
  // after analyzeConversationImpact determines emotional significance.

  // Casual conversation slightly improves mutual sentiment
  initiator.state.relationships?.adjustSentiment(responder.profile.id, 0.05);
  responder.state.relationships?.adjustSentiment(initiator.profile.id, 0.05);

  // Record event in Event Store
  const event: WorldEvent = {
    id: crypto.randomUUID(),
    type: 'NPC_CONVERSATION',
    subject: initiator.profile.id,
    object: responder.profile.id,
    location,
    gameDay,
    importance,
    payload: {
      topic: topic.subject,
      lines: lines.map((l) => ({ speaker: l.speakerName, text: l.text })),
      affectedTargets: [initiator.profile.id, responder.profile.id],
    },
  };
  eventStore.append(event);

  return { initiator: initiator.profile.id, responder: responder.profile.id, location, lines, gameDay, importance };
}

// ─── Prompt Builders ────────────────────────────────────────────

/** Extract compact speech style reminder (first line only) */
function speechReminder(agent: Agent): string {
  const firstLine = agent.profile.speechStyle.split('\n')[0];
  return firstLine;
}

/** Relationship note for conversation prompt */
function relationshipNote(from: Agent, to: Agent): string {
  const rel = from.state.relationships?.getRelationship(to.profile.id);
  if (!rel) return '';

  const label = getRelationshipLabel(rel.type);

  const feeling = rel.sentiment < -0.3 ? 'You have tension with them.'
    : rel.sentiment < -0.1 ? 'You feel uneasy around them.'
    : rel.sentiment > 0.5 ? 'You are fond of them.'
    : rel.sentiment > 0.3 ? 'You get along with them.'
    : '';

  const parts = [label, feeling].filter(Boolean);
  return parts.length > 0 ? parts.join('. ') + '.' : '';
}

function buildInitiatorPrompt(initiator: Agent, responder: Agent, topic: TopicProposal): string {
  const relNote = relationshipNote(initiator, responder);
  const speech = speechReminder(initiator);

  return `You are at ${initiator.state.location}. ${responder.profile.name} the ${responder.profile.role} is here with you.
${topic.initiatorHook}
${relNote ? `${relNote}\n` : ''}(Your voice: ${speech})
IMPORTANT: speech must be at most 12 words. Only mention people who are HERE with you. No narration.`;
}

function buildResponderPrompt(
  responder: Agent, initiator: Agent,
  initiatorLine: string, topic: TopicProposal,
): string {
  const relNote = relationshipNote(responder, initiator);
  const speech = speechReminder(responder);

  return `${initiator.profile.name} the ${initiator.profile.role} says to you:
"${initiatorLine}"
${topic.responderHook ? `${topic.responderHook}\n` : ''}${relNote ? `${relNote}\n` : ''}(Your voice: ${speech})
IMPORTANT: speech must be at most 12 words. React with YOUR OWN words — do NOT repeat what they said. No narration.`;
}

function buildFollowUpPrompt(
  speaker: Agent, other: Agent,
  previousLines: ConversationLine[], topic: TopicProposal,
): string {
  const lastLine = previousLines[previousLines.length - 1];
  const speech = speechReminder(speaker);

  return `${other.profile.name} just said: "${lastLine.text}"
Topic: ${topic.subject}. (Your voice: ${speech})
IMPORTANT: speech at most 12 words. Continue briefly.`;
}

// ─── Memory & Importance ────────────────────────────────────────

/** Build grounded memory text with topic context — varied format for better recall differentiation */
export function buildMemoryText(
  otherName: string, topicSubject: string,
  whatTheySaid: string, otherMood: number,
): string {
  const moodLabel = otherMood < -0.5 ? 'visibly shaken'
    : otherMood < -0.2 ? 'tense'
    : otherMood > 0.3 ? 'in good spirits'
    : 'calm';

  // Truncate their words to key content (max ~80 chars)
  const key = whatTheySaid.length > 80
    ? whatTheySaid.slice(0, 80).replace(/\s\S*$/, '...')
    : whatTheySaid;

  // Varied format based on mood (deterministic — no Math.random for replay safety)
  if (otherMood < -0.2) return `${otherName} (${moodLabel}) told me about ${topicSubject}: "${key}"`;
  if (otherMood > 0.3) return `${otherName} and I chatted about ${topicSubject}. They were ${moodLabel}. "${key}"`;
  return `Had a conversation with ${otherName} about ${topicSubject}. ${moodLabel}. They said: "${key}"`;
}

/** Estimate conversation importance from structured topic category (no text matching) */
function estimateImportance(_lines: ConversationLine[], topic: TopicProposal): number {
  // Base importance from topic weight
  let importance = Math.min(topic.weight, 7);

  // Importance floor/cap from topic metadata (set by topic sources)
  if (topic.minImportance) importance = Math.max(importance, topic.minImportance);
  if (topic.maxImportance) importance = Math.min(importance, topic.maxImportance);

  return Math.max(2, Math.min(importance, 8));
}
