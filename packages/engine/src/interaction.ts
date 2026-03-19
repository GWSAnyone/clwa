import type { Agent } from './agent';
import type { IEventStore } from './event-types';
import type { WorldEvent } from './cg-types';
import type { InteractionRunner, GoalStep } from './goals';
import type { ConversationLine } from './world-types';
import type { LlmJsonSchema } from './llm-client';
import { getInteractionResultHooks } from './event-registry';

/** Structured output for goal-driven NPC dialogue (allows slightly longer speech) */
const INTERACTION_DIALOGUE_SCHEMA: LlmJsonSchema = {
  name: 'npc_interaction_dialogue',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      speech: { type: 'string', description: 'ONLY the words you speak aloud. No actions, no *gestures*. Max 20 words. Fresh wording.' },
      gesture: { type: 'string', description: 'Physical action like *nods* or *slams fist*. Max 5 words. Empty string if none.' },
    },
    required: ['speech', 'gesture'],
    additionalProperties: false,
  },
};

/** Parse structured dialogue JSON → display text. Handles malformed JSON from LLM. */
function parseInteractionDialogue(raw: string): string {
  try {
    const d = JSON.parse(raw);
    const speech = (d.speech ?? '').trim().replace(/^["']+|["']+$/g, '');
    const gesture = (d.gesture ?? '').trim();
    if (!speech) return gesture || '...';
    return gesture ? `${gesture} ${speech}` : speech;
  } catch {
    // Fallback: extract speech from malformed JSON via regex
    const speechMatch = raw.match(/"speech"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (speechMatch) {
      const speech = speechMatch[1].replace(/\\"/g, '"').replace(/^["']+|["']+$/g, '').trim();
      const gestureMatch = raw.match(/"gesture"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      const gesture = gestureMatch?.[1]?.trim() || '';
      return gesture ? `${gesture} ${speech}` : speech;
    }
    return raw.replace(/[{}"]/g, '').replace(/speech\s*:|gesture\s*:/gi, '').trim() || '...';
  }
}

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

    // Inject belief context — what each NPC actually KNOWS (prevents hallucination)
    const initiatorBeliefs = initiator.state.beliefs?.summarizeForPrompt(3) ?? '';
    const targetBeliefs = target.state.beliefs?.summarizeForPrompt(3) ?? '';
    const initiatorCtx = initiatorBeliefs ? `\n## What you know (facts, not speculation):\n${initiatorBeliefs}\nOnly reference these facts. Do not invent details.` : '';
    const targetCtx = targetBeliefs ? `\n## What you know (facts, not speculation):\n${targetBeliefs}\nOnly reference these facts. Do not invent details.` : '';

    // --- Initiator speaks (with purpose + beliefs, structured output) ---
    const initiatorPrompt = buildPurposePrompt(initiator, target, cleanPurpose);
    const ownerRaw = await initiator.generateResponse(initiatorPrompt, { maxTokens: 100, additionalContext: initiatorCtx || undefined, jsonSchema: INTERACTION_DIALOGUE_SCHEMA });
    const ownerLine = parseInteractionDialogue(ownerRaw);

    if (options?.onLine) {
      options.onLine({
        speaker: initiator.profile.id,
        speakerName: initiator.profile.name,
        text: ownerLine,
      });
    }

    // --- Target responds (with their own beliefs, structured output) ---
    const targetPrompt = buildResponsePrompt(target, initiator, ownerLine, cleanPurpose);
    const targetRaw = await target.generateResponse(targetPrompt, { maxTokens: 100, additionalContext: targetCtx || undefined, jsonSchema: INTERACTION_DIALOGUE_SCHEMA });
    const targetLine = parseInteractionDialogue(targetRaw);

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

    // Run module-registered interaction result hooks (e.g., crime report to guard)
    for (const hook of getInteractionResultHooks()) {
      await hook({
        initiator,
        target,
        step: {} as GoalStep, // step context provided by caller if needed
        purpose,
        eventStore,
        onExtraEvent: options?.onExtraEvent,
      });
    }

    return { ownerLine, targetLine };
  };
}

/** Extract compact speech style reminder (first line only) */
function speechReminder(agent: Agent): string {
  return agent.profile.speechStyle.split('\n')[0];
}

function buildPurposePrompt(initiator: Agent, target: Agent, purpose: string): string {
  const speech = speechReminder(initiator);
  const beliefContext = initiator.state.beliefs?.summarizeForPrompt(2);
  const beliefLine = beliefContext ? `\nWhat you know: ${beliefContext}` : '';
  return `You are at ${initiator.state.location}. You approach ${target.profile.name} the ${target.profile.role}.${beliefLine}

YOUR GOAL: ${purpose}

(Your voice: ${speech})
IMPORTANT: speech must be at most 20 words. Only spoken words — no narration.`;
}

function buildResponsePrompt(target: Agent, initiator: Agent, initiatorLine: string, purpose: string): string {
  // Detect if this is a report/urgent situation — use structured [CRIME] marker, not text matching
  const isUrgentReport = /\[CRIME\s/.test(purpose);

  const contextDirective = isUrgentReport
    ? `IMPORTANT: ${initiator.profile.name} is bringing urgent information. Take it seriously — react to what they say.`
    : `They are trying to ${purpose}.`;

  const speech = speechReminder(target);
  const beliefContext = target.state.beliefs?.summarizeForPrompt(2);
  const beliefLine = beliefContext ? `\nWhat you already know: ${beliefContext}` : '';
  return `${initiator.profile.name} the ${initiator.profile.role} says:
"${initiatorLine}"

${contextDirective}${beliefLine}

(Your voice: ${speech})
IMPORTANT: speech must be at most 20 words. React with YOUR OWN words — do NOT repeat what they said. No narration.`;
}
