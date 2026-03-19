import { registerEventHandler, isTransferable } from '@clwa/engine';
import type { EventHandlerContext } from '@clwa/engine';
import type { WorldEvent, Belief, Agent } from '@clwa/engine';

/** Find beliefs in an NPC that originated from the player about a specific suspect */
function findPlayerClaimsAbout(agent: Agent, playerId: string, suspectName: string): Belief[] {
  if (!agent.state.beliefs) return [];
  return agent.state.beliefs.getAllBeliefs().filter(
    (b) => b.sourceNpcId === playerId && b.subject === suspectName && isTransferable(b.eventType),
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
      (b) => b.eventType === event.type && b.source === 'perpetrator' && b.object === (event.payload?.victimName as string),
    );
    if (existing) return;
    killer.state.beliefs.addBelief({
      id: crypto.randomUUID(),
      eventType: event.type,
      subject: killer.profile.name,
      object: (event.payload?.victimName as string) ?? null,
      location: event.location,
      confidence: 1.0,
      source: 'perpetrator',
      sourceNpcId: null,
      gameDay: ctx.getCurrentDay(),
      lastUpdated: ctx.getCurrentDay(),
    });
    // Mood penalty if not already applied (API kills don't go through attack_npc)
    killer.state.mood = Math.max(-1, killer.state.mood - 0.3);
  });

  // WANTED_STATUS: investigator sentiment + criminal awareness
  registerEventHandler('WANTED_STATUS', (event: WorldEvent, ctx: EventHandlerContext) => {
    const criminalName = (event.payload?.suspectName as string);
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
    criminal.state.mood = Math.max(-1, criminal.state.mood - 0.2);
    criminal.state.beliefs?.addBelief({
      id: crypto.randomUUID(),
      eventType: 'WANTED_STATUS',
      subject: criminal.profile.name,
      object: criminal.profile.name,
      location: criminal.state.location,
      confidence: 0.9,
      source: 'observation',
      sourceNpcId: null,
      gameDay: ctx.getCurrentDay(),
      lastUpdated: ctx.getCurrentDay(),
    });
  });

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
    const suspectName = (event.payload?.suspectName as string) ?? null;
    const affected = (event.payload?.affectedTargets as string[]) ?? [];
    for (const npcId of affected) {
      const agent = ctx.agents.get(npcId);
      agent?.state.beliefs?.addBelief({
        id: crypto.randomUUID(),
        eventType: 'NPC_ARRESTED',
        subject: (event.payload?.guardName as string) ?? null,
        object: suspectName,
        location: event.location,
        confidence: 0.8,
        source: npcId === event.subject ? 'observation' : 'rumor',
        sourceNpcId: null,
        gameDay: ctx.getCurrentDay(),
        lastUpdated: ctx.getCurrentDay(),
      });
    }

    // Trust evolution: if player told NPCs about this suspect → arrest confirms the claim
    if (!suspectName) return;
    const player = findPlayerAgent(ctx.agents);
    if (!player) return;
    const [playerId] = player;
    for (const [, agent] of ctx.agents) {
      if (agent.profile.isPlayer) continue;
      const claims = findPlayerClaimsAbout(agent, playerId, suspectName);
      if (claims.length > 0) {
        agent.state.relationships?.adjustTrust(playerId, 0.08);
        console.log(`  [Trust] ${agent.profile.name} trust in player +0.08 (arrest confirmed claim about ${suspectName})`);
      }
    }
  });

  // NPC_SENTENCED: beliefs + trust evolution + verdict-conditional belief zeroing/scene cleanup
  registerEventHandler('NPC_SENTENCED', (event: WorldEvent, ctx: EventHandlerContext) => {
    const suspectName = (event.payload?.suspectName as string) ?? null;
    const suspectId = event.object;
    const verdict = (event.payload?.verdict as string) ?? 'unknown';
    const affected = (event.payload?.affectedTargets as string[]) ?? [];

    // 1. Create sentence beliefs for all NPCs
    for (const npcId of affected) {
      const agent = ctx.agents.get(npcId);
      agent?.state.beliefs?.addBelief({
        id: crypto.randomUUID(),
        eventType: 'NPC_SENTENCED',
        subject: (event.payload?.judgeName as string) ?? null,
        object: suspectName ? `${suspectName} (${verdict})` : null,
        location: event.location,
        confidence: 0.9,
        source: 'rumor',
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
        // Collect victim names from crime scenes linked to this suspect
        const victimNames = new Set<string>();
        for (const [, scenes] of ctx.crimeScenes) {
          for (const scene of scenes) {
            if (scene.perpetratorId === suspectId && scene.victimId) {
              const victim = ctx.agents.get(scene.victimId);
              if (victim) victimNames.add(victim.profile.name);
            }
          }
        }
        // Zero transferable beliefs about suspect/victim for all NPCs
        for (const [, agent] of ctx.agents) {
          if (!agent.state.beliefs) continue;
          for (const b of agent.state.beliefs.getAllBeliefs()) {
            if (!isTransferable(b.eventType)) continue;
            const aboutSuspect = b.subject === suspect.profile.name || b.subject === suspectId;
            const aboutVictim = b.object != null && victimNames.has(b.object);
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
        console.log(`  [CaseResolution] ${verdict}: beliefs zeroed, scenes deactivated for ${suspectName}`);
      } else if (verdict === 'fine') {
        // PARTIAL resolution: reduce beliefs but don't zero — stigma remains
        const suspect2 = ctx.agents.get(suspectId);
        if (suspect2) {
          for (const [, agent] of ctx.agents) {
            if (!agent.state.beliefs) continue;
            for (const b of agent.state.beliefs.getAllBeliefs()) {
              if (!isTransferable(b.eventType)) continue;
              if (b.subject === suspect2.profile.name || b.subject === suspectId) {
                b.confidence = Math.max(0, b.confidence * 0.3); // reduce to 30%
              }
            }
          }
          console.log(`  [CaseResolution] fine: beliefs reduced for ${suspectName}`);
        }
      }
      // warning, release: NO belief zeroing — suspicions remain
    }

    // 3. Trust evolution: verdict confirms or refutes player claims
    if (!suspectName) return;
    const player = findPlayerAgent(ctx.agents);
    if (!player) return;
    const [playerId] = player;
    for (const [, agent] of ctx.agents) {
      if (agent.profile.isPlayer) continue;
      const claims = findPlayerClaimsAbout(agent, playerId, suspectName);
      if (claims.length === 0) continue;

      if (verdict === 'exile' || verdict === 'imprisonment') {
        const boost = verdict === 'exile' ? 0.12 : 0.08;
        agent.state.relationships?.adjustTrust(playerId, boost);
        console.log(`  [Trust] ${agent.profile.name} trust +${boost} (${verdict} confirmed claim about ${suspectName})`);
      } else if (verdict === 'fine' || verdict === 'warning') {
        agent.state.relationships?.adjustTrust(playerId, 0.04);
        console.log(`  [Trust] ${agent.profile.name} trust +0.04 (${verdict} partially confirmed claim about ${suspectName})`);
      } else if (verdict === 'release') {
        agent.state.relationships?.adjustTrust(playerId, -0.15);
        console.log(`  [Trust] ${agent.profile.name} trust -0.15 (acquittal refuted claim about ${suspectName})`);
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
        subject: fledName,
        object: fledName,
        location: event.location,
        confidence: 0.7,
        source: 'rumor',
        sourceNpcId: null,
        gameDay: ctx.getCurrentDay(),
        lastUpdated: ctx.getCurrentDay(),
      });
    }
  });
}
