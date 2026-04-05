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
import { getEventLabel, getEventLabelSafe, BELIEF_SOURCE, isTransferable, getAffordanceIdsForVerb } from './event-registry';
import type { ILConfig } from './world-types';
import type { PlayerJournal, CaseSummary } from './journal';
import { DEFAULT_IL_CONFIG } from './world-types';
import { TIME_PERIODS } from './schedule';
import { llmCall } from './llm-client';
import type { LlmJsonSchema } from './llm-client';

const VALID_QUESTION_TOPICS = ['whereabouts', 'opinion', 'knowledge', 'relationship', 'secret'];

/**
 * Build IL extraction schema dynamically with enum constraints from context.
 * Pattern: identical to getVolitionSchema() — constrained decoding forces valid output.
 * Not cached: ctx is per-call (NPC can die → knownEventTypes/locations change).
 */
// Trade-related verbs added to action enum so the model doesn't hallucinate 'steal' for buy/sell intent.
// These are NOT affordances — they're IL-only signals resolved to speechAct='trade' in validation.
const IL_TRADE_VERBS = ['buy', 'sell', 'browse', 'trade'];

function buildILSchema(ctx: ILContext): LlmJsonSchema {
  const speechActs = Array.from(VALID_SPEECH_ACTS);
  const claimSources = Array.from(VALID_CLAIM_SOURCES);
  const pressureTypes = Array.from(VALID_PRESSURE_TYPES);
  // Trade verbs FIRST — 9B constrained decoding biased toward early enum values.
  // With steal before buy, "show me your wares" → steal. With buy first → buy.
  const actionVerbs = [...new Set([...IL_TRADE_VERBS, ...ctx.availableActions])];

  return {
    name: 'dialogue_meaning',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        speechAct: { type: 'string', enum: speechActs },
        claims: { type: 'array', items: { type: 'object', properties: {
          eventType: { type: 'string', enum: ctx.knownEventTypes },
          subject: { type: 'string' },     // free text — resolveNpcName handles fuzzy match
          object: { type: 'string' },       // free text
          location: { type: 'string', enum: ctx.locationNames }, // display names; post-process → slug
          source: { type: 'string', enum: claimSources },
          confidence: { type: 'number' },
        }, required: ['confidence'], additionalProperties: false } },
        questions: { type: 'array', items: { type: 'object', properties: {
          about: { type: 'string' },        // free text — fuzzy match
          topic: { type: 'string', enum: VALID_QUESTION_TOPICS },
        }, required: ['about'], additionalProperties: false } },
        requestedAction: { type: 'object', properties: {
          action: { type: 'string', enum: actionVerbs },
          target: { type: 'string' },       // free text
          urgency: { type: 'number' },
        }, required: ['action', 'urgency'], additionalProperties: false },
        emotionalPressure: { type: 'object', properties: {
          type: { type: 'string', enum: pressureTypes },
          intensity: { type: 'number' },
        }, required: ['type', 'intensity'], additionalProperties: false },
        tradeIntent: { type: 'object', properties: {
          category: { type: 'string' },
          itemName: { type: 'string' },
        }, additionalProperties: false },
        extractionConfidence: { type: 'number' },
      },
      required: ['speechAct', 'extractionConfidence'],
      additionalProperties: false,
    },
  };
}

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
  /** All known NPC names with roles for prompt, e.g. "Garrett (guard)" */
  npcNames: string[];
  /** All known location display names for prompt */
  locationNames: string[];
  /** Display name → slug mapping for location resolution */
  locationNameToSlug: Map<string, string>;
  /** Known event type categories (for claim matching) */
  knownEventTypes: string[];
  /** Available action verbs NPC can perform (from ACTION_VERB_MAP) */
  availableActions: string[];
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
    `1. speechAct: one of: ${Array.from(VALID_SPEECH_ACTS).join(', ')}`,
    `   IMPORTANT: "trade" = player wants to buy, sell, browse goods, or ask about prices. Use speechAct "trade" + tradeIntent, NOT requestedAction.`,
    ``,
    `2. claims: array of factual claims the player is making (if any). Each claim:`,
    `   - eventType: event type if claiming something happened (use known event types, or null)`,
    `   - subject: WHO did it (must be a known NPC name, or null)`,
    `   - object: WHO was affected (NPC name, or null)`,
    `   - location: WHERE (must be a known location, or null)`,
    `   - timePeriod: WHEN (${TIME_PERIODS.join('/')}, or null)`,
    `   - source: how the player knows (${Array.from(VALID_CLAIM_SOURCES).join(', ')})`,
    `   - confidence: 0-1 how certain the claim sounds`,
    ``,
    `3. questions: array of questions being asked (if any). Each:`,
    `   - about: who/what is being asked about (NPC name or topic)`,
    `   - topic: ${VALID_QUESTION_TOPICS.join(', ')} (or null)`,
    ``,
    `4. requestedAction: if player is asking the NPC to DO a specific action (NOT buying/selling — that is trade):`,
    `   - action: use one of these verbs: ${[...IL_TRADE_VERBS, ...ctx.availableActions].join(', ')}`,
    `   - target: target NPC or location (or null)`,
    `   - urgency: 0-1`,
    ``,
    `5. emotionalPressure: if player is pressuring the NPC:`,
    `   - type: ${Array.from(VALID_PRESSURE_TYPES).join(', ')}`,
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
      jsonSchema: buildILSchema(ctx),
    });

    if (!content) {
      console.warn(`  [IL] LLM returned empty content — falling back to smalltalk`);
      return { speechAct: 'smalltalk', extractionConfidence: 0, _fallback: 'empty_response' as any };
    }

    const raw = JSON.parse(content) as Record<string, unknown>;
    console.log(`  [IL] Raw LLM output: ${JSON.stringify(raw)}`);
    return validateAndResolve(raw, ctx);
  } catch (err) {
    console.error(`  [IL] Extraction failed:`, err);
    return { speechAct: 'smalltalk', extractionConfidence: 0, _fallback: 'extraction_error' as any };
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
  if (!VALID_SPEECH_ACTS.has(raw.speechAct as SpeechAct)) {
    console.warn(`  [IL] Invalid speechAct '${raw.speechAct}' — falling back to 'smalltalk'`);
  }
  if (raw.extractionConfidence == null || isNaN(Number(raw.extractionConfidence))) {
    console.warn(`  [IL] Missing/invalid extractionConfidence '${raw.extractionConfidence}' — defaulting to 0.5`);
  }

  // Semantic correction: tradeIntent presence overrides speechAct to 'trade'.
  // Root cause: constrained decoding forces requestedAction.action into affordance verbs,
  // so "show me your wares" → model picks 'steal' (nearest verb). Before enum constraints,
  // free-text action would fail gracefully. With enums, we need explicit signal priority:
  // tradeIntent > requestedAction when both present.
  let speechAct: SpeechAct = VALID_SPEECH_ACTS.has(raw.speechAct as SpeechAct)
    ? raw.speechAct as SpeechAct
    : 'smalltalk';
  // Semantic correction: detect trade intent from multiple signals.
  // Root cause: constrained decoding forces action into enum. Before enums, model could
  // return free-text "browse" → graceful skip. With enums, we add buy/sell/browse/trade
  // as IL-only verbs so the model has a correct option. If model picks them → trade.
  const tradeIntentObj = raw.tradeIntent && typeof raw.tradeIntent === 'object' ? raw.tradeIntent as Record<string, unknown> : null;
  const hasTradeContent = tradeIntentObj && (tradeIntentObj.category || tradeIntentObj.itemName);
  const raObj = raw.requestedAction && typeof raw.requestedAction === 'object' ? raw.requestedAction as Record<string, unknown> : null;
  const actionIsTrade = raObj && IL_TRADE_VERBS.includes(String(raObj.action));

  if ((hasTradeContent || actionIsTrade) && speechAct !== 'trade') {
    console.warn(`  [IL] Trade signals detected (tradeIntent: ${!!hasTradeContent}, action: ${raObj?.action}) but speechAct='${speechAct}' — correcting to 'trade'`);
    speechAct = 'trade';
  }

  // When trade detected, requestedAction and emotionalPressure are noise
  const isTrade = speechAct === 'trade';
  if (isTrade && raw.requestedAction) console.warn(`  [IL] Discarding requestedAction (trade context)`);
  if (isTrade && raw.emotionalPressure) console.warn(`  [IL] Discarding emotionalPressure (trade context)`);

  const result: DialogueMeaning = {
    speechAct,
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

  // Resolve requested action (skip if trade — enum-forced hallucination)
  if (!isTrade && raw.requestedAction && typeof raw.requestedAction === 'object') {
    const ra = raw.requestedAction as Record<string, unknown>;
    if (ra.action) {
      let resolvedTarget: string | undefined;
      if (ra.target) {
        const targetStr = String(ra.target);
        resolvedTarget = resolveNpcName(targetStr, ctx.npcNames) ?? resolveLocation(targetStr, ctx.locationNames);
        if (!resolvedTarget) {
          console.warn(`  [IL] requestedAction target '${targetStr}' not resolved to known NPC or location — using raw`);
          resolvedTarget = targetStr;
        }
      }
      result.requestedAction = {
        action: String(ra.action).toLowerCase(),
        target: resolvedTarget,
        urgency: clamp(Number(ra.urgency) || 0.5),
      };
    }
  }

  // Resolve emotional pressure
  // Skip if trade (hallucinated). For other benign speechActs (question, smalltalk, inform, compliment),
  // require high intensity (>0.5) — 9B model hallucinates low-intensity threat/intimidation on innocent phrases.
  // Real threats have speechAct='threaten' or high intensity.
  const BENIGN_SPEECH_ACTS = new Set<string>(['smalltalk', 'question', 'inform', 'compliment', 'trade', 'confide']);
  if (!isTrade && raw.emotionalPressure && typeof raw.emotionalPressure === 'object') {
    const ep = raw.emotionalPressure as Record<string, unknown>;
    const epIntensity = clamp(Number(ep.intensity) || 0.5);
    const isBenign = BENIGN_SPEECH_ACTS.has(speechAct);
    if (VALID_PRESSURE_TYPES.has(String(ep.type))) {
      if (isBenign && epIntensity <= 0.5) {
        console.warn(`  [IL] Discarding low-intensity pressure '${ep.type}' (${epIntensity}) on benign speechAct '${speechAct}' — likely hallucination`);
      } else {
        result.emotionalPressure = {
          type: String(ep.type) as EmotionalPressure['type'],
          intensity: epIntensity,
        };
      }
    } else if (ep.type) {
      console.warn(`  [IL] Invalid emotionalPressure type '${ep.type}' — dropped`);
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
  const rawSource = String(raw.source);
  if (raw.source && !VALID_CLAIM_SOURCES.has(rawSource)) {
    console.warn(`  [IL] Invalid claim source '${rawSource}' — falling back to 'heard'`);
  }
  const source = VALID_CLAIM_SOURCES.has(rawSource) ? rawSource as Claim['source'] : 'heard';
  const subject = raw.subject ? resolveNpcName(String(raw.subject), ctx.npcNames) : undefined;
  if (raw.subject && !subject) console.warn(`  [IL] Could not resolve claim subject '${raw.subject}' to known NPC`);
  const object = raw.object ? resolveNpcName(String(raw.object), ctx.npcNames) : undefined;
  if (raw.object && !object) console.warn(`  [IL] Could not resolve claim object '${raw.object}' to known NPC`);
  const displayLoc = raw.location ? resolveLocation(String(raw.location), ctx.locationNames) : undefined;
  if (raw.location && !displayLoc) console.warn(`  [IL] Could not resolve claim location '${raw.location}' to known location`);
  // Convert display name → slug for engine consistency (principle 42)
  const location = displayLoc ? (ctx.locationNameToSlug.get(displayLoc) ?? undefined) : undefined;
  if (displayLoc && !location) console.warn(`  [IL] Location '${displayLoc}' resolved but no slug mapping found`);

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

/** Strip "(role)" suffix: "Garrett (guard)" → "garrett" */
function stripRole(s: string): string {
  return s.replace(/\s*\(.*?\)\s*$/, '').toLowerCase();
}

/** Fuzzy match NPC name — case-insensitive, strips role suffix, pre-stripped for efficiency */
function resolveNpcName(input: string, known: string[]): string | undefined {
  if (!input) return undefined;
  const stripped = stripRole(input);
  const knownStripped = known.map(n => ({ orig: n, clean: stripRole(n) }));
  // Exact match (ignoring role suffix)
  const exact = knownStripped.find(k => k.clean === stripped);
  if (exact) return exact.orig;
  // Partial match (input contains known name or vice versa)
  const partial = knownStripped.find(k => stripped.includes(k.clean) || k.clean.includes(stripped));
  return partial?.orig ?? undefined;
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

/** Structured record of a mechanical effect applied by IL */
export type ILEffect =
  | { type: 'belief_created'; eventType: string; subject: string | null; confidence: number; trust: number }
  | { type: 'belief_rejected'; reason: string; subject?: string }
  | { type: 'mood_change'; delta: number; newMood: number }
  | { type: 'relationship_change'; field: 'trust' | 'sentiment'; delta: number }
  | { type: 'goal_created'; action: string; affordanceId: string; target?: string }
  | { type: 'goal_rejected'; action: string; reason: string; trust?: number }
  | { type: 'event_stored'; eventType: string; action: string }
  | { type: 'memory_stored'; text: string; importance: number };

/** Journal evidence entry attached to chat message for Evidence Presentation */
export interface PresentedEvidence {
  entryId: string;
  text: string;
  evidenceCategory?: string;
  evidenceWeight?: number;
  eventType?: string;
  suspectId?: string;
  suspectName?: string;
  victimId?: string;
}

/** Per-chat transient state for multi-turn detective interaction */
export interface ConversationSession {
  npcId: string;
  startedAt: number; // gameMinute
  messageCount: number;
  /** Tracks repeated accusations per suspect within this chat */
  accusationHistory: Map<string, {
    count: number;
    /** Journal entry count for suspect at time of accusation — detects new evidence */
    lastJournalHash: number;
  }>;
  /** Log of formal accusations made in this chat — detects scatter-accusing */
  formalAccusations: Array<{ suspectId: string; suspectName: string; tick: number }>;
}

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
  /** Mutable: applyDialogueMeaning pushes mechanical effects here for WS broadcast */
  effects: ILEffect[];
  /** Behavioral parameters (thresholds, multipliers). Defaults from DEFAULT_IL_CONFIG. */
  ilConfig?: ILConfig;
  /** Evidence entries from journal attached to this message */
  presentedEvidence?: PresentedEvidence[];
  /** Player journal — needed for accusation evidence aggregation */
  playerJournal?: PlayerJournal;
  /** Per-chat session state — repetition tracking, multiple suspect detection */
  chatSession?: ConversationSession;
  /** Add a mood modifier to an NPC (SPEC-mood-modifiers) */
  addMoodModifier?: (npcId: string, mod: { source: string; category: string; magnitude: number; remaining: number; duration: number; decay: 'exponential' | 'linear' | 'none' }) => void;
}

/**
 * Process evidence entries attached to a chat message.
 * Creates beliefs with source EVIDENCE — physical evidence is NOT trust-scaled.
 * Returns prompt context string describing the presented evidence.
 */
export function processEvidencePresentation(ctx: ILEffectContext): string {
  const evidence = ctx.presentedEvidence;
  if (!evidence || evidence.length === 0) return '';

  const npc = ctx.targetAgent;
  const playerId = ctx.playerAgent.profile.id;
  const playerTrust = npc.state.relationships?.getRelationship(playerId)?.trust ?? 0;
  const lines: string[] = [];

  for (const ev of evidence) {
    if (!ev.eventType) continue;

    // Evidence confidence from weight field — no category string checks in engine.
    // Modules set evidenceWeight at creation time: physical=0.15-0.25, witness=0.5, etc.
    // Entries without evidenceWeight (player observations): trust-scaled fallback.
    const confidence = ev.evidenceWeight != null
      ? ev.evidenceWeight
      : 0.4 * playerTrust;

    if (confidence < 0.05) continue;

    npc.state.beliefs?.addBelief({
      id: crypto.randomUUID(),
      eventType: ev.eventType,
      subject: ev.suspectName ?? null,
      object: null,
      location: null,
      confidence,
      source: BELIEF_SOURCE.EVIDENCE,
      sourceNpcId: playerId,
      gameDay: ctx.gameDay,
      lastUpdated: ctx.gameDay,
    });

    ctx.effects.push({
      type: 'belief_created',
      eventType: ev.eventType,
      subject: ev.suspectName ?? null,
      confidence: +confidence.toFixed(2),
      trust: +playerTrust.toFixed(2),
    });

    const catLabel = ev.evidenceCategory ?? 'evidence';
    lines.push(`- "${ev.text}" (${catLabel}${ev.suspectName ? `, pointing to ${ev.suspectName}` : ''})`);
    console.log(`  [IL] Evidence belief: ${ev.eventType} suspect=${ev.suspectName} conf=${confidence.toFixed(2)} cat=${catLabel} (NOT trust-scaled)`);
  }

  if (lines.length === 0) return '';

  return [
    '[EVIDENCE PRESENTED]',
    'The player shows you documented evidence:',
    ...lines,
    'This is tangible evidence from the crime scene investigation, not just hearsay.',
    'Consider it alongside your own knowledge.',
  ].join('\n');
}

// ─── Accusation System ───

export interface AccusationContext {
  suspectId: string;
  suspectName: string;
  crimeLabel: string;
  journalEvidence: CaseSummary;
  npcMaxConfidence: number;
  npcHasOwnEvidence: boolean;
  playerTrust: number;
  combinedScore: number;
  combinedQuality: 'strong' | 'moderate' | 'weak' | 'insufficient';
}

function computeTrustBonus(trust: number): number {
  if (trust >= 0.7) return 1.0;
  if (trust >= 0.4) return 0.6;
  return 0.2;
}

/**
 * Build accusation context for authority NPCs (investigator/canSentence).
 * Evidence quality is computed DETERMINISTICALLY — LLM provides voice, engine provides logic.
 */
export function buildAccusationContext(
  suspectId: string,
  claimEventType: string,
  npc: Agent,
  playerJournal: PlayerJournal,
  playerTrust: number,
  agents: Map<string, Agent>,
): AccusationContext {
  const suspectAgent = agents.get(suspectId);
  const suspectName = suspectAgent?.profile.name ?? suspectId;
  const crimeLabel = getEventLabelSafe(claimEventType, 'wrongdoing');

  // Player's journal evidence
  const journalEvidence = playerJournal.getCaseSummary(suspectId, suspectName);

  // NPC's own beliefs about suspect
  let npcMaxConfidence = 0;
  let npcHasOwnEvidence = false;
  if (npc.state.beliefs) {
    for (const b of npc.state.beliefs.getAllBeliefs()) {
      if (b.subject === suspectName && isTransferable(b.eventType)) {
        if (b.confidence > npcMaxConfidence) npcMaxConfidence = b.confidence;
        if (b.source !== BELIEF_SOURCE.TESTIMONY) npcHasOwnEvidence = true;
      }
    }
  }

  // Combined score: journal 50% + NPC beliefs 35% + trust bonus 15%
  const trustBonus = computeTrustBonus(playerTrust);
  const combinedScore = journalEvidence.totalScore * 0.5
    + npcMaxConfidence * 0.35
    + trustBonus * 0.15;

  const combinedQuality: AccusationContext['combinedQuality'] =
    combinedScore >= 0.7 ? 'strong' :
    combinedScore >= 0.4 ? 'moderate' :
    combinedScore >= 0.2 ? 'weak' :
    'insufficient';

  return {
    suspectId, suspectName, crimeLabel,
    journalEvidence, npcMaxConfidence, npcHasOwnEvidence,
    playerTrust, combinedScore, combinedQuality,
  };
}

/** Build NPC prompt section for formal accusation. */
function buildAccusationPrompt(acc: AccusationContext, npc: Agent): string {
  const ev = acc.journalEvidence.evidence;
  const evParts = Object.entries(ev).filter(([, n]) => n > 0).map(([cat, n]) => `${n} ${cat}`);
  const evDesc = evParts.length ? evParts.join(', ') : 'none';

  const npcConfDesc = acc.npcMaxConfidence >= 0.6 ? 'significant suspicion'
    : acc.npcMaxConfidence >= 0.3 ? 'some suspicion'
    : acc.npcMaxConfidence > 0 ? 'faint suspicion'
    : 'no independent findings';

  const trustDesc = acc.playerTrust >= 0.7 ? 'well-established'
    : acc.playerTrust >= 0.4 ? 'moderate'
    : 'low';

  const qualityGuidance: Record<string, string> = {
    strong: 'This evidence warrants immediate action.',
    moderate: 'Worth investigating further. Tell the player what additional evidence would help.',
    weak: 'Not enough to act on. Explain what is missing.',
    insufficient: 'This accusation has no real basis. Warn the player about making unfounded accusations.',
  };

  // Personality modulation
  let personalityNote = '';
  const H = npc.profile.bigFive.honesty;
  const C = npc.profile.bigFive.conscientiousness;
  if (npc.profile.investigator) {
    personalityNote = C >= 0.7
      ? 'As a disciplined investigator, you need solid evidence before acting.'
      : H < 0.5
        ? 'You might be open to... alternative forms of persuasion.'
        : 'You want to do the right thing but need convincing evidence.';
  } else if (npc.profile.canSentence) {
    personalityNote = 'You cannot arrest anyone. Tell the player to bring this to someone with the authority to make arrests.';
  }

  return [
    '[FORMAL ACCUSATION]',
    `The player formally accuses ${acc.suspectName} of ${acc.crimeLabel}.`,
    '',
    'Evidence assessment:',
    `- Player documented evidence: ${acc.journalEvidence.quality} (${evDesc})`,
    `- Your own findings: ${npcConfDesc}`,
    `- Player trustworthiness: ${trustDesc}`,
    `- Combined evidence quality: ${acc.combinedQuality.toUpperCase()}`,
    '',
    qualityGuidance[acc.combinedQuality],
    personalityNote,
  ].join('\n');
}

/**
 * Apply the extracted dialogue meaning to engine systems.
 * Returns additional context string for the NPC's chatStream response.
 *
 * Consistency contract (bilateral design):
 *   - Claims use isTransferable() filter, same as NPC-NPC beliefTransfer (goals.ts)
 *   - Confidence = claim.confidence × trust, minimum threshold 0.1
 *   - Relationship changes go through adjustSentiment/adjustTrust for WS broadcast
 *   - observe() awaited for memory consistency before NPC responds
 */
export async function applyDialogueMeaning(
  meaning: DialogueMeaning,
  ctx: ILEffectContext,
): Promise<string> {
  const npc = ctx.targetAgent;
  const playerId = ctx.playerAgent.profile.id;
  const playerName = ctx.playerAgent.profile.name;
  const sections: string[] = [];
  const cfg = ctx.ilConfig ?? DEFAULT_IL_CONFIG;

  // 0. Evidence presentation → beliefs with source EVIDENCE (NOT trust-scaled)
  const evidenceContext = processEvidencePresentation(ctx);
  if (evidenceContext) sections.push(evidenceContext);

  // 1. Claims → create beliefs in NPC (consistent with NPC-NPC beliefTransfer)
  if (meaning.claims && meaning.claims.length > 0) {
    const playerRel = npc.state.relationships?.getRelationship(playerId);
    if (!playerRel) {
      console.error(`  [IL] BUG: ${npc.profile.name} has no relationship to player — beliefs cannot be created`);
    }
    const playerTrust = playerRel?.trust ?? 0;

    for (const claim of meaning.claims) {
      const subjectAgent = claim.subject ? findAgentByName(claim.subject, ctx.agents) : null;
      const objectAgent = claim.object ? findAgentByName(claim.object, ctx.agents) : null;

      if (claim.eventType && (subjectAgent || objectAgent)) {
        if (!isTransferable(claim.eventType)) {
          ctx.effects.push({ type: 'belief_rejected', reason: 'not transferable', subject: claim.subject ?? undefined });
          sections.push(`${playerName} mentions something about ${claim.subject ?? 'someone'}, but it's not actionable information.`);
          continue;
        }

        const effectiveConfidence = claim.confidence * playerTrust;
        if (effectiveConfidence < cfg.beliefConfidenceFloor) {
          ctx.effects.push({ type: 'belief_rejected', reason: 'insufficient trust', subject: claim.subject ?? undefined });
          sections.push(`${playerName} claims something about ${claim.subject ?? 'someone'}, but you have no reason to trust this stranger.`);
          continue;
        }

        npc.state.beliefs?.addBelief({
          id: crypto.randomUUID(),
          eventType: claim.eventType,
          subject: subjectAgent?.profile.name ?? claim.subject ?? null,
          object: objectAgent?.profile.name ?? claim.object ?? null,
          location: claim.location ?? null,
          confidence: effectiveConfidence,
          source: BELIEF_SOURCE.TESTIMONY,
          sourceNpcId: playerId,
          gameDay: ctx.gameDay,
          lastUpdated: ctx.gameDay,
        });

        ctx.effects.push({ type: 'belief_created', eventType: claim.eventType, subject: claim.subject ?? null, confidence: +effectiveConfidence.toFixed(2), trust: +playerTrust.toFixed(2) });
        console.log(`  [IL] Belief created in ${npc.profile.name}: ${claim.eventType} subject=${claim.subject} conf=${effectiveConfidence.toFixed(2)} (trust=${playerTrust.toFixed(2)})`);
        const eventLabel = getEventLabelSafe(claim.eventType);
        sections.push(`${playerName} claims: ${claim.subject ?? 'someone'} was involved in ${eventLabel.toLowerCase()}${claim.object ? ` against ${claim.object}` : ''}. You ${playerTrust >= cfg.trustThresholdForGoals ? 'find this somewhat credible' : 'are skeptical about this claim'}.`);
      } else if (claim.subject || claim.location) {
        const details = [claim.subject, claim.location, claim.timePeriod].filter(Boolean);
        sections.push(`${playerName} mentions: ${details.join(', ')}. Consider this in your response.`);
      }
    }
  }

  // 1b. Accusation evaluation — only for authority NPCs (investigator/canSentence)
  if (meaning.speechAct === 'accuse' && meaning.claims && meaning.claims.length > 0) {
    const isAuthority = npc.profile.investigator || npc.profile.canSentence;
    if (isAuthority && ctx.playerJournal) {
      const suspectClaim = meaning.claims.find((c) => c.subject);
      if (suspectClaim?.subject) {
        const suspectAgent = findAgentByName(suspectClaim.subject, ctx.agents);
        if (suspectAgent) {
          // Guards: can't accuse dead NPCs, yourself, or the authority you're talking to
          if (!suspectAgent.state.alive) {
            sections.push(`${suspectAgent.profile.name} is dead. This accusation makes no sense.`);
          } else if (suspectAgent.profile.isPlayer) {
            sections.push(`You cannot accuse yourself.`);
          } else if (suspectAgent.profile.id === npc.profile.id) {
            sections.push(`You are accusing ME? That is absurd. I am the law here.`);
            npc.state.relationships?.adjustSentiment(playerId, -0.2);
            npc.state.relationships?.adjustTrust(playerId, -0.15);
            ctx.effects.push({ type: 'relationship_change', field: 'sentiment', delta: -0.2 });
          } else {
          const playerTrust = npc.state.relationships?.getRelationship(playerId)?.trust ?? 0;
          const acc = buildAccusationContext(
            suspectAgent.profile.id, suspectClaim.eventType ?? '', npc,
            ctx.playerJournal, playerTrust, ctx.agents,
          );

          // Prompt injection with structured evidence assessment
          sections.push(buildAccusationPrompt(acc, npc));

          // Session-based repetition + multiple suspect tracking
          if (ctx.chatSession) {
            const session = ctx.chatSession;
            const suspId = suspectAgent.profile.id;
            const suspName = suspectAgent.profile.name;
            const currentHash = ctx.playerJournal.getEntriesForSuspect(suspId).length;
            const history = session.accusationHistory.get(suspId);

            if (history) {
              if (currentHash !== history.lastJournalHash) {
                // New evidence found — reset
                history.count = 1;
                history.lastJournalHash = currentHash;
              } else {
                // Same evidence, repeated accusation
                history.count++;
                if (history.count === 2) {
                  sections.push(`The player has already accused ${suspName} of this. They haven't presented new evidence.`);
                } else {
                  sections.push(`The player keeps repeating the same accusation against ${suspName} without new evidence. This is becoming tiresome and undermining their credibility.`);
                }
                const penalty = history.count === 2 ? -0.10 : -0.12;
                npc.state.relationships?.adjustTrust(playerId, penalty);
                ctx.effects.push({ type: 'relationship_change', field: 'trust', delta: penalty });
              }
            } else {
              session.accusationHistory.set(suspId, { count: 1, lastJournalHash: currentHash });
            }

            // Multiple suspect detection — unique suspects only
            const prevSuspects = session.formalAccusations.filter(a => a.suspectId !== suspId);
            if (prevSuspects.length > 0) {
              const prevNames = [...new Set(prevSuspects.map(a => a.suspectName))].join(', ');
              const uniqueCount = new Set(prevSuspects.map(a => a.suspectId)).size;
              if (uniqueCount === 1) {
                sections.push(`Note: this player previously formally accused ${prevNames}. Now they're accusing ${suspName}. Their investigative judgment may be questionable.`);
              } else {
                sections.push(`This player has now accused ${uniqueCount + 1} different people (${prevNames}, now ${suspName}). They seem to be guessing rather than investigating.`);
              }
              npc.state.relationships?.adjustTrust(playerId, -0.05);
              ctx.effects.push({ type: 'relationship_change', field: 'trust', delta: -0.05 });
            }
            if (!session.formalAccusations.some(a => a.suspectId === suspId)) {
              session.formalAccusations.push({ suspectId: suspId, suspectName: suspName, tick: ctx.gameDay });
            }
          }

          // Mechanical effects based on evidence quality
          if (acc.combinedQuality === 'strong' && (npc.profile.investigator || npc.profile.canSentence) && ctx.goalCreator) {
            const created = ctx.goalCreator(npc.profile.id, 'arrest', suspectAgent.profile.name);
            if (created) {
              ctx.effects.push({ type: 'goal_created', action: 'arrest', affordanceId: 'arrest', target: suspectAgent.profile.name });
            }
            npc.state.relationships?.adjustTrust(playerId, 0.05);
            ctx.effects.push({ type: 'relationship_change', field: 'trust', delta: 0.05 });
          } else if (acc.combinedQuality === 'moderate' && npc.profile.investigator && ctx.goalCreator) {
            const created = ctx.goalCreator(npc.profile.id, 'investigate', suspectAgent.profile.name);
            if (created) {
              ctx.effects.push({ type: 'goal_created', action: 'investigate', affordanceId: 'investigate', target: suspectAgent.profile.name });
            }
          } else if (acc.combinedQuality === 'weak') {
            npc.state.relationships?.adjustTrust(playerId, -0.03);
            ctx.effects.push({ type: 'relationship_change', field: 'trust', delta: -0.03 });
          } else if (acc.combinedQuality === 'insufficient') {
            npc.state.relationships?.adjustTrust(playerId, -0.08);
            ctx.effects.push({ type: 'relationship_change', field: 'trust', delta: -0.08 });
            ctx.effects.push({ type: 'goal_rejected', action: 'accuse', reason: 'insufficient_evidence' });
          }

          // Accused NPC reacts to accusation — hostile consequences (Trigger 3)
          suspectAgent.state.relationships?.adjustSentiment(playerId, -0.3);
          suspectAgent.state.relationships?.adjustTrust(playerId, -0.3);
          ctx.effects.push({ type: 'relationship_change', field: 'sentiment', delta: -0.3 });

          console.log(`  [IL] Accusation: ${suspectAgent.profile.name} — journal=${acc.journalEvidence.totalScore.toFixed(2)} npc=${acc.npcMaxConfidence.toFixed(2)} trust=${playerTrust.toFixed(2)} → combined=${acc.combinedScore.toFixed(2)} (${acc.combinedQuality}). Accused hostile: sent-0.3, trust-0.3`);
          } // end else (valid target — not dead/player/self)
        }
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
          // Use natural language summary — never expose raw event types or confidence numbers to LLM
          const beliefSummary = beliefs.slice(0, 3).map((b) => {
            const certainty = b.confidence > 0.8 ? 'are certain' : b.confidence > 0.5 ? 'believe' : 'have heard rumors';
            const verb = getEventLabelSafe(b.eventType, 'something');
            const who = b.subject ?? 'someone unknown';
            const target = b.object ? ` against ${b.object}` : '';
            return `you ${certainty} that ${who} committed ${verb}${target}`;
          }).filter(Boolean).join('; ');
          sections.push(`About ${aboutAgent.profile.name}: ${beliefSummary}. Answer from your knowledge.`);
        } else {
          sections.push(`You don't have any specific knowledge about ${aboutAgent.profile.name} related to ${q.topic ?? 'this topic'}.`);
        }
      }
      if (aboutAgent) {
        const rel = npc.state.relationships?.getRelationship(aboutAgent.profile.id);
        if (rel) {
          sections.push(`Your relationship with ${aboutAgent.profile.name}: ${rel.type}, sentiment ${rel.sentiment.toFixed(1)}.`);
        }
      }
    }
  }

  // 3. Emotional pressure → mood + relationship (via config multipliers × intensity)
  if (meaning.emotionalPressure) {
    const ep = meaning.emotionalPressure;
    const pe = cfg.pressureEffects[ep.type];
    if (pe) {
      const moodDelta = pe.mood * ep.intensity;
      const sentDelta = pe.sentiment * ep.intensity;
      const trustDelta = pe.trust * ep.intensity;

      if (moodDelta) {
        ctx.addMoodModifier?.(npc.profile.id, { source: `pressure_${ep.type}`, category: 'pressure',
          magnitude: moodDelta, remaining: 240, duration: 240, decay: 'exponential' });
        ctx.effects.push({ type: 'mood_change', delta: +moodDelta.toFixed(2), newMood: +npc.state.mood.toFixed(2) }); // newMood = current; actual change applies on next mood tick
      }
      if (sentDelta || trustDelta) {
        adjustBilateral(ctx.playerAgent, npc, sentDelta, trustDelta, cfg.bilateralFactor);
        if (sentDelta) ctx.effects.push({ type: 'relationship_change', field: 'sentiment', delta: +sentDelta.toFixed(2) });
        if (trustDelta) ctx.effects.push({ type: 'relationship_change', field: 'trust', delta: +trustDelta.toFixed(2) });
      }
    }

    // Event store + memory for threat/bribe (player actions with mechanical consequences)
    if (ep.type === 'threat') {
      const iv = cfg.importanceValues.threat ?? { base: 3, intensityMultiplier: 4 };
      const threatImp = Math.round(iv.base + ep.intensity * (iv.intensityMultiplier ?? 0));
      ctx.effects.push({ type: 'event_stored', eventType: PLAYER_ACTION_EVENT, action: 'threaten' });
      ctx.eventStore.append({
        id: crypto.randomUUID(), type: PLAYER_ACTION_EVENT,
        subject: playerId, object: npc.profile.id,
        location: npc.state.location, gameDay: ctx.gameDay,
        importance: threatImp,
        payload: { action: PLAYER_ACTIONS.THREATEN, intensity: ep.intensity },
      });
      const threatText = `${playerName} threatened me. ${ep.intensity > 0.5 ? 'It was frightening.' : 'It was unsettling.'}`;
      await npc.observe(threatText, threatImp);
      ctx.effects.push({ type: 'memory_stored', text: threatText, importance: threatImp });
      sections.push(`You feel ${ep.intensity > 0.7 ? 'genuinely afraid' : ep.intensity > 0.4 ? 'uneasy and defensive' : 'slightly annoyed by the posturing'}.`);
    } else if (ep.type === 'bribe') {
      const bribeImpEvent = cfg.importanceValues.bribe?.base ?? 5;
      ctx.effects.push({ type: 'event_stored', eventType: PLAYER_ACTION_EVENT, action: 'bribe' });
      ctx.eventStore.append({
        id: crypto.randomUUID(), type: PLAYER_ACTION_EVENT,
        subject: playerId, object: npc.profile.id,
        location: npc.state.location, gameDay: ctx.gameDay,
        importance: bribeImpEvent,
        payload: { action: PLAYER_ACTIONS.BRIBE, intensity: ep.intensity },
      });
      const bribeText = `${playerName} tried to bribe me.`;
      const bribeImp = cfg.importanceValues.bribe?.base ?? 5;
      await npc.observe(bribeText, bribeImp);
      ctx.effects.push({ type: 'memory_stored', text: bribeText, importance: bribeImp });
      sections.push(`${playerName} is offering you something in exchange for a favor. ${npc.profile.bigFive.honesty >= 0.6 ? 'This offends your sense of integrity.' : 'The offer is... tempting.'}`);
    } else if (ep.type === 'flattery') {
      sections.push(`${playerName} is being very complimentary. ${npc.profile.bigFive.agreeableness >= 0.6 ? 'You appreciate the kind words.' : 'You wonder what they want.'}`);
    } else if (ep.type === 'guilt') {
      sections.push(`${playerName}'s words hit close to home. You feel a pang of guilt.`);
    } else if (ep.type === 'intimidation') {
      sections.push(`You feel pressured by ${playerName}'s demeanor.`);
    }
  }

  // 4. Compliment / insult speech acts (without explicit emotionalPressure) — flat effects from config
  if (!meaning.emotionalPressure) {
    const sae = cfg.speechActEffects[meaning.speechAct];
    if (sae) {
      if (sae.mood) {
        ctx.addMoodModifier?.(npc.profile.id, { source: `speechact_${meaning.speechAct}`, category: 'pressure',
          magnitude: sae.mood, remaining: 120, duration: 120, decay: 'linear' });
        ctx.effects.push({ type: 'mood_change', delta: sae.mood, newMood: +npc.state.mood.toFixed(2) }); // newMood = current; actual change applies on next mood tick
      }
      if (sae.sentiment || sae.trust) {
        adjustBilateral(ctx.playerAgent, npc, sae.sentiment, sae.trust, cfg.bilateralFactor);
        if (sae.sentiment) ctx.effects.push({ type: 'relationship_change', field: 'sentiment', delta: sae.sentiment });
        if (sae.trust) ctx.effects.push({ type: 'relationship_change', field: 'trust', delta: sae.trust });
      }
      if (meaning.speechAct === 'compliment') {
        const t = `${playerName} said something kind to me.`;
        const imp = cfg.importanceValues.compliment?.base ?? 2;
        await npc.observe(t, imp);
        ctx.effects.push({ type: 'memory_stored', text: t, importance: imp });
      }
      if (meaning.speechAct === 'insult') {
        const t = `${playerName} insulted me.`;
        const imp = cfg.importanceValues.insult?.base ?? 3;
        await npc.observe(t, imp);
        ctx.effects.push({ type: 'memory_stored', text: t, importance: imp });
      }
    }
  }

  // 5. Requested action → resolve verb to affordance ID, create goal if trust sufficient
  if (meaning.requestedAction) {
    const ra = meaning.requestedAction;
    const reqRel = npc.state.relationships?.getRelationship(playerId);
    const playerTrust = reqRel?.trust ?? 0;

    if (playerTrust >= cfg.trustThresholdForGoals && ctx.goalCreator) {
      const affordanceIds = getAffordanceIdsForVerb(ra.action);
      const candidates = affordanceIds.length > 0 ? affordanceIds : [ra.action];

      let created = false;
      for (const affId of candidates) {
        if (ctx.goalCreator(npc.profile.id, affId, ra.target)) {
          created = true;
          ctx.effects.push({ type: 'goal_created', action: ra.action, affordanceId: affId, target: ra.target });
          sections.push(`${playerName} asked you to ${ra.action}${ra.target ? ` regarding ${ra.target}` : ''}. You trust them enough to act on this.`);
          console.log(`  [IL] Goal created for ${npc.profile.name}: ${affId}${ra.target ? ` → ${ra.target}` : ''} (verb: ${ra.action})`);
          break;
        }
      }
      if (!created) {
        ctx.effects.push({ type: 'goal_rejected', action: ra.action, reason: 'requirements not met' });
        sections.push(`${playerName} asked you to ${ra.action}${ra.target ? ` regarding ${ra.target}` : ''}, but you can't do that right now.`);
      }
    } else {
      ctx.effects.push({ type: 'goal_rejected', action: ra.action, reason: 'insufficient trust', trust: +playerTrust.toFixed(2) });
      const halfThreshold = cfg.trustThresholdForGoals * 0.75;
      sections.push(`${playerName} is asking you to ${ra.action}${ra.target ? ` regarding ${ra.target}` : ''}. ${playerTrust >= halfThreshold ? 'You barely know this person — why would you listen?' : 'You don\'t trust this person at all.'}`);
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

/**
 * Bilateral relationship adjustment via proper RelationshipGraph methods.
 * Uses adjustSentiment/adjustTrust which trigger onChange → WS broadcast.
 * Player side shifts by bilateralFactor (default 0.5 — player is the actor, NPC is the reactor).
 */
function adjustBilateral(player: Agent, npc: Agent, sentimentDelta: number, trustDelta: number, bilateralFactor = 0.5): void {
  npc.state.relationships?.adjustSentiment(player.profile.id, sentimentDelta);
  npc.state.relationships?.adjustTrust(player.profile.id, trustDelta);
  player.state.relationships?.adjustSentiment(npc.profile.id, sentimentDelta * bilateralFactor);
}
