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

// llmSemaphore более не используется — classify внутри façade сам управляет семафором
import type { Agent } from './agent';
import { hasCapability } from './agent-types';
import type { IEventStore } from './event-types';
import { getEventLabel, getEventLabelSafe, BELIEF_SOURCE, isTransferable, getAffordanceIdsForVerb, getRegisteredPressureTypes, getPressureHandler, getRegisteredSpeechActs, isValidSpeechAct, isBenignSpeechAct, isTradeSpeechAct, isAccusationSpeechAct, getRegisteredClaimSources, getILTradeVerbs, getRegisteredQuestionTopics, getDefaultSpeechAct, phraseBelief } from './event-registry';
import type { PressureHandlerContext } from './event-registry';
import type { ILConfig } from './world-types';
import { DEFAULT_IL_CONFIG } from './world-types';
import { classify } from './llm-client';
import type { LlmJsonSchema } from './llm-client';

// Question topics registered dynamically via registerQuestionTopics() — no hardcoded array.

/**
 * Build IL extraction schema dynamically with enum constraints from context.
 * Pattern: identical to getVolitionSchema() — constrained decoding forces valid output.
 * Not cached: ctx is per-call (NPC can die → knownEventTypes/locations change).
 */
// IL trade verbs registered dynamically via registerILTradeVerbs() — no hardcoded array

function buildILSchema(ctx: ILContext): LlmJsonSchema {
  // All enums sorted alphabetically — eliminates positional bias in constrained decoding (9B quirk)
  const speechActs = getRegisteredSpeechActs().sort();
  const claimSources = Array.from(getRegisteredClaimSources()).sort();
  const pressureTypes = Array.from(getRegisteredPressureTypes()).sort();
  const actionVerbs = [...new Set([...getILTradeVerbs(), ...ctx.availableActions])].sort();

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
          topic: { type: 'string', enum: getRegisteredQuestionTopics().sort() },
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

// ─── Dialogue Effect Handlers (modules fill) ───
// Generic hook: after the engine applies UNIVERSAL dialogue meaning (claims → beliefs, questions,
// pressure), it calls registered handlers for genre-specific effects. The crime-justice module
// registers evidence-presentation + formal-accusation here. The engine owns no investigation concept.
export type DialogueEffectHandlerFn = (meaning: DialogueMeaning, ctx: ILEffectContext) => string[];
const DIALOGUE_EFFECT_HANDLERS: DialogueEffectHandlerFn[] = [];
export function registerDialogueEffectHandler(handler: DialogueEffectHandlerFn): void {
  DIALOGUE_EFFECT_HANDLERS.push(handler);
}
export function getDialogueEffectHandlers(): readonly DialogueEffectHandlerFn[] {
  return DIALOGUE_EFFECT_HANDLERS;
}

// ─── IL Output Types ───

/** Speech act type — registered dynamically via registerSpeechActs(), not a union */
export type SpeechAct = string;  // casual conversation

export interface Claim {
  /** Event type from registry (e.g. NPC_KILLED, GOODS_STOLEN) — null if no specific event */
  eventType?: string;
  /** WHO did it / is involved (NPC name as extracted) */
  subject?: string;
  /** WHO was affected / victim (NPC name) */
  object?: string;
  /** WHERE (location name) */
  location?: string;
  /** How player knows this — registered dynamically via registerClaimSources() */
  source: string;
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
  /** Registry-backed pressure kind — the LLM schema enum comes from getRegisteredPressureTypes(),
   *  and getPressureHandler(type) dispatches the effect. Engine does not pin a closed set (INV-14). */
  type: string;
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
  /** Internal: reason for fallback extraction (empty_response, extraction_error) */
  _fallback?: string;
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
  /** NPC being talked to — display name (for prompt) */
  targetNpcName: string;
  /** NPC being talked to — agent id (для ClaudeCodeProvider per-NPC папки) */
  targetNpcId?: string;
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
    `1. speechAct: one of: ${getRegisteredSpeechActs().join(', ')}`,
    `   IMPORTANT: "trade" = player wants to buy, sell, browse goods, or ask about prices. Use speechAct "trade" + tradeIntent, NOT requestedAction.`,
    ``,
    `2. claims: array of factual claims the player is making (if any). Each claim:`,
    `   - eventType: event type if claiming something happened (use known event types, or null)`,
    `   - subject: WHO did it (must be a known NPC name, or null)`,
    `   - object: WHO was affected (NPC name, or null)`,
    `   - location: WHERE (must be a known location, or null)`,
    `   - source: how the player knows (${Array.from(getRegisteredClaimSources()).join(', ')})`,
    `   - confidence: 0-1 how certain the claim sounds`,
    ``,
    `3. questions: array of questions being asked (if any). Each:`,
    `   - about: who/what is being asked about (NPC name or topic)`,
    `   - topic: ${getRegisteredQuestionTopics().sort().join(', ')} (or null)`,
    ``,
    `4. requestedAction: if player is asking the NPC to DO a specific action (NOT buying/selling — that is trade):`,
    `   - action: use one of these verbs: ${[...getILTradeVerbs(), ...ctx.availableActions].join(', ')}`,
    `   - target: target NPC or location (or null)`,
    `   - urgency: 0-1`,
    ``,
    `5. emotionalPressure: if player is pressuring the NPC:`,
    `   - type: ${Array.from(getRegisteredPressureTypes()).join(', ')}`,
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

  // classify сам управляет семафором + retry + null-on-error.
  const schema = buildILSchema(ctx);
  const raw = await classify<Record<string, unknown>>('il', {
    system: 'You are a dialogue meaning extractor. Extract structured information from player speech.',
    user: prompt,
    schema: { name: schema.name ?? 'il_extraction', schema: schema.schema },
    agentContext: ctx.targetNpcId ? { id: ctx.targetNpcId } : undefined,
  });

  if (!raw) {
    console.warn(`  [IL] LLM returned null — falling back to ${getDefaultSpeechAct()}`);
    return { speechAct: getDefaultSpeechAct(), extractionConfidence: 0, _fallback: 'empty_response' };
  }

  try {
    console.log(`  [IL] Raw LLM output: ${JSON.stringify(raw)}`);
    return validateAndResolve(raw, ctx);
  } catch (err) {
    console.error(`  [IL] Validation failed:`, err);
    return { speechAct: getDefaultSpeechAct(), extractionConfidence: 0, _fallback: 'extraction_error' };
  }
}

// ─── Validation & Entity Resolution ───

// Speech acts, claim sources, pressure types — all registered dynamically via registries

function validateAndResolve(raw: Record<string, unknown>, ctx: ILContext): DialogueMeaning {
  if (!isValidSpeechAct(raw.speechAct as string)) {
    console.warn(`  [IL] Invalid speechAct '${raw.speechAct}' — falling back to '${getDefaultSpeechAct()}'`);
  }
  if (raw.extractionConfidence == null || isNaN(Number(raw.extractionConfidence))) {
    console.warn(`  [IL] Missing/invalid extractionConfidence '${raw.extractionConfidence}' — defaulting to 0.5`);
  }

  // Semantic correction: tradeIntent presence overrides speechAct to trade.
  // Root cause: constrained decoding forces requestedAction.action into affordance verbs,
  // so "show me your wares" → model picks 'steal' (nearest verb). With enums, we need
  // explicit signal priority: tradeIntent > requestedAction when both present.
  let speechAct: SpeechAct = isValidSpeechAct(raw.speechAct as string)
    ? raw.speechAct as string
    : getDefaultSpeechAct();
  // Detect trade intent from multiple signals — IL trade verbs registered dynamically.
  const tradeIntentObj = raw.tradeIntent && typeof raw.tradeIntent === 'object' ? raw.tradeIntent as Record<string, unknown> : null;
  const hasTradeContent = tradeIntentObj && (tradeIntentObj.category || tradeIntentObj.itemName);
  const raObj = raw.requestedAction && typeof raw.requestedAction === 'object' ? raw.requestedAction as Record<string, unknown> : null;
  const actionIsTrade = raObj && getILTradeVerbs().has(String(raObj.action));

  if ((hasTradeContent || actionIsTrade) && !isTradeSpeechAct(speechAct)) {
    console.warn(`  [IL] Trade signals detected (tradeIntent: ${!!hasTradeContent}, action: ${raObj?.action}) but speechAct='${speechAct}' — correcting to trade`);
    // Find the first registered trade speech act
    const tradeAct = getRegisteredSpeechActs().find(a => isTradeSpeechAct(a));
    if (tradeAct) speechAct = tradeAct;
  }

  // When trade detected, requestedAction and emotionalPressure are noise
  const isTradeCtx = isTradeSpeechAct(speechAct);
  if (isTradeCtx && raw.requestedAction) console.warn(`  [IL] Discarding requestedAction (trade context)`);
  if (isTradeCtx && raw.emotionalPressure) console.warn(`  [IL] Discarding emotionalPressure (trade context)`);

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
  if (!isTradeCtx && raw.requestedAction && typeof raw.requestedAction === 'object') {
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
  // Skip if trade (hallucinated). For benign speechActs, require high intensity (>0.5) —
  // 9B model hallucinates low-intensity threat/intimidation on innocent phrases.
  if (!isTradeCtx && raw.emotionalPressure && typeof raw.emotionalPressure === 'object') {
    const ep = raw.emotionalPressure as Record<string, unknown>;
    const epIntensity = clamp(Number(ep.intensity) || 0.5);
    if (getRegisteredPressureTypes().has(String(ep.type))) {
      if (isBenignSpeechAct(speechAct) && epIntensity <= 0.5) {
        console.warn(`  [IL] Discarding low-intensity pressure '${ep.type}' (${epIntensity}) on benign speechAct '${speechAct}' — likely hallucination`);
      } else {
        result.emotionalPressure = {
          type: String(ep.type),
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
  const rawSource = String(raw.source ?? '');
  if (rawSource && !getRegisteredClaimSources().has(rawSource)) {
    console.warn(`  [IL] Unknown claim source '${rawSource}' — keeping raw value`);
  }
  const source = rawSource;
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

// PresentedEvidence + ConversationSession moved to crime-justice/investigation.ts (A4b).
// ILEffectContext carries them as opaque module-supplied state (see fields below).

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
  /** Opaque module-supplied evidence entries attached to this message (crime: PresentedEvidence[]). */
  presentedEvidence?: unknown[];
  /** Opaque module-supplied player state (crime: PlayerJournal) — passed through to dialogue-effect handlers. */
  playerJournal?: unknown;
  /** Opaque module-supplied per-chat session state (crime: ConversationSession). */
  chatSession?: unknown;
  /** Add a mood modifier to an NPC (SPEC-mood-modifiers) */
  addMoodModifier?: (npcId: string, mod: { source: string; category: string; magnitude: number; remaining: number; duration: number; decay: 'exponential' | 'linear' | 'none' }) => void;
}

// processEvidencePresentation, AccusationContext, computeTrustBonus, buildAccusationContext and
// buildAccusationPrompt moved to crime-justice/investigation.ts (A4b). The engine now dispatches a
// generic registerDialogueEffectHandler hook (see applyDialogueMeaning) instead of owning this logic.

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
          subject: subjectAgent?.profile.id ?? claim.subject ?? null,
          object: objectAgent?.profile.id ?? claim.object ?? null,
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
        const details = [claim.subject, claim.location].filter(Boolean);
        sections.push(`${playerName} mentions: ${details.join(', ')}. Consider this in your response.`);
      }
    }
  }

  // 1b. Module dialogue effects — genre-specific reactions (crime: evidence-presentation + formal
  //     accusation) supplied via registerDialogueEffectHandler. The engine owns no investigation logic.
  for (const handler of getDialogueEffectHandlers()) {
    sections.push(...handler(meaning, ctx));
  }

  // 2. Questions → gather NPC beliefs for response context
  if (meaning.questions && meaning.questions.length > 0) {
    for (const q of meaning.questions) {
      const aboutAgent = findAgentByName(q.about, ctx.agents);
      if (aboutAgent && npc.state.beliefs) {
        const beliefs = npc.state.beliefs.getAllBeliefs()
          .filter((b) => b.subject === aboutAgent.profile.id || b.object === aboutAgent.profile.id);
        if (beliefs.length > 0) {
          // Use natural language summary — never expose raw event types or confidence numbers to LLM
          const resolve = npc.nameResolver;
          const beliefSummary = beliefs.slice(0, 3).map((b) => {
            const certainty = b.confidence > 0.8 ? 'are certain' : b.confidence > 0.5 ? 'believe' : 'have heard rumors';
            const verb = getEventLabelSafe(b.eventType, 'something');
            const who = b.subject ? resolve(b.subject) : 'someone unknown';
            const relation = phraseBelief({ eventType: b.eventType, source: b.source, confidence: b.confidence, verb, who, target: b.object ? resolve(b.object) : null });
            return `you ${certainty} that ${relation}`;
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

    // Module-specific side effects (event storage, memory, prompt sections) via registry
    const pressureHandler = getPressureHandler(ep.type);
    if (pressureHandler) {
      const handlerCtx: PressureHandlerContext = {
        intensity: ep.intensity, npcId: npc.profile.id, npcName: npc.profile.name,
        npcLocation: npc.state.location, npcHonesty: npc.profile.bigFive.honesty,
        npcAgreeableness: npc.profile.bigFive.agreeableness,
        playerId, playerName, gameDay: ctx.gameDay,
        observe: (text, imp) => npc.observe(text, imp),
        storeEvent: (event) => ctx.eventStore.append(event),
        pushEffect: (effect) => ctx.effects.push(effect),
        importanceValues: cfg.importanceValues,
      };
      const handlerSections = await pressureHandler(handlerCtx);
      sections.push(...handlerSections);
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
      if (sae.memoryText) {
        const t = sae.memoryText.replace('$player', playerName);
        const imp = sae.memoryImportance ?? 2;
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
  // Exact match first
  for (const agent of agents.values()) {
    if (agent.profile.name.toLowerCase() === lower) return agent;
  }
  // Partial match — collect all candidates, prefer shortest name (most specific)
  let best: Agent | undefined;
  let bestLen = Infinity;
  for (const agent of agents.values()) {
    const aName = agent.profile.name.toLowerCase();
    if (aName.includes(lower) || lower.includes(aName)) {
      if (agent.profile.name.length < bestLen) {
        best = agent;
        bestLen = agent.profile.name.length;
      }
    }
  }
  return best;
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
  player.state.relationships?.adjustTrust(npc.profile.id, trustDelta * bilateralFactor);
}
