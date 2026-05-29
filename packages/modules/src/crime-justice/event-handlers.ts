import { registerEventHandler, isTransferable, BELIEF_SOURCE } from '@clwa/engine';
import type { EventHandlerContext } from '@clwa/engine';
import type { WorldEvent, Belief, Agent } from '@clwa/engine';

/** Find beliefs in an NPC that originated from the player about a specific suspect */
function findPlayerClaimsAbout(agent: Agent, playerId: string, suspectId: string): Belief[] {
  if (!agent.state.beliefs) return [];
  return agent.state.beliefs.getAllBeliefs().filter(
    (b) => b.sourceNpcId === playerId && b.subject === suspectId && isTransferable(b.eventType),
  );
}

/** Find the player agent from agents map */
function findPlayerAgent(agents: Map<string, Agent>): [string, Agent] | null {
  for (const [id, agent] of agents) {
    if (agent.profile.isPlayer) return [id, agent];
  }
  return null;
}

export function registerCrimeEventHandlers(): void {
  // NPC_KILLED: killer gets perpetrator belief (blocks testify/report/demand_justice via notPerpetrator)
  registerEventHandler('NPC_KILLED', (event: WorldEvent, ctx: EventHandlerContext) => {
    const killer = ctx.agents.get(event.subject);
    if (!killer || !killer.state.beliefs) return;
    // Only add if killer doesn't already have perpetrator belief (attack_npc step already added one)
    const existing = killer.state.beliefs.getAllBeliefs().find(
      (b) => b.eventType === event.type && b.source === 'perpetrator' && b.object === event.object,
    );
    if (existing) return;
    killer.state.beliefs.addBelief({
      id: crypto.randomUUID(),
      eventType: event.type,
      subject: event.subject,
      object: event.object ?? null,
      location: event.location,
      confidence: 1.0,
      source: 'perpetrator',
      sourceNpcId: null,
      gameDay: ctx.getCurrentDay(),
      lastUpdated: ctx.getCurrentDay(),
    });
    // Mood penalty if not already applied (API kills don't go through attack_npc)
    ctx.addMoodModifier(event.subject, { source: 'murder_committed', category: 'event', magnitude: -0.3, remaining: 1440, duration: 1440, decay: 'exponential' });
  });

  // NPC_KILLED: friends of victim get REVENGE_DESIRE toward killer (emergent motive)
  registerEventHandler('NPC_KILLED', (event: WorldEvent, ctx: EventHandlerContext) => {
    const victimId = event.object;
    const killerId = event.subject;
    if (!victimId || !killerId) return;
    const currentDay = ctx.getCurrentDay();
    for (const [npcId, agent] of ctx.agents) {
      if (npcId === killerId || npcId === victimId || !agent.state.alive) continue;
      if (agent.profile.isPlayer) continue;
      const rel = agent.state.relationships?.getRelationship(victimId);
      if (!rel || rel.sentiment <= 0.3) continue; // only friends
      if (!agent.state.beliefs) continue;
      agent.state.beliefs.addBelief({
        id: crypto.randomUUID(),
        eventType: 'REVENGE_DESIRE',
        subject: null,
        object: killerId,
        location: agent.state.location,
        confidence: Math.min(1.0, rel.sentiment * 0.8),
        source: 'personal_motive',
        sourceNpcId: null,
        gameDay: currentDay,
        lastUpdated: currentDay,
      });
    }
  });

  // THEFT_DISCOVERED: victim gets REVENGE_DESIRE toward thief (emergent motive)
  // THEFT_DISCOVERED event: subject = owner/victim who discovered, object = thief
  registerEventHandler('THEFT_DISCOVERED', (event: WorldEvent, ctx: EventHandlerContext) => {
    const victimId = event.subject; // owner who discovered theft
    const thiefId = event.object;   // the thief
    if (!victimId || !thiefId) return;
    const victim = ctx.agents.get(victimId);
    if (!victim || !victim.state.alive || !victim.state.beliefs) return;
    if (victim.profile.isPlayer) return;
    victim.state.beliefs.addBelief({
      id: crypto.randomUUID(),
      eventType: 'REVENGE_DESIRE',
      subject: null,
      object: thiefId,
      location: victim.state.location,
      confidence: 0.8,
      source: 'personal_motive',
      sourceNpcId: null,
      gameDay: ctx.getCurrentDay(),
      lastUpdated: ctx.getCurrentDay(),
    });
  });

  // WANTED_STATUS: investigator sentiment + criminal awareness
  registerEventHandler('WANTED_STATUS', async (event: WorldEvent, ctx: EventHandlerContext) => {
    const criminalName = (event.payload?.perpetratorName as string);
    if (!criminalName) return;

    const criminalEntry = Array.from(ctx.agents.entries())
      .find(([, a]) => a.profile.name === criminalName || a.profile.id === criminalName);
    if (!criminalEntry) return;

    const [criminalId, criminal] = criminalEntry;

    // All investigators get negative sentiment toward criminal
    for (const [, agent] of ctx.agents) {
      if (agent.profile.investigator && agent.state.relationships) {
        agent.state.relationships.adjustSentiment(criminalId, -0.4);
        agent.state.relationships.adjustTrust(criminalId, -0.3);
      }
    }

    // Criminal learns they're wanted: mood penalty + stress
    ctx.addMoodModifier(criminalId, { source: 'wanted_stress', category: 'pressure', magnitude: -0.2, remaining: 240, duration: 240, decay: 'linear' });
    criminal.state.beliefs?.addBelief({
      id: crypto.randomUUID(),
      eventType: 'WANTED_STATUS',
      subject: criminalId,
      object: criminalId,
      location: criminal.state.location,
      confidence: 0.9,
      source: 'observation',
      sourceNpcId: null,
      gameDay: ctx.getCurrentDay(),
      lastUpdated: ctx.getCurrentDay(),
    });

    // Criminal gets reactive goals (flee, lay_low, seek_forgiveness, destroy_evidence, intimidate).
    // All criminal affordances have eventBoost on WANTED_STATUS — this is the trigger point.
    // Engine's main reactive evaluation excludes event.subject (killer shouldn't get report_crime),
    // so module explicitly triggers evaluation for the criminal here.
    await ctx.triggerReactiveEvaluation(criminalId, event);
  });

  // Information spread: sentiment toward criminal drops for affected NPCs
  // Registered for all informational event types — module decides the effects
  const informationSentimentHandler = (event: WorldEvent, ctx: EventHandlerContext) => {
    const criminalName = (event.payload?.perpetratorName as string);
    if (!criminalName) return;
    const criminalEntry = Array.from(ctx.agents.entries())
      .find(([, a]) => a.profile.name === criminalName || a.profile.id === criminalName);
    if (!criminalEntry) return;
    const [criminalId] = criminalEntry;
    const affectedName = (event.payload?.affectedName as string) ?? null;
    const affected = (event.payload?.affectedTargets as string[]) ?? [];
    for (const npcId of affected) {
      const agent = ctx.agents.get(npcId);
      if (agent?.state.relationships && npcId !== criminalId) {
        let drop = -0.15;
        if (affectedName) {
          const victimEntry = Array.from(ctx.agents.entries()).find(([, a]) => a.profile.name === affectedName);
          if (victimEntry) {
            const victimRel = agent.state.relationships.getRelationship(victimEntry[0]);
            if (victimRel && victimRel.sentiment > 0.1) {
              drop = -(0.25 + victimRel.sentiment * 0.3);
            }
          }
        }
        agent.state.relationships.adjustSentiment(criminalId, drop);
      }
    }
  };
  registerEventHandler('RUMOR_SPREAD', informationSentimentHandler);
  registerEventHandler('WITNESS_MEMORY', informationSentimentHandler);
  registerEventHandler('THEFT_DISCOVERED', informationSentimentHandler);

  // EVIDENCE_DESTROYED: degrade crime scene
  registerEventHandler('EVIDENCE_DESTROYED', (event: WorldEvent, ctx: EventHandlerContext) => {
    const scenes = ctx.crimeScenes.get(event.location);
    if (!scenes) return;
    for (const scene of scenes) {
      if (!scene.active) continue;
      const removeCount = Math.min(scene.points.length, 1 + (Math.random() > 0.5 ? 1 : 0));
      for (let i = 0; i < removeCount; i++) {
        const idx = Math.floor(Math.random() * scene.points.length);
        scene.points.splice(idx, 1);
      }
      if (scene.points.length === 0) {
        scene.active = false;
      }
      console.log(`  [Evidence] Crime scene at ${event.location}: ${removeCount} evidence point(s) destroyed (${scene.points.length} remaining)`);
    }
  });

  // NPC_ARRESTED: create beliefs for all NPCs + trust evolution for player claims
  registerEventHandler('NPC_ARRESTED', (event: WorldEvent, ctx: EventHandlerContext) => {
    const perpetratorName = (event.payload?.perpetratorName as string) ?? null;
    const affected = (event.payload?.affectedTargets as string[]) ?? [];
    for (const npcId of affected) {
      const agent = ctx.agents.get(npcId);
      agent?.state.beliefs?.addBelief({
        id: crypto.randomUUID(),
        eventType: 'NPC_ARRESTED',
        subject: event.subject ?? null,
        object: event.object ?? perpetratorName,
        location: event.location,
        confidence: 0.8,
        source: npcId === event.subject ? BELIEF_SOURCE.OBSERVATION : BELIEF_SOURCE.GOSSIP,
        sourceNpcId: null,
        gameDay: ctx.getCurrentDay(),
        lastUpdated: ctx.getCurrentDay(),
      });
    }

    // Trust evolution: if player told NPCs about this suspect → arrest confirms the claim
    const suspectId = event.object;
    if (!suspectId) return;
    const player = findPlayerAgent(ctx.agents);
    if (!player) return;
    const [playerId] = player;
    for (const [, agent] of ctx.agents) {
      if (agent.profile.isPlayer) continue;
      const claims = findPlayerClaimsAbout(agent, playerId, suspectId);
      if (claims.length > 0) {
        agent.state.relationships?.adjustTrust(playerId, 0.08);
        console.log(`  [Trust] ${agent.profile.name} trust in player +0.08 (arrest confirmed claim about ${perpetratorName})`);
      }
    }
  });

  // NPC_SENTENCED: beliefs + trust evolution + verdict-conditional belief zeroing/scene cleanup
  registerEventHandler('NPC_SENTENCED', (event: WorldEvent, ctx: EventHandlerContext) => {
    const perpetratorName = (event.payload?.perpetratorName as string) ?? null;
    const suspectId = event.object;
    const verdict = (event.payload?.verdict as string) ?? 'unknown';
    const affected = (event.payload?.affectedTargets as string[]) ?? [];

    // 1. Create sentence beliefs for all NPCs
    for (const npcId of affected) {
      const agent = ctx.agents.get(npcId);
      agent?.state.beliefs?.addBelief({
        id: crypto.randomUUID(),
        eventType: 'NPC_SENTENCED',
        subject: event.subject ?? null,
        object: suspectId ?? null,
        location: event.location,
        confidence: 0.9,
        source: BELIEF_SOURCE.GOSSIP,
        sourceNpcId: null,
        gameDay: ctx.getCurrentDay(),
        lastUpdated: ctx.getCurrentDay(),
      });
    }

    // 2. Verdict-conditional case resolution
    if (suspectId) {
      const suspect = ctx.agents.get(suspectId);
      if (suspect && (verdict === 'exile' || verdict === 'imprisonment')) {
        // FULL resolution: zero transferable beliefs + deactivate crime scenes
        // Collect victim IDs from crime scenes linked to this suspect
        const victimIds = new Set<string>();
        for (const [, scenes] of ctx.crimeScenes) {
          for (const scene of scenes) {
            if (scene.perpetratorId === suspectId && scene.victimId) {
              victimIds.add(scene.victimId);
            }
          }
        }
        // Zero transferable beliefs about suspect/victim for all NPCs
        for (const [, agent] of ctx.agents) {
          if (!agent.state.beliefs) continue;
          for (const b of agent.state.beliefs.getAllBeliefs()) {
            if (!isTransferable(b.eventType)) continue;
            const aboutSuspect = b.subject === suspectId;
            const aboutVictim = b.object != null && victimIds.has(b.object);
            if (aboutSuspect || aboutVictim) {
              b.confidence = 0;
            }
          }
        }
        // Deactivate crime scenes + mark bodies discovered (prevents post-resolution loops)
        for (const [, scenes] of ctx.crimeScenes) {
          for (const scene of scenes) {
            if (scene.perpetratorId !== suspectId) continue;
            scene.active = false;
            if (scene.victimId) {
              for (const [agentId] of ctx.agents) {
                ctx.bodyDiscoveries.add(`${agentId}:${scene.victimId}`);
              }
            }
          }
        }
        console.log(`  [CaseResolution] ${verdict}: beliefs zeroed, scenes deactivated for ${perpetratorName}`);
      } else if (verdict === 'fine') {
        // PARTIAL resolution: reduce beliefs but don't zero — stigma remains
        const suspect2 = ctx.agents.get(suspectId);
        if (suspect2) {
          for (const [, agent] of ctx.agents) {
            if (!agent.state.beliefs) continue;
            for (const b of agent.state.beliefs.getAllBeliefs()) {
              if (!isTransferable(b.eventType)) continue;
              if (b.subject === suspectId) {
                b.confidence = Math.max(0, b.confidence * 0.3); // reduce to 30%
              }
            }
          }
          console.log(`  [CaseResolution] fine: beliefs reduced for ${perpetratorName}`);
        }
      }
      // warning, release: NO belief zeroing — suspicions remain
    }

    // 3. Trust evolution: verdict confirms or refutes player claims
    if (!suspectId) return;
    const player = findPlayerAgent(ctx.agents);
    if (!player) return;
    const [playerId] = player;
    for (const [, agent] of ctx.agents) {
      if (agent.profile.isPlayer) continue;
      const claims = findPlayerClaimsAbout(agent, playerId, suspectId);
      if (claims.length === 0) continue;

      if (verdict === 'exile' || verdict === 'imprisonment') {
        const boost = verdict === 'exile' ? 0.12 : 0.08;
        agent.state.relationships?.adjustTrust(playerId, boost);
        console.log(`  [Trust] ${agent.profile.name} trust +${boost} (${verdict} confirmed claim about ${perpetratorName})`);
      } else if (verdict === 'fine' || verdict === 'warning') {
        agent.state.relationships?.adjustTrust(playerId, 0.04);
        console.log(`  [Trust] ${agent.profile.name} trust +0.04 (${verdict} partially confirmed claim about ${perpetratorName})`);
      } else if (verdict === 'release') {
        agent.state.relationships?.adjustTrust(playerId, -0.15);
        console.log(`  [Trust] ${agent.profile.name} trust -0.15 (acquittal refuted claim about ${perpetratorName})`);
      }
    }
  });

  // NPC_FLED: create beliefs for all NPCs
  registerEventHandler('NPC_FLED', (event: WorldEvent, ctx: EventHandlerContext) => {
    const fledName = (event.payload?.fledName as string) ?? null;
    const affected = (event.payload?.affectedTargets as string[]) ?? [];
    for (const npcId of affected) {
      const agent = ctx.agents.get(npcId);
      agent?.state.beliefs?.addBelief({
        id: crypto.randomUUID(),
        eventType: 'NPC_FLED',
        subject: event.object ?? fledName,
        object: event.object ?? fledName,
        location: event.location,
        confidence: 0.7,
        source: BELIEF_SOURCE.GOSSIP,
        sourceNpcId: null,
        gameDay: ctx.getCurrentDay(),
        lastUpdated: ctx.getCurrentDay(),
      });
    }
  });
}
