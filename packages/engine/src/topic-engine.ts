import type { Agent } from './agent';
import { isEventCategory, getEventLabel } from './event-registry';

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
}

export interface TopicContext {
  /** Categories of recent topics for this pair (for anti-repeat) */
  recentTopics: string[];
  gameDay: number;
  period: string;
}

export type TopicSource = (
  initiator: Agent,
  responder: Agent,
  ctx: TopicContext,
) => TopicProposal[];

// ─── Built-in Topic Sources ─────────────────────────────────────

/** Topics from NPC beliefs about crimes/events */
const beliefTopics: TopicSource = (init, resp) => {
  const proposals: TopicProposal[] = [];
  const initBeliefs = init.state.beliefs?.getAllBeliefs()
    .filter(b => isEventCategory(b.eventType, 'crime') && b.confidence >= 0.3) ?? [];
  const respBeliefs = resp.state.beliefs?.getAllBeliefs()
    .filter(b => isEventCategory(b.eventType, 'crime') && b.confidence >= 0.3) ?? [];

  for (const belief of initBeliefs) {
    const crimeWord = getEventLabel(belief.eventType);
    const victim = belief.object ?? 'someone';
    const respKnows = respBeliefs.some(
      b => b.eventType === belief.eventType && b.object === belief.object,
    );

    if (respKnows) {
      proposals.push({
        subject: `the ${crimeWord} of ${victim}`,
        tone: 'grave, processing together',
        weight: 7,
        initiatorHook: `You both know about the ${crimeWord}. Share your thoughts, fears, theories.`,
        responderHook: `You also know about this. React to what they say with your own feelings.`,
        category: 'crime',
      });
    } else {
      proposals.push({
        subject: `the ${crimeWord} of ${victim}`,
        tone: 'urgent, breaking the news',
        weight: 9,
        initiatorHook: `You need to tell them about the ${crimeWord}. Break the news.`,
        responderHook: `This is the first you're hearing of this. React with genuine shock.`,
        category: 'crime',
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
    .filter(b => isEventCategory(b.eventType, 'crime') && b.object) ?? [];
  for (const db of deathBeliefs) {
    const victimRel = allRels.find(r => r.targetName === db.object || r.targetId === db.object);
    if (victimRel && victimRel.sentiment > 0.2) {
      proposals.push({
        subject: `the loss of ${victimRel.targetName}`,
        tone: 'heavy, sorrowful',
        weight: 6,
        initiatorHook: `The loss weighs on you. It comes up unexpectedly.`,
        category: 'grief',
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
    }];
  }

  return [];
};

/** Topics from role-specific daily life — grounded, concrete */
const roleTopics: TopicSource = (init, _resp, ctx) => {
  const pool = ROLE_TOPIC_POOL[init.profile.role];
  if (!pool) return [];

  // Filter out recently used for this pair
  const fresh = pool.filter(t =>
    !ctx.recentTopics.includes('role:' + t.subject),
  );
  if (fresh.length === 0) return pool.map(t => ({ ...t, weight: 1 })); // all used → low weight re-pick

  return fresh;
};

/** Role-specific topic pools — declarative data */
// Justice topics moved to modules/crime-justice/topic-sources.ts
// Registered via topicEngine.registerSource() at module init

const ROLE_TOPIC_POOL: Record<string, TopicProposal[]> = {
  bartender: [
    { subject: 'a regular who hasn\'t come in lately', tone: 'mildly concerned', weight: 2, initiatorHook: 'You haven\'t seen a regular customer in days. Ask if they know anything.', category: 'role:a regular who hasn\'t come in lately' },
    { subject: 'the ale quality this week', tone: 'professional', weight: 2, initiatorHook: 'The latest batch turned out different. Mention it in passing.', category: 'role:the ale quality this week' },
    { subject: 'something overheard last night', tone: 'gossipy, leaning in', weight: 2, initiatorHook: 'You overheard something interesting at the bar. Share it casually.', category: 'role:something overheard last night' },
  ],
  merchant: [
    { subject: 'a tricky customer earlier today', tone: 'amused or exasperated', weight: 2, initiatorHook: 'A farmer tried to pay you in chickens this morning. Tell them about it.', category: 'role:a tricky customer earlier today' },
    { subject: 'a missing shipment', tone: 'worried, business-like', weight: 2, initiatorHook: 'A crate you expected hasn\'t arrived. You\'re worried it was stolen on the road.', category: 'role:a missing shipment' },
    { subject: 'whether people appreciate quality goods', tone: 'slightly bitter', weight: 2, initiatorHook: 'Nobody here understands what fine goods cost. Vent your frustration briefly.', category: 'role:whether people appreciate quality goods' },
  ],
  guard: [
    { subject: 'suspicious footprints near the gate', tone: 'alert, dutiful', weight: 2, initiatorHook: 'You noticed something odd during patrol. Mention it.', category: 'role:suspicious footprints near the gate' },
    { subject: 'how quiet the roads have been', tone: 'contemplative', weight: 2, initiatorHook: 'It\'s been unusually quiet. You\'re not sure if that\'s good or bad.', category: 'role:how quiet the roads have been' },
    { subject: 'the paperwork piling up', tone: 'weary sigh', weight: 2, initiatorHook: 'Duty weighs on you today. Mention the administrative burden.', category: 'role:the paperwork piling up' },
  ],
  priest: [
    { subject: 'a parishioner who came for counsel', tone: 'thoughtful, careful', weight: 2, initiatorHook: 'A young couple came to you yesterday with a disagreement. It made you think. Share a small detail.', category: 'role:a parishioner who came for counsel' },
    { subject: 'the temple roof needing repair', tone: 'practical concern', weight: 2, initiatorHook: 'Rain leaked through the temple roof last night. You need help fixing it. Ask plainly.', category: 'role:the temple roof needing repair' },
    { subject: 'a dream you had last night', tone: 'unsettled, reflective', weight: 2, initiatorHook: 'You had a strange dream and it won\'t leave you. Mention it briefly, wondering aloud.', category: 'role:a dream you had last night' },
  ],
  bard: [
    { subject: 'a melody that keeps coming back', tone: 'playful, humming', weight: 2, initiatorHook: 'A tune is stuck in your head. Hum it and ask if they recognize it.', category: 'role:a melody that keeps coming back' },
    { subject: 'an old man\'s story at the tavern', tone: 'theatrical, intrigued', weight: 2, initiatorHook: 'An old man told you something strange last night. Share the strangest part.', category: 'role:an old man\'s story at the tavern' },
    { subject: 'whether anyone even listens anymore', tone: 'wistful, self-doubt', weight: 2, initiatorHook: 'You played your heart out and nobody clapped. It stung. Mention it lightly.', category: 'role:whether anyone even listens anymore' },
  ],
  blacksmith: [
    { subject: 'a difficult piece you\'re working on', tone: 'focused, technical', weight: 2, initiatorHook: 'A commission is giving you trouble. Mention the challenge.', category: 'role:a difficult piece you\'re working on' },
    { subject: 'the price of iron going up', tone: 'annoyed, matter-of-fact', weight: 2, initiatorHook: 'Materials are getting expensive. Grumble about it.', category: 'role:the price of iron going up' },
    { subject: 'a blade you\'re proud of', tone: 'quiet pride', weight: 2, initiatorHook: 'You finished something exceptional. Mention it without boasting too much.', category: 'role:a blade you\'re proud of' },
  ],
  judge: [
    { subject: 'a difficult case from the past', tone: 'thoughtful, burdened', weight: 2, initiatorHook: 'A case from years ago still troubles you. Mention a detail that keeps you awake.', category: 'role:a difficult case from the past' },
    { subject: 'the quality of evidence in this town', tone: 'exasperated, precise', weight: 2, initiatorHook: 'People here rely on gossip instead of evidence. Express your frustration with proper procedure.', category: 'role:the quality of evidence in this town' },
    { subject: 'the burden of judgment', tone: 'weary, philosophical', weight: 2, initiatorHook: 'Deciding someone\'s fate weighs on you. Share the weight without asking for sympathy.', category: 'role:the burden of judgment' },
  ],
  herbalist: [
    { subject: 'a rare herb you found at dawn', tone: 'mysterious, pleased', weight: 2, initiatorHook: 'You found something unusual in the wild. Share the discovery.', category: 'role:a rare herb you found at dawn' },
    { subject: 'someone who came for a remedy', tone: 'knowing, cryptic', weight: 2, initiatorHook: 'Someone visited you for help. Hint at what ailed them without breaking confidence.', category: 'role:someone who came for a remedy' },
    { subject: 'the weather changing', tone: 'observant, portentous', weight: 2, initiatorHook: 'You\'ve noticed signs in the weather. Mention what it means for the herbs.', category: 'role:the weather changing' },
  ],
};

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

// ─── Default Sources (order = evaluation order, weight = selection order) ───

const DEFAULT_SOURCES: TopicSource[] = [
  beliefTopics,
  relationshipTopics,
  innerConflictTopics,
  moodTopics,
  worldFactTopics,
  roleTopics, // lowest weight — fallback to daily life
];


// ─── Fallback ───────────────────────────────────────────────────

const FALLBACK_TOPIC: TopicProposal = {
  subject: 'the day so far',
  tone: 'casual, everyday',
  weight: 0,
  initiatorHook: 'Nothing particular on your mind. Just checking in, passing the time.',
  category: 'idle',
};

// ─── Topic Source Registry (modules push here before World init) ───
export const TOPIC_SOURCE_REGISTRY: TopicSource[] = [];

// ─── Topic Engine ───────────────────────────────────────────────

export class TopicEngine {
  private sources: TopicSource[] = [...DEFAULT_SOURCES, ...TOPIC_SOURCE_REGISTRY];
  /** pairKey → last N topic categories */
  private topicHistory: Map<string, string[]> = new Map();

  /** Register a new topic source (e.g. from Trauma layer, Faction system) */
  registerSource(source: TopicSource): void {
    this.sources.push(source);
  }

  /** Select the best conversation topic for a pair */
  selectTopic(
    initiator: Agent,
    responder: Agent,
    gameDay: number,
    period: string,
  ): TopicProposal {
    const key = pairKey(initiator.profile.id, responder.profile.id);
    const recentTopics = this.topicHistory.get(key) ?? [];

    const ctx: TopicContext = { recentTopics, gameDay, period };

    // Collect all proposals from all sources
    const allProposals: TopicProposal[] = [];
    for (const source of this.sources) {
      allProposals.push(...source(initiator, responder, ctx));
    }

    if (allProposals.length === 0) return FALLBACK_TOPIC;

    // Penalize recently discussed categories
    for (const p of allProposals) {
      const recentCount = recentTopics.filter(t => t === p.category).length;
      p.weight -= recentCount * 3;
    }

    // Sort by weight with small random noise for variety
    allProposals.sort((a, b) =>
      (b.weight + Math.random() * 1.5) - (a.weight + Math.random() * 1.5),
    );

    const winner = allProposals[0].weight > 0 ? allProposals[0] : FALLBACK_TOPIC;

    // Track this topic
    const history = this.topicHistory.get(key) ?? [];
    history.push(winner.category);
    // Keep last 6 topics per pair
    if (history.length > 6) history.shift();
    this.topicHistory.set(key, history);

    return winner;
  }

  /** Reset topic history (e.g. on day advance) */
  resetHistory(): void {
    this.topicHistory.clear();
  }

  toJSON(): object {
    const history: Record<string, string[]> = {};
    for (const [key, val] of this.topicHistory) {
      history[key] = val;
    }
    return { topicHistory: history };
  }

  loadState(data: { topicHistory?: Record<string, string[]> }): void {
    this.topicHistory.clear();
    if (data.topicHistory) {
      for (const [key, val] of Object.entries(data.topicHistory)) {
        this.topicHistory.set(key, val);
      }
    }
  }
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}
