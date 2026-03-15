import type { Agent } from './agent';
import type { IEventStore } from './event-types';
import type { WorldEvent } from './cg-types';
import type { ConversationResult, ConversationLine, WorldConfig } from './world-types';
import type { TopicProposal } from './topic-engine';
import { getRelationshipLabel } from './event-registry';
import { buildSecretDirectives } from './secret-directives';

/** Max tokens for a single NPC-NPC dialogue line */
const CONVERSATION_MAX_TOKENS = 55;

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

    const initiatorLine = await initiator.generateResponse(initiatorPrompt, {
      maxTokens: CONVERSATION_MAX_TOKENS,
      additionalContext: initSecrets || undefined,
    });
    const iLine: ConversationLine = {
      speaker: initiator.profile.id,
      speakerName: initiator.profile.name,
      text: initiatorLine,
    };
    lines.push(iLine);
    options?.onLine?.(iLine);

    // --- Responder replies ---
    const responderPrompt = buildResponderPrompt(responder, initiator, initiatorLine, topic);
    const responderLine = await responder.generateResponse(responderPrompt, {
      maxTokens: CONVERSATION_MAX_TOKENS,
      additionalContext: respSecrets || undefined,
    });
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

  // Store grounded memories for both participants
  const responderSaid = lines.filter(l => l.speaker === responder.profile.id).map(l => l.text).join(' ');
  const initiatorSaid = lines.filter(l => l.speaker === initiator.profile.id).map(l => l.text).join(' ');

  await initiator.observe(
    buildMemoryText(responder.profile.name, topic.subject, responderSaid, responder.state.mood),
    importance,
  );
  await responder.observe(
    buildMemoryText(initiator.profile.name, topic.subject, initiatorSaid, initiator.state.mood),
    importance,
  );

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

  return `You see ${responder.profile.name} the ${responder.profile.role} at ${initiator.state.location}.
${topic.initiatorHook}
${relNote ? `${relNote}\n` : ''}
(Your voice: ${speech})
Say ONE or TWO short sentences (under 25 words total). Optional brief action: *nods* or *sighs*. Focus on the topic, not your backstory.`;
}

function buildResponderPrompt(
  responder: Agent, initiator: Agent,
  initiatorLine: string, topic: TopicProposal,
): string {
  const relNote = relationshipNote(responder, initiator);
  const speech = speechReminder(responder);

  return `${initiator.profile.name} the ${initiator.profile.role} at ${responder.state.location} says to you:
"${initiatorLine}"
${topic.responderHook ? `${topic.responderHook}\n` : ''}${relNote ? `${relNote}\n` : ''}
(Your voice: ${speech})
React with ONE or TWO short sentences (under 25 words total). Optional brief action: *nods* or *frowns*. Focus on what they said.`;
}

function buildFollowUpPrompt(
  speaker: Agent, other: Agent,
  previousLines: ConversationLine[], topic: TopicProposal,
): string {
  const lastLine = previousLines[previousLines.length - 1];
  const speech = speechReminder(speaker);

  return `${other.profile.name} just said: "${lastLine.text}"

You are still talking about ${topic.subject}. Continue naturally.

(Your voice: ${speech})
Say ONE or TWO short sentences (under 25 words total). Optional brief action.`;
}

// ─── Memory & Importance ────────────────────────────────────────

/** Build grounded memory text with topic context */
function buildMemoryText(
  otherName: string, topicSubject: string,
  whatTheySaid: string, otherMood: number,
): string {
  const moodLabel = otherMood < -0.5 ? 'They seemed shaken'
    : otherMood < -0.2 ? 'They seemed tense'
    : otherMood > 0.3 ? 'They were in good spirits'
    : 'They seemed calm';

  // Truncate their words to key content (max ~100 chars)
  const key = whatTheySaid.length > 100
    ? whatTheySaid.slice(0, 100).replace(/\s\S*$/, '...')
    : whatTheySaid;

  return `Talked with ${otherName} about ${topicSubject}. ${moodLabel}. They said: "${key}"`;
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
