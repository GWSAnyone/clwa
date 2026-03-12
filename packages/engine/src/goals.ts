import type { Agent } from './agent';
import type { WorldEvent } from './cg-types';
import type { LocationGraph, MovementResult, CrimeScene } from './world-types';
import { nextHop } from './pathfinding';

// ─── Interrogation Outcome Constants ───

/** H trait threshold: above = honest (poor liar), below = deceptive */
const HONESTY_THRESHOLD = 0.6;
/** Confidence set when honest guilty suspect is interrogated (quasi-confession) */
const CONFESSION_CONFIDENCE = 0.85;
/** Confidence boost when deceptive guilty suspect is interrogated (nervous tells) */
const NERVOUS_BOOST = 0.15;
/** Confidence drop when innocent suspect provides alibi */
const ALIBI_DROP = 0.2;

// ─── Step Primitives ───

/** Move one hop per tick toward target location via pathfinding */
export interface MoveStep {
  action: 'move_to';
  location: string; // target location name
}

/**
 * Interact with a specific NPC for a specific purpose.
 * The purpose string shapes the LLM prompt — fully flexible.
 */
export interface InteractStep {
  action: 'interact';
  targetId: string;        // specific NPC id
  purpose: string;         // e.g. "interrogate about the murder", "trade goods"
  importance: number;      // memory importance for both participants
  /** After interaction, transfer relevant crime beliefs between participants */
  beliefTransfer?: boolean;
  /** Direction of belief transfer: 'target-to-owner' (default, for interrogate) or 'owner-to-target' (for testify) */
  beliefTransferDirection?: 'target-to-owner' | 'owner-to-target';
  /** After interaction, evaluate if target is a suspect (deduction belief match) and update confidence based on guilt + H trait */
  evaluateSuspect?: boolean;
}

/**
 * Interact with ALL matching NPCs at current location, one per tick.
 * Tracks who's been interacted with via goal.data._interacted.
 */
export interface InteractPresentStep {
  action: 'interact_present';
  purpose: string;         // LLM prompt purpose
  importance: number;
  filter?: NpcFilter;      // who to interact with
}

/** Share information with all NPCs at current location (no LLM) */
export interface AnnounceStep {
  action: 'announce';
  message: string;
  importance: number;
}

/** Wait for N ticks before proceeding */
export interface WaitStep {
  action: 'wait';
  ticks: number;
}

/** Steal from a shop NPC at current location (no LLM) */
export interface StealFromStep {
  action: 'steal_from';
  targetId: string;        // shop owner NPC id
  importance: number;
}

/** Attack an NPC at current location — non-lethal vigilante strike (no LLM) */
export interface AttackNpcStep {
  action: 'attack_npc';
  targetId: string;
  importance: number;
  reason: string;          // e.g. "revenge for murder of Hilda"
  lethal?: boolean;        // if true, this is a murder (target dies)
}

/** Arrest an NPC — changes their status to 'detained' */
export interface ArrestNpcStep {
  action: 'arrest_npc';
  targetId: string;
  importance: number;
}

/** Destroy evidence at current crime scene location */
export interface DestroyEvidenceStep {
  action: 'destroy_evidence';
  importance: number;
}

/** Flee the town — NPC status becomes 'fled', removed from world */
export interface FleeStep {
  action: 'flee';
  importance: number;
}

/** Guard examines crime scene — synthesizes suspicion beliefs from structured data */
export interface ExamineSceneStep {
  action: 'examine_scene';
  importance: number;
}

/** Judge evaluates detained NPC — LLM decides sentence */
export interface SentenceNpcStep {
  action: 'sentence_npc';
  targetId: string;
  importance: number;
}

export type GoalStep = MoveStep | InteractStep | InteractPresentStep | AnnounceStep | WaitStep | StealFromStep | AttackNpcStep | ArrestNpcStep | DestroyEvidenceStep | FleeStep | ExamineSceneStep | SentenceNpcStep;

// ─── NPC Filter ───

export interface NpcFilter {
  role?: string;           // only this role
  excludeIds?: string[];   // skip these NPC IDs
  excludeOwner?: boolean;  // skip the goal owner (default: true)
  onlyAlive?: boolean;     // only alive NPCs (default: true)
}

// ─── Goal ───

export interface NpcGoal {
  id: string;
  type: string;            // 'investigate', 'patrol', 'trade', 'seek', etc.
  ownerId: string;         // NPC who has this goal
  priority: number;        // higher = more urgent (10 = critical, 1 = casual)
  state: 'pending' | 'active' | 'completed' | 'failed';
  steps: GoalStep[];
  currentStep: number;
  data: Record<string, unknown>; // goal-specific context
  createdAtTick: number;
  homeLocation?: string;   // where to return after goal (optional)
  waitTicks?: number;      // how many ticks spent waiting for target (timeout at 3)
}

// ─── Goal Action Result ───

export interface GoalActionResult {
  goalId: string;
  goalType: string;
  ownerId: string;
  ownerName: string;
  action: string;          // step action that was executed
  description: string;     // human-readable description of what happened
  movement?: MovementResult;
  interaction?: {
    targetId: string;
    targetName: string;
    ownerLine: string;     // what the goal owner said
    targetLine: string;    // what the target responded
    purpose: string;
  };
  announcement?: {
    message: string;
    recipients: string[];
  };
  crimeEvent?: {
    type: string;          // EventType that was emitted
    targetId: string;
    targetName: string;
  };
  goalCompleted?: boolean;
}

// ─── Goal Trigger ───

// ─── Goal Manager ───

/** Gather evidence about a detained NPC from all agents' beliefs */
function gatherEvidence(suspect: Agent, agents: Map<string, Agent>): string {
  const lines: string[] = [];
  const suspectName = suspect.profile.name;

  for (const [, agent] of agents) {
    if (!agent.state.alive) continue;
    const beliefs = agent.state.beliefs?.getAllBeliefs() ?? [];
    for (const b of beliefs) {
      if ((b.eventType === 'NPC_KILLED' || b.eventType === 'GOODS_STOLEN' || b.eventType === 'SELF_JUSTICE' || b.eventType === 'WANTED_STATUS') &&
          (b.subject === suspectName || b.object === suspectName)) {
        const sourceLabel = b.source === 'witness' || b.source === 'observation' ? 'eyewitness' :
          b.source === 'interrogation' ? 'testimony under questioning' :
          b.source === 'rumor' ? 'hearsay' : b.source;
        lines.push(`- ${agent.profile.name} (${sourceLabel}, confidence ${Math.round(b.confidence * 100)}%): ${b.subject} committed ${b.eventType === 'NPC_KILLED' ? 'murder of' : 'crime against'} ${b.object ?? 'unknown'}`);
      }
    }
  }

  if (lines.length === 0) return 'No evidence gathered against this suspect.';
  return lines.join('\n');
}

export class GoalManager {
  private goals: Map<string, NpcGoal[]> = new Map(); // ownerId → goals

  /** Add a goal for an NPC */
  addGoal(goal: NpcGoal): void {
    const list = this.goals.get(goal.ownerId) ?? [];
    list.push(goal);
    // Sort by priority descending
    list.sort((a, b) => b.priority - a.priority);
    this.goals.set(goal.ownerId, list);
  }

  /** Get all active/pending goals for an NPC */
  getGoals(ownerId: string): NpcGoal[] {
    return (this.goals.get(ownerId) ?? []).filter(
      (g) => g.state === 'pending' || g.state === 'active',
    );
  }

  /** Get the highest-priority active goal for an NPC (preempts lower-priority) */
  getActiveGoal(ownerId: string): NpcGoal | null {
    const goals = this.getGoals(ownerId);
    if (goals.length === 0) return null;

    // goals[0] is the highest-priority goal (sorted desc)
    const top = goals[0];

    // Preempt: if a higher-priority goal is pending while a lower one is active, switch
    const active = goals.find((g) => g.state === 'active');
    if (active && active !== top && top.state === 'pending') {
      active.state = 'pending'; // pause current
      top.state = 'active';
      return top;
    }

    if (active) return active;

    top.state = 'active';
    return top;
  }

  /** Check if an NPC has any active goals */
  hasActiveGoal(ownerId: string): boolean {
    return this.getActiveGoal(ownerId) !== null;
  }

  /** Check if NPC has an active/pending goal with priority >= minPriority */
  hasActiveGoalAbove(ownerId: string, minPriority: number): boolean {
    const goals = this.getGoals(ownerId);
    return goals.some((g) => g.state !== 'completed' && g.state !== 'failed' && g.priority >= minPriority);
  }

  /** Complete all pending/active goals of a given type (e.g. once crime is reported, no need to keep reporting) */
  completeGoalsByType(type: string): number {
    let count = 0;
    for (const list of this.goals.values()) {
      for (const goal of list) {
        if (goal.type === type && (goal.state === 'pending' || goal.state === 'active')) {
          goal.state = 'completed';
          count++;
        }
      }
    }
    return count;
  }

  /** Clear all active/pending goals for an NPC (e.g., when arrested or fled) */
  clearGoals(ownerId: string): void {
    const goals = this.goals.get(ownerId);
    if (!goals) return;
    for (const goal of goals) {
      if (goal.state === 'pending' || goal.state === 'active') {
        goal.state = 'failed';
      }
    }
  }

  /** Get all goals across all NPCs (for debugging/UI) */
  getAllGoals(): NpcGoal[] {
    const all: NpcGoal[] = [];
    for (const list of this.goals.values()) {
      all.push(...list);
    }
    return all;
  }

  /** Serializable snapshot (only active/pending goals) */
  toJSON(): Record<string, NpcGoal[]> {
    const result: Record<string, NpcGoal[]> = {};
    for (const [ownerId, list] of this.goals) {
      const active = list.filter((g) => g.state === 'pending' || g.state === 'active');
      if (active.length > 0) result[ownerId] = active;
    }
    return result;
  }

  /** Restore goals from a saved snapshot */
  loadFromJSON(data: Record<string, NpcGoal[]>): void {
    for (const [ownerId, goals] of Object.entries(data)) {
      for (const goal of goals) {
        this.addGoal(goal);
      }
    }
  }

  /**
   * Process one tick for a specific NPC's goal.
   * Returns the action taken, or null if no goal / goal complete.
   */
  async processGoalTick(
    ownerId: string,
    agents: Map<string, Agent>,
    locations: LocationGraph,
    runInteraction: InteractionRunner,
    onCrimeEvent?: (event: { type: string; subject: string; object?: string; location: string; importance: number; payload: Record<string, unknown> }) => Promise<void>,
    crimeScenes?: Map<string, import('./world-types').CrimeScene[]>,
  ): Promise<GoalActionResult | null> {
    const goal = this.getActiveGoal(ownerId);
    if (!goal) return null;

    const owner = agents.get(ownerId);
    if (!owner || !owner.state.alive) {
      goal.state = 'failed';
      if (owner) owner.state.currentMotive = undefined;
      return null;
    }

    // Check if all steps are done
    if (goal.currentStep >= goal.steps.length) {
      goal.state = 'completed';
      // Clear current motive — goal fulfilled, emotional context no longer active
      if (owner.state.currentMotive && goal.data?.reason) {
        owner.state.currentMotive = undefined;
      }
      return {
        goalId: goal.id,
        goalType: goal.type,
        ownerId,
        ownerName: owner.profile.name,
        action: 'completed',
        description: `${owner.profile.name} completed goal: ${goal.type}`,
        goalCompleted: true,
      };
    }

    const step = goal.steps[goal.currentStep];
    return this.executeStep(goal, step, ownerId, owner, agents, locations, runInteraction, onCrimeEvent, crimeScenes);
  }

  private async executeStep(
    goal: NpcGoal,
    step: GoalStep,
    ownerId: string,
    owner: Agent,
    agents: Map<string, Agent>,
    locations: LocationGraph,
    runInteraction: InteractionRunner,
    onCrimeEvent?: (event: { type: string; subject: string; object?: string; location: string; importance: number; payload: Record<string, unknown> }) => Promise<void>,
    crimeScenes?: Map<string, import('./world-types').CrimeScene[]>,
  ): Promise<GoalActionResult | null> {
    const baseResult = {
      goalId: goal.id,
      goalType: goal.type,
      ownerId: goal.ownerId,
      ownerName: owner.profile.name,
    };

    switch (step.action) {
      case 'move_to': {
        if (owner.state.location === step.location) {
          // Already there, advance
          goal.currentStep++;
          return { ...baseResult, action: 'move_to', description: `${owner.profile.name} arrived at ${step.location}` };
        }

        const next = nextHop(locations, owner.state.location, step.location);
        if (!next) {
          // No path — skip step
          goal.currentStep++;
          return { ...baseResult, action: 'move_to', description: `${owner.profile.name} cannot reach ${step.location}` };
        }

        const from = owner.state.location;
        owner.state.location = next;
        goal.currentStep = next === step.location ? goal.currentStep + 1 : goal.currentStep;

        return {
          ...baseResult,
          action: 'move_to',
          description: `${owner.profile.name} moves from ${from} to ${next}`,
          movement: { agentId: goal.ownerId, agentName: owner.profile.name, from, to: next },
        };
      }

      case 'interact': {
        const target = agents.get(step.targetId);
        if (!target || !target.state.alive) {
          goal.currentStep++;
          return { ...baseResult, action: 'interact', description: `${owner.profile.name}: target not available` };
        }

        if (owner.state.location !== target.state.location) {
          // Target not here — wait with priority-based timeout, then skip step
          // AL will re-evaluate and create new goal with updated target location (emergent pursuit)
          const maxWait = goal.priority >= 7 ? 3 : goal.priority >= 4 ? 2 : 1;
          goal.waitTicks = (goal.waitTicks ?? 0) + 1;
          if (goal.waitTicks >= maxWait) {
            goal.currentStep++;
            goal.waitTicks = 0;
            return { ...baseResult, action: 'interact', description: `${owner.profile.name}: ${target.profile.name} didn't show up, moving on` };
          }
          return { ...baseResult, action: 'wait', description: `${owner.profile.name} waiting for ${target.profile.name}` };
        }
        goal.waitTicks = 0;

        const result = await runInteraction(owner, target, step.purpose, step.importance);

        // Belief transfer: copy relevant crime beliefs between participants
        if (step.beliefTransfer && target.state.beliefs && owner.state.beliefs) {
          const direction = step.beliefTransferDirection ?? 'target-to-owner';
          const sender = direction === 'owner-to-target' ? owner : target;
          const receiver = direction === 'owner-to-target' ? target : owner;
          const senderId = direction === 'owner-to-target' ? goal.ownerId : step.targetId;

          const senderBeliefs = sender.state.beliefs!.getAllBeliefs();
          const crimeBeliefs = senderBeliefs.filter(
            (b) => (b.eventType === 'NPC_KILLED' || b.eventType === 'GOODS_STOLEN' || b.eventType === 'SELF_JUSTICE') &&
              b.confidence >= 0.3,
          );
          for (const b of crimeBeliefs) {
            const transferConfidence = b.source === 'witness' || b.source === 'observation'
              ? b.confidence * 0.85
              : b.source === 'rumor'
              ? b.confidence * 0.5
              : b.confidence * 0.7;

            const existing = receiver.state.beliefs!.getAllBeliefs().find(
              (eb) => eb.eventType === b.eventType && eb.subject === b.subject && eb.object === b.object,
            );
            if (existing && existing.confidence >= transferConfidence) continue;

            receiver.state.beliefs!.addBelief({
              id: crypto.randomUUID(),
              eventType: b.eventType,
              subject: b.subject,
              object: b.object,
              location: b.location,
              confidence: transferConfidence,
              source: 'testimony',
              sourceNpcId: senderId,
              gameDay: owner.state.currentDay,
              lastUpdated: owner.state.currentDay,
            });
          }

          // Emit NPC_INTERROGATED event
          if (onCrimeEvent && crimeBeliefs.length > 0) {
            await onCrimeEvent({
              type: 'NPC_INTERROGATED',
              subject: goal.ownerId,
              object: step.targetId,
              location: owner.state.location,
              importance: step.importance,
              payload: {
                guardName: owner.profile.name,
                witnessName: target.profile.name,
                beliefsTransferred: crimeBeliefs.length,
                affectedTargets: [goal.ownerId],
              },
            });
          }
        }

        // ── Suspect evaluation (declarative flag from step template) ──
        // If the step has evaluateSuspect, check if target matches a deduction belief
        // and update confidence based on guilt + H trait.
        if (step.evaluateSuspect && owner.state.beliefs && crimeScenes) {
          evaluateInterrogationOutcome(owner, target, owner.state.currentDay, crimeScenes);
        }

        goal.currentStep++;

        return {
          ...baseResult,
          action: 'interact',
          description: `${owner.profile.name} talked to ${target.profile.name} (${step.purpose})`,
          interaction: {
            targetId: step.targetId,
            targetName: target.profile.name,
            ownerLine: result.ownerLine,
            targetLine: result.targetLine,
            purpose: step.purpose,
          },
        };
      }

      case 'interact_present': {
        const interacted = (goal.data._interacted as string[]) ?? [];

        // Find matching NPCs at current location
        const candidates = this.findInteractCandidates(
          goal.ownerId, owner, agents, step.filter, interacted,
        );

        if (candidates.length === 0) {
          // No one left to interact with — advance
          goal.currentStep++;
          goal.data._interacted = [];
          return { ...baseResult, action: 'interact_present', description: `${owner.profile.name} finished talking to everyone here` };
        }

        // Interact with first candidate
        const [targetId, target] = candidates[0];
        const result = await runInteraction(owner, target, step.purpose, step.importance);

        // Belief transfer: reporter's crime beliefs → target (e.g. witness reports to guard)
        if (step.purpose.includes('[CRIME') && owner.state.beliefs && target.state.beliefs) {
          const ownerCrimeBeliefs = owner.state.beliefs.getAllBeliefs().filter(
            (b) => (b.eventType === 'NPC_KILLED' || b.eventType === 'GOODS_STOLEN' || b.eventType === 'SELF_JUSTICE') &&
              b.confidence >= 0.3,
          );
          for (const b of ownerCrimeBeliefs) {
            const transferConf = b.source === 'witness' ? b.confidence * 0.85
              : b.source === 'body_discovery' ? b.confidence * 0.7
              : b.confidence * 0.6;
            const existing = target.state.beliefs.getAllBeliefs().find(
              (eb) => eb.eventType === b.eventType && eb.object === b.object,
            );
            if (existing && existing.confidence >= transferConf) continue;
            target.state.beliefs.addBelief({
              id: crypto.randomUUID(),
              eventType: b.eventType,
              subject: b.subject,
              object: b.object,
              location: b.location,
              confidence: transferConf,
              source: 'testimony',
              sourceNpcId: goal.ownerId,
              gameDay: owner.state.currentDay,
              lastUpdated: owner.state.currentDay,
            });
          }
        }

        interacted.push(targetId);
        goal.data._interacted = interacted;

        // Check if there are more candidates remaining — if not, advance now
        const remaining = this.findInteractCandidates(
          goal.ownerId, owner, agents, step.filter, interacted,
        );
        if (remaining.length === 0) {
          goal.currentStep++;
          goal.data._interacted = [];
        }

        return {
          ...baseResult,
          action: 'interact',
          description: `${owner.profile.name} talked to ${target.profile.name} (${step.purpose})`,
          interaction: {
            targetId,
            targetName: target.profile.name,
            ownerLine: result.ownerLine,
            targetLine: result.targetLine,
            purpose: step.purpose,
          },
        };
      }

      case 'announce': {
        // Share message with all NPCs at current location
        const recipients: string[] = [];
        for (const [id, agent] of agents) {
          if (id === goal.ownerId) continue;
          if (!agent.state.alive) continue;
          if (agent.state.location !== owner.state.location) continue;
          await agent.observe(
            `${owner.profile.name} announced: "${step.message}"`,
            step.importance,
          );
          recipients.push(id);
        }

        goal.currentStep++;
        return {
          ...baseResult,
          action: 'announce',
          description: `${owner.profile.name} announced: "${step.message}"`,
          announcement: { message: step.message, recipients },
        };
      }

      case 'wait': {
        const waited = (goal.data._waited as number) ?? 0;
        if (waited + 1 >= step.ticks) {
          goal.data._waited = 0;
          goal.currentStep++;
          return { ...baseResult, action: 'wait', description: `${owner.profile.name} finished waiting` };
        }
        goal.data._waited = waited + 1;
        return { ...baseResult, action: 'wait', description: `${owner.profile.name} is waiting...` };
      }

      case 'steal_from': {
        const target = agents.get(step.targetId);
        if (!target || !target.state.alive) {
          goal.currentStep++;
          return { ...baseResult, action: 'steal_from', description: `${owner.profile.name}: target not available` };
        }

        if (owner.state.location !== target.state.location) {
          const maxWait = goal.priority >= 7 ? 3 : goal.priority >= 4 ? 2 : 1;
          goal.waitTicks = (goal.waitTicks ?? 0) + 1;
          if (goal.waitTicks >= maxWait) {
            goal.currentStep++;
            goal.waitTicks = 0;
            return { ...baseResult, action: 'steal_from', description: `${owner.profile.name}: target left, opportunity lost` };
          }
          return { ...baseResult, action: 'wait', description: `${owner.profile.name} waiting for opportunity` };
        }
        goal.waitTicks = 0;

        // Execute theft — owner gets memory, target doesn't know yet
        await owner.observe(
          `I stole goods from ${target.profile.name}'s shop. I was desperate — I had no choice. The guilt weighs on me.`,
          step.importance,
        );

        // Mood partial recovery from getting what they needed
        owner.state.mood = Math.min(1, owner.state.mood + 0.15);

        // Emit crime event for CE processing
        if (onCrimeEvent) {
          await onCrimeEvent({
            type: 'GOODS_STOLEN',
            subject: goal.ownerId,
            object: step.targetId,
            location: owner.state.location,
            importance: step.importance,
            payload: {
              thiefName: owner.profile.name,
              victimName: target.profile.name,
              victimRole: target.profile.role,
            },
          });
        }

        goal.currentStep++;
        return {
          ...baseResult,
          action: 'steal_from',
          description: `${owner.profile.name} stole from ${target.profile.name}'s shop`,
          crimeEvent: { type: 'GOODS_STOLEN', targetId: step.targetId, targetName: target.profile.name },
        };
      }

      case 'attack_npc': {
        const target = agents.get(step.targetId);
        if (!target || !target.state.alive) {
          goal.currentStep++;
          return { ...baseResult, action: 'attack_npc', description: `${owner.profile.name}: target not available` };
        }

        if (owner.state.location !== target.state.location) {
          const maxWait = goal.priority >= 7 ? 3 : goal.priority >= 4 ? 2 : 1;
          goal.waitTicks = (goal.waitTicks ?? 0) + 1;
          if (goal.waitTicks >= maxWait) {
            goal.currentStep++;
            goal.waitTicks = 0;
            return { ...baseResult, action: 'attack_npc', description: `${owner.profile.name}: ${target.profile.name} escaped` };
          }
          return { ...baseResult, action: 'wait', description: `${owner.profile.name} searching for ${target.profile.name}` };
        }
        goal.waitTicks = 0;

        const isLethal = step.lethal === true;
        const eventType = isLethal ? 'NPC_KILLED' : 'SELF_JUSTICE';

        if (isLethal) {
          // Lethal attack — murder
          target.state.alive = false;
          await owner.observe(
            `You killed ${target.profile.name}. ${step.reason}. It is done. The weight of what you have done is crushing.`,
            10,
          );
          owner.state.mood = Math.max(-1, owner.state.mood - 0.5);

          // Killer knows they killed
          if (owner.state.beliefs) {
            const { BeliefManager } = await import('./beliefs');
            owner.state.beliefs.addBelief({
              id: crypto.randomUUID(),
              eventType: 'NPC_KILLED',
              subject: owner.profile.name,
              object: `${target.profile.name} the ${target.profile.role}`,
              location: target.state.location,
              confidence: 1.0,
              source: 'witness',
              sourceNpcId: null,
              gameDay: owner.state.currentDay,
              lastUpdated: owner.state.currentDay,
            });
          }
        } else {
          // Non-lethal attack — both get memories, target mood drops hard
          await owner.observe(
            `I attacked ${target.profile.name}. ${step.reason}. My hands are shaking — but they deserved it.`,
            step.importance,
          );
          await target.observe(
            `${owner.profile.name} attacked me! They were furious, screaming about ${step.reason}. I'm hurt and terrified.`,
            step.importance,
          );
          owner.state.mood = Math.min(1, owner.state.mood + 0.1);
          target.state.mood = Math.max(-1, target.state.mood - 0.4);
        }

        // Relationship damage
        if (target.state.relationships) {
          target.state.relationships.adjustSentiment(goal.ownerId, -0.5);
          target.state.relationships.adjustTrust(goal.ownerId, -0.6);
        }
        if (owner.state.relationships) {
          owner.state.relationships.adjustSentiment(step.targetId, -0.2);
        }

        // Emit crime event
        if (onCrimeEvent) {
          await onCrimeEvent({
            type: eventType,
            subject: goal.ownerId,
            object: step.targetId,
            location: owner.state.location,
            importance: isLethal ? 10 : step.importance,
            payload: {
              ...(isLethal
                ? { killerName: owner.profile.name, victimName: target.profile.name, victimRole: target.profile.role }
                : { attackerName: owner.profile.name, victimName: target.profile.name, reason: step.reason }),
            },
          });
        }

        goal.currentStep++;
        return {
          ...baseResult,
          action: 'attack_npc',
          description: isLethal
            ? `${owner.profile.name} killed ${target.profile.name} (${step.reason})`
            : `${owner.profile.name} attacked ${target.profile.name} (${step.reason})`,
          crimeEvent: { type: eventType, targetId: step.targetId, targetName: target.profile.name },
        };
      }

      case 'arrest_npc': {
        const target = agents.get(step.targetId);
        if (!target || !target.state.alive) {
          goal.currentStep++;
          return { ...baseResult, action: 'arrest_npc', description: `${owner.profile.name}: arrest target not available` };
        }

        // Already detained/exiled/fled — skip
        if ((target.state.status ?? 'free') !== 'free') {
          goal.currentStep++;
          return { ...baseResult, action: 'arrest_npc', description: `${owner.profile.name}: ${target.profile.name} already ${target.state.status}` };
        }

        if (owner.state.location !== target.state.location) {
          // Active pursuit — guard chases suspect each tick (creates emergent chase scenes)
          const pursuitTicks = (goal.waitTicks ?? 0) + 1;
          goal.waitTicks = pursuitTicks;
          if (pursuitTicks > 10) {
            goal.currentStep++;
            goal.waitTicks = 0;
            return { ...baseResult, action: 'arrest_npc', description: `${owner.profile.name}: lost pursuit of ${target.profile.name}` };
          }
          const next = nextHop(locations, owner.state.location, target.state.location);
          if (next) {
            const from = owner.state.location;
            owner.state.location = next;
            return {
              ...baseResult, action: 'move_to',
              description: `${owner.profile.name} pursuing suspect ${target.profile.name}`,
              movement: { agentId: goal.ownerId, agentName: owner.profile.name, from, to: next },
            };
          }
          goal.currentStep++;
          goal.waitTicks = 0;
          return { ...baseResult, action: 'arrest_npc', description: `${owner.profile.name}: cannot reach ${target.profile.name}` };
        }
        goal.waitTicks = 0;

        // Change status to detained
        target.state.status = 'detained';
        target.state.location = 'Courthouse'; // escorted to courthouse

        // Clear target's goals (can't act while detained)
        this.clearGoals(step.targetId);

        // Memories for both
        await owner.observe(
          `I arrested ${target.profile.name} and escorted them to the Courthouse. Justice will be served.`,
          step.importance,
        );
        await target.observe(
          `${owner.profile.name} arrested me. I am being held at the Courthouse awaiting judgment.`,
          step.importance,
        );

        target.state.mood = Math.max(-1, target.state.mood - 0.4);

        // Emit arrest event
        if (onCrimeEvent) {
          await onCrimeEvent({
            type: 'NPC_ARRESTED',
            subject: goal.ownerId,
            object: step.targetId,
            location: owner.state.location,
            importance: step.importance,
            payload: {
              guardName: owner.profile.name,
              suspectName: target.profile.name,
              suspectRole: target.profile.role,
              affectedTargets: Array.from(agents.keys()),
            },
          });
        }

        goal.currentStep++;
        return {
          ...baseResult,
          action: 'arrest_npc',
          description: `${owner.profile.name} arrested ${target.profile.name} and escorted to Courthouse`,
        };
      }

      case 'destroy_evidence': {
        // Find active crime scene at this location
        // NOTE: crime scenes are managed by World, so we emit an event and let World handle it
        await owner.observe(
          `I destroyed evidence at ${owner.state.location}. I hope no one saw me.`,
          step.importance,
        );

        if (onCrimeEvent) {
          await onCrimeEvent({
            type: 'EVIDENCE_DESTROYED',
            subject: goal.ownerId,
            location: owner.state.location,
            importance: step.importance,
            payload: {
              criminalName: owner.profile.name,
              affectedTargets: Array.from(agents.entries())
                .filter(([id, a]) => id !== goal.ownerId && a.state.alive && a.state.location === owner.state.location)
                .map(([id]) => id),
            },
          });
        }

        goal.currentStep++;
        return {
          ...baseResult,
          action: 'destroy_evidence',
          description: `${owner.profile.name} destroyed evidence at ${owner.state.location}`,
        };
      }

      case 'flee': {
        // NPC flees the town
        owner.state.status = 'fled';

        await owner.observe(
          `I fled the town through the gate. I can never return. Everything I had here is gone.`,
          step.importance,
        );
        owner.state.mood = Math.max(-1, owner.state.mood - 0.3);

        if (onCrimeEvent) {
          await onCrimeEvent({
            type: 'NPC_FLED',
            subject: goal.ownerId,
            location: owner.state.location,
            importance: step.importance,
            payload: {
              fledName: owner.profile.name,
              fledRole: owner.profile.role,
              affectedTargets: Array.from(agents.keys()),
            },
          });
        }

        goal.state = 'completed';
        goal.currentStep++;
        this.clearGoals(goal.ownerId); // after setting completed to avoid overwriting
        return {
          ...baseResult,
          action: 'flee',
          description: `${owner.profile.name} fled the town!`,
        };
      }

      case 'examine_scene': {
        // Guard examines crime scene → synthesizes suspicion beliefs from opportunity + motive
        const scenes = crimeScenes?.get(owner.state.location) ?? [];
        const activeScene = scenes.find((s) => s.active);
        if (!activeScene) {
          goal.currentStep++;
          return { ...baseResult, action: 'examine_scene', description: `${owner.profile.name}: no active crime scene here` };
        }

        const victimAgent = activeScene.victimId ? agents.get(activeScene.victimId) : null;
        const victimName = victimAgent ? `${victimAgent.profile.name} the ${victimAgent.profile.role}` : 'unknown victim';
        const crimeLabel = activeScene.crimeType === 'murder' ? 'murder' : activeScene.crimeType === 'robbery' ? 'theft' : 'attack';

        // Cross-reference: persons present × motive (negative sentiment toward victim)
        let suspectCount = 0;
        for (const personId of activeScene.personsPresent) {
          if (personId === activeScene.victimId) continue;
          if (personId === ownerId) continue;
          const person = agents.get(personId);
          if (!person) continue;

          // Check if guard already has a deduction belief about this person
          const existing = owner.state.beliefs?.getAllBeliefs().find(
            (b) => b.source === 'deduction' && b.subject === person.profile.name,
          );
          if (existing) continue;

          // Base confidence from opportunity (was at scene)
          let conf = 0.3;

          // Motive boost: negative sentiment toward victim
          if (activeScene.victimId && person.state.relationships) {
            const rel = person.state.relationships.getRelationship(activeScene.victimId);
            if (rel && rel.sentiment < -0.3) conf = 0.5;
          }

          // Create suspicion belief
          if (owner.state.beliefs) {
            owner.state.beliefs.addBelief({
              id: crypto.randomUUID(),
              eventType: activeScene.crimeType === 'murder' ? 'NPC_KILLED'
                : activeScene.crimeType === 'robbery' ? 'GOODS_STOLEN' : 'SELF_JUSTICE',
              subject: person.profile.name,
              object: victimName,
              location: owner.state.location,
              confidence: conf,
              source: 'deduction',
              sourceNpcId: null,
              gameDay: goal.createdAtTick ? Math.floor(goal.createdAtTick / 24) + 1 : 1,
              lastUpdated: goal.createdAtTick ? Math.floor(goal.createdAtTick / 24) + 1 : 1,
            });
            suspectCount++;
            console.log(`  [Investigate] ${owner.profile.name} deduces: ${person.profile.name} is a suspect (conf: ${conf}) — opportunity${conf >= 0.5 ? ' + motive' : ''}`);
          }
        }

        await owner.observe(
          `I examined the crime scene at ${owner.state.location}. ${suspectCount > 0 ? `Found ${suspectCount} person(s) of interest who were present when the ${crimeLabel} of ${victimName} occurred.` : `No clear suspects from the scene.`}`,
          step.importance,
        );

        goal.currentStep++;
        return {
          ...baseResult,
          action: 'examine_scene',
          description: `${owner.profile.name} examined crime scene: ${suspectCount} suspect(s) identified`,
        };
      }

      case 'sentence_npc': {
        const target = agents.get(step.targetId);
        if (!target || (target.state.status ?? 'free') !== 'detained') {
          goal.currentStep++;
          return { ...baseResult, action: 'sentence_npc', description: `${owner.profile.name}: no detained suspect to sentence` };
        }

        // Gather all evidence (beliefs from all NPCs about this crime)
        const evidenceSummary = gatherEvidence(target, agents);

        // LLM decides the sentence (generateResponse manages semaphore internally)
        const prompt = `You are ${owner.profile.name}, the town magistrate. ${target.profile.name} the ${target.profile.role} has been arrested and brought before you.

Evidence gathered:
${evidenceSummary}

Based on this evidence, you must decide:
- If evidence is strong and clear: sentence to EXILE (banished from town)
- If evidence is weak or contradictory: RELEASE (freed, insufficient proof)

Respond with exactly one word: EXILE or RELEASE`;

        const response = await owner.generateResponse(prompt, { maxTokens: 10 });
        const verdict: 'exile' | 'release' = response.toLowerCase().includes('exile') ? 'exile' : 'release';

        if (verdict === 'exile') {
          target.state.status = 'exiled';
          this.clearGoals(step.targetId);
          await owner.observe(`I sentenced ${target.profile.name} to exile. The evidence was clear. Justice is served.`, step.importance);
          await target.observe(`Magistrate ${owner.profile.name} sentenced me to exile. I must leave and never return.`, step.importance);
          target.state.mood = -1;
        } else {
          target.state.status = 'free';
          await owner.observe(`I released ${target.profile.name}. The evidence was insufficient for conviction.`, step.importance);
          await target.observe(`Magistrate ${owner.profile.name} released me. I am free, but the suspicion remains.`, step.importance);
          target.state.mood = Math.min(1, target.state.mood + 0.3);
        }

        if (onCrimeEvent) {
          await onCrimeEvent({
            type: 'NPC_SENTENCED',
            subject: goal.ownerId,
            object: step.targetId,
            location: owner.state.location,
            importance: step.importance,
            payload: {
              judgeName: owner.profile.name,
              suspectName: target.profile.name,
              verdict,
              affectedTargets: Array.from(agents.keys()),
            },
          });
        }

        goal.currentStep++;
        return {
          ...baseResult,
          action: 'sentence_npc',
          description: `Magistrate ${owner.profile.name} ${verdict === 'exile' ? 'exiled' : 'released'} ${target.profile.name}`,
        };
      }
    }
  }

  private findInteractCandidates(
    ownerId: string,
    owner: Agent,
    agents: Map<string, Agent>,
    filter: NpcFilter | undefined,
    alreadyInteracted: string[],
  ): [string, Agent][] {
    const interactedSet = new Set(alreadyInteracted);
    const excludeIds = new Set(filter?.excludeIds ?? []);

    return Array.from(agents.entries()).filter(([id, agent]) => {
      if (id === ownerId) return false;
      if (interactedSet.has(id)) return false;
      if (excludeIds.has(id)) return false;
      if (filter?.onlyAlive !== false && !agent.state.alive) return false;
      if (agent.state.location !== owner.state.location) return false;
      if (filter?.role && agent.profile.role !== filter.role) return false;
      return true;
    });
  }
}

// ─── Interaction Runner Type ───

/** Function that runs an LLM-driven interaction between two NPCs */
export type InteractionRunner = (
  initiator: Agent,
  target: Agent,
  purpose: string,
  importance: number,
) => Promise<{ ownerLine: string; targetLine: string }>;

// ─── Suspect Interrogation Outcome ───

/**
 * After a guard interrogates someone they suspect (deduction belief),
 * evaluate the outcome based on guilt + suspect's H trait.
 *
 * - Guilty + honest (H >= threshold): quasi-confession → high confidence
 * - Guilty + dishonest (H < threshold): denial but nervous → moderate boost
 * - Innocent: credible alibi → confidence drops
 *
 * PM = instinct: H trait determines lying ability, not LLM.
 * Structured: guilt checked via perpetratorId, not text matching.
 */
function evaluateInterrogationOutcome(
  owner: Agent,
  suspect: Agent,
  currentDay: number,
  crimeScenes: Map<string, CrimeScene[]>,
): void {
  if (!owner.state.beliefs) return;

  // Find deduction belief about this suspect
  const deduction = owner.state.beliefs.getAllBeliefs().find(
    (b) => b.source === 'deduction' && b.subject === suspect.profile.name,
  );
  if (!deduction) return; // Not a suspect — just a witness interrogation

  const isGuilty = checkGuilt(suspect.profile.id, crimeScenes);
  const honesty = suspect.profile.bigFive.honesty;

  if (isGuilty) {
    if (honesty >= HONESTY_THRESHOLD) {
      deduction.confidence = CONFESSION_CONFIDENCE;
      console.log(`  [Interrogate] ${suspect.profile.name} (H=${honesty.toFixed(2)}) shows guilt — quasi-confession → conf ${deduction.confidence}`);
    } else {
      deduction.confidence = Math.min(1, deduction.confidence + NERVOUS_BOOST);
      console.log(`  [Interrogate] ${suspect.profile.name} (H=${honesty.toFixed(2)}) denies but nervous → conf ${deduction.confidence.toFixed(2)}`);
    }
  } else {
    deduction.confidence = Math.max(0.1, deduction.confidence - ALIBI_DROP);
    console.log(`  [Interrogate] ${suspect.profile.name} provides credible alibi → conf ${deduction.confidence.toFixed(2)}`);
  }

  deduction.lastUpdated = currentDay;
}

/** Check if suspect is the perpetrator of any active crime scene */
function checkGuilt(suspectId: string, crimeScenes: Map<string, CrimeScene[]>): boolean {
  for (const scenes of crimeScenes.values()) {
    for (const scene of scenes) {
      if (scene.active && scene.perpetratorId === suspectId) return true;
    }
  }
  return false;
}
