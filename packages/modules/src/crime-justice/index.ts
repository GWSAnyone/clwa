import {
  AFFORDANCE_REGISTRY, EVIDENCE_RULES, REQUIREMENT_CHECKERS, TOPIC_SOURCE_REGISTRY,
  registerEventCategory, registerEventLabels, registerEventGoalCleanup, registerBeliefZeroingEvents,
  registerEventSceneTypes, registerDeathEvents, registerPursuitEvents, registerActionVerbs,
  registerAbsentStatuses, registerStepHandler, registerInteractPostHook,
  registerWitnessEventType, registerEventMoodShifts, registerGoalMoodBoost,
  registerBodyDiscoveryEventType, registerRumorEventType,
  registerBeliefCreator, registerMemoryTextBuilder,
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
  registerBodyDiscoveryEventType('BODY_DISCOVERED');
  registerRumorEventType('RUMOR_SPREAD');
  registerAbsentStatuses(['exiled', 'fled']);

  registerEventMoodShifts({
    WITNESS_MEMORY: -0.4,
    BODY_DISCOVERED: -0.35,
    RUMOR_SPREAD: -0.15,
    WANTED_STATUS: -0.1,
  });

  registerGoalMoodBoost({
    report_crime: 0.1, investigate: 0.08, confront: 0.08,
    gossip: 0.05, grief: 0.03, steal: 0.1, blackmail: 0.08,
  });

  // CG belief creators — how beliefs are created from consequence types
  registerBeliefCreator('WITNESS_MEMORY', (agent, event, rule, crimeEventType, killer, victimName) => {
    const isUnknown = rule.subjectUnknown === true;
    agent.state.beliefs?.addBelief({
      id: crypto.randomUUID(), eventType: crimeEventType,
      subject: isUnknown ? null : killer, object: victimName,
      location: event.location, confidence: isUnknown ? 0.7 : 0.95,
      source: isUnknown ? 'body_discovery' : 'witness',
      sourceNpcId: null, gameDay: event.gameDay, lastUpdated: event.gameDay,
    });
  });
  registerBeliefCreator('RUMOR_SPREAD', (agent, event, _rule, crimeEventType, killer, victimName) => {
    agent.state.beliefs?.addBelief({
      id: crypto.randomUUID(), eventType: crimeEventType,
      subject: killer, object: victimName,
      location: event.location, confidence: 0.4, source: 'rumor',
      sourceNpcId: (event.payload?.reportedBy as string) ?? null,
      gameDay: event.gameDay, lastUpdated: event.gameDay,
    });
  });
  registerBeliefCreator('WANTED_STATUS', (agent, event, _rule, crimeEventType, killer, victimName) => {
    agent.state.beliefs?.addBelief({
      id: crypto.randomUUID(), eventType: crimeEventType,
      subject: killer, object: victimName,
      location: event.location, confidence: 0.8, source: 'testimony',
      sourceNpcId: (event.payload?.reportedBy as string) ?? null,
      gameDay: event.gameDay, lastUpdated: event.gameDay,
    });
  });

  // CG memory text builders — prose for NPC memories from consequences
  registerMemoryTextBuilder('WITNESS_MEMORY', (event, killer, victimName) => {
    if (event.payload?.sourceRule === 'body-discovery-to-witness' || !killer || killer === 'someone unknown') {
      return `I discovered the body of ${victimName} at ${event.location}! They appear to have been murdered. I don't know who did this.`;
    }
    return `I witnessed a horrifying event: ${killer} harmed ${victimName} at ${event.location}. I will never forget this.`;
  });
  registerMemoryTextBuilder('RUMOR_SPREAD', (_event, killer, victimName) => {
    return `I heard a disturbing rumor: ${killer} committed a crime against ${victimName}. People are whispering about it.`;
  });
  registerMemoryTextBuilder('WANTED_STATUS', (event, killer, victimName) => {
    return `URGENT: I received reports that ${killer} committed a crime against ${victimName} at ${event.location}. I must investigate immediately.`;
  });

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
