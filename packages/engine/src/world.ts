import { Agent, llmSemaphore } from './agent';
import { BeliefManager } from './beliefs';
import { RelationshipGraph } from './relationships';
import type { Belief } from './beliefs';
import type { Relationship } from './relationships';
import type { IEventStore } from './event-types';
import { ConsequenceEngine } from './cg-engine';
import type { WorldEvent } from './cg-types';
import { ConversationScheduler } from './scheduler';
import { runConversation } from './conversation';
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
import { createCrimeScene, getPassiveNoticeText } from './crime-scene';
import { PlayerJournal } from './journal';
import { evaluateAllVolition, evaluateReactiveVolition } from './volition';
import { AFFORDANCE_REGISTRY, checkRequirements, computeUtility } from './al';
import type { AffordanceContext } from './al';
import { TopicEngine } from './topic-engine';
import { EvidenceLayer } from './evidence';
import type { EvidenceContext } from './evidence';
import { isEventCategory, getGoalCleanupForEvent, shouldZeroBeliefs, getSceneTypeForEvent, isDeathEvent, getDefaultDeathEvent, getEventHandlers, isPursuitEvent, isStatusActive, isStatusAbsent, getWitnessEventType, getGoalMoodBoost, getBodyDiscoveryEventType, getTickPhaseHandlers, getDayAdvanceHandlers } from './event-registry';
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
  /** Player location — null if player not in world */
  playerLocation: string | null = null;
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

    // Registry-based belief zeroing: modules declare which events resolve a case.
    // Reduces ALL NPCs' crime beliefs about the suspect — justice served, urgency drops.
    // Investigators zeroed fully, others reduced to 0.2 (they remember, but no compulsion).
    if (shouldZeroBeliefs(event.type)) {
      const suspectId = event.object;
      const suspect = suspectId ? this.agents.get(suspectId) : null;
      if (suspect) {
        for (const [, agent] of this.agents) {
          if (!agent.state.beliefs) continue;
          for (const b of agent.state.beliefs.getAllBeliefs()) {
            if (b.subject === suspect.profile.name || b.subject === suspect.profile.id) {
              b.confidence = agent.profile.investigator ? 0 : Math.min(b.confidence, 0.2);
            }
          }
        }
      }
    }

    // Information spread → sentiment toward criminal drops for affected NPCs
    if (isEventCategory(event.type, 'information_spread')) {
      const criminalName = (event.payload?.killerName as string) ?? (event.payload?.thiefName as string);
      if (criminalName) {
        const criminalEntry = Array.from(this.agents.entries())
          .find(([, a]) => a.profile.name === criminalName || a.profile.id === criminalName);
        if (criminalEntry) {
          const [criminalId] = criminalEntry;
          const affected = (event.payload?.affectedTargets as string[]) ?? [];
          for (const npcId of affected) {
            const agent = this.agents.get(npcId);
            if (agent?.state.relationships && npcId !== criminalId) {
              agent.state.relationships.adjustSentiment(criminalId, -0.15);
            }
          }
        }
      }
    }

    // Module-registered event handlers (belief creation, state changes)
    const handlers = getEventHandlers(event.type);
    if (handlers.length > 0) {
      const handlerCtx: EventHandlerContext = {
        agents: this.agents,
        goalManager: this.goalManager,
        crimeScenes: this.crimeScenes,
        getCurrentDay: () => this.getCurrentDay(),
      };
      for (const handler of handlers) {
        await handler(event, handlerCtx);
      }
    }

    // WANTED_STATUS reactive: criminal gets reactive goals (lay_low, seek_forgiveness)
    // This stays in engine because it uses evaluateReactiveVolition (engine function)
    if (isEventCategory(event.type, 'information_spread') || isPursuitEvent(event.type)) {
      const criminalName = (event.payload?.killerName as string) ?? (event.payload?.thiefName as string);
      if (criminalName && isPursuitEvent(event.type)) {
        const criminalEntry = Array.from(this.agents.entries())
          .find(([, a]) => a.profile.name === criminalName || a.profile.id === criminalName);
        if (criminalEntry) {
          const [criminalId] = criminalEntry;
          const criminalEvent: WorldEvent = {
            ...event,
            payload: { ...event.payload, affectedTargets: [criminalId] },
          };
          const criminalGoals = evaluateReactiveVolition(
            criminalEvent, reactiveCtx,
            (id) => this.goalManager.getGoals(id).filter(g => g.state !== 'completed' && g.state !== 'failed').map(g => g.type),
          );
          for (const goal of criminalGoals) {
            this.goalManager.addGoal(goal);
          }
        }
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

    // Update player presence for all agents
    for (const agent of this.agents.values()) {
      agent.state.playerPresent = this.playerLocation != null
        && agent.state.location === this.playerLocation;
    }

    // 0. Auto advance day when a new day starts (tick rolls over to 0)
    let dayAdvanced = false;
    if (tickInDay === 0 && this.tickCount > 1) {
      const { newDay } = await this.advanceDay();
      dayAdvanced = true;
      console.log(`  [Time] New day: ${newDay}`);
    }
    const gameDay = this.getCurrentDay();

    // 0.5. Check NPC schedules — create low-priority goals for NPCs not at scheduled location
    if (this.scheduleManager) {
      // Update currentActivity on each agent for prompt context
      for (const [id, agent] of this.agents) {
        if (!isActive(agent)) continue;
        const entry = this.scheduleManager.getActiveEntry(id, tickInDay);
        agent.state.currentActivity = entry?.activity;
      }

      const npcLocations = new Map<string, string>();
      for (const [id, agent] of this.agents) {
        if (isActive(agent)) {
          npcLocations.set(id, agent.state.location);
        }
      }

      const scheduleGoals = this.scheduleManager.checkSchedules(
        Array.from(this.agents.keys()).filter((id) => isActive(this.agents.get(id)!)),
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

    // 0.7. Night walks — depressed NPCs may wander instead of sleeping
    if (getTimePeriod(tickInDay) === 'night') {
      for (const [id, agent] of this.agents) {
        if (!isActive(agent)) continue;
        if (this.goalManager.hasActiveGoal(id)) continue;
        // mood < -0.3 → chance of night walk proportional to distress
        if (agent.state.mood < -0.3) {
          const walkChance = Math.min(0.1, Math.abs(agent.state.mood) * 0.08);
          if (Math.random() < walkChance) {
            // Pick a random public location to wander to
            const publicLocations = Array.from(this.locations.values())
              .filter((loc) => loc.isPublic && loc.name !== agent.state.location);
            if (publicLocations.length > 0) {
              const target = publicLocations[Math.floor(Math.random() * publicLocations.length)];
              this.goalManager.addGoal({
                id: crypto.randomUUID(),
                type: 'night_walk',
                ownerId: id,
                priority: 2, // lower than schedule (3), much lower than events
                state: 'pending',
                steps: [
                  { action: 'move_to', location: target.name },
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
    };
    const volitionGoals = await evaluateAllVolition(volitionCtx, this.callbacks.onLlmCall);
    for (const goal of volitionGoals) {
      this.goalManager.addGoal(goal);
    }

    // 1. Process goal-driven actions (highest priority)
    const interactionRunner = createInteractionRunner(this.eventStore, {
      onLine: this.callbacks.onLine,
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
                crimeData.payload.killerName as string, crimeData.payload.victimName as string);
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

    // 2.5. Check if NPCs notice crime scenes at their location
    await this.checkCrimeScenes();

    // 2.7. Module-registered tick phase handlers (e.g., theft discovery)
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
    };
    for (const handler of getTickPhaseHandlers()) {
      await handler(tickCtx);
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
      const topic = this.topicEngine.selectTopic(initiator, responder, gameDay, period);

      this.callbacks.onLlmCall?.('Casual conversation', `${initiator.profile.name} ↔ ${responder.profile.name} [${topic.subject}]`);
      conversation = await runConversation(
        initiator,
        responder,
        this.eventStore,
        this.config,
        topic,
        { onLine: this.callbacks.onLine, agents: this.agents },
      );

      this.callbacks.onConversation?.(conversation);

      // Overhear: other NPCs at the same location may catch fragments
      await this.processOverhear(conversation);

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
      await this.analyzeConversationImpact(conversation, listeners);
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
    };
    this.callbacks.onTick?.(result);
    return result;
  }

  /**
   * NPCs at the same location as a conversation may overhear fragments.
   * ~60% chance per bystander. Importance reduced by 1.
   */
  private async processOverhear(conversation: ConversationResult): Promise<void> {
    const { initiator: initId, responder: respId, location, lines, importance } = conversation;
    if (lines.length === 0) return;

    const summary = lines.map(l => `${l.speakerName}: "${l.text}"`).join(' | ');
    const overheardImportance = Math.max(importance - 1, 2);

    for (const [id, agent] of this.agents) {
      if (id === initId || id === respId) continue;
      if (!isPresent(agent)) continue;
      if (agent.state.location !== location) continue;
      // 60% chance to overhear
      if (Math.random() > 0.6) continue;

      await agent.observe(
        `You overheard a conversation nearby between ${lines[0]?.speakerName ?? 'someone'} and ${lines[1]?.speakerName ?? 'someone'}: ${summary}`,
        overheardImportance,
      );
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
  ): Promise<void> {
    if (conversation.lines.length === 0 || listenerIds.length === 0) return;

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
      ``,
      `Known NPCs: ${npcNames.join(', ')}`,
      ``,
      `Conversation:`,
      transcript,
      ``,
      `Return mentions of NPCs with sentiment valence (-0.2 to 0.2) and overall tension (0.0 to 0.15).`,
      `Only include NPCs explicitly discussed. Empty mentions array if just small talk.`,
    ].join('\n');

    await llmSemaphore.acquire();
    try {
      const res = await fetch('http://127.0.0.1:1234/api/v1/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'qwen/qwen3.5-9b',
          system_prompt: 'You analyze conversations for emotional impact. Respond ONLY with valid JSON, no other text.',
          input: prompt + '\n\nRespond with JSON: {"mentions":[{"npc_name":"Name","valence":-0.1,"reason":"short reason"}],"tension":0.05}\nEmpty mentions array if just small talk. JSON only, no explanation.',
          reasoning: 'off',
          temperature: 0.3,
          max_output_tokens: 200,
        }),
      });

      if (!res.ok) {
        console.error(`  [Impact] LLM error: ${res.status}`);
        return;
      }

      const data = await res.json() as { output: Array<{ type: string; content?: string }> };
      const message = data.output?.find((o: { type: string }) => o.type === 'message');
      let content = message?.content?.trim() ?? '';
      if (!content) return;

      // Extract JSON from possible markdown code block
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) content = jsonMatch[1].trim();

      // Try to extract JSON object even if surrounded by extra text
      const objMatch = content.match(/\{[\s\S]*\}/);
      if (!objMatch) return;
      content = objMatch[0];

      let impact: { mentions: Array<{ npc_name: string; valence: number; reason: string }>; tension: number };
      try {
        impact = JSON.parse(content);
      } catch {
        console.warn(`  [Impact] Invalid JSON from LLM, skipping`);
        return;
      }

      // Apply sentiment shifts to all listeners
      if (impact.mentions.length > 0) {
        // Resolve NPC names to IDs
        const nameToId = new Map<string, string>();
        for (const [id, agent] of this.agents) {
          nameToId.set(agent.profile.name.toLowerCase(), id);
        }

        for (const mention of impact.mentions) {
          const mentionedId = nameToId.get(mention.npc_name.toLowerCase());
          if (!mentionedId) continue;

          // Clamp valence to safe range
          const valence = Math.max(-0.2, Math.min(0.2, mention.valence));
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

      // Apply tension as mood penalty to all listeners
      const tension = Math.max(0, Math.min(0.15, impact.tension));
      if (tension > 0.01) {
        for (const listenerId of listenerIds) {
          const listener = this.agents.get(listenerId);
          if (listener) {
            listener.state.mood = Math.max(-1, listener.state.mood - tension);
          }
        }
      }
    } catch (err) {
      console.error(`  [Impact] Analysis failed:`, err);
    } finally {
      llmSemaphore.release();
    }
  }

  /**
   * Murder motivation check — runs during night ticks.
   * For each NPC with a motive: if conditions align (sentiment, mood, same location,
   * night, no witnesses or low risk), ask LLM whether NPC acts on their grudge.
   * NOT a script — the murder only happens when emergent conditions converge.
   */
  private async checkMurderMotivation(): Promise<{ killerId: string; victimId: string } | null> {
    const period = this.currentPeriod;
    // Only late evening or night — darkness provides cover
    if (period !== 'night' && period !== 'evening') return null;

    for (const [id, agent] of this.agents) {
      if (!isActive(agent)) continue;
      const motive = agent.profile.motive;
      if (!motive) continue;

      const target = this.agents.get(motive.targetId);
      if (!target || !target.state.alive) continue;

      // Condition checks — all must be true
      // 1. Same location
      if (agent.state.location !== target.state.location) continue;

      // 2. Mood threshold — NPC must be distressed (< -0.3)
      if (agent.state.mood >= -0.3) continue;

      // 3. Sentiment toward target — must be negative (< -0.3)
      const rel = agent.state.relationships?.getRelationship(motive.targetId);
      if (!rel || rel.sentiment >= -0.3) continue;

      // 4. No other NPCs at the same location (reduce witness risk)
      //    OR mood is so bad they don't care (< -0.7)
      const othersPresent = Array.from(this.agents.values()).filter(
        (a) => a !== agent && a !== target && a.state.alive && a.state.location === agent.state.location,
      );
      if (othersPresent.length > 0 && agent.state.mood >= -0.7) continue;

      // 5. Player not present (NPC wouldn't kill in front of a stranger)
      if (this.playerLocation === agent.state.location) continue;

      // All conditions met — ask LLM for final decision
      console.log(`  [Motive] ${agent.profile.name} has opportunity against ${target.profile.name} — consulting LLM...`);
      this.callbacks.onLlmCall?.('Murder decision', `${agent.profile.name} → ${target.profile.name}`);
      const shouldAct = await this.askMurderDecision(agent, target, motive.reason, othersPresent.length);
      if (shouldAct) {
        return { killerId: id, victimId: motive.targetId };
      } else {
        console.log(`  [Motive] ${agent.profile.name} decided not to act tonight`);
        // Small mood recovery — they chose restraint
        agent.state.mood = Math.min(1, agent.state.mood + 0.05);
      }
    }

    return null;
  }

  /**
   * Ask LLM whether an NPC would act on their murderous grudge tonight.
   * Returns true if the NPC decides to kill. The LLM must reply with YES or NO.
   */
  private async askMurderDecision(
    killer: Agent,
    victim: Agent,
    motiveReason: string,
    witnessCount: number,
  ): Promise<boolean> {
    const beliefs = killer.state.beliefs?.summarizeForPrompt() ?? '';
    const relSummary = killer.state.relationships?.summarizeForPrompt() ?? '';

    const prompt = [
      `You are deciding whether ${killer.profile.name} the ${killer.profile.role} would commit murder tonight.`,
      ``,
      `CONTEXT:`,
      `- Motive: ${motiveReason}`,
      `- Current mood: ${killer.state.mood.toFixed(2)} (scale: -1 to 1, very negative = deeply distressed)`,
      `- Location: ${killer.state.location} (it is nighttime)`,
      `- Target: ${victim.profile.name} the ${victim.profile.role}`,
      witnessCount > 0 ? `- WARNING: ${witnessCount} other NPC(s) present at this location` : `- They are alone with the target`,
      `- ${killer.profile.name}'s personality: ${killer.profile.background}`,
      `- Inner conflict: ${killer.profile.innerConflict ?? 'none'}`,
      beliefs ? `- Current beliefs: ${beliefs}` : '',
      relSummary ? `- Relationships: ${relSummary}` : '',
      ``,
      `Would ${killer.profile.name} act on their grudge tonight? Consider their personality, emotional state,`,
      `and whether the circumstances push them past their breaking point. This is not guaranteed — most nights`,
      `they would hold back. Only answer YES if the combination of factors is truly overwhelming.`,
      ``,
      `Answer ONLY "YES" or "NO".`,
    ].filter(Boolean).join('\n');

    await llmSemaphore.acquire();
    try {
      const res = await fetch('http://127.0.0.1:1234/api/v1/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'qwen/qwen3.5-9b',
          system_prompt: 'You are a narrative decision engine. Answer only YES or NO.',
          input: prompt,
          reasoning: 'off',
          temperature: 0.7,
          max_output_tokens: 10,
        }),
      });

      if (!res.ok) {
        console.error(`  [Motive] LLM error: ${res.status}`);
        return false;
      }

      const data = await res.json() as { output: Array<{ type: string; content?: string }> };
      const message = data.output.find((o: { type: string }) => o.type === 'message');
      const answer = (message?.content ?? '').trim();
      const firstWord = answer.split(/\s+/)[0].toUpperCase().replace(/[^A-Z]/g, '');
      console.log(`  [Motive] LLM decision for ${killer.profile.name}: ${answer}`);
      return firstWord === 'YES';
    } catch (err) {
      console.error(`  [Motive] LLM call failed:`, err);
      return false;
    } finally {
      llmSemaphore.release();
    }
  }

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
        // victim identity + location. killerName unknown.
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
            killerName: null,
          },
        };

        this.eventStore.append(discoveryEvent);

        // Discoverer gets memory + belief directly (not through cascade)
        const discoveryText = `I discovered the body of ${victimName} at ${agent.state.location}! They appear to have been murdered. I need to tell someone about this immediately.`;
        await agent.observe(discoveryText, 8);
        agent.state.mood = Math.max(-1, agent.state.mood - 0.35);
        if (agent.state.beliefs && deathEventType) {
          agent.state.beliefs.addBelief({
            id: crypto.randomUUID(),
            eventType: deathEventType,
            subject: null,
            object: victimName,
            location: agent.state.location,
            confidence: 0.7,
            source: 'body_discovery',
            sourceNpcId: null,
            gameDay: this.getCurrentDay(),
            lastUpdated: this.getCurrentDay(),
          });
        }
        // Grief if related
        if (agent.state.relationships) {
          const grief = agent.state.relationships.getGriefPenalty(dead.id);
          if (grief !== 0) agent.state.mood = Math.max(-1, agent.state.mood + grief);
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

        // If discoverer is alone (no WITNESS_MEMORY from cascade), create one directly
        // so that reactive AL can give them a report_crime goal
        const hasWitnessEvent = results.some((r) => isEventCategory(r.event.type, 'witness_event'));
        const witnessEventType = getWitnessEventType();
        if (!hasWitnessEvent && !agent.profile.investigator && witnessEventType) {
          const directWitnessEvent: WorldEvent = {
            id: crypto.randomUUID(),
            type: witnessEventType,
            subject: id,
            object: dead.id,
            location: agent.state.location,
            gameDay: this.getCurrentDay(),
            importance: 8,
            payload: {
              affectedTargets: [id],
              victimName,
              killerName: null,
              sourceRule: 'body-discovery-to-witness',
            },
          };
          this.eventStore.append(directWitnessEvent);
          await this.handleEventForGoals(directWitnessEvent);
          console.log(`  [Discovery] ${agent.profile.name} is alone — creating direct witness event`);
        }

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
   * Check if NPCs at crime scene locations passively notice evidence.
   * Called during tick after movement phase.
   */
  private async checkCrimeScenes(): Promise<void> {
    for (const [locationId, scenes] of this.crimeScenes) {
      for (const scene of scenes) {
        if (!scene.active) continue;

        // Find the location name for memory text
        let locationName = locationId;
        for (const [, loc] of this.locations) {
          if (loc.name === locationId || loc.id === locationId) {
            locationName = loc.name;
            break;
          }
        }

        for (const [agentId, agent] of this.agents) {
          if (!isPresent(agent)) continue;
          if (agent.state.location !== locationId) continue;
          if (scene.noticedBy.has(agentId)) continue;

          // NPC notices the crime scene
          scene.noticedBy.add(agentId);

          const noticeText = getPassiveNoticeText(scene, locationName);
          await agent.observe(noticeText, 5);

          // Add belief about the crime
          agent.state.beliefs?.addBelief({
            id: crypto.randomUUID(),
            eventType: scene.eventType ?? scene.crimeType,
            subject: scene.perpetratorId ? (this.agents.get(scene.perpetratorId)?.profile.name ?? null) : null,
            object: scene.victimId ? (this.agents.get(scene.victimId)?.profile.name ?? null) : null,
            location: locationName,
            confidence: 0.8,
            source: 'observation',
            sourceNpcId: null,
            gameDay: this.getCurrentDay(),
            lastUpdated: this.getCurrentDay(),
          });

          console.log(`  [CrimeScene] ${agent.profile.name} noticed ${scene.crimeType} scene at ${locationName}`);
        }
      }
    }
  }

  /** Process a kill event through the consequence engine.
   *  killerId is optional — defaults to 'player'. Pass NPC id for NPC-on-NPC kills.
   *  eventType is the event type string registered by modules (e.g. 'NPC_KILLED'). */
  async processKill(victimId: string, killerId?: string, eventType?: string): Promise<{ killEvent: WorldEvent; results: any[] }> {
    const victim = this.agents.get(victimId);
    if (!victim || !victim.state.alive) {
      throw new Error(`Cannot kill ${victimId}: not found or already dead`);
    }

    const killer = killerId ? this.agents.get(killerId) : null;
    const killerSubject = killerId ?? 'player';
    const killerName = killer ? killer.profile.name : 'the player';

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
        killerName,
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
