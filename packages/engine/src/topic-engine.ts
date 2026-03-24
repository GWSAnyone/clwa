import type { Agent } from './agent';
// Topic source functions moved to modules/social/topic-sources.ts
// Engine only owns: TopicEngine class, registry, selection algorithm

// ─── Types ──────────────────────────────────────────────────────

export interface TopicProposal {
  /** What the conversation is about */
  subject: string;
  /** Emotional coloring: "hushed urgency", "casual warmth", "stiff politeness" */
  tone: string;
  /** Priority weight — higher = more likely selected */
  weight: number;
  /** Direction for the initiator's prompt */
  initiatorHook: string;
  /** Optional direction for the responder */
  responderHook?: string;
  /** Category for diversity tracking (e.g. "crime", "role", "mood") */
  category: string;
  /** Minimum importance floor for conversation memory (optional) */
  minImportance?: number;
  /** Maximum importance cap for conversation memory (optional) */
  maxImportance?: number;
  /** Dedup key — proposals with the same key are merged (highest weight wins).
   *  Prevents the same event appearing from multiple sources (belief + memory + grief). */
  topicKey?: string;
  /** If set, belief is transferred after conversation completes */
  beliefTransfer?: {
    eventType: string;
    subject?: string;
    object?: string;
    /** Confidence multiplied by this (casual conversation = weaker than testimony) */
    confidenceMultiplier: number;
  };
}

export interface TopicContext {
  /** Categories of recent topics for this pair (for anti-repeat) */
  recentTopics: string[];
  gameDay: number;
  period: string;
  /** Current location where conversation happens */
  location: string;
  /** Player agent reference (if exists) — for topic sources about player interactions */
  playerAgent?: Agent;
}

export type TopicSource = (
  initiator: Agent,
  responder: Agent,
  ctx: TopicContext,
) => TopicProposal[];

// ─── Topic sources are registered by modules (social, crime-justice, etc.) ───
// See: modules/social/topic-sources.ts, modules/crime-justice/index.ts

// [REMOVED: 7 built-in topic sources moved to modules/social/topic-sources.ts]
// beliefTopics, relationshipTopics, innerConflictTopics, moodTopics,
// roleTopics, worldFactTopics, casualTopics

// ─── Fallback (engine safety net — used when no modules provide topics) ───

const FALLBACK_TOPIC: TopicProposal = {
  subject: 'the day so far',
  tone: 'casual, everyday',
  weight: 0,
  initiatorHook: 'Nothing particular on your mind. Just checking in, passing the time.',
  category: 'idle',
  maxImportance: 3,
};

// ─── Topic Source Registry (modules push here before World init) ───
export const TOPIC_SOURCE_REGISTRY: TopicSource[] = [];


// ─── Topic Groups (for diversity tracking + PM influence) ────────

/** Derive a broad group from a topic category */
export function getTopicGroup(category: string): string {
  if (category.startsWith('casual')) return 'casual';
  if (category.startsWith('event:')) return 'event';
  if (category === 'memory') return 'event';              // recalling past events
  if (category === 'relationship' || category === 'grief') return 'relationship';
  if (category === 'opinion') return 'relationship';       // opinions about third NPC = social dynamics
  if (category === 'mood') return 'mood';
  if (category === 'inner') return 'inner';                // separate PM multiplier (0.5 + N*0.9)
  if (category.startsWith('role:') || category === 'fact' || category.startsWith('fact:')) return 'knowledge';
  if (category === 'question') return 'knowledge';         // seeking information
  if (category === 'justice' || category === 'conflict' || category.startsWith('player_rumor')) return 'conflict';
  if (category === 'idle') return 'casual';
  return 'casual'; // default to casual instead of unmapped 'other'
}

/** Target distribution ratios for topic diversity */
const DIVERSITY_TARGETS: Record<string, number> = {
  casual: 0.35,
  event: 0.25,
  relationship: 0.15,
  mood: 0.10,
  knowledge: 0.10,
  conflict: 0.05,
};
const DIVERSITY_STRENGTH = 4;

/** PM-based multiplier for topic group affinity (wider range: 0.6-1.4) */
function pmGroupMultiplier(group: string, pm: { extraversion: number; neuroticism: number; openness: number; agreeableness: number }): number {
  switch (group) {
    case 'casual':       return 0.6 + pm.extraversion * 0.8;      // E=0→0.6, E=1→1.4
    case 'event':        return 1.0;                                // always important
    case 'relationship': return 0.6 + pm.agreeableness * 0.8;     // A=0→0.6, A=1→1.4
    case 'mood':         return 0.6 + pm.neuroticism * 0.8;       // N=0→0.6, N=1→1.4
    case 'inner':        return 0.5 + pm.neuroticism * 0.9;       // N=0→0.5, N=1→1.4
    case 'knowledge':    return 0.6 + pm.openness * 0.8;          // O=0→0.6, O=1→1.4
    case 'conflict':     return 0.6 + (1 - pm.agreeableness) * 0.8; // low A → confrontational
    default:             return 1.0;
  }
}

/** Weighted random selection — proportional to weight, not winner-take-all */
function weightedRandomSelect(proposals: TopicProposal[]): TopicProposal | null {
  const valid = proposals.filter(p => p.weight > 0);
  if (valid.length === 0) return null;

  const totalWeight = valid.reduce((sum, p) => sum + p.weight, 0);
  let roll = Math.random() * totalWeight;

  for (const p of valid) {
    roll -= p.weight;
    if (roll <= 0) return p;
  }

  return valid[valid.length - 1];
}

// ─── Topic Engine ───────────────────────────────────────────────

export class TopicEngine {
  /** pairKey → last N topic categories */
  private topicHistory: Map<string, string[]> = new Map();
  /** group → count this day (for diversity tracking) */
  private dayDistribution: Map<string, number> = new Map();
  private dayConversationCount = 0;

  /** Select the best conversation topic for a pair */
  selectTopic(
    initiator: Agent,
    responder: Agent,
    gameDay: number,
    period: string,
    location: string,
    playerAgent?: Agent,
  ): TopicProposal {
    const key = pairKey(initiator.profile.id, responder.profile.id);
    const recentTopics = this.topicHistory.get(key) ?? [];

    const ctx: TopicContext = { recentTopics, gameDay, period, location, playerAgent };

    // Collect all proposals from all sources (reads TOPIC_SOURCE_REGISTRY directly)
    const rawProposals: TopicProposal[] = [];
    for (const source of TOPIC_SOURCE_REGISTRY) {
      rawProposals.push(...source(initiator, responder, ctx));
    }

    if (rawProposals.length === 0) return FALLBACK_TOPIC;

    // 0. Dedup by topicKey — keep highest weight proposal per key
    const allProposals: TopicProposal[] = [];
    const seenKeys = new Map<string, number>(); // topicKey → index in allProposals
    for (const p of rawProposals) {
      if (p.topicKey) {
        const existing = seenKeys.get(p.topicKey);
        if (existing !== undefined) {
          // Keep the one with higher weight
          if (p.weight > allProposals[existing].weight) {
            allProposals[existing] = p;
          }
          continue;
        }
        seenKeys.set(p.topicKey, allProposals.length);
      }
      allProposals.push(p);
    }

    // 1. Penalize recently discussed categories (per pair)
    for (const p of allProposals) {
      const recentCount = recentTopics.filter(t => t === p.category).length;
      p.weight -= recentCount * 3;
    }

    // 2. Apply PM influence — both participants' personality shapes topic preference
    const pmInit = initiator.profile.bigFive;
    const pmResp = responder.profile.bigFive;
    if (pmInit || pmResp) {
      for (const p of allProposals) {
        const group = getTopicGroup(p.category);
        const multInit = pmInit ? pmGroupMultiplier(group, pmInit) : 1.0;
        const multResp = pmResp ? pmGroupMultiplier(group, pmResp) : 1.0;
        p.weight *= (multInit + multResp) / 2; // average of both personalities
      }
    }

    // 3. Apply diversity bonus — push toward target distribution
    if (this.dayConversationCount > 3) {
      for (const p of allProposals) {
        const group = getTopicGroup(p.category);
        const actual = (this.dayDistribution.get(group) ?? 0) / this.dayConversationCount;
        const target = DIVERSITY_TARGETS[group] ?? 0.1;
        p.weight += (target - actual) * DIVERSITY_STRENGTH;
      }
    }

    // 4. Weighted random selection (proportional, not winner-take-all)
    const winner = weightedRandomSelect(allProposals) ?? FALLBACK_TOPIC;

    // Track this topic (per pair history)
    const history = this.topicHistory.get(key) ?? [];
    history.push(winner.category);
    if (history.length > 6) history.shift();
    this.topicHistory.set(key, history);

    // Track day distribution (for diversity)
    const winnerGroup = getTopicGroup(winner.category);
    this.dayDistribution.set(winnerGroup, (this.dayDistribution.get(winnerGroup) ?? 0) + 1);
    this.dayConversationCount++;

    return winner;
  }

  /** Reset topic history + day distribution (e.g. on day advance) */
  resetHistory(): void {
    this.topicHistory.clear();
    this.dayDistribution.clear();
    this.dayConversationCount = 0;
  }

  toJSON(): object {
    const history: Record<string, string[]> = {};
    for (const [key, val] of this.topicHistory) {
      history[key] = val;
    }
    const distribution: Record<string, number> = {};
    for (const [key, val] of this.dayDistribution) {
      distribution[key] = val;
    }
    return { topicHistory: history, dayDistribution: distribution, dayConversationCount: this.dayConversationCount };
  }

  loadState(data: { topicHistory?: Record<string, string[]>; dayDistribution?: Record<string, number>; dayConversationCount?: number }): void {
    this.topicHistory.clear();
    if (data.topicHistory) {
      for (const [key, val] of Object.entries(data.topicHistory)) {
        this.topicHistory.set(key, val);
      }
    }
    this.dayDistribution.clear();
    if (data.dayDistribution) {
      for (const [key, val] of Object.entries(data.dayDistribution)) {
        this.dayDistribution.set(key, val);
      }
    }
    this.dayConversationCount = data.dayConversationCount ?? 0;
  }
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}
