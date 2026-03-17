import { registerEventHandler } from '@clwa/engine';
import type { EventHandlerContext } from '@clwa/engine';
import type { WorldEvent } from '@clwa/engine';

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
    const criminalName = (event.payload?.killerName as string) ?? (event.payload?.thiefName as string);
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

  // NPC_ARRESTED: create beliefs for all NPCs
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
  });

  // NPC_SENTENCED: create beliefs for all NPCs
  registerEventHandler('NPC_SENTENCED', (event: WorldEvent, ctx: EventHandlerContext) => {
    const suspectName = (event.payload?.suspectName as string) ?? null;
    const verdict = (event.payload?.verdict as string) ?? 'unknown';
    const affected = (event.payload?.affectedTargets as string[]) ?? [];
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
