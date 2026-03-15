import {
  AFFORDANCE_REGISTRY, EVIDENCE_RULES, REQUIREMENT_CHECKERS,
  registerEventCategory, registerEventLabels, registerEventGoalCleanup, registerBeliefZeroingEvents,
  registerEventSceneTypes, registerDeathEvents, registerPursuitEvents,
} from '@clwa/engine';
import { CRIME_AFFORDANCES } from './affordances';
import { registerCrimeTargetFinders, isCriminalNpc, isWantedNpc, hasDetainedNpc, hasWitnessBelief } from './target-finders';
import { CRIME_EVIDENCE_RULES } from './evidence-rules';
import { registerCrimeEvidenceSources } from './evidence-sources';
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
}
