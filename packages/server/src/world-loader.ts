/**
 * World Loader — reads JSON world data and creates engine-compatible structures.
 *
 * Usage: const world = loadWorld('worlds/millhaven')
 * Returns everything server needs to bootstrap a World instance.
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import type { AgentProfile, LocationDef, ScheduleEntry, NpcHome } from '@clwa/engine';
import { registerRoleTopicPool, registerLocationHook, getAllRegisteredEventTypes } from '@clwa/engine';
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
  /** Open capability flags (e.g. investigator/detersCrime/canSentence for crime; isMerchant for economy). */
  capabilities?: Record<string, boolean>;
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
  /** B1 scalar attributes (e.g. gold). Seeded into AgentState via World.setAttribute (clamped to [min,max]). */
  attributes?: Record<string, { base: number; min?: number; max?: number }>;
  /** B2 starting inventory. Seeded via World.giveItem. (Merchant stock can also be derived from `shop`.) */
  inventory?: Array<{ kind: string; quantity?: number; state?: Record<string, unknown> }>;
  /** B3 faction/group membership (open keys, e.g. town_guard / merchants_guild). Seeded via World.joinFaction. */
  factions?: string[];
  /** Rotating in-voice example lines (authored in the world language). Optional; default []. */
  fewShotExamples?: string[];
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
  /** B3 social standing/favor axis (-1..1) the `from` agent grants `to` — e.g. standing toward the magistrate. */
  standing?: number;
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
    startMinute?: number;
    exchangeCount?: number;
    moodBias?: number;
    /** World speech language for NPC prompts (en|ru). Default 'en'. Threaded to Agent + WorldConfig. */
    language?: 'en' | 'ru';
    /** Real-time ms gap after which a player's next chat with an NPC starts fresh. Default 300000 (5 min). */
    chatStaleMs?: number;
    /** Override for the L1 guardrail scaffold text (universal speech/grounding rules), in the world language.
     *  Absent → engine genre-neutral default. Editable in the World Editor. */
    scaffold?: string;
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
  /** B1: per-NPC starting scalar attributes (e.g. gold), seeded via World.setAttribute. */
  startingAttributes: Record<string, Record<string, { base: number; min?: number; max?: number }>>;
  /** B2: per-NPC starting inventory, seeded via World.giveItem. */
  startingInventory: Record<string, Array<{ kind: string; quantity?: number; state?: Record<string, unknown> }>>;
  /** B3: per-NPC faction memberships, seeded via World.joinFaction. */
  factionMemberships: Record<string, string[]>;
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
  const startingAttributes: LoadedWorld['startingAttributes'] = {};
  const startingInventory: LoadedWorld['startingInventory'] = {};
  const factionMemberships: LoadedWorld['factionMemberships'] = {};

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
      ...(npc.capabilities ? { capabilities: { ...npc.capabilities } } : {}),
      ...(npc.llm ? { llm: npc.llm } : {}),
      ...(npc.shop ? { shop: npc.shop } : {}),
      ...(npc.motive ? { motive: npc.motive } : {}),
      fewShotExamples: npc.fewShotExamples ?? [],
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

    // B1 attributes (e.g. gold)
    if (npc.attributes) startingAttributes[npc.id] = npc.attributes;

    // B3 faction memberships
    if (npc.factions && npc.factions.length > 0) factionMemberships[npc.id] = [...npc.factions];

    // B2 inventory: explicit entries + merchant stock derived from `shop` (one real stack per shop item,
    // item.kind = shop entry id; prices stay on profile.shop and are looked up at trade time).
    const inv: NonNullable<NpcJson['inventory']> = [...(npc.inventory ?? [])];
    if (npc.shop) {
      for (const item of npc.shop) {
        if (!inv.some((i) => i.kind === item.id)) inv.push({ kind: item.id, quantity: 8 });
      }
    }
    if (inv.length > 0) startingInventory[npc.id] = inv;
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

  // ─── Validation: world data against engine registries ───
  const npcIds = new Set(profiles.map(p => p.id));
  const registeredEventTypes = new Set(getAllRegisteredEventTypes());
  const warnings: string[] = [];

  for (const s of secrets) {
    if (!npcIds.has(s.npcId)) warnings.push(`[Secret] Unknown npcId '${s.npcId}'`);
    if (s.subject && !npcIds.has(s.subject)) warnings.push(`[Secret] Unknown subject '${s.subject}' in secret for ${s.npcId} — use NPC ID not display name`);
    if (!registeredEventTypes.has(s.eventType)) warnings.push(`[Secret] Unregistered eventType '${s.eventType}' for ${s.npcId}`);
  }

  for (const m of motives) {
    if (!npcIds.has(m.from)) warnings.push(`[Motive] Unknown 'from' NPC '${m.from}'`);
    if (!npcIds.has(m.to)) warnings.push(`[Motive] Unknown 'to' NPC '${m.to}'`);
  }

  for (const r of relationships) {
    if (!npcIds.has(r.from)) warnings.push(`[Relationship] Unknown 'from' NPC '${r.from}'`);
    if (!npcIds.has(r.to)) warnings.push(`[Relationship] Unknown 'to' NPC '${r.to}'`);
  }

  if (warnings.length > 0) {
    console.warn(`[WorldLoader] ⚠ ${warnings.length} validation warning(s):`);
    for (const w of warnings) console.warn(`  ${w}`);
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
    startingAttributes,
    startingInventory,
    factionMemberships,
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
