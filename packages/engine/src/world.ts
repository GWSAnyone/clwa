import { Agent } from './agent';
import { BeliefManager } from './beliefs';
import { RelationshipGraph } from './relationships';
import type { Belief } from './beliefs';
import type { Relationship } from './relationships';
import type { IEventStore } from './event-types';
import { ConsequenceEngine } from './cg-engine';
import type { WorldEvent } from './cg-types';
import { ConversationScheduler } from './scheduler';
import { runConversation, buildMemoryText } from './conversation';
import { processMovement } from './movement';
import { findPath } from './pathfinding';
import { GoalManager } from './goals';
import type { GoalActionResult, NpcGoal } from './goals';
import { createInteractionRunner } from './interaction';
import type {
  WorldConfig, TickResult, ConversationLine, ConversationResult,
  LocationGraph, NpcMovementConfig, MovementResult, NpcHome,
  CrimeScene, CrimeSceneJSON,
} from './world-types';
import { DEFAULT_WORLD_CONFIG, DEFAULT_MOVEMENT_CONFIG, resolveILConfig, resolveConversationConfig } from './world-types';
import type { ILConfig, ConversationConfig } from './world-types';
import { ScheduleManager, MINUTES_PER_DAY, getTimePeriod, minuteToHour } from './schedule';
import type { ScheduleEntry } from './schedule';
import { createCrimeScene } from './crime-scene';
import { PlayerJournal } from './journal';
import { evaluateAllVolition, evaluateReactiveVolition } from './volition';
import { AFFORDANCE_REGISTRY, checkRequirements, computeUtility } from './al';
import type { AffordanceContext } from './al';
import { TopicEngine, getTopicGroup } from './topic-engine';
import { ProcessingQueue } from './processing-queue';
import type { ProcessingTask, TaskType } from './processing-queue';
import { EvidenceLayer } from './evidence';
import type { EvidenceContext } from './evidence';
import { isEventCategory, getGoalCleanupForEvent, getSceneTypeForEvent, isDeathEvent, getDefaultDeathEvent, getEventHandlers, isStatusActive, isStatusAbsent, getGoalMoodBoost, getBodyDiscoveryEventType, getDiscoveryHandler, getTickPhaseHandlers, getDayAdvanceHandlers, isTransferable, getEventLabel } from './event-registry';
import type { EventHandlerContext } from './event-registry';

export interface WorldCallbacks {
  /** Called when an NPC-to-NPC conversation line is generated */
  onLine?: (line: ConversationLine) => void;
  /** Called when a full conversation completes */
  onConversation?: (result: ConversationResult) => void;
  /** Called on each tick (conversation or idle) */
  onTick?: (result: TickResult) => void;
  /** Called when an NPC moves between locations */
  onMovement?: (movements: MovementResult[]) => void;
  /** Called when a goal action is executed */
  onGoalAction?: (action: GoalActionResult) => void;
  /** Called when an NPC commits murder (motivation system) */
  onMurder?: (killerId: string, victimId: string, killerName: string, victimName: string) => void;
  /** Called when a new crime scene is created */
  onCrimeScene?: (scene: CrimeScene) => void;
  /** Called before an LLM call (for debug UI) */
  onLlmCall?: (reason: string, target?: string) => void;
  /** Called when an NPC makes a volition decision (for overlay UI) */
  onDecision?: (data: { npcId: string; npcName: string; action: string; target?: string; reason: string; topScore: number; instinctTier: string; alternatives: { verb: string; score: number }[] }) => void;
  /** Called when any agent's mood changes (intercepted via property setter) */
  onMoodChange?: (npcId: string, npcName: string, oldMood: number, newMood: number) => void;
  /** Called when a goal is created, completed, or failed */
  onGoalChange?: (data: { npcId: string; goalType: string; status: 'created' | 'completed' | 'failed'; targetName?: string }) => void;
  /** Called after a CG cascade completes with trigger + consequences */
  onCascade?: (trigger: WorldEvent, consequences: WorldEvent[]) => void;
  /** Called when any NPC relationship changes (trust or sentiment) */
  onRelationshipChange?: (fromId: string, fromName: string, toId: string, toName: string, field: 'trust' | 'sentiment', oldVal: number, newVal: number) => void;
  /** Called every game minute by the Game Clock (for WS time broadcast + HUD) */
  onTimeUpdate?: (minuteOfDay: number, hour: string, period: string, gameDay: number) => void;
}

/** Check if NPC can act: alive AND no special status (null = default/free = active) */
function isActive(agent: Agent): boolean {
  return agent.state.alive && isStatusActive(agent.state.status);
}

/** Check if NPC is physically present in the world (status not absent) */
function isPresent(agent: Agent): boolean {
  return agent.state.alive && !isStatusAbsent(agent.state.status);
}

// ─── LLM JSON Schemas ───

export class World {
  readonly agents: Map<string, Agent>;
  readonly eventStore: IEventStore;
  readonly engine: ConsequenceEngine;
  readonly locations: LocationGraph;
  readonly goalManager: GoalManager;
  readonly scheduleManager: ScheduleManager | null;
  private scheduler: ConversationScheduler;
  private config: WorldConfig;
  private movementConfig: NpcMovementConfig;
  private npcHomes: Map<string, string>; // npcId → home location name
  private callbacks: WorldCallbacks;
  /** Processing tick counter (how many times _tick() was called). NOT time — use gameMinute. */
  private tickCount: number = 0;
  /** Absolute game minute counter (grows indefinitely). minuteOfDay = gameMinute % 1440. */
  private _gameMinute: number = 0;
  /** Game speed multiplier: 1=1min/sec, 2=2min/sec, 3=3min/sec, 0=paused */
  private _gameSpeed: number = 1;
  /** Game Clock timer — advances gameMinute independently of processing ticks */
  private _gameClockTimer: ReturnType<typeof setInterval> | null = null;
  /** Last known day number — for detecting day boundary in processing loop */
  private _lastKnownDay: number = 0;
  /** Track which NPC has already discovered which body (to avoid repeats) */
  private bodyDiscoveries: Set<string> = new Set(); // "discoverer:victim"
  /** Active crime scenes at locations */
  readonly crimeScenes: Map<string, CrimeScene[]> = new Map();
  /** Player's investigation journal */
  readonly journal: PlayerJournal = new PlayerJournal();
  /** Cached reference to the player Agent (resolved once, updated if agents change) */
  private _playerAgent: Agent | null = null;
  /** Topic engine for NPC-NPC conversations */
  readonly topicEngine: TopicEngine = new TopicEngine();
  /** Affordance cooldowns: npcId → affordanceId → expiresAtMinute */
  private affordanceCooldowns: Map<string, Map<string, number>> = new Map();
  /** Decision cooldowns: npcId → expiresAtMinute (limits LLM decision frequency) */
  private decisionCooldowns: Map<string, number> = new Map();
  /** Evidence Layer: structured discoverable facts at locations */
  readonly evidence: EvidenceLayer = new EvidenceLayer();
  /** Resolved IL config (merged from WorldConfig.il + defaults) */
  readonly resolvedILConfig: ILConfig;
  /** Resolved conversation config (merged from WorldConfig.conversationBehavior + defaults) */
  readonly resolvedConversationConfig: ConversationConfig;
  /** Pending conversation impact data — consumed by CONVERSATION_IMPACT task handler */
  private _pendingImpactQueue: Array<{ conversation: import('./world-types').ConversationResult; topic: import('./topic-engine').TopicProposal }> = [];
  /** Processing queue — async task consumer, one task at a time, yields between tasks */
  readonly processingQueue: ProcessingQueue;

  constructor(
    agents: Map<string, Agent>,
    eventStore: IEventStore,
    engine: ConsequenceEngine,
    config?: Partial<WorldConfig>,
    callbacks?: WorldCallbacks,
    locations?: LocationGraph,
    movementConfig?: Partial<NpcMovementConfig>,
    schedules?: ScheduleEntry[],
    homes?: NpcHome[],
  ) {
    this.agents = agents;
    this.eventStore = eventStore;
    this.engine = engine;
    this.config = { ...DEFAULT_WORLD_CONFIG, ...config };
    this.resolvedILConfig = resolveILConfig(this.config.il);
    this.resolvedConversationConfig = resolveConversationConfig(this.config.conversationBehavior);
    this._gameMinute = this.config.startMinute ?? 420; // default 07:00
    this._gameSpeed = this.config.gameSpeed ?? 1;
    this._lastKnownDay = Math.floor(this._gameMinute / MINUTES_PER_DAY);
    this.callbacks = callbacks ?? {};
    this.scheduler = new ConversationScheduler(this.config);
    this.processingQueue = new ProcessingQueue((task) => this._handleTask(task));
    this.locations = locations ?? new Map();
    this.movementConfig = {
      ...DEFAULT_MOVEMENT_CONFIG,
      ...movementConfig,
      mobileNpcs: movementConfig?.mobileNpcs ?? DEFAULT_MOVEMENT_CONFIG.mobileNpcs,
    };

    // NPC homes
    this.npcHomes = new Map();
    if (homes) {
      for (const h of homes) {
        this.npcHomes.set(h.npcId, h.location);
      }
    }

    // Schedule system
    this.scheduleManager = schedules ? new ScheduleManager(schedules) : null;

    // Goal system
    this.goalManager = new GoalManager();
    if (this.callbacks.onGoalChange) {
      this.goalManager.onGoalChange = (data) => {
        const agent = this.agents.get(data.npcId);
        this.callbacks.onGoalChange?.({ ...data, npcId: data.npcId });
      };
    }

    // Install mood interceptors — captures all mood changes (engine + modules) via property setter
    this.installMoodInterceptors();
    // Install relationship change callbacks on each agent's graph
    this.installRelationshipCallbacks();
  }

  /** Intercept mood property on each agent's state to emit onMoodChange callback */
  private installMoodInterceptors(): void {
    if (!this.callbacks.onMoodChange) return;
    for (const [id, agent] of this.agents) {
      let _mood = agent.state.mood;
      const cb = this.callbacks.onMoodChange;
      const name = agent.profile.name;
      Object.defineProperty(agent.state, 'mood', {
        get: () => _mood,
        set: (v: number) => {
          const old = _mood;
          _mood = v;
          if (Math.abs(old - v) > 0.001) cb(id, name, old, v);
        },
        enumerable: true,
        configurable: true,
      });
    }
  }

  /** Resolve and cache the player Agent (isPlayer flag on profile) */
  get playerAgent(): Agent | null {
    if (!this._playerAgent) {
      for (const agent of this.agents.values()) {
        if (agent.profile.isPlayer) { this._playerAgent = agent; break; }
      }
    }
    return this._playerAgent;
  }

  /** Player location derived from player Agent state — null if no player in world */
  get playerLocation(): string | null {
    return this.playerAgent?.state.location ?? null;
  }

  /** Check if player is at the given location */
  isPlayerAt(location: string): boolean {
    const pa = this.playerAgent;
    return pa != null && pa.state.alive && pa.state.location === location;
  }

  /**
   * Feed an event into the goal system.
   * Called by the consequence engine callback and after direct events (kill, etc.)
   */
  async handleEventForGoals(event: WorldEvent): Promise<void> {
    // Reactive AL: evaluate affordances with event boost for affected NPCs
    const reactiveCtx = this.buildAffordanceContext();
    console.log(`  [ReactiveEval] event=${event.type} subj=${event.subject} obj=${event.object}`);
    const reactiveGoals = evaluateReactiveVolition(
      event, reactiveCtx,
      (npcId) => this.goalManager.getGoals(npcId).filter(g => g.state !== 'completed' && g.state !== 'failed').map(g => g.type),
    );
    if (reactiveGoals.length > 0) console.log(`  [ReactiveEval] → ${reactiveGoals.length} goals: ${reactiveGoals.map(g => `${g.ownerId}:${g.type}`).join(', ')}`);
    this.addReactiveGoalsFiltered(reactiveGoals);

    // Registry-based goal cleanup: modules declare which goals to complete per event type
    const goalsToClean = getGoalCleanupForEvent(event.type);
    for (const goalType of goalsToClean) {
      this.goalManager.completeGoalsByType(goalType);
    }

    // Belief zeroing, crime scene deactivation, and body marking are now handled
    // by module event handlers (crime-justice/event-handlers.ts) which know verdict-specific logic.
    // Engine provides: agents, crimeScenes, bodyDiscoveries via EventHandlerContext.

    // Information spread sentiment + criminal reactive goals — moved to module event handlers.
    // Engine provides triggerReactiveEvaluation callback for modules that need AL reactive evaluation.

    // Module-registered event handlers (belief creation, sentiment, state changes, reactive evaluation)
    const handlers = getEventHandlers(event.type);
    if (handlers.length > 0) {
      const handlerCtx: EventHandlerContext = {
        agents: this.agents,
        goalManager: this.goalManager,
        crimeScenes: this.crimeScenes,
        getCurrentDay: () => this.getCurrentDay(),
        bodyDiscoveries: this.bodyDiscoveries,
        triggerReactiveEvaluation: async (npcId: string, triggerEvent: WorldEvent) => {
          const modifiedEvent: WorldEvent = { ...triggerEvent, payload: { ...triggerEvent.payload, affectedTargets: [npcId] } };
          const goals = evaluateReactiveVolition(
            modifiedEvent, reactiveCtx,
            (id) => this.goalManager.getGoals(id).filter(g => g.state !== 'completed' && g.state !== 'failed').map(g => g.type),
          );
          this.addReactiveGoalsFiltered(goals);
        },
      };
      for (const handler of handlers) {
        await handler(event, handlerCtx);
      }
    }
  }

  /**
   * Add reactive goals with priority filtering: if an NPC already has a pending/active
   * reactive goal, only replace it if the new one has higher priority.
   * Prevents low-priority reactive events (gossip from RUMOR_SPREAD) from
   * overshadowing high-priority ones (report_crime from WITNESS_MEMORY).
   */
  private addReactiveGoalsFiltered(goals: NpcGoal[]): void {
    for (const goal of goals) {
      // Only add if NPC has no active/pending goal of equal or higher priority
      // (prevents low-priority reactive cascades from overshadowing higher-priority ones)
      const existingGoals = this.goalManager.getGoals(goal.ownerId);
      const higherPriorityExists = existingGoals.some(
        g => g.state !== 'completed' && g.state !== 'failed' && g.priority >= goal.priority,
      );
      if (higherPriorityExists) {
        console.log(`  [AL:reactive:skip] ${goal.ownerId} — ${goal.type}(pri=${goal.priority}) skipped, higher-priority goal exists`);
        continue;
      }
      this.goalManager.addGoal(goal);
    }
  }

  /** Get current minute of day (0-1439) from the Game Clock */
  get minuteOfDay(): number {
    return ((this._gameMinute % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  }

  /** Get current absolute game minute */
  get gameMinute(): number {
    return this._gameMinute;
  }

  /** Get current game speed (0=paused, 1=1x, 2=2x, 3=3x) */
  get gameSpeed(): number {
    return this._gameSpeed;
  }

  /** Get current time period */
  get currentPeriod(): string {
    return getTimePeriod(this.minuteOfDay);
  }

  /** Get current formatted time string (HH:MM) */
  get currentHour(): string {
    return minuteToHour(this.minuteOfDay);
  }

  // ─── Game Clock ───

  /** Start the Master Clock — advances time and triggers processing when needed */
  startMasterClock(): void {
    if (this._gameClockTimer) return;
    if (this._gameSpeed <= 0) return;
    const intervalMs = Math.round(1000 / this._gameSpeed);
    this._gameClockTimer = setInterval(() => this._onClockTick(), intervalMs);
    console.log(`  [MasterClock] Started (speed=${this._gameSpeed}x, interval=${intervalMs}ms)`);
  }

  /** Stop the Master Clock — freezes time and processing */
  stopMasterClock(): void {
    if (this._gameClockTimer) {
      clearInterval(this._gameClockTimer);
      this._gameClockTimer = null;
      console.log('  [MasterClock] Stopped');
    }
  }

  /** Set game speed and restart Master Clock if running */
  setGameSpeed(speed: number): void {
    const wasRunning = this._gameClockTimer !== null;
    this.stopMasterClock();
    this._gameSpeed = Math.max(0, Math.min(10, speed));
    if (wasRunning && this._gameSpeed > 0) {
      this.startMasterClock();
    }
  }

  /**
   * Master Clock heartbeat — called every game minute.
   * Advances time, broadcasts updates, triggers processing when needed.
   */
  private _onClockTick(): void {
    this._gameMinute++;

    try {
      this._advanceTransits();
    } catch (err) {
      console.error('  [MasterClock] _advanceTransits error:', err);
    }

    if (this._gameMinute % 1 === 0) {
      try {
        this.callbacks.onTimeUpdate?.(this.minuteOfDay, this.currentHour, this.currentPeriod, this.getCurrentDay());
      } catch (err) {
        console.error('  [MasterClock] onTimeUpdate error:', err);
      }
    }

    if (this._gameMinute % 5 === 0) {
      try {
        this._applyLonelinessDecay();
      } catch (err) {
        console.error('  [MasterClock] _applyLonelinessDecay error:', err);
      }
    }

    try {
      this._enqueueWork();
    } catch (err) {
      console.error('  [MasterClock] _enqueueWork error:', err);
    }
  }

  /**
   * Advance transit progress for all moving NPCs. Called every game minute by Master Clock.
   * On arrival: update location, clear transit, broadcast movement.
   */
  private _advanceTransits(): void {
    for (const [id, agent] of this.agents) {
      if (!agent.state.inTransit || !agent.state.transitDuration) continue;

      const elapsed = this._gameMinute - (agent.state.transitStartMinute ?? this._gameMinute);
      agent.state.transitProgress = Math.min(1, elapsed / agent.state.transitDuration);

      // Arrival
      if (agent.state.transitProgress >= 1) {
        const from = agent.state.location;
        const to = agent.state.transitTo!;
        agent.state.location = to;
        this._clearTransit(agent);
        // Reset processing state on arrival — unblock _enqueueWork checks
        agent.state.processingState = this.goalManager.hasActiveGoal(id) ? 'executing_goal' : 'idle';
        console.log(`  [Transit] ${agent.profile.name} arrived at ${to}`);

        // Broadcast arrival
        this.callbacks.onMovement?.([{
          agentId: id,
          agentName: agent.profile.name,
          from,
          to,
          arrived: true,
        }]);
      }
    }
  }

  /** Clear all transit state on an agent */
  private _clearTransit(agent: Agent): void {
    agent.state.inTransit = false;
    agent.state.transitTo = undefined;
    agent.state.transitPath = undefined;
    agent.state.transitProgress = undefined;
    agent.state.transitStartMinute = undefined;
    agent.state.transitDuration = undefined;
  }

  /** Start transit for an NPC: compute path, set duration, mark inTransit */
  startTransit(agent: Agent, targetLocation: string): boolean {
    if (agent.state.location === targetLocation) return false;
    const path = findPath(this.locations, agent.state.location, targetLocation);
    if (!path || path.length === 0) return false;

    const minutesPerHop = this.config.minutesPerHop ?? 30;
    agent.state.inTransit = true;
    agent.state.transitTo = targetLocation;
    agent.state.transitPath = path;
    agent.state.transitProgress = 0;
    agent.state.transitStartMinute = this._gameMinute;
    agent.state.transitDuration = path.length * minutesPerHop;
    return true;
  }

  /**
   * Apply loneliness mood decay to NPCs without recent social interaction.
   * Called every 5 game minutes. Rate depends on Extraversion.
   */
  private _applyLonelinessDecay(): void {
    const THRESHOLD = 30; // game minutes without interaction before decay starts
    const BASE_RATE = 0.001; // mood decay per 5 game minutes (base)

    for (const [, agent] of this.agents) {
      if (agent.profile.isPlayer) continue;
      if (!agent.state.alive) continue;
      if (isStatusAbsent(agent.state.status)) continue;

      const lastInteraction = agent.state.lastInteractionMinute ?? 0;
      const minutesSince = this._gameMinute - lastInteraction;
      if (minutesSince < THRESHOLD) continue;

      const E = agent.profile.bigFive.E;
      const rate = BASE_RATE * (E * 1.5 + 0.5);
      const oldMood = agent.state.mood;
      agent.state.mood = Math.max(-1, agent.state.mood - rate);

      // Broadcast mood change for WS overlay (only if significant)
      if (Math.abs(agent.state.mood - oldMood) > 0.0005) {
        this.callbacks.onMoodChange?.(agent.profile.id, agent.profile.name, oldMood, agent.state.mood);
      }
    }
  }

  /**
   * Enqueue async work into ProcessingQueue. Called every game minute.
   * Instant checks (schedule, night walks, random movement) run inline.
   * LLM-bound work (volition, goals, conversations) goes through queue.
   */
  private _enqueueWork(): void {
    const gm = this._gameMinute;

    // ─── Priority 0: Day advance ───
    if (Math.floor(gm / MINUTES_PER_DAY) > this._lastKnownDay) {
      this.processingQueue.enqueue({ id: `day-${gm}`, type: 'DAY_ADVANCE', priority: 0, enqueuedAt: gm });
    }

    // ─── Instant sync: schedule + night walks + random movement ───
    try {
      this._runInstantChecks();
    } catch (err) {
      console.error('  [MasterClock] _runInstantChecks error:', err instanceof Error ? err.message : err);
    }

    // ─── Priority 1: Body discovery ───
    for (const [id, agent] of this.agents) {
      if (!agent.state.alive || agent.state.inTransit || agent.state.inPlayerChat) continue;
      for (const [vid, victim] of this.agents) {
        if (victim.state.alive || victim.profile.isPlayer) continue;
        if (agent.state.location === victim.state.location) {
          const key = `${id}:${vid}`;
          if (!this.bodyDiscoveries.has(key)) {
            this.processingQueue.enqueue({ id: `body-${key}`, type: 'BODY_DISCOVERY', priority: 1, npcId: id, enqueuedAt: gm });
          }
        }
      }
    }

    // ─── Priority 2: Volition + Goal steps ───
    for (const [id, agent] of this.agents) {
      if (agent.profile.isPlayer) continue;
      if (!agent.state.alive || agent.state.inPlayerChat || agent.state.inTransit) continue;
      if (isStatusAbsent(agent.state.status)) continue;

      const ps = agent.state.processingState ?? 'idle';

      // Goal step: NPC has active goal and is not blocked
      if (this.goalManager.hasActiveGoal(id) && (ps === 'idle' || ps === 'executing_goal')) {
        this.processingQueue.enqueue({ id: `goal-${id}-${gm}`, type: 'GOAL_STEP', priority: 2, npcId: id, enqueuedAt: gm });
      }

      // Volition: NPC without high-priority goal (>4) + cooldown expired
      // Low-priority goals (schedule=3, night_walk=2) don't block volition
      if (!this.goalManager.hasActiveGoalAbove(id, 4) && ps === 'idle') {
        const expires = this.decisionCooldowns.get(id) ?? 0;
        if (gm >= expires) {
          this.processingQueue.enqueue({ id: `vol-${id}-${gm}`, type: 'VOLITION', priority: 2, npcId: id, enqueuedAt: gm });
        }
      }
    }

    // Diagnostic: log queue activity every 30 game minutes
    if (gm % 30 === 0) {
      const ql = this.processingQueue.length;
      const qp = this.processingQueue.isProcessing;
      console.log(`  [Queue:diag] ${ql} pending, processing=${qp} at ${this.currentHour} (gm=${gm})`);
    }

    // ─── Priority 3: Conversations + Phase handlers ───
    // Conversation: enqueue one best pair (scheduler handles scoring)
    this.processingQueue.enqueue({ id: `conv-${gm}`, type: 'CONVERSATION', priority: 3, enqueuedAt: gm });

    // Phase handlers: theft discovery, NPC approach, crime scene awareness
    this.processingQueue.enqueue({ id: `phase-${gm}`, type: 'PHASE_HANDLERS', priority: 3, enqueuedAt: gm });
  }

  /**
   * Instant sync checks that don't need the queue (no LLM, no async).
   * Schedule goals, night walks, random movement.
   */
  private _runInstantChecks(): void {
    const minuteOfDay = this.minuteOfDay;
    const isNpc = (agent: Agent): boolean =>
      !agent.profile.isPlayer && !agent.state.inPlayerChat && isActive(agent);

    // Schedule check
    if (this.scheduleManager) {
      for (const [id, agent] of this.agents) {
        if (!isNpc(agent)) continue;
        const entry = this.scheduleManager.getActiveEntry(id, minuteOfDay);
        agent.state.currentActivity = entry?.activity;
      }

      const npcLocations = new Map<string, string>();
      for (const [id, agent] of this.agents) {
        if (isNpc(agent)) npcLocations.set(id, agent.state.location);
      }

      const scheduleGoals = this.scheduleManager.checkSchedules(
        Array.from(this.agents.keys()).filter((id) => isNpc(this.agents.get(id)!)),
        minuteOfDay, npcLocations,
        (id) => this.goalManager.hasActiveGoal(id),
      );
      for (const goal of scheduleGoals) {
        goal.createdAtMinute = this._gameMinute;
        this.goalManager.addGoal(goal);
      }
    }

    // Night walks
    if (getTimePeriod(minuteOfDay) === 'night') {
      for (const [id, agent] of this.agents) {
        if (!isNpc(agent) || agent.state.inTransit) continue;
        if (this.goalManager.hasActiveGoal(id)) continue;
        if (agent.state.mood < -0.3 && Math.random() < Math.min(0.002, Math.abs(agent.state.mood) * 0.001)) {
          const publicLocations = Array.from(this.locations.entries())
            .filter(([, loc]) => loc.isPublic && loc.id !== agent.state.location);
          if (publicLocations.length > 0) {
            const [targetId] = publicLocations[Math.floor(Math.random() * publicLocations.length)];
            this.goalManager.addGoal({
              id: crypto.randomUUID(), type: 'night_walk', ownerId: id, priority: 2,
              state: 'pending', currentStep: 0, data: { reason: 'restless mind' },
              createdAtMinute: this._gameMinute,
              steps: [
                { action: 'move_to', location: targetId },
                { action: 'wait', ticks: 2 },
                ...(this.npcHomes.has(id) ? [{ action: 'move_to' as const, location: this.npcHomes.get(id)! }] : []),
              ],
            });
          }
        }
      }
    }

    // Random movement (transit-based) — skip NPCs at their schedule post
    if (this.locations.size > 0) {
      const excludeFromMovement = new Set<string>();
      for (const [id] of this.agents) {
        if (this.goalManager.hasActiveGoal(id)) excludeFromMovement.add(id);
      }
      if (this.scheduleManager) {
        for (const [id, agent] of this.agents) {
          if (agent.profile.isPlayer || !agent.state.alive) continue;
          const entry = this.scheduleManager.getActiveEntry(id, minuteOfDay);
          if (entry?.location && entry.location === agent.state.location) {
            excludeFromMovement.add(id);
          }
        }
      }
      const randomMovements = processMovement(
        this.agents, this.locations, this.movementConfig, excludeFromMovement,
        this._gameMinute, this.config.minutesPerHop,
      );
      for (const m of randomMovements) {
        this.callbacks.onMovement?.([m]);
      }
    }
  }

  // ─── Task Handlers (called by ProcessingQueue) ───

  private async _handleTask(task: ProcessingTask): Promise<void> {
    try {
      await this._dispatchTask(task);
    } catch (err) {
      const npcName = task.npcId ? this.agents.get(task.npcId)?.profile.name : '';
      console.error(`  [Queue:ERROR] ${task.type}${npcName ? ':' + npcName : ''} failed:`, err instanceof Error ? err.message : err);
      // Reset processingState to prevent permanent freeze
      if (task.npcId) {
        const agent = this.agents.get(task.npcId);
        if (agent) agent.state.processingState = 'idle' as any;
      }
      if (task.targetNpcId) {
        const agent = this.agents.get(task.targetNpcId);
        if (agent) agent.state.processingState = 'idle' as any;
      }
    }
  }

  private async _dispatchTask(task: ProcessingTask): Promise<void> {
    switch (task.type) {
      case 'DAY_ADVANCE':
        return this._handleDayAdvance();
      case 'BODY_DISCOVERY':
        return this._handleBodyDiscovery();
      case 'VOLITION':
        if (task.npcId) return this._handleVolition(task.npcId);
        break;
      case 'GOAL_STEP':
        if (task.npcId) return this._handleGoalStep(task.npcId);
        break;
      case 'CONVERSATION':
        return this._handleConversation();
      case 'PHASE_HANDLERS':
        return this._handlePhaseHandlers();
      case 'CONVERSATION_IMPACT':
        return this._handleConversationImpact();
    }
  }

  private async _handleConversationImpact(): Promise<void> {
    const data = this._pendingImpactQueue.shift();
    if (!data) return;

    const { conversation, topic } = data;
    const initAgent = this.agents.get(conversation.initiator);
    const respAgent = this.agents.get(conversation.responder);
    if (!initAgent || !respAgent) return;

    const bystanderIds = Array.from(this.agents.entries())
      .filter(([id, a]) => a.state.alive && a.state.location === conversation.location && id !== conversation.initiator && id !== conversation.responder)
      .map(([id]) => id);
    const allAffectedIds = [conversation.initiator, conversation.responder, ...bystanderIds];

    // ─── Deterministic impact from TopicProposal structured data (no LLM) ───
    // Trade-off: impact based on topic INTENT, not dialogue RESULT.
    // Acceptable for 9B model (topic tone matches dialogue ~80%). Revisit if upgrading to larger model.

    // 1. Mood delta from moodValence (set by module topic sources)
    const mc = this.resolvedConversationConfig.moodImpactClamp;
    const rm = this.resolvedConversationConfig.relationshipMoodModifier;
    let moodDelta = topic.moodValence ?? 0;

    if (topic.moodValence !== undefined && Math.abs(topic.moodValence) > 0.08) {
      console.warn(`  [Impact] Suspicious moodValence ${topic.moodValence} for topic "${topic.subject}"`);
    }

    // Relationship modifier from config: friends chatting → slight boost, rivals → slight dip
    const rel = initAgent.state.relationships?.getRelationship(respAgent.profile.id);
    if (rel) {
      if (rel.sentiment > rm.friendThreshold) moodDelta += rm.friendBonus;
      else if (rel.sentiment < rm.rivalThreshold) moodDelta += rm.rivalPenalty;
    }

    moodDelta = Math.max(mc.min, Math.min(mc.max, moodDelta)) + (this.config.moodBias ?? 0);

    console.log(`  [Impact:debug] ${initAgent.profile.name}↔${respAgent.profile.name}: moodValence=${topic.moodValence ?? 'undefined'}, relSentiment=${rel?.sentiment?.toFixed(2) ?? 'none'}, rmPenalty=${rm.rivalPenalty}, rmBonus=${rm.friendBonus}, delta=${moodDelta.toFixed(3)}, topic="${topic.subject}", bystanders=${bystanderIds.length}`);

    // Apply mood to participants + bystanders
    if (Math.abs(moodDelta) > 0.005) {
      for (const id of allAffectedIds) {
        const agent = this.agents.get(id);
        if (agent) agent.state.mood = Math.max(-1, Math.min(1, agent.state.mood + moodDelta));
      }
      console.log(`  [Mood] Conversation mood impact: ${moodDelta > 0 ? '+' : ''}${moodDelta.toFixed(3)} (tone: ${topic.tone})`);
    }

    // 2. Sentiment toward discussed NPC (mentionedNpcId or beliefTransfer.subject fallback)
    const valence = topic.sentimentValence;
    if (valence && Math.abs(valence) >= this.resolvedConversationConfig.sentimentValenceThreshold) {
      let discussedId = topic.mentionedNpcId;
      let discussedName: string | undefined;
      if (discussedId) {
        discussedName = this.agents.get(discussedId)?.profile.name;
      } else if (topic.beliefTransfer?.subject) {
        // Fallback: resolve NPC name → ID from beliefTransfer subject
        const entry = Array.from(this.agents.entries())
          .find(([, a]) => a.profile.name.toLowerCase() === topic.beliefTransfer!.subject!.toLowerCase());
        if (entry) { discussedId = entry[0]; discussedName = entry[1].profile.name; }
      }

      if (discussedId) {
        const vc = this.resolvedConversationConfig.sentimentValenceClamp;
        const clampedValence = Math.max(vc.min, Math.min(vc.max, valence));
        for (const id of allAffectedIds) {
          if (id === discussedId) continue;
          const agent = this.agents.get(id);
          if (agent?.state.relationships) {
            agent.state.relationships.adjustSentiment(discussedId, clampedValence);
          }
        }
        console.log(`  [Impact] ${discussedName ?? discussedId}: ${clampedValence > 0 ? '+' : ''}${clampedValence.toFixed(2)} (topic: ${topic.subject})`);
      }
    }

    // 3. Importance from topic weight (mapped to 1-8 scale)
    const rawImportance = Math.round(topic.weight * 0.7);
    const finalImportance = Math.max(
      topic.minImportance ?? 1,
      Math.min(topic.maxImportance ?? 8, Math.max(1, Math.min(8, rawImportance))),
    );
    conversation.importance = Math.max(conversation.importance, finalImportance);

    // 4. Participant memories — 3rd person beliefs + topic tone
    const topicEventType = topic.beliefTransfer?.eventType;
    const respBeliefs3p = respAgent.state.beliefs?.summarizeForMemory(respAgent.profile.name, 1, topicEventType) ?? '';
    const initBeliefs3p = initAgent.state.beliefs?.summarizeForMemory(initAgent.profile.name, 1, topicEventType) ?? '';
    await initAgent.observe(
      buildMemoryText(respAgent.profile.name, topic.subject, topic.tone, respBeliefs3p, respAgent.state.mood),
      conversation.importance,
    );
    await respAgent.observe(
      buildMemoryText(initAgent.profile.name, topic.subject, topic.tone, initBeliefs3p, initAgent.state.mood),
      conversation.importance,
    );

    // 5. Bystander overhear
    await this.processOverhear(conversation, conversation.importance, topic);
  }

  private async _handleDayAdvance(): Promise<void> {
    const currentDay = Math.floor(this._gameMinute / MINUTES_PER_DAY);
    while (currentDay > this._lastKnownDay) {
      const { newDay } = await this.advanceDay();
      this._lastKnownDay++;
      console.log(`  [Time] New day: ${newDay}`);
    }
  }

  private async _handleBodyDiscovery(): Promise<void> {
    console.log('  [Queue] _handleBodyDiscovery called');
    await this.checkBodyDiscovery();
  }

  private async _handleVolition(npcId: string): Promise<void> {
    const agent = this.agents.get(npcId);
    if (!agent || !agent.state.alive || agent.state.inPlayerChat || agent.state.inTransit) return;
    if (isStatusAbsent(agent.state.status)) return;
    if (this.goalManager.hasActiveGoal(npcId)) return; // got a goal while waiting in queue

    agent.state.processingState = 'awaiting_decision';
    const ctx = this.buildAffordanceContext();

    const goals = await evaluateAllVolition(ctx, this.callbacks.onLlmCall, this.callbacks.onDecision, [npcId]);
    for (const goal of goals) {
      this.goalManager.addGoal(goal);
    }
    // Set decision cooldown even if no affordances passed — prevents per-minute re-evaluation spam
    if (!this.decisionCooldowns.has(npcId) || this._gameMinute >= (this.decisionCooldowns.get(npcId) ?? 0)) {
      this.decisionCooldowns.set(npcId, this._gameMinute + (this.config.decisionCooldownMinutes ?? 60));
    }
    agent.state.processingState = this.goalManager.hasActiveGoal(npcId) ? 'executing_goal' : 'idle';
  }

  private async _handleGoalStep(npcId: string): Promise<void> {
    const agent = this.agents.get(npcId);
    if (!agent || agent.profile.isPlayer || agent.state.inPlayerChat) return;
    if (!agent.state.alive || isStatusAbsent(agent.state.status)) return;
    if (!this.goalManager.hasActiveGoal(npcId)) { agent.state.processingState = 'idle'; return; }

    agent.state.processingState = 'executing_goal';
    const interactionRunner = createInteractionRunner(this.eventStore, {
      onLine: this.callbacks.onLine, locations: this.locations,
      onExtraEvent: async (event) => {
        const results = await this.processCascade(event);
        await this.handleEventForGoals(event);
        for (const r of results) await this.handleEventForGoals(r.event);
      },
    });

    const crimeHandler = async (crimeData: { type: string; subject: string; object?: string; location: string; importance: number; payload: Record<string, unknown> }) => {
      const crimeEvent: WorldEvent = {
        id: crypto.randomUUID(), type: crimeData.type as WorldEvent['type'],
        subject: crimeData.subject, object: crimeData.object,
        location: crimeData.location, gameDay: this.getCurrentDay(),
        importance: crimeData.importance,
        payload: { ...crimeData.payload, sourceEvent: 'goal_execution' },
      };
      this.eventStore.append(crimeEvent);
      const sceneWitnesses = Array.from(this.agents.entries())
        .filter(([wid, a]) => wid !== crimeData.object && a.state.alive && a.state.location === crimeData.location)
        .map(([wid]) => wid);
      const sceneType = getSceneTypeForEvent(crimeData.type);
      if (sceneType) this.markCrimeScene(crimeData.location, sceneType, crimeData.subject, crimeData.object, sceneWitnesses, crimeData.type);
      if (isDeathEvent(crimeData.type) && crimeData.object) {
        this.callbacks.onMurder?.(crimeData.subject, crimeData.object,
          crimeData.payload.suspectName as string, crimeData.payload.victimName as string);
      }
      const elCtx: EvidenceContext = { event: crimeEvent, agents: this.agents, crimeScenes: this.crimeScenes };
      this.evidence.generate(crimeEvent, elCtx);
      const results = await this.processCascade(crimeEvent);
      await this.handleEventForGoals(crimeEvent);
      for (const r of results) await this.handleEventForGoals(r.event);
    };

    // Goal step chaining: non-LLM steps execute instantly in sequence
    let chainCount = 0;
    const MAX_CHAIN = 10;
    do {
      const action = await this.goalManager.processGoalTick(
        npcId, this.agents, this.locations, interactionRunner,
        crimeHandler, this.crimeScenes, this.evidence,
      );
      if (!action) break;
      this.callbacks.onGoalAction?.(action);

      if (action.goalCompleted && action.isRoutine) this.scheduleManager?.clearScheduleGoal(action.ownerId);
      if (action.goalCompleted && !action.isRoutine) {
        const owner = this.agents.get(action.ownerId);
        if (owner?.state.alive) {
          owner.state.mood = Math.min(1, owner.state.mood + getGoalMoodBoost(action.goalType));
        }
      }
      if (action.movement) {
        const movingAgent = this.agents.get(action.ownerId);
        if (movingAgent?.state.inTransit && !movingAgent.state.transitStartMinute) {
          const hops = movingAgent.state.transitPath?.length ?? 1;
          movingAgent.state.transitStartMinute = this._gameMinute;
          movingAgent.state.transitDuration = hops * (this.config.minutesPerHop ?? 30);
        }
        this.callbacks.onMovement?.([action.movement]);
      }

      // Track interaction for loneliness decay
      if (action.interaction) {
        agent.state.lastInteractionMinute = this._gameMinute;
        const target = this.agents.get(action.interaction.targetId);
        if (target) target.state.lastInteractionMinute = this._gameMinute;
      }

      if (action.goalCompleted) break;
      if (agent.state.inTransit) { agent.state.processingState = 'in_transit'; break; }
      if (action.action === 'interact' || action.action === 'interact_present') break;
      if (action.action === 'wait') break; // wait is a blocking step — don't chain
      chainCount++;
    } while (chainCount < MAX_CHAIN && this.goalManager.hasActiveGoal(npcId));

    // Update processing state
    if (!this.goalManager.hasActiveGoal(npcId)) agent.state.processingState = 'idle';
    else if (agent.state.inTransit) agent.state.processingState = 'in_transit';
    else agent.state.processingState = 'executing_goal';
  }

  private async _handleConversation(): Promise<void> {
    const npcsWithGoals = new Set<string>();
    for (const [id] of this.agents) {
      const goal = this.goalManager.getActiveGoal(id);
      if (!goal) continue;
      // NPCs in 'wait' steps are standing still — eligible for conversation
      const currentStep = goal.steps[goal.currentStep];
      if (currentStep?.action === 'wait') continue;
      npcsWithGoals.add(id);
    }

    const pair = await this.scheduler.findPair(this.agents, this._gameMinute, npcsWithGoals);
    if (!pair) return;

    const initiator = this.agents.get(pair.a)!;
    const responder = this.agents.get(pair.b)!;
    initiator.state.processingState = 'in_conversation';
    responder.state.processingState = 'in_conversation';

    try {
      const period = getTimePeriod(this.minuteOfDay);
      const gameDay = this.getCurrentDay();
      const topic = this.topicEngine.selectTopic(initiator, responder, gameDay, period, initiator.state.location, this.playerAgent ?? undefined);

      this.callbacks.onLlmCall?.('Conversation', `${initiator.profile.name} ↔ ${responder.profile.name} [${topic.subject}]`);
      const conversation = await runConversation(initiator, responder, this.eventStore, this.config, topic,
        { onLine: this.callbacks.onLine, agents: this.agents, locations: this.locations });
      conversation.topic = topic.subject;
      conversation.topicGroup = getTopicGroup(topic.category);
      this.callbacks.onConversation?.(conversation);

      // Belief transfer
      if (topic.beliefTransfer) {
        const bt = topic.beliefTransfer;
        const initBelief = initiator.state.beliefs?.getAllBeliefs().find(
          b => b.eventType === bt.eventType && b.object === (bt.object ?? b.object));
        if (initBelief && responder.state.beliefs) {
          const conf = Math.max(0.25, initBelief.confidence * bt.confidenceMultiplier);
          responder.state.beliefs.addBelief({
            id: crypto.randomUUID(), eventType: bt.eventType, subject: initBelief.subject,
            object: initBelief.object, location: initBelief.location, confidence: conf,
            source: 'rumor', sourceNpcId: initiator.profile.id, gameDay, lastUpdated: gameDay,
          });
        }
        const respBelief = responder.state.beliefs?.getAllBeliefs().find(
          b => b.eventType === bt.eventType && b.object === (bt.object ?? b.object));
        if (respBelief && initiator.state.beliefs) {
          const conf = Math.max(0.25, respBelief.confidence * bt.confidenceMultiplier);
          initiator.state.beliefs.addBelief({
            id: crypto.randomUUID(), eventType: bt.eventType, subject: respBelief.subject,
            object: respBelief.object, location: respBelief.location, confidence: conf,
            source: 'rumor', sourceNpcId: responder.profile.id, gameDay, lastUpdated: gameDay,
          });
        }
      }

      // Enqueue impact analysis as separate queue task (sequential, no race with other LLM tasks)
      const convCopy = { ...conversation };
      const topicCopy = { ...topic };
      // Unique composite npcId prevents dedup collision when same NPC has multiple conversations
      this.processingQueue.enqueue({
        id: `impact-${pair.a}-${pair.b}-${this._gameMinute}`,
        type: 'CONVERSATION_IMPACT' as any,
        priority: 3,
        npcId: `${pair.a}:impact:${this._gameMinute}`,
        enqueuedAt: this._gameMinute,
      });
      // Store impact data for the handler
      this._pendingImpactQueue.push({ conversation: convCopy, topic: topicCopy });

      // Track social interaction for loneliness decay
      initiator.state.lastInteractionMinute = this._gameMinute;
      responder.state.lastInteractionMinute = this._gameMinute;
    } finally {
      initiator.state.processingState = 'idle';
      responder.state.processingState = 'idle';
    }
  }

  private async _handlePhaseHandlers(): Promise<void> {
    const approachEvents: import('./world-types').ApproachEvent[] = [];
    const tickCtx = {
      agents: this.agents, eventStore: this.eventStore,
      currentDay: this.getCurrentDay(), gameMinute: this._gameMinute,
      processEvent: async (event: WorldEvent) => {
        const results = await this.processCascade(event);
        await this.handleEventForGoals(event);
        for (const r of results) await this.handleEventForGoals(r.event);
      },
      discoveries: this.bodyDiscoveries, approaches: approachEvents,
      crimeScenes: this.crimeScenes, locations: this.locations,
      goalManager: this.goalManager, npcHomes: this.npcHomes,
    };
    for (const handler of getTickPhaseHandlers()) await handler(tickCtx);
    if (approachEvents.length > 1) {
      approachEvents.sort((a, b) => b.urgency - a.urgency);
      approachEvents.length = 1;
    }
    // Broadcast approach events
    if (approachEvents.length > 0) {
      this.callbacks.onTick?.({
        tickNumber: this.tickCount, gameMinute: this._gameMinute, gameDay: this.getCurrentDay(),
        conversation: null, approaches: approachEvents,
      });
    }
  }

  /** Debug: force one processing cycle. Enqueues work and waits for queue to drain. */
  async tick(): Promise<TickResult> {
    this._enqueueWork();
    // Wait for queue to finish processing all enqueued tasks
    await new Promise<void>((resolve) => {
      if (!this.processingQueue.isProcessing && this.processingQueue.length === 0) {
        resolve();
        return;
      }
      const check = setInterval(() => {
        if (!this.processingQueue.isProcessing && this.processingQueue.length === 0) {
          clearInterval(check);
          resolve();
        }
      }, 50);
    });
    return {
      tickNumber: this.tickCount,
      gameMinute: this._gameMinute,
      gameDay: this.getCurrentDay(),
      time: this.scheduleManager?.getTimeInfo(this.minuteOfDay),
      conversation: null,
    };
  }

  // _tick() removed — all processing now via ProcessingQueue task handlers.
  // Master Clock enqueues tasks, queue processes them one at a time.

  /**
   * NPCs at the same location as a conversation may overhear fragments.
   * ~60% chance per bystander. Importance reduced by 1 from LLM-assessed value.
   * Also transfers beliefs at reduced confidence (overheard = weaker than direct).
   */
  private async processOverhear(
    conversation: ConversationResult,
    finalImportance: number,
    topic: import('./topic-engine').TopicProposal,
  ): Promise<void> {
    const { initiator: initId, responder: respId, location, lines } = conversation;
    if (lines.length === 0) return;

    const overheardImportance = Math.max(finalImportance - 1, 2);
    const initiator = this.agents.get(initId);
    const initiatorName = lines[0]?.speakerName ?? 'someone';
    const responderName = lines[1]?.speakerName ?? 'someone';

    for (const [id, agent] of this.agents) {
      if (id === initId || id === respId) continue;
      if (!isPresent(agent)) continue;
      if (agent.state.location !== location) continue;
      if (Math.random() > 0.6) continue;

      // Belief transfer from overheard conversation (weaker than direct: ×0.3)
      let overheardClaim = '';
      if (topic.beliefTransfer && initiator && agent.state.beliefs) {
        const bt = topic.beliefTransfer;
        const sourceBelief = initiator.state.beliefs?.getAllBeliefs().find(
          b => b.eventType === bt.eventType && b.object === (bt.object ?? b.object),
        );
        if (sourceBelief) {
          const verb = getEventLabel(sourceBelief.eventType) ?? 'something';
          overheardClaim = ` Picked up that ${sourceBelief.subject ?? 'someone'} may be involved in ${verb}.`;
          const conf = Math.max(0.2, sourceBelief.confidence * 0.3);
          agent.state.beliefs.addBelief({
            id: crypto.randomUUID(),
            eventType: bt.eventType,
            subject: sourceBelief.subject,
            object: sourceBelief.object,
            location: sourceBelief.location,
            confidence: conf,
            source: 'rumor',
            sourceNpcId: initId,
            gameDay: conversation.gameDay,
            lastUpdated: conversation.gameDay,
          });
          console.log(`  [Overhear] ${agent.profile.name} overheard about ${bt.eventType} (conf ${conf.toFixed(2)})`);
        }
      }

      // Structured memory with belief context (no raw dialogue)
      await agent.observe(
        `Overheard ${initiatorName} and ${responderName} discussing ${topic.subject}.${overheardClaim}`,
        overheardImportance,
      );
    }
  }

  // analyzeConversationImpact removed — replaced by deterministic computation in _handleConversationImpact
  // Mood/sentiment now derived from TopicProposal structured data (tone, weight, beliefTransfer)
  // Eliminates: LLM hallucinated mentions, negative mood bias, 2-4s latency per conversation

  // Legacy checkMurderMotivation + askMurderDecision removed — replaced by AL volition `kill` affordance

  /**
   * Check if any alive NPC is at a location with a dead NPC they haven't discovered yet.
   * Creates BODY_DISCOVERED event → cascades to WITNESS_MEMORY → existing rules handle rest.
   */
  private async checkBodyDiscovery(): Promise<void> {
    const bodyDiscoveryType = getBodyDiscoveryEventType();
    if (!bodyDiscoveryType) return; // no module registered body discovery events

    // Build location → dead NPCs map
    const deadByLocation = new Map<string, Array<{ id: string; agent: Agent }>>();
    for (const [id, agent] of this.agents) {
      if (!agent.state.alive) {
        const loc = agent.state.location;
        if (!deadByLocation.has(loc)) deadByLocation.set(loc, []);
        deadByLocation.get(loc)!.push({ id, agent });
      }
    }

    if (deadByLocation.size === 0) return;

    // Shared context across all discoveries this tick — prevents duplicate WITNESS_MEMORY
    const sharedCtx: import('./cg-engine').WorldContext = {
      ...this.buildCgContext(),
      witnessIds: new Set(),
    };

    for (const [id, agent] of this.agents) {
      if (!isPresent(agent)) continue;

      const deadHere = deadByLocation.get(agent.state.location);
      if (!deadHere) continue;

      for (const dead of deadHere) {
        const key = `${id}:${dead.id}`;
        if (this.bodyDiscoveries.has(key)) continue;

        // This NPC just discovered a body!
        this.bodyDiscoveries.add(key);

        const victimName = dead.agent.profile.name;
        // Find crime scene for this victim to get eventType
        const victimScene = Array.from(this.crimeScenes.values()).flat()
          .find(s => s.victimId === dead.id && s.active);
        const deathEventType = victimScene?.eventType ?? victimScene?.crimeType;

        // BODY_DISCOVERED represents what the discoverer knows:
        // victim identity + location. suspectName unknown.
        const discoveryEvent: WorldEvent = {
          id: crypto.randomUUID(),
          type: bodyDiscoveryType!,
          subject: id,
          object: dead.id,
          location: agent.state.location,
          gameDay: this.getCurrentDay(),
          importance: 8,
          payload: {
            discoveredBy: agent.profile.name,
            victimName,
            suspectName: null,
          },
        };

        this.eventStore.append(discoveryEvent);

        // Module-registered handler processes discoverer's response (memory, mood, belief, grief)
        try {
          const discoveryHandler = getDiscoveryHandler(bodyDiscoveryType!);
          if (discoveryHandler) {
            await discoveryHandler({
              discoverer: agent,
              victimId: dead.id,
              victimName,
              location: agent.state.location,
              gameDay: this.getCurrentDay(),
              deathEventType: deathEventType ?? null,
            });
          }
        } catch (err) {
          console.error(`  [Discovery:ERROR] Handler failed for ${agent.profile.name}:`, err instanceof Error ? err.message : err);
        }
        // Mark discoverer as already witnessed (so cascade skips them)
        sharedCtx.witnessIds!.add(id);

        // Process through consequence engine with shared ctx (dedup witnesses)
        try {
          const results = await this.engine.process(discoveryEvent, sharedCtx);
          if (results.length > 0 && this.callbacks.onCascade) {
            this.callbacks.onCascade(discoveryEvent, results.map(r => r.event));
          }

          // Feed into goal system — creates reactive goals
          await this.handleEventForGoals(discoveryEvent);
          for (const r of results) {
            await this.handleEventForGoals(r.event);
          }
        } catch (err) {
          console.error(`  [Discovery:ERROR] Cascade/reactive failed for ${agent.profile.name}:`, err instanceof Error ? err.message : err);
        }

        // No solo WITNESS_MEMORY needed — discoverer already has body_discovery belief (conf 0.7)
        // which satisfies hasWitnessBelief for proactive AL (testify/report_crime).
        // Creating WITNESS_MEMORY here caused bogus WANTED_STATUS via CG cascade
        // (subject=discoverer instead of subject=suspect).

        console.log(`  [Discovery] ${agent.profile.name} found the body of ${victimName} at ${agent.state.location}`);
      }
    }
  }

  /** Advance one game day for all agents + spread rumors */
  async advanceDay(): Promise<{ newDay: number; rumorResults: any[] }> {
    let newDay = 0;
    for (const [, agent] of this.agents) {
      newDay = agent.advanceDay();
      // Decay beliefs slightly each day
      agent.state.beliefs?.decayBeliefs(newDay);
      // Mood natural recovery: drift 20% toward personality baseline each day
      // baseline ≈ 0.3 - N*0.4 + E*0.2 (neurotic → lower, extraverted → higher)
      if (agent.state.alive) {
        const bf = agent.profile.bigFive;
        const baseline = 0.3 - bf.neuroticism * 0.4 + bf.extraversion * 0.2;
        agent.state.mood += (baseline - agent.state.mood) * 0.2;
      }
    }

    // Reset daily conversation tracking
    this.scheduler.resetDailyCounts();

    // Run module-registered day advance handlers (e.g., rumor spreading)
    const dayCtx = {
      agents: this.agents,
      currentDay: newDay,
      eventStore: this.eventStore,
      onEvent: this.callbacks.onTick ? (e: WorldEvent) => {
        this.eventStore.append(e);
      } : undefined,
      publicPlaces: this.config.publicPlaces || new Set<string>(),
    };
    for (const handler of getDayAdvanceHandlers()) {
      await handler(dayCtx);
    }

    return { newDay, rumorResults: [] };
  }

  /**
   * Create a crime scene at a location.
   * Called automatically from processKill; can also be called directly for robberies, assaults, etc.
   */
  markCrimeScene(
    locationId: string,
    crimeType: string,
    perpetratorId?: string,
    victimId?: string,
    witnessIds?: string[],
    eventType?: string,
  ): CrimeScene {
    const perpetrator = perpetratorId ? this.agents.get(perpetratorId) : undefined;
    const victim = victimId ? this.agents.get(victimId) : undefined;

    const scene = createCrimeScene(
      locationId,
      crimeType,
      this.getCurrentDay(),
      this._gameMinute,
      perpetrator,
      victim,
      witnessIds,
    );

    scene.eventType = eventType ?? crimeType;

    const existing = this.crimeScenes.get(locationId) ?? [];
    existing.push(scene);
    this.crimeScenes.set(locationId, existing);

    console.log(`  [CrimeScene] ${crimeType} at ${locationId} — ${scene.points.length} examination points`);
    this.callbacks.onCrimeScene?.(scene);

    return scene;
  }

  /**
   * Crime scene awareness moved to module tick phase handler (crime-justice/index.ts).
   * Engine provides crimeScenes + locations in TickPhaseContext.
   */

  /** Process a kill event through the consequence engine.
   *  killerId is optional — defaults to 'player'. Pass NPC id for NPC-on-NPC kills.
   *  eventType is the event type string registered by modules (e.g. 'NPC_KILLED'). */
  async processKill(victimId: string, killerId?: string, eventType?: string): Promise<{ killEvent: WorldEvent; results: any[] }> {
    const victim = this.agents.get(victimId);
    if (!victim || !victim.state.alive) {
      throw new Error(`Cannot kill ${victimId}: not found or already dead`);
    }

    const killer = killerId ? this.agents.get(killerId) : null;
    const playerAgent = this.playerAgent;
    const killerSubject = killerId ?? playerAgent?.profile.id ?? 'unknown';
    const suspectName = killer ? killer.profile.name : (playerAgent?.profile.name ?? 'unknown');

    victim.state.alive = false;
    victim.state.mood = -1;
    this._clearTransit(victim); // Cancel movement
    // Cancel all goals for dead NPC
    for (const g of this.goalManager.getGoals(victimId)) {
      if (g.state === 'pending' || g.state === 'active') g.state = 'failed';
    }

    const resolvedEventType = eventType ?? getDefaultDeathEvent();
    if (!resolvedEventType) {
      throw new Error('No death event type registered. Register via registerDeathEvents() in your module.');
    }

    const killEvent: WorldEvent = {
      id: crypto.randomUUID(),
      type: resolvedEventType,
      subject: killerSubject,
      object: victimId,
      location: victim.state.location,
      gameDay: this.getCurrentDay(),
      importance: 9,
      payload: {
        suspectName,
        killerRole: killer?.profile.role,
        victimName: victim.profile.name,
        victimRole: victim.profile.role,
      },
    };

    this.eventStore.append(killEvent);

    // Mark witnesses at the scene as already having "discovered" the body
    for (const [id, agent] of this.agents) {
      if (id === victimId) continue;
      if (!isPresent(agent)) continue;
      if (agent.state.location === victim.state.location) {
        this.bodyDiscoveries.add(`${id}:${victimId}`);
      }
    }

    // Create crime scene at the murder location
    const witnessIds = Array.from(this.agents.entries())
      .filter(([id, a]) => id !== victimId && id !== killerId && a.state.alive && a.state.location === victim.state.location)
      .map(([id]) => id);
    const killSceneType = getSceneTypeForEvent(resolvedEventType);
    if (killSceneType) {
      this.markCrimeScene(victim.state.location, killSceneType, killerId, victimId, witnessIds, resolvedEventType);
    }

    // Generate structured evidence at the crime scene
    const elCtx: EvidenceContext = { event: killEvent, agents: this.agents, crimeScenes: this.crimeScenes };
    this.evidence.generate(killEvent, elCtx);

    // Process consequences (CG cascade: WITNESS_MEMORY, RUMOR_SPREAD, etc.)
    const results = await this.processCascade(killEvent);

    // Feed the kill event + all consequence events into goal/reactive evaluation
    await this.handleEventForGoals(killEvent);
    for (const r of results) {
      await this.handleEventForGoals(r.event);
    }

    return { killEvent, results };
  }


  /** Whether the Master Clock is running (time flowing + processing triggered) */
  get isAutoTicking(): boolean {
    return this._gameClockTimer !== null;
  }

  /** Await queue drain. Call before save. */
  async flushPending(): Promise<void> {
    if (this.processingQueue.isProcessing || this.processingQueue.length > 0) {
      await new Promise<void>((resolve) => {
        const check = setInterval(() => {
          if (!this.processingQueue.isProcessing && this.processingQueue.length === 0) {
            clearInterval(check);
            resolve();
          }
        }, 50);
      });
    }
  }

  /** Build AffordanceContext for external use (IL goalCreator, debug, etc.) */
  buildAffordanceContext(): AffordanceContext {
    return {
      agents: this.agents,
      locations: this.locations,
      npcHomes: this.npcHomes,
      period: this.currentPeriod as AffordanceContext['period'],
      gameDay: this.getCurrentDay(),
      gameMinute: this._gameMinute,
      playerLocation: this.playerLocation ?? undefined,
      hasActiveGoal: (id) => this.goalManager.hasActiveGoal(id),
      hasActiveGoalAbove: (id, minPriority) => this.goalManager.hasActiveGoalAbove(id, minPriority),
      cooldowns: this.affordanceCooldowns,
      decisionCooldowns: this.decisionCooldowns,
      affordanceCooldownMinutes: this.config.affordanceCooldownMinutes,
      decisionCooldownMinutes: this.config.decisionCooldownMinutes,
      isArrestTarget: (npcId) => this.goalManager.isTargetOfGoalType(npcId, 'arrest'),
      isPairOnCooldown: (a, b) => this.scheduler.isOnCooldown(a, b, this._gameMinute),
    };
  }

  /** Build WorldContext for ConsequenceEngine.process() */
  private buildCgContext(): import('./cg-engine').WorldContext {
    return { agents: this.agents, publicPlaces: this.config.publicPlaces || new Set() };
  }

  /** Install onChange callbacks on each agent's RelationshipGraph */
  private installRelationshipCallbacks(): void {
    if (!this.callbacks.onRelationshipChange) return;
    for (const [id, agent] of this.agents) {
      if (!agent.state.relationships) continue;
      const cb = this.callbacks.onRelationshipChange;
      const name = agent.profile.name;
      agent.state.relationships.onChange = (targetId, targetName, field, oldVal, newVal) => {
        cb(id, name, targetId, targetName, field, oldVal, newVal);
      };
    }
  }

  /** Process CG cascade and emit onCascade callback */
  private async processCascade(event: WorldEvent): Promise<{ event: WorldEvent; rule: string }[]> {
    const results = await this.engine.process(event, this.buildCgContext());
    if (results.length > 0 && this.callbacks.onCascade) {
      this.callbacks.onCascade(event, results.map(r => r.event));
    }
    return results;
  }

  private getCurrentDay(): number {
    for (const [, agent] of this.agents) {
      return agent.state.currentDay;
    }
    return 1;
  }

  /** Serializable snapshot of world state */
  /** Debug: evaluate affordances for an NPC without calling LLM */
  debugVolition(npcId: string): { id: string; passed: boolean; score?: number; target?: string; targetLocation?: string; wouldAppear?: boolean }[] {
    const agent = this.agents.get(npcId);
    if (!agent) return [];

    const ctx = this.buildAffordanceContext();

    const results: { id: string; passed: boolean; score?: number; target?: string; targetLocation?: string; wouldAppear?: boolean }[] = [];
    for (const aff of AFFORDANCE_REGISTRY) {
      const target = checkRequirements(aff, npcId, agent, ctx);
      if (!target) {
        results.push({ id: aff.id, passed: false });
        continue;
      }
      const score = computeUtility(aff, agent, target);
      results.push({
        id: aff.id, passed: true, score: +score.toFixed(3),
        target: target.targetName, targetLocation: target.targetLocation,
        wouldAppear: score >= 0.3,
      });
    }
    return results;
  }

  toJSON(): {
    tickCount: number;
    gameMinute: number;
    gameSpeed: number;
    affordanceCooldowns: Record<string, Record<string, number>>;
    decisionCooldowns: Record<string, number>;
    bodyDiscoveries: string[];
    crimeScenes: Record<string, import('./world-types').CrimeSceneJSON[]>;
    journal: import('./journal').JournalEntry[] | { entries: import('./journal').JournalEntry[]; suspects: string[] };
    goals: Record<string, import('./goals').NpcGoal[]>;
    topicEngine: object;
    agents: Record<string, {
      alive: boolean;
      status: import('./agent-types').NpcStatus;
      location: string;
      mood: number;
      currentDay: number;
      knownFacts: string[];
      beliefs: import('./beliefs').Belief[];
      relationships: import('./relationships').Relationship[];
    }>;
  } {
    const agents: Record<string, any> = {};
    for (const [id, agent] of this.agents) {
      agents[id] = {
        alive: agent.state.alive,
        status: agent.state.status ?? null,
        location: agent.state.location,
        mood: agent.state.mood,
        currentDay: agent.state.currentDay,
        knownFacts: agent.state.knownFacts,
        beliefs: agent.state.beliefs?.toJSON() ?? [],
        relationships: agent.state.relationships?.toJSON() ?? [],
        currentMotive: agent.state.currentMotive,
      };
    }

    // Serialize crime scenes (Set → array)
    const crimeScenes: Record<string, import('./world-types').CrimeSceneJSON[]> = {};
    for (const [locId, scenes] of this.crimeScenes) {
      crimeScenes[locId] = scenes.map((s) => ({
        ...s,
        noticedBy: Array.from(s.noticedBy),
      }));
    }

    return {
      tickCount: this.tickCount,
      gameMinute: this._gameMinute,
      gameSpeed: this._gameSpeed,
      affordanceCooldowns: Object.fromEntries(
        Array.from(this.affordanceCooldowns.entries()).map(([npcId, map]) =>
          [npcId, Object.fromEntries(map.entries())]),
      ),
      decisionCooldowns: Object.fromEntries(this.decisionCooldowns.entries()),
      bodyDiscoveries: Array.from(this.bodyDiscoveries),
      crimeScenes,
      evidence: this.evidence.toJSON(),
      journal: this.journal.toJSON(),
      goals: this.goalManager.toJSON(),
      topicEngine: this.topicEngine.toJSON(),
      agents,
    };
  }

  /** Restore world state from a saved snapshot */
  loadState(data: ReturnType<World['toJSON']>): void {
    this.tickCount = data.tickCount;
    // Backward compat: old saves without gameMinute → derive from tickCount (1 tick = 15 min)
    this._gameMinute = (data as any).gameMinute ?? (data.tickCount * 15);
    this._gameSpeed = (data as any).gameSpeed ?? 1;
    this._lastKnownDay = Math.floor(this._gameMinute / MINUTES_PER_DAY);
    // Restore cooldowns
    this.affordanceCooldowns.clear();
    if ((data as any).affordanceCooldowns) {
      for (const [npcId, map] of Object.entries((data as any).affordanceCooldowns as Record<string, Record<string, number>>)) {
        this.affordanceCooldowns.set(npcId, new Map(Object.entries(map)));
      }
    }
    this.decisionCooldowns.clear();
    if ((data as any).decisionCooldowns) {
      for (const [npcId, expiresAt] of Object.entries((data as any).decisionCooldowns as Record<string, number>)) {
        this.decisionCooldowns.set(npcId, expiresAt);
      }
    }
    this.bodyDiscoveries = new Set(data.bodyDiscoveries);
    this.goalManager.loadFromJSON(data.goals);

    // Restore crime scenes (array → Set)
    this.crimeScenes.clear();
    if (data.crimeScenes) {
      for (const [locId, scenes] of Object.entries(data.crimeScenes)) {
        this.crimeScenes.set(
          locId,
          scenes.map((s) => ({ ...s, noticedBy: new Set(s.noticedBy) })),
        );
      }
    }

    // Restore evidence layer
    if ((data as any).evidence) {
      (this as any).evidence = EvidenceLayer.fromJSON((data as any).evidence);
    }

    // Restore topic engine state
    if ((data as any).topicEngine) {
      this.topicEngine.loadState((data as any).topicEngine);
    }

    // Restore player journal
    if (data.journal) {
      const restored = PlayerJournal.fromJSON(data.journal);
      (this as any).journal = restored;
    }

    for (const [id, saved] of Object.entries(data.agents)) {
      const agent = this.agents.get(id);
      if (!agent) continue;
      agent.state.alive = saved.alive;
      agent.state.status = (saved as any).status === 'free' ? undefined : ((saved as any).status ?? undefined);
      agent.state.location = saved.location;
      agent.state.mood = saved.mood;
      agent.state.currentDay = saved.currentDay;
      agent.state.knownFacts = saved.knownFacts;

      agent.state.beliefs = BeliefManager.fromJSON(saved.beliefs);
      agent.state.relationships = RelationshipGraph.fromJSON(saved.relationships);
      agent.state.currentMotive = (saved as any).currentMotive;
    }
  }
}
