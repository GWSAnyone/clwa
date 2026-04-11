/**
 * Heat System — Criminal Danger Awareness (SPEC-heat-system)
 *
 * Heat is a belief-derived score representing the criminal's PERCEPTION of danger.
 * It reads existing beliefs, relationships, and location state — no new engine types.
 * Output: secret directive prose that shapes LLM behavior through instinct pressure.
 */

import type { Agent } from '@clwa/engine';
import { isPerpetrator } from '@clwa/engine';

export interface HeatContext {
  agents: Map<string, Agent>;
}

export type HeatLevel = 'safe' | 'uneasy' | 'anxious' | 'panicked' | 'desperate';

/**
 * Compute heat score (0.0–1.0) for an agent based on their beliefs and environment.
 * Returns 0 if the agent is not a perpetrator.
 */
export function computeHeat(agent: Agent, ctx: HeatContext): number {
  const beliefs = agent.state.beliefs?.getAllBeliefs() ?? [];

  // Find perpetrator belief — this agent committed a crime
  const perpetratorBelief = beliefs.find(b => isPerpetrator(b.source));
  if (!perpetratorBelief) return 0;

  let heat = 0;

  // ─── Time-based paranoia ───
  // The longer since the crime, the more the criminal worries about being caught.
  // Capped — pure time pressure shouldn't dominate.
  const crimeDay = perpetratorBelief.gameDay;
  const currentDay = agent.state.currentDay ?? crimeDay;
  const daysSinceCrime = currentDay - crimeDay;
  heat += Math.min(0.15, daysSinceCrime * 0.1);

  // ─── Witness awareness ───
  // Criminal knows witnesses exist if they received witness-type beliefs about their own crime
  // (e.g., they saw people at the crime scene, or learned through rumors)
  const crimeEventType = perpetratorBelief.eventType;
  const selfName = agent.profile.name;

  // Check if criminal has any beliefs suggesting others know about the crime
  const informedBeliefs = beliefs.filter(b =>
    b.eventType === crimeEventType &&
    !isPerpetrator(b.source) &&
    b.source !== 'personal_motive',
  );
  if (informedBeliefs.length > 0) {
    heat += 0.15; // knows someone else knows
  }

  // ─── Overheard rumors ───
  // Criminal heard rumors where THEY are the subject
  const selfRumors = beliefs.filter(b =>
    b.source === 'rumor' && b.subject === selfName,
  );
  heat += Math.min(0.25, selfRumors.length * 0.12);

  // ─── Confrontation by player ───
  // Was questioned, accused, or pressured — lastInteractionOutcome tracks this
  const outcome = agent.state.lastInteractionOutcome;
  if (outcome?.type === 'denial' || outcome?.type === 'deflection') {
    heat += 0.20;
  }

  // ─── Wanted status awareness ───
  // Criminal received testimony-source beliefs about themselves (from WANTED_STATUS cascade)
  const wantedBeliefs = beliefs.filter(b =>
    b.source === 'testimony' && b.subject === selfName,
  );
  if (wantedBeliefs.length > 0) {
    heat += 0.30;
  }

  // ─── Guard proximity ───
  // Investigator NPC at the same location = immediate danger spike
  for (const [, other] of ctx.agents) {
    if (other.profile.investigator &&
        other.state.alive &&
        other.state.location === agent.state.location &&
        other.profile.id !== agent.profile.id) {
      heat += 0.15;
      break;
    }
  }

  return Math.min(1.0, heat);
}

export function getHeatLevel(heat: number): HeatLevel {
  if (heat >= 0.8) return 'desperate';
  if (heat >= 0.6) return 'panicked';
  if (heat >= 0.4) return 'anxious';
  if (heat >= 0.2) return 'uneasy';
  return 'safe';
}

/**
 * Build heat-aware secret directive prose for a criminal NPC.
 * Returns null if agent is not a perpetrator or heat is negligible.
 */
export function buildHeatDirective(agent: Agent, ctx: HeatContext): string | null {
  const heat = computeHeat(agent, ctx);
  if (heat < 0.05) return null;

  const level = getHeatLevel(heat);
  const victimName = agent.state.beliefs?.getAllBeliefs()
    .find(b => isPerpetrator(b.source))?.object ?? 'your victim';

  switch (level) {
    case 'desperate':
      return `## EXTREME DANGER\n` +
        `The investigation is closing in on you. You are almost certain the guard knows what you did to ${victimName}. ` +
        `Every moment you stay increases the risk of arrest. You must flee Millhaven or find a way to destroy all evidence immediately. ` +
        `Trust no one — anyone could be working with the investigator.`;

    case 'panicked':
      return `## HIGH DANGER\n` +
        `You sense real danger. People are talking about what happened to ${victimName}, and the guard may already be investigating. ` +
        `You should seriously consider laying low — avoid public places, stay away from the crime scene, ` +
        `and think about silencing anyone who might know what you did.`;

    case 'anxious':
      return `## GROWING DANGER\n` +
        `You're increasingly worried about being caught. There may have been witnesses to what you did to ${victimName}, ` +
        `and rumors could be spreading. Stay alert — avoid suspicious behavior, consider destroying evidence if any exists, ` +
        `and be ready to deflect if anyone asks questions.`;

    case 'uneasy':
      return `## CAUTION\n` +
        `You're somewhat uneasy about what you did to ${victimName}. You don't know for certain if anyone saw, ` +
        `but you can't be sure either. Act normal, avoid the scene of the crime, and keep your ears open for any rumors.`;

    case 'safe':
      return `## AWARENESS\n` +
        `You believe no one knows about what happened with ${victimName}. You feel relatively safe, ` +
        `but some paranoia lingers at the edges of your mind. Stay vigilant.`;
  }
}
