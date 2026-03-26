import type { Agent } from './agent';
import type { IEventStore } from './event-types';
import { getSecretDirectiveBuilders, isTransferable, isConcealment, isFirsthand, getEventLabel } from './event-registry';

/**
 * Build behavioral directives based on what an NPC secretly knows.
 * Injected into the LLM prompt so the NPC naturally acts on hidden knowledge.
 *
 * Universal system — works for crimes, secrets, cover-ups, threats, blackmail.
 * No extra LLM calls — pure prompt enrichment.
 */
export function buildSecretDirectives(
  agent: Agent,
  agents: Map<string, Agent>,
  eventStore: IEventStore,
): string {
  const sections: string[] = [];
  const agentId = agent.profile.id;

  // 1. Own crimes — did this NPC commit a crime?
  const ownCrimes = eventStore.getAll()
    .filter((e) => isTransferable(e.type) && e.subject === agentId);

  if (ownCrimes.length > 0) {
    const crime = ownCrimes[ownCrimes.length - 1];
    const victimName = (crime.payload?.victimName as string) ?? 'someone';
    const crimeLabel = getEventLabel(crime.type) ?? 'an incident';
    sections.push(
      `## HIDDEN: You committed ${crimeLabel}\n` +
      `You committed ${crimeLabel} against ${victimName}. Nobody must find out.\n` +
      `- If asked about ${victimName} or the ${crimeLabel}: act surprised, deny any involvement.\n` +
      `- If confronted with evidence pointing to you: become defensive, try to explain it away.\n` +
      `- If pressed hard: show cracks — nervous pauses, contradictions — but do NOT confess easily.\n` +
      `- You may try to redirect suspicion to someone else if it feels natural.`,
    );
  }

  // 2. Covering for someone — check beliefs with concealment source category
  const beliefs = agent.state.beliefs;
  if (beliefs) {
    const coverBeliefs = beliefs.getAllBeliefs()
      .filter((b) => isConcealment(b.source));

    for (const belief of coverBeliefs) {
      const coveredId = belief.subject;
      if (!coveredId) continue;
      const coveredAgent = agents.get(coveredId);
      const coveredName = coveredAgent?.profile.name ?? 'someone';
      const rel = agent.state.relationships?.getRelationship(coveredId);
      const relType = rel?.type ?? 'acquaintance';

      const coverCrimeLabel = getEventLabel(belief.eventType) ?? 'something wrong';
      sections.push(
        `## HIDDEN: You are covering for ${coveredName}\n` +
        `You saw ${coveredName} commit ${coverCrimeLabel}, but you are protecting them because they are your ${relType}.\n` +
        `- If asked about the ${coverCrimeLabel}: claim you didn't see anything clearly, be vague.\n` +
        `- If asked directly about ${coveredName}: change the subject or say something neutral.\n` +
        `- If pressed with evidence against ${coveredName}: show internal conflict — you hesitate, look away, almost speak but catch yourself.\n` +
        `- You feel guilt about hiding the truth. This leaks through in nervous mannerisms.`,
      );
    }

    // 3. Witnessed a crime (not covering) — check direct experience beliefs
    const coveredSubjects = new Set(coverBeliefs.map((b) => b.subject));
    const witnessBeliefs = beliefs.getAllBeliefs()
      .filter((b) =>
        isFirsthand(b.source) &&
        isTransferable(b.eventType) &&
        !coveredSubjects.has(b.subject),
      );

    for (const wb of witnessBeliefs) {
      const suspectId = wb.subject;
      if (!suspectId) continue;

      const suspectAgent = agents.get(suspectId);
      const suspectName = suspectAgent?.profile.name ?? suspectId;
      const rel = agent.state.relationships?.getRelationship(suspectId);
      const sentiment = rel?.sentiment ?? 0;

      if (sentiment < -0.2) {
        const justiceCrimeLabel = getEventLabel(wb.eventType) ?? 'a crime';
        sections.push(
          `## HIDDEN: You want justice\n` +
          `You have information about ${justiceCrimeLabel} and you suspect ${suspectName}.\n` +
          `- You are eager to share what you know — even volunteer details without being asked.\n` +
          `- You may exaggerate slightly to make sure the guilty party is caught.`,
        );
      }
    }
  }

  // 4+. Module/server-registered secret directive builders
  for (const builder of getSecretDirectiveBuilders()) {
    const extra = builder({ agent, agents, eventStore });
    sections.push(...extra);
  }

  if (sections.length === 0) return '';

  return sections.join('\n\n');
}
