import type { Agent } from './agent';
import { getEventLabel, isDeathEvent, getRoleTopicPool } from './event-registry';

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
  /** Player agent reference (if exists) — for topic sources about player interactions */
  playerAgent?: Agent;
}

export type TopicSource = (
  initiator: Agent,
  responder: Agent,
  ctx: TopicContext,
) => TopicProposal[];

// ─── Built-in Topic Sources ─────────────────────────────────────

/** Topics from NPC beliefs about significant events (crime, trade disputes, etc.) */
const beliefTopics: TopicSource = (init, resp) => {
  const proposals: TopicProposal[] = [];
  // Any high-confidence belief with an object is worth discussing
  const initBeliefs = init.state.beliefs?.getAllBeliefs()
    .filter(b => b.confidence >= 0.3 && b.object) ?? [];
  const respBeliefs = resp.state.beliefs?.getAllBeliefs()
    .filter(b => b.confidence >= 0.3 && b.object) ?? [];

  for (const belief of initBeliefs) {
    const eventLabel = getEventLabel(belief.eventType);
    if (!eventLabel) continue;
    const victim = belief.object ?? 'someone';
    const topicCategory = `event:${belief.eventType}`; // derived from data, not hardcoded
    const respKnows = respBeliefs.some(
      b => b.eventType === belief.eventType && b.object === belief.object,
    );

    if (respKnows) {
      proposals.push({
        subject: `the ${eventLabel} of ${victim}`,
        tone: 'grave, processing together',
        weight: 7,
        initiatorHook: `You both know about the ${eventLabel}. Share your thoughts, fears, theories.`,
        responderHook: `You also know about this. React to what they say with your own feelings.`,
        category: topicCategory,
        minImportance: 6,
      });
    } else {
      proposals.push({
        subject: `the ${eventLabel} of ${victim}`,
        tone: 'urgent, breaking the news',
        weight: 9,
        initiatorHook: `You need to tell them about the ${eventLabel}. Break the news.`,
        responderHook: `This is the first you're hearing of this. React with genuine shock.`,
        category: topicCategory,
        minImportance: 6,
        beliefTransfer: {
          eventType: belief.eventType,
          subject: belief.subject ?? undefined,
          object: belief.object ?? undefined,
          confidenceMultiplier: 0.5,
        },
      });
    }
  }

  return proposals;
};

/** Topics from relationship dynamics */
const relationshipTopics: TopicSource = (init, resp) => {
  const rel = init.state.relationships?.getRelationship(resp.profile.id);
  if (!rel) return [];

  const proposals: TopicProposal[] = [];

  // Tension / rivalry
  if (rel.sentiment < -0.3) {
    proposals.push({
      subject: 'the tension between you',
      tone: 'stiff, barely civil',
      weight: 4,
      initiatorHook: `You don't like ${resp.profile.name}. Keep it professional but resentment shows.`,
      category: 'relationship',
    });
  }

  // Grief — check if initiator has beliefs about someone's death + positive relationship
  const allRels = init.state.relationships?.getAllRelationships() ?? [];
  const deathBeliefs = init.state.beliefs?.getAllBeliefs()
    .filter(b => isDeathEvent(b.eventType) && b.object) ?? [];
  for (const db of deathBeliefs) {
    const victimRel = allRels.find(r => r.targetName === db.object || r.targetId === db.object);
    if (victimRel && victimRel.sentiment > 0.2) {
      proposals.push({
        subject: `the loss of ${victimRel.targetName}`,
        tone: 'heavy, sorrowful',
        weight: 6,
        initiatorHook: `The loss weighs on you. It comes up unexpectedly.`,
        category: 'grief',
        minImportance: 5,
      });
      break; // one grief topic is enough
    }
  }

  // Close friend + bad mood → seeking comfort
  if (rel.sentiment > 0.3 && init.state.mood < -0.3) {
    proposals.push({
      subject: 'how you\'ve been feeling',
      tone: 'vulnerable, seeking comfort',
      weight: 5,
      initiatorHook: `You trust ${resp.profile.name}. Let some of your worry show.`,
      category: 'mood',
      minImportance: 4,
    });
  }

  return proposals;
};

/** Topics from inner conflict leaking through */
const innerConflictTopics: TopicSource = (init, resp) => {
  if (!init.profile.innerConflict) return [];

  const rel = init.state.relationships?.getRelationship(resp.profile.id);
  const trust = rel?.sentiment ?? 0;

  if (trust > 0.3) {
    return [{
      subject: 'a worry you\'ve been carrying',
      tone: 'hesitant, almost confiding',
      weight: 4,
      initiatorHook: `Your inner conflict weighs on you. You almost mention it but hold back. Just hints and half-sentences.`,
      category: 'inner',
      minImportance: 4,
    }];
  }

  return [];
};

/** Topics from role-specific daily life — grounded, concrete */
const roleTopics: TopicSource = (init, _resp, ctx) => {
  const pool = getRoleTopicPool(init.profile.role);
  if (!pool) return [];

  // Filter out recently used for this pair
  const fresh = pool.filter(t =>
    !ctx.recentTopics.includes('role:' + t.subject),
  );
  if (fresh.length === 0) return pool.map(t => ({ ...t, weight: 1 }));

  return fresh.map(t => ({ ...t }));
};

/** Role-specific topic pools — declarative data */
// Role topic pools moved to server/index.ts via registerRoleTopicPool()
// Each world module/server registers role-specific conversation topics

/** Topics from current mood state */
const moodTopics: TopicSource = (init, resp) => {
  const mood = init.state.mood;
  const rel = init.state.relationships?.getRelationship(resp.profile.id);
  const trust = rel?.sentiment ?? 0;

  if (mood > 0.4) {
    return [{
      subject: 'something good that happened',
      tone: 'warm, sharing',
      weight: 2,
      initiatorHook: 'You\'re in a good mood. Share the feeling — maybe compliment something or reminisce.',
      category: 'mood',
    }];
  }

  if (mood < -0.5 && trust > 0.2) {
    return [{
      subject: 'the unease you\'re feeling',
      tone: 'guarded, restless',
      weight: 4,
      initiatorHook: 'Something is wrong and you can\'t shake it. You don\'t say it directly but it leaks through.',
      category: 'mood',
    }];
  }

  return [];
};

/** Topics from known world facts.
 *  Facts starting with '#' are structural metadata (e.g. "# 8 locations") — skipped for topics. */
const worldFactTopics: TopicSource = (init, _resp, ctx) => {
  const facts = init.state.knownFacts ?? [];
  const interesting = facts.filter(f =>
    !f.startsWith('#') &&
    !ctx.recentTopics.includes('fact:' + f.slice(0, 30)),
  );

  return interesting.map(f => ({
    subject: f,
    tone: 'matter-of-fact',
    weight: 2,
    initiatorHook: `This is common knowledge. Bring it up naturally.`,
    category: 'fact:' + f.slice(0, 30),
  }));
};

// Engine-generic sources registered below (after TOPIC_SOURCE_REGISTRY declaration)


/** Positive casual topics — warm conversations that can IMPROVE mood */
const casualTopics: TopicSource = (init, resp) => {
  const proposals: TopicProposal[] = [];

  // Friends have warm casual conversations
  const rel = init.state.relationships?.getRelationship(resp.profile.id);
  if (rel && rel.sentiment > 0.1) {
    proposals.push({
      subject: 'catching up as friends',
      tone: 'warm, relaxed',
      weight: 3,
      initiatorHook: `You enjoy ${resp.profile.name}'s company. Share something lighthearted — a memory, a joke, an observation about the weather or the village.`,
      responderHook: `Respond warmly. This is a pleasant moment between friends.`,
      category: 'casual_positive',
    });
  }

  // Craft/profession talk (always available between co-workers)
  if (rel && rel.type === 'colleague') {
    proposals.push({
      subject: `work and craft`,
      tone: 'practical, companionable',
      weight: 2,
      initiatorHook: `Talk about your work — what you made today, a tricky order, the quality of materials. Professional pride.`,
      responderHook: `Share your own work experience. Mutual respect for each other's craft.`,
      category: 'casual_craft',
    });
  }

  // Weather and village life (always available, low weight)
  if (init.state.mood > -0.2) {
    proposals.push({
      subject: 'village life',
      tone: 'casual, observational',
      weight: 1,
      initiatorHook: `Comment on something mundane — the weather, the market crowd, a funny thing you noticed today. Just small talk.`,
      category: 'casual_village',
    });
  }

  return proposals;
};

// ─── Fallback ───────────────────────────────────────────────────

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

// Engine-generic topic sources (universal concepts, not module-specific)
TOPIC_SOURCE_REGISTRY.push(
  beliefTopics,
  relationshipTopics,
  innerConflictTopics,
  moodTopics,
  worldFactTopics,
  roleTopics,
  casualTopics,
);

// ─── Topic Groups (for diversity tracking + PM influence) ────────

/** Derive a broad group from a topic category */
export function getTopicGroup(category: string): string {
  if (category.startsWith('casual')) return 'casual';
  if (category.startsWith('event:')) return 'event';
  if (category === 'relationship' || category === 'grief') return 'relationship';
  if (category === 'mood') return 'mood';
  if (category === 'inner') return 'inner';
  if (category.startsWith('role:') || category.startsWith('fact:')) return 'knowledge';
  if (category === 'justice' || category.startsWith('player_rumor')) return 'conflict';
  if (category === 'idle') return 'casual';
  return 'other';
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
    playerAgent?: Agent,
  ): TopicProposal {
    const key = pairKey(initiator.profile.id, responder.profile.id);
    const recentTopics = this.topicHistory.get(key) ?? [];

    const ctx: TopicContext = { recentTopics, gameDay, period, playerAgent };

    // Collect all proposals from all sources (reads TOPIC_SOURCE_REGISTRY directly)
    const allProposals: TopicProposal[] = [];
    for (const source of TOPIC_SOURCE_REGISTRY) {
      allProposals.push(...source(initiator, responder, ctx));
    }

    if (allProposals.length === 0) return FALLBACK_TOPIC;

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
