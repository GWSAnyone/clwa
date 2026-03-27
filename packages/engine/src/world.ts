import { Agent, llmSemaphore } from './agent';
import { llmCall } from './llm-client';
import type { LlmJsonSchema } from './llm-client';
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
import { EvidenceLayer } from './evidence';
import type { EvidenceContext } from './evidence';
import { isEventCategory, getGoalCleanupForEvent, getSceneTypeForEvent, isDeathEvent, getDefaultDeathEvent, getEventHandlers, isStatusActive, isStatusAbsent, getGoalMoodBoost, getBodyDiscoveryEventType, getDiscoveryHandler, getTickPhaseHandlers, getDayAdvanceHandlers, isTransferable, getSecretEventType } from './event-registry';
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

/** Build conversation impact schema with NPC names enum — prevents hallucinated names */
function buildConversationImpactSchema(npcNames: string[]): LlmJsonSchema {
  return {
    name: 'conversation_impact',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        mentions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              npc_name: { type: 'string', enum: npcNames },
              valence: { type: 'number' },
              reason: { type: 'string' },
            },
            required: ['npc_name', 'valence', 'reason'],
            additionalProperties: false,
          },
        },
        mood_impact: { type: 'number' },
        importance: { type: 'number' },
        secret_revealed: { type: 'string' },
      },
      required: ['mentions', 'mood_impact', 'importance', 'secret_revealed'],
      additionalProperties: false,
    },
  };
};

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
  /** Prevent concurrent tick execution */
  private tickInProgress = false;
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
  /** Pending async conversation impact analysis — awaited at start of next tick + on save */
  private _pendingImpact: Promise<void> | null = null;

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
    const reactiveCtx: AffordanceContext = {
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
      affordanceCooldownMinutes: this.config.affordanceCooldownMinutes,
    };
    const reactiveGoals = evaluateReactiveVolition(
      event, reactiveCtx,
      (npcId) => this.goalManager.getGoals(npcId).filter(g => g.state !== 'completed' && g.state !== 'failed').map(g => g.type),
    );
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

    // Advance NPC transit progress (time-based, independent of processing)
    this._advanceTransits();

    // Broadcast time update every 5 game minutes (throttle at high speeds)
    if (this._gameMinute % 5 === 0) {
      const currentDay = Math.floor(this._gameMinute / MINUTES_PER_DAY);
      this.callbacks.onTimeUpdate?.(this.minuteOfDay, this.currentHour, this.currentPeriod, currentDay);
    }

    // Trigger processing if needed and not already running
    if (!this.tickInProgress && this._needsProcessing()) {
      this.tickInProgress = true;
      this._tick()
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[MasterClock] Processing error: ${msg}`);
        })
        .finally(() => {
          this.tickInProgress = false;
          // Check again — state may have changed during processing
          if (this._gameClockTimer && this._needsProcessing()) {
            setTimeout(() => {
              if (!this.tickInProgress && this._needsProcessing()) {
                this.tickInProgress = true;
                this._tick()
                  .catch((err: unknown) => console.error(`[MasterClock] Chain error:`, err))
                  .finally(() => { this.tickInProgress = false; });
              }
            }, 0);
          }
        });
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
        console.log(`  [Transit] ${agent.profile.name} arrived at ${to}`);

        // Broadcast arrival as movement
        this.callbacks.onMovement?.([{
          agentId: id,
          agentName: agent.profile.name,
          from,
          to,
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
   * Check if any NPC needs processing. O(N) — microseconds for 8-50 NPCs.
   * Called every game minute by Master Clock.
   */
  private _needsProcessing(): boolean {
    // Day advance pending
    if (Math.floor(this._gameMinute / MINUTES_PER_DAY) > this._lastKnownDay) return true;

    const locationGroups = new Map<string, string[]>(); // location → npcIds[]

    for (const [id, agent] of this.agents) {
      if (agent.profile.isPlayer) continue;
      if (!agent.state.alive || agent.state.inPlayerChat || agent.state.inTransit) continue;
      if (isStatusAbsent(agent.state.status)) continue;

      // Track by location for pair checks
      const loc = agent.state.location;
      if (!locationGroups.has(loc)) locationGroups.set(loc, []);
      locationGroups.get(loc)!.push(id);

      // Volition check: NPC idle + decision cooldown expired
      if (!this.goalManager.hasActiveGoal(id)) {
        const expires = this.decisionCooldowns.get(id) ?? 0;
        if (this._gameMinute >= expires) return true;
      }
    }

    // Conversation pair check: co-located idle pairs with expired cooldown
    for (const [, npcIds] of locationGroups) {
      if (npcIds.length < 2) continue;
      for (let i = 0; i < npcIds.length; i++) {
        if (this.goalManager.hasActiveGoal(npcIds[i])) continue;
        for (let j = i + 1; j < npcIds.length; j++) {
          if (this.goalManager.hasActiveGoal(npcIds[j])) continue;
          // Pair cooldown check (simplified — full scoring in _tick)
          const key = [npcIds[i], npcIds[j]].sort().join(':');
          // ConversationScheduler tracks cooldowns internally, but we can't access them here.
          // Instead, return true if any idle co-located pair exists — _tick() will do full scoring.
          return true;
        }
      }
    }

    // Body discovery: alive NPC co-located with dead NPC
    for (const [, agent] of this.agents) {
      if (!agent.state.alive) continue;
      if (agent.state.inPlayerChat || agent.state.inTransit) continue;
      for (const [, other] of this.agents) {
        if (other.state.alive || other.profile.isPlayer) continue;
        if (agent.state.location === other.state.location) {
          const key = `${agent.profile.id}:${other.profile.id}`;
          if (!this.bodyDiscoveries.has(key)) return true;
        }
      }
    }

    return false;
  }

  /** Run a single world tick */
  async tick(): Promise<TickResult> {
    if (this.tickInProgress) {
      throw new Error('Tick already in progress — wait for it to complete');
    }
    this.tickInProgress = true;
    try {
      return await this._tick();
    } finally {
      this.tickInProgress = false;
    }
  }

  private async _tick(): Promise<TickResult> {
    // Complete pending async impact from previous tick before starting new LLM work
    if (this._pendingImpact) {
      await this._pendingImpact;
      this._pendingImpact = null;
    }

    this.tickCount++;
    const minuteOfDay = this.minuteOfDay;
    const goalActions: GoalActionResult[] = [];

    // Transit is now managed by Master Clock (_advanceTransits). No clearing here.

    // 0. Day advance — Game Clock drives time, processing loop detects boundary
    let dayAdvanced = false;
    const currentDay = Math.floor(this._gameMinute / MINUTES_PER_DAY);
    while (currentDay > this._lastKnownDay) {
      const { newDay } = await this.advanceDay();
      this._lastKnownDay++;
      dayAdvanced = true;
      console.log(`  [Time] New day: ${newDay}`);
    }
    const gameDay = this.getCurrentDay();

    // Helper: is this a non-player active NPC available for tick processing?
    const isNpc = (agent: Agent): boolean =>
      !agent.profile.isPlayer && !agent.state.inPlayerChat && isActive(agent);

    // 0.5. Check NPC schedules — skip player (player moves freely)
    if (this.scheduleManager) {
      // Update currentActivity on each NPC for prompt context
      for (const [id, agent] of this.agents) {
        if (!isNpc(agent)) continue;
        const entry = this.scheduleManager.getActiveEntry(id, minuteOfDay);
        agent.state.currentActivity = entry?.activity;
      }

      const npcLocations = new Map<string, string>();
      for (const [id, agent] of this.agents) {
        if (isNpc(agent)) {
          npcLocations.set(id, agent.state.location);
        }
      }

      const scheduleGoals = this.scheduleManager.checkSchedules(
        Array.from(this.agents.keys()).filter((id) => isNpc(this.agents.get(id)!)),
        minuteOfDay,
        npcLocations,
        (id) => this.goalManager.hasActiveGoal(id),
      );

      for (const goal of scheduleGoals) {
        goal.createdAtMinute = this._gameMinute;
        this.goalManager.addGoal(goal);
      }
    }

    // 0.6. Check for body discoveries BEFORE goals execute (NPC is still at location)
    await this.checkBodyDiscovery();

    // 0.7. Night walks — depressed NPCs may wander instead of sleeping (skip player)
    if (getTimePeriod(minuteOfDay) === 'night') {
      for (const [id, agent] of this.agents) {
        if (!isNpc(agent)) continue;
        if (this.goalManager.hasActiveGoal(id)) continue;
        // mood < -0.3 → chance of night walk proportional to distress
        if (agent.state.mood < -0.3) {
          const walkChance = Math.min(0.1, Math.abs(agent.state.mood) * 0.08);
          if (Math.random() < walkChance) {
            // Pick a random public location to wander to
            const publicLocations = Array.from(this.locations.entries())
              .filter(([, loc]) => loc.isPublic && loc.id !== agent.state.location);
            if (publicLocations.length > 0) {
              const [targetId] = publicLocations[Math.floor(Math.random() * publicLocations.length)];
              this.goalManager.addGoal({
                id: crypto.randomUUID(),
                type: 'night_walk',
                ownerId: id,
                priority: 2, // lower than schedule (3), much lower than events
                state: 'pending',
                steps: [
                  { action: 'move_to', location: targetId },
                  { action: 'wait', ticks: 2 },
                  // Return home if they have one
                  ...(this.npcHomes.has(id)
                    ? [{ action: 'move_to' as const, location: this.npcHomes.get(id)! }]
                    : []),
                ],
                currentStep: 0,
                data: { reason: 'restless mind' },
                createdAtMinute: this._gameMinute,
              });
            }
          }
        }
      }
    }

    // 0.85. Affordance Layer — evaluate NPC volition
    const volitionCtx: AffordanceContext = {
      agents: this.agents,
      locations: this.locations,
      npcHomes: this.npcHomes,
      period: this.currentPeriod as AffordanceContext['period'],
      gameDay,
      gameMinute: this._gameMinute,
      playerLocation: this.playerLocation ?? undefined,
      hasActiveGoal: (id) => this.goalManager.hasActiveGoal(id),
      hasActiveGoalAbove: (id, minPriority) => this.goalManager.hasActiveGoalAbove(id, minPriority),
      cooldowns: this.affordanceCooldowns,
      decisionCooldowns: this.decisionCooldowns,
      affordanceCooldownMinutes: this.config.affordanceCooldownMinutes,
      decisionCooldownMinutes: this.config.decisionCooldownMinutes,
      isArrestTarget: (npcId) => this.goalManager.isTargetOfGoalType(npcId, 'arrest'),
    };
    const volitionGoals = await evaluateAllVolition(volitionCtx, this.callbacks.onLlmCall, this.callbacks.onDecision);
    for (const goal of volitionGoals) {
      this.goalManager.addGoal(goal);
    }

    // 1. Process goal-driven actions (highest priority)
    const interactionRunner = createInteractionRunner(this.eventStore, {
      onLine: this.callbacks.onLine,
      locations: this.locations,
      onExtraEvent: async (event) => {
        const results = await this.processCascade(event);
        await this.handleEventForGoals(event);
        for (const r of results) {
          await this.handleEventForGoals(r.event);
        }
      },
    });

    const npcsWithGoals = new Set<string>();
    for (const [id] of this.agents) {
      if (this.goalManager.hasActiveGoal(id)) {
        npcsWithGoals.add(id);
        const agent = this.agents.get(id);
        if (agent?.profile.isPlayer) continue; // Player goals not executed by tick
        if (agent?.state.inPlayerChat) continue; // Frozen in conversation with player
        if (agent && isStatusAbsent(agent.state.status)) continue; // Detained/exiled/fled NPCs don't act
        const goalType = this.goalManager.getActiveGoal(id)?.type ?? 'unknown';
        this.callbacks.onLlmCall?.(`Goal: ${goalType}`, agent?.profile.name);

        // Goal step chaining: non-LLM steps execute instantly in sequence.
        // Loop until we hit a blocking step (transit, LLM) or goal completes.
        const crimeHandler = async (crimeData: { type: string; subject: string; object?: string; location: string; importance: number; payload: Record<string, unknown> }) => {
          const crimeEvent: WorldEvent = {
            id: crypto.randomUUID(),
            type: crimeData.type as WorldEvent['type'],
            subject: crimeData.subject,
            object: crimeData.object,
            location: crimeData.location,
            gameDay: this.getCurrentDay(),
            importance: crimeData.importance,
            payload: { ...crimeData.payload, sourceEvent: 'goal_execution' },
          };
          this.eventStore.append(crimeEvent);
          const sceneWitnesses = Array.from(this.agents.entries())
            .filter(([wid, a]) => wid !== crimeData.object && a.state.alive && a.state.location === crimeData.location)
            .map(([wid]) => wid);
          const sceneType = getSceneTypeForEvent(crimeData.type);
          if (sceneType) {
            this.markCrimeScene(crimeData.location, sceneType, crimeData.subject, crimeData.object, sceneWitnesses, crimeData.type);
          }
          if (isDeathEvent(crimeData.type) && crimeData.object) {
            this.callbacks.onMurder?.(crimeData.subject, crimeData.object,
              crimeData.payload.suspectName as string, crimeData.payload.victimName as string);
          }
          const elCtx: EvidenceContext = { event: crimeEvent, agents: this.agents, crimeScenes: this.crimeScenes };
          this.evidence.generate(crimeEvent, elCtx);
          const results = await this.processCascade(crimeEvent);
          await this.handleEventForGoals(crimeEvent);
          for (const r of results) {
            await this.handleEventForGoals(r.event);
          }
        };

        let chainCount = 0;
        const MAX_CHAIN = 10; // safety limit
        let lastAction: GoalActionResult | null = null;

        do {
          const action = await this.goalManager.processGoalTick(
            id, this.agents, this.locations, interactionRunner,
            crimeHandler, this.crimeScenes, this.evidence,
          );

          if (!action) break; // null = waiting (transit in progress)
          lastAction = action;
          goalActions.push(action);
          this.callbacks.onGoalAction?.(action);

          if (action.goalCompleted && action.isRoutine) {
            this.scheduleManager?.clearScheduleGoal(action.ownerId);
          }
          if (action.goalCompleted && !action.isRoutine) {
            const owner = this.agents.get(action.ownerId);
            if (owner?.state.alive) {
              const shift = getGoalMoodBoost(action.goalType);
              owner.state.mood = Math.min(1, owner.state.mood + shift);
            }
          }
          if (action.movement) {
            const movingAgent = this.agents.get(action.ownerId);
            if (movingAgent?.state.inTransit && !movingAgent.state.transitStartMinute) {
              const hops = movingAgent.state.transitPath?.length ?? 1;
              const minutesPerHop = this.config.minutesPerHop ?? 30;
              movingAgent.state.transitStartMinute = this._gameMinute;
              movingAgent.state.transitDuration = hops * minutesPerHop;
            }
            this.callbacks.onMovement?.([action.movement]);
          }

          // Stop chaining if: goal complete, transit started, or LLM step (interact)
          if (action.goalCompleted) break;
          if (agent?.state.inTransit) break;
          if (action.action === 'interact' || action.action === 'interact_present') break;

          chainCount++;
        } while (chainCount < MAX_CHAIN && this.goalManager.hasActiveGoal(id));
      }
    }

    // 2. Random movement (only for mobile NPCs WITHOUT active goals)
    if (this.locations.size > 0) {
      const randomMovements = processMovement(
        this.agents, this.locations, this.movementConfig, npcsWithGoals,
        this._gameMinute, this.config.minutesPerHop,
      );
      for (const m of randomMovements) {
        // Stream per-NPC — no batch
        this.callbacks.onMovement?.([m]);
      }
    }

    // Movements already broadcast per-NPC above (goal + random).

    // 2.5-2.7: Module-registered tick phase handlers (crime scene awareness, theft discovery, NPC approach)
    const approachEvents: import('./world-types').ApproachEvent[] = [];
    const tickCtx = {
      agents: this.agents,
      eventStore: this.eventStore,
      currentDay: this.getCurrentDay(),
      gameMinute: this._gameMinute,
      processEvent: async (event: WorldEvent) => {
        const results = await this.processCascade(event);
        await this.handleEventForGoals(event);
        for (const r of results) {
          await this.handleEventForGoals(r.event);
        }
      },
      discoveries: this.bodyDiscoveries,
      approaches: approachEvents,
      crimeScenes: this.crimeScenes,
      locations: this.locations,
    };
    for (const handler of getTickPhaseHandlers()) {
      await handler(tickCtx);
    }
    // Keep only highest-urgency approach per tick
    if (approachEvents.length > 1) {
      approachEvents.sort((a, b) => b.urgency - a.urgency);
      approachEvents.length = 1;
    }

    // 3. Casual conversations (skip NPCs with active goals)
    let conversation: ConversationResult | null = null;
    const pair = await this.scheduler.findPair(this.agents, this._gameMinute, npcsWithGoals);

    if (pair) {
      const initiator = this.agents.get(pair.a)!;
      const responder = this.agents.get(pair.b)!;

      // Select topic using TopicEngine
      const period = getTimePeriod(minuteOfDay);
      const topic = this.topicEngine.selectTopic(initiator, responder, gameDay, period, initiator.state.location, this.playerAgent ?? undefined);

      this.callbacks.onLlmCall?.('Casual conversation', `${initiator.profile.name} ↔ ${responder.profile.name} [${topic.subject}]`);
      conversation = await runConversation(
        initiator,
        responder,
        this.eventStore,
        this.config,
        topic,
        { onLine: this.callbacks.onLine, agents: this.agents, locations: this.locations },
      );
      conversation.topic = topic.subject;
      conversation.topicGroup = getTopicGroup(topic.category);

      this.callbacks.onConversation?.(conversation);

      // Belief transfer: if topic carried structured belief data, transfer bidirectionally
      if (topic.beliefTransfer) {
        const bt = topic.beliefTransfer;
        // Transfer initiator → responder (primary: initiator raised the topic)
        const initBelief = initiator.state.beliefs?.getAllBeliefs().find(
          b => b.eventType === bt.eventType && b.object === (bt.object ?? b.object),
        );
        if (initBelief && responder.state.beliefs) {
          const conf = Math.max(0.25, initBelief.confidence * bt.confidenceMultiplier);
          responder.state.beliefs.addBelief({
            id: crypto.randomUUID(),
            eventType: bt.eventType,
            subject: initBelief.subject,
            object: initBelief.object,
            location: initBelief.location,
            confidence: conf,
            source: 'rumor',
            sourceNpcId: initiator.profile.id,
            gameDay,
            lastUpdated: gameDay,
          });
          console.log(`  [BeliefTransfer] ${initiator.profile.name} → ${responder.profile.name}: ${bt.eventType} (conf ${conf.toFixed(2)})`);
        }
        // Transfer responder → initiator (secondary: responder may share related knowledge)
        const respBelief = responder.state.beliefs?.getAllBeliefs().find(
          b => b.eventType === bt.eventType && b.object === (bt.object ?? b.object)
            && b.subject && !initiator.state.beliefs?.getAllBeliefs().some(
              ib => ib.eventType === b.eventType && ib.object === b.object && ib.subject === b.subject,
            ),
        );
        if (respBelief && initiator.state.beliefs) {
          const conf = Math.max(0.25, respBelief.confidence * bt.confidenceMultiplier * 0.8);
          initiator.state.beliefs.addBelief({
            id: crypto.randomUUID(),
            eventType: bt.eventType,
            subject: respBelief.subject,
            object: respBelief.object,
            location: respBelief.location,
            confidence: conf,
            source: 'rumor',
            sourceNpcId: responder.profile.id,
            gameDay,
            lastUpdated: gameDay,
          });
          console.log(`  [BeliefTransfer] ${responder.profile.name} → ${initiator.profile.name}: ${bt.eventType} (conf ${conf.toFixed(2)})`);
        }
      }

      // Analyze conversation impact ASYNC — don't block tick.
      // Conversation lines already streamed via WS. Impact (mood/sentiment/memory)
      // will arrive as WS events when LLM completes — typically 3-5s after conversation.
      // This saves 5-10s per tick, making the world "flow" faster.
      const listeners = [pair.a, pair.b];
      for (const [id, agent] of this.agents) {
        if (id === pair.a || id === pair.b) continue;
        if (!isPresent(agent)) continue;
        if (agent.state.location === conversation.location) {
          listeners.push(id);
        }
      }
      // Capture conversation state NOW (before async work might see changed mood)
      const convCopy = { ...conversation };
      const topicCopy = { ...topic };
      const initMood = initiator.state.mood;
      const respMood = responder.state.mood;
      const initRef = initiator, respRef = responder;

      // Deferred impact analysis — doesn't block current tick.
      // Awaited at start of NEXT tick (no semaphore conflict) and on SIGINT save.
      this._pendingImpact = (async () => {
        try {
          this.callbacks.onLlmCall?.('Sentiment analysis', `${initRef.profile.name} ↔ ${respRef.profile.name}`);
          const impactResult = await this.analyzeConversationImpact(convCopy, listeners);
          const finalImportance = impactResult.importance;
          const responderSaid = convCopy.lines.filter(l => l.speaker === respRef.profile.id).map(l => l.text).join(' ');
          const initiatorSaid = convCopy.lines.filter(l => l.speaker === initRef.profile.id).map(l => l.text).join(' ');
          await initRef.observe(
            buildMemoryText(respRef.profile.name, topicCopy.subject, responderSaid, respMood),
            finalImportance,
          );
          await respRef.observe(
            buildMemoryText(initRef.profile.name, topicCopy.subject, initiatorSaid, initMood),
            finalImportance,
          );
          if (finalImportance !== convCopy.importance) {
            console.log(`  [Importance] Topic: ${convCopy.importance} → LLM: ${finalImportance}`);
          }
          await this.processOverhear(convCopy, finalImportance, topicCopy);
        } catch (err) {
          console.error('  [Impact] Deferred impact analysis failed:', err);
        }
      })();
    }

    const timeInfo = this.scheduleManager?.getTimeInfo(minuteOfDay);
    const result: TickResult = {
      tickNumber: this.tickCount,
      gameMinute: this._gameMinute,
      gameDay,
      time: timeInfo,
      dayAdvanced: dayAdvanced || undefined,
      conversation,
      // movements broadcast per-NPC during tick, not batched in result
      goalActions: goalActions.length > 0 ? goalActions : undefined,
      idleReason: !conversation && goalActions.length === 0
        ? 'No suitable conversation pair found'
        : undefined,
      approaches: approachEvents.length > 0 ? approachEvents : undefined,
    };
    this.callbacks.onTick?.(result);
    return result;
  }

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

    const summary = lines.map(l => `${l.speakerName}: "${l.text}"`).join(' | ');
    const overheardImportance = Math.max(finalImportance - 1, 2);
    const initiator = this.agents.get(initId);

    for (const [id, agent] of this.agents) {
      if (id === initId || id === respId) continue;
      if (!isPresent(agent)) continue;
      if (agent.state.location !== location) continue;
      if (Math.random() > 0.6) continue;

      await agent.observe(
        `You overheard a conversation nearby between ${lines[0]?.speakerName ?? 'someone'} and ${lines[1]?.speakerName ?? 'someone'}: ${summary}`,
        overheardImportance,
      );

      // Belief transfer from overheard conversation (weaker than direct: ×0.3)
      if (topic.beliefTransfer && initiator && agent.state.beliefs) {
        const bt = topic.beliefTransfer;
        const sourceBelief = initiator.state.beliefs?.getAllBeliefs().find(
          b => b.eventType === bt.eventType && b.object === (bt.object ?? b.object),
        );
        if (sourceBelief) {
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
    }
  }

  /**
   * Analyze a conversation for emotional impact using structured LLM output.
   * One lightweight call per conversation — returns sentiment shifts toward mentioned NPCs.
   * Applied to all listeners (participants + overhearers).
   */
  private async analyzeConversationImpact(
    conversation: ConversationResult,
    listenerIds: string[],
  ): Promise<{ moodDelta: number; importance: number }> {
    if (conversation.lines.length === 0 || listenerIds.length === 0) {
      return { moodDelta: 0, importance: conversation.importance };
    }

    const transcript = conversation.lines
      .map((l) => `${l.speakerName}: "${l.text}"`)
      .join('\n');

    // Build list of all NPC names for context
    const npcNames = Array.from(this.agents.values())
      .filter((a) => a.state.alive)
      .map((a) => a.profile.name);

    const prompt = [
      `Analyze this conversation for emotional impact on listeners.`,
      `Which NPCs are mentioned or discussed, and is the sentiment positive or negative?`,
      `How does this conversation affect the listeners' mood overall?`,
      `How memorable is this conversation (importance 1-8)?`,
      ``,
      `Known NPCs: ${npcNames.join(', ')}`,
      ``,
      `Conversation:`,
      transcript,
      ``,
      `Return mentions of NPCs with sentiment valence (-0.15 to 0.15), overall mood_impact (-0.08 to 0.06), and importance (1-8).`,
      `mood_impact: positive for warm/supportive/funny conversations, negative for tense/hostile/disturbing ones, near zero for neutral small talk.`,
      `CALIBRATION: Most casual friendly conversations should have mood_impact between -0.01 and +0.03. Only genuinely hostile, threatening, or disturbing exchanges warrant mood_impact below -0.04. Friends chatting = near zero or slightly positive.`,
      `importance: 1-2 for mundane small talk, 3-4 for interesting personal exchanges, 5-6 for emotionally significant revelations, 7-8 for shocking or life-changing information.`,
      `Only include NPCs explicitly discussed. Empty mentions array if just small talk.`,
      `secret_revealed: If someone confessed or accidentally revealed hidden information, write exactly: "NAME revealed about NAME: what they revealed". Example: "Ted revealed about Ted: waters down his ale due to debts". Empty string if nothing secret was shared. Only genuine hidden info, not common knowledge.`,
    ].join('\n');

    await llmSemaphore.acquire();
    try {
      const content = await llmCall({
        system: 'You analyze conversations for emotional impact on listeners.',
        user: prompt,
        temperature: 0.3,
        maxTokens: 300,
        jsonSchema: buildConversationImpactSchema(npcNames),
      });
      if (!content) return;

      let impact: { mentions: Array<{ npc_name: string; valence: number; reason: string }>; mood_impact: number; importance: number; secret_revealed?: string };
      try {
        impact = JSON.parse(content);
      } catch {
        console.warn(`  [Impact] Invalid JSON from LLM, skipping`);
        return { moodDelta: 0, importance: conversation.importance };
      }

      // Resolve NPC names to IDs (used by mentions + secret discovery)
      const nameToId = new Map<string, string>();
      for (const [id, agent] of this.agents) {
        nameToId.set(agent.profile.name.toLowerCase(), id);
      }

      // Apply sentiment shifts to all listeners
      if (impact.mentions.length > 0) {

        for (const mention of impact.mentions) {
          const mentionedId = nameToId.get(mention.npc_name.toLowerCase());
          if (!mentionedId) continue;

          // Clamp valence to safe range (configurable via conversationBehavior)
          const vc = this.resolvedConversationConfig.sentimentValenceClamp;
          const valence = Math.max(vc.min, Math.min(vc.max, mention.valence));
          if (Math.abs(valence) < this.resolvedConversationConfig.sentimentValenceThreshold) continue;

          for (const listenerId of listenerIds) {
            if (listenerId === mentionedId) continue; // skip self-references
            const listener = this.agents.get(listenerId);
            if (!listener?.state.relationships) continue;
            listener.state.relationships.adjustSentiment(mentionedId, valence);
          }

          console.log(`  [Impact] ${mention.npc_name}: ${valence > 0 ? '+' : ''}${valence.toFixed(2)} (${mention.reason})`);
        }
      }

      // Apply mood impact (bidirectional: positive for warm chats, negative for tense ones)
      const rawImpact = impact.mood_impact;
      const bias = this.config.moodBias ?? 0;
      const mc = this.resolvedConversationConfig.moodImpactClamp;
      const moodDelta = Math.max(mc.min, Math.min(mc.max, rawImpact)) + bias;
      if (Math.abs(moodDelta) > 0.005) {
        for (const listenerId of listenerIds) {
          const listener = this.agents.get(listenerId);
          if (listener) {
            listener.state.mood = Math.max(-1, Math.min(1, listener.state.mood + moodDelta));
          }
        }
        if (moodDelta !== 0) {
          console.log(`  [Mood] Conversation mood impact: ${moodDelta > 0 ? '+' : ''}${moodDelta.toFixed(3)}`);
        }
      }

      // Secret discovery: if LLM detected a speaker revealed hidden information
      // Format: "SPEAKER revealed about ABOUT: DETAIL"
      // Event type from registry — module defines what constitutes a "secret" event
      const secretEventType = getSecretEventType();
      const secretStr = (impact as any).secret_revealed as string;
      if (secretEventType && secretStr && secretStr.length > 5) {
        const secretMatch = secretStr.match(/(\w[\w\s]*?)\s+revealed\s+about\s+(\w[\w\s]*?):\s*(.+)/i);
        if (secretMatch) {
          const [, speakerName, aboutName, detail] = secretMatch;
          const aboutId = nameToId.get(aboutName.trim().toLowerCase());
          const speakerId = nameToId.get(speakerName.trim().toLowerCase());
          if (aboutId && speakerId) {
            const aboutAgent = this.agents.get(aboutId);
            for (const listenerId of listenerIds) {
              if (listenerId === speakerId || listenerId === aboutId) continue;
              const listener = this.agents.get(listenerId);
              if (!listener?.state.beliefs) continue;
              const alreadyKnows = listener.state.beliefs.getAllBeliefs().some(
                b => b.source === 'secret' && b.subject === aboutAgent?.profile.name,
              );
              if (alreadyKnows) continue;
              listener.state.beliefs.addBelief({
                id: crypto.randomUUID(),
                eventType: secretEventType,
                subject: aboutAgent?.profile.name ?? aboutName.trim(),
                object: detail.trim(),
                location: conversation.location,
                confidence: this.resolvedConversationConfig.secretDiscoveryConfidence,
                source: 'secret',
                sourceNpcId: speakerId,
                gameDay: conversation.gameDay,
                lastUpdated: conversation.gameDay,
              });
              console.log(`  [SecretDiscovery] ${listener.profile.name} learned about ${aboutName.trim()}'s secret from ${speakerName.trim()}: "${detail.trim()}"`);
            }
          }
        }
      }

      // LLM-assessed importance (content-aware, not just topic weight)
      const rawImportance = impact.importance ?? conversation.importance;
      if (rawImportance < 1 || rawImportance > 8) {
        console.warn(`  [Impact] LLM importance ${rawImportance} outside 1-8 range, clamping`);
      }
      const llmImportance = Math.max(1, Math.min(8, Math.round(rawImportance)));
      return { moodDelta, importance: llmImportance };
    } catch (err) {
      console.error(`  [Impact] Analysis failed:`, err);
      return { moodDelta: 0, importance: conversation.importance };
    } finally {
      llmSemaphore.release();
    }
  }

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
        // Mark discoverer as already witnessed (so cascade skips them)
        sharedCtx.witnessIds!.add(id);

        // Process through consequence engine with shared ctx (dedup witnesses)
        const results = await this.engine.process(discoveryEvent, sharedCtx);
        if (results.length > 0 && this.callbacks.onCascade) {
          this.callbacks.onCascade(discoveryEvent, results.map(r => r.event));
        }

        // Feed into goal system
        await this.handleEventForGoals(discoveryEvent);
        for (const r of results) {
          await this.handleEventForGoals(r.event);
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

  /** @deprecated Use startMasterClock(). Kept for API compat. */
  startAutoTick(_intervalMs?: number): void {
    this.startMasterClock();
  }

  /** @deprecated Use stopMasterClock(). Kept for API compat. */
  stopAutoTick(): void {
    this.stopMasterClock();
  }

  /** Whether the Master Clock is running (time flowing + processing triggered) */
  get isAutoTicking(): boolean {
    return this._gameClockTimer !== null;
  }

  /** Await any pending async work (deferred impact analysis). Call before save. */
  async flushPending(): Promise<void> {
    if (this._pendingImpact) {
      await this._pendingImpact;
      this._pendingImpact = null;
    }
  }

  /** @deprecated Use gameMinute. Processing tick counter. */
  get currentTick(): number {
    return this.tickCount;
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
    const results = await this.processCascade(event);
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

    const period = getTimePeriod(this.minuteOfDay);
    const ctx: AffordanceContext = {
      agents: this.agents,
      locations: this.locations,
      period,
      gameDay: agent.state.currentDay,
      gameMinute: this._gameMinute,
      npcHomes: this.npcHomes,
      playerLocation: this.playerLocation ?? undefined,
      cooldowns: this.affordanceCooldowns,
      decisionCooldowns: this.decisionCooldowns,
      affordanceCooldownMinutes: this.config.affordanceCooldownMinutes,
      decisionCooldownMinutes: this.config.decisionCooldownMinutes,
      hasActiveGoal: (id) => this.goalManager.getActiveGoal(id) !== null,
      hasActiveGoalAbove: (id, minPriority) => this.goalManager.hasActiveGoalAbove(id, minPriority),
    };

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
    bodyDiscoveries: string[];
    crimeScenes: Record<string, import('./world-types').CrimeSceneJSON[]>;
    journal: import('./journal').JournalEntry[];
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
