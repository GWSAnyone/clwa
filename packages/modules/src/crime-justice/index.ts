import {
  AFFORDANCE_REGISTRY, EVIDENCE_RULES, REQUIREMENT_CHECKERS, TOPIC_SOURCE_REGISTRY,
  registerEventCategory, registerEventLabels, registerEventGoalCleanup, registerEventTypeFlags, registerEventTypeFlagsBatch, registerSourceFlags,
  registerEventSceneTypes, registerDeathEvents, registerPursuitEvents, registerActionVerbs,
  registerAbsentStatuses, registerStepHandler, registerInteractPostHook, registerTopicGroupMapping,
  registerWitnessEventType, registerEventMoodShifts, registerGoalMoodBoost,
  registerBodyDiscoveryEventType, registerRumorEventType, registerDiscoveryHandler, BELIEF_SOURCE,
  registerBeliefCreator, registerMemoryTextBuilder,
  registerSourceCategory,
  registerCrimeSceneTemplate,
  registerInteractionResultHook,
  getRumorEventType,
  registerTickPhaseHandler,
  isEventCategory,
  isSourceCategory,
  registerDayAdvanceHandler,
  getEventLabel,
  isTransferable,
  isFirsthand,
  isStatusAbsent,
  registerSourceDecayRates,
  registerSourceTransferWeights,
  registerBeliefSourceLabels,
  getPassiveNoticeText,
  getAffordanceIdsForVerb,
  registerSecretEventType,
  registerAccusationResponseHandler,
  registerBlockingGoalTypes,
  registerRelationshipLabels,
} from '@clwa/engine';
import type { Belief, WorldEvent } from '@clwa/engine';
import { CRIME_AFFORDANCES } from './affordances';
import { registerCrimeTargetFinders, isCriminalNpc, isWantedNpc, hasDetainedNpc, hasWitnessBelief, hasSuspicionBelief } from './target-finders';
import { CRIME_EVIDENCE_RULES } from './evidence-rules';
import { registerCrimeEvidenceSources } from './evidence-sources';
import { justiceTopics, playerRumorTopics } from './topic-sources';
import { registerCrimeEventHandlers } from './event-handlers';
import { registerCrimeStepHandlers, imprisonmentTimers } from './step-handlers';
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
  REQUIREMENT_CHECKERS.set('hasSuspicionBelief', (agent, _ctx) => hasSuspicionBelief(agent));
  REQUIREMENT_CHECKERS.set('notPerpetrator', (agent, _ctx) => {
    if (!agent.state.beliefs) return true;
    return !agent.state.beliefs.getAllBeliefs().some(
      (b: Belief) => isSourceCategory(b.source, 'guilt'),
    );
  });
  REQUIREMENT_CHECKERS.set('hasCrimeBelief', (agent, _ctx, params) => {
    if (!agent.state.beliefs) return false;
    const minConf = (params?.minConfidence as number) ?? 0.3;
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

  // Accusation response — crime-justice policy for ALL evidence quality levels
  registerAccusationResponseHandler((quality, npc, _suspectId) => {
    if (quality === 'strong' && (npc.profile.investigator || npc.profile.canSentence)) {
      return { goalType: 'arrest', affordanceId: 'arrest', trustDelta: 0.05 };
    }
    if (quality === 'moderate' && npc.profile.investigator) {
      return { goalType: 'investigate', affordanceId: 'investigate' };
    }
    if (quality === 'weak') {
      return { trustDelta: -0.03 };
    }
    if (quality === 'insufficient') {
      return { trustDelta: -0.08, rejectReason: 'insufficient_evidence' };
    }
    return null;
  });

  // Goal types that block volition re-evaluation of target NPC
  registerBlockingGoalTypes(['arrest']);

  // Event registries — declare module-specific event metadata for engine
  registerEventCategory('crime', ['NPC_KILLED', 'GOODS_STOLEN', 'SELF_JUSTICE']);
  registerEventCategory('economic_pressure', ['DEBT_PRESSURE']);
  registerEventCategory('body_discovery', ['BODY_DISCOVERED']);
  registerEventCategory('witness_event', ['WITNESS_MEMORY']);
  registerEventCategory('theft', ['GOODS_STOLEN']);
  registerEventCategory('information_spread', ['RUMOR_SPREAD', 'WITNESS_MEMORY', 'THEFT_DISCOVERED']);
  registerEventCategory('justice_resolution', ['NPC_SENTENCED', 'NPC_FLED']);

  // Event type flags — engine checks boolean properties, not category names
  registerEventTypeFlagsBatch(['NPC_KILLED', 'GOODS_STOLEN', 'SELF_JUSTICE'], { transferable: true });
  registerEventTypeFlagsBatch(['RUMOR_SPREAD', 'WITNESS_MEMORY', 'THEFT_DISCOVERED'], { informationOnly: true });
  registerEventTypeFlagsBatch(['WANTED_STATUS'], { subjectReacts: true }); // criminal reacts to being wanted (flee, lay_low)

  // Secret event type — used by engine conversation impact for secret discovery beliefs
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
      `I discovered the body of ${ctx.victimName} at ${locationName}! They appear to have been murdered. I need to tell someone about this immediately.`,
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
        object: ctx.victimName,
        location: ctx.location,
        confidence: 0.7,
        source: BELIEF_SOURCE.BODY_DISCOVERY,
        sourceNpcId: null,
        gameDay: ctx.gameDay,
        lastUpdated: ctx.gameDay,
      });
    }
    // Grief: relationship-based mood penalty
    if (ctx.discoverer.state.relationships) {
      const grief = ctx.discoverer.state.relationships.getGriefPenalty(ctx.victimId);
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
    rumor: 0.04, cover_up: 0.01, perpetrator: 0.01,
    evidence: 0.005,  // physical evidence fades very slowly
    scene_notice: 0.02, // noticed aftermath — fades like testimony
    secret: 0,         // secret knowledge never decays
  });

  // Module-specific source transfer weights (moved from engine defaults)
  registerSourceTransferWeights({
    witness: 0.85,
    rumor: 0.5,
    perpetrator: 0.0,
    cover_up: 0.0,
    secret: 0,
  });

  // Module-specific source labels (moved from engine defaults)
  registerBeliefSourceLabels({
    witness: 'saw it happen',
    interrogation: 'testimony under questioning',
    rumor: 'hearsay',
    perpetrator: 'committed the act',
    cover_up: 'covering up',
    secret: 'personal knowledge',
    scene_notice: 'noticed at crime scene',
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

  registerCrimeSceneTemplate('murder', {
    points: [
      { type: 'body', description: 'A lifeless body lies on the ground, face frozen in shock.', clueText: 'The victim was killed here. No signs they tried to flee — the attack was sudden.' },
      { type: 'bloodstain', description: 'Dark stains spread across the floor, still damp in places.', clueText: 'A large pool of blood. The wound was severe — this was no accident.' },
      { type: 'struggle', description: 'Furniture is overturned and objects scattered around the area.', clueText: 'Signs of a brief struggle. The victim may have tried to resist.' },
    ],
    passiveNoticeText: 'I noticed something terrible at {locationName} — blood on the floor and signs of violence. Something awful happened here.',
    personalizePoints: (points, { victim }) => {
      if (!victim) return;
      const bodyPoint = points.find((p) => p.type === 'body');
      if (bodyPoint) {
        bodyPoint.description = `The body of ${victim.profile.name} the ${victim.profile.role} lies on the ground.`;
        bodyPoint.clueText = `${victim.profile.name} was killed here. The attack seems sudden — no signs of an attempted escape.`;
      }
    },
    additionalPoints: ({ perpetrator }) => {
      if (!perpetrator) return [];
      const profClue = PROFESSION_CLUES[perpetrator.profile.role];
      if (!profClue) return [];
      return [{ type: 'profession_clue', description: profClue.description, clueText: profClue.clueText }];
    },
  });
  registerCrimeSceneTemplate('robbery', {
    points: [
      { type: 'damage', description: 'A lock has been forced open, the mechanism bent and broken.', clueText: 'The lock was broken with considerable force — someone strong or with the right tools.' },
      { type: 'stolen_goods', description: 'Shelves are bare and containers emptied, their contents gone.', clueText: 'Goods were taken deliberately — the thief knew what they were after.' },
      { type: 'struggle', description: 'Items knocked off tables, a chair overturned.', clueText: 'Whoever did this was in a hurry, or met some resistance.' },
    ],
    passiveNoticeText: 'I noticed signs of a break-in at {locationName} — a broken lock and scattered goods. Someone was robbed.',
    additionalPoints: ({ perpetrator }) => {
      if (!perpetrator) return [];
      const profClue = PROFESSION_CLUES[perpetrator.profile.role];
      if (!profClue) return [];
      return [{ type: 'profession_clue', description: profClue.description, clueText: profClue.clueText }];
    },
  });
  registerCrimeSceneTemplate('assault', {
    points: [
      { type: 'bloodstain', description: 'Spots of blood on the ground, as if from a wound.', clueText: 'Someone was hurt here, but not fatally. They likely walked away.' },
      { type: 'struggle', description: 'The area is disturbed — a scuffle clearly took place.', clueText: 'A fight happened here. From the marks, it was between two people.' },
    ],
    passiveNoticeText: 'I saw signs of a fight at {locationName} — blood spots and overturned furniture. Someone was attacked here.',
    additionalPoints: ({ perpetrator }) => {
      if (!perpetrator) return [];
      const profClue = PROFESSION_CLUES[perpetrator.profile.role];
      if (!profClue) return [];
      return [{ type: 'profession_clue', description: profClue.description, clueText: profClue.clueText }];
    },
  });

  registerEventMoodShifts({
    WITNESS_MEMORY: -0.20,    // shock — rumination through conversations, not instant cliff
    BODY_DISCOVERED: -0.15,   // grim finding
    RUMOR_SPREAD: -0.08,      // unsettling
    WANTED_STATUS: -0.05,     // tension
  });

  registerGoalMoodBoost({
    report_crime: 0.1, investigate: 0.08, confront: 0.08,
    gossip: 0.05, grief: 0.03,
    // Crime goals: no mood boost — crime is desperate, not satisfying (SPEC-mood-pressure)
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

  // Topic sources for NPC conversations about justice events + player rumors
  TOPIC_SOURCE_REGISTRY.push(justiceTopics);
  TOPIC_SOURCE_REGISTRY.push(playerRumorTopics);

  // Topic group mappings for crime-justice categories
  registerTopicGroupMapping({
    'justice': 'conflict', 'conflict': 'conflict', 'player_rumor': 'conflict',
    'player_rumor:': 'conflict',
  });

  // Action verb → affordance ID mapping for LLM DO/WHY parser
  registerActionVerbs({
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

  // Step handlers for module-specific goal actions
  registerCrimeStepHandlers();

  // Interact post-hooks (suspect evaluation after interrogation)
  registerInteractPostHook((owner, target, step, _agents, crimeScenes) => {
    if (!step.evaluateSuspect || !owner.state.beliefs || !crimeScenes) return;
    // Evaluate suspect: check guilt + honesty trait → update deduction belief confidence
    const deductionBelief = owner.state.beliefs.getAllBeliefs().find(
      (b: Belief) => b.source === 'deduction' && b.subject === target.profile.id,
    );
    if (!deductionBelief) return;

    const isGuilty = Array.from(crimeScenes.values()).flat()
      .some(s => s.active && s.perpetratorId === target.profile.id);
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
    if (!ctx.target.profile.investigator) return;

    // Parse structured [CRIME] tag from purpose
    const match = ctx.purpose.match(/\[CRIME\s+(.+?)\]/);
    if (!match) return;
    // Parse key=value pairs — values can contain spaces (terminated by next key= or end of string)
    const fields: Record<string, string | null> = {};
    for (const pair of match[1].matchAll(/(\w+)=(.*?)(?=\s+\w+=|$)/g)) {
      fields[pair[1]] = (pair[2]?.trim()) || null;
    }
    const killer = fields.killer ?? null;
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
        subject: killer,
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
      subject: killer ?? '',
      object: ctx.target.profile.id,
      location: ctx.target.state.location,
      gameDay: ctx.target.state.currentDay,
      importance: 7,
      payload: {
        suspectName: killer,
        victimName: victim,
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

      const suspectName = (theft.payload?.suspectName as string) ?? 'someone';
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
          suspectName,
          victimName: owner.profile.name,
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
    for (const [locationId, scenes] of ctx.crimeScenes) {
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
            eventType: scene.eventType ?? scene.crimeType,
            subject: scene.perpetratorId ? (ctx.agents.get(scene.perpetratorId)?.profile.name ?? null) : null,
            object: scene.victimId ? (ctx.agents.get(scene.victimId)?.profile.name ?? null) : null,
            location: locationId,
            confidence: 0.8,
            source: 'scene_notice',
            sourceNpcId: null,
            gameDay: ctx.currentDay,
            lastUpdated: ctx.currentDay,
          });
          console.log(`  [CrimeScene] ${agent.profile.name} noticed ${scene.crimeType} scene at ${locationName}`);
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
          const playerBeliefs = playerAgent!.state.beliefs?.getAllBeliefs() ?? [];
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
        (b) => isTransferable(b.eventType) && b.subject === playerAgent!.profile.id && b.confidence >= 0.4,
      ) ?? [];

      if (suspicionBeliefs.length > 0 && npc.profile.investigator) {
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
    }
  });

  // Imprisonment timer: auto-release NPCs when sentence duration expires (game days)
  registerTickPhaseHandler(async (ctx) => {
    // Reconstruct timers from events if map is empty but imprisoned NPCs exist (after server restart)
    if (imprisonmentTimers.size === 0) {
      for (const [npcId, agent] of ctx.agents) {
        if (agent.state.status === 'imprisoned') {
          const sentenceEvent = ctx.eventStore.getAll().reverse().find(
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
          npcId, type: 'lay_low', priority: 6, state: 'pending', currentStep: 0,
          steps: [
            { action: 'move_to', location: home, skipIfAt: true },
            { action: 'wait', ticks: 16 },
          ],
          data: {},
        });
        dangerReactionCooldowns.set(npcId, ctx.gameMinute + DANGER_COOLDOWN_MINUTES);
        console.log(`  [Prevention] ${agent.profile.name} (N=${N.toFixed(1)}) — fearful, going home to lay low`);
      } else if (C > 0.6) {
        // Dutiful → report the threat to guard
        const guardId = Array.from(ctx.agents.entries()).find(
          ([id, a]) => a.profile.investigator && a.state.alive && !isStatusAbsent(a.state.status) && id !== npcId,
        )?.[0];
        if (guardId) {
          const guard = ctx.agents.get(guardId)!;
          ctx.goalManager.addGoal({
            npcId, type: 'defensive', priority: 6, state: 'pending', currentStep: 0,
            steps: [
              { action: 'move_to', location: guard.state.location, skipIfAt: true },
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
      const victimName = victimId ? (ctx.agents.get(victimId)?.profile.name ?? victimId) : 'someone';
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

        const rumorText = `I heard a rumor: ${criminalName} committed ${crimeLabel} of ${victimName} at ${crimeLocation}. The townsfolk are alarmed.`;
        await target.observe(rumorText, 6);
        ctx.addMoodModifier(targetId, { source: 'rumor_heard', category: 'event', magnitude: -0.15, remaining: 480, duration: 480, decay: 'exponential' });

        const rumorEvent = {
          id: crypto.randomUUID(),
          type: 'RUMOR_SPREAD',
          subject: criminalName,
          object: targetId,
          location: target.state.location,
          gameDay: ctx.currentDay,
          importance: 6,
          payload: {
            reportedBy: witness.profile.name,
            affectedTargets: [targetId],
            sourceRule: 'daily-rumor-spread',
            sourceEvent: belief.id,
            suspectName: criminalName,
            victimName,
            crimeLocation,
          },
        };

        ctx.eventStore.append(rumorEvent);
        ctx.onEvent?.(rumorEvent);

        if (target.profile.investigator && !existingWanted.has(targetId)) {
          const wantedText = `URGENT: I received reports that ${criminalName} committed ${crimeLabel} of ${victimName} at ${crimeLocation}. I must investigate immediately.`;
          await target.observe(wantedText, 7);
          ctx.addMoodModifier(targetId, { source: 'rumor_urgent', category: 'pressure', magnitude: -0.1, remaining: 240, duration: 240, decay: 'linear' });

          const wantedEvent = {
            id: crypto.randomUUID(),
            type: 'WANTED_STATUS',
            subject: criminalName,
            object: targetId,
            location: target.state.location,
            gameDay: ctx.currentDay,
            importance: 7,
            payload: {
              crimeLocation,
              affectedTargets: [targetId],
              sourceRule: 'guard-heard-rumor',
              sourceEvent: belief.id,
              victimName,
              suspectName: criminalName,
            },
          };
          ctx.eventStore.append(wantedEvent);
          ctx.onEvent?.(wantedEvent);
        }
      }
    }
  });
}
