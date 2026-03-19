import {
  AFFORDANCE_REGISTRY, EVIDENCE_RULES, REQUIREMENT_CHECKERS, TOPIC_SOURCE_REGISTRY,
  registerEventCategory, registerEventLabels, registerEventGoalCleanup, registerEventTypeFlagsBatch, registerSourceFlags,
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
  isTransferable,
  isFirsthand,
  isStatusAbsent,
  registerSourceDecayRates,
  registerSourceTransferWeights,
  registerBeliefSourceLabels,
  getPassiveNoticeText,
} from '@clwa/engine';
import { CRIME_AFFORDANCES } from './affordances';
import { registerCrimeTargetFinders, isCriminalNpc, isWantedNpc, hasDetainedNpc, hasWitnessBelief } from './target-finders';
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
  REQUIREMENT_CHECKERS.set('notPerpetrator', (agent, _ctx) => {
    if (!agent.state.beliefs) return true;
    return !agent.state.beliefs.getAllBeliefs().some(
      (b: any) => isSourceCategory(b.source, 'guilt'),
    );
  });

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

  // Secret source: doesn't transfer through gossip (you don't casually share blackmail material)
  registerSourceTransferWeights({ secret: 0 });

  // Additional source labels for prompts
  registerBeliefSourceLabels({ secret: 'personal knowledge', scene_notice: 'noticed at crime scene' });

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

  // Topic sources for NPC conversations about justice events + player rumors
  TOPIC_SOURCE_REGISTRY.push(justiceTopics);
  TOPIC_SOURCE_REGISTRY.push(playerRumorTopics);

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
            location: locationName,
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
      // Cooldown: 32 ticks (8 game hours) per NPC
      if (ctx.tickCount - (approachCooldowns.get(npcId) ?? -Infinity) < 32) continue;

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
            promptContext: `You have urgent information to share with ${playerAgent.profile.name}. You ${isFirsthand(belief.source) ? 'witnessed' : 'heard about'} ${eventLabel.toLowerCase()}${belief.object ? ` involving ${belief.object}` : ''}. You want to tell them about it.`,
            displayText: `${npc.profile.name} approaches you urgently`,
            urgency: 0.8,
          });
          approachCooldowns.set(npcId, ctx.tickCount);
          console.log(`  [Approach] ${npc.profile.name} wants to approach player (${eventLabel})`);
          continue;
        }
      }

      // Check: NPC suspects the player (has transferable belief with subject = player name)
      const suspicionBeliefs = npc.state.beliefs?.getAllBeliefs().filter(
        (b) => isTransferable(b.eventType) && b.subject === playerAgent!.profile.name && b.confidence >= 0.4,
      ) ?? [];

      if (suspicionBeliefs.length > 0 && npc.profile.investigator) {
        ctx.approaches.push({
          npcId,
          npcName: npc.profile.name,
          promptContext: `You suspect ${playerAgent.profile.name} may be involved in a crime. You want to question them.`,
          displayText: `${npc.profile.name} approaches you with a stern look`,
          urgency: 0.9,
        });
        approachCooldowns.set(npcId, ctx.tickCount);
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
            (e: any) => e.type === 'NPC_SENTENCED' && e.object === npcId && e.payload?.verdict === 'imprisonment',
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
          agent.state.mood = Math.min(1, agent.state.mood + 0.2);
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
      if (!crimeLabel) continue;

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
