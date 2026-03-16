import {
  AFFORDANCE_REGISTRY, EVIDENCE_RULES, REQUIREMENT_CHECKERS, TOPIC_SOURCE_REGISTRY,
  registerEventCategory, registerEventLabels, registerEventGoalCleanup, registerBeliefZeroingEvents,
  registerEventSceneTypes, registerDeathEvents, registerPursuitEvents, registerActionVerbs,
  registerAbsentStatuses, registerStepHandler, registerInteractPostHook,
  registerWitnessEventType, registerEventMoodShifts, registerGoalMoodBoost,
  registerBodyDiscoveryEventType, registerRumorEventType,
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
  REQUIREMENT_CHECKERS.set('notPerpetrator', (agent, _ctx) => {
    if (!agent.state.beliefs) return true;
    return !agent.state.beliefs.getAllBeliefs().some(
      (b: any) => isSourceCategory(b.source, 'guilt'),
    );
  });

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
    NPC_SENTENCED: ['arrest', 'interrogate', 'investigate', 'evaluate_case', 'testify', 'report_crime', 'demand_justice'],
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

  // Source categories — classify belief sources for engine behavioral prompts
  registerSourceCategory('guilt', ['perpetrator']);
  registerSourceCategory('direct_experience', ['witness', 'body_discovery']);
  registerSourceCategory('concealment', ['cover_up']);

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
    professionClues: PROFESSION_CLUES,
    personalizeBody: true,
  });
  registerCrimeSceneTemplate('robbery', {
    points: [
      { type: 'damage', description: 'A lock has been forced open, the mechanism bent and broken.', clueText: 'The lock was broken with considerable force — someone strong or with the right tools.' },
      { type: 'stolen_goods', description: 'Shelves are bare and containers emptied, their contents gone.', clueText: 'Goods were taken deliberately — the thief knew what they were after.' },
      { type: 'struggle', description: 'Items knocked off tables, a chair overturned.', clueText: 'Whoever did this was in a hurry, or met some resistance.' },
    ],
    passiveNoticeText: 'I noticed signs of a break-in at {locationName} — a broken lock and scattered goods. Someone was robbed.',
    professionClues: PROFESSION_CLUES,
  });
  registerCrimeSceneTemplate('assault', {
    points: [
      { type: 'bloodstain', description: 'Spots of blood on the ground, as if from a wound.', clueText: 'Someone was hurt here, but not fatally. They likely walked away.' },
      { type: 'struggle', description: 'The area is disturbed — a scuffle clearly took place.', clueText: 'A fight happened here. From the marks, it was between two people.' },
    ],
    passiveNoticeText: 'I saw signs of a fight at {locationName} — blood spots and overturned furniture. Someone was attacked here.',
    professionClues: PROFESSION_CLUES,
  });

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
        killerName: killer,
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
      .filter((e: any) => isEventCategory(e.type, 'theft'));

    for (const theft of theftEvents) {
      const discoveryKey = `theft_discovered:${theft.id}`;
      if (ctx.discoveries.has(discoveryKey)) continue;

      const ownerId = theft.object;
      if (!ownerId) continue;
      const owner = ctx.agents.get(ownerId);
      if (!owner || !owner.state.alive) continue;

      if (owner.state.location !== theft.location) continue;
      if (ctx.tickCount <= (theft.payload?.tick as number ?? 0)) continue;

      ctx.discoveries.add(discoveryKey);

      const thiefName = (theft.payload?.thiefName as string) ?? 'someone';
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

      owner.state.mood = Math.max(-1, owner.state.mood - 0.3);

      const discoveryEvent = {
        id: crypto.randomUUID(),
        type: 'THEFT_DISCOVERED',
        subject: ownerId,
        object: theft.subject,
        location: theft.location,
        gameDay: ctx.currentDay,
        importance: 6,
        payload: {
          thiefName,
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

  // Day advance handler: spread rumors from witnesses in public places
  registerDayAdvanceHandler(async (ctx) => {
    const alreadySpreadTo = new Set<string>();

    const existingWanted = new Set(
      ctx.eventStore.query({ type: 'WANTED_STATUS' }).map((e: any) => e.object).filter(Boolean),
    );

    if (!ctx.publicPlaces || ctx.publicPlaces.size === 0) return;

    for (const [witnessId, witness] of ctx.agents) {
      if (!witness.state.alive) continue;
      if (!ctx.publicPlaces.has(witness.state.location)) continue;
      if (!witness.state.beliefs) continue;

      const crimeBeliefs = witness.state.beliefs.getAllBeliefs().filter(
        (b: any) => isEventCategory(b.eventType, 'crime') && b.confidence >= 0.3,
      );
      if (crimeBeliefs.length === 0) continue;

      const belief = crimeBeliefs.sort((a: any, b: any) => b.confidence - a.confidence)[0];
      const criminalName = belief.subject ?? 'someone';
      const victimName = belief.object ?? 'someone';
      const crimeLocation = belief.location ?? witness.state.location;
      const crimeLabel = getEventLabel(belief.eventType);

      for (const [targetId, target] of ctx.agents) {
        if (targetId === witnessId || !target.state.alive) continue;
        if (target.state.location === witness.state.location) continue;
        if (alreadySpreadTo.has(targetId)) continue;

        if (target.state.beliefs) {
          const alreadyKnows = target.state.beliefs.getAllBeliefs().some(
            (b: any) => isEventCategory(b.eventType, 'crime') && b.object === victimName,
          );
          if (alreadyKnows) continue;
        }

        alreadySpreadTo.add(targetId);

        const rumorText = `I heard a rumor: ${criminalName} committed ${crimeLabel} of ${victimName} at ${crimeLocation}. The townsfolk are alarmed.`;
        await target.observe(rumorText, 6);
        target.state.mood = Math.max(-1, target.state.mood - 0.15);

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
            killerName: criminalName,
            victimName,
            crimeLocation,
          },
        };

        ctx.eventStore.append(rumorEvent);
        ctx.onEvent?.(rumorEvent);

        if (target.profile.investigator && !existingWanted.has(targetId)) {
          const wantedText = `URGENT: I received reports that ${criminalName} committed ${crimeLabel} of ${victimName} at ${crimeLocation}. I must investigate immediately.`;
          await target.observe(wantedText, 7);
          target.state.mood = Math.max(-1, target.state.mood - 0.1);

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
              killerName: criminalName,
            },
          };
          ctx.eventStore.append(wantedEvent);
          ctx.onEvent?.(wantedEvent);
        }
      }
    }
  });
}
