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
import { GoalManager } from './goals';
import type { GoalActionResult } from './goals';
import { createInteractionRunner } from './interaction';
import type {
  WorldConfig, TickResult, ConversationLine, ConversationResult,
  LocationGraph, NpcMovementConfig, MovementResult, NpcHome,
  CrimeScene, CrimeSceneJSON,
} from './world-types';
import { DEFAULT_WORLD_CONFIG, DEFAULT_MOVEMENT_CONFIG } from './world-types';
import { ScheduleManager, TICKS_PER_DAY, getTimePeriod } from './schedule';
import type { ScheduleEntry } from './schedule';
import { createCrimeScene } from './crime-scene';
import { PlayerJournal } from './journal';
import { evaluateAllVolition, evaluateReactiveVolition } from './volition';
import { AFFORDANCE_REGISTRY, checkRequirements, computeUtility } from './al';
import type { AffordanceContext } from './al';
import { TopicEngine, getTopicGroup } from './topic-engine';
import { EvidenceLayer } from './evidence';
import type { EvidenceContext } from './evidence';
import { isEventCategory, getGoalCleanupForEvent, getSceneTypeForEvent, isDeathEvent, getDefaultDeathEvent, getEventHandlers, isStatusActive, isStatusAbsent, getGoalMoodBoost, getBodyDiscoveryEventType, getDiscoveryHandler, getTickPhaseHandlers, getDayAdvanceHandlers, isTransferable } from './event-registry';
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

const CONVERSATION_IMPACT_SCHEMA: LlmJsonSchema = {
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
            npc_name: { type: 'string' },
            valence: { type: 'number' },
            reason: { type: 'string' },
          },
          required: ['npc_name', 'valence', 'reason'],
          additionalProperties: false,
        },
      },
      mood_impact: { type: 'number' },
      importance: { type: 'number' },
      secret_revealed: { type: 'string', description: 'If someone confessed or revealed hidden info: "NAME revealed about NAME: detail". Example: "Ted revealed about Ted: waters down ale". Empty string if none.' },
    },
    required: ['mentions', 'mood_impact', 'importance', 'secret_revealed'],
    additionalProperties: false,
  },
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
  private tickCount: number;
  private autoTickTimer: ReturnType<typeof setTimeout> | null = null;
  private autoTickInterval: number = 5000;
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
  /** Affordance cooldowns: npcId → affordanceId → expiresAtTick */
  private affordanceCooldowns: Map<string, Map<string, number>> = new Map();
  /** Decision cooldowns: npcId → expiresAtTick (limits LLM decision frequency) */
  private decisionCooldowns: Map<string, number> = new Map();
  /** Evidence Layer: structured discoverable facts at locations */
  readonly evidence: EvidenceLayer = new EvidenceLayer();

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
    this.tickCount = this.config.startTick ?? 0;
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
      currentTick: this.tickCount,
      playerLocation: this.playerLocation ?? undefined,
      hasActiveGoal: (id) => this.goalManager.hasActiveGoal(id),
      hasActiveGoalAbove: (id, minPriority) => this.goalManager.hasActiveGoalAbove(id, minPriority),
      cooldowns: this.affordanceCooldowns,
      affordanceCooldownTicks: this.config.affordanceCooldownTicks,
    };
    const reactiveGoals = evaluateReactiveVolition(
      event, reactiveCtx,
      (npcId) => this.goalManager.getGoals(npcId).filter(g => g.state !== 'completed' && g.state !== 'failed').map(g => g.type),
    );
    for (const goal of reactiveGoals) {
      this.goalManager.addGoal(goal);
    }

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
          for (const goal of goals) {
            this.goalManager.addGoal(goal);
          }
        },
      };
      for (const handler of handlers) {
        await handler(event, handlerCtx);
      }
    }
  }

  /** Get current tick within day (0 to TICKS_PER_DAY-1) */
  get tickInDay(): number {
    return this.tickCount % TICKS_PER_DAY;
  }

  /** Get current time period */
  get currentPeriod(): string {
    return getTimePeriod(this.tickInDay);
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
    this.tickCount++;
    const tickInDay = this.tickInDay;
    const allMovements: MovementResult[] = [];
    const goalActions: GoalActionResult[] = [];

    // 0. Auto advance day when a new day starts (tick rolls over to 0)
    let dayAdvanced = false;
    if (tickInDay === 0 && this.tickCount > 1) {
      const { newDay } = await this.advanceDay();
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
        const entry = this.scheduleManager.getActiveEntry(id, tickInDay);
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
        tickInDay,
        npcLocations,
        (id) => this.goalManager.hasActiveGoal(id),
      );

      for (const goal of scheduleGoals) {
        goal.createdAtTick = this.tickCount;
        this.goalManager.addGoal(goal);
      }
    }

    // 0.6. Check for body discoveries BEFORE goals execute (NPC is still at location)
    await this.checkBodyDiscovery();

    // 0.7. Night walks — depressed NPCs may wander instead of sleeping (skip player)
    if (getTimePeriod(tickInDay) === 'night') {
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
                createdAtTick: this.tickCount,
              });
            }
          }
        }
      }
    }

    // 0.85. Affordance Layer — evaluate NPC volition (replaces murder check + crime triggers)
    const volitionCtx: AffordanceContext = {
      agents: this.agents,
      locations: this.locations,
      npcHomes: this.npcHomes,
      period: this.currentPeriod as AffordanceContext['period'],
      gameDay,
      currentTick: this.tickCount,
      playerLocation: this.playerLocation ?? undefined,
      hasActiveGoal: (id) => this.goalManager.hasActiveGoal(id),
      hasActiveGoalAbove: (id, minPriority) => this.goalManager.hasActiveGoalAbove(id, minPriority),
      cooldowns: this.affordanceCooldowns,
      decisionCooldowns: this.decisionCooldowns,
      affordanceCooldownTicks: this.config.affordanceCooldownTicks,
      decisionCooldownTicks: this.config.decisionCooldownTicks,
      isArrestTarget: (npcId) => this.goalManager.isTargetOfGoalType(npcId, 'arrest'),
    };
    const volitionGoals = await evaluateAllVolition(volitionCtx, this.callbacks.onLlmCall);
    for (const goal of volitionGoals) {
      this.goalManager.addGoal(goal);
    }

    // 1. Process goal-driven actions (highest priority)
    const interactionRunner = createInteractionRunner(this.eventStore, {
      onLine: this.callbacks.onLine,
      locations: this.locations,
      onExtraEvent: async (event) => {
        const results = await this.engine.process(event, this.buildCgContext());
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
        const action = await this.goalManager.processGoalTick(
          id, this.agents, this.locations, interactionRunner,
          async (crimeData: { type: string; subject: string; object?: string; location: string; importance: number; payload: Record<string, unknown> }) => {
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

            // Create crime scene for violent crimes
            const sceneWitnesses = Array.from(this.agents.entries())
              .filter(([id, a]) => id !== crimeData.object && a.state.alive && a.state.location === crimeData.location)
              .map(([id]) => id);
            const sceneType = getSceneTypeForEvent(crimeData.type);
            if (sceneType) {
              this.markCrimeScene(crimeData.location, sceneType, crimeData.subject, crimeData.object, sceneWitnesses, crimeData.type);
            }
            if (isDeathEvent(crimeData.type) && crimeData.object) {
              this.callbacks.onMurder?.(crimeData.subject, crimeData.object,
                crimeData.payload.suspectName as string, crimeData.payload.victimName as string);
            }

            // Generate structured evidence at the scene
            const elCtx: EvidenceContext = { event: crimeEvent, agents: this.agents, crimeScenes: this.crimeScenes };
            this.evidence.generate(crimeEvent, elCtx);

            // Process through CE for cascading consequences
            const results = await this.engine.process(crimeEvent, this.buildCgContext());
            await this.handleEventForGoals(crimeEvent);
            for (const r of results) {
              await this.handleEventForGoals(r.event);
            }
          },
          this.crimeScenes,
          this.evidence,
        );
        if (action) {
          goalActions.push(action);
          this.callbacks.onGoalAction?.(action);

          // Clear schedule tracking when routine goal completes
          if (action.goalCompleted && action.isRoutine) {
            this.scheduleManager?.clearScheduleGoal(action.ownerId);
          }

          // Goal completion mood feedback — sense of accomplishment or catharsis
          if (action.goalCompleted && !action.isRoutine) {
            const owner = this.agents.get(action.ownerId);
            if (owner?.state.alive) {
              const shift = getGoalMoodBoost(action.goalType);
              owner.state.mood = Math.min(1, owner.state.mood + shift);
            }
          }

          if (action.movement) {
            allMovements.push(action.movement);
          }
        }
      }
    }

    // 2. Random movement (only for mobile NPCs WITHOUT active goals)
    if (this.locations.size > 0) {
      const randomMovements = processMovement(
        this.agents, this.locations, this.movementConfig, npcsWithGoals,
      );
      if (randomMovements.length > 0) {
        allMovements.push(...randomMovements);
      }
    }

    // Broadcast all movements together
    if (allMovements.length > 0) {
      this.callbacks.onMovement?.(allMovements);
    }

    // 2.5-2.7: Module-registered tick phase handlers (crime scene awareness, theft discovery, NPC approach)
    const approachEvents: import('./world-types').ApproachEvent[] = [];
    const tickCtx = {
      agents: this.agents,
      eventStore: this.eventStore,
      currentDay: this.getCurrentDay(),
      tickCount: this.tickCount,
      processEvent: async (event: WorldEvent) => {
        const results = await this.engine.process(event, this.buildCgContext());
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
    const pair = await this.scheduler.findPair(this.agents, this.tickCount, npcsWithGoals);

    if (pair) {
      const initiator = this.agents.get(pair.a)!;
      const responder = this.agents.get(pair.b)!;

      // Select topic using TopicEngine
      const tickInDay = this.tickCount % TICKS_PER_DAY;
      const period = getTimePeriod(tickInDay);
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

      // Analyze conversation for sentiment/mood shifts (structured LLM call)
      const listeners = [pair.a, pair.b];
      for (const [id, agent] of this.agents) {
        if (id === pair.a || id === pair.b) continue;
        if (!isPresent(agent)) continue;
        if (agent.state.location === conversation.location) {
          listeners.push(id);
        }
      }
      this.callbacks.onLlmCall?.('Sentiment analysis', `${initiator.profile.name} ↔ ${responder.profile.name}`);
      const impactResult = await this.analyzeConversationImpact(conversation, listeners);
      const finalImportance = impactResult.importance;

      // Store conversation memories with LLM-assessed importance (content-aware)
      const responderSaid = conversation.lines.filter(l => l.speaker === responder.profile.id).map(l => l.text).join(' ');
      const initiatorSaid = conversation.lines.filter(l => l.speaker === initiator.profile.id).map(l => l.text).join(' ');
      await initiator.observe(
        buildMemoryText(responder.profile.name, topic.subject, responderSaid, responder.state.mood),
        finalImportance,
      );
      await responder.observe(
        buildMemoryText(initiator.profile.name, topic.subject, initiatorSaid, initiator.state.mood),
        finalImportance,
      );
      if (finalImportance !== conversation.importance) {
        console.log(`  [Importance] Topic: ${conversation.importance} → LLM: ${finalImportance}`);
      }

      // Overhear: bystanders get memories + belief transfer (AFTER importance is finalized)
      await this.processOverhear(conversation, finalImportance, topic);
    }

    const timeInfo = this.scheduleManager?.getTimeInfo(tickInDay);
    const result: TickResult = {
      tickNumber: this.tickCount,
      gameDay,
      time: timeInfo,
      dayAdvanced: dayAdvanced || undefined,
      conversation,
      movements: allMovements.length > 0 ? allMovements : undefined,
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
        jsonSchema: CONVERSATION_IMPACT_SCHEMA,
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

          // Clamp valence to safe range
          const valence = Math.max(-0.15, Math.min(0.15, mention.valence));
          if (Math.abs(valence) < 0.02) continue; // skip negligible shifts

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
      const moodDelta = Math.max(-0.08, Math.min(0.06, rawImpact)) + bias;
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
      const secretStr = (impact as any).secret_revealed as string;
      if (secretStr && secretStr.length > 5) {
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
                eventType: 'PERSONAL_SECRET',
                subject: aboutAgent?.profile.name ?? aboutName.trim(),
                object: detail.trim(),
                location: conversation.location,
                confidence: 0.4,
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
      this.tickCount,
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

    // Process consequences — the engine's onEvent callback will call handleEventForGoals
    const results = await this.engine.process(killEvent, this.buildCgContext());

    // Also feed the kill event itself into goals
    this.handleEventForGoals(killEvent);

    return { killEvent, results };
  }

  /** Start auto-ticking at the given interval */
  startAutoTick(intervalMs: number): void {
    this.stopAutoTick();
    this.autoTickInterval = intervalMs;
    const loop = async () => {
      if (!this.autoTickTimer) return; // stopped
      try {
        await this.tick();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes('already in progress')) {
          console.error(`[Auto-tick error]: ${msg}`);
        }
      }
      // Schedule next tick AFTER current completes (tick-when-ready)
      if (this.autoTickTimer) {
        this.autoTickTimer = setTimeout(loop, this.autoTickInterval);
      }
    };
    this.autoTickTimer = setTimeout(loop, intervalMs);
  }

  /** Stop auto-ticking */
  stopAutoTick(): void {
    if (this.autoTickTimer) {
      clearTimeout(this.autoTickTimer);
      this.autoTickTimer = null;
    }
  }

  get isAutoTicking(): boolean {
    return this.autoTickTimer !== null;
  }

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
      currentTick: this.tickCount,
      playerLocation: this.playerLocation ?? undefined,
      hasActiveGoal: (id) => this.goalManager.hasActiveGoal(id),
      hasActiveGoalAbove: (id, minPriority) => this.goalManager.hasActiveGoalAbove(id, minPriority),
      cooldowns: this.affordanceCooldowns,
      decisionCooldowns: this.decisionCooldowns,
      affordanceCooldownTicks: this.config.affordanceCooldownTicks,
      decisionCooldownTicks: this.config.decisionCooldownTicks,
    };
  }

  /** Build WorldContext for ConsequenceEngine.process() */
  private buildCgContext(): import('./cg-engine').WorldContext {
    return { agents: this.agents, publicPlaces: this.config.publicPlaces || new Set() };
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

    const period = getTimePeriod(this.tickCount);
    const ctx: AffordanceContext = {
      agents: this.agents,
      locations: this.locations,
      period,
      gameDay: agent.state.currentDay,
      currentTick: this.tickCount,
      npcHomes: this.npcHomes,
      playerLocation: this.playerLocation ?? undefined,
      cooldowns: this.affordanceCooldowns,
      decisionCooldowns: this.decisionCooldowns,
      affordanceCooldownTicks: this.config.affordanceCooldownTicks,
      decisionCooldownTicks: this.config.decisionCooldownTicks,
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
