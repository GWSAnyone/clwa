/**
 * World Loader — reads JSON world data and creates engine-compatible structures.
 *
 * Usage: const world = loadWorld('worlds/millhaven')
 * Returns everything server needs to bootstrap a World instance.
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import type { AgentProfile, LocationDef, ScheduleEntry, NpcHome } from '@clwa/engine';
import { registerRoleTopicPool, registerLocationHook } from '@clwa/engine';
import { type TraitRange, parseTraitRanges, parseMoodRange } from './trait-randomizer';

// ─── JSON Schemas ──────────────────────────────────────────────

interface NpcJson {
  id: string;
  name: string;
  role: string;
  background: string;
  speechStyle: string;
  personality: { O: number; C: number; E: number; A: number; N: number; H: number };
  enneagram: {
    type: number; wing: number; stressType: number; growthType: number;
    coreFear: string; coreDesire: string;
  };
  secret?: string;
  innerConflict?: string;
  capabilities?: { investigator?: boolean; detersCrime?: boolean; canSentence?: boolean };
  llm?: { temperature: number; maxTokens: number };
  home: string;
  startingLocation: string;
  mobile: boolean;
  startingMood: number;
  moodRange?: [number, number];
  schedule: Array<{ period?: string; startTick?: number; endTick?: number; location: string; activity: string }>;
  memories: string[];
  shop?: Array<{ id: string; name: string; price: number; description: string }> | null;
  motive?: { targetId: string; reason: string } | null;
  randomRanges?: Record<string, [number, number]>;
}

interface RelationshipJson {
  from: string;
  to: string;
  type: string;
  note?: string;
  sentiment?: number;
  trust?: number;
  sentimentRange?: [number, number];
  trustRange?: [number, number];
}

interface LocationJson {
  name: string;
  description: string;
  connections: string[];
  conversationHook?: string;
  zone?: { center: [number, number]; polygon: [number, number][] };
}

interface WorldJson {
  name: string;
  description: string;
  locations: LocationJson[];
  lore: string[];
  config: {
    startTick?: number;     // @deprecated — use startMinute
    startMinute?: number;
    exchangeCount?: number;
    moodBias?: number;
    gameSpeed?: number;
  };
}

interface SecretJson {
  npcId: string;
  eventType: string;
  subject: string;
  object: string;
  confidence: number;
  source: string;
}

interface TopicsJson {
  [role: string]: Array<{
    subject: string;
    tone: string;
    weight: number;
    initiatorHook: string;
    moodValence?: number;
    sentimentValence?: number;
    mentionedNpcId?: string;
  }>;
}

// ─── Loaded World Data ─────────────────────────────────────────

export interface LoadedWorld {
  name: string;
  description: string;
  locations: LocationDef[];
  profiles: AgentProfile[];
  schedules: ScheduleEntry[];
  homes: NpcHome[];
  startingLocations: Map<string, string>;
  mobileNpcs: Set<string>;
  startingMoods: Record<string, number>;
  backgroundMemories: Record<string, string[]>;
  lore: string[];
  relationships: RelationshipJson[];
  secrets: SecretJson[];
  config: WorldJson['config'];
  /** Map location display names → internal IDs */
  locationNameToId: Map<string, string>;
  /** Zone data for position management (pixel polygons per location) */
  zones: { id: string; zone?: { center: [number, number]; polygon: [number, number][] } }[];
  /** Per-NPC trait randomization ranges (from NPC JSON randomRanges field) */
  traitRanges: Map<string, TraitRange>;
  /** Per-NPC mood randomization ranges (from NPC JSON moodRange field) */
  moodRanges: Map<string, [number, number]>;
  /** Motive pool for randomized assignment at game start */
  motives: MotivePoolEntry[];
}

export interface MotivePoolEntry {
  id: string;
  from: string;
  to: string;
  type: string;
  reason: string;
  confidence: number;
  probability: number;
  requires: {
    fromHBelow?: number;
    fromNAbove?: number;
    sentimentBelow?: number;
  };
}

// ─── Loader ────────────────────────────────────────────────────

function readJson<T>(path: string): T {
  const raw = readFileSync(path, 'utf-8');
  return JSON.parse(raw) as T;
}

export function loadWorld(worldDir: string): LoadedWorld {
  console.log(`[WorldLoader] Loading world from ${worldDir}`);

  if (!existsSync(worldDir)) {
    throw new Error(`World directory not found: ${worldDir}`);
  }

  // ─── world.json ───
  const worldJson = readJson<WorldJson>(join(worldDir, 'world.json'));

  // Build name→id mapping for locations (engine uses slugs internally)
  const nameToId = new Map<string, string>();
  for (const loc of worldJson.locations) {
    const id = loc.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    nameToId.set(loc.name, id);
  }

  const locations: LocationDef[] = worldJson.locations.map(loc => ({
    id: nameToId.get(loc.name)!,
    name: loc.name,
    connections: loc.connections.map(c => nameToId.get(c) ?? c),
    isPublic: true,
    description: loc.description,
  }));

  // Register location conversation hooks (for casual topic sources)
  for (const loc of worldJson.locations) {
    if (loc.conversationHook) {
      registerLocationHook(nameToId.get(loc.name)!, loc.conversationHook);
    }
  }

  // ─── NPC files ───
  const npcsDir = join(worldDir, 'npcs');
  const npcFiles = readdirSync(npcsDir).filter(f => f.endsWith('.json'));

  const profiles: AgentProfile[] = [];
  const schedules: ScheduleEntry[] = [];
  const homes: NpcHome[] = [];
  const startingLocations = new Map<string, string>();
  const mobileNpcs = new Set<string>();
  const traitRanges = new Map<string, TraitRange>();
  const moodRanges = new Map<string, [number, number]>();
  const startingMoods: Record<string, number> = {};
  const backgroundMemories: Record<string, string[]> = {};

  for (const file of npcFiles) {
    const npc = readJson<NpcJson>(join(npcsDir, file));

    // Build AgentProfile
    const profile: AgentProfile = {
      id: npc.id,
      name: npc.name,
      role: npc.role,
      background: npc.background,
      speechStyle: npc.speechStyle,
      bigFive: {
        openness: npc.personality.O,
        conscientiousness: npc.personality.C,
        extraversion: npc.personality.E,
        agreeableness: npc.personality.A,
        neuroticism: npc.personality.N,
        honesty: npc.personality.H,
      },
      enneagram: npc.enneagram,
      ...(npc.secret ? { secret: npc.secret } : {}),
      ...(npc.innerConflict ? { innerConflict: npc.innerConflict } : {}),
      ...(npc.capabilities?.investigator ? { investigator: true } : {}),
      ...(npc.capabilities?.detersCrime ? { detersCrime: true } : {}),
      ...(npc.capabilities?.canSentence ? { canSentence: true } : {}),
      ...(npc.llm ? { llm: npc.llm } : {}),
      ...(npc.shop ? { shop: npc.shop } : {}),
      ...(npc.motive ? { motive: npc.motive } : {}),
    };
    profiles.push(profile);

    // Trait randomization ranges
    const parsed = parseTraitRanges(npc.id, npc.randomRanges);
    if (parsed) traitRanges.set(npc.id, parsed);

    // Mood randomization range
    const moodRange = parseMoodRange(npc.moodRange);
    if (moodRange) moodRanges.set(npc.id, moodRange);

    // Schedule (convert location names → ids)
    for (const entry of npc.schedule) {
      schedules.push({
        npcId: npc.id,
        ...(entry.period ? { period: entry.period } : {}),
        ...(entry.startTick !== undefined ? { startTick: entry.startTick } : {}),
        ...(entry.endTick !== undefined ? { endTick: entry.endTick } : {}),
        location: nameToId.get(entry.location) ?? entry.location,
        activity: entry.activity,
      } as ScheduleEntry);
    }

    // Home (convert display name → location id)
    homes.push({ npcId: npc.id, location: nameToId.get(npc.home) ?? npc.home });

    // Starting location
    startingLocations.set(npc.id, nameToId.get(npc.startingLocation) ?? npc.startingLocation);

    // Mobile
    if (npc.mobile) mobileNpcs.add(npc.id);

    // Mood
    startingMoods[npc.id] = npc.startingMood;

    // Memories
    if (npc.memories.length > 0) {
      backgroundMemories[npc.id] = npc.memories;
    }
  }

  console.log(`  [+] ${profiles.length} NPCs loaded`);

  // ─── relationships.json ───
  const relationships = readJson<RelationshipJson[]>(join(worldDir, 'relationships.json'));
  console.log(`  [+] ${relationships.length} relationships`);

  // ─── topics.json ───
  const topics = readJson<TopicsJson>(join(worldDir, 'topics.json'));
  for (const [role, pool] of Object.entries(topics)) {
    const formatted = pool.map(t => ({
      ...t,
      category: `role:${role}`,
    }));
    registerRoleTopicPool(role, formatted);
  }
  console.log(`  [+] ${Object.keys(topics).length} role topic pools`);

  // ─── secrets.json ───
  const secretsPath = join(worldDir, 'secrets.json');
  const secrets = existsSync(secretsPath) ? readJson<SecretJson[]>(secretsPath) : [];
  if (secrets.length > 0) {
    console.log(`  [+] ${secrets.length} starting secrets`);
  }

  // ─── motives.json ───
  const motivesPath = join(worldDir, 'motives.json');
  const motives = existsSync(motivesPath) ? readJson<MotivePoolEntry[]>(motivesPath) : [];
  if (motives.length > 0) {
    console.log(`  [+] ${motives.length} motive pool entries`);
  }

  console.log(`[WorldLoader] "${worldJson.name}" loaded successfully`);

  return {
    name: worldJson.name,
    description: worldJson.description,
    locations,
    profiles,
    schedules,
    homes,
    startingLocations,
    mobileNpcs,
    startingMoods,
    backgroundMemories,
    lore: worldJson.lore,
    relationships,
    secrets,
    motives,
    config: worldJson.config,
    locationNameToId: nameToId,
    traitRanges,
    moodRanges,
    zones: worldJson.locations.map(loc => ({
      id: nameToId.get(loc.name) || loc.name.toLowerCase().replace(/\s+/g, '-'),
      zone: loc.zone,
    })),
  };
}
