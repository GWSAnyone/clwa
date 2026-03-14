import type { Agent } from './agent';
import type { Belief } from './beliefs';
import type { WorldEvent } from './cg-types';
import type { LocationGraph } from './world-types';
import type { TimePeriod } from './schedule';
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
  targetHasShop?: boolean;
  /** NPC must have a motive (profile.motive) */
  hasMotive?: boolean;
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
  /** Only apply if NPC has this role */
  role?: string;
  /** Only apply if NPC has a close relationship with the victim */
  requiresRelationToVictim?: boolean;
}

/**
 * Declarative step template for goal building.
 * Location fields: '$target' | '$home' | '$extra.KEY' | literal string.
 * TargetId fields: '$target' | literal string.
 * String fields (purpose, message, reason): interpolation with {varName:fallback}.
 * Variables: targetName, targetId, targetLocation, reason, killerName, victimName,
 *   crimeLocation, crimeType, relationship, relationshipDesc, + all target.extra keys.
 */
export interface StepTemplate {
  action: 'move_to' | 'interact' | 'interact_present' | 'announce' | 'wait' | 'steal_from' | 'attack_npc' | 'arrest_npc' | 'destroy_evidence' | 'flee' | 'examine_scene' | 'sentence_npc';
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
  category: 'crime' | 'social' | 'duty';
  severity: number;                // 1-10, for witness reactions
  requires: AffordanceRequirement;
  weights: AffordanceWeight[];
  /** How much negative mood contributes to score (0-1) */
  moodWeight: number;
  /** How much negative sentiment toward target contributes (0-1) */
  relationshipWeight: number;
  /** Base probability roll — prevents every-tick firing (proactive only) */
  baseProbability: number;
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
  currentTick: number;
  playerLocation?: string;
  hasActiveGoal: (id: string) => boolean;
  hasActiveGoalAbove: (id: string, minPriority: number) => boolean;
  /** Affordance cooldowns: npcId → affordanceId → expiresAtTick */
  cooldowns?: Map<string, Map<string, number>>;
  /** Decision cooldowns: npcId → expiresAtTick (limits LLM call frequency) */
  decisionCooldowns?: Map<string, number>;
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
export const REQUIREMENT_CHECKERS: Map<string, (agent: Agent, ctx: AffordanceContext) => boolean> = new Map();

// ─── Universal Role-Based Finder (proximity-aware, enriches with crime beliefs) ───

export function findByRole(role: string, npcId: string, agent: Agent, ctx: AffordanceContext): AffordanceTarget | null {
  type Candidate = { id: string; name: string; location: string; distance: number };
  const candidates: Candidate[] = [];

  for (const [otherId, other] of ctx.agents) {
    if (otherId === npcId || !other.state.alive) continue;
    if ((other.state.status ?? 'free') !== 'free') continue;
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
    (b: Belief) => (b.eventType === 'NPC_KILLED' || b.eventType === 'GOODS_STOLEN' || b.eventType === 'SELF_JUSTICE') &&
      b.confidence >= 0.3,
  );
  if (crimeBelief) {
    if (crimeBelief.subject) extra.killerName = crimeBelief.subject;
    if (crimeBelief.object) extra.victimName = crimeBelief.object;
    if (crimeBelief.location) extra.crimeLocation = crimeBelief.location;
    extra.crimeType = crimeBelief.eventType === 'NPC_KILLED' ? 'murder'
      : crimeBelief.eventType === 'GOODS_STOLEN' ? 'theft' : 'attack';
  }

  return { targetId: best.id, targetName: best.name, targetLocation: best.location, extra };
}

// ─── Requirement Checking ───

export function checkRequirements(
  aff: AffordanceDefinition,
  npcId: string,
  agent: Agent,
  ctx: AffordanceContext,
): AffordanceTarget | null {
  const req = aff.requires;

  if (req.notGuard && agent.profile.investigator) return null;
  if (req.isGuard && !agent.profile.investigator) return null; // deprecated: use isInvestigator
  if (req.isInvestigator && !agent.profile.investigator) return null;
  if (req.role && agent.profile.role !== req.role) return null;
  if (req.period && !req.period.includes(ctx.period)) return null;
  if (req.moodBelow !== undefined && agent.state.mood >= req.moodBelow) return null;
  if (aff.category === 'crime' && ctx.playerLocation === agent.state.location) return null;

  // Module-provided requirement checks
  if (req.isCriminal) {
    const checker = REQUIREMENT_CHECKERS.get('isCriminal');
    if (!checker || !checker(agent, ctx)) return null;
  }
  if (req.isWanted) {
    const checker = REQUIREMENT_CHECKERS.get('isWanted');
    if (!checker || !checker(agent, ctx)) return null;
  }
  if (req.hasDetainedNpc) {
    const checker = REQUIREMENT_CHECKERS.get('hasDetainedNpc');
    if (!checker || !checker(agent, ctx)) return null;
  }
  if (req.hasWitnessBelief) {
    const checker = REQUIREMENT_CHECKERS.get('hasWitnessBelief');
    if (!checker || !checker(agent, ctx)) return null;
  }

  const target = findTarget(aff, npcId, agent, ctx);
  if (!target) return null;

  if (req.noGuardNearby) {
    for (const [, other] of ctx.agents) {
      if (!other.state.alive) continue;
      if (other.profile.detersCrime && other.state.location === target.targetLocation) return null;
    }
  }

  if (req.maxWitnesses !== undefined) {
    let witnessCount = 0;
    for (const [otherId, other] of ctx.agents) {
      if (otherId === npcId || otherId === target.targetId) continue;
      if (!other.state.alive) continue;
      if (other.state.location === target.targetLocation) witnessCount++;
    }
    if (witnessCount > req.maxWitnesses) return null;
  }

  if (req.sentimentBelow !== undefined) {
    const rel = agent.state.relationships?.getRelationship(target.targetId);
    if (!rel || rel.sentiment >= req.sentimentBelow) return null;
  }

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
  if (req.isGuard && !agent.profile.investigator) return null; // deprecated: use isInvestigator
  if (req.isInvestigator && !agent.profile.investigator) return null;
  if (req.role && agent.profile.role !== req.role) return null;
  if (req.period && !req.period.includes(ctx.period)) return null;
  // mood intentionally skipped for reactive (event urgency overrides mood gate)
  if (aff.category === 'crime' && ctx.playerLocation === agent.state.location) return null;

  // Module-provided requirement checks
  if (req.isCriminal) {
    const checker = REQUIREMENT_CHECKERS.get('isCriminal');
    if (!checker || !checker(agent, ctx)) return null;
  }
  if (req.isWanted) {
    const checker = REQUIREMENT_CHECKERS.get('isWanted');
    if (!checker || !checker(agent, ctx)) return null;
  }
  if (req.hasDetainedNpc) {
    const checker = REQUIREMENT_CHECKERS.get('hasDetainedNpc');
    if (!checker || !checker(agent, ctx)) return null;
  }
  if (req.hasWitnessBelief) {
    const checker = REQUIREMENT_CHECKERS.get('hasWitnessBelief');
    if (!checker || !checker(agent, ctx)) return null;
  }

  const target = findReactiveTarget(aff, npcId, agent, ctx, event);
  if (!target) return null;

  if (req.noGuardNearby) {
    for (const [, other] of ctx.agents) {
      if (!other.state.alive) continue;
      if (other.profile.detersCrime && other.state.location === target.targetLocation) return null;
    }
  }
  if (req.maxWitnesses !== undefined) {
    let witnessCount = 0;
    for (const [otherId, other] of ctx.agents) {
      if (otherId === npcId || otherId === target.targetId) continue;
      if (!other.state.alive) continue;
      if (other.state.location === target.targetLocation) witnessCount++;
    }
    if (witnessCount > req.maxWitnesses) return null;
  }
  if (req.sentimentBelow !== undefined) {
    const rel = agent.state.relationships?.getRelationship(target.targetId);
    if (!rel || rel.sentiment >= req.sentimentBelow) return null;
  }

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

export function computeUtility(aff: AffordanceDefinition, agent: Agent, target: AffordanceTarget): number {
  let personalityScore = 0;
  for (const w of aff.weights) {
    const traitValue = agent.profile.bigFive[TRAIT_MAP[w.trait]];
    const effective = w.direction === 'high' ? traitValue : (1 - traitValue);
    personalityScore += w.multiplier * effective;
  }

  const moodContribution = aff.moodWeight * Math.max(0, -agent.state.mood);

  let relationshipContribution = 0;
  const rel = agent.state.relationships?.getRelationship(target.targetId);
  if (rel) {
    relationshipContribution = aff.relationshipWeight * Math.max(0, -rel.sentiment);
  }

  // Situational: beliefs boost score based on what NPC knows
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

  const rawScore = personalityScore + moodContribution + relationshipContribution + situationalContribution;
  return Math.max(0, Math.min(1, rawScore));
}
