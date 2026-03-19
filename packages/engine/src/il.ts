/**
 * Intent Layer (IL) — Dialogue Meaning Extraction
 *
 * Extracts structured meaning from player speech to NPC.
 * IL is the inverse of chatStream:
 *   chatStream: structured NPC state → LLM → natural text FOR player
 *   IL: natural player text → LLM → structured meaning FOR engine
 *
 * Output (DialogueMeaning) feeds into engine primitives:
 *   claims → addBelief (same as NPC beliefTransfer)
 *   questions → gather NPC beliefs for response context
 *   requestedAction → evaluate affordance, create NPC goal
 *   emotionalPressure → mood + relationship + event store
 */

import { llmSemaphore } from './agent';
import type { Agent } from './agent';
import type { IEventStore } from './event-store';
import { getEventLabel, BELIEF_SOURCE } from './event-registry';
import { llmCall } from './llm-client';
import type { LlmJsonSchema } from './llm-client';

const IL_EXTRACTION_SCHEMA: LlmJsonSchema = {
  name: 'dialogue_meaning',
  schema: {
    type: 'object',
    properties: {
      speechAct: { type: 'string' },
      claims: { type: 'array', items: { type: 'object', properties: { eventType: { type: 'string' }, subject: { type: 'string' }, object: { type: 'string' }, location: { type: 'string' }, source: { type: 'string' }, confidence: { type: 'number' } }, required: ['confidence'], additionalProperties: false } },
      questions: { type: 'array', items: { type: 'object', properties: { about: { type: 'string' }, topic: { type: 'string' } }, required: ['about'], additionalProperties: false } },
      requestedAction: { type: 'object', properties: { action: { type: 'string' }, target: { type: 'string' }, urgency: { type: 'number' } }, required: ['action', 'urgency'], additionalProperties: false },
      emotionalPressure: { type: 'object', properties: { type: { type: 'string' }, intensity: { type: 'number' } }, required: ['type', 'intensity'], additionalProperties: false },
      tradeIntent: { type: 'object', properties: { category: { type: 'string' }, itemName: { type: 'string' } }, additionalProperties: false },
      extractionConfidence: { type: 'number' },
    },
    required: ['speechAct', 'extractionConfidence'],
    additionalProperties: false,
  },
};

/** Event type for player actions — must be registered by server/module at startup */
export const PLAYER_ACTION_EVENT = 'PLAYER_ACTION';

/** Player action subtypes — used in event payload.action and matched in secret directive builders */
export const PLAYER_ACTIONS = {
  THREATEN: 'threaten',
  BRIBE: 'bribe',
} as const;

// ─── IL Output Types ───

export type SpeechAct =
  | 'inform'      // sharing information about the world
  | 'question'    // asking for information
  | 'request'     // asking NPC to do something
  | 'accuse'      // directly accusing someone
  | 'threaten'    // threatening NPC
  | 'compliment'  // praising NPC
  | 'insult'      // verbal attack
  | 'bribe'       // offering something for a favor
  | 'confide'     // sharing personal/secret information
  | 'trade'       // buying/selling intent
  | 'smalltalk';  // casual conversation

export interface Claim {
  /** Event type from registry (e.g. NPC_KILLED, GOODS_STOLEN) — null if no specific event */
  eventType?: string;
  /** WHO did it / is involved (NPC name as extracted) */
  subject?: string;
  /** WHO was affected / victim (NPC name) */
  object?: string;
  /** WHERE (location name) */
  location?: string;
  /** WHEN (time period: dawn, morning, afternoon, evening, night) */
  timePeriod?: string;
  /** How player knows this */
  source: 'witnessed' | 'heard' | 'suspects' | 'deduced';
  /** How certain the claim is (0-1) */
  confidence: number;
}

export interface Question {
  /** NPC name or topic being asked about */
  about: string;
  /** Specific topic: whereabouts, opinion, knowledge, relationship, secret */
  topic?: string;
}

export interface RequestedAction {
  /** Affordance-like action: investigate, arrest, examine, report */
  action: string;
  /** Target NPC name or location name */
  target?: string;
  /** How urgently player is asking (0-1) */
  urgency: number;
}

export interface EmotionalPressure {
  type: 'threat' | 'bribe' | 'flattery' | 'guilt' | 'intimidation';
  intensity: number; // 0-1
}

export interface TradeIntent {
  /** What category: weapon, armor, potion, food, general */
  category?: string;
  /** Specific item name if mentioned */
  itemName?: string;
}

export interface DialogueMeaning {
  speechAct: SpeechAct;
  claims?: Claim[];
  questions?: Question[];
  requestedAction?: RequestedAction;
  emotionalPressure?: EmotionalPressure;
  tradeIntent?: TradeIntent;
  /** LLM self-assessed confidence in the extraction (0-1) */
  extractionConfidence: number;
}

// ─── IL Context (what IL needs to resolve entities) ───

export interface ILContext {
  /** All known NPC names (for entity resolution) */
  npcNames: string[];
  /** All known location names (for location resolution) */
  locationNames: string[];
  /** Known event type categories (for claim matching) */
  knownEventTypes: string[];
  /** NPC being talked to */
  targetNpcName: string;
  /** LLM base URL (default: http://127.0.0.1:1234) */
  llmBaseUrl?: string;
  /** LLM model name (default: from DEFAULT_WORLD_CONFIG) */
  llmModel?: string;
}

// ─── Extraction ───

/**
 * Extract structured meaning from player speech using LLM.
 * Inverse of chatStream: natural text → structured data for the engine.
 */
export async function extractDialogueMeaning(
  playerMessage: string,
  ctx: ILContext,
): Promise<DialogueMeaning> {
  const prompt = [
    `Extract structured meaning from what the player said to ${ctx.targetNpcName}.`,
    ``,
    `Player said: "${playerMessage}"`,
    ``,
    `Known NPCs: ${ctx.npcNames.join(', ')}`, // names include roles e.g. "Garrett (guard)"
    `Known locations: ${ctx.locationNames.join(', ')}`,
    `Known event types: ${ctx.knownEventTypes.join(', ')}`,
    ``,
    `Extract ALL of the following that apply:`,
    ``,
    `1. speechAct: one of: inform, question, request, accuse, threaten, compliment, insult, bribe, confide, trade, smalltalk`,
    ``,
    `2. claims: array of factual claims the player is making (if any). Each claim:`,
    `   - eventType: event type if claiming something happened (use known event types, or null)`,
    `   - subject: WHO did it (must be a known NPC name, or null)`,
    `   - object: WHO was affected (NPC name, or null)`,
    `   - location: WHERE (must be a known location, or null)`,
    `   - timePeriod: WHEN (dawn/morning/afternoon/evening/night, or null)`,
    `   - source: how the player knows (witnessed, heard, suspects, deduced)`,
    `   - confidence: 0-1 how certain the claim sounds`,
    ``,
    `3. questions: array of questions being asked (if any). Each:`,
    `   - about: who/what is being asked about (NPC name or topic)`,
    `   - topic: whereabouts, opinion, knowledge, relationship, secret (or null)`,
    ``,
    `4. requestedAction: if player is asking the NPC to DO something:`,
    `   - action: what (investigate, arrest, help, examine, report, etc)`,
    `   - target: target NPC or location (or null)`,
    `   - urgency: 0-1`,
    ``,
    `5. emotionalPressure: if player is pressuring the NPC:`,
    `   - type: threat, bribe, flattery, guilt, intimidation`,
    `   - intensity: 0-1`,
    ``,
    `6. tradeIntent: if player wants to buy/sell:`,
    `   - category: weapon, armor, potion, food, general (or null)`,
    `   - itemName: specific item mentioned (or null)`,
    ``,
    `7. extractionConfidence: 0-1 your overall confidence in this extraction`,
    ``,
    `Respond ONLY with valid JSON. Omit fields that don't apply (don't include empty arrays).`,
  ].join('\n');

  await llmSemaphore.acquire();
  try {
    const content = await llmCall({
      system: 'You are a dialogue meaning extractor. Extract structured information from player speech.',
      user: prompt,
      temperature: 0.15,
      maxTokens: 400,
      baseUrl: ctx.llmBaseUrl,
      model: ctx.llmModel,
      jsonSchema: IL_EXTRACTION_SCHEMA,
    });

    if (!content) return { speechAct: 'smalltalk', extractionConfidence: 0 };

    const raw = JSON.parse(content) as Record<string, unknown>;
    return validateAndResolve(raw, ctx);
  } catch (err) {
    console.error(`  [IL] Extraction failed:`, err);
    return { speechAct: 'smalltalk', extractionConfidence: 0 };
  } finally {
    llmSemaphore.release();
  }
}

// ─── Validation & Entity Resolution ───

const VALID_SPEECH_ACTS = new Set<SpeechAct>([
  'inform', 'question', 'request', 'accuse', 'threaten', 'compliment',
  'insult', 'bribe', 'confide', 'trade', 'smalltalk',
]);

const VALID_CLAIM_SOURCES = new Set(['witnessed', 'heard', 'suspects', 'deduced']);
const VALID_PRESSURE_TYPES = new Set(['threat', 'bribe', 'flattery', 'guilt', 'intimidation']);

function validateAndResolve(raw: Record<string, unknown>, ctx: ILContext): DialogueMeaning {
  const result: DialogueMeaning = {
    speechAct: VALID_SPEECH_ACTS.has(raw.speechAct as SpeechAct)
      ? raw.speechAct as SpeechAct
      : 'smalltalk',
    extractionConfidence: clamp(Number(raw.extractionConfidence) || 0.5),
  };

  // Resolve claims
  if (Array.isArray(raw.claims) && raw.claims.length > 0) {
    result.claims = raw.claims
      .map((c: Record<string, unknown>) => resolveClaim(c, ctx))
      .filter(Boolean) as Claim[];
    if (result.claims.length === 0) delete result.claims;
  }

  // Resolve questions
  if (Array.isArray(raw.questions) && raw.questions.length > 0) {
    result.questions = raw.questions
      .map((q: Record<string, unknown>) => ({
        about: resolveNpcName(String(q.about ?? ''), ctx.npcNames) ?? String(q.about ?? ''),
        topic: q.topic ? String(q.topic) : undefined,
      }))
      .filter((q) => q.about);
    if (result.questions.length === 0) delete result.questions;
  }

  // Resolve requested action
  if (raw.requestedAction && typeof raw.requestedAction === 'object') {
    const ra = raw.requestedAction as Record<string, unknown>;
    if (ra.action) {
      result.requestedAction = {
        action: String(ra.action).toLowerCase(),
        target: ra.target ? (resolveNpcName(String(ra.target), ctx.npcNames) ?? resolveLocation(String(ra.target), ctx.locationNames) ?? String(ra.target)) : undefined,
        urgency: clamp(Number(ra.urgency) || 0.5),
      };
    }
  }

  // Resolve emotional pressure
  if (raw.emotionalPressure && typeof raw.emotionalPressure === 'object') {
    const ep = raw.emotionalPressure as Record<string, unknown>;
    if (VALID_PRESSURE_TYPES.has(String(ep.type))) {
      result.emotionalPressure = {
        type: String(ep.type) as EmotionalPressure['type'],
        intensity: clamp(Number(ep.intensity) || 0.5),
      };
    }
  }

  // Resolve trade intent
  if (raw.tradeIntent && typeof raw.tradeIntent === 'object') {
    const ti = raw.tradeIntent as Record<string, unknown>;
    result.tradeIntent = {
      category: ti.category ? String(ti.category) : undefined,
      itemName: ti.itemName ? String(ti.itemName) : undefined,
    };
  }

  return result;
}

function resolveClaim(raw: Record<string, unknown>, ctx: ILContext): Claim | null {
  const source = VALID_CLAIM_SOURCES.has(String(raw.source)) ? String(raw.source) as Claim['source'] : 'heard';
  const subject = raw.subject ? resolveNpcName(String(raw.subject), ctx.npcNames) : undefined;
  const object = raw.object ? resolveNpcName(String(raw.object), ctx.npcNames) : undefined;
  const location = raw.location ? resolveLocation(String(raw.location), ctx.locationNames) : undefined;

  // Must have at least some content
  if (!subject && !object && !raw.eventType && !location) return null;

  return {
    eventType: raw.eventType ? String(raw.eventType) : undefined,
    subject,
    object,
    location,
    timePeriod: raw.timePeriod ? String(raw.timePeriod) : undefined,
    source,
    confidence: clamp(Number(raw.confidence) || 0.5),
  };
}

/** Fuzzy match NPC name — case-insensitive, partial match */
function resolveNpcName(input: string, known: string[]): string | undefined {
  if (!input) return undefined;
  const lower = input.toLowerCase();
  // Exact match (case-insensitive)
  const exact = known.find((n) => n.toLowerCase() === lower);
  if (exact) return exact;
  // Partial match (input contains known name or vice versa)
  const partial = known.find((n) => lower.includes(n.toLowerCase()) || n.toLowerCase().includes(lower));
  return partial ?? undefined;
}

/** Fuzzy match location name */
function resolveLocation(input: string, known: string[]): string | undefined {
  if (!input) return undefined;
  const lower = input.toLowerCase();
  const exact = known.find((n) => n.toLowerCase() === lower);
  if (exact) return exact;
  const partial = known.find((n) => lower.includes(n.toLowerCase()) || n.toLowerCase().includes(lower));
  return partial ?? undefined;
}

function clamp(n: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, n));
}

// ─── IL Effects: Apply DialogueMeaning to engine systems ───

export interface ILEffectContext {
  /** The NPC being talked to */
  targetAgent: Agent;
  /** Player Agent */
  playerAgent: Agent;
  /** All agents in the world */
  agents: Map<string, Agent>;
  /** Event store for recording player actions */
  eventStore: IEventStore;
  /** Current game day */
  gameDay: number;
  /** Optional: create a goal for NPC from player request. Returns true if goal was created. */
  goalCreator?: (npcId: string, action: string, target?: string) => boolean;
}

/**
 * Apply the extracted dialogue meaning to engine systems.
 * Returns additional context string for the NPC's chatStream response.
 */
export function applyDialogueMeaning(
  meaning: DialogueMeaning,
  ctx: ILEffectContext,
): string {
  const npc = ctx.targetAgent;
  const playerName = ctx.playerAgent.profile.name;
  const sections: string[] = [];

  // 1. Claims → create beliefs in NPC (same mechanism as beliefTransfer)
  if (meaning.claims && meaning.claims.length > 0) {
    const playerRel = npc.state.relationships?.getRelationship(ctx.playerAgent.profile.id);
    if (!playerRel) {
      console.error(`  [IL] BUG: ${npc.profile.name} has no relationship to player — beliefs cannot be created`);
    }
    const playerTrust = playerRel?.trust ?? 0; // 0 = no trust if relationship missing (bug, logged above)

    for (const claim of meaning.claims) {
      // Resolve subject/object to NPC IDs
      const subjectAgent = claim.subject ? findAgentByName(claim.subject, ctx.agents) : null;
      const objectAgent = claim.object ? findAgentByName(claim.object, ctx.agents) : null;

      if (claim.eventType && (subjectAgent || objectAgent)) {
        const effectiveConfidence = claim.confidence * playerTrust;

        npc.state.beliefs?.addBelief({
          id: crypto.randomUUID(),
          eventType: claim.eventType,
          subject: subjectAgent?.profile.name ?? claim.subject ?? null,
          object: objectAgent?.profile.name ?? claim.object ?? null,
          location: claim.location ?? null,
          confidence: effectiveConfidence,
          source: BELIEF_SOURCE.TESTIMONY,
          sourceNpcId: ctx.playerAgent.profile.id,
          gameDay: ctx.gameDay,
          lastUpdated: ctx.gameDay,
        });

        console.log(`  [IL] Belief created in ${npc.profile.name}: ${claim.eventType} subject=${claim.subject} conf=${effectiveConfidence.toFixed(2)} (trust=${playerTrust.toFixed(2)})`);
        const eventLabel = claim.eventType ? (getEventLabel(claim.eventType) ?? 'crime') : null;
        sections.push(`${playerName} claims: ${claim.subject ?? 'someone'}${eventLabel ? ` was involved in ${eventLabel.toLowerCase()}` : ''}${claim.object ? ` against ${claim.object}` : ''}. You ${playerTrust >= 0.5 ? 'find this somewhat credible' : 'are skeptical about this claim'}.`);
      } else if (claim.subject) {
        // Non-event claim — suspicion or observation about an NPC
        sections.push(`${playerName} mentions something suspicious about ${claim.subject}.`);
      }
    }
  }

  // 2. Questions → gather NPC beliefs for response context
  if (meaning.questions && meaning.questions.length > 0) {
    for (const q of meaning.questions) {
      const aboutAgent = findAgentByName(q.about, ctx.agents);
      if (aboutAgent && npc.state.beliefs) {
        const beliefs = npc.state.beliefs.getAllBeliefs()
          .filter((b) => b.subject === aboutAgent.profile.name || b.object === aboutAgent.profile.name);
        if (beliefs.length > 0) {
          const beliefSummary = beliefs.slice(0, 3).map((b) =>
            `${b.eventType}: ${b.subject ?? '?'} → ${b.object ?? '?'} (conf: ${b.confidence.toFixed(1)}, source: ${b.source})`
          ).join('; ');
          sections.push(`You know about ${aboutAgent.profile.name}: ${beliefSummary}. Answer from your knowledge.`);
        } else {
          sections.push(`You don't have any specific knowledge about ${aboutAgent.profile.name} related to ${q.topic ?? 'this topic'}.`);
        }
      }
      // Relationship info
      if (aboutAgent) {
        const rel = npc.state.relationships?.getRelationship(aboutAgent.profile.id);
        if (rel) {
          sections.push(`Your relationship with ${aboutAgent.profile.name}: ${rel.type}, sentiment ${rel.sentiment.toFixed(1)}.`);
        }
      }
    }
  }

  // 3. Emotional pressure → mood + relationship + event store
  if (meaning.emotionalPressure) {
    const ep = meaning.emotionalPressure;
    switch (ep.type) {
      case 'threat':
        npc.state.mood = Math.max(-1, npc.state.mood - ep.intensity * 0.2);
        updateRelationshipBilateral(ctx.playerAgent, npc, -ep.intensity * 0.15, -ep.intensity * 0.1);
        ctx.eventStore.append({
          id: crypto.randomUUID(),
          type: PLAYER_ACTION_EVENT,
          subject: ctx.playerAgent.profile.id,
          object: npc.profile.id,
          location: npc.state.location,
          gameDay: ctx.gameDay,
          importance: Math.round(3 + ep.intensity * 4),
          payload: { action: PLAYER_ACTIONS.THREATEN, intensity: ep.intensity },
        });
        npc.observe(`${playerName} threatened me. ${ep.intensity > 0.5 ? 'It was frightening.' : 'It was unsettling.'}`, Math.round(3 + ep.intensity * 4));
        sections.push(`You feel ${ep.intensity > 0.7 ? 'genuinely afraid' : ep.intensity > 0.4 ? 'uneasy and defensive' : 'slightly annoyed by the posturing'}.`);
        break;

      case 'bribe':
        ctx.eventStore.append({
          id: crypto.randomUUID(),
          type: PLAYER_ACTION_EVENT,
          subject: ctx.playerAgent.profile.id,
          object: npc.profile.id,
          location: npc.state.location,
          gameDay: ctx.gameDay,
          importance: 5,
          payload: { action: PLAYER_ACTIONS.BRIBE, intensity: ep.intensity },
        });
        npc.observe(`${playerName} tried to bribe me.`, 5);
        sections.push(`${playerName} is offering you something in exchange for a favor. ${npc.profile.bigFive.honesty >= 0.6 ? 'This offends your sense of integrity.' : 'The offer is... tempting.'}`);
        break;

      case 'flattery':
        npc.state.mood = Math.min(1, npc.state.mood + ep.intensity * 0.1);
        updateRelationshipBilateral(ctx.playerAgent, npc, ep.intensity * 0.05, ep.intensity * 0.05);
        sections.push(`${playerName} is being very complimentary. ${npc.profile.bigFive.agreeableness >= 0.6 ? 'You appreciate the kind words.' : 'You wonder what they want.'}`);
        break;

      case 'guilt':
        npc.state.mood = Math.max(-1, npc.state.mood - ep.intensity * 0.1);
        sections.push(`${playerName}'s words hit close to home. You feel a pang of guilt.`);
        break;

      case 'intimidation':
        npc.state.mood = Math.max(-1, npc.state.mood - ep.intensity * 0.15);
        updateRelationshipBilateral(ctx.playerAgent, npc, -ep.intensity * 0.1, -ep.intensity * 0.1);
        sections.push(`You feel pressured by ${playerName}'s demeanor.`);
        break;
    }
  }

  // 4. Compliment / insult speech acts (without explicit emotionalPressure)
  if (meaning.speechAct === 'compliment' && !meaning.emotionalPressure) {
    npc.state.mood = Math.min(1, npc.state.mood + 0.08);
    updateRelationshipBilateral(ctx.playerAgent, npc, 0.05, 0.03);
    npc.observe(`${playerName} said something kind to me.`, 2);
  }
  if (meaning.speechAct === 'insult' && !meaning.emotionalPressure) {
    npc.state.mood = Math.max(-1, npc.state.mood - 0.08);
    updateRelationshipBilateral(ctx.playerAgent, npc, -0.08, -0.05);
    npc.observe(`${playerName} insulted me.`, 3);
  }

  // 5. Requested action → evaluate affordance, create goal if trust sufficient
  if (meaning.requestedAction) {
    const ra = meaning.requestedAction;
    const reqRel = npc.state.relationships?.getRelationship(ctx.playerAgent.profile.id);
    const playerTrust = reqRel?.trust ?? 0;

    if (playerTrust >= 0.4 && ctx.goalCreator) {
      // Trust sufficient — try to create goal from request
      const created = ctx.goalCreator(npc.profile.id, ra.action, ra.target);
      if (created) {
        sections.push(`${playerName} asked you to ${ra.action}${ra.target ? ` regarding ${ra.target}` : ''}. You trust them enough to act on this.`);
        console.log(`  [IL] Goal created for ${npc.profile.name}: ${ra.action}${ra.target ? ` → ${ra.target}` : ''}`);
      } else {
        sections.push(`${playerName} asked you to ${ra.action}${ra.target ? ` regarding ${ra.target}` : ''}, but you can't do that right now.`);
      }
    } else {
      sections.push(`${playerName} is asking you to ${ra.action}${ra.target ? ` regarding ${ra.target}` : ''}. ${playerTrust >= 0.3 ? 'You barely know this person — why would you listen?' : 'You don\'t trust this person at all.'}`);
    }
  }

  return sections.length > 0
    ? `## What ${playerName} communicated (structured):\n${sections.join('\n')}`
    : '';
}

// ─── Helpers ───

function findAgentByName(name: string, agents: Map<string, Agent>): Agent | undefined {
  const lower = name.toLowerCase();
  for (const agent of agents.values()) {
    if (agent.profile.name.toLowerCase() === lower) return agent;
    // Partial match: "Bess" matches "Old Bess"
    if (agent.profile.name.toLowerCase().includes(lower) || lower.includes(agent.profile.name.toLowerCase())) return agent;
  }
  return undefined;
}

/** Update relationship in BOTH directions: NPC→Player and Player→NPC (bilateral) */
function updateRelationshipBilateral(player: Agent, npc: Agent, sentimentDelta: number, trustDelta: number): void {
  // NPC → Player
  const npcToPlayer = npc.state.relationships?.getRelationship(player.profile.id);
  if (npcToPlayer) {
    npcToPlayer.sentiment = Math.max(-1, Math.min(1, npcToPlayer.sentiment + sentimentDelta));
    npcToPlayer.trust = Math.max(0, Math.min(1, npcToPlayer.trust + trustDelta));
  }
  // Player → NPC (bilateral: player's perception of NPC also shifts)
  const playerToNpc = player.state.relationships?.getRelationship(npc.profile.id);
  if (playerToNpc) {
    // Player side shifts less (player is the actor, NPC is the reactor)
    playerToNpc.sentiment = Math.max(-1, Math.min(1, playerToNpc.sentiment + sentimentDelta * 0.5));
  }
}
