/**
 * Social module topic sources — universal social conversation topics.
 * These are NOT engine code — they are content that fills TOPIC_SOURCE_REGISTRY.
 *
 * Migrated from engine/topic-engine.ts to follow the engine/module separation principle.
 */

import type { Agent } from '@clwa/engine';
import {
  type TopicSource,
  type TopicProposal,
  type TopicContext,
  TOPIC_SOURCE_REGISTRY,
} from '@clwa/engine';
import { getEventLabel, isDeathEvent, getRoleTopicPool, getLocationHook } from '@clwa/engine';

// ─── Belief Topics ─────────────────────────────────────────────
// NPC shares or discusses structured beliefs about world events.

const beliefTopics: TopicSource = (init, resp, ctx) => {
  const proposals: TopicProposal[] = [];
  const initBeliefs = init.state.beliefs?.getAllBeliefs()
    .filter(b => b.confidence >= 0.3 && b.object) ?? [];
  const respBeliefs = resp.state.beliefs?.getAllBeliefs()
    .filter(b => b.confidence >= 0.3 && b.object) ?? [];

  // Track already-proposed event+object combos to avoid duplicates from bidirectional scan
  const proposed = new Set<string>();

  // Helper: generate a proposal for a belief one NPC has
  const propose = (
    belief: typeof initBeliefs[0],
    speaker: Agent,
    listener: Agent,
    listenerBeliefs: typeof initBeliefs,
    isInitiator: boolean,
  ) => {
    const eventLabel = getEventLabel(belief.eventType);
    if (!eventLabel) return;

    const key = `${belief.eventType}:${belief.object}`;
    if (proposed.has(key)) return;
    proposed.add(key);

    const victim = belief.object ?? 'someone';
    const topicCategory = `event:${belief.eventType}`;

    // Recency bonus: beliefs from today/yesterday are more urgent
    const daysAgo = ctx.gameDay - (belief.gameDay ?? 0);
    const recencyBonus = daysAgo <= 0 ? 4 : daysAgo <= 1 ? 2 : 0;

    // Location bonus: if belief's location matches where they are now
    const locationBonus = belief.location === ctx.location ? 2 : 0;

    const listenerKnows = listenerBeliefs.some(
      b => b.eventType === belief.eventType && b.object === belief.object,
    );

    if (listenerKnows) {
      // Both know — process together
      proposals.push({
        topicKey: `event:${belief.eventType}:${victim}`,
        subject: `the ${eventLabel} of ${victim}`,
        tone: 'grave, processing together',
        weight: 6 + recencyBonus + locationBonus,
        initiatorHook: `You both know about the ${eventLabel} of ${victim}. Share your thoughts, fears, theories.`,
        responderHook: `You also know about the ${eventLabel}. React with your own feelings and perspective.`,
        category: topicCategory,
        minImportance: 5 + (recencyBonus > 0 ? 1 : 0),
      });
    } else if (isInitiator) {
      // Initiator knows, responder doesn't — initiator breaks the news
      proposals.push({
        topicKey: `event:${belief.eventType}:${victim}`,
        subject: `the ${eventLabel} of ${victim}`,
        tone: 'urgent, breaking the news',
        weight: 8 + recencyBonus + locationBonus,
        initiatorHook: `You need to tell ${resp.profile.name} about the ${eventLabel} of ${victim}. Break the news.`,
        responderHook: `This is the first you're hearing of this. React with genuine shock or disbelief.`,
        category: topicCategory,
        minImportance: 6,
        beliefTransfer: {
          eventType: belief.eventType,
          subject: belief.subject ?? undefined,
          object: belief.object ?? undefined,
          confidenceMultiplier: 0.5,
        },
      });
    } else {
      // Responder knows, initiator doesn't — initiator senses something, responder reveals
      proposals.push({
        topicKey: `event:${belief.eventType}:${victim}`,
        subject: `the ${eventLabel} of ${victim}`,
        tone: 'probing, something feels off',
        weight: 7 + recencyBonus + locationBonus,
        initiatorHook: `You sense ${resp.profile.name} knows something. Ask about recent events or what's troubling them.`,
        responderHook: `You know about the ${eventLabel} of ${victim}. Decide if this is the moment to tell ${init.profile.name}.`,
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
  };

  // BIDIRECTIONAL: both initiator's and responder's beliefs drive proposals
  for (const belief of initBeliefs) {
    propose(belief, init, resp, respBeliefs, true);
  }
  for (const belief of respBeliefs) {
    propose(belief, resp, init, initBeliefs, false);
  }

  return proposals;
};

// ─── Relationship Topics ───────────────────────────────────────
// Topics driven by the relationship between the two speakers.

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

  // Grief — initiator has beliefs about someone's death + positive relationship to victim
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

// ─── Inner Conflict Topics ─────────────────────────────────────
// NPC hints at their innerConflict to someone they trust.

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

// ─── Mood Topics ───────────────────────────────────────────────
// Mood-driven conversation starters.

const moodTopics: TopicSource = (init, resp) => {
  const proposals: TopicProposal[] = [];
  const initMood = init.state.mood;
  const respMood = resp.state.mood;
  const rel = init.state.relationships?.getRelationship(resp.profile.id);
  const trust = rel?.sentiment ?? 0;

  // Initiator in good mood → share positivity
  if (initMood > 0.4) {
    proposals.push({
      subject: 'something good that happened',
      tone: 'warm, sharing',
      weight: 2,
      initiatorHook: 'You\'re in a good mood. Share the feeling — maybe compliment something or reminisce.',
      responderHook: respMood > 0 ? 'You\'re also feeling good. Enjoy the moment together.' : 'They seem cheerful. You\'re not feeling it yourself.',
      category: 'mood',
    });
  }

  // Initiator distressed + trusts responder → seeks comfort
  if (initMood < -0.5 && trust > 0.2) {
    proposals.push({
      subject: 'the unease you\'re feeling',
      tone: 'guarded, restless',
      weight: 4,
      initiatorHook: 'Something is wrong and you can\'t shake it. You don\'t say it directly but it leaks through.',
      responderHook: trust > 0.4 ? `You can tell something is off with ${init.profile.name}. Gently ask.` : 'They seem troubled but you\'re not sure you should pry.',
      category: 'mood',
    });
  }

  // BIDIRECTIONAL: responder distressed, initiator notices
  if (respMood < -0.5 && trust > 0.2 && initMood > -0.3) {
    proposals.push({
      subject: `how ${resp.profile.name} seems today`,
      tone: 'concerned, gentle',
      weight: 3,
      initiatorHook: `${resp.profile.name} looks troubled. Check on them.`,
      responderHook: 'You didn\'t expect them to notice. Decide how much to reveal.',
      category: 'mood',
    });
  }

  // Both in bad mood → shared tension
  if (initMood < -0.3 && respMood < -0.3) {
    proposals.push({
      subject: 'the heaviness in the air',
      tone: 'tense, weary',
      weight: 3,
      initiatorHook: 'You both feel it — something heavy. Acknowledge it without fully naming it.',
      responderHook: 'The weight you carry is shared. Respond from that common ground.',
      category: 'mood',
    });
  }

  return proposals;
};

// ─── Role Topics ───────────────────────────────────────────────
// Role-specific topic pools (bartender gossip, guard observations, etc.)

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

// ─── World Fact Topics ─────────────────────────────────────────
// Common knowledge / world lore that NPCs can discuss.

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

// ─── Casual Topics ─────────────────────────────────────────────
// Lighthearted, everyday conversation.

const casualTopics: TopicSource = (init, resp, ctx) => {
  const proposals: TopicProposal[] = [];
  const rel = init.state.relationships?.getRelationship(resp.profile.id);

  // Friends have warm casual conversations
  if (rel && rel.sentiment > 0.1) {
    proposals.push({
      subject: 'catching up as friends',
      tone: 'warm, relaxed',
      weight: 3,
      initiatorHook: `You enjoy ${resp.profile.name}'s company. Share something lighthearted — a memory, a joke, an observation.`,
      responderHook: `Respond warmly. This is a pleasant moment between friends.`,
      category: 'casual_positive',
    });
  }

  // Craft/profession talk (boosted at workplace locations)
  if (rel && rel.type === 'colleague') {
    const atWork = ctx.location === 'Blacksmith' || ctx.location === 'Silver Flagon Tavern'
      || ctx.location === 'Market Square' || ctx.location === 'Courthouse';
    proposals.push({
      subject: `work and craft`,
      tone: 'practical, companionable',
      weight: atWork ? 3 : 2,
      initiatorHook: `Talk about your work — what you made today, a tricky order, the quality of materials.`,
      responderHook: `Share your own work experience. Mutual respect for each other's craft.`,
      category: 'casual_craft',
    });
  }

  // Location-specific small talk (hooks from world data via registry)
  if (init.state.mood > -0.2) {
    const hook = getLocationHook(ctx.location)
      ?? 'Comment on something mundane — the weather, the village, something you noticed today.';
    proposals.push({
      subject: 'village life',
      tone: 'casual, observational',
      weight: 1,
      initiatorHook: hook,
      category: 'casual_village',
    });
  }

  return proposals;
};

// ─── Seasonal / Time-of-Day Topics ─────────────────────────────
// Atmospheric topics that give conversations a sense of TIME.

const seasonalTopics: TopicSource = (_init, _resp, ctx) => {
  const proposals: TopicProposal[] = [];

  // Period-based atmosphere
  const periodTopics: Record<string, { subject: string; tone: string; hook: string }> = {
    dawn: { subject: 'the quiet of early morning', tone: 'soft, reflective', hook: 'The world feels still. Share something you noticed in the early light.' },
    morning: { subject: 'plans for the day', tone: 'purposeful, energized', hook: 'The day is young. Talk about what lies ahead — work, errands, hopes.' },
    evening: { subject: 'how the day went', tone: 'reflective, winding down', hook: 'The day is ending. Reflect on what happened — what went well, what didn\'t.' },
    night: { subject: 'the darkness outside', tone: 'intimate, guarded', hook: 'Night makes people honest. Say something you wouldn\'t say in daylight.' },
  };

  const pt = periodTopics[ctx.period];
  if (pt) {
    proposals.push({
      subject: pt.subject,
      tone: pt.tone,
      weight: 1,
      initiatorHook: pt.hook,
      category: 'casual_time',
    });
  }

  // Weekly milestones
  if (ctx.gameDay > 0 && ctx.gameDay % 7 === 0) {
    proposals.push({
      subject: 'another week gone by',
      tone: 'contemplative',
      weight: 2,
      initiatorHook: 'A week has passed. Comment on how fast or slow time feels, or what changed.',
      category: 'casual_time',
    });
  }

  return proposals;
};

// ─── Memory Topics ─────────────────────────────────────────────
// NPC recalls past events (old beliefs) and brings them up.
// "Remember when..." — creates a sense of shared history.

const memoryTopics: TopicSource = (init, resp, ctx) => {
  const proposals: TopicProposal[] = [];
  const initBeliefs = init.state.beliefs?.getAllBeliefs() ?? [];

  // Old beliefs (2+ days ago) with decent confidence = worth revisiting
  const oldBeliefs = initBeliefs.filter(
    b => b.object && b.confidence >= 0.4 && (ctx.gameDay - (b.gameDay ?? 0)) >= 2,
  );

  for (const belief of oldBeliefs) {
    const eventLabel = getEventLabel(belief.eventType);
    if (!eventLabel) continue;
    const victim = belief.object ?? 'someone';
    const daysAgo = ctx.gameDay - (belief.gameDay ?? 0);

    // Does responder also remember this?
    const respAlsoKnows = resp.state.beliefs?.getAllBeliefs().some(
      b => b.eventType === belief.eventType && b.object === belief.object,
    ) ?? false;

    if (respAlsoKnows) {
      proposals.push({
        topicKey: `event:${belief.eventType}:${victim}`,
        subject: `what happened to ${victim}`,
        tone: 'reflective, heavy',
        weight: 2,
        initiatorHook: `It's been ${daysAgo} days since the ${eventLabel}. You still think about it. Bring it up — how it changed things.`,
        responderHook: `You remember too. Share how it's been sitting with you since then.`,
        category: 'memory',
        minImportance: 3,
      });
    } else {
      proposals.push({
        topicKey: `event:${belief.eventType}:${belief.object}`,
        subject: `something that happened ${daysAgo} days ago`,
        tone: 'recounting, storytelling',
        weight: 2,
        initiatorHook: `You've been thinking about the ${eventLabel} of ${victim}. Tell them what you know — it's been on your mind.`,
        responderHook: `This happened days ago and you're hearing about it now. React with curiosity or concern.`,
        category: 'memory',
        minImportance: 3,
        beliefTransfer: {
          eventType: belief.eventType,
          subject: belief.subject ?? undefined,
          object: belief.object ?? undefined,
          confidenceMultiplier: 0.4,
        },
      });
    }

    if (proposals.length >= 2) break; // max 2 memory topics per conversation
  }

  return proposals;
};

// ─── Opinion Topics ────────────────────────────────────────────
// NPC A and NPC B discuss NPC C — social web dynamics.
// "What do you think about Mark?" — alliances, rivalries, trust.

const opinionTopics: TopicSource = (init, resp) => {
  const proposals: TopicProposal[] = [];
  const initRels = init.state.relationships?.getAllRelationships() ?? [];
  const respRels = resp.state.relationships?.getAllRelationships() ?? [];

  // Collect death beliefs to avoid discussing dead NPCs as if alive
  const allBeliefs = [
    ...(init.state.beliefs?.getAllBeliefs() ?? []),
    ...(resp.state.beliefs?.getAllBeliefs() ?? []),
  ];
  const knownDead = new Set(
    allBeliefs.filter(b => isDeathEvent(b.eventType) && b.object).map(b => b.object!),
  );

  // Find third-party NPCs that BOTH have opinions about
  for (const initRel of initRels) {
    // Don't discuss the person you're talking TO
    if (initRel.targetId === resp.profile.id) continue;

    const respRel = respRels.find(r => r.targetId === initRel.targetId);
    if (!respRel) continue;

    const name = initRel.targetName;

    // Skip dead NPCs for "how are they doing" topics (grief handled separately)
    if (knownDead.has(name)) continue;

    const initSent = initRel.sentiment;
    const respSent = respRel.sentiment;

    // Both negative → shared complaint
    if (initSent < -0.2 && respSent < -0.2) {
      proposals.push({
        subject: `${name} and their behavior`,
        tone: 'conspiratorial, venting',
        weight: 3,
        initiatorHook: `You both have issues with ${name}. Vent about them — shared frustration.`,
        responderHook: `You share their frustration about ${name}. Add your own grievance.`,
        category: 'opinion',
      });
    }
    // Both positive → warm concern
    else if (initSent > 0.2 && respSent > 0.2) {
      proposals.push({
        subject: `how ${name} is doing`,
        tone: 'warm, caring',
        weight: 2,
        initiatorHook: `You both care about ${name}. Ask how they've been, share something you noticed.`,
        responderHook: `You also care about ${name}. Share your perspective on how they're doing.`,
        category: 'opinion',
      });
    }
    // Disagreement → tension about third party
    else if ((initSent > 0.2 && respSent < -0.2) || (initSent < -0.2 && respSent > 0.2)) {
      proposals.push({
        subject: `your different views on ${name}`,
        tone: 'tense, probing',
        weight: 4,
        initiatorHook: initSent > 0
          ? `You don't understand why ${resp.profile.name} dislikes ${name}. Gently challenge their view.`
          : `You don't understand why ${resp.profile.name} defends ${name}. Push back.`,
        responderHook: respSent > 0
          ? `You like ${name} and won't let them be badmouthed. Defend them.`
          : `You dislike ${name} and think the initiator is naive. Say why.`,
        category: 'conflict',
      });
    }

    if (proposals.length >= 2) break; // max 2 opinion topics
  }

  return proposals;
};

// ─── Question Topics ───────────────────────────────────────────
// NPC asks about things they DON'T know — information seeking.
// Drives organic information flow: "Have you heard about...?"

const questionTopics: TopicSource = (init, resp) => {
  const proposals: TopicProposal[] = [];
  const initBeliefs = init.state.beliefs?.getAllBeliefs() ?? [];
  const respBeliefs = resp.state.beliefs?.getAllBeliefs() ?? [];

  // Low-confidence beliefs → seeking confirmation
  const vagueBeliefs = initBeliefs.filter(b => b.confidence > 0.1 && b.confidence < 0.4 && b.object);
  for (const belief of vagueBeliefs) {
    const eventLabel = getEventLabel(belief.eventType);
    if (!eventLabel) continue;

    proposals.push({
      topicKey: `event:${belief.eventType}:${belief.object}`,
      subject: `rumors about ${belief.object}`,
      tone: 'curious, probing',
      weight: 2,
      initiatorHook: `You heard something vague about the ${eventLabel} of ${belief.object}. Ask if ${resp.profile.name} knows more.`,
      responderHook: resp.state.beliefs?.getAllBeliefs().some(
        b => b.eventType === belief.eventType && b.object === belief.object && b.confidence >= 0.4,
      )
        ? `You know more about this than they do. Decide how much to share.`
        : `You don't know much either. Speculate cautiously.`,
      category: 'question',
    });

    if (proposals.length >= 1) break; // max 1 question topic
  }

  // Responder has knowledge that initiator completely lacks
  if (proposals.length === 0) {
    for (const rBelief of respBeliefs) {
      if (rBelief.confidence < 0.4 || !rBelief.object) continue;
      const eventLabel = getEventLabel(rBelief.eventType);
      if (!eventLabel) continue;

      const initKnows = initBeliefs.some(
        b => b.eventType === rBelief.eventType && b.object === rBelief.object,
      );
      if (initKnows) continue;

      // Initiator is curious about the topic area (indirect question)
      proposals.push({
        topicKey: `event:${rBelief.eventType}:${rBelief.object}`,
        subject: `what's been happening lately`,
        tone: 'casual curiosity',
        weight: 2,
        initiatorHook: `Ask ${resp.profile.name} if anything interesting has happened. You sense there's more going on than you know.`,
        responderHook: `You know about the ${eventLabel} of ${rBelief.object}. Decide if this is the moment to share.`,
        category: 'question',
        beliefTransfer: {
          eventType: rBelief.eventType,
          subject: rBelief.subject ?? undefined,
          object: rBelief.object ?? undefined,
          confidenceMultiplier: 0.4,
        },
      });

      break; // one is enough
    }
  }

  return proposals;
};

// ─── All social topic sources ──────────────────────────────────

export const SOCIAL_TOPIC_SOURCES: TopicSource[] = [
  beliefTopics,
  relationshipTopics,
  innerConflictTopics,
  moodTopics,
  roleTopics,
  worldFactTopics,
  casualTopics,
  seasonalTopics,
  memoryTopics,
  opinionTopics,
  questionTopics,
];
