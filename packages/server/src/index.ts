import { initFileLogger } from './logger';
const _logFile = initFileLogger();

import { Agent, VectorMemory, BeliefManager, RelationshipGraph, DEFAULT_TRUST, DEFAULT_SENTIMENT } from '@clwa/engine';
import { ConsequenceEngine } from '@clwa/engine';
import { InMemoryEventStore } from '@clwa/engine';
import { World, findPath } from '@clwa/engine';
import type { AgentProfile, AgentState, RelationType } from '@clwa/engine';
import type { LocationDef, LocationGraph, ScheduleEntry, NpcHome } from '@clwa/engine';
import { registerCrimeJusticeModule, registerSocialModule, CRIME_CG_RULES } from '@clwa/modules';
import { registerRoleTopicPool, registerSecretDirectiveBuilder, registerEventCategory, registerPressureTypes, registerPressureHandler, registerSpeechActs, registerClaimSources, registerILTradeVerbs, registerQuestionTopics, registerDefaultSpeechAct } from '@clwa/engine';
import {
  registerLlmProvider,
  registerLlmTask,
  registerLlmRouter,
  registerLlmUsageRecorder,
  registerLlmCostGate,
  registerTickPhaseHandler,
  validateLlmRouterContract,
  generate,
} from '@clwa/engine';
import { LMStudioProvider } from '@clwa/provider-lm-studio';
import { ClaudeCodeProvider } from '@clwa/provider-claude-code';
import { NpcMemoryManager } from './npc-memory-manager';
import { buildNpcSystemPrompt, buildNpcRelationships, buildNpcSecrets } from './llm-npc-prompt-builder';
import { buildDefaultRouter } from './llm-defaults';
import { LlmUsageTracker } from './llm-usage-tracker';

// Player action vocabulary — module-level constants, NOT engine
const PLAYER_ACTION_EVENT = 'PLAYER_ACTION';
const PLAYER_ACTIONS = { THREATEN: 'threaten', BRIBE: 'bribe' } as const;
import { broadcast } from './ws';
import { startServer, clearChatSessions } from './server';
import { loadWorld } from './world-loader';
import { PositionManager } from './position-manager';
import { randomizeTraits, logRandomization, randomizeMoods, logMoodRandomization, randomizeRelationships, logRelationshipRandomization, assignMotives } from './trait-randomizer';
import { type GameContext, LocationHistory } from './game-context';
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';

// ─── Register World Modules ───
registerSocialModule();          // universal social topic sources
registerCrimeJusticeModule();    // crime & justice affordances, CG rules, topic sources
registerEventCategory('player_action', [PLAYER_ACTION_EVENT]);

// ─── Memory consolidation tick handler (Stage 7a) ───
// Каждые N game-min проходим у каждого NPC observations.md. Если копится
// >keepRecent+consolidateOldest entries, oldest LLM-консолидируются в reflections.md.
// Config приоритет: worldData.config.memorySystem → env vars → defaults.
// Реальные значения резолвятся per-tick — config может измениться через /api/new-game.
registerTickPhaseHandler(async (ctx) => {
  const cfg = (ctx as unknown as { memorySystemConfig?: { consolidationIntervalMinutes?: number; observationsKeepRecent?: number; observationsConsolidateOldest?: number } }).memorySystemConfig;
  const intervalMin = cfg?.consolidationIntervalMinutes ?? Number(process.env.CLWA_CONSOLIDATION_INTERVAL ?? '60');
  const keepRecent = cfg?.observationsKeepRecent ?? Number(process.env.CLWA_OBS_KEEP_RECENT ?? '25');
  const consolidateOldest = cfg?.observationsConsolidateOldest ?? Number(process.env.CLWA_OBS_CONSOLIDATE ?? '25');
  if (ctx.gameMinute % intervalMin !== 0) return;
  for (const [npcId, agent] of ctx.agents) {
    if (!agent.state.alive || agent.profile.isPlayer) continue;
    try {
      const did = await npcMemory.consolidateObservations(
        npcId,
        async (prompt) =>
          await generate('reflection', {
            system: `You are the inner mind of ${agent.profile.name}, a ${agent.profile.role}. Distill experiences into wisdom.`,
            user: prompt,
            agentContext: { id: npcId },
          }),
        { keepRecent, consolidateOldest, gameMinute: ctx.gameMinute },
      );
      if (did) {
        console.log(`  [Memory] Consolidated ${consolidateOldest} observations for ${agent.profile.name} → reflections.md`);
      }
    } catch (err) {
      console.error(`  [Memory] Consolidation failed for ${npcId}:`, err);
    }
  }
});

// LLM tasks регистрируются МОДУЛЯМИ (Stage 8c). Server только wireup'ит infrastructure.
// Engine bootstrap уже зарегистрировал 'embeddings'. Crime-justice module — все остальные.

// ─── Register LLM providers (subscription auth: no ANTHROPIC_API_KEY needed) ───
const NPCS_ROOT = join(import.meta.dir, '../data/claude-npcs');

// LLM usage tracker — append JSONL log всех вызовов для cost/observability
export const llmUsageTracker = new LlmUsageTracker(join(import.meta.dir, '../data/llm-usage.jsonl'));
registerLlmUsageRecorder((event) => llmUsageTracker.record(event));

registerLlmProvider(new LMStudioProvider({
  baseUrl: process.env.LMSTUDIO_URL ?? 'http://localhost:1234',
}));

const npcMemory = new NpcMemoryManager(NPCS_ROOT);
// agentsByActiveCtx — позволяет ClaudeCodeProvider.onBeforeCall достать Agent по id.
// Заполняется в createGameContext после построения agents map.
let agentsByActiveCtx: Map<string, Agent> | null = null;
let worldByActiveCtx: World | null = null;
export function _setActiveCtxForLlmProvider(agents: Map<string, Agent>, world: World): void {
  agentsByActiveCtx = agents;
  worldByActiveCtx = world;
}

registerLlmProvider(new ClaudeCodeProvider({
  npcsRoot: NPCS_ROOT,
  maxConcurrency: Number(process.env.CLAUDE_CODE_MAX_CONCURRENCY ?? '4'),
  // Persistent session idle TTL for streaming player↔NPC dialogue (default 10 min; 0 = ephemeral).
  // Streaming on/off is the `dialogue` route in buildDefaultRouter / world.json config.llm.
  sessionIdleMs: Number(process.env.CLWA_CLAUDE_SESSION_IDLE_MS ?? '600000'),
  onBeforeCall: async (agentId) => {
    if (!agentsByActiveCtx || !worldByActiveCtx) return;  // boot not finished yet
    const agent = agentsByActiveCtx.get(agentId);
    if (!agent) return;  // unknown agent (e.g., '_default') — skip
    const gameMinute = worldByActiveCtx.getCurrentGameMinute?.() ?? agent.state.currentDay * 1440;
    const nameResolver = (id: string) => agentsByActiveCtx?.get(id)?.profile.name ?? id;
    const state = agent.serializeMemoryState(gameMinute, nameResolver);
    await npcMemory.snapshotState(agentId, state);
  },
}));

// ─── Stage 7b: cost gate (façade-level, universal across providers) ───
// env CLWA_MAX_LLM_USD_PER_BOOT=10 — façade блокирует все calls (любой task, любой провайдер)
// если cumulative cost за boot >= limit. 0 / unset = unlimited.
const MAX_LLM_USD = Number(process.env.CLWA_MAX_LLM_USD_PER_BOOT ?? '0');
if (MAX_LLM_USD > 0) {
  registerLlmCostGate(async (_task, _agentId) => {
    const { costUsd } = llmUsageTracker.getCumulativeCostSinceBoot();
    if (costUsd >= MAX_LLM_USD) {
      return { reason: `cumulative $${costUsd.toFixed(2)} ≥ limit $${MAX_LLM_USD}` };
    }
    return null;
  });
  console.log(`  [+] LLM cost gate enabled: $${MAX_LLM_USD} per boot`);
}

// ─── IL Vocabulary — speech acts, claim sources, trade verbs ───
registerSpeechActs([
  { act: 'inform',    benign: true },
  { act: 'question',  benign: true },
  { act: 'request' },
  { act: 'accuse',    accusation: true },
  { act: 'threaten' },
  { act: 'compliment', benign: true },
  { act: 'insult' },
  { act: 'bribe' },
  { act: 'confide',   benign: true },
  { act: 'trade',     benign: true, trade: true },
  { act: 'smalltalk', benign: true },
]);
registerClaimSources(['witnessed', 'heard', 'suspects', 'deduced']);
registerILTradeVerbs(['buy', 'sell', 'browse', 'trade']);
registerQuestionTopics(['whereabouts', 'opinion', 'knowledge', 'relationship', 'secret']);
registerDefaultSpeechAct('smalltalk');

// ─── Pressure Types — emotional pressure vocabulary for IL constrained decoding ───
registerPressureTypes(['threat', 'bribe', 'flattery', 'guilt', 'intimidation']);

// ─── Pressure Handlers — module-specific side effects per pressure type ───
registerPressureHandler('threat', async (ctx) => {
  const iv = ctx.importanceValues.threat ?? { base: 3, intensityMultiplier: 4 };
  const imp = Math.round(iv.base + ctx.intensity * (iv.intensityMultiplier ?? 0));
  ctx.pushEffect({ type: 'event_stored', eventType: PLAYER_ACTION_EVENT, action: 'threaten' });
  ctx.storeEvent({
    id: crypto.randomUUID(), type: PLAYER_ACTION_EVENT,
    subject: ctx.playerId, object: ctx.npcId,
    location: ctx.npcLocation, gameDay: ctx.gameDay,
    importance: imp, payload: { action: PLAYER_ACTIONS.THREATEN, intensity: ctx.intensity },
  });
  const text = `${ctx.playerName} threatened me. ${ctx.intensity > 0.5 ? 'It was frightening.' : 'It was unsettling.'}`;
  await ctx.observe(text, imp);
  ctx.pushEffect({ type: 'memory_stored', text, importance: imp });
  return [`You feel ${ctx.intensity > 0.7 ? 'genuinely afraid' : ctx.intensity > 0.4 ? 'uneasy and defensive' : 'slightly annoyed by the posturing'}.`];
});

registerPressureHandler('bribe', async (ctx) => {
  const imp = ctx.importanceValues.bribe?.base ?? 5;
  ctx.pushEffect({ type: 'event_stored', eventType: PLAYER_ACTION_EVENT, action: 'bribe' });
  ctx.storeEvent({
    id: crypto.randomUUID(), type: PLAYER_ACTION_EVENT,
    subject: ctx.playerId, object: ctx.npcId,
    location: ctx.npcLocation, gameDay: ctx.gameDay,
    importance: imp, payload: { action: PLAYER_ACTIONS.BRIBE, intensity: ctx.intensity },
  });
  const text = `${ctx.playerName} tried to bribe me.`;
  await ctx.observe(text, imp);
  ctx.pushEffect({ type: 'memory_stored', text, importance: imp });
  return [`${ctx.playerName} is offering you something in exchange for a favor. ${ctx.npcHonesty >= 0.6 ? 'This offends your sense of integrity.' : 'The offer is... tempting.'}`];
});

registerPressureHandler('flattery', async (ctx) => {
  return [`${ctx.playerName} is being very complimentary. ${ctx.npcAgreeableness >= 0.6 ? 'You appreciate the kind words.' : 'You wonder what they want.'}`];
});

registerPressureHandler('guilt', async (_ctx) => {
  return [`${_ctx.playerName}'s words hit close to home. You feel a pang of guilt.`];
});

registerPressureHandler('intimidation', async (ctx) => {
  return [`You feel pressured by ${ctx.playerName}'s demeanor.`];
});

// ─── Role Topic Pools — now loaded from worlds/*/topics.json by world-loader ───

// ─── Secret Directive Builders (player interaction effects) ───
registerSecretDirectiveBuilder(({ agent, agents, eventStore }) => {
  const agentId = agent.profile.id;
  const sections: string[] = [];
  // Resolve player name from agents map
  let pName: string | null = null;
  for (const a of agents.values()) {
    if (a.profile.isPlayer) { pName = a.profile.name; break; }
  }
  if (!pName) {
    console.error('  [SecretDirective] BUG: Player Agent not found in agents map');
    return sections;
  }

  const threatMemories = eventStore.query({ type: PLAYER_ACTION_EVENT })
    .filter((e) => e.object === agentId && (e.payload?.action === PLAYER_ACTIONS.THREATEN));
  if (threatMemories.length > 0) {
    sections.push(
      `## HIDDEN: You have been threatened\n` +
      `${pName} threatened you recently. You are afraid of them.\n` +
      `- When talking to ${pName}: be cautious, guarded, avoid provoking them.\n` +
      `- You might comply with their requests out of fear, though you resent it.\n` +
      `- If someone else asks about the threat: you might mention it nervously.`,
    );
  }

  const bribeMemories = eventStore.query({ type: PLAYER_ACTION_EVENT })
    .filter((e) => e.object === agentId && (e.payload?.action === PLAYER_ACTIONS.BRIBE));
  if (bribeMemories.length > 0) {
    sections.push(
      `## HIDDEN: You were offered a bribe\n` +
      `${pName} tried to bribe you. This makes you uncomfortable.\n` +
      `- You feel conflicted — the offer is tempting but wrong.\n` +
      `- If asked about shady dealings: you become evasive.`,
    );
  }

  return sections;
});

// ─── Persistence ───

const SAVE_DIR = join(dirname(import.meta.dir), 'data');
const SAVE_PATH = join(SAVE_DIR, 'save.json');

interface SaveData {
  version: 1;
  savedAt: string;
  seed?: number;
  world: ReturnType<World['toJSON']>;
  events: ReturnType<InMemoryEventStore['toJSON']>;
  positions?: Record<string, { x: number; y: number }>;
}

function saveToDisk(ctx: GameContext): void {
  if (ctx.resetting) return; // don't save during reset
  const data: SaveData = {
    version: 1,
    savedAt: new Date().toISOString(),
    seed: ctx.seed,
    world: ctx.world.toJSON(),
    events: ctx.eventStore.toJSON(),
    positions: ctx.positionManager?.toJSON(),
  };
  mkdirSync(SAVE_DIR, { recursive: true });
  // Compact stringify — vectors in memories make pretty-print ~4x larger
  writeFileSync(SAVE_PATH, JSON.stringify(data));
  console.log(`  [Save] State saved to ${SAVE_PATH}`);
}

function loadFromDisk(): SaveData | null {
  if (!existsSync(SAVE_PATH)) return null;
  try {
    const raw = readFileSync(SAVE_PATH, 'utf-8');
    const data = JSON.parse(raw) as SaveData;
    if (data.version !== 1) {
      console.warn(`  [Save] Unknown save version ${data.version}, ignoring`);
      return null;
    }
    return data;
  } catch (err) {
    console.warn(`  [Save] Failed to load save: ${err}`);
    return null;
  }
}
function buildLocationGraph(locs: LocationDef[]): LocationGraph {
  const graph: LocationGraph = new Map();
  for (const loc of locs) {
    graph.set(loc.id ?? loc.name, loc);
  }
  return graph;
}
function makeState(location: string, npcId: string, wd: import('./world-loader').LoadedWorld, startMinute: number, profile: AgentProfile): AgentState {
  const bf = profile.bigFive;
  const baseMood = 0.3 - bf.neuroticism * 0.4 + bf.extraversion * 0.2;
  return {
    alive: true,
    status: undefined,
    location,
    mood: wd.startingMoods[npcId] ?? baseMood,
    baseMood,
    moodModifiers: (() => {
      // Starting mood offset as initial modifier — preserves randomization
      const startMood = wd.startingMoods[npcId];
      if (startMood != null && Math.abs(startMood - baseMood) > 0.01) {
        return [{ id: 'initial_mood', source: 'initial_conditions', category: 'event',
          magnitude: startMood - baseMood, remaining: 1440, duration: 1440,
          decay: 'exponential' as const }];
      }
      return [];
    })(),
    currentDay: 1,
    knownFacts: wd.lore.slice(),
    processingState: 'idle',
    beliefs: new BeliefManager(),
    relationships: buildRelationshipsFromData(npcId, wd.profiles, wd.relationships),
    lastInteractionMinute: startMinute, // explicit init — no loneliness on first tick
  };
}

function buildRelationshipsFromData(npcId: string, profiles: AgentProfile[], rels: Array<{from: string; to: string; type: string; sentiment?: number; trust?: number}>): RelationshipGraph {
  const graph = new RelationshipGraph();
  for (const def of rels) {
    if (def.from !== npcId) continue;
    const target = profiles.find(p => p.id === def.to);
    if (!target) continue;
    graph.addRelationship({
      targetId: def.to,
      targetName: target.name,
      type: def.type as RelationType,
      sentiment: def.sentiment ?? DEFAULT_SENTIMENT[def.type as RelationType],
      trust: def.trust ?? DEFAULT_TRUST[def.type as RelationType],
    });
  }
  return graph;
}

// ─── Bootstrap ───

const PORT = parseInt(process.env.PORT ?? '3000');

/**
 * Create a fresh game world. Repeatable — called on boot and on POST /api/new-game.
 * Does NOT call loadState (that's boot-only, handled by caller).
 * Does NOT set ctx.resetting (caller controls lifecycle).
 * Does NOT register modules (one-time, done in main).
 */
async function createGameContext(
  worldPath: string,
  seed: number,
  cgEngine: ConsequenceEngine,
  locationGraph: LocationGraph,
): Promise<Omit<GameContext, 'resetting'>> {
  const worldData = loadWorld(worldPath);

  // ─── LLM Router (idempotent — re-register on new-game with same config) ───
  // worldData.config — narrow subset; cast для миграционного helper'а.
  const llmConfig = (worldData.config as { llm?: ReturnType<typeof buildDefaultRouter> }).llm;
  registerLlmRouter(llmConfig ?? buildDefaultRouter());
  validateLlmRouterContract();
  console.log('  [+] LLM Router configured + validated');

  // ─── Randomization ───
  if (worldData.traitRanges.size > 0) {
    randomizeTraits(worldData.profiles, seed, worldData.traitRanges);
    logRandomization(worldData.profiles, seed);
  }
  if (worldData.moodRanges.size > 0) {
    randomizeMoods(worldData.startingMoods, seed, worldData.moodRanges);
    logMoodRandomization(worldData.startingMoods, worldData.profiles);
  }
  randomizeRelationships(worldData.relationships, seed);
  logRelationshipRandomization(worldData.relationships);

  const eventStore = new InMemoryEventStore();
  console.log('  [+] Event Store');

  // ─── Per-NPC Claude folders (for ClaudeCodeProvider) ───
  const nameById = (id: string) => worldData.profiles.find(p => p.id === id)?.name ?? id;
  for (const profile of worldData.profiles) {
    await npcMemory.ensureNpcDir(profile.id, {
      personality: buildNpcSystemPrompt(profile),
      relationships: buildNpcRelationships(profile.id, profile.name, worldData.relationships, nameById),
      secrets: buildNpcSecrets(profile),
    });
  }
  console.log(`  [+] NPC Claude folders prepared (${worldData.profiles.length} NPCs)`);

  // ─── Agents ───
  const agents = new Map<string, Agent>();
  for (const profile of worldData.profiles) {
    const npcLocation = worldData.startingLocations.get(profile.id) ?? profile.id;
    const memory = new VectorMemory(profile.id);
    await memory.init({ reset: true });
    const startMin = worldData.config.startMinute ?? 420;
    const agent = new Agent(profile, makeState(npcLocation, profile.id, worldData, startMin, profile), memory, {
      reflection: { threshold: 30 },
      onReflection: (name, text) => {
        console.log(`  [Reflection] ${name}: "${text}"`);
        broadcast({ type: 'reflection', data: { agentName: name, text } });
        // Reflection — это значимая «эпифания» NPC, дописываем в reflections.md
        npcMemory.appendMemory(profile.id, 'reflection', text, agent.state.currentDay * 1440).catch(() => {});
      },
      // Observations → file memory для ClaudeCodeProvider'а (Claude видит через @-import в CLAUDE.md)
      onObserve: (text, _importance, gameMinute) => {
        npcMemory.appendMemory(profile.id, 'observation', text, gameMinute).catch(() => {});
      },
      locationResolver: (id) => locationGraph.get(id)?.name ?? id,
      nameResolver: (id) => agents.get(id)?.profile.name ?? id,
    });
    agents.set(profile.id, agent);
    console.log(`  [+] ${profile.name} the ${profile.role} @ ${npcLocation}`);
  }

  // ─── Schedule Knowledge (alibi system) ───
  // NPCs who know each other (have relationships) know each other's daily routines.
  // This enables alibi-relevant conversation: "Mark is usually at the Market in the morning."
  for (const [npcId, agent] of agents) {
    if (agent.profile.isPlayer) continue;
    const rels = agent.state.relationships?.getAllRelationships() ?? [];
    for (const rel of rels) {
      const otherProfile = worldData.profiles.find(p => p.id === rel.targetId);
      if (!otherProfile) continue;
      const otherSchedule = worldData.schedules.filter(s => s.npcId === rel.targetId);
      if (otherSchedule.length === 0) continue;
      // Only friends and colleagues know detailed schedules
      if (rel.type !== 'friend' && rel.type !== 'colleague') continue;
      const routineParts = otherSchedule
        .slice(0, 3) // max 3 schedule entries per NPC
        .map(s => `${s.period}: ${locationGraph.get(s.location)?.name ?? s.location}`)
        .join(', ');
      agent.state.knownFacts.push(
        `${otherProfile.name} the ${otherProfile.role}'s routine: ${routineParts}.`,
      );
    }
  }

  // ─── Position Manager ───
  const positionManager = new PositionManager();
  positionManager.loadZones(worldData.zones);
  // Server-side A* walkable grid. map-data.json is a global public asset (the Millhaven tilemap),
  // so it loads here (server bootstrap), NOT in world-loader which is per-world (worldDir-scoped).
  const mapDataPath = join(import.meta.dir, '../public/map-data.json');
  if (existsSync(mapDataPath)) {
    const mapData = JSON.parse(readFileSync(mapDataPath, 'utf-8')) as { tiles: [number, number, number, number][]; tileSize: number };
    positionManager.loadWalkableGrid(mapData);
    const drift = positionManager.checkZoneCentersWalkable();
    if (drift.length > 0) console.warn(`  [⚠ map] ${drift.length} zone center(s) on non-walkable tiles (tilemap/zone drift): ${drift.join(', ')}`);
    else console.log(`  [+] Walkable grid loaded (${mapData.tiles.length} tiles)`);
  } else {
    console.warn(`  [⚠ map] map-data.json not found at ${mapDataPath} — NPC pathfinding falls back to direct segments`);
  }
  for (const [id, agent] of agents) {
    if (!positionManager.getPosition(id)) {
      positionManager.initPosition(id, agent.state.location);
    }
  }
  console.log(`  [+] Positions initialized for ${agents.size} entities`);

  // ─── Background memories ───
  const bgMemories = worldData.backgroundMemories;
  for (const [npcId, agent] of agents) {
    const memories = bgMemories[npcId];
    if (!memories || !agent.memory) continue;
    for (const memText of memories) {
      await agent.memory.store(memText, 6, 0);
    }
  }
  console.log(`  [+] Background memories seeded for ${Object.keys(bgMemories).length} NPCs`);

  // ─── Starting beliefs (secrets) ───
  for (const secret of worldData.secrets) {
    const npcAgent = agents.get(secret.npcId);
    if (npcAgent?.state.beliefs) {
      npcAgent.state.beliefs.addBelief({
        id: crypto.randomUUID(),
        eventType: secret.eventType,
        subject: secret.subject,
        object: secret.object,
        location: null,
        confidence: secret.confidence,
        source: secret.source,
        sourceNpcId: null,
        gameDay: 1,
        lastUpdated: 1,
      });
    }
  }
  if (worldData.secrets.length > 0) {
    console.log(`  [+] Secret knowledge seeded for ${worldData.secrets.length} NPCs`);
  }

  // ─── Starting motives (SPEC-motive-pool) ───
  if (worldData.motives.length > 0) {
    await assignMotives(agents, worldData.motives, seed);
  }

  // ─── Player Agent ───
  const playerProfile: AgentProfile = {
    id: 'player',
    name: 'Traveler',
    role: 'traveler',
    background: 'A mysterious traveler who arrived in town recently.',
    speechStyle: '',
    bigFive: { openness: 0.5, conscientiousness: 0.5, extraversion: 0.5, agreeableness: 0.5, neuroticism: 0.5, honesty: 0.5 },
    enneagram: { type: 5, wing: 6, coreFear: '', coreDesire: '', stressType: 7, growthType: 8 },
    isPlayer: true,
  };
  const playerRelationships = new RelationshipGraph();
  for (const p of worldData.profiles) {
    playerRelationships.addRelationship({
      targetId: p.id, targetName: p.name,
      type: 'acquaintance' as RelationType, sentiment: 0.0, trust: 0.3,
    });
  }
  for (const [, npcAgent] of agents) {
    npcAgent.state.relationships?.addRelationship({
      targetId: 'player', targetName: 'Traveler',
      type: 'acquaintance' as RelationType, sentiment: 0.0, trust: 0.3,
    });
  }
  const playerMemory = new VectorMemory('player');
  await playerMemory.init({ reset: true });
  const playerAgent = new Agent(playerProfile, {
    alive: true, status: undefined,
    location: worldData.locationNameToId.get('Town Square') ?? 'town-square',
    mood: 0.3, baseMood: 0.3, moodModifiers: [], currentDay: 1,
    knownFacts: ['# You are a traveler who just arrived in this small town. You know nothing about the locals yet.'],
    beliefs: new BeliefManager(),
    relationships: playerRelationships,
  }, playerMemory, {
    locationResolver: (id) => locationGraph.get(id)?.name ?? id,
  });
  agents.set('player', playerAgent);
  positionManager.initPosition('player', playerAgent.state.location);
  positionManager.setPlayerId('player'); // INV-16: excluded from advancePositions (player walks client-side)
  console.log('  [+] Player Agent (Traveler) @ Town Square');

  // ─── Public places ───
  const publicPlaces = new Set<string>();
  for (const [id, loc] of locationGraph) {
    if (loc.isPublic) publicPlaces.add(id);
  }

  // ─── World ───
  const approachContexts = new Map<string, string>();
  const locationHistory = new LocationHistory();

  const world = new World(
    agents, eventStore, cgEngine,
    {
      minConversationScore: 1, publicPlaces, pairCooldownMinutes: 240, affordanceCooldownMinutes: 180, decisionCooldownMinutes: 60, startMinute: worldData.config.startMinute ?? 420,
      il: {
        pressureEffects: {
          threat:       { mood: -0.20, sentiment: -0.15, trust: -0.10 },
          bribe:        { mood:  0,    sentiment:  0,    trust:  0    },
          flattery:     { mood:  0.10, sentiment:  0.05, trust:  0.05 },
          guilt:        { mood: -0.10, sentiment:  0,    trust:  0    },
          intimidation: { mood: -0.15, sentiment: -0.10, trust: -0.10 },
        },
        speechActEffects: {
          compliment: { mood: 0.08, sentiment: 0.05, trust: 0.03, memoryText: '$player said something kind to me.', memoryImportance: 2 },
          insult:     { mood: -0.08, sentiment: -0.08, trust: -0.05, memoryText: '$player insulted me.', memoryImportance: 3 },
        },
        importanceValues: {
          threat:     { base: 3, intensityMultiplier: 4 },
          bribe:      { base: 5 },
          compliment: { base: 2 },
          insult:     { base: 3 },
        },
      },
    },
    {
      onLine: (line) => {
        console.log(`    ${line.speakerName}: "${line.text}"`);
        broadcast({ type: 'conversation:line', data: line });
      },
      onConversation: (result) => {
        let approachPoints = null;
        if (agents.has(result.initiator) && agents.has(result.responder)) {
          approachPoints = positionManager.computeApproachPoints(result.initiator, result.responder);
        }
        broadcast({ type: 'conversation:complete', data: { ...result, approachPoints } });
      },
      onTick: (result) => {
        if (result.time) {
          console.log(`  [Time] Tick ${result.tickNumber} — ${result.time.hour} (${result.time.period})`);
        }
        if (result.dayAdvanced) {
          console.log(`  [Time] === Day ${result.gameDay} ===`);
        }
        if (result.approaches) {
          for (const approach of result.approaches) {
            approachContexts.set(approach.npcId, approach.promptContext);
            broadcast({ type: 'npc_approach', data: approach });
            console.log(`  [Approach] ${approach.npcName} wants to talk to player`);
          }
        }
        broadcast({ type: 'tick', data: result });
      },
      onMovement: (movements) => {
        const enriched = movements.map(m => {
          if (m.arrived) {
            // Arrival is position-authoritative (advancePositions already moved the NPC into the zone and
            // cleared transit); completeMovement is now an idempotent no-op (no stale-target teleport).
            positionManager.completeMovement(m.agentId);
            const pos = positionManager.getPosition(m.agentId);
            console.log(`  [Arrived] ${m.agentName} at ${m.to}`);
            return { ...m, x: pos?.x ?? 0, y: pos?.y ?? 0, targetX: pos?.x ?? 0, targetY: pos?.y ?? 0, arrived: true };
          }
          // Movement start: server computes the logical hop path + A* pixel waypoints, then broadcasts
          // waypoints + speed (px per game-minute). NO timer write — INV-14: engine owns agent.state transit.
          const path = findPath(locationGraph, m.from, m.to) ?? [m.to];
          const target = positionManager.startMovement(m.agentId, path);
          const pos = positionManager.getPosition(m.agentId);
          console.log(`  [Move] ${m.agentName}: ${m.from} -> ${m.to} (${path.length} hops, ${target.path.length} waypoints, ${Math.round(target.distance)}px)`);
          return { ...m, x: pos?.x ?? 0, y: pos?.y ?? 0, targetX: target.targetX, targetY: target.targetY, waypoints: target.path, speed: positionManager.transitSpeed };
        });
        broadcast({ type: 'movement', data: enriched });
      },
      onGoalAction: (action) => {
        console.log(`  [Goal] ${action.ownerName}: ${action.description}`);
        broadcast({ type: 'goal:action', data: action });
      },
      onAgentDeath: (killerId, victimId, killerName, affectedName) => {
        console.log(`  [MURDER] ${killerName} killed ${affectedName}!`);
        broadcast({ type: 'murder', data: { killerId, victimId, killerName, affectedName } });
      },
      onLlmCall: (reason, target) => {
        broadcast({ type: 'debug:llm', data: { reason, target } });
      },
      onRelationshipChange: (fromId, fromName, toId, toName, field, oldVal, newVal) => {
        broadcast({ type: 'relationship_change', data: { fromId, fromName, toId, toName, field, oldVal: +oldVal.toFixed(2), newVal: +newVal.toFixed(2) } });
      },
      onCascade: (trigger, consequences) => {
        if (consequences.length > 0) {
          broadcast({ type: 'event_cascade', data: {
            triggerId: trigger.id, triggerType: trigger.type,
            consequences: consequences.map(e => ({ type: e.type, subject: e.subject, object: e.object, importance: e.importance })),
          }});
        }
      },
      onJournalEntry: (entry) => {
        broadcast({ type: 'journal:entry', data: entry });
      },
      onGoalChange: (data) => {
        const agent = agents.get(data.npcId);
        broadcast({ type: 'goal_update', data: { ...data, npcName: agent?.profile.name ?? data.npcId } });
      },
      onMoodChange: (npcId, npcName, oldMood, newMood) => {
        broadcast({ type: 'mood_update', data: { npcId, npcName, oldMood: +oldMood.toFixed(2), newMood: +newMood.toFixed(2) } });
      },
      onDecision: (data) => {
        console.log(`  [Decision] ${data.npcName} → ${data.action}${data.target ? ' ' + data.target : ''} (${data.instinctTier}, ${data.topScore.toFixed(2)})`);
        broadcast({ type: 'npc_thought', data });
      },
      onSceneResidue: (scene) => {
        broadcast({ type: 'crime:scene', data: {
          id: scene.id, locationId: scene.locationId, crimeType: scene.sceneType, pointCount: scene.points.length,
        }});
      },
      onTimeUpdate: (minuteOfDay, hour, period, gameDay) => {
        // Position-authoritative transit (Item 2): advance pixel positions by 1 game-minute, then route
        // arrivals + intermediate-zone crossings into the engine (INV-14: only engine mutates agent.state).
        const { arrivals, intermediates } = positionManager.advancePositions(1);
        if (arrivals.length > 0) world.handleArrivals(arrivals);
        for (const it of intermediates) world.handleIntermediateLocationUpdate(it.entityId, it.location);
        broadcast({ type: 'time_update', data: { minuteOfDay, hour, period, gameDay } });
        // Record NPC locations for alibi checking (every game minute via time update)
        const gameMinute = (gameDay - 1) * 1440 + minuteOfDay;
        for (const [id, agent] of agents) {
          if (agent.state.alive && !agent.profile.isPlayer) {
            locationHistory.record(id, gameMinute, agent.state.location);
          }
        }
      },
    },
    locationGraph,
    { mobileNpcs: worldData.mobileNpcs, moveProbability: 0.08 },
    worldData.schedules,
    worldData.homes,
  );
  console.log('  [+] World orchestrator');
  console.log(`  [+] NPC schedules: ${worldData.schedules.length} entries for ${new Set(worldData.schedules.map((s) => s.npcId)).size} NPCs`);
  console.log(`  [+] Mobile NPCs: ${Array.from(worldData.mobileNpcs).join(', ')}`);

  // Stage 5: wire active agents/world для ClaudeCodeProvider.onBeforeCall snapshot
  _setActiveCtxForLlmProvider(agents, world);

  return { world, eventStore, agents, positionManager, approachContexts, locationHistory, seed };
}

async function main() {
  console.log('=== CLWA Server — Starting ===');
  console.log(`  [Log] Writing to: ${_logFile}`);
  console.log();

  // ─── One-time setup ───
  const worldPath = process.argv.find(a => a.startsWith('--world='))?.split('=')[1]
    ?? join(dirname(dirname(dirname(import.meta.dir))), 'worlds', 'millhaven');

  const savedData = loadFromDisk();
  if (savedData) {
    console.log(`  [Save] Found save from ${savedData.savedAt}`);
  }

  const seedArg = process.argv.find(a => a.startsWith('--seed='))?.split('=')[1];
  const initialSeed = seedArg ? parseInt(seedArg, 10)
    : savedData?.seed ?? Date.now();

  // Location graph — reusable across new-games (world topology doesn't change)
  const worldData = loadWorld(worldPath);
  const locationGraph = buildLocationGraph(worldData.locations);
  console.log(`  [+] Location Graph — ${locationGraph.size} locations`);

  // CG engine — created once, callback reads ctx (not captured refs)
  // Pre-allocate context — fields filled by Object.assign(ctx, initial) below.
  // Must exist before CG engine creation (callback captures ctx reference).
  const ctx = { resetting: false } as GameContext;
  const cgEngine = new ConsequenceEngine(CRIME_CG_RULES, {
    onEvent: (event) => {
      ctx.eventStore.append(event);
      broadcast({ type: 'event', data: event });
      // handleEventForGoals NOT called here — all World callers (checkBodyDiscovery,
      // processKill, _handleGoalStep) already call it for cascade results with proper await.
      // Calling it here would double-process events AND violate INV-02 (unawaited async).
    },
  });
  console.log(`  [+] Consequence engine — ${CRIME_CG_RULES.length} rules`);

  // ─── First game context ───
  const initial = await createGameContext(worldPath, initialSeed, cgEngine, locationGraph);
  Object.assign(ctx, initial, { resetting: false });

  // Restore from save (boot only, never on new-game)
  if (savedData) {
    ctx.eventStore.loadFromJSON(savedData.events);
    console.log(`  [+] Event Store — restored ${savedData.events.length} events`);
    ctx.world.loadState(savedData.world);
    console.log(`  [Save] World state restored (gameMinute ${savedData.world.gameMinute ?? 'N/A'}, ${Object.keys(savedData.world.agents).length} agents)`);
    if (savedData.positions) {
      const pending = ctx.positionManager.loadFromJSON(savedData.positions);
      console.log(`  [+] Positions restored from save`);
      // Mid-transit resume (Item 2 / INV-21 / D5): recompute the A* path from the saved LIVE pixel and
      // re-establish engine transit intent — else engine inTransit (transient) stays false on load, so
      // handleArrivals early-returns and the NPC freezes forever while goals keep re-issuing transit.
      for (const { id, transitTo, transitPath } of pending) {
        const agent = ctx.agents.get(id);
        if (!agent) continue;
        if (ctx.positionManager.restoreTransit(id, transitTo, transitPath)) {
          ctx.world.startTransit(agent, transitTo); // engine intent (inTransit/transitPath); server drives arrival
        } else {
          ctx.world.handleArrivals([{ entityId: id, location: transitTo }]); // unreachable → snap to destination
        }
      }
      if (pending.length > 0) console.log(`  [+] Resumed ${pending.length} in-transit NPC(s) from save`);
    }

    // Async memory restore: init Qdrant without reset, then load memories from save
    await Promise.all(
      Array.from(ctx.agents.entries()).map(async ([id, agent]) => {
        await agent.memory.init({ reset: false });
        const memories = savedData.world.agents[id]?.memories ?? [];
        if (memories.length > 0) {
          await agent.memory.loadState(memories);
          console.log(`  [Memory] ${agent.profile.name}: ${memories.length} memories restored`);
        }
      }),
    );
  }

  // ─── New Game handler (exposed to routes via ctx) ───
  ctx.newGame = async (newSeed: number) => {
    ctx.resetting = true;
    try {
      // Graceful shutdown
      ctx.world.stopMasterClock();
      ctx.world.processingQueue.clear();
      await ctx.world.processingQueue.drain();
      // Build new context
      console.log(`\n=== New Game (seed: ${newSeed}) ===`);
      const newCtx = await createGameContext(worldPath, newSeed, cgEngine, locationGraph);
      // Clear stale chat sessions from previous game
      clearChatSessions();
      // Broadcast BEFORE unlock
      broadcast({ type: 'new_game', data: { seed: newSeed } });
      // Atomic swap (newCtx does NOT contain resetting)
      Object.assign(ctx, newCtx);
      ctx.world.startMasterClock();
      // Delete old save
      try { unlinkSync(SAVE_PATH); } catch {}
      console.log('  [+] New game ready\n');
    } catch (err) {
      console.error('  [NewGame] Failed:', err);
      // Restart old world if new one failed
      if (!ctx.world.isAutoTicking) {
        ctx.world.startMasterClock();
      }
    } finally {
      ctx.resetting = false;
    }
  };

  // Expose onSave for routes.ts POST /api/save
  ctx.onSave = () => saveToDisk(ctx);

  // ─── Start server ───
  const server = startServer(ctx, { port: PORT });
  console.log();
  console.log(`  HTTP:  http://localhost:${server.port}/api/agents`);
  console.log(`  WS:    ws://localhost:${server.port}/ws`);
  console.log();
  console.log('  REST endpoints:');
  console.log('    GET  /api/agents            — all NPCs');
  console.log('    GET  /api/events            — event log');
  console.log('    GET  /api/state             — world state');
  console.log('    GET  /api/locations          — location graph');
  console.log('    GET  /api/memories/:id       — agent memories');
  console.log('    GET  /api/beliefs/:id        — agent beliefs');
  console.log('    GET  /api/relationships/:id  — agent relationships');
  console.log('    POST /api/new-game           — start new game');
  console.log('    POST /api/save               — save state to disk');
  console.log();
  console.log('  Server ready. Waiting for connections...');

  // Start Master Clock
  ctx.world.startMasterClock();

  const shutdown = async () => {
    if (ctx.resetting) { console.log('\n  Reset in progress, exiting'); process.exit(0); return; }
    console.log('\n  [Save] Shutting down — flushing pending work...');
    ctx.world.stopMasterClock();
    await ctx.world.flushPending();
    saveToDisk(ctx);
    process.exit(0);
  };
  process.on('SIGINT', () => { shutdown(); });
  process.on('SIGTERM', () => { shutdown(); });
}

main().catch(console.error);
