import type { TopicSource } from '@clwa/engine';

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
