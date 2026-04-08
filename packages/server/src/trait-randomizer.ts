/**
 * Scenario Randomization — Milestone 1
 *
 * Randomizes OCEAN+H traits, starting moods, and relationship sentiment/trust
 * within per-NPC / per-pair ranges at game start.
 * Each seed produces a deterministic, reproducible scenario.
 * Per-entity sub-seeds ensure adding new NPCs/pairs doesn't change existing ones.
 *
 * Lives in server/ (not engine/) — engine doesn't know about randomization.
 */

import type { AgentProfile, BigFive, Agent } from '@clwa/engine';
import type { MotivePoolEntry } from './world-loader';

// ─── Types ───

export interface TraitRange {
  /** [min, max] where 0 <= min < max <= 1 */
  readonly O?: [number, number];
  readonly C?: [number, number];
  readonly E?: [number, number];
  readonly A?: [number, number];
  readonly N?: [number, number];
  readonly H?: [number, number];
}

/** Mapping from short key to BigFive property name */
const TRAIT_KEY_MAP: Record<keyof TraitRange, keyof BigFive> = {
  O: 'openness',
  C: 'conscientiousness',
  E: 'extraversion',
  A: 'agreeableness',
  N: 'neuroticism',
  H: 'honesty',
};

// ─── Seeded PRNG (mulberry32) ───

function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Simple string hash → 32-bit integer */
function hashString(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return h;
}

// ─── Core ───

/**
 * Randomize OCEAN+H traits for all NPC profiles that have `randomRanges`.
 * Player agents (isPlayer) are never randomized.
 * Each NPC gets a deterministic sub-seed based on globalSeed + npcId.
 *
 * Mutates profiles in-place and returns them.
 */
export function randomizeTraits(
  profiles: AgentProfile[],
  seed: number,
  ranges: Map<string, TraitRange>,
): AgentProfile[] {
  for (const profile of profiles) {
    if (profile.isPlayer) continue;

    const npcRanges = ranges.get(profile.id);
    if (!npcRanges) continue;

    const npcSeed = (seed + hashString(profile.id)) | 0;
    const rng = mulberry32(npcSeed);

    for (const [key, prop] of Object.entries(TRAIT_KEY_MAP)) {
      const range = npcRanges[key as keyof TraitRange];
      if (!range) continue;

      const [min, max] = range;
      profile.bigFive[prop] = min + rng() * (max - min);
    }
  }

  validatePopulation(profiles);
  return profiles;
}

// ─── Population Validation (safety net) ───

/**
 * Ensures the randomized population can produce interesting gameplay.
 * Clamps individual values if constraints are violated.
 *
 * Constraints are built into ranges by design — this rarely triggers.
 */
function validatePopulation(profiles: AgentProfile[]): void {
  const npcs = profiles.filter(p => !p.isPlayer);

  // Constraint 1: At least 2 crime-capable NPCs (H < 0.5)
  const crimeable = npcs.filter(n => n.bigFive.honesty < 0.5);
  if (crimeable.length < 2) {
    // Find NPCs with lowest H and clamp down
    const sorted = [...npcs].sort((a, b) => a.bigFive.honesty - b.bigFive.honesty);
    for (let i = 0; i < Math.min(2, sorted.length); i++) {
      if (sorted[i].bigFive.honesty >= 0.5) {
        console.warn(`  [Randomization] CLAMPED ${sorted[i].name} H: ${sorted[i].bigFive.honesty.toFixed(2)} → 0.45 (constraint: crime-capable)`);
        sorted[i].bigFive.honesty = 0.45;
      }
    }
  }

  // Constraint 2: At least 2 social NPCs (E > 0.5)
  const social = npcs.filter(n => n.bigFive.extraversion > 0.5);
  if (social.length < 2) {
    const sorted = [...npcs].sort((a, b) => b.bigFive.extraversion - a.bigFive.extraversion);
    for (let i = 0; i < Math.min(2, sorted.length); i++) {
      if (sorted[i].bigFive.extraversion <= 0.5) {
        console.warn(`  [Randomization] CLAMPED ${sorted[i].name} E: ${sorted[i].bigFive.extraversion.toFixed(2)} → 0.55 (constraint: social)`);
        sorted[i].bigFive.extraversion = 0.55;
      }
    }
  }

  // Constraint 3: At least 2 resisters (H > 0.6) — investigation needs credible witnesses
  const resisters = npcs.filter(n => n.bigFive.honesty > 0.6);
  if (resisters.length < 2) {
    const sorted = [...npcs].sort((a, b) => b.bigFive.honesty - a.bigFive.honesty);
    for (let i = 0; i < Math.min(2, sorted.length); i++) {
      if (sorted[i].bigFive.honesty <= 0.6) {
        console.warn(`  [Randomization] CLAMPED ${sorted[i].name} H: ${sorted[i].bigFive.honesty.toFixed(2)} → 0.65 (constraint: honest-resister)`);
        sorted[i].bigFive.honesty = 0.65;
      }
    }
  }
}

// ─── Logging ───

const TRAIT_KEYS: (keyof TraitRange)[] = ['O', 'C', 'E', 'A', 'N', 'H'];

export function logRandomization(profiles: AgentProfile[], seed: number): void {
  console.log(`  [Randomization] Seed: ${seed}`);

  for (const p of profiles) {
    if (p.isPlayer) continue;
    const vals = TRAIT_KEYS
      .map(k => `${k}=${p.bigFive[TRAIT_KEY_MAP[k]].toFixed(2)}`)
      .join(' ');
    console.log(`  [Randomization] ${p.name.padEnd(20)} ${vals}`);
  }

  // Population check summary
  const npcs = profiles.filter(p => !p.isPlayer);
  const crime = npcs.filter(n => n.bigFive.honesty < 0.5).length;
  const social = npcs.filter(n => n.bigFive.extraversion > 0.5).length;
  const honest = npcs.filter(n => n.bigFive.honesty > 0.6).length;
  console.log(`  [Randomization] Population: crime-capable=${crime} social=${social} honest=${honest} ✓`);
}

// ─── Range loading helper ───

/**
 * Parse randomRanges from NPC JSON data.
 * Called by world-loader after reading NPC files.
 */
export function parseTraitRanges(
  npcId: string,
  rawRanges?: Record<string, [number, number]>,
): TraitRange | null {
  if (!rawRanges) return null;

  const range: Partial<TraitRange> = {};
  for (const key of TRAIT_KEYS) {
    const val = rawRanges[key];
    if (val && Array.isArray(val) && val.length === 2) {
      const [min, max] = val;
      if (min >= 0 && max <= 1 && min <= max) {
        (range as Record<string, [number, number]>)[key] = [min, max];
      }
    }
  }

  return Object.keys(range).length > 0 ? (range as TraitRange) : null;
}

// ─── Mood Randomization ───

/**
 * Randomize starting moods for NPCs that have `moodRange` in JSON.
 * Mutates startingMoods in-place.
 */
export function randomizeMoods(
  startingMoods: Record<string, number>,
  seed: number,
  moodRanges: Map<string, [number, number]>,
): void {
  for (const [npcId, range] of moodRanges) {
    const npcSeed = (seed + hashString('mood_' + npcId)) | 0;
    const rng = mulberry32(npcSeed);
    const [min, max] = range;
    startingMoods[npcId] = min + rng() * (max - min);
  }
}

export function logMoodRandomization(startingMoods: Record<string, number>, profiles: AgentProfile[]): void {
  for (const p of profiles) {
    if (p.isPlayer) continue;
    const mood = startingMoods[p.id];
    if (mood !== undefined) {
      console.log(`  [Randomization] ${p.name.padEnd(20)} mood=${mood.toFixed(2)}`);
    }
  }
}

/**
 * Parse moodRange from NPC JSON. Returns [min, max] or null.
 */
export function parseMoodRange(raw?: [number, number]): [number, number] | null {
  if (!raw || !Array.isArray(raw) || raw.length !== 2) return null;
  const [min, max] = raw;
  if (min >= -1 && max <= 1 && min <= max) return [min, max];
  return null;
}

// ─── Relationship Randomization ───

interface RelationshipRanges {
  sentimentRange?: [number, number];
  trustRange?: [number, number];
}

/**
 * Randomize sentiment/trust for relationships that have ranges.
 * Mutates the relationships array in-place.
 */
export function randomizeRelationships(
  relationships: Array<{
    from: string; to: string; type: string;
    sentiment?: number; trust?: number;
    sentimentRange?: [number, number]; trustRange?: [number, number];
  }>,
  seed: number,
): void {
  for (const rel of relationships) {
    const hasSentimentRange = rel.sentimentRange && Array.isArray(rel.sentimentRange) && rel.sentimentRange.length === 2;
    const hasTrustRange = rel.trustRange && Array.isArray(rel.trustRange) && rel.trustRange.length === 2;
    if (!hasSentimentRange && !hasTrustRange) continue;

    const pairSeed = (seed + hashString(rel.from + '_' + rel.to)) | 0;
    const rng = mulberry32(pairSeed);

    if (hasSentimentRange) {
      const [min, max] = rel.sentimentRange!;
      if (min >= -1 && max <= 1 && min <= max) {
        rel.sentiment = min + rng() * (max - min);
      }
    }

    if (hasTrustRange) {
      const [min, max] = rel.trustRange!;
      if (min >= 0 && max <= 1 && min <= max) {
        rel.trust = min + rng() * (max - min);
      }
    }
  }
}

export function logRelationshipRandomization(
  relationships: Array<{ from: string; to: string; sentiment?: number; trust?: number;
    sentimentRange?: [number, number]; trustRange?: [number, number] }>,
): void {
  for (const rel of relationships) {
    if (!rel.sentimentRange && !rel.trustRange) continue;
    const s = rel.sentiment !== undefined ? `s=${rel.sentiment.toFixed(2)}` : '';
    const t = rel.trust !== undefined ? `t=${rel.trust.toFixed(2)}` : '';
    console.log(`  [Randomization] ${rel.from}→${rel.to}: ${s} ${t}`.trim());
  }
}

// ─── Motive Assignment (SPEC-motive-pool) ───

/**
 * Assign motives from pool as beliefs + memories at game start.
 * Checks trait/relationship conditions, rolls seeded dice per motive.
 * Falls back to profile.motive if no pool entry matches.
 * Pushes sentiment floor if motive assigned but sentiment too weak.
 */
export async function assignMotives(
  agents: Map<string, Agent>,
  motives: MotivePoolEntry[],
  seed: number,
): Promise<void> {
  const assigned = new Set<string>(); // track which NPC IDs got at least one pool motive

  for (const motive of motives) {
    if (motive.from === motive.to) continue; // no self-motives

    const fromAgent = agents.get(motive.from);
    const toAgent = agents.get(motive.to);
    if (!fromAgent || !toAgent || !toAgent.state.alive) continue;

    const bf = fromAgent.profile.bigFive;

    // Check trait conditions
    if (motive.requires.fromHBelow != null && bf.honesty >= motive.requires.fromHBelow) continue;
    if (motive.requires.fromNAbove != null && bf.neuroticism < motive.requires.fromNAbove) continue;

    // Check sentiment condition
    if (motive.requires.sentimentBelow != null) {
      const rel = fromAgent.state.relationships?.getRelationship(motive.to);
      if (!rel || rel.sentiment >= motive.requires.sentimentBelow) continue;
    }

    // Seeded roll per motive
    const motiveSeed = (seed + hashString('motive_' + motive.id)) | 0;
    const rng = mulberry32(motiveSeed);
    if (rng() > motive.probability) continue;

    // All checks passed — assign motive belief
    if (!fromAgent.state.beliefs) continue;

    fromAgent.state.beliefs.addBelief({
      id: crypto.randomUUID(),
      eventType: motive.type,
      subject: null,
      object: motive.to,
      location: fromAgent.state.location,
      confidence: motive.confidence,
      source: 'personal_motive',
      sourceNpcId: null,
      gameDay: 1,
      lastUpdated: 1,
    });

    // Narrative reason in memory (observation)
    await fromAgent.observe(motive.reason, 8);

    // Push sentiment floor if motive assigned but sentiment too weak for social stress
    const rel = fromAgent.state.relationships?.getRelationship(motive.to);
    if (rel && rel.sentiment > -0.35) {
      fromAgent.state.relationships!.adjustSentiment(motive.to, -0.35 - rel.sentiment);
    }

    assigned.add(motive.from);
    console.log(`  [Motive] ${fromAgent.profile.name} → ${toAgent.profile.name}: ${motive.type} (${motive.id}, conf=${motive.confidence})`);
  }

  // Fallback: convert profile.motive to belief for NPCs without pool assignments
  for (const [npcId, agent] of agents) {
    if (agent.profile.isPlayer || !agent.state.alive) continue;
    if (assigned.has(npcId)) continue;
    const profileMotive = agent.profile.motive;
    if (!profileMotive || !agent.state.beliefs) continue;

    const target = agents.get(profileMotive.targetId);
    if (!target || !target.state.alive) continue;

    agent.state.beliefs.addBelief({
      id: crypto.randomUUID(),
      eventType: 'THREAT_PERCEIVED', // conservative default for legacy motives
      subject: null,
      object: profileMotive.targetId,
      location: agent.state.location,
      confidence: 0.8,
      source: 'personal_motive',
      sourceNpcId: null,
      gameDay: 1,
      lastUpdated: 1,
    });
    await agent.observe(profileMotive.reason, 8);
    console.log(`  [Motive] ${agent.profile.name} → ${target.profile.name}: THREAT_PERCEIVED (legacy profile.motive fallback)`);
  }
}
