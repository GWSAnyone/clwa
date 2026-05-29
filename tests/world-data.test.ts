/**
 * World Data Validation — checks JSON world data against engine registries.
 * Catches configuration errors: invalid NPC IDs, unregistered event types,
 * out-of-range motive confidences, invalid relationship types, etc.
 *
 * Run: bun test tests/world-data.test.ts
 */
import { describe, test, expect } from 'bun:test';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { registerCrimeJusticeModule, registerSocialModule } from '@clwa/modules';
import { getAllRegisteredEventTypes } from '@clwa/engine';

registerSocialModule();
registerCrimeJusticeModule();

const WORLD_DIR = join(import.meta.dir, '..', 'worlds', 'millhaven');
const NPC_DIR = join(WORLD_DIR, 'npcs');

function readJSON(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

// Collect all NPC profiles
const npcFiles = readdirSync(NPC_DIR).filter(f => f.endsWith('.json'));
const npcProfiles = npcFiles.map(f => readJSON(join(NPC_DIR, f)) as Record<string, unknown>);
const npcIds = new Set(npcProfiles.map(p => p.id as string));

describe('World Data: NPC Profiles', () => {
  test('every NPC has required fields', () => {
    const required = ['id', 'name', 'role', 'background', 'speechStyle', 'personality', 'enneagram', 'schedule'];
    const bad: string[] = [];
    for (const p of npcProfiles) {
      for (const field of required) {
        if (!(field in p)) bad.push(`${p.id}: missing '${field}'`);
      }
    }
    expect(bad).toEqual([]);
  });

  test('every NPC personality has all OCEAN+H traits', () => {
    const traits = ['O', 'C', 'E', 'A', 'N', 'H'];
    const bad: string[] = [];
    for (const p of npcProfiles) {
      const personality = p.personality as Record<string, number> | undefined;
      if (!personality) { bad.push(`${p.id}: no personality`); continue; }
      for (const t of traits) {
        if (!(t in personality)) bad.push(`${p.id}: missing trait '${t}'`);
        else if (personality[t] < 0 || personality[t] > 1) bad.push(`${p.id}: trait '${t}' out of [0,1]: ${personality[t]}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('World Data: Relationships', () => {
  const relationships = readJSON(join(WORLD_DIR, 'relationships.json')) as Array<Record<string, unknown>>;
  const validTypes = new Set(['friend', 'colleague', 'acquaintance', 'rival', 'family']);

  test('all relationship from/to IDs exist as NPCs', () => {
    const bad: string[] = [];
    for (const rel of relationships) {
      if (!npcIds.has(rel.from as string)) bad.push(`from '${rel.from}' not in NPCs`);
      if (!npcIds.has(rel.to as string)) bad.push(`to '${rel.to}' not in NPCs`);
    }
    expect(bad).toEqual([]);
  });

  test('all relationship types are valid', () => {
    const bad: string[] = [];
    for (const rel of relationships) {
      if (!validTypes.has(rel.type as string)) {
        bad.push(`${rel.from}→${rel.to}: invalid type '${rel.type}'`);
      }
    }
    expect(bad).toEqual([]);
  });

  test('sentiment values in [-1, 1] range', () => {
    const bad: string[] = [];
    for (const rel of relationships) {
      const s = rel.sentiment as number | undefined;
      if (s != null && (s < -1 || s > 1)) bad.push(`${rel.from}→${rel.to}: sentiment ${s} out of range`);
    }
    expect(bad).toEqual([]);
  });
});

describe('World Data: Living Millhaven demo (B1/B2/B3 content)', () => {
  const KNOWN_FACTIONS = new Set(['town_guard', 'merchants_guild']);
  const relationships = readJSON(join(WORLD_DIR, 'relationships.json')) as Array<Record<string, unknown>>;

  test('every NPC with gold has a non-negative base and min 0', () => {
    const bad: string[] = [];
    for (const p of npcProfiles) {
      const attrs = p.attributes as Record<string, { base: number; min?: number }> | undefined;
      if (!attrs?.gold) continue;
      if (attrs.gold.base < 0) bad.push(`${p.id}: negative gold ${attrs.gold.base}`);
      if (attrs.gold.min !== 0) bad.push(`${p.id}: gold.min should be 0, got ${attrs.gold.min}`);
    }
    expect(bad).toEqual([]);
    // sanity: at least the merchants + guards carry gold
    expect(npcProfiles.filter((p) => (p.attributes as Record<string, unknown> | undefined)?.gold).length).toBeGreaterThanOrEqual(5);
  });

  test('faction memberships use only known faction keys', () => {
    const bad: string[] = [];
    for (const p of npcProfiles) {
      for (const f of (p.factions as string[] | undefined) ?? []) {
        if (!KNOWN_FACTIONS.has(f)) bad.push(`${p.id}: unknown faction '${f}'`);
      }
    }
    expect(bad).toEqual([]);
  });

  test('every merchant (has shop) belongs to merchants_guild', () => {
    const bad: string[] = [];
    for (const p of npcProfiles) {
      if (!p.shop) continue;
      if (!((p.factions as string[] | undefined) ?? []).includes('merchants_guild')) bad.push(`${p.id}: merchant not in merchants_guild`);
    }
    expect(bad).toEqual([]);
  });

  test('relationship standing values are in [-1,1]', () => {
    const bad: string[] = [];
    for (const rel of relationships) {
      const s = rel.standing as number | undefined;
      if (s != null && (s < -1 || s > 1)) bad.push(`${rel.from}→${rel.to}: standing ${s} out of range`);
    }
    expect(bad).toEqual([]);
    expect(relationships.some((r) => r.to === 'magistrate' && r.standing != null)).toBe(true); // justice axis seeded
  });

  test('loadWorld surfaces the seeded demo maps', async () => {
    const { loadWorld } = await import('../packages/server/src/world-loader');
    const w = loadWorld(WORLD_DIR);
    expect(w.startingAttributes.mark.gold.base).toBe(200);
    expect(w.factionMemberships.garrett).toContain('town_guard');
    expect(w.factionMemberships.mark).toContain('merchants_guild');
    // merchant stock derived from shop entries (real inventory)
    expect((w.startingInventory.mark ?? []).length).toBeGreaterThan(0);
    // standing threaded through relationships
    expect(w.relationships.some((r) => r.to === 'magistrate' && typeof r.standing === 'number')).toBe(true);
  });
});

describe('World Data: Motives', () => {
  const motives = readJSON(join(WORLD_DIR, 'motives.json')) as Array<Record<string, unknown>>;
  const registeredTypes = getAllRegisteredEventTypes();

  test('all motive from/to IDs exist as NPCs', () => {
    const bad: string[] = [];
    for (const m of motives) {
      if (!npcIds.has(m.from as string)) bad.push(`from '${m.from}' not in NPCs`);
      if (!npcIds.has(m.to as string)) bad.push(`to '${m.to}' not in NPCs`);
    }
    expect(bad).toEqual([]);
  });

  test('all motive event types are registered', () => {
    const bad: string[] = [];
    for (const m of motives) {
      if (!registeredTypes.includes(m.type as string)) {
        bad.push(`motive '${m.id}': type '${m.type}' not registered`);
      }
    }
    expect(bad).toEqual([]);
  });

  test('motive confidences within escalation range [0.1, 0.65]', () => {
    // Confidences should be below kill threshold (0.70) to allow escalation
    const bad: string[] = [];
    for (const m of motives) {
      const c = m.confidence as number;
      if (c < 0.1 || c > 0.65) {
        bad.push(`motive '${m.id}': confidence ${c} outside escalation range [0.1, 0.65]`);
      }
    }
    expect(bad).toEqual([]);
  });

  test('motive probability in [0, 1] range', () => {
    const bad: string[] = [];
    for (const m of motives) {
      const p = m.probability as number;
      if (p < 0 || p > 1) bad.push(`motive '${m.id}': probability ${p} out of range`);
    }
    expect(bad).toEqual([]);
  });
});

describe('World Data: Secrets', () => {
  const secrets = readJSON(join(WORLD_DIR, 'secrets.json')) as Array<Record<string, unknown>>;

  test('all secret npcIds exist as NPCs', () => {
    const bad: string[] = [];
    for (const s of secrets) {
      if (!npcIds.has(s.npcId as string)) bad.push(`secret npcId '${s.npcId}' not in NPCs`);
    }
    expect(bad).toEqual([]);
  });
});

describe('World Data: Locations', () => {
  const world = readJSON(join(WORLD_DIR, 'world.json')) as Record<string, unknown>;
  const locations = (world.locations as Array<Record<string, unknown>>) ?? [];
  const locationNames = new Set(locations.map(l => l.name as string));

  test('all schedule locations exist in world.json', () => {
    const bad: string[] = [];
    for (const p of npcProfiles) {
      const schedule = p.schedule as Array<Record<string, unknown>> | undefined;
      if (!schedule) continue;
      for (const entry of schedule) {
        if (!locationNames.has(entry.location as string)) {
          bad.push(`${p.id} schedule: location '${entry.location}' not in world.json`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  test('all location connections are bidirectional', () => {
    const bad: string[] = [];
    for (const loc of locations) {
      const conns = loc.connections as string[] ?? [];
      for (const conn of conns) {
        const other = locations.find(l => l.name === conn);
        if (!other) { bad.push(`${loc.name}: connection '${conn}' not found`); continue; }
        const otherConns = (other.connections as string[]) ?? [];
        if (!otherConns.includes(loc.name as string)) {
          bad.push(`${loc.name} → ${conn} but ${conn} → ${loc.name} missing`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});
