import type { TopicSource, TopicProposal } from '@clwa/engine';

/** Justice-related conversation topics — registered by crime-justice module */
export const justiceTopics: TopicSource = (init, resp) => {
  const proposals: ReturnType<TopicSource> = [];
  const initBeliefs = init.state.beliefs?.getAllBeliefs() ?? [];
  const respBeliefs = resp.state.beliefs?.getAllBeliefs() ?? [];

  // Arrest beliefs
  const arrestBeliefs = initBeliefs.filter(b => b.eventType === 'NPC_ARRESTED' && b.confidence >= 0.3);
  for (const ab of arrestBeliefs) {
    const suspectName = ab.object ?? 'someone';
    const respKnows = respBeliefs.some(b => b.eventType === 'NPC_ARRESTED' && b.object === ab.object);
    if (respKnows) {
      proposals.push({
        subject: `the arrest of ${suspectName}`,
        tone: 'shocked, processing',
        weight: 7,
        initiatorHook: `${suspectName} was arrested. Share your reaction — is justice being served?`,
        responderHook: `You also heard about the arrest. React with your own feelings about it.`,
        category: 'justice',
        minImportance: 6,
      });
    } else {
      proposals.push({
        subject: `the arrest of ${suspectName}`,
        tone: 'urgent, dramatic',
        weight: 8,
        initiatorHook: `You just heard that ${suspectName} was arrested! Break the news.`,
        responderHook: `This is the first you're hearing of this. React with genuine surprise.`,
        category: 'justice',
        minImportance: 6,
      });
    }
  }

  // Sentence beliefs
  const sentenceBeliefs = initBeliefs.filter(b => b.eventType === 'NPC_SENTENCED' && b.confidence >= 0.3);
  for (const sb of sentenceBeliefs) {
    const suspectName = sb.object ?? 'someone';
    proposals.push({
      subject: `the sentencing of ${suspectName}`,
      tone: 'solemn, reflective',
      weight: 8,
      initiatorHook: `${suspectName} has been sentenced. Share whether you think justice was done.`,
      category: 'justice',
    });
  }

  // Fled beliefs
  const fledBeliefs = initBeliefs.filter(b => b.eventType === 'NPC_FLED' && b.confidence >= 0.3);
  for (const fb of fledBeliefs) {
    const fledName = fb.subject ?? 'someone';
    proposals.push({
      subject: `${fledName} fleeing town`,
      tone: 'alarmed, speculative',
      weight: 6,
      initiatorHook: `${fledName} fled the town! What does this mean? Share your thoughts.`,
      category: 'justice',
    });
  }

  return proposals;
};

/** Topics about the player — NPCs discuss what the player said/did */
export const playerRumorTopics: TopicSource = (init, resp, ctx) => {
  const proposals: TopicProposal[] = [];
  if (!ctx.playerAgent) return proposals;

  const playerId = ctx.playerAgent.profile.id;
  const playerName = ctx.playerAgent.profile.name;

  // Check if either NPC has notable relationship with player
  const initRel = init.state.relationships?.getRelationship(playerId);
  const respRel = resp.state.relationships?.getRelationship(playerId);

  // NPC received claims from player — one proposal per unique subject (diversity)
  const initPlayerBeliefs = init.state.beliefs?.getAllBeliefs().filter(b => b.sourceNpcId === playerId) ?? [];
  const seenSubjects = new Set<string>();
  for (const belief of initPlayerBeliefs.sort((a, b) => b.confidence - a.confidence)) {
    const subjectKey = belief.subject ?? '_no_subject';
    if (seenSubjects.has(subjectKey)) continue;
    seenSubjects.add(subjectKey);
    const topic = belief.subject ? `what ${playerName} said about ${belief.subject}` : `what ${playerName} told me`;
    proposals.push({
      subject: topic,
      tone: (initRel?.trust ?? 0.3) >= 0.5 ? 'thoughtful, considering' : 'skeptical, uncertain',
      weight: 5,
      initiatorHook: `${playerName} told you something about ${belief.subject ?? 'recent events'}. Share what you heard and whether you believe it.`,
      responderHook: `React to what ${init.profile.name} is saying. Do you trust ${playerName}?`,
      category: `player_rumor:${subjectKey}`,
      minImportance: 4,
    });
  }

  // NPC had negative interaction with player (low sentiment)
  if (initRel && initRel.sentiment <= -0.2) {
    proposals.push({
      subject: `${playerName}'s behavior`,
      tone: 'displeased, wary',
      weight: 4,
      initiatorHook: `You don't trust ${playerName}. Share your unease — they made you uncomfortable.`,
      responderHook: `React to this warning about ${playerName}. Do you share the concern?`,
      category: 'player_rumor',
    });
  } else if (respRel && respRel.sentiment <= -0.2) {
    proposals.push({
      subject: `${playerName}'s behavior`,
      tone: 'displeased, wary',
      weight: 4,
      initiatorHook: `You've heard ${resp.profile.name} has concerns about ${playerName}. Ask about it.`,
      responderHook: `You don't trust ${playerName}. Warn ${init.profile.name}.`,
      category: 'player_rumor',
    });
  }

  // NPC trusts player highly (positive sentiment) — recommend
  if (initRel && initRel.trust >= 0.6 && initRel.sentiment >= 0.2) {
    proposals.push({
      subject: `${playerName}'s reliability`,
      tone: 'warm, approving',
      weight: 3,
      initiatorHook: `${playerName} has proven trustworthy. Mention them positively.`,
      category: 'player_rumor',
    });
  }

  return proposals;
};
