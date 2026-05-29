import type { Agent } from './agent';
import type { IEventStore } from './event-types';
import type { WorldEvent } from './cg-types';
import type { ConversationResult, ConversationLine, WorldConfig, LocationGraph } from './world-types';
import type { TopicProposal } from './topic-engine';
import { ENGINE_EVENT } from './event-registry';
import { truncateToFirstJsonObject } from './llm-client';
import type { LlmJsonSchema } from './llm-client';
import { getRelationshipLabel } from './event-registry';
import { buildSecretDirectives } from './secret-directives';
import { speechReminder } from './prompt-utils';

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
      speech: { type: 'string', minLength: 5, maxLength: 80, description: 'ONLY spoken words. No actions, no narration, no parentheses. Under 15 words.' },
      gesture: { type: 'string', description: 'One word: nods, shrugs, smiles, frowns, laughs, sighs. Empty if none.' },
    },
    required: ['speech', 'gesture'],
    additionalProperties: false,
  },
};

/** Parse structured dialogue JSON → clean speech only. Gesture is metadata, not display text. */
function parseDialogue(raw: string): string {
  if (!raw) return ''; // LLM returned null/empty — logged upstream, don't mask with fallback

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
    // Strip trailing style/metadata leaked from system prompt (e.g. " - warm drawl voice...")
    // Guards: >50% position, lowercase start, 3+ words, no quotes — avoids false positives on speech continuations
    const dashIdx = speech.lastIndexOf(' - ');
    if (dashIdx > 0 && dashIdx > speech.length * 0.5) {
      const afterDash = speech.slice(dashIdx + 3).trim();
      if (afterDash && /^[a-z]/.test(afterDash) && !afterDash.includes('"') && afterDash.split(/\s+/).length >= 3) {
        speech = speech.slice(0, dashIdx).trim();
      }
    }
    // Speech empty / punctuation-only: a wordless turn. Display silence — never narrate the gesture as
    // text (no asterisks). The `gesture` field stays in the JSON as metadata for the future visual layer.
    if (!speech || /^[\s.,!?…\-—–]+$/.test(speech)) return '...';
    return speech;
  } catch {
    // Fallback: extract speech from malformed JSON via regex
    const speechMatch = cleaned.match(/"speech"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (speechMatch) {
      const s = speechMatch[1].replace(/\\"/g, '"').replace(/<[^>]+>/g, '').replace(/\{[^}]*\}/g, '').replace(/^["']+|["']+$/g, '').trim();
      if (s && !/^[\s.,!?…\-—–]+$/.test(s)) return s;
    }
    // Last resort: strip JSON artifacts and return cleaned text
    const last = cleaned.replace(/[{}"]/g, '').replace(/speech\s*:|gesture\s*:/gi, '').replace(/<[^>]+>/g, '').trim();
    return last || '...';
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
  const DIALOGUE_RULE = `\nDIALOGUE: ${config.dialogueRule ?? 'Keep each line under 15 words. Every speech line must be a complete thought. Never just a name or one-word answer.'}`;
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
    const initiatorLine = parseDialogue(initiatorRaw);
    if (!initiatorLine) {
      console.warn(`  [Conv:SKIP] ${initiator.profile.name} produced empty speech (LLM error)`);
      continue; // skip this exchange — don't broadcast empty line
    }
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
    let responderLine = parseDialogue(responderRaw);
    if (!responderLine) {
      console.warn(`  [Conv:SKIP] ${responder.profile.name} produced empty speech (LLM error)`);
      continue;
    }
    // Echo detection: if responder copies initiator verbatim, flag it
    if (responderLine === initiatorLine) {
      console.warn(`  [Conv:ECHO] ${responder.profile.name} echoed ${initiator.profile.name}: "${responderLine.slice(0, 40)}"`);
    }
    const rLine: ConversationLine = {
      speaker: responder.profile.id,
      speakerName: responder.profile.name,
      text: responderLine,
    };
    lines.push(rLine);
    options?.onLine?.(rLine);
    console.log(`  [NPC↔NPC] ${initiator.profile.name}(${initiator.profile.id}) ⇄ ${responder.profile.name}(${responder.profile.id}) @${location} [${topic.subject}] :: "${initiatorLine}" | "${responderLine}"`);
  }

  // Determine importance: topic weight + content keywords
  const importance = estimateImportance(lines, topic);

  // NOTE: Memory storage (observe) moved to world.ts — importance is adjusted
  // after analyzeConversationImpact determines emotional significance.

  // Sentiment shift from conversation: friends bond, enemies reinforce hostility
  const baseSentBoost = config.conversationBehavior?.sentimentBoost ?? 0.05;
  for (const [a, b] of [[initiator, responder], [responder, initiator]] as const) {
    const rel = a.state.relationships?.getRelationship(b.profile.id);
    const sent = rel?.sentiment ?? 0;
    // Enemies: talking reinforces hatred (negative boost). Friends: talking bonds (+boost).
    // Neutral: small positive drift toward friendship.
    const boost = sent < -0.2 ? Math.min(0, sent * 0.02) : baseSentBoost;
    a.state.relationships?.adjustSentiment(b.profile.id, boost);
  }

  // Record event in Event Store
  const event: WorldEvent = {
    id: crypto.randomUUID(),
    type: ENGINE_EVENT.NPC_CONVERSATION,
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



/** Relationship note for conversation prompt — sentiment + trust shape how NPCs talk */
function relationshipNote(from: Agent, to: Agent): string {
  const rel = from.state.relationships?.getRelationship(to.profile.id);
  if (!rel) return '';

  const label = getRelationshipLabel(rel.type);

  const feeling = rel.sentiment < -0.3 ? 'You have tension with them.'
    : rel.sentiment < -0.1 ? 'You feel uneasy around them.'
    : rel.sentiment > 0.5 ? 'You are fond of them.'
    : rel.sentiment > 0.3 ? 'You get along with them.'
    : '';

  // Trust shapes communication style — independent of sentiment
  const trustNote = rel.trust > 0.7 ? 'You trust them enough to speak openly.'
    : rel.trust < 0.3 ? 'You guard your words around them — they might use them against you.'
    : rel.trust < 0.5 ? 'You are cautious about what you reveal to them.'
    : '';

  const parts = [label, feeling, trustNote].filter(Boolean);
  return parts.length > 0 ? parts.join('. ') + '.' : '';
}

function moodLine(agent: Agent): string {
  const m = agent.state.mood;
  if (m > 0.5) return 'You feel good — relaxed, at ease.';
  if (m > 0) return 'You feel calm and steady.';
  if (m > -0.3) return 'You feel slightly on edge, less patient.';
  if (m > -0.5) return 'You are tense — jaw tight, irritable.';
  return 'You are deeply shaken — everything feels heavy and bleak.';
}

function buildInitiatorPrompt(initiator: Agent, responder: Agent, topic: TopicProposal, locations?: LocationGraph): string {
  const relNote = relationshipNote(initiator, responder);
  const speech = speechReminder(initiator);
  const mood = moodLine(initiator);

  return `YOUR TOPIC: ${topic.initiatorHook}
You are at ${locName(initiator.state.location, locations)}. ${responder.profile.name} the ${responder.profile.role} is here with you.
${mood}
${relNote ? `${relNote}\n` : ''}(Your voice: ${speech})
Say your complete thought out loud — under 15 words. Only dialogue, no narration or descriptions.`;
}

function buildResponderPrompt(
  responder: Agent, initiator: Agent,
  initiatorLine: string, topic: TopicProposal,
): string {
  const relNote = relationshipNote(responder, initiator);
  const speech = speechReminder(responder);

  const mood = moodLine(responder);

  return `React from YOUR OWN perspective. NEVER repeat, echo, or paraphrase their words — use completely different vocabulary.
${initiator.profile.name} the ${initiator.profile.role} says to you:
"${initiatorLine}"
YOUR TOPIC: ${topic.subject}. ${topic.responderHook ?? ''}
${mood}
${relNote ? `${relNote}\n` : ''}(Your voice: ${speech})
Say your complete thought out loud — under 15 words. Only dialogue, no narration or descriptions.`;
}

function buildFollowUpPrompt(
  speaker: Agent, other: Agent,
  previousLines: ConversationLine[], topic: TopicProposal,
): string {
  const lastLine = previousLines[previousLines.length - 1];
  const speech = speechReminder(speaker);
  const relNote = relationshipNote(speaker, other);
  const mood = moodLine(speaker);

  return `${other.profile.name} just said: "${lastLine.text}"
Topic: ${topic.subject}. ${mood}
${relNote ? `${relNote}\n` : ''}(Your voice: ${speech})
React naturally — agree, disagree, add your perspective, or change direction. Say 5–12 words out loud. Only dialogue.`;
}

// ─── Memory & Importance ────────────────────────────────────────

/** Build grounded memory text with topic context — varied format for better recall differentiation */
/**
 * Build memory text from structured data (topic + tone + beliefs + mood).
 * No raw dialogue text — prevents self-reference cascade through memories.
 * Beliefs in 3rd person via summarizeForMemory (not "You certain:").
 */
export function buildMemoryText(
  otherName: string, topicSubject: string,
  topicTone: string | undefined,
  otherBeliefs3p: string, otherMood: number,
): string {
  const moodLabel = otherMood < -0.5 ? 'visibly shaken'
    : otherMood < -0.2 ? 'tense'
    : otherMood > 0.3 ? 'in good spirits'
    : 'calm';

  const toneNote = topicTone ? ` (${topicTone})` : '';
  const beliefNote = otherBeliefs3p ? ` ${otherBeliefs3p}.` : '';
  return `Talked with ${otherName} about ${topicSubject}${toneNote} — they were ${moodLabel}.${beliefNote}`;
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
