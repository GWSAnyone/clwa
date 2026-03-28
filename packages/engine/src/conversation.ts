import type { Agent } from './agent';
import type { IEventStore } from './event-types';
import type { WorldEvent } from './cg-types';
import type { ConversationResult, ConversationLine, WorldConfig, LocationGraph } from './world-types';
import { sanitizeSelfReference } from './interaction';
import type { TopicProposal } from './topic-engine';
import { truncateToFirstJsonObject } from './llm-client';
import type { LlmJsonSchema } from './llm-client';
import { getRelationshipLabel } from './event-registry';
import { buildSecretDirectives } from './secret-directives';

/** Resolve location ID to display name. */
function locName(id: string, locations?: LocationGraph): string {
  if (!locations) return id;
  const loc = locations.get(id);
  return loc ? loc.name : id;
}

/** Max tokens for structured dialogue output (JSON overhead ~20 + speech ~25 + gesture ~5) */
const CONVERSATION_MAX_TOKENS = 80;

/** Structured output schema — separates speech from gesture, prevents narration */
const DIALOGUE_SCHEMA: LlmJsonSchema = {
  name: 'npc_dialogue',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      speech: { type: 'string', minLength: 20, description: 'ONLY spoken words. No actions, no narration, no parentheses. 5 to 12 words.' },
      gesture: { type: 'string', description: 'One word: nods, shrugs, smiles, frowns, laughs, sighs. Empty if none.' },
    },
    required: ['speech', 'gesture'],
    additionalProperties: false,
  },
};

/** Parse structured dialogue JSON → clean speech only. Gesture is metadata, not display text. */
function parseDialogue(raw: string): string {
  // Truncate to first JSON object (handles multi-object LLM output)
  const cleaned = truncateToFirstJsonObject(raw);

  try {
    const d = JSON.parse(cleaned);
    let speech = (d.speech ?? '').trim();
    // Strip XML/HTML tags (e.g. <speaker>...</speaker>)
    speech = speech.replace(/<[^>]+>/g, '').trim();
    // Strip curly-brace narrative blocks (e.g. {Father Aldric's eyes are clouded...})
    speech = speech.replace(/\{[^}]*\}/g, '').trim();
    speech = speech.replace(/^["']+|["']+$/g, '');
    // Return ONLY speech — gesture is for future animation/UI, not text display
    return speech || '...';
  } catch {
    // Fallback: extract speech from malformed JSON via regex
    const speechMatch = cleaned.match(/"speech"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (speechMatch) {
      return speechMatch[1].replace(/\\"/g, '"').replace(/<[^>]+>/g, '').replace(/\{[^}]*\}/g, '').replace(/^["']+|["']+$/g, '').trim() || '...';
    }
    // Last resort: strip JSON artifacts and return cleaned text
    return cleaned.replace(/[{}"]/g, '').replace(/speech\s*:|gesture\s*:/gi, '').replace(/<[^>]+>/g, '').trim() || '...';
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
    locations?: LocationGraph;
  },
): Promise<ConversationResult> {
  const lines: ConversationLine[] = [];
  const gameDay = initiator.state.currentDay;
  const location = initiator.state.location;

  // Build secret directives for both participants
  const allAgents = options?.agents ?? new Map([[initiator.profile.id, initiator], [responder.profile.id, responder]]);
  const initSecrets = buildSecretDirectives(initiator, allAgents, eventStore);
  const respSecrets = buildSecretDirectives(responder, allAgents, eventStore);

  // Dialogue rule lives in system prompt (additionalContext) so it gets equal attention weight
  // with personality — prevents long system prompts from drowning out speech constraints
  const DIALOGUE_RULE = '\nDIALOGUE: Every speech line must be a complete thought of 5–12 words. Never just a name or one-word answer.';
  const initContext = (initSecrets || '') + DIALOGUE_RULE;
  const respContext = (respSecrets || '') + DIALOGUE_RULE;

  for (let exchange = 0; exchange < config.exchangeCount; exchange++) {
    // --- Initiator speaks ---
    const initiatorPrompt = exchange === 0
      ? buildInitiatorPrompt(initiator, responder, topic, options?.locations)
      : buildFollowUpPrompt(initiator, responder, lines, topic);

    const initiatorRaw = await initiator.generateResponse(initiatorPrompt, {
      maxTokens: CONVERSATION_MAX_TOKENS,
      additionalContext: initContext,
      jsonSchema: DIALOGUE_SCHEMA,
    });
    const initiatorLine = sanitizeSelfReference(parseDialogue(initiatorRaw), initiator.profile.name);
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
      additionalContext: respContext,
      jsonSchema: DIALOGUE_SCHEMA,
    });
    const responderLine = sanitizeSelfReference(parseDialogue(responderRaw), responder.profile.name);
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

  // Casual conversation slightly improves mutual sentiment (configurable via WorldConfig.conversationBehavior)
  const sentBoost = config.conversationBehavior?.sentimentBoost ?? 0.05;
  initiator.state.relationships?.adjustSentiment(responder.profile.id, sentBoost);
  responder.state.relationships?.adjustSentiment(initiator.profile.id, sentBoost);

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

/** Extract speech style description (L0 — style guidance without copyable phrases).
 *  Full examples are already in system prompt via ## Speech style section. */
function speechReminder(agent: Agent): string {
  const lines = agent.profile.speechStyle.split('\n');
  const description = lines[0] ?? '';
  // Include one random example prefixed with "e.g." to prevent verbatim copying
  const examples = lines.filter(l => l.startsWith('Example:'));
  if (examples.length === 0) return description;
  const example = examples[Math.floor(Math.random() * examples.length)];
  const exampleText = example.replace(/^Example:\s*/, '');
  return `${description} — e.g. ${exampleText}`;
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

function buildInitiatorPrompt(initiator: Agent, responder: Agent, topic: TopicProposal, locations?: LocationGraph): string {
  const relNote = relationshipNote(initiator, responder);
  const speech = speechReminder(initiator);

  return `YOUR TOPIC: ${topic.initiatorHook}
You are at ${locName(initiator.state.location, locations)}. ${responder.profile.name} the ${responder.profile.role} is here with you.
${relNote ? `${relNote}\n` : ''}(Your voice: ${speech})
Say 5–12 words out loud to them — a complete thought, never just a name or greeting. Only dialogue, no narration or descriptions.`;
}

function buildResponderPrompt(
  responder: Agent, initiator: Agent,
  initiatorLine: string, topic: TopicProposal,
): string {
  const relNote = relationshipNote(responder, initiator);
  const speech = speechReminder(responder);

  return `React from YOUR OWN perspective — never mirror their phrasing.
${initiator.profile.name} the ${initiator.profile.role} says to you:
"${initiatorLine}"
YOUR TOPIC: ${topic.subject}. ${topic.responderHook ?? ''}
${relNote ? `${relNote}\n` : ''}(Your voice: ${speech})
Say 5–12 words out loud — a complete thought, never just a name or greeting. Only dialogue, no narration or descriptions.`;
}

function buildFollowUpPrompt(
  speaker: Agent, other: Agent,
  previousLines: ConversationLine[], topic: TopicProposal,
): string {
  const lastLine = previousLines[previousLines.length - 1];
  const speech = speechReminder(speaker);

  return `${other.profile.name} just said: "${lastLine.text}"
Topic: ${topic.subject}. (Your voice: ${speech})
IMPORTANT: say 5–12 words out loud — a complete thought, never just a name. Only dialogue, no narration.`;
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
