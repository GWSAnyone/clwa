import type { Agent } from './agent';
import type { Belief } from './beliefs';
import type { WorldEvent } from './cg-types';
import type { LocationGraph } from './world-types';
import type { TimePeriod } from './schedule';
import { getEventLabelSafe, isTransferable } from './event-registry';
import type { NpcFilter } from './goals';

// ─── Affordance Data Model ───

export interface AffordanceRequirement {
  /** Allowed time periods (undefined = any time) */
  period?: TimePeriod[];
  /** No guard NPC at the target's location */
  noGuardNearby?: boolean;
  /** Maximum number of other NPCs at location (undefined = no limit) */
  maxWitnesses?: number;
  /** Target must have a shop */
  /** NPC must have a crime belief about someone (confidence >= threshold) */
  hasCrimeBelief?: boolean;
  /** Minimum confidence for crime belief */
  beliefConfidence?: number;
  /** NPC mood must be below this threshold */
  moodBelow?: number;
  /** NPC sentiment toward target must be below this */
  sentimentBelow?: number;
  /** NPC must NOT be a guard */
  notGuard?: boolean;
  /** NPC must be a guard */
  isGuard?: boolean;
  /** NPC must have investigator flag */
  isInvestigator?: boolean;
  /** NPC must have this role */
  role?: string;
  /** NPC must be the criminal (subject of NPC_KILLED/GOODS_STOLEN event matching their name) */
  isCriminal?: boolean;
  /** NPC must be wanted (WANTED_STATUS event exists for them) */
  isWanted?: boolean;
  /** A detained NPC must exist somewhere */
  hasDetainedNpc?: boolean;
  /** NPC must have a witness belief that someone else doesn't know about */
  hasWitnessBelief?: boolean;
  /** NPC must NOT be a perpetrator of any crime (has no guilt-source beliefs) */
  notPerpetrator?: boolean;
  /** NPC must have canSentence capability (judges, magistrates) */
  canSentence?: boolean;
  /** NPC must have suspicion belief (for surveillance) */
  hasSuspicionBelief?: boolean;
  /** NPC deduction confidence must be below threshold (for investigate vs arrest) */
  deductionBelowThreshold?: boolean;
}

export type OceanHTrait = 'O' | 'C' | 'E' | 'A' | 'N' | 'H';

export interface AffordanceWeight {
  trait: OceanHTrait;
  /** 'high' = use trait value directly, 'low' = use (1 - trait) */
  direction: 'high' | 'low';
  /** Multiplier for this personality factor */
  multiplier: number;
}

/** Reactive event boost — applied when a CE event matches */
export interface EventBoost {
  /** Which event types trigger this boost */
  eventTypes: string[];
  /** Score bonus added (typically 0.3-0.5, pushes past auto threshold) */
  boost: number;
  /** Only apply if NPC has a close relationship with the victim */
  requiresRelationToVictim?: boolean;
}

/**
 * Declarative step template for goal building.
 * Location fields: '$target' | '$home' | '$extra.KEY' | literal string.
 * TargetId fields: '$target' | literal string.
 * String fields (purpose, message, reason): interpolation with {varName:fallback}.
 * Variables: targetName, targetId, targetLocation, reason, suspectName, victimName,
 *   crimeLocation, crimeType, relationship, relationshipDesc, + all target.extra keys.
 */
export interface StepTemplate {
  action: string;
  /** Location reference: '$target', '$home', '$extra.KEY', or literal */
  location?: string;
  /** Target NPC: '$target' or literal id */
  targetId?: string;
  /** Purpose template with {var:fallback} interpolation */
  purpose?: string;
  /** Announce message template with {var:fallback} interpolation */
  message?: string;
  importance?: number;
  ticks?: number;
  /** Attack reason template */
  reason?: string;
  lethal?: boolean;
  filter?: NpcFilter;
  /** Only add this step if NPC is NOT already at the resolved location */
  skipIfAt?: boolean;
  /** After interaction, transfer relevant crime beliefs between participants */
  beliefTransfer?: boolean;
  /** Direction of belief transfer: 'target-to-owner' (default) or 'owner-to-target' (for testify) */
  beliefTransferDirection?: 'target-to-owner' | 'owner-to-target';
  /** After interaction, evaluate if target is a suspect and update confidence based on guilt + H trait */
  evaluateSuspect?: boolean;
}

export interface BeliefModifier {
  /** Match beliefs by eventType (e.g. 'NPC_KILLED', 'GOODS_STOLEN') */
  eventType: string;
  /** Weight multiplied by max matching belief's confidence (0-1) */
  weight: number;
}

export interface AffordanceDefinition {
  id: string;
  label: string;
  category: string;
  severity: number;                // 1-10, for witness reactions
  requires: AffordanceRequirement;
  weights: AffordanceWeight[];
  /** How much negative mood contributes to score (0-1) */
  moodWeight: number;
  /** How much negative sentiment toward target contributes (0-1) */
  relationshipWeight: number;
  /** Base probability roll — prevents every-tick firing (proactive only) */
  /** Goal type string for NpcGoal */
  goalType: string;
  /** Goal priority for NpcGoal */
  goalPriority: number;
  /** Reactive: boost when these events affect the NPC */
  eventBoost?: EventBoost;
  /** Declarative step templates — replaces switch/case in buildSteps */
  stepTemplates?: StepTemplate[];
  /** Target finder key — defaults to affordance id. Allows reuse of finders across affordances */
  targetFinder?: string;
  /** Generic role-based target finding: find nearest NPC with this role (replaces custom finders for simple role lookups) */
  targetRole?: string;
  /** Situational modifiers: NPC's beliefs boost affordance score */
  beliefModifiers?: BeliefModifier[];
  /** If true, this affordance is suppressed when player is at the same location */
  suppressNearPlayer?: boolean;
  /** If true, this is a duty action — blocks 'talk' in urge tier */
  isDuty?: boolean;
  /** Verb for LLM DO/WHY prompt (e.g. 'steal'). Defaults to id */
  actionVerb?: string;
  /** Description for LLM action list (e.g. 'steal from their shop') */
  actionDescription?: string;
  /** If affordance passes requirements, score is at least this value.
   *  Use to ensure critical affordances reach reflex tier (≥0.7) when conditions are met. */
  minimumScore?: number;
  /** Per-affordance cooldown override in game minutes. If set, overrides global affordanceCooldownMinutes. */
  cooldownOverride?: number;
  /** Personality traits that resist this action — drives internal conflict in instinct description.
   *  direction 'high' = high trait resists (e.g. honesty:high resists steal). */
  resistTraits?: Array<{ trait: 'openness' | 'conscientiousness' | 'extraversion' | 'agreeableness' | 'neuroticism' | 'honesty'; direction: 'high' | 'low' }>;
  /** Trust contribution to scoring. Negative = trust inhibits (crime: -0.1). Positive = trust boosts (duty: 0.05). */
  trustWeight?: number;
  /** Situational context template for instinct description. Interpolated with target.extra vars.
   *  Grounds abstract emotional instinct in concrete situation. E.g. "You know that {targetName} {secretDetail:has a secret}." */
  instinctContext?: string;
  /** If true, this affordance is social-only (e.g. socialize). Engine uses this flag
   *  instead of checking affordance IDs — keeps engine module-agnostic. */
  socialOnly?: boolean;
}

// ─── Mutable Registries (populated by modules at startup) ───

/** Affordance registry — modules push their definitions here */
export const AFFORDANCE_REGISTRY: AffordanceDefinition[] = [];

// ─── Evaluation Context ───

export interface AffordanceContext {
  agents: Map<string, Agent>;
  locations: LocationGraph;
  npcHomes: Map<string, string>;
  period: TimePeriod;
  gameDay: number;
  /** Current absolute game minute (grows indefinitely, minuteOfDay = gameMinute % 1440) */
  gameMinute: number;
  playerLocation?: string;
  hasActiveGoal: (id: string) => boolean;
  hasActiveGoalAbove: (id: string, minPriority: number) => boolean;
  /** Affordance cooldowns: npcId → affordanceId → expiresAtMinute */
  cooldowns?: Map<string, Map<string, number>>;
  /** Decision cooldowns: npcId → expiresAtMinute (limits LLM call frequency) */
  decisionCooldowns?: Map<string, number>;
  /** Configurable cooldown values (from WorldConfig, in game minutes) */
  affordanceCooldownMinutes?: number;
  decisionCooldownMinutes?: number;
  /** Check if NPC is target of someone else's arrest/pursuit goal */
  isArrestTarget?: (npcId: string) => boolean;
  /** Check if conversation pair is on cooldown (scheduler-managed) */
  isPairOnCooldown?: (a: string, b: string) => boolean;
}

/** Target found for an affordance */
export interface AffordanceTarget {
  targetId: string;
  targetName: string;
  targetLocation: string;
  /** Extra context for goal building */
  extra?: Record<string, unknown>;
}

/** Scored affordance ready for decision */
export interface ScoredAffordance {
  definition: AffordanceDefinition;
  score: number;
  target: AffordanceTarget;
}

// ─── Target Finder Registries (populated by modules) ───

export type TargetFinderFn = (npcId: string, agent: Agent, ctx: AffordanceContext, aff: AffordanceDefinition) => AffordanceTarget | null;
export type ReactiveTargetFinderFn = (npcId: string, agent: Agent, ctx: AffordanceContext, event: WorldEvent, aff: AffordanceDefinition) => AffordanceTarget | null;

/** Proactive target finders — keyed by affordance id or targetFinder override */
export const TARGET_FINDERS: Map<string, TargetFinderFn> = new Map();

/** Reactive target finders — keyed by affordance id or targetFinder override */
export const REACTIVE_TARGET_FINDERS: Map<string, ReactiveTargetFinderFn> = new Map();

// ─── Requirement Checker Hooks (populated by modules) ───

/** Module-provided requirement checkers. Key = requirement field name */
export const REQUIREMENT_CHECKERS: Map<string, (agent: Agent, ctx: AffordanceContext, params?: Record<string, unknown>) => boolean> = new Map();

// ─── Blocking Goal Types (populated by modules) ───

/** Goal types that prevent volition re-evaluation of the target NPC */
const BLOCKING_GOAL_TYPES: Set<string> = new Set();

export function registerBlockingGoalTypes(types: string[]): void {
  for (const t of types) BLOCKING_GOAL_TYPES.add(t);
}

export function getBlockingGoalTypes(): ReadonlySet<string> {
  return BLOCKING_GOAL_TYPES;
}

// ─── Universal Role-Based Finder (proximity-aware, enriches with crime beliefs) ───

export function findByRole(role: string, npcId: string, agent: Agent, ctx: AffordanceContext): AffordanceTarget | null {
  type Candidate = { id: string; name: string; location: string; distance: number };
  const candidates: Candidate[] = [];

  for (const [otherId, other] of ctx.agents) {
    if (otherId === npcId || !other.state.alive) continue;
    if (other.state.status) continue; // any non-default status blocks targeting
    if (other.profile.role === role) {
      let distance: number;
      if (other.state.location === agent.state.location) {
        distance = 0;
      } else {
        const loc = ctx.locations.get(agent.state.location);
        distance = loc?.connections.includes(other.state.location) ? 1 : 2;
      }
      candidates.push({ id: otherId, name: other.profile.name, location: other.state.location, distance });
    }
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.distance - b.distance);
  const best = candidates[0];

  // Enrich with crime details from NPC's own beliefs (universal — harmless if no beliefs)
  const extra: Record<string, string> = {};
  const beliefs = agent.state.beliefs?.getAllBeliefs() ?? [];
  const crimeBelief = beliefs.find(
    (b: Belief) => isTransferable(b.eventType) && b.confidence >= 0.3,
  );
  if (crimeBelief) {
    if (crimeBelief.subject) { extra.suspectName = crimeBelief.subject; }
    if (crimeBelief.object) extra.victimName = crimeBelief.object;
    if (crimeBelief.location) extra.crimeLocation = crimeBelief.location;
    extra.crimeType = getEventLabelSafe(crimeBelief.eventType);
  }

  return { targetId: best.id, targetName: best.name, targetLocation: best.location, extra };
}

// ─── Requirement Checking ───

/** Generic iteration over all REQUIREMENT_CHECKERS registry entries */
function checkRegistryRequirements(req: AffordanceRequirement, agent: Agent, ctx: AffordanceContext): boolean {
  const reqRecord = req as Record<string, unknown>;
  for (const [key, checker] of REQUIREMENT_CHECKERS) {
    if (!reqRecord[key]) continue;
    // Pass affordance-level params (e.g. beliefConfidence for hasCrimeBelief)
    const params: Record<string, unknown> = {};
    if (req.beliefConfidence !== undefined) params.minConfidence = req.beliefConfidence;
    if (!checker(agent, ctx, params)) return false;
  }
  return true;
}

/** Post-target checks: noGuardNearby, maxWitnesses, sentimentBelow */
function checkPostTargetRequirements(req: AffordanceRequirement, npcId: string, target: AffordanceTarget, ctx: AffordanceContext): boolean {
  if (req.noGuardNearby) {
    for (const [, other] of ctx.agents) {
      if (!other.state.alive) continue;
      if (other.profile.detersCrime && other.state.location === target.targetLocation) return false;
    }
  }
  if (req.maxWitnesses !== undefined) {
    let witnessCount = 0;
    for (const [otherId, other] of ctx.agents) {
      if (otherId === npcId || otherId === target.targetId) continue;
      if (!other.state.alive) continue;
      if (other.state.location === target.targetLocation) witnessCount++;
    }
    if (witnessCount > req.maxWitnesses) return false;
  }
  if (req.sentimentBelow !== undefined) {
    const rel = ctx.agents.get(npcId)?.state.relationships?.getRelationship(target.targetId);
    if (!rel || rel.sentiment >= req.sentimentBelow) return false;
  }
  return true;
}

export function checkRequirements(
  aff: AffordanceDefinition,
  npcId: string,
  agent: Agent,
  ctx: AffordanceContext,
): AffordanceTarget | null {
  const req = aff.requires;

  if (req.notGuard && agent.profile.investigator) return null;
  if (req.isGuard && !agent.profile.investigator) return null;
  if (req.isInvestigator && !agent.profile.investigator) return null;
  if (req.canSentence && !agent.profile.canSentence) return null;
  if (req.role && agent.profile.role !== req.role) return null;
  if (req.period && !req.period.includes(ctx.period)) return null;
  if (req.moodBelow !== undefined && agent.state.mood >= req.moodBelow) return null;
  if (aff.suppressNearPlayer && ctx.playerLocation === agent.state.location) return null;

  // Module-provided requirement checks — generic iteration over registry
  if (!checkRegistryRequirements(req, agent, ctx)) return null;

  const target = findTarget(aff, npcId, agent, ctx);
  if (!target) return null;

  if (!checkPostTargetRequirements(req, npcId, target, ctx)) return null;

  return target;
}

/**
 * Relaxed requirement check for reactive evaluation.
 * Skips mood threshold (event urgency overrides mood gate).
 * All other requirements are enforced.
 */
export function checkRequirementsReactive(
  aff: AffordanceDefinition,
  npcId: string,
  agent: Agent,
  ctx: AffordanceContext,
  event: WorldEvent,
): AffordanceTarget | null {
  const req = aff.requires;

  if (req.notGuard && agent.profile.investigator) return null;
  if (req.isGuard && !agent.profile.investigator) return null;
  if (req.isInvestigator && !agent.profile.investigator) return null;
  if (req.canSentence && !agent.profile.canSentence) return null;
  if (req.role && agent.profile.role !== req.role) return null;
  if (req.period && !req.period.includes(ctx.period)) return null;
  // mood intentionally skipped for reactive (event urgency overrides mood gate)
  if (aff.suppressNearPlayer && ctx.playerLocation === agent.state.location) return null;

  // Module-provided requirement checks — generic iteration over registry
  if (!checkRegistryRequirements(req, agent, ctx)) return null;

  const target = findReactiveTarget(aff, npcId, agent, ctx, event);
  if (!target) return null;

  if (!checkPostTargetRequirements(req, npcId, target, ctx)) return null;

  return target;
}

// ─── Target Finding (Proactive) ───

function findTarget(
  aff: AffordanceDefinition,
  npcId: string,
  agent: Agent,
  ctx: AffordanceContext,
): AffordanceTarget | null {
  // Generic role-based finder takes priority (declarative, no custom code needed)
  if (aff.targetRole) return findByRole(aff.targetRole, npcId, agent, ctx);
  const key = aff.targetFinder ?? aff.id;
  const finder = TARGET_FINDERS.get(key);
  return finder ? finder(npcId, agent, ctx, aff) : null;
}

// ─── Target Finding (Reactive — uses event data) ───

function findReactiveTarget(
  aff: AffordanceDefinition,
  npcId: string,
  agent: Agent,
  ctx: AffordanceContext,
  event: WorldEvent,
): AffordanceTarget | null {
  // Check reactive registry first (registered by affordance id, not targetFinder)
  const finder = REACTIVE_TARGET_FINDERS.get(aff.id);
  if (finder) return finder(npcId, agent, ctx, event, aff);
  // Fallback to generic role-based finder
  if (aff.targetRole) return findByRole(aff.targetRole, npcId, agent, ctx);
  return null;
}

// ─── Utility Scoring ───

const TRAIT_MAP: Record<OceanHTrait, keyof Agent['profile']['bigFive']> = {
  O: 'openness', C: 'conscientiousness', E: 'extraversion',
  A: 'agreeableness', N: 'neuroticism', H: 'honesty',
};

/**
 * Non-linear mood curve — 3 psychological zones:
 * - Sliding (-0.3 to -0.6): most volatile, ×1.5 multiplier (desperation onset)
 * - Desperation (-0.6 to -0.8): sustained high contribution, ×1.0
 * - Numbness (-0.8 to -1.0): reduced effect ×0.6 (apathy, not action)
 * - Positive mood: returns negative value (inhibits crime, enables social)
 */
function moodCurve(mood: number, H: number = 0.5): number {
  if (mood >= 0) return -mood * 0.3; // positive mood → negative score (inhibits)

  // Personality-shifted zones (SPEC-mood-modifiers):
  // Low H → enters sliding zone earlier (more crime-prone)
  const slidingEntry = 0.30 - (1 - H) * 0.20; // H=0.2: 0.14, H=0.5: 0.20, H=0.9: 0.28
  const desperationEntry = slidingEntry + 0.30;
  const numbnessEntry = slidingEntry + 0.50;

  const absMood = -mood; // 0 to 1
  if (absMood <= slidingEntry) return absMood * (0.15 / slidingEntry); // continuous at boundary: slidingEntry * 0.15/slidingEntry = 0.15
  if (absMood <= desperationEntry) return 0.15 + (absMood - slidingEntry) * 1.5; // sliding zone — ×1.5
  if (absMood <= numbnessEntry) return 0.60 + (absMood - desperationEntry) * 1.0; // desperation
  return 0.80 + (absMood - numbnessEntry) * 0.6; // numbness plateau
}

/**
 * Non-linear sentiment curve — mirrors mood zones:
 * - Mild irritation (0 to -0.3): ×0.5
 * - Active hostility (-0.3 to -0.6): ×1.5
 * - Dehumanization (-0.6 to -1.0): ×0.8 (already decided, less incremental)
 * - Positive sentiment: returns negative value (inhibits harm, enables cooperation)
 */
function sentimentCurve(sentiment: number): number {
  if (sentiment >= 0) return -sentiment * 0.3; // positive → inhibits harm
  const absSent = -sentiment;
  if (absSent <= 0.3) return absSent * 0.5;
  if (absSent <= 0.6) return 0.15 + (absSent - 0.3) * 1.5;
  return 0.60 + (absSent - 0.6) * 0.8;
}

export function computeUtility(aff: AffordanceDefinition, agent: Agent, target: AffordanceTarget): number {
  // 1. Personality (OCEAN+H weights)
  let personalityScore = 0;
  for (const w of aff.weights) {
    const traitValue = agent.profile.bigFive[TRAIT_MAP[w.trait]];
    const effective = w.direction === 'high' ? traitValue : (1 - traitValue);
    personalityScore += w.multiplier * effective;
  }

  // 2. Mood (non-linear, bidirectional)
  const moodContribution = aff.moodWeight * moodCurve(agent.state.mood, agent.profile.bigFive.honesty);

  // 3. Relationship (non-linear, bidirectional)
  let relationshipContribution = 0;
  const rel = agent.state.relationships?.getRelationship(target.targetId);
  if (rel) {
    relationshipContribution = aff.relationshipWeight * sentimentCurve(rel.sentiment);
  }

  // 4. Situational: beliefs boost score based on what NPC knows
  let situationalContribution = 0;
  if (aff.beliefModifiers && agent.state.beliefs) {
    const beliefs = agent.state.beliefs.getAllBeliefs();
    for (const mod of aff.beliefModifiers) {
      let maxConfidence = 0;
      for (const b of beliefs) {
        if (b.eventType === mod.eventType && b.confidence > maxConfidence) {
          maxConfidence = b.confidence;
        }
      }
      situationalContribution += mod.weight * maxConfidence;
    }
  }

  // 5. Trust (direction from affordance data: negative = inhibits, positive = boosts)
  const trustContribution = (rel && aff.trustWeight) ? aff.trustWeight * rel.trust : 0;

  const rawScore = personalityScore + moodContribution + relationshipContribution + situationalContribution + trustContribution;
  const clamped = Math.max(0, Math.min(1, rawScore));
  return aff.minimumScore ? Math.max(clamped, aff.minimumScore) : clamped;
}

// ─── Player Action Validation ───

export interface ValidationResult {
  allowed: boolean;
  /** Human-readable reason if not allowed */
  reason?: string;
  /** The matched affordance definition */
  affordance?: AffordanceDefinition;
  /** Resolved target */
  target?: AffordanceTarget;
}

/**
 * Validate whether a player can perform an action.
 * Checks affordance requirements without personality/LLM scoring.
 * AL for Player = validator (can you do this?), not generator (what should you do?).
 */
export function validatePlayerAction(
  actionId: string,
  playerId: string,
  playerAgent: Agent,
  ctx: AffordanceContext,
  targetId?: string,
): ValidationResult {
  const aff = AFFORDANCE_REGISTRY.find((a) => a.id === actionId);
  if (!aff) {
    return { allowed: false, reason: `Unknown action: ${actionId}` };
  }

  // Check basic requirements (skip personality-based ones like mood/sentiment)
  const req = aff.requires;
  if (req.period && !req.period.includes(ctx.period)) {
    return { allowed: false, reason: `Cannot ${actionId} during ${ctx.period}`, affordance: aff };
  }
  if (req.isInvestigator && !playerAgent.profile.investigator) {
    return { allowed: false, reason: `Only investigators can ${actionId}`, affordance: aff };
  }
  if (req.canSentence && !playerAgent.profile.canSentence) {
    return { allowed: false, reason: `Only judges can ${actionId}`, affordance: aff };
  }

  // Module requirement checks
  for (const [key, checker] of REQUIREMENT_CHECKERS) {
    if ((req as Record<string, unknown>)[key] && !checker(playerAgent, ctx)) {
      return { allowed: false, reason: `Requirement not met: ${key}`, affordance: aff };
    }
  }

  // If specific target provided, validate co-location
  if (targetId) {
    const target = ctx.agents.get(targetId);
    if (!target) {
      return { allowed: false, reason: `Target not found: ${targetId}`, affordance: aff };
    }
    if (!target.state.alive) {
      return { allowed: false, reason: `${target.profile.name} is dead`, affordance: aff };
    }
    if (playerAgent.state.location !== target.state.location) {
      return { allowed: false, reason: `${target.profile.name} is not here`, affordance: aff };
    }
    return {
      allowed: true,
      affordance: aff,
      target: {
        targetId,
        targetName: target.profile.name,
        targetLocation: target.state.location,
      },
    };
  }

  return { allowed: true, affordance: aff };
}
