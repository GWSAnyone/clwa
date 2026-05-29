import {
  AFFORDANCE_REGISTRY, EVIDENCE_RULES, REQUIREMENT_CHECKERS, POST_TARGET_REQUIREMENT_CHECKERS, registerTargetEnricher, TOPIC_SOURCE_REGISTRY,
  registerEventCategory, registerEventLabels, registerEventGoalCleanup, registerEventTypeFlags, registerEventTypeFlagsBatch, registerSourceFlags,
  registerEventSceneTypes, registerDeathEvents, registerPursuitEvents, registerActionVerbs,
  registerAbsentStatuses, registerStepHandler, registerInteractPostHook, registerTopicGroupMapping,
  registerWitnessEventType, registerEventMoodShifts, registerGoalMoodBoost,
  registerBodyDiscoveryEventType, registerRumorEventType, registerDiscoveryHandler, BELIEF_SOURCE,
  registerBeliefCreator, registerMemoryTextBuilder,
  registerSourceCategory,
  registerSceneResidueTemplate,
  registerInteractionResultHook,
  getRumorEventType,
  registerTickPhaseHandler,
  isEventCategory,
  isSourceCategory,
  registerDayAdvanceHandler,
  getEventLabel,
  getEventLabelSafe,
  isTransferable,
  isFirsthand,
  isConcealment,
  hasCapability,
  isPerpetrator,
  isPursuitEvent,
  registerRoleDirectiveBuilder,
  registerBeliefPhrasing,
  isStatusAbsent,
  registerSourceDecayRates,
  registerSourceTransferWeights,
  registerBeliefSourceLabels,
  getPassiveNoticeText,
  getAffordanceIdsForVerb,
  registerSecretEventType,
  registerBlockingGoalTypes,
  registerRelationshipLabels,
  registerSecretDirectiveBuilder,
  registerConsequencePostHandler,
  registerLlmTask,
} from '@clwa/engine';
import type { Belief, WorldEvent } from '@clwa/engine';
import { buildHeatDirective, computeHeat } from './heat';
import { CRIME_AFFORDANCES } from './affordances';
import { registerCrimeTargetFinders, isCriminalNpc, isWantedNpc, hasDetainedNpc, hasWitnessBelief, hasSuspicionBelief } from './target-finders';
import { CRIME_EVIDENCE_RULES } from './evidence-rules';
import { registerCrimeEvidenceSources } from './evidence-sources';
import { justiceTopics, playerRumorTopics, suspicionTopics } from './topic-sources';
import { registerCrimeEventHandlers } from './event-handlers';
import { registerCrimeStepHandlers, imprisonmentTimers } from './step-handlers';
import { registerInvestigationModule } from './investigation';
export { PlayerJournal, registerInvestigationModule } from './investigation';
export type { JournalEntry, CaseSummary, PresentedEvidence, ConversationSession } from './investigation';
export { CRIME_CG_RULES } from './cg-rules';
export { CRIME_EVIDENCE_RULES } from './evidence-rules';
export { isCriminalNpc, isWantedNpc, hasDetainedNpc, hasWitnessBelief } from './target-finders';

export function registerCrimeJusticeModule(): void {
  // LLM tasks которые модуль использует — модуль сам декларирует свои потребности (Stage 8c).
  // 'embeddings' уже зарегистрирована engine bootstrap'ом, не повторяем.
  registerLlmTask('volition',     { requiresStructuredOutput: true });   // engine/volition.ts:callLlm
  registerLlmTask('il',           { requiresStructuredOutput: true });   // engine/il.ts:extractDialogueMeaning
  registerLlmTask('verdict',      { requiresStructuredOutput: true });   // module: step-handlers.ts:sentence_npc
  registerLlmTask('dialogue',     { requiresStreaming: true });           // engine/agent.ts:chatStream
  registerLlmTask('npc-dialogue', { requiresStructuredOutput: true });    // engine/conversation.ts (speech+gesture schema)
  registerLlmTask('reflection',   {});                                    // engine/reflection.ts:generateReflection

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
  REQUIREMENT_CHECKERS.set('hasSuspicionBelief', (agent, _ctx) => hasSuspicionBelief(agent));
  REQUIREMENT_CHECKERS.set('notPerpetrator', (agent, _ctx) => {
    if (!agent.state.beliefs) return true;
    return !agent.state.beliefs.getAllBeliefs().some(
      (b: Belief) => isSourceCategory(b.source, 'guilt'),
    );
  });
  REQUIREMENT_CHECKERS.set('hasCrimeBelief', (agent, _ctx, params) => {
    if (!agent.state.beliefs) return false;
    const minConf = (params?.beliefConfidence as number) ?? 0.3;
    return agent.state.beliefs.getAllBeliefs().some(
      (b: Belief) => isTransferable(b.eventType) && b.confidence >= minConf && b.subject !== agent.profile.id,
    );
  });

  REQUIREMENT_CHECKERS.set('deductionBelowThreshold', (agent) => {
    // Block investigate if guard already has high-confidence deduction (investigation complete → arrest instead)
    if (!agent.state.beliefs) return true;
    const deductions = agent.state.beliefs.getAllBeliefs().filter(
      (b: Belief) => b.source === 'deduction' && b.confidence >= 0.7,
    );
    return deductions.length === 0; // true = can investigate (no high-conf deduction yet)
  });

  // Role-gate checkers — moved from engine inline branches in checkRequirements (genre-neutralization).
  // They read crime capability flags on the profile. (A6 generalizes flag storage into a capabilities map.)
  REQUIREMENT_CHECKERS.set('notGuard', (agent) => !hasCapability(agent.profile, 'investigator'));
  REQUIREMENT_CHECKERS.set('isInvestigator', (agent) => !!hasCapability(agent.profile, 'investigator'));
  REQUIREMENT_CHECKERS.set('canSentence', (agent) => !!hasCapability(agent.profile, 'canSentence'));

  // Post-target gate: no crime-deterring NPC (guard) co-located with the target — moved from engine.
  POST_TARGET_REQUIREMENT_CHECKERS.set('noGuardNearby', (_agent, ctx, target) => {
    for (const [, other] of ctx.agents) {
      if (!other.state.alive) continue;
      if (hasCapability(other.profile, 'detersCrime') && other.state.location === target.targetLocation) return false;
    }
    return true;
  });

  // Target enricher: add crime-belief context vars to target.extra for step-template interpolation
  // (perpetratorName/affectedName/crimeLocation/crimeType) — moved from engine findByRole.
  registerTargetEnricher((target, agent) => {
    const crimeBelief = (agent.state.beliefs?.getAllBeliefs() ?? []).find(
      (b: Belief) => isTransferable(b.eventType) && b.confidence >= 0.3,
    );
    if (!crimeBelief) return;
    const extra = target.extra as Record<string, string>;
    if (crimeBelief.subject) extra.perpetratorName = crimeBelief.subject;
    if (crimeBelief.object) extra.affectedName = crimeBelief.object;
    if (crimeBelief.location) extra.crimeLocation = crimeBelief.location;
    extra.crimeType = getEventLabelSafe(crimeBelief.eventType);
  });

  // Investigation subsystem (PlayerJournal + evidence-presentation + formal accusation) — registers a
  // dialogue-effect handler. Moved out of the engine (A10+A4b); accusation policy lives in investigation.ts.
  registerInvestigationModule();

  // Goal types that block volition re-evaluation of target NPC
  registerBlockingGoalTypes(['arrest']);

  // Event registries — declare module-specific event metadata for engine
  registerEventCategory('crime', ['NPC_KILLED', 'GOODS_STOLEN', 'SELF_JUSTICE']);
  registerEventCategory('economic_pressure', ['DEBT_PRESSURE']);
  registerEventCategory('body_discovery', ['BODY_DISCOVERED']);
  registerEventCategory('witness_event', ['WITNESS_MEMORY']);
  registerEventCategory('theft', ['GOODS_STOLEN']);
  registerEventCategory('information_spread', ['RUMOR_SPREAD', 'WITNESS_MEMORY', 'THEFT_DISCOVERED']);
  registerEventCategory('witness_reaction', ['COVER_UP', 'REPORT_IMPULSE']);
  registerEventCategory('escalation', ['ARGUMENT_WITNESSED', 'THREAT_WITNESSED']);
  registerEventCategory('secondary_crime', ['EVIDENCE_DESTROYED', 'WITNESS_INTIMIDATED']);
  registerEventCategory('justice_action', ['NPC_ARRESTED', 'WANTED_STATUS', 'NPC_RELEASED']);
  registerEventCategory('minor_incident', ['MINOR_INCIDENT_MEMORY']);
  registerEventCategory('emergent_cascade', ['REVENGE_IMPULSE', 'GUARD_WARNING', 'ARREST_RESENTMENT']);
  registerEventCategory('corruption', ['CORRUPTION_COVER']);
  registerEventCategory('justice_resolution', ['NPC_SENTENCED', 'NPC_FLED']);

  // Event type flags — engine checks boolean properties, not category names
  registerEventTypeFlagsBatch(['NPC_KILLED', 'GOODS_STOLEN', 'SELF_JUSTICE'], { transferable: true });
  registerEventTypeFlagsBatch(['RUMOR_SPREAD', 'WITNESS_MEMORY', 'THEFT_DISCOVERED'], { informationOnly: true });
  registerEventTypeFlagsBatch(['WANTED_STATUS'], { subjectReacts: true }); // criminal reacts to being wanted (flee, lay_low)

  // Secret event type — used by engine conversation impact for secret discovery beliefs
  registerEventCategory('secret', ['PERSONAL_SECRET']);
  registerSecretEventType('PERSONAL_SECRET');

  // Source flags — engine checks boolean properties, not category names
  registerSourceFlags('perpetrator', { perpetrator: true });
  registerSourceFlags('observation', { firsthand: true });
  registerSourceFlags('scene_notice', {}); // passive crime scene observation — NOT firsthand
  registerSourceFlags('body_discovery', { firsthand: true });
  registerSourceFlags('witness', { firsthand: true });
  registerSourceFlags('evidence', { firsthand: true });
  registerSourceFlags('destroy_evidence', { concealment: true });
  registerSourceFlags('cover_up', { concealment: true });
  registerSourceFlags('secret', { firsthand: true }); // NPC's own prior knowledge (world JSON secrets)

  registerEventLabels({
    NPC_KILLED: 'murder',
    GOODS_STOLEN: 'theft',
    SELF_JUSTICE: 'attack',
    NPC_ARRESTED: 'arrest',
    NPC_SENTENCED: 'sentencing',
    NPC_FLED: 'escape',
    EVIDENCE_DESTROYED: 'evidence tampering',
    NPC_RELEASED: 'release from prison',
    DEBT_PRESSURE: 'debt pressure',
    BODY_DISCOVERED: 'body discovery',
    WITNESS_MEMORY: 'witness account',
    RUMOR_SPREAD: 'rumor',
    THEFT_DISCOVERED: 'discovered theft',
    WANTED_STATUS: 'wanted status',
    COVER_UP: 'cover-up',
    REPORT_IMPULSE: 'report impulse',
    ARGUMENT_WITNESSED: 'argument',
    MINOR_INCIDENT_MEMORY: 'incident',
    THREAT_WITNESSED: 'threat',
    REVENGE_IMPULSE: 'revenge impulse',
    GUARD_WARNING: 'warning',
    ARREST_RESENTMENT: 'arrest backlash',
    CORRUPTION_COVER: 'corruption',
    GUILD_ALARM: 'guild alarm',
  });

  registerEventGoalCleanup({
    WANTED_STATUS: ['report_crime'],
    NPC_ARRESTED: ['investigate'],
    NPC_SENTENCED: ['arrest', 'interrogate', 'investigate', 'evaluate_case', 'testify', 'report_crime', 'demand_justice'],
    NPC_FLED: ['arrest', 'interrogate'],
  });

  // Belief zeroing is now handled verdict-conditionally in NPC_SENTENCED event handler
  // (exile/imprisonment → full zeroing, fine → partial, warning/release → none)

  registerEventSceneTypes({
    NPC_KILLED: 'murder',
    GOODS_STOLEN: 'robbery',
    SELF_JUSTICE: 'assault',
  });

  registerDeathEvents(['NPC_KILLED']);
  registerPursuitEvents(['WANTED_STATUS']);
  registerWitnessEventType('WITNESS_MEMORY');
  registerBodyDiscoveryEventType('BODY_DISCOVERED');
  registerDiscoveryHandler('BODY_DISCOVERED', async (ctx) => {
    // Memory: discoverer's first-person account
    const locationName = ctx.location; // ID — engine resolves display name in prompt
    await ctx.discoverer.observe(
      `I discovered the body of ${ctx.affectedName} at ${locationName}! They appear to have been murdered. I need to tell someone about this immediately.`,
      8,
    );
    // Mood: direct trauma (stronger than cascade's -0.15)
    ctx.addMoodModifier(ctx.discoverer.profile.id, { source: 'body_discovery_trauma', category: 'event', magnitude: -0.35, remaining: 1440, duration: 1440, decay: 'exponential' });
    // Belief: discoverer knows someone died, but not who did it
    if (ctx.discoverer.state.beliefs && ctx.deathEventType) {
      ctx.discoverer.state.beliefs.addBelief({
        id: crypto.randomUUID(),
        eventType: ctx.deathEventType,
        subject: null, // suspect unknown
        object: ctx.affectedName,
        location: ctx.location,
        confidence: 0.7,
        source: 'body_discovery', // crime-owned source (engine no longer pre-defines it)
        sourceNpcId: null,
        gameDay: ctx.gameDay,
        lastUpdated: ctx.gameDay,
      });
    }
    // Grief: relationship-based mood penalty
    if (ctx.discoverer.state.relationships) {
      const grief = ctx.discoverer.state.relationships.getGriefPenalty(ctx.affectedId);
      if (grief !== 0) ctx.addMoodModifier(ctx.discoverer.profile.id, { source: 'grief_discovery', category: 'event', magnitude: grief, remaining: 720, duration: 720, decay: 'exponential' });
    }
  });
  registerRumorEventType('RUMOR_SPREAD');
  registerAbsentStatuses(['detained', 'exiled', 'fled', 'imprisoned']);

  // Source categories — classify belief sources for engine behavioral prompts
  registerSourceCategory('guilt', ['perpetrator']);
  registerSourceCategory('direct_experience', ['witness', 'body_discovery']);
  registerSourceCategory('concealment', ['cover_up']);

  // Belief source decay rates (per game day) — moved from engine hardcode to module registry
  registerSourceDecayRates({
    witness: 0.01, body_discovery: 0.01, observation: 0.015,
    testimony: 0.02, interrogation: 0.02, deduction: 0.03,
    gossip: 0.04, cover_up: 0.01, perpetrator: 0.01,
    evidence: 0.005,  // physical evidence fades very slowly
    scene_notice: 0.02, // noticed aftermath — fades like testimony
    secret: 0,         // secret knowledge never decays
  });

  // Module-specific source transfer weights (moved from engine defaults)
  registerSourceTransferWeights({
    witness: 0.85,
    gossip: 0.5,
    perpetrator: 0.0,
    cover_up: 0.0,
    secret: 0,
    // moved from engine pre-seed (crime-owned sources) — A8 genre-neutralization
    body_discovery: 0.7,
    evidence: 0.8,
    deduction: 0.6,
  });

  // Module-specific source labels (moved from engine defaults)
  registerBeliefSourceLabels({
    witness: 'saw it happen',
    interrogation: 'testimony under questioning',
    gossip: 'hearsay',
    perpetrator: 'committed the act',
    cover_up: 'covering up',
    secret: 'personal knowledge',
    scene_notice: 'noticed at crime scene',
    // moved from engine pre-seed (crime-owned sources) — A8 genre-neutralization
    body_discovery: 'found the body',
    evidence: 'physical evidence',
    deduction: 'deduced from clues',
  });

  // Relationship labels (moved from engine defaults)
  registerRelationshipLabels({
    friend: 'your friend', colleague: 'your colleague', family: 'your family member',
    rival: 'your rival', mentor: 'your mentor', romantic: 'a loved one', acquaintance: 'an acquaintance',
  });

  // ─── Motive system (SPEC-motive-pool) ───

  // Motive event types — beliefs with category 'motive'
  registerEventCategory('motive', ['PERSONAL_GRUDGE', 'REVENGE_DESIRE', 'THREAT_PERCEIVED']);
  registerEventLabels({
    PERSONAL_GRUDGE: 'personal grudge',
    REVENGE_DESIRE: 'desire for revenge',
    THREAT_PERCEIVED: 'perceived threat',
  });

  // Per-type decay rates: grudges persist, threats fade faster
  registerEventTypeFlags('REVENGE_DESIRE', { decayRate: 0.05 });  // semi-permanent trauma
  registerEventTypeFlags('PERSONAL_GRUDGE', { decayRate: 0.1 });  // slow fade without reinforcement
  registerEventTypeFlags('THREAT_PERCEIVED', { decayRate: 0.2 }); // situational, fades faster

  // Source 'personal_motive': not transferable (grudges don't gossip), not firsthand
  registerSourceFlags('personal_motive', {});
  registerSourceTransferWeights({ personal_motive: 0 });
  registerSourceDecayRates({ personal_motive: 0.02 }); // source rate × eventType rate = effective
  registerBeliefSourceLabels({ personal_motive: 'personal motivation' });

  // Crime scene templates — examination points, passive notice text, profession clues
  const PROFESSION_CLUES: Record<string, { description: string; clueText: string }> = {
    blacksmith: { description: 'Faint traces of soot and iron filings near the scene.', clueText: 'Soot and iron filings — whoever did this works with metal and fire.' },
    bartender: { description: 'A faint smell of ale and hops lingers in the air.', clueText: 'The smell of ale is out of place here — the perpetrator may work at a tavern.' },
    merchant: { description: 'A small coin has rolled under the furniture, freshly dropped.', clueText: 'A dropped coin — someone who handles money frequently was here.' },
    guard: { description: 'Boot prints with an official-looking tread pattern.', clueText: 'Military-style boot prints. Someone trained in combat was involved.' },
    bard: { description: 'A broken lute string caught on a splinter.', clueText: 'A lute string — a musician was at the scene.' },
    priest: { description: 'A small vial of anointing oil, half-spilled on the ground.', clueText: 'Anointing oil — someone from the temple was here.' },
    herbalist: { description: 'Crushed dried herbs underfoot, fragrant and out of place.', clueText: 'Dried herbs scattered around — an herbalist or healer was present.' },
  };

  registerSceneResidueTemplate('murder', {
    points: [
      { type: 'body', description: 'A lifeless body lies on the ground, face frozen in shock.', clueText: 'The victim was killed here. No signs they tried to flee — the attack was sudden.' },
      { type: 'bloodstain', description: 'Dark stains spread across the floor, still damp in places.', clueText: 'A large pool of blood. The wound was severe — this was no accident.' },
      { type: 'struggle', description: 'Furniture is overturned and objects scattered around the area.', clueText: 'Signs of a brief struggle. The victim may have tried to resist.' },
    ],
    passiveNoticeText: 'I noticed something terrible at {locationName} — blood on the floor and signs of violence. Something awful happened here.',
    personalizePoints: (points, { affected }) => {
      if (!affected) return;
      const bodyPoint = points.find((p) => p.type === 'body');
      if (bodyPoint) {
        bodyPoint.description = `The body of ${affected.profile.name} the ${affected.profile.role} lies on the ground.`;
        bodyPoint.clueText = `${affected.profile.name} was killed here. The attack seems sudden — no signs of an attempted escape.`;
      }
    },
    additionalPoints: ({ actor }) => {
      if (!actor) return [];
      const profClue = PROFESSION_CLUES[actor.profile.role];
      if (!profClue) return [];
      return [{ type: 'profession_clue', description: profClue.description, clueText: profClue.clueText }];
    },
  });
  registerSceneResidueTemplate('robbery', {
    points: [
      { type: 'damage', description: 'A lock has been forced open, the mechanism bent and broken.', clueText: 'The lock was broken with considerable force — someone strong or with the right tools.' },
      { type: 'stolen_goods', description: 'Shelves are bare and containers emptied, their contents gone.', clueText: 'Goods were taken deliberately — the thief knew what they were after.' },
      { type: 'struggle', description: 'Items knocked off tables, a chair overturned.', clueText: 'Whoever did this was in a hurry, or met some resistance.' },
    ],
    passiveNoticeText: 'I noticed signs of a break-in at {locationName} — a broken lock and scattered goods. Someone was robbed.',
    additionalPoints: ({ actor }) => {
      if (!actor) return [];
      const profClue = PROFESSION_CLUES[actor.profile.role];
      if (!profClue) return [];
      return [{ type: 'profession_clue', description: profClue.description, clueText: profClue.clueText }];
    },
  });
  registerSceneResidueTemplate('assault', {
    points: [
      { type: 'bloodstain', description: 'Spots of blood on the ground, as if from a wound.', clueText: 'Someone was hurt here, but not fatally. They likely walked away.' },
      { type: 'struggle', description: 'The area is disturbed — a scuffle clearly took place.', clueText: 'A fight happened here. From the marks, it was between two people.' },
    ],
    passiveNoticeText: 'I saw signs of a fight at {locationName} — blood spots and overturned furniture. Someone was attacked here.',
    additionalPoints: ({ actor }) => {
      if (!actor) return [];
      const profClue = PROFESSION_CLUES[actor.profile.role];
      if (!profClue) return [];
      return [{ type: 'profession_clue', description: profClue.description, clueText: profClue.clueText }];
    },
  });

  registerEventMoodShifts({
    WITNESS_MEMORY: -0.20,    // shock — rumination through conversations, not instant cliff
    BODY_DISCOVERED: -0.15,   // grim finding
    RUMOR_SPREAD: -0.08,      // unsettling
    WANTED_STATUS: -0.05,     // tension
    COVER_UP: -0.10,          // guilt/anxiety from hiding what you know
    REPORT_IMPULSE: -0.05,    // righteous urgency, mild stress
    ARGUMENT_WITNESSED: -0.04, // mild unease from seeing conflict
    MINOR_INCIDENT_MEMORY: -0.02, // overheard/saw a minor disturbance
    THREAT_WITNESSED: -0.10,   // anxiety from seeing someone threatened
    REVENGE_IMPULSE: -0.15,    // rage and grief driving toward action
    GUARD_WARNING: 0.02,       // slight relief — authority is aware
    ARREST_RESENTMENT: -0.12,  // anger at seeing a friend arrested
    CORRUPTION_COVER: -0.05,   // unease from deliberately ignoring duty
  });

  registerGoalMoodBoost({
    report_crime: 0.1, investigate: 0.08, confront: 0.08,
    gossip: 0.05, grief: 0.03,
    // Crime goals: no mood boost — crime is desperate, not satisfying (SPEC-mood-pressure)
  });

  // CG belief creators — how beliefs are created from consequence types
  registerBeliefCreator('WITNESS_MEMORY', (agent, event, rule, crimeEventType, perpetrator, affectedName) => {
    const isUnknown = rule.subjectUnknown === true;
    agent.state.beliefs?.addBelief({
      id: crypto.randomUUID(), eventType: crimeEventType,
      subject: isUnknown ? null : perpetrator, object: affectedName,
      location: event.location, confidence: isUnknown ? 0.7 : 0.95,
      source: isUnknown ? 'body_discovery' : 'witness',
      sourceNpcId: null, gameDay: event.gameDay, lastUpdated: event.gameDay,
    });
  });
  registerBeliefCreator('RUMOR_SPREAD', (agent, event, _rule, crimeEventType, perpetrator, affectedName) => {
    agent.state.beliefs?.addBelief({
      id: crypto.randomUUID(), eventType: crimeEventType,
      subject: perpetrator, object: affectedName,
      location: event.location, confidence: 0.4, source: BELIEF_SOURCE.GOSSIP,
      sourceNpcId: (event.payload?.reportedBy as string) ?? null,
      gameDay: event.gameDay, lastUpdated: event.gameDay,
    });
  });
  registerBeliefCreator('WANTED_STATUS', (agent, event, _rule, crimeEventType, perpetrator, affectedName) => {
    agent.state.beliefs?.addBelief({
      id: crypto.randomUUID(), eventType: crimeEventType,
      subject: perpetrator, object: affectedName,
      location: event.location, confidence: 0.8, source: 'testimony',
      sourceNpcId: (event.payload?.reportedBy as string) ?? null,
      gameDay: event.gameDay, lastUpdated: event.gameDay,
    });
  });
  // B3 guild solidarity: a merchants_guild member becomes aware a theft hit a fellow merchant.
  registerBeliefCreator('GUILD_ALARM', (agent, event, _rule, crimeEventType, perpetrator, affectedName) => {
    agent.state.beliefs?.addBelief({
      id: crypto.randomUUID(), eventType: crimeEventType,
      subject: perpetrator, object: affectedName,
      location: event.location, confidence: 0.5, source: BELIEF_SOURCE.GOSSIP,
      sourceNpcId: null, gameDay: event.gameDay, lastUpdated: event.gameDay,
    });
  });

  // CG memory text builders — prose for NPC memories from consequences
  registerMemoryTextBuilder('WITNESS_MEMORY', (event, perpetrator, affectedName) => {
    const originalType = event.payload?.originalEventType as string | undefined;
    if (event.payload?.sourceRule === 'body-discovery-to-witness' || !perpetrator || perpetrator === 'someone unknown') {
      return `I discovered the body of ${affectedName} at ${event.location}! They appear to have been murdered. I don't know who did this.`;
    }
    // Context-specific witness memories based on what was actually witnessed
    if (originalType === 'EVIDENCE_DESTROYED') {
      return `I saw ${perpetrator} destroying evidence at ${event.location}. They were clearly trying to hide something. Very suspicious.`;
    }
    if (originalType === 'WITNESS_INTIMIDATED') {
      return `I saw ${perpetrator} intimidating someone at ${event.location}. They were threatening them to keep quiet. This is disturbing.`;
    }
    if (originalType === 'ARGUMENT_WITNESSED') {
      return `I saw ${perpetrator} having a heated argument with ${affectedName} at ${event.location}. Tempers were running high.`;
    }
    if (originalType === 'THREAT_WITNESSED') {
      return `I saw ${perpetrator} directly threatening ${affectedName} at ${event.location}. It looked serious — someone could get hurt.`;
    }
    if (originalType === 'GOODS_STOLEN') {
      return `I saw ${perpetrator} steal from ${affectedName} at ${event.location}. They thought no one was watching.`;
    }
    return `I witnessed a horrifying event: ${perpetrator} harmed ${affectedName} at ${event.location}. I will never forget this.`;
  });
  registerMemoryTextBuilder('RUMOR_SPREAD', (_event, perpetrator, affectedName) => {
    return `I heard a disturbing rumor: ${perpetrator} committed a crime against ${affectedName}. People are whispering about it.`;
  });
  registerMemoryTextBuilder('GUILD_ALARM', (event, _perpetrator, affectedName) => {
    return `Word spreads through the merchants' guild: thieves struck ${affectedName}'s stall at ${event.location}. As a fellow merchant, I must guard my own goods — none of us are safe while this continues.`;
  });
  registerMemoryTextBuilder('WANTED_STATUS', (event, perpetrator, affectedName) => {
    return `URGENT: I received reports that ${perpetrator} committed a crime against ${affectedName} at ${event.location}. I must investigate immediately.`;
  });
  registerBeliefCreator('COVER_UP', (agent, event, _rule, crimeEventType, perpetrator, affectedName) => {
    // Witness knows about the crime but chooses to conceal — low-confidence concealment belief
    agent.state.beliefs?.addBelief({
      id: crypto.randomUUID(), eventType: crimeEventType,
      subject: perpetrator, object: affectedName,
      location: event.location, confidence: 0.3, source: 'cover_up',
      sourceNpcId: null, gameDay: event.gameDay, lastUpdated: event.gameDay,
    });
  });
  registerBeliefCreator('REPORT_IMPULSE', (agent, event, _rule, crimeEventType, perpetrator, affectedName) => {
    // Honest witness — high-confidence firsthand belief, eager to share
    agent.state.beliefs?.addBelief({
      id: crypto.randomUUID(), eventType: crimeEventType,
      subject: perpetrator, object: affectedName,
      location: event.location, confidence: 0.95, source: 'witness',
      sourceNpcId: null, gameDay: event.gameDay, lastUpdated: event.gameDay,
    });
  });
  registerMemoryTextBuilder('COVER_UP', (_event, perpetrator, affectedName) => {
    return `I saw what happened to ${affectedName}... but ${perpetrator} is someone I care about. I'll keep what I know to myself.`;
  });
  registerMemoryTextBuilder('REPORT_IMPULSE', (event, perpetrator, affectedName) => {
    return `I witnessed the crime against ${affectedName} at ${event.location}. ${perpetrator} must be held accountable. I need to find the guard immediately.`;
  });
  registerBeliefCreator('REVENGE_IMPULSE', (agent, event, _rule, crimeEventType, perpetrator, affectedName) => {
    // Grief → REVENGE_DESIRE motive toward the perpetrator
    if (!perpetrator) return;
    agent.state.beliefs?.addBelief({
      id: crypto.randomUUID(), eventType: 'REVENGE_DESIRE',
      subject: null, object: event.subject, // object = perpetrator ID (perpetrator)
      location: event.location, confidence: 0.8,
      source: 'personal_motive', sourceNpcId: null,
      gameDay: event.gameDay, lastUpdated: event.gameDay,
    });
  });
  registerMemoryTextBuilder('REVENGE_IMPULSE', (_event, perpetrator, affectedName) => {
    return `${affectedName} is gone because of ${perpetrator}. A cold fury burns inside me. This cannot go unanswered.`;
  });
  registerMemoryTextBuilder('GUARD_WARNING', (_event, perpetrator, _affectedName) => {
    return `The guard took note of the disturbance involving ${perpetrator}. At least someone is paying attention.`;
  });
  registerMemoryTextBuilder('MINOR_INCIDENT_MEMORY', (event, perpetrator, affectedName) => {
    return `I saw ${perpetrator} and ${affectedName} having a heated exchange. Tempers were running high — something to keep an eye on.`;
  });
  registerMemoryTextBuilder('ARREST_RESENTMENT', (event, _killer, _affectedName) => {
    const arrestedName = event.object ? 'my friend' : 'someone I care about';
    return `They arrested ${arrestedName}. I can't believe it. Maybe they're wrong. Maybe someone set them up.`;
  });
  // Belief creators for consequence types that previously had only memory builders (found by diagnostic scan)
  registerBeliefCreator('MINOR_INCIDENT_MEMORY', (agent, event, _rule, crimeEventType, perpetrator, affectedName) => {
    // Witnesses of arguments get low-confidence observation belief
    agent.state.beliefs?.addBelief({
      id: crypto.randomUUID(), eventType: crimeEventType,
      subject: perpetrator, object: affectedName,
      location: event.location, confidence: 0.2, source: 'observation',
      sourceNpcId: null, gameDay: event.gameDay, lastUpdated: event.gameDay,
    });
  });
  registerBeliefCreator('GUARD_WARNING', (agent, event, _rule, crimeEventType, perpetrator, affectedName) => {
    // NPC learns that the guard took notice of a disturbance
    agent.state.beliefs?.addBelief({
      id: crypto.randomUUID(), eventType: crimeEventType,
      subject: perpetrator, object: affectedName,
      location: event.location, confidence: 0.3, source: 'observation',
      sourceNpcId: null, gameDay: event.gameDay, lastUpdated: event.gameDay,
    });
  });
  registerBeliefCreator('ARREST_RESENTMENT', (agent, event, _rule, crimeEventType, _perpetrator, _affectedName) => {
    // NPC whose friend was arrested gets an emotional belief about the arrest
    agent.state.beliefs?.addBelief({
      id: crypto.randomUUID(), eventType: 'NPC_ARRESTED',
      subject: null, object: event.object ?? null,
      location: event.location, confidence: 0.6, source: 'observation',
      sourceNpcId: null, gameDay: event.gameDay, lastUpdated: event.gameDay,
    });
  });
  registerBeliefCreator('CORRUPTION_COVER', (agent, event, _rule, crimeEventType, perpetrator, affectedName) => {
    // Corrupt guard gets a concealment belief — knows about the crime but chooses to ignore it
    agent.state.beliefs?.addBelief({
      id: crypto.randomUUID(), eventType: crimeEventType,
      subject: perpetrator, object: affectedName,
      location: event.location, confidence: 0.5, source: 'cover_up',
      sourceNpcId: null, gameDay: event.gameDay, lastUpdated: event.gameDay,
    });
  });
  registerMemoryTextBuilder('CORRUPTION_COVER', (_event, perpetrator, affectedName) => {
    return `I know about what ${perpetrator} did to ${affectedName}. But getting involved would only bring trouble. Best to look the other way.`;
  });

  // Topic sources for NPC conversations about justice events + player rumors
  TOPIC_SOURCE_REGISTRY.push(justiceTopics);
  TOPIC_SOURCE_REGISTRY.push(playerRumorTopics);
  TOPIC_SOURCE_REGISTRY.push(suspicionTopics);

  // Topic group mappings for crime-justice categories
  registerTopicGroupMapping({
    'justice': 'conflict', 'conflict': 'conflict', 'player_rumor': 'conflict',
    'player_rumor:': 'conflict',
  });

  // Action verb → affordance ID mapping for LLM DO/WHY parser
  registerActionVerbs({
    argue: ['argue'],
    threaten: ['threaten'],
    steal: ['steal'],
    kill: ['kill'],
    attack: ['vigilante'],
    confront: ['confront'],
    intimidate: ['intimidate_witness'],
    investigate: ['investigate'],
    interrogate: ['interrogate'],
    arrest: ['arrest'],
    report: ['report_crime', 'testify'],
    testify: ['testify', 'report_crime'],
    leverage: ['blackmail'],
    flee: ['flee_town'],
    evaluate: ['evaluate_case'],
    watch: ['surveillance'],
  });

  // Validate: every actionVerb must be registered in ACTION_VERB_MAP
  for (const aff of CRIME_AFFORDANCES) {
    if (aff.actionVerb && getAffordanceIdsForVerb(aff.actionVerb).length === 0) {
      console.warn(`[WARN] Affordance '${aff.id}' has actionVerb '${aff.actionVerb}' not in ACTION_VERB_MAP — LLM cannot select it`);
    }
  }

  // Event handlers for belief creation and state changes
  registerCrimeEventHandlers();

  // Consequence post-handler: grief + sentiment shift when NPC learns about harm to someone they care about.
  // Moved from cg-engine.ts — behavioral response is module responsibility, not engine.
  registerConsequencePostHandler(({ targetId, agent, event, agents, addMoodModifier }) => {
    const victimId = event.object;
    if (!victimId || !agent.state.relationships) return;

    // Grief: mood penalty proportional to relationship with victim
    const griefPenalty = agent.state.relationships.getGriefPenalty(victimId);
    if (griefPenalty !== 0) {
      addMoodModifier?.(targetId, { source: `grief_${victimId}`, category: 'event',
        magnitude: griefPenalty, remaining: 720, duration: 720, decay: 'exponential' });
    }

    // Sentiment shift: learn who hurt someone you care about → hatred toward perpetrator
    const perpetratorRef = (event.payload?.perpetratorName as string) ?? event.subject;
    if (!perpetratorRef) return;
    const victimRel = agent.state.relationships.getRelationship(victimId);
    if (!victimRel || victimRel.sentiment <= 0) return;

    const perpetratorEntry = Array.from(agents.entries())
      .find(([, a]) => a.profile.name === perpetratorRef || a.profile.id === perpetratorRef);
    if (!perpetratorEntry) return;

    const [perpetratorId] = perpetratorEntry;
    const sentimentDrop = -(0.3 + victimRel.sentiment * 0.5);
    agent.state.relationships.adjustSentiment(perpetratorId, sentimentDrop);
    agent.state.relationships.adjustTrust(perpetratorId, -0.4);
  });

  // Belief phrasing: frame a belief's core relation as wrongdoing ("X committed murder against Y").
  // Moved out of the engine (beliefs.summarizeForPrompt/Memory + il question-handler hardcoded this).
  // In the crime milestone every transferable belief is a crime, so it applies unconditionally —
  // matching the engine's prior behaviour exactly. (When multiple content modules coexist, scope by
  // eventType/category instead.)
  registerBeliefPhrasing(({ verb, who, target }) =>
    target != null ? `${who} committed ${verb} against ${target}` : `${who} committed ${verb}`,
  );

  // Role directive: crime-framed interpretation of an agent's beliefs for the prompt's role section.
  // Moved out of the engine's buildRoleDirective (was hardcoded crime English in agent.ts) so the
  // engine stays genre-neutral. Behaviour identical: investigator active-duty / perpetrator guilt /
  // witness reaction / generic unease, plus wanted-fugitive self-awareness.
  registerRoleDirectiveBuilder(({ agent, nameResolver }) => {
    const beliefs = agent.state.beliefs;
    if (!beliefs) return [];
    const sections: string[] = [];

    const crimeBeliefs = beliefs.getAllBeliefs().filter(
      (b) => isTransferable(b.eventType) && b.confidence >= 0.3,
    );

    if (hasCapability(agent.profile, 'investigator') && crimeBeliefs.length > 0) {
      const top = crimeBeliefs.sort((a, b) => b.confidence - a.confidence)[0];
      const suspect = top.subject ?? 'an unknown perpetrator';
      const crimeWord = getEventLabelSafe(top.eventType);
      const victim = top.object ?? 'a victim';
      sections.push(`## ACTIVE DUTY\nYou are investigating the ${crimeWord} of ${victim}. Suspect: ${suspect}. This is your top priority.`);
    } else if (crimeBeliefs.some((b) => isPerpetrator(b.source))) {
      const b = crimeBeliefs.find((b) => isPerpetrator(b.source))!;
      const n = agent.profile.bigFive?.neuroticism ?? 0.5;
      const guilt = n > 0.6 ? 'Guilt gnaws at you constantly. You flinch at every mention of' : 'You keep your composure but the weight of what you did to';
      sections.push(`## How you feel right now\n${guilt} ${nameResolver(b.object ?? '')} hangs over you.`);
    } else if (crimeBeliefs.some((b) => isFirsthand(b.source))) {
      const b = crimeBeliefs.find((b) => isFirsthand(b.source))!;
      const n = agent.profile.bigFive?.neuroticism ?? 0.5;
      const reaction = n > 0.6 ? 'The memory haunts you — you can barely focus.' : 'You process what happened calmly but it stays with you.';
      sections.push(`## How you feel right now\nYou witnessed something terrible happen to ${nameResolver(b.object ?? '')}. ${reaction}`);
    } else if (crimeBeliefs.length > 0) {
      const n = agent.profile.bigFive?.neuroticism ?? 0.5;
      const unease = n > 0.6 ? 'You feel deeply unsettled — the news shook you.' : 'You are aware something bad happened in town.';
      sections.push(`## How you feel right now\n${unease}`);
    }

    // Wanted NPC self-awareness
    const wantedBelief = beliefs.getAllBeliefs().find(
      (b) => isPursuitEvent(b.eventType) && b.subject === agent.profile.id,
    );
    if (wantedBelief) {
      const n = agent.profile.bigFive?.neuroticism ?? 0.5;
      const fear = n > 0.6 ? 'Panic is setting in. Every sound could be the guard coming for you.' : 'You know they are looking for you. Stay alert.';
      sections.push(`## Your situation\nYou are wanted for a crime. ${fear}`);
    }

    return sections;
  });

  // ── Crime concealment / witness directives (moved verbatim from engine buildSecretDirectives) ──
  // Registered FIRST so their prompt sections keep their original order (own-crime, covering, justice).

  // Own crimes — did this NPC commit a crime they must hide?
  registerSecretDirectiveBuilder(({ agent, eventStore }) => {
    const agentId = agent.profile.id;
    const ownCrimes = eventStore.getAll()
      .filter((e) => isTransferable(e.type) && e.subject === agentId);
    if (ownCrimes.length === 0) return [];
    const crime = ownCrimes[ownCrimes.length - 1];
    const affectedName = (crime.payload?.affectedName as string) ?? 'someone';
    const crimeLabel = getEventLabelSafe(crime.type);
    return [
      `## HIDDEN: You committed ${crimeLabel}\n` +
      `You committed ${crimeLabel} against ${affectedName}. Nobody must find out.\n` +
      `- If asked about ${affectedName} or the ${crimeLabel}: act surprised, deny any involvement.\n` +
      `- If confronted with evidence pointing to you: become defensive, try to explain it away.\n` +
      `- If pressed hard: show cracks — nervous pauses, contradictions — but do NOT confess easily.\n` +
      `- You may try to redirect suspicion to someone else if it feels natural.`,
    ];
  });

  // Covering for someone — concealment-source beliefs about another's crime
  registerSecretDirectiveBuilder(({ agent, agents }) => {
    const beliefs = agent.state.beliefs;
    if (!beliefs) return [];
    const sections: string[] = [];
    const coverBeliefs = beliefs.getAllBeliefs().filter((b) => isConcealment(b.source));
    for (const belief of coverBeliefs) {
      const coveredId = belief.subject;
      if (!coveredId) continue;
      const coveredAgent = agents.get(coveredId);
      const coveredName = coveredAgent?.profile.name ?? 'someone';
      const rel = agent.state.relationships?.getRelationship(coveredId);
      const relType = rel?.type ?? 'someone you know';
      const coverCrimeLabel = getEventLabelSafe(belief.eventType, 'something wrong');
      sections.push(
        `## HIDDEN: You are covering for ${coveredName}\n` +
        `You saw ${coveredName} commit ${coverCrimeLabel}, but you are protecting them because they are your ${relType}.\n` +
        `- If asked about the ${coverCrimeLabel}: claim you didn't see anything clearly, be vague.\n` +
        `- If asked directly about ${coveredName}: change the subject or say something neutral.\n` +
        `- If pressed with evidence against ${coveredName}: show internal conflict — you hesitate, look away, almost speak but catch yourself.\n` +
        `- You feel guilt about hiding the truth. This leaks through in nervous mannerisms.`,
      );
    }
    return sections;
  });

  // Witnessed a crime (not covering) and resent the perpetrator — want justice
  registerSecretDirectiveBuilder(({ agent, agents }) => {
    const beliefs = agent.state.beliefs;
    if (!beliefs) return [];
    const sections: string[] = [];
    const coveredSubjects = new Set(
      beliefs.getAllBeliefs().filter((b) => isConcealment(b.source)).map((b) => b.subject),
    );
    const witnessBeliefs = beliefs.getAllBeliefs().filter((b) =>
      isFirsthand(b.source) && isTransferable(b.eventType) && !coveredSubjects.has(b.subject),
    );
    for (const wb of witnessBeliefs) {
      const suspectId = wb.subject;
      if (!suspectId) continue;
      const suspectAgent = agents.get(suspectId);
      const perpetratorName = suspectAgent?.profile.name ?? suspectId;
      const rel = agent.state.relationships?.getRelationship(suspectId);
      const sentiment = rel?.sentiment ?? 0;
      if (sentiment < -0.2) {
        const justiceCrimeLabel = getEventLabelSafe(wb.eventType, 'a crime');
        sections.push(
          `## HIDDEN: You want justice\n` +
          `You have information about ${justiceCrimeLabel} and you suspect ${perpetratorName}.\n` +
          `- You are eager to share what you know — even volunteer details without being asked.\n` +
          `- You may exaggerate slightly to make sure the guilty party is caught.`,
        );
      }
    }
    return sections;
  });

  // Intimidated witness directive: witnesses who were threatened stay silent about crimes
  registerSecretDirectiveBuilder(({ agent, eventStore }) => {
    const agentId = agent.profile.id;
    const intimidationEvents = eventStore.query({ type: 'WITNESS_INTIMIDATED' })
      .filter((e: WorldEvent) => e.object === agentId);
    if (intimidationEvents.length === 0) return [];

    const intimidator = intimidationEvents[intimidationEvents.length - 1].payload?.perpetratorName as string ?? 'someone';
    return [
      `## HIDDEN: You have been intimidated\n` +
      `${intimidator} threatened you to keep quiet about what you know. You are afraid.\n` +
      `- If asked about the crime: be evasive, claim you didn't see much, look away nervously.\n` +
      `- If pressed hard: you might crack — the truth wants to come out, but fear holds you back.\n` +
      `- If the person asking seems trustworthy and powerful enough to protect you: you might open up, haltingly.\n` +
      `- You flinch at the mention of ${intimidator}'s name.`,
    ];
  });

  // Corrupt guard directive: guards with concealment beliefs are covering for someone
  registerSecretDirectiveBuilder(({ agent }) => {
    if (!hasCapability(agent.profile, 'investigator')) return [];
    const concealBeliefs = agent.state.beliefs?.getAllBeliefs().filter(
      b => b.source === 'cover_up',
    ) ?? [];
    if (concealBeliefs.length === 0) return [];

    const perpetratorNames = concealBeliefs.map(b => b.subject).filter(Boolean);
    const names = perpetratorNames.length > 0 ? perpetratorNames.join(' and ') : 'someone';
    return [
      `## HIDDEN: You are looking the other way\n` +
      `You know about crimes committed by ${names}, but you've chosen not to act.\n` +
      `- If asked about the crime: downplay it, say you're "still looking into it", stall.\n` +
      `- If pressed for action: make excuses — not enough evidence, too busy, someone else's jurisdiction.\n` +
      `- If the player brings solid evidence: you become uncomfortable, may eventually act if cornered.\n` +
      `- You are NOT loyal to the criminal — just lazy and self-serving. Enough pressure breaks you.`,
    ];
  });

  // Heat-aware secret directive: criminal NPCs get escalating danger prose (SPEC-heat-system)
  registerSecretDirectiveBuilder(({ agent, agents }) => {
    const directive = buildHeatDirective(agent, { agents });
    return directive ? [directive] : [];
  });

  // Heat Phase 2: anxiety mood modifier — criminal's heat creates persistent mood pressure
  registerTickPhaseHandler(async (ctx) => {
    if (ctx.gameMinute % 10 !== 0) return; // every 10 game minutes
    for (const [npcId, agent] of ctx.agents) {
      if (!agent.state.alive || agent.profile.isPlayer) continue;
      const heat = computeHeat(agent, { agents: ctx.agents });
      if (heat < 0.1) continue;
      // Anxiety modifier: magnitude proportional to heat, short duration (refreshed each tick)
      // This creates organic mood depression for criminals under pressure
      ctx.addMoodModifier?.(npcId, {
        source: 'heat_anxiety', category: 'event',
        magnitude: -heat * 0.15, // -0.015 at heat 0.1 to -0.15 at heat 1.0
        remaining: 15, duration: 15, decay: 'linear',
      });
    }
  });

  // Step handlers for module-specific goal actions
  registerCrimeStepHandlers();

  // Interact post-hooks (suspect evaluation after interrogation)
  registerInteractPostHook((owner, target, step, _agents, sceneResidues) => {
    if (!(step as import('@clwa/engine').InteractStep).evaluateInteractionTarget || !owner.state.beliefs || !sceneResidues) return;
    // Evaluate suspect: check guilt + honesty trait → update deduction belief confidence
    const deductionBelief = owner.state.beliefs.getAllBeliefs().find(
      (b: Belief) => b.source === 'deduction' && b.subject === target.profile.id,
    );
    if (!deductionBelief) return;

    const isGuilty = Array.from(sceneResidues.values()).flat()
      .some(s => s.active && s.actorId === target.profile.id);
    const honesty = target.profile.bigFive.honesty;
    const currentDay = owner.state.currentDay;

    if (isGuilty) {
      if (honesty >= 0.6) {
        deductionBelief.confidence = Math.min(1, 0.85);
        owner.state.lastInteractionOutcome = { type: 'confession', detail: `${target.profile.name} showed signs of guilt` };
      } else {
        deductionBelief.confidence = Math.min(1, deductionBelief.confidence + 0.15);
        owner.state.lastInteractionOutcome = { type: 'denial', detail: `${target.profile.name} denied involvement but seemed nervous` };
      }
    } else {
      deductionBelief.confidence = Math.max(0.1, deductionBelief.confidence - 0.2);
      owner.state.lastInteractionOutcome = { type: 'alibi', detail: `${target.profile.name} provided a credible alibi` };
    }
    deductionBelief.lastUpdated = currentDay;
  });

  // Interaction result hook: crime report to guard → testimony belief + rumor event
  registerInteractionResultHook(async (ctx) => {
    if (!hasCapability(ctx.target.profile, 'investigator')) return;

    // Parse structured [CRIME] tag from purpose
    const match = ctx.purpose.match(/\[CRIME\s+(.+?)\]/);
    if (!match) return;
    // Parse key=value pairs — values can contain spaces (terminated by next key= or end of string)
    const fields: Record<string, string | null> = {};
    for (const pair of match[1].matchAll(/(\w+)=(.*?)(?=\s+\w+=|$)/g)) {
      fields[pair[1]] = (pair[2]?.trim()) || null;
    }
    const perpetrator = fields.perpetrator ?? null;
    const victim = fields.victim ?? null;
    const location = fields.location ?? null;
    const eventType = fields.eventType
      ?? ctx.initiator.state.beliefs?.getAllBeliefs().find(b => b.confidence >= 0.3 && b.object)?.eventType
      ?? null;

    if (!eventType) return; // can't determine event type — skip

    // Guard receives testimony belief from the reporter
    if (ctx.target.state.beliefs) {
      const trustWeight = ctx.target.state.relationships?.getTestimonyWeight(ctx.initiator.profile.id) ?? 0.3;
      ctx.target.state.beliefs.addBelief({
        id: crypto.randomUUID(),
        eventType,
        subject: perpetrator,
        object: victim,
        location,
        confidence: Math.min(0.9, 0.5 + trustWeight * 0.4),
        source: 'testimony',
        sourceNpcId: ctx.initiator.profile.id,
        gameDay: ctx.target.state.currentDay,
        lastUpdated: ctx.target.state.currentDay,
      });
    }

    const rumorType = getRumorEventType();
    if (!rumorType || !ctx.onExtraEvent) return;

    const rumorEvent = {
      id: crypto.randomUUID(),
      type: rumorType,
      subject: perpetrator ?? '',
      object: ctx.target.profile.id,
      location: ctx.target.state.location,
      gameDay: ctx.target.state.currentDay,
      importance: 7,
      payload: {
        perpetratorName: perpetrator,
        affectedName: victim,
        crimeLocation: location,
        affectedTargets: [ctx.target.profile.id],
        reportedBy: ctx.initiator.profile.name,
      },
    };
    ctx.eventStore.append(rumorEvent);
    await ctx.onExtraEvent(rumorEvent);
  });

  // Tick phase handler: shop owners discover they've been robbed
  registerTickPhaseHandler(async (ctx) => {
    const theftEvents = ctx.eventStore.getAll()
      .filter((e: WorldEvent) => isEventCategory(e.type, 'theft'));

    for (const theft of theftEvents) {
      const discoveryKey = `theft_discovered:${theft.id}`;
      if (ctx.discoveries.has(discoveryKey)) continue;

      const ownerId = theft.object;
      if (!ownerId) continue;
      const owner = ctx.agents.get(ownerId);
      if (!owner || !owner.state.alive) continue;

      if (owner.state.location !== theft.location) continue;
      if (ctx.gameMinute <= (theft.payload?.gameMinute as number ?? 0)) continue;

      ctx.discoveries.add(discoveryKey);

      const perpetratorName = (theft.payload?.perpetratorName as string) ?? 'someone';
      await owner.observe(
        `I discovered that goods have been stolen from my shop! Things are missing and scattered. Someone robbed me!`,
        7,
      );

      owner.state.beliefs?.addBelief({
        id: crypto.randomUUID(),
        eventType: theft.type,
        subject: null,
        object: owner.profile.name,
        location: theft.location,
        confidence: 1.0,
        source: 'observation',
        sourceNpcId: null,
        gameDay: ctx.currentDay,
        lastUpdated: ctx.currentDay,
      });

      ctx.addMoodModifier(ownerId, { source: 'theft_discovered', category: 'event', magnitude: -0.3, remaining: 1440, duration: 1440, decay: 'exponential' });

      const discoveryEvent = {
        id: crypto.randomUUID(),
        type: 'THEFT_DISCOVERED',
        subject: ownerId,
        object: theft.subject,
        location: theft.location,
        gameDay: ctx.currentDay,
        importance: 6,
        payload: {
          perpetratorName,
          affectedName: owner.profile.name,
          originalTheftId: theft.id,
          sourceEvent: 'theft_discovery',
        },
      };
      ctx.eventStore.append(discoveryEvent);
      await ctx.processEvent(discoveryEvent);

      console.log(`  [Theft] ${owner.profile.name} discovered robbery at ${theft.location}!`);
    }
  });

  // Crime scene awareness: NPCs at crime scene locations passively notice evidence
  registerTickPhaseHandler(async (ctx) => {
    for (const [locationId, scenes] of ctx.sceneResidues) {
      for (const scene of scenes) {
        if (!scene.active) continue;
        // Find display name for location
        let locationName = locationId;
        for (const [, loc] of ctx.locations) {
          if (loc.name === locationId || loc.id === locationId) { locationName = loc.name; break; }
        }
        for (const [agentId, agent] of ctx.agents) {
          if (!agent.state.alive || isStatusAbsent(agent.state.status)) continue;
          if (agent.state.location !== locationId) continue;
          if (scene.noticedBy.has(agentId)) continue;

          scene.noticedBy.add(agentId);
          const noticeText = getPassiveNoticeText(scene, locationName);
          await agent.observe(noticeText, 5);

          agent.state.beliefs?.addBelief({
            id: crypto.randomUUID(),
            eventType: scene.eventType ?? scene.sceneType,
            subject: scene.actorId ? (ctx.agents.get(scene.actorId)?.profile.name ?? null) : null,
            object: scene.affectedId ? (ctx.agents.get(scene.affectedId)?.profile.name ?? null) : null,
            location: locationId,
            confidence: 0.8,
            source: 'scene_notice',
            sourceNpcId: null,
            gameDay: ctx.currentDay,
            lastUpdated: ctx.currentDay,
          });
          console.log(`  [CrimeScene] ${agent.profile.name} noticed ${scene.sceneType} scene at ${locationName}`);
        }
      }
    }
  });

  // Tick phase handler: NPC approach player when they have urgent info
  const approachCooldowns = new Map<string, number>();
  registerTickPhaseHandler(async (ctx) => {
    // Find the player agent
    let playerAgent: import('@clwa/engine').Agent | null = null;
    let playerId = '';
    for (const [id, agent] of ctx.agents) {
      if (agent.profile.isPlayer) {
        playerAgent = agent;
        playerId = id;
        break;
      }
    }
    if (!playerAgent) return;
    const playerLoc = playerAgent.state.location;

    for (const [npcId, npc] of ctx.agents) {
      if (npc.profile.isPlayer) continue;
      if (!npc.state.alive || isStatusAbsent(npc.state.status)) continue;
      if (npc.state.location !== playerLoc) continue;
      if (npc.state.inPlayerChat) continue;
      // Cooldown: 480 game minutes (8 hours) per NPC
      if (ctx.gameMinute - (approachCooldowns.get(npcId) ?? -Infinity) < 480) continue;

      // Check: NPC has urgent firsthand transferable beliefs not yet shared with player
      const urgentBeliefs = npc.state.beliefs?.getAllBeliefs().filter(
        (b) => isTransferable(b.eventType) && isFirsthand(b.source) && b.confidence >= 0.5,
      ) ?? [];

      if (urgentBeliefs.length > 0) {
        // Check if player already knows from this NPC
        const playerAlreadyKnows = urgentBeliefs.every((b) => {
          const playerBeliefs = playerAgent?.state.beliefs?.getAllBeliefs() ?? [];
          return playerBeliefs.some((pb) => pb.eventType === b.eventType && pb.sourceNpcId === npcId);
        });

        if (!playerAlreadyKnows) {
          const belief = urgentBeliefs[0];
          const eventLabel = getEventLabel(belief.eventType) ?? 'a crime';
          ctx.approaches.push({
            npcId,
            npcName: npc.profile.name,
            promptContext: `You have urgent information to share with ${playerAgent.profile.name}. You ${isFirsthand(belief.source) ? 'witnessed' : 'heard about'} ${eventLabel.toLowerCase()}${belief.object ? ` involving ${ctx.agents.get(belief.object)?.profile.name ?? belief.object}` : ''}. You want to tell them about it.`,
            displayText: `${npc.profile.name} approaches you urgently`,
            urgency: 0.8,
          });
          approachCooldowns.set(npcId, ctx.gameMinute);
          console.log(`  [Approach] ${npc.profile.name} wants to approach player (${eventLabel})`);
          continue;
        }
      }

      // Check: NPC suspects the player (has transferable belief with subject = player name)
      const suspicionBeliefs = npc.state.beliefs?.getAllBeliefs().filter(
        (b) => isTransferable(b.eventType) && b.subject === playerAgent?.profile.id && b.confidence >= 0.4,
      ) ?? [];

      if (suspicionBeliefs.length > 0 && hasCapability(npc.profile, 'investigator')) {
        ctx.approaches.push({
          npcId,
          npcName: npc.profile.name,
          promptContext: `You suspect ${playerAgent.profile.name} may be involved in a crime. You want to question them.`,
          displayText: `${npc.profile.name} approaches you with a stern look`,
          urgency: 0.9,
        });
        approachCooldowns.set(npcId, ctx.gameMinute);
        console.log(`  [Approach] ${npc.profile.name} wants to question player (suspicion)`);
        continue;
      }

      // Threatened victim approaches player for help (from threaten affordance)
      const threatBeliefs = npc.state.beliefs?.getAllBeliefs().filter(
        (b) => b.eventType === 'THREAT_PERCEIVED' && b.object === npcId && b.confidence >= 0.5,
      ) ?? [];
      if (threatBeliefs.length > 0 && !hasCapability(npc.profile, 'investigator')) {
        const threatenerName = threatBeliefs[0].subject ?? 'someone';
        ctx.approaches.push({
          npcId,
          npcName: npc.profile.name,
          promptContext: `You were recently threatened by ${threatenerName}. You are frightened and looking for someone who might help. You want to tell ${playerAgent.profile.name} what happened — maybe they can do something.`,
          displayText: `${npc.profile.name} approaches you, looking frightened`,
          urgency: 0.7,
        });
        approachCooldowns.set(npcId, ctx.gameMinute);
        console.log(`  [Approach] ${npc.profile.name} seeks help (threatened by ${threatenerName})`);
        continue;
      }
    }
  });

  // Imprisonment timer: auto-release NPCs when sentence duration expires (game days)
  registerTickPhaseHandler(async (ctx) => {
    // Reconstruct timers from events if map is empty but imprisoned NPCs exist (after server restart)
    if (imprisonmentTimers.size === 0) {
      for (const [npcId, agent] of ctx.agents) {
        if (agent.state.status === 'imprisoned') {
          const sentenceEvent = [...ctx.eventStore.getAll()].reverse().find(
            (e: WorldEvent) => e.type === 'NPC_SENTENCED' && e.object === npcId && e.payload?.verdict === 'imprisonment',
          );
          const releaseDay = (sentenceEvent?.payload?.releaseDay as number) ?? ctx.currentDay + 1;
          imprisonmentTimers.set(npcId, releaseDay);
          console.log(`  [Prison] Reconstructed timer for ${agent.profile.name}: release day ${releaseDay}`);
        }
      }
    }

    for (const [npcId, releaseDay] of imprisonmentTimers) {
      if (ctx.currentDay >= releaseDay) {
        const agent = ctx.agents.get(npcId);
        if (agent && agent.state.status === 'imprisoned') {
          agent.state.status = undefined;
          ctx.addMoodModifier(npcId, { source: 'prison_release', category: 'event', magnitude: 0.2, remaining: 720, duration: 720, decay: 'exponential' });
          await agent.observe(`I have served my sentence and been released from imprisonment. I am free, but the shame lingers.`, 6);
          console.log(`  [Prison] ${agent.profile.name} released after serving sentence`);
          // Fire release event
          await ctx.processEvent({
            id: crypto.randomUUID(),
            type: 'NPC_RELEASED',
            subject: npcId,
            object: npcId,
            location: agent.state.location,
            gameDay: ctx.currentDay,
            importance: 5,
            payload: { releasedName: agent.profile.name, affectedTargets: Array.from(ctx.agents.keys()) },
          });
        }
        imprisonmentTimers.delete(npcId);
      }
    }
  });

  // Tick phase handler: danger belief detection → defensive goals (crime prevention)
  // When an NPC receives a belief that they are a potential victim, personality determines response.
  const dangerReactionCooldowns = new Map<string, number>(); // npcId → gameMinute expiry
  const DANGER_COOLDOWN_MINUTES = 120;

  registerTickPhaseHandler(async (ctx) => {
    if (!ctx.goalManager || !ctx.npcHomes) return;

    for (const [npcId, agent] of ctx.agents) {
      if (!agent.state.alive || agent.profile.isPlayer) continue;
      if (isStatusAbsent(agent.state.status)) continue;
      if (!agent.state.beliefs) continue;

      // Find "danger to self" beliefs — someone warned me I'm a target
      const dangerBeliefs = agent.state.beliefs.getAllBeliefs().filter(
        (b) => isTransferable(b.eventType) && b.object === npcId && b.confidence >= 0.25,
      );
      if (dangerBeliefs.length === 0) continue;

      // Already reacting? Check for active defensive goal
      const existingGoals = ctx.goalManager.getGoals(npcId);
      if (existingGoals.some((g) => g.type === 'lay_low' || g.type === 'defensive')) continue;

      // Time-based cooldown: one defensive reaction per 120 game minutes
      const cooldownExpiry = dangerReactionCooldowns.get(npcId);
      if (cooldownExpiry != null && ctx.gameMinute < cooldownExpiry) continue;

      const N = agent.profile.bigFive.neuroticism;
      const C = agent.profile.bigFive.conscientiousness;

      if (N > 0.6) {
        // Fearful → go home and hide (lay_low)
        const home = ctx.npcHomes.get(npcId) ?? agent.state.location;
        ctx.goalManager.addGoal({
          id: crypto.randomUUID(), ownerId: npcId, type: 'lay_low', priority: 6, state: 'pending', currentStep: 0,
          createdAtMinute: ctx.gameMinute,
          steps: [
            { action: 'move_to', location: home },
            { action: 'wait', ticks: 16 },
          ],
          data: {},
        });
        dangerReactionCooldowns.set(npcId, ctx.gameMinute + DANGER_COOLDOWN_MINUTES);
        console.log(`  [Prevention] ${agent.profile.name} (N=${N.toFixed(1)}) — fearful, going home to lay low`);
      } else if (C > 0.6) {
        // Dutiful → report the threat to guard
        const guardId = Array.from(ctx.agents.entries()).find(
          ([id, a]) => hasCapability(a.profile, 'investigator') && a.state.alive && !isStatusAbsent(a.state.status) && id !== npcId,
        )?.[0];
        if (guardId) {
          const guard = ctx.agents.get(guardId);
          if (!guard) return;
          ctx.goalManager.addGoal({
            id: crypto.randomUUID(), ownerId: npcId, type: 'defensive', priority: 6, state: 'pending', currentStep: 0,
            createdAtMinute: ctx.gameMinute,
            steps: [
              { action: 'move_to', location: guard.state.location },
              { action: 'interact', targetId: guardId, purpose: `report a threat: someone warned you that you are in danger. Tell ${guard.profile.name} about the threat and ask for protection`, importance: 6, beliefTransfer: true, beliefTransferDirection: 'owner-to-target' },
            ],
            data: {},
          });
          dangerReactionCooldowns.set(npcId, ctx.gameMinute + DANGER_COOLDOWN_MINUTES);
          console.log(`  [Prevention] ${agent.profile.name} (C=${C.toFixed(1)}) — dutiful, reporting threat to ${guard.profile.name}`);
        }
      }
      // Low N + Low C: brave/careless — no defensive action (by design)
    }
  });

  // Relationship-driven emergent motives: deep hatred → PERSONAL_GRUDGE (checked once per day advance)
  registerTickPhaseHandler(async (ctx) => {
    // Only check every ~30 game minutes (avoid spamming)
    if (ctx.gameMinute % 30 !== 0) return;
    for (const [npcId, agent] of ctx.agents) {
      if (!agent.state.alive || agent.profile.isPlayer) continue;
      if (!agent.state.beliefs || !agent.state.relationships) continue;
      for (const [otherId, other] of ctx.agents) {
        if (otherId === npcId || !other.state.alive || other.profile.isPlayer) continue;
        const rel = agent.state.relationships.getRelationship(otherId);
        if (!rel || rel.sentiment >= -0.5) continue;
        // Guard: don't create if already has motive belief against this target
        const existing = agent.state.beliefs.getAllBeliefs().find(
          (b) => isEventCategory(b.eventType, 'motive') && b.object === otherId,
        );
        if (existing) continue;
        agent.state.beliefs.addBelief({
          id: crypto.randomUUID(),
          eventType: 'PERSONAL_GRUDGE',
          subject: null,
          object: otherId,
          location: agent.state.location,
          confidence: Math.min(1.0, Math.abs(rel.sentiment) * 0.7),
          source: 'personal_motive',
          sourceNpcId: null,
          gameDay: ctx.currentDay,
          lastUpdated: ctx.currentDay,
        });
      }
    }
  });

  // Motive confidence growth: unresolved grudges escalate over time (SPEC-criminal-escalation)
  registerTickPhaseHandler(async (ctx) => {
    if (ctx.gameMinute % 60 !== 0) return; // check every game hour
    for (const [, agent] of ctx.agents) {
      if (!agent.state.alive || agent.profile.isPlayer) continue;
      if (!agent.state.beliefs) continue;
      if (isStatusAbsent(agent.state.status)) continue;

      const motives = agent.state.beliefs.getAllBeliefs().filter(
        (b) => isEventCategory(b.eventType, 'motive') && b.confidence < 0.95,
      );

      for (const motive of motives) {
        // Only grow motives older than 3 game hours (180 minutes)
        const motiveAge = ctx.gameMinute - (motive.gameDay * 1440);
        if (motiveAge < 180) continue;

        // Growth modulated by personality:
        // Low H → faster escalation (less moral restraint)
        // High N → faster escalation (emotional volatility)
        const H = agent.profile.bigFive.honesty;
        const N = agent.profile.bigFive.neuroticism;
        const personalityFactor = (1.0 - H) * 0.6 + N * 0.4;
        const growth = 0.06 * (0.5 + personalityFactor); // 0.03 to 0.06 per hour (tuned for 1.5-2h sessions at 3x)

        motive.confidence = Math.min(0.95, motive.confidence + growth);
        motive.lastUpdated = ctx.currentDay; // keep decay calculation accurate
      }
    }
  });

  // Day advance handler: spread rumors from witnesses in public places
  registerDayAdvanceHandler(async (ctx) => {
    const alreadySpreadTo = new Set<string>();

    const existingWanted = new Set(
      ctx.eventStore.query({ type: 'WANTED_STATUS' }).map((e: WorldEvent) => e.object).filter(Boolean),
    );

    if (!ctx.publicPlaces || ctx.publicPlaces.size === 0) return;

    for (const [witnessId, witness] of ctx.agents) {
      if (!witness.state.alive) continue;
      if (!ctx.publicPlaces.has(witness.state.location)) continue;
      if (!witness.state.beliefs) continue;

      const crimeBeliefs = witness.state.beliefs.getAllBeliefs().filter(
        (b: Belief) => isEventCategory(b.eventType, 'crime') && b.confidence >= 0.3,
      );
      if (crimeBeliefs.length === 0) continue;

      const belief = crimeBeliefs.sort((a: Belief, b: Belief) => b.confidence - a.confidence)[0];
      const criminalId = belief.subject;
      const victimId = belief.object;
      const criminalName = criminalId ? (ctx.agents.get(criminalId)?.profile.name ?? criminalId) : 'someone';
      const affectedName = victimId ? (ctx.agents.get(victimId)?.profile.name ?? victimId) : 'someone';
      const crimeLocation = belief.location ?? witness.state.location;
      const crimeLabel = getEventLabel(belief.eventType);
      if (!crimeLabel) continue;

      for (const [targetId, target] of ctx.agents) {
        if (targetId === witnessId || !target.state.alive) continue;
        if (target.state.location === witness.state.location) continue;
        if (alreadySpreadTo.has(targetId)) continue;

        if (target.state.beliefs) {
          const alreadyKnows = target.state.beliefs.getAllBeliefs().some(
            (b: Belief) => isEventCategory(b.eventType, 'crime') && b.object === victimId,
          );
          if (alreadyKnows) continue;
        }

        alreadySpreadTo.add(targetId);

        const rumorText = `I heard a rumor: ${criminalName} committed ${crimeLabel} of ${affectedName} at ${crimeLocation}. The townsfolk are alarmed.`;
        await target.observe(rumorText, 6);
        ctx.addMoodModifier(targetId, { source: 'rumor_heard', category: 'event', magnitude: -0.15, remaining: 480, duration: 480, decay: 'exponential' });

        const rumorEvent = {
          id: crypto.randomUUID(),
          type: 'RUMOR_SPREAD',
          subject: criminalId ?? criminalName,
          object: targetId,
          location: target.state.location,
          gameDay: ctx.currentDay,
          importance: 6,
          payload: {
            reportedBy: witness.profile.name,
            affectedTargets: [targetId],
            sourceRule: 'daily-rumor-spread',
            sourceEvent: belief.id,
            perpetratorName: criminalName,
            affectedName,
            crimeLocation,
          },
        };

        ctx.eventStore.append(rumorEvent);
        ctx.onEvent?.(rumorEvent);

        if (hasCapability(target.profile, 'investigator') && !existingWanted.has(targetId)) {
          const wantedText = `URGENT: I received reports that ${criminalName} committed ${crimeLabel} of ${affectedName} at ${crimeLocation}. I must investigate immediately.`;
          await target.observe(wantedText, 7);
          ctx.addMoodModifier(targetId, { source: 'rumor_urgent', category: 'pressure', magnitude: -0.1, remaining: 240, duration: 240, decay: 'linear' });

          const wantedEvent = {
            id: crypto.randomUUID(),
            type: 'WANTED_STATUS',
            subject: criminalId ?? criminalName,
            object: targetId,
            location: target.state.location,
            gameDay: ctx.currentDay,
            importance: 7,
            payload: {
              crimeLocation,
              affectedTargets: [targetId],
              sourceRule: 'guard-heard-rumor',
              sourceEvent: belief.id,
              affectedName,
              perpetratorName: criminalName,
            },
          };
          ctx.eventStore.append(wantedEvent);
          ctx.onEvent?.(wantedEvent);
        }
      }
    }
  });
}
