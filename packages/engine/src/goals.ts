import type { Agent } from './agent';
import type { WorldEvent } from './cg-types';
import type { LocationGraph, MovementResult, CrimeScene } from './world-types';
import type { EvidenceLayer } from './evidence';
import { findPath } from './pathfinding';
import { getEventLabel, getBeliefSourceLabel, getSourceTransferWeight, getStepHandler, runInteractPostHooks, isTransferable, BELIEF_SOURCE } from './event-registry';
import type { MoodModifierCallback } from './event-registry';

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
  /** If set, emit an event with this type after interaction (e.g. module-specific event types) */
  emitEventType?: string;
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
  /** Transfer transferable beliefs from speaker to each listener */
  beliefTransfer?: boolean;
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

/** Generic step for module-registered actions (steal, arrest, trade, etc.) */
export interface ModuleStep {
  action: string;
  [key: string]: unknown;
}

export type GoalStep = MoveStep | InteractStep | InteractPresentStep | AnnounceStep | WaitStep | ModuleStep;

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
  createdAtMinute: number;
  homeLocation?: string;   // where to return after goal (optional)
  waitTicks?: number;      // how many ticks spent waiting for target (timeout at 3)
  isRoutine?: boolean;     // true for schedule/routine goals — no mood boost on completion
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
  isRoutine?: boolean;     // true for schedule/routine goals — no mood boost on completion
}

// ─── Goal Trigger ───

// ─── Goal Manager ───

/** Gather evidence about a detained NPC from all agents' beliefs */
export class GoalManager {
  private goals: Map<string, NpcGoal[]> = new Map(); // ownerId → goals
  onGoalChange?: (data: { npcId: string; goalType: string; status: 'created' | 'completed' | 'failed'; targetName?: string }) => void;

  /** Add a goal for an NPC */
  addGoal(goal: NpcGoal): void {
    if (goal.waitTicks === undefined) goal.waitTicks = 0;
    const list = this.goals.get(goal.ownerId) ?? [];
    list.push(goal);
    // Sort by priority descending
    list.sort((a, b) => b.priority - a.priority);
    this.goals.set(goal.ownerId, list);
    this.onGoalChange?.({ npcId: goal.ownerId, goalType: goal.type, status: 'created', targetName: goal.data?.targetName as string });
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

  /** Check if NPC is the target of someone else's goal of a specific type (e.g. arrest).
   *  Checks step targetId fields in active/pending goals. */
  isTargetOfGoalType(targetNpcId: string, goalType: string): boolean {
    for (const [ownerId, ownerGoals] of this.goals) {
      if (ownerId === targetNpcId) continue;
      for (const goal of ownerGoals) {
        if (goal.state === 'completed' || goal.state === 'failed') continue;
        if (goal.type !== goalType) continue;
        // Check if any step targets this NPC
        for (const step of goal.steps) {
          if ('targetId' in step && (step as { targetId?: string }).targetId === targetNpcId) return true;
        }
      }
    }
    return false;
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
    evidenceLayer?: EvidenceLayer,
    addMoodModifier?: MoodModifierCallback,
  ): Promise<GoalActionResult | null> {
    const goal = this.getActiveGoal(ownerId);
    if (!goal) return null;

    const owner = agents.get(ownerId);
    if (!owner || !owner.state.alive) {
      goal.state = 'failed';
      if (owner) owner.state.currentMotive = undefined;
      this.onGoalChange?.({ npcId: ownerId, goalType: goal.type, status: 'failed' });
      return null;
    }

    // Check if all steps are done
    if (goal.currentStep >= goal.steps.length) {
      goal.state = 'completed';
      this.onGoalChange?.({ npcId: ownerId, goalType: goal.type, status: 'completed' });
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
        isRoutine: goal.isRoutine,
      };
    }

    const step = goal.steps[goal.currentStep];
    return this.executeStep(goal, step, ownerId, owner, agents, locations, runInteraction, onCrimeEvent, crimeScenes, evidenceLayer, addMoodModifier);
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
    evidenceLayer?: EvidenceLayer,
    addMoodModifier?: MoodModifierCallback,
  ): Promise<GoalActionResult | null> {
    const baseResult = {
      goalId: goal.id,
      goalType: goal.type,
      ownerId: goal.ownerId,
      ownerName: owner.profile.name,
    };

    switch (step.action) {
      case 'move_to': {
        // Already at destination → advance step
        if (owner.state.location === step.location) {
          goal.currentStep++;
          return { ...baseResult, action: 'move_to', description: `${owner.profile.name} arrived at ${step.location}` };
        }

        // Already in transit → waiting for Master Clock to advance. Skip.
        if (owner.state.inTransit) {
          return null;
        }

        // Start transit: compute full path, set duration
        const path = findPath(locations, owner.state.location, step.location);
        if (!path || path.length === 0) {
          goal.currentStep++;
          return { ...baseResult, action: 'move_to', description: `${owner.profile.name} cannot reach ${step.location}` };
        }

        const from = owner.state.location;
        // Transit state set by World.startTransit() or inline here
        owner.state.inTransit = true;
        owner.state.transitTo = step.location;
        owner.state.transitPath = path;
        owner.state.transitProgress = 0;
        // transitStartMinute and transitDuration set by World (it owns gameMinute)
        // For now mark as pending — World._advanceTransits() will handle progress

        return {
          ...baseResult,
          action: 'move_to',
          description: `${owner.profile.name} starts walking from ${from} to ${step.location} (${path.length} hops)`,
          movement: { agentId: goal.ownerId, agentName: owner.profile.name, from, to: step.location },
        };
      }

      case 'interact': {
        const target = agents.get(step.targetId);
        if (!target || !target.state.alive) {
          goal.currentStep++;
          return { ...baseResult, action: 'interact', description: `${owner.profile.name}: target not available` };
        }

        if (owner.state.location !== target.state.location) {
          // Already chasing — wait for transit
          if (owner.state.inTransit) return null;

          // Chase: pursue target to their CURRENT location
          const maxChase = goal.priority >= 7 ? 3 : goal.priority >= 4 ? 2 : 1;
          goal.waitTicks!++;
          if (goal.waitTicks >= maxChase) {
            goal.currentStep++;
            goal.waitTicks = 0;
            return { ...baseResult, action: 'interact', description: `${owner.profile.name}: ${target.profile.name} didn't show up, moving on` };
          }

          // Start transit to target's current location
          const path = findPath(locations, owner.state.location, target.state.location);
          if (!path || path.length === 0) {
            goal.currentStep++;
            return { ...baseResult, action: 'interact', description: `${owner.profile.name}: cannot reach ${target.profile.name}` };
          }
          const from = owner.state.location;
          owner.state.inTransit = true;
          owner.state.transitTo = target.state.location;
          owner.state.transitPath = path;
          owner.state.transitProgress = 0;
          console.log(`  [Goal] ${owner.profile.name} pursuing ${target.profile.name} to ${target.state.location}`);
          return {
            ...baseResult,
            action: 'move_to',
            description: `${owner.profile.name} pursuing ${target.profile.name}`,
            movement: { agentId: goal.ownerId, agentName: owner.profile.name, from, to: target.state.location },
          };
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
            (b) => isTransferable(b.eventType) &&
              b.confidence >= 0.3,
          );
          for (const b of crimeBeliefs) {
            const transferConfidence = b.confidence * getSourceTransferWeight(b.source);

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
              source: BELIEF_SOURCE.TESTIMONY,
              sourceNpcId: senderId,
              gameDay: owner.state.currentDay,
              lastUpdated: owner.state.currentDay,
            });
          }

          // Emit event if step declares an event type (module-registered via emitEventType)
          if (onCrimeEvent && step.emitEventType && crimeBeliefs.length > 0) {
            await onCrimeEvent({
              type: step.emitEventType,
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

        // Module-registered post-interaction hooks (e.g., suspect evaluation)
        runInteractPostHooks(owner, target, step, agents, crimeScenes);

        // Unified initiator memory: beliefs + outcome in one entry (no double observe)
        const purposeShort = (step.purpose ?? '').replace(/\[CRIME[^\]]*\]\s*/g, '');
        const pShort = purposeShort.length > 50 ? purposeShort.slice(0, 50) + '...' : purposeShort;
        const targetBeliefs3p = target.state.beliefs?.summarizeForMemory(target.profile.name, 1) ?? '';
        const outcome = owner.state.lastInteractionOutcome;
        const outcomePart = outcome ? ` ${outcome.detail ?? outcome.type}.` : '';
        owner.state.lastInteractionOutcome = undefined;
        await owner.observe(
          `Talked to ${target.profile.name} about ${pShort}.${targetBeliefs3p ? ` ${targetBeliefs3p}.` : ''}${outcomePart}`,
          step.importance,
        );

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

        // Belief transfer: reporter's transferable beliefs → target (e.g. witness reports to guard)
        if (step.beliefTransfer && owner.state.beliefs && target.state.beliefs) {
          const ownerCrimeBeliefs = owner.state.beliefs.getAllBeliefs().filter(
            (b) => isTransferable(b.eventType) &&
              b.confidence >= 0.3,
          );
          for (const b of ownerCrimeBeliefs) {
            const transferConf = b.confidence * getSourceTransferWeight(b.source);
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
              source: BELIEF_SOURCE.TESTIMONY,
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

      // Module-registered step handlers (steal, attack, arrest, sentence, etc.)
      default: {
        const handler = getStepHandler(step.action);
        if (handler) {
          return handler({ goal, step, ownerId, owner, agents, locations, runInteraction, onCrimeEvent, crimeScenes, evidenceLayer, goalManager: this,
            addMoodModifier: addMoodModifier ?? ((id, m) => console.warn(`[Goals] addMoodModifier not provided for ${id}, modifier ${m.source} lost`)) });
        }
        return null;
      }

    }
  }

  // Step handlers for steal_from, attack_npc, arrest_npc, destroy_evidence, flee,
  // examine_scene, sentence_npc moved to modules/crime-justice/step-handlers.ts

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
      if (agent.profile.isPlayer) return false; // Player not a valid NPC-NPC interaction target
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

