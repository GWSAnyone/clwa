/**
 * Crime & Justice topic sources — crime-specific conversation topics.
 * Registered by crime-justice module via TOPIC_SOURCE_REGISTRY.
 *
 * Follows same patterns as social topic sources:
 * - Bidirectional (both participants' beliefs generate proposals)
 * - Recency weighted (recent events = higher weight)
 * - topicKey for cross-source dedup with social beliefTopics
 */

import type { Agent } from '@clwa/engine';
import type { TopicSource, TopicProposal, TopicContext } from '@clwa/engine';
import { getEventLabel } from '@clwa/engine';

// ─── Justice Topics ────────────────────────────────────────────
// Arrest, sentencing, fled — crime-specific event discussions.

export const justiceTopics: TopicSource = (init, resp, ctx) => {
  const proposals: TopicProposal[] = [];
  const initBeliefs = init.state.beliefs?.getAllBeliefs() ?? [];
  const respBeliefs = resp.state.beliefs?.getAllBeliefs() ?? [];
  const proposed = new Set<string>();

  // Helper: generate justice topic from a belief
  const propose = (
    belief: typeof initBeliefs[0],
    speaker: Agent,
    listener: Agent,
    listenerBeliefs: typeof initBeliefs,
    isInitiator: boolean,
  ) => {
    const label = getEventLabel(belief.eventType);
    if (!label) return;

    const targetId = belief.eventType === 'NPC_FLED'
      ? (belief.subject ?? 'someone')
      : (belief.object ?? 'someone');
    const name = ctx.agents?.get(targetId)?.profile.name ?? targetId;

    const key = `justice:${belief.eventType}:${targetId}`;
    if (proposed.has(key)) return;
    proposed.add(key);

    // Recency bonus
    const daysAgo = ctx.gameDay - (belief.gameDay ?? 0);
    const recencyBonus = daysAgo <= 0 ? 3 : daysAgo <= 1 ? 1 : 0;

    const listenerKnows = listenerBeliefs.some(
      b => b.eventType === belief.eventType &&
        (belief.eventType === 'NPC_FLED' ? b.subject === belief.subject : b.object === belief.object),
    );

    if (belief.eventType === 'NPC_ARRESTED') {
      if (listenerKnows) {
        proposals.push({
          topicKey: `event:NPC_ARRESTED:${name}`,
          subject: `the arrest of ${name}`,
          tone: 'shocked, processing',
          moodValence: -0.02,
          weight: 6 + recencyBonus,
          initiatorHook: `${name} was arrested. You both know. Share your reaction — is justice being served?`,
          responderHook: `You also heard about the arrest. React with your own feelings — relief, doubt, anger?`,
          category: 'justice',
          minImportance: 6,
        });
      } else if (isInitiator) {
        proposals.push({
          topicKey: `event:NPC_ARRESTED:${name}`,
          subject: `the arrest of ${name}`,
          tone: 'urgent, dramatic',
          moodValence: -0.025,
          weight: 8 + recencyBonus,
          initiatorHook: `${name} was arrested! Break the news to ${resp.profile.name}.`,
          responderHook: `This is the first you're hearing of this. React with genuine surprise.`,
          category: 'justice',
          minImportance: 6,
          beliefTransfer: { eventType: 'NPC_ARRESTED', object: name, confidenceMultiplier: 0.5 },
        });
      } else {
        proposals.push({
          topicKey: `event:NPC_ARRESTED:${name}`,
          subject: `the arrest of ${name}`,
          tone: 'probing, curious',
          moodValence: -0.015,
          weight: 7 + recencyBonus,
          initiatorHook: `You sense something happened. Ask ${resp.profile.name} what's going on.`,
          responderHook: `${name} was arrested. Decide if you tell ${init.profile.name} — and how much.`,
          category: 'justice',
          minImportance: 6,
          beliefTransfer: { eventType: 'NPC_ARRESTED', object: name, confidenceMultiplier: 0.5 },
        });
      }
    }

    if (belief.eventType === 'NPC_SENTENCED') {
      if (listenerKnows) {
        proposals.push({
          topicKey: `event:NPC_SENTENCED:${name}`,
          subject: `the sentencing of ${name}`,
          tone: 'solemn, reflective',
          moodValence: -0.015,
          weight: 7 + recencyBonus,
          initiatorHook: `${name} has been sentenced. Share whether you think justice was done.`,
          responderHook: `You heard about the verdict too. Was it fair? Too harsh? Too lenient?`,
          category: 'justice',
          minImportance: 6,
        });
      } else if (isInitiator) {
        proposals.push({
          topicKey: `event:NPC_SENTENCED:${name}`,
          subject: `the sentencing of ${name}`,
          tone: 'urgent, dramatic',
          moodValence: -0.02,
          weight: 8 + recencyBonus,
          initiatorHook: `${name} has been sentenced! Tell ${resp.profile.name} what happened.`,
          responderHook: `First you're hearing of the verdict. React honestly.`,
          category: 'justice',
          minImportance: 6,
          beliefTransfer: { eventType: 'NPC_SENTENCED', object: name, confidenceMultiplier: 0.5 },
        });
      } else {
        proposals.push({
          topicKey: `event:NPC_SENTENCED:${name}`,
          subject: `the sentencing of ${name}`,
          tone: 'probing',
          moodValence: -0.01,
          weight: 7 + recencyBonus,
          initiatorHook: `Something happened at the courthouse. Ask ${resp.profile.name}.`,
          responderHook: `${name} was sentenced. Share the verdict with ${init.profile.name}.`,
          category: 'justice',
          minImportance: 6,
          beliefTransfer: { eventType: 'NPC_SENTENCED', object: name, confidenceMultiplier: 0.5 },
        });
      }
    }

    if (belief.eventType === 'NPC_FLED') {
      if (listenerKnows) {
        proposals.push({
          topicKey: `event:NPC_FLED:${name}`,
          subject: `${name} fleeing town`,
          tone: 'alarmed, speculative',
          moodValence: -0.02,
          weight: 5 + recencyBonus,
          initiatorHook: `${name} fled the town. What does this mean? Speculate together.`,
          responderHook: `You also know ${name} ran. Share what you think it means.`,
          category: 'justice',
        });
      } else if (isInitiator) {
        proposals.push({
          topicKey: `event:NPC_FLED:${name}`,
          subject: `${name} fleeing town`,
          tone: 'alarmed, breaking news',
          moodValence: -0.025,
          weight: 7 + recencyBonus,
          initiatorHook: `${name} fled the town! Tell ${resp.profile.name}.`,
          responderHook: `${name} is gone? React with shock — what does this mean for the town?`,
          category: 'justice',
          beliefTransfer: { eventType: 'NPC_FLED', subject: name, confidenceMultiplier: 0.5 },
        });
      } else {
        proposals.push({
          topicKey: `event:NPC_FLED:${name}`,
          subject: `${name} fleeing town`,
          tone: 'probing',
          moodValence: -0.01,
          weight: 6 + recencyBonus,
          initiatorHook: `You haven't seen ${name} around. Ask ${resp.profile.name} if they know anything.`,
          responderHook: `${name} fled. Tell ${init.profile.name} — or keep it to yourself.`,
          category: 'justice',
          beliefTransfer: { eventType: 'NPC_FLED', subject: name, confidenceMultiplier: 0.5 },
        });
      }
    }
  };

  // BIDIRECTIONAL: both participants' beliefs generate proposals
  const justiceTypes = ['NPC_ARRESTED', 'NPC_SENTENCED', 'NPC_FLED'];
  for (const belief of initBeliefs.filter(b => justiceTypes.includes(b.eventType) && b.confidence >= 0.3)) {
    propose(belief, init, resp, respBeliefs, true);
  }
  for (const belief of respBeliefs.filter(b => justiceTypes.includes(b.eventType) && b.confidence >= 0.3)) {
    propose(belief, resp, init, initBeliefs, false);
  }

  return proposals;
};

// ─── Player Rumor Topics ───────────────────────────────────────
// NPCs discuss what the player said/did — trust, claims, behavior.

export const playerRumorTopics: TopicSource = (init, resp, ctx) => {
  const proposals: TopicProposal[] = [];
  if (!ctx.playerAgent) return proposals;

  const playerId = ctx.playerAgent.profile.id;
  const playerName = ctx.playerAgent.profile.name;

  const initRel = init.state.relationships?.getRelationship(playerId);
  const respRel = resp.state.relationships?.getRelationship(playerId);

  // NPC received claims from player — share with conversation partner
  const initPlayerBeliefs = init.state.beliefs?.getAllBeliefs().filter(b => b.sourceNpcId === playerId) ?? [];
  const seenSubjects = new Set<string>();
  for (const belief of initPlayerBeliefs.sort((a, b) => b.confidence - a.confidence)) {
    const subjectKey = belief.subject ?? '_no_subject';
    if (seenSubjects.has(subjectKey)) continue;
    seenSubjects.add(subjectKey);

    const daysAgo = ctx.gameDay - (belief.gameDay ?? 0);
    const recencyBonus = daysAgo <= 0 ? 2 : daysAgo <= 1 ? 1 : 0;

    const suspectDisplay = belief.subject ? (ctx.agents?.get(belief.subject)?.profile.name ?? belief.subject) : null;
    const topic = suspectDisplay ? `what ${playerName} said about ${suspectDisplay}` : `what ${playerName} told me`;
    proposals.push({
      topicKey: `player_claim:${subjectKey}`,
      subject: topic,
      tone: (initRel?.trust ?? 0.3) >= 0.5 ? 'thoughtful, considering' : 'skeptical, uncertain',
      moodValence: -0.005,
      mentionedNpcId: playerId,
      sentimentValence: (initRel?.trust ?? 0.3) >= 0.5 ? 0.02 : -0.02,
      weight: 4 + recencyBonus,
      initiatorHook: `${playerName} told you something about ${suspectDisplay ?? 'recent events'}. Share what you heard and whether you believe it.`,
      responderHook: `React to what ${init.profile.name} is saying. Do you trust ${playerName}?`,
      category: `player_rumor:${subjectKey}`,
      minImportance: 4,
    });
  }

  // Bidirectional: responder's player beliefs too
  const respPlayerBeliefs = resp.state.beliefs?.getAllBeliefs().filter(b => b.sourceNpcId === playerId) ?? [];
  for (const belief of respPlayerBeliefs.sort((a, b) => b.confidence - a.confidence)) {
    const subjectKey = belief.subject ?? '_no_subject';
    if (seenSubjects.has(subjectKey)) continue;
    seenSubjects.add(subjectKey);

    const daysAgo = ctx.gameDay - (belief.gameDay ?? 0);
    const recencyBonus = daysAgo <= 0 ? 2 : daysAgo <= 1 ? 1 : 0;

    proposals.push({
      topicKey: `player_claim:${subjectKey}`,
      subject: `what ${playerName} told ${resp.profile.name}`,
      tone: (respRel?.trust ?? 0.3) >= 0.5 ? 'thoughtful' : 'skeptical',
      moodValence: -0.005,
      mentionedNpcId: playerId,
      sentimentValence: (respRel?.trust ?? 0.3) >= 0.5 ? 0.02 : -0.02,
      weight: 4 + recencyBonus,
      initiatorHook: `Ask ${resp.profile.name} — has ${playerName} told them anything interesting?`,
      responderHook: `${playerName} told you about ${belief.subject ? (ctx.agents?.get(belief.subject)?.profile.name ?? belief.subject) : 'something'}. Share it.`,
      category: `player_rumor:${subjectKey}`,
      minImportance: 4,
    });
  }

  // NPC had negative interaction with player
  if (initRel && initRel.sentiment <= -0.2) {
    proposals.push({
      subject: `${playerName}'s behavior`,
      tone: 'displeased, wary',
      moodValence: -0.01,
      mentionedNpcId: playerId,
      sentimentValence: -0.04,
      weight: 4,
      initiatorHook: `You don't trust ${playerName}. Share your unease — they made you uncomfortable.`,
      responderHook: `React to this warning about ${playerName}. Do you share the concern?`,
      category: 'player_rumor',
    });
  } else if (respRel && respRel.sentiment <= -0.2) {
    proposals.push({
      subject: `${playerName}'s behavior`,
      tone: 'displeased, wary',
      moodValence: -0.01,
      mentionedNpcId: playerId,
      sentimentValence: -0.04,
      weight: 4,
      initiatorHook: `You've heard ${resp.profile.name} has concerns about ${playerName}. Ask about it.`,
      responderHook: `You don't trust ${playerName}. Warn ${init.profile.name}.`,
      category: 'player_rumor',
    });
  }

  // NPC trusts player highly — recommend
  if (initRel && initRel.trust >= 0.6 && initRel.sentiment >= 0.2) {
    proposals.push({
      subject: `${playerName}'s reliability`,
      tone: 'warm, approving',
      moodValence: 0.01,
      mentionedNpcId: playerId,
      sentimentValence: 0.03,
      weight: 3,
      initiatorHook: `${playerName} has proven trustworthy. Mention them positively.`,
      category: 'player_rumor',
    });
  }

  return proposals;
};
