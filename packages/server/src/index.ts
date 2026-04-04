import { initFileLogger } from './logger';
const _logFile = initFileLogger();

import { Agent, VectorMemory, BeliefManager, RelationshipGraph, DEFAULT_TRUST, DEFAULT_SENTIMENT } from '@clwa/engine';
import { ConsequenceEngine } from '@clwa/engine';
import { InMemoryEventStore } from '@clwa/engine';
import { World } from '@clwa/engine';
import type { AgentProfile, AgentState, RelationType } from '@clwa/engine';
import type { LocationDef, LocationGraph, ScheduleEntry, NpcHome } from '@clwa/engine';
import { registerCrimeJusticeModule, registerSocialModule, CRIME_CG_RULES } from '@clwa/modules';
import { registerRoleTopicPool, registerSecretDirectiveBuilder, registerEventCategory, PLAYER_ACTION_EVENT, PLAYER_ACTIONS } from '@clwa/engine';
import { broadcast } from './ws';
import { startServer } from './server';
import { loadWorld } from './world-loader';
import { PositionManager } from './position-manager';
import { randomizeTraits, logRandomization, randomizeMoods, logMoodRandomization, randomizeRelationships, logRelationshipRandomization } from './trait-randomizer';
import type { GameContext } from './game-context';
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';

// ─── Register World Modules ───
registerSocialModule();          // universal social topic sources
registerCrimeJusticeModule();    // crime & justice affordances, CG rules, topic sources
registerEventCategory('player_action', [PLAYER_ACTION_EVENT]);

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
  writeFileSync(SAVE_PATH, JSON.stringify(data, null, 2));
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
      },
      locationResolver: (id) => locationGraph.get(id)?.name ?? id,
    });
    agents.set(profile.id, agent);
    console.log(`  [+] ${profile.name} the ${profile.role} @ ${npcLocation}`);
  }

  // ─── Position Manager ───
  const positionManager = new PositionManager();
  positionManager.loadZones(worldData.zones);
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
  console.log('  [+] Player Agent (Traveler) @ Town Square');

  // ─── Public places ───
  const publicPlaces = new Set<string>();
  for (const [id, loc] of locationGraph) {
    if (loc.isPublic) publicPlaces.add(id);
  }

  // ─── World ───
  const approachContexts = new Map<string, string>();

  const world = new World(
    agents, eventStore, cgEngine,
    { minConversationScore: 1, publicPlaces, pairCooldownMinutes: 240, affordanceCooldownMinutes: 180, decisionCooldownMinutes: 60, startMinute: worldData.config.startMinute ?? 420 },
    {
      onLine: (line) => {
        console.log(`    ${line.speakerName}: "${line.text}"`);
        broadcast({ type: 'conversation:line', data: line });
      },
      onConversation: (result) => {
        const initId = [...agents.entries()].find(([, a]) => a.profile.name === result.initiator)?.[0];
        const respId = [...agents.entries()].find(([, a]) => a.profile.name === result.responder)?.[0];
        let approachPoints = null;
        if (initId && respId) {
          approachPoints = positionManager.computeApproachPoints(initId, respId);
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
          const agent = agents.get(m.agentId);
          if (m.arrived) {
            // NPC arrived — snap to target position, no new movement
            positionManager.completeMovement(m.agentId);
            const pos = positionManager.getPosition(m.agentId);
            console.log(`  [Arrived] ${m.agentName} at ${m.to}`);
            return { ...m, x: pos?.x ?? 0, y: pos?.y ?? 0, targetX: pos?.x ?? 0, targetY: pos?.y ?? 0, transitDuration: 0 };
          }
          const target = positionManager.startMovement(m.agentId, m.to);
          const pos = positionManager.getPosition(m.agentId);
          // Distance-based transit: fixed speed, variable time
          const TRANSIT_PX_PER_MIN = 80;
          const MIN_TRANSIT_MIN = 3;
          const distanceDuration = Math.max(MIN_TRANSIT_MIN, Math.ceil(target.distance / TRANSIT_PX_PER_MIN));
          // Override engine's flat hops*minutesPerHop with distance-proportional value
          if (agent) agent.state.transitDuration = distanceDuration;
          console.log(`  [Move] ${m.agentName}: ${m.from} -> ${m.to} (${Math.round(target.distance)}px, ${distanceDuration}min)`);
          return { ...m, x: pos?.x ?? 0, y: pos?.y ?? 0, targetX: target.targetX, targetY: target.targetY, transitDuration: distanceDuration };
        });
        broadcast({ type: 'movement', data: enriched });
      },
      onGoalAction: (action) => {
        console.log(`  [Goal] ${action.ownerName}: ${action.description}`);
        broadcast({ type: 'goal:action', data: action });
      },
      onMurder: (killerId, victimId, killerName, victimName) => {
        console.log(`  [MURDER] ${killerName} killed ${victimName}!`);
        broadcast({ type: 'murder', data: { killerId, victimId, killerName, victimName } });
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
      onCrimeScene: (scene) => {
        broadcast({ type: 'crime:scene', data: {
          id: scene.id, locationId: scene.locationId, crimeType: scene.crimeType, pointCount: scene.points.length,
        }});
      },
      onTimeUpdate: (minuteOfDay, hour, period, gameDay) => {
        broadcast({ type: 'time_update', data: { minuteOfDay, hour, period, gameDay, gameSpeed: world.gameSpeed } });
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

  return { world, eventStore, agents, positionManager, approachContexts, seed };
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
      ctx.world?.handleEventForGoals(event);
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
      ctx.positionManager.loadFromJSON(savedData.positions);
      console.log(`  [+] Positions restored from save`);
    }
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
      if (!ctx.world.isAutoTicking()) {
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
