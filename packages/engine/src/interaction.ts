import type { Agent } from './agent';
import type { IEventStore } from './event-types';
import type { WorldEvent } from './cg-types';
import type { InteractionRunner } from './goals';
import type { ConversationLine } from './world-types';

/**
 * Create an InteractionRunner that uses LLM for goal-driven conversations.
 * Unlike casual conversation, goal-driven interactions have a specific purpose
 * that shapes the LLM prompt.
 *
 * onExtraEvent: called when the interaction generates side-effect events
 * (e.g. crime report to guard → RUMOR_SPREAD). The caller can route these
 * through the consequence engine to trigger cascades.
 */
export function createInteractionRunner(
  eventStore: IEventStore,
  options?: {
    onLine?: (line: ConversationLine) => void;
    onExtraEvent?: (event: WorldEvent) => Promise<void>;
  },
): InteractionRunner {
  return async (initiator, target, purpose, importance) => {
    // Strip structured markers before sending to LLM
    const cleanPurpose = purpose.replace(/\[CRIME[^\]]*\]\s*/g, '');

    // --- Initiator speaks (with purpose) ---
    const initiatorPrompt = buildPurposePrompt(initiator, target, cleanPurpose);
    const ownerLine = await initiator.generateResponse(initiatorPrompt, { maxTokens: 200 });

    if (options?.onLine) {
      options.onLine({
        speaker: initiator.profile.id,
        speakerName: initiator.profile.name,
        text: ownerLine,
      });
    }

    // --- Target responds ---
    const targetPrompt = buildResponsePrompt(target, initiator, ownerLine, cleanPurpose);
    const targetLine = await target.generateResponse(targetPrompt, { maxTokens: 200 });

    if (options?.onLine) {
      options.onLine({
        speaker: target.profile.id,
        speakerName: target.profile.name,
        text: targetLine,
      });
    }

    // Store memories for both
    await initiator.observe(
      `I ${cleanPurpose}: talked to ${target.profile.name} the ${target.profile.role}. They said: "${targetLine}"`,
      importance,
    );
    await target.observe(
      `${initiator.profile.name} the ${initiator.profile.role} approached me to ${cleanPurpose}. They said: "${ownerLine}". I responded.`,
      importance,
    );

    // Record conversation event
    const event: WorldEvent = {
      id: crypto.randomUUID(),
      type: 'NPC_CONVERSATION',
      subject: initiator.profile.id,
      object: target.profile.id,
      location: initiator.state.location,
      gameDay: initiator.state.currentDay,
      importance,
      payload: {
        purpose,
        goalDriven: true,
        lines: [
          { speaker: initiator.profile.name, text: ownerLine },
          { speaker: target.profile.name, text: targetLine },
        ],
        affectedTargets: [initiator.profile.id, target.profile.id],
      },
    };
    eventStore.append(event);

    // Detect crime report → guard: create testimony belief + RUMOR_SPREAD event
    if (options?.onExtraEvent && target.profile.role === 'guard') {
      const crimeData = parseCrimeTag(purpose);
      if (crimeData) {
        // Guard receives testimony belief from the reporter
        if (target.state.beliefs) {
          const trustWeight = target.state.relationships?.getTestimonyWeight(initiator.profile.id) ?? 0.3;
          target.state.beliefs.addBelief({
            id: crypto.randomUUID(),
            eventType: 'NPC_KILLED',
            subject: crimeData.killer === 'someone unknown' ? null : crimeData.killer,
            object: crimeData.victim,
            location: crimeData.location,
            confidence: Math.min(0.9, 0.5 + trustWeight * 0.4),
            source: 'testimony',
            sourceNpcId: initiator.profile.id,
            gameDay: target.state.currentDay,
            lastUpdated: target.state.currentDay,
          });
        }

        const rumorEvent: WorldEvent = {
          id: crypto.randomUUID(),
          type: 'RUMOR_SPREAD',
          subject: crimeData.killer,   // subject = the killer, not the reporter
          object: target.profile.id,
          location: target.state.location,
          gameDay: target.state.currentDay,
          importance: 7,
          payload: {
            killerName: crimeData.killer,
            victimName: crimeData.victim,
            crimeLocation: crimeData.location,
            sourceEvent: event.id,
            affectedTargets: [target.profile.id],
            reportedBy: initiator.profile.name,
          },
        };
        eventStore.append(rumorEvent);
        await options.onExtraEvent(rumorEvent);
      }
    }

    return { ownerLine, targetLine };
  };
}

/** Parse structured [CRIME killer=... victim=... location=...] tag */
function parseCrimeTag(purpose: string): { killer: string; victim: string; location: string } | null {
  const match = purpose.match(/\[CRIME\s+killer=([^\]]+?)\s+victim=([^\]]+?)\s+location=([^\]]+?)\]/);
  if (!match) return null;
  return { killer: match[1], victim: match[2], location: match[3] };
}

/** Extract compact speech style reminder (first line only) */
function speechReminder(agent: Agent): string {
  return agent.profile.speechStyle.split('\n')[0];
}

function buildPurposePrompt(initiator: Agent, target: Agent, purpose: string): string {
  const speech = speechReminder(initiator);
  return `You are at ${initiator.state.location}. You approach ${target.profile.name} the ${target.profile.role}.

YOUR GOAL: ${purpose}

(Your voice: ${speech})
Speak in character. Be focused on your goal. 1-3 sentences. You may include a brief action.`;
}

function buildResponsePrompt(target: Agent, initiator: Agent, initiatorLine: string, purpose: string): string {
  // Detect if this is a report/urgent situation — use structured [CRIME] marker, not text matching
  const isUrgentReport = /\[CRIME\s/.test(purpose);

  const contextDirective = isUrgentReport
    ? `IMPORTANT: ${initiator.profile.name} is bringing you urgent, critical information. Take what they say seriously — they are an eyewitness or have direct knowledge. React to the NEW information they are giving you RIGHT NOW, even if you didn't know about it before. This is the first time you're hearing this.`
    : `They seem to be trying to ${purpose}.`;

  const speech = speechReminder(target);
  return `You are at ${target.state.location}. ${initiator.profile.name} the ${initiator.profile.role} approaches you and says:

"${initiatorLine}"

${contextDirective}

(Your voice: ${speech})
React in character. 1-3 sentences. You may include a brief action.`;
}
