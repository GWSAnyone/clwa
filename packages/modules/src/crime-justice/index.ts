import {
  AFFORDANCE_REGISTRY, EVIDENCE_RULES, REQUIREMENT_CHECKERS, TOPIC_SOURCE_REGISTRY,
  registerEventCategory, registerEventLabels, registerEventGoalCleanup, registerBeliefZeroingEvents,
  registerEventSceneTypes, registerDeathEvents, registerPursuitEvents, registerActionVerbs,
  registerAbsentStatuses, registerStepHandler, registerInteractPostHook,
  registerWitnessEventType,
} from '@clwa/engine';
import { CRIME_AFFORDANCES } from './affordances';
import { registerCrimeTargetFinders, isCriminalNpc, isWantedNpc, hasDetainedNpc, hasWitnessBelief } from './target-finders';
import { CRIME_EVIDENCE_RULES } from './evidence-rules';
import { registerCrimeEvidenceSources } from './evidence-sources';
import { justiceTopics } from './topic-sources';
import { registerCrimeEventHandlers } from './event-handlers';
import { registerCrimeStepHandlers } from './step-handlers';
export { CRIME_CG_RULES } from './cg-rules';
export { CRIME_EVIDENCE_RULES } from './evidence-rules';
export { isCriminalNpc, isWantedNpc, hasDetainedNpc, hasWitnessBelief } from './target-finders';

export function registerCrimeJusticeModule(): void {
  AFFORDANCE_REGISTRY.push(...CRIME_AFFORDANCES);
  registerCrimeTargetFinders();

  // Evidence Layer: declarative rules + source strategies
  EVIDENCE_RULES.push(...CRIME_EVIDENCE_RULES);
  registerCrimeEvidenceSources();

  // Register requirement checkers so engine can delegate module-specific checks
  REQUIREMENT_CHECKERS.set('isCriminal', (agent, ctx) => isCriminalNpc(agent, ctx));
  REQUIREMENT_CHECKERS.set('isWanted', (agent, ctx) => isWantedNpc(agent, ctx));
  REQUIREMENT_CHECKERS.set('hasDetainedNpc', (_agent, ctx) => hasDetainedNpc(ctx));
  REQUIREMENT_CHECKERS.set('hasWitnessBelief', (agent, _ctx) => hasWitnessBelief(agent));

  // Event registries — declare module-specific event metadata for engine
  registerEventCategory('crime', ['NPC_KILLED', 'GOODS_STOLEN', 'SELF_JUSTICE']);
  registerEventCategory('body_discovery', ['BODY_DISCOVERED']);
  registerEventCategory('witness_event', ['WITNESS_MEMORY']);
  registerEventCategory('theft', ['GOODS_STOLEN']);
  registerEventCategory('information_spread', ['RUMOR_SPREAD', 'WITNESS_MEMORY', 'THEFT_DISCOVERED']);
  registerEventCategory('justice_resolution', ['NPC_SENTENCED', 'NPC_FLED']);

  registerEventLabels({
    NPC_KILLED: 'murder',
    GOODS_STOLEN: 'theft',
    SELF_JUSTICE: 'attack',
    NPC_ARRESTED: 'arrest',
    NPC_SENTENCED: 'sentencing',
    NPC_FLED: 'escape',
    EVIDENCE_DESTROYED: 'evidence tampering',
  });

  registerEventGoalCleanup({
    WANTED_STATUS: ['report_crime'],
    NPC_ARRESTED: ['investigate'],
    NPC_SENTENCED: ['arrest', 'interrogate', 'investigate', 'evaluate_case'],
    NPC_FLED: ['arrest', 'interrogate'],
  });

  registerBeliefZeroingEvents(['NPC_SENTENCED']);

  registerEventSceneTypes({
    NPC_KILLED: 'murder',
    GOODS_STOLEN: 'robbery',
    SELF_JUSTICE: 'assault',
  });

  registerDeathEvents(['NPC_KILLED']);
  registerPursuitEvents(['WANTED_STATUS']);
  registerWitnessEventType('WITNESS_MEMORY');
  registerAbsentStatuses(['exiled', 'fled']);

  // Topic sources for NPC conversations about justice events
  TOPIC_SOURCE_REGISTRY.push(justiceTopics);

  // Action verb → affordance ID mapping for LLM DO/WHY parser
  registerActionVerbs({
    steal: ['steal'],
    kill: ['kill'],
    attack: ['vigilante', 'confront'],
    investigate: ['investigate'],
    interrogate: ['interrogate'],
    arrest: ['arrest'],
    report: ['report_crime', 'testify'],
    testify: ['testify', 'report_crime'],
    flee: ['flee_town'],
    evaluate: ['evaluate_case'],
  });

  // Event handlers for belief creation and state changes
  registerCrimeEventHandlers();

  // Step handlers for module-specific goal actions
  registerCrimeStepHandlers();

  // Interact post-hooks (suspect evaluation after interrogation)
  registerInteractPostHook((owner, target, step, _agents, crimeScenes) => {
    if (!step.evaluateSuspect || !owner.state.beliefs || !crimeScenes) return;
    // Evaluate suspect: check guilt + honesty trait → update deduction belief confidence
    const deductionBelief = owner.state.beliefs.getAllBeliefs().find(
      (b: any) => b.source === 'deduction' && b.subject === target.profile.name,
    );
    if (!deductionBelief) return;

    const isGuilty = Array.from(crimeScenes.values()).flat()
      .some(s => s.active && s.perpetratorId === target.profile.id);
    const honesty = target.profile.bigFive.honesty;
    const currentDay = owner.state.currentDay;

    if (isGuilty) {
      if (honesty >= 0.6) {
        deductionBelief.confidence = Math.min(1, 0.85);
      } else {
        deductionBelief.confidence = Math.min(1, deductionBelief.confidence + 0.15);
      }
    } else {
      deductionBelief.confidence = Math.max(0.1, deductionBelief.confidence - 0.2);
    }
    deductionBelief.lastUpdated = currentDay;
  });
}
