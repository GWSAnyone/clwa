import type { Agent, AffordanceContext, AffordanceDefinition, AffordanceTarget } from '@clwa/engine';
import type { Belief } from '@clwa/engine';
import type { WorldEvent } from '@clwa/engine';
import { TARGET_FINDERS, REACTIVE_TARGET_FINDERS, findByRole, isEventCategory, getEventLabel, isTransferable, isStatusAbsent, isPerpetrator, isFirsthand } from '@clwa/engine';

// ─── Helpers ───

/** Match belief subject/object against NPC (handles "Name the role" format from CE cascade) */
function matchesNpc(name: string | null | undefined, agent: Agent): boolean {
  if (!name) return false;
  return name === agent.profile.name || name === agent.profile.id || name.startsWith(agent.profile.name + ' ');
}

// ─── Shared Target Finders ───

function findStealTarget(npcId: string, agent: Agent, ctx: AffordanceContext): AffordanceTarget | null {
  let best: AffordanceTarget | null = null;
  for (const [otherId, other] of ctx.agents) {
    if (otherId === npcId || !other.state.alive || !other.profile.shop) continue;
    if (other.state.location === agent.state.location) {
      return { targetId: otherId, targetName: other.profile.name, targetLocation: other.state.location };
    }
    const loc = ctx.locations.get(agent.state.location);
    if (loc && loc.connections.includes(other.state.location) && !best) {
      best = { targetId: otherId, targetName: other.profile.name, targetLocation: other.state.location };
    }
  }
  return best;
}

function findMotiveTarget(npcId: string, agent: Agent, ctx: AffordanceContext): AffordanceTarget | null {
  const motive = agent.profile.motive;
  if (!motive) return null;
  const target = ctx.agents.get(motive.targetId);
  if (!target || !target.state.alive) return null;
  return { targetId: motive.targetId, targetName: target.profile.name, targetLocation: target.state.location, extra: { reason: motive.reason } };
}

/** Sentiment-based targeting: find the NPC this agent hates most.
 *  Uses motive.reason as enrichment if target matches motive.targetId. */
function findMostHatedTarget(npcId: string, agent: Agent, ctx: AffordanceContext): AffordanceTarget | null {
  const rels = agent.state.relationships;
  if (!rels) return null;

  let bestId: string | null = null;
  let bestSentiment = 0;
  let bestName = '';
  let bestLocation = '';

  for (const [otherId, other] of ctx.agents) {
    if (otherId === npcId || !other.state.alive) continue;
    if (other.profile.isPlayer) continue;
    if (!isStatusAbsent(other.state.status)) continue;

    const rel = rels.getRelationship(otherId);
    if (!rel) continue;
    if (rel.sentiment < bestSentiment) {
      bestSentiment = rel.sentiment;
      bestId = otherId;
      bestName = other.profile.name;
      bestLocation = other.state.location;
    }
  }

  if (!bestId) return null;

  const motive = agent.profile.motive;
  const reason = (motive && motive.targetId === bestId) ? motive.reason : undefined;

  return {
    targetId: bestId,
    targetName: bestName,
    targetLocation: bestLocation,
    extra: reason ? { reason } : {},
  };
}

function findCrimeBeliefTarget(npcId: string, agent: Agent, ctx: AffordanceContext, minConfidence: number): AffordanceTarget | null {
  if (!agent.state.beliefs) return null;
  const crimeBeliefs = agent.state.beliefs.getAllBeliefs().filter(
    (b: Belief) =>
      isEventCategory(b.eventType, 'crime') &&
      b.confidence >= minConfidence && b.subject !== agent.profile.name,
  );
  for (const belief of crimeBeliefs) {
    for (const [otherId, other] of ctx.agents) {
      if (otherId === npcId || !other.state.alive) continue;
      if (belief.subject && matchesNpc(belief.subject, other)) {
        return {
          targetId: otherId, targetName: other.profile.name, targetLocation: other.state.location,
          extra: { beliefId: belief.id, eventType: belief.eventType, victimName: belief.object, reason: `${belief.eventType === 'NPC_KILLED' ? 'murder' : 'crime'} of ${belief.object ?? 'someone'}` },
        };
      }
    }
  }
  return null;
}

function findBlackmailTarget(npcId: string, agent: Agent, ctx: AffordanceContext): AffordanceTarget | null {
  if (!agent.state.beliefs) return null;
  // Find secret knowledge beliefs (source: 'secret') — things NPC knows about others
  const secretBeliefs = agent.state.beliefs.getAllBeliefs().filter(
    (b: Belief) => b.source === 'secret' && b.confidence >= 0.4 && b.subject !== agent.profile.name,
  );
  for (const belief of secretBeliefs) {
    for (const [otherId, other] of ctx.agents) {
      if (otherId === npcId || !other.state.alive || other.profile.isPlayer) continue;
      if (isStatusAbsent(other.state.status)) continue;
      if (matchesNpc(belief.subject, other)) {
        return {
          targetId: otherId,
          targetName: other.profile.name,
          targetLocation: other.state.location,
          extra: { secretDetail: belief.object ?? 'has a secret', secretBelief: belief.id },
        };
      }
    }
  }
  return null;
}

/** Find a public location with other NPCs for gossip */
function findGossipTarget(npcId: string, agent: Agent, ctx: AffordanceContext): AffordanceTarget | null {
  for (const [locId, loc] of ctx.locations) {
    if (!loc.isPublic || locId === agent.state.location) continue;
    for (const [otherId, other] of ctx.agents) {
      if (otherId === npcId || !other.state.alive || other.profile.isPlayer) continue;
      if (other.state.location === locId) {
        // Extract crime details from NPC's strongest transferable belief
        const extra: Record<string, string> = {};
        const crimeBeliefs = agent.state.beliefs?.getAllBeliefs()
          .filter(b => isTransferable(b.eventType) && b.confidence >= 0.3)
          .sort((a, b) => b.confidence - a.confidence) ?? [];
        if (crimeBeliefs.length > 0) {
          const top = crimeBeliefs[0];
          extra.suspectName = top.subject ?? 'someone';
          extra.victimName = top.object ?? 'someone';
          extra.crimeType = getEventLabel(top.eventType) ?? 'crime';
          if (top.location) extra.crimeLocation = top.location;
        }
        return { targetId: otherId, targetName: other.profile.name, targetLocation: locId, extra };
      }
    }
  }
  return null;
}

// ─── Requirement Helpers ───

/** Check if NPC is the perpetrator of a crime */
export function isCriminalNpc(agent: Agent, ctx: AffordanceContext): boolean {
  if (!agent.state.beliefs) return false;
  // Check if any crime event has this NPC as subject
  const crimeBeliefs = agent.state.beliefs.getAllBeliefs();
  for (const b of crimeBeliefs) {
    if (isEventCategory(b.eventType, 'crime') &&
        (b.subject === agent.profile.name || b.subject === agent.profile.id)) {
      return true;
    }
  }
  return false;
}

/** Check if NPC is currently wanted */
export function isWantedNpc(agent: Agent, ctx: AffordanceContext): boolean {
  // Check all agents' beliefs for WANTED_STATUS naming this NPC
  for (const [, other] of ctx.agents) {
    if (!other.state.beliefs) continue;
    const wanted = other.state.beliefs.getAllBeliefs().find(
      (b: Belief) => b.eventType === 'WANTED_STATUS' &&
        (b.subject === agent.profile.name || b.subject === agent.profile.id),
    );
    if (wanted) return true;
  }
  return false;
}

/** Check if any detained NPC exists */
export function hasDetainedNpc(ctx: AffordanceContext): boolean {
  for (const [, agent] of ctx.agents) {
    if (agent.state.status === 'detained') return true;
  }
  return false;
}

/** Check if NPC has a witness-source crime belief (excludes perpetrators) */
export function hasWitnessBelief(agent: Agent): boolean {
  if (!agent.state.beliefs) return false;
  const allBeliefs = agent.state.beliefs.getAllBeliefs();
  // If NPC is the perpetrator of any crime, they cannot testify about it
  const perpetratorEvents = new Set(
    allBeliefs.filter((b: Belief) => isPerpetrator(b.source)).map((b: Belief) => b.eventType),
  );
  return allBeliefs.some(
    (b: Belief) => isEventCategory(b.eventType, 'crime') &&
      !perpetratorEvents.has(b.eventType) &&
      isFirsthand(b.source) &&
      b.subject !== agent.profile.name && b.subject !== agent.profile.id &&
      b.confidence >= 0.3,
  );
}

// ─── New Target Finders (Investigation & Punishment) ───

/** Find an NPC to interrogate (witness or suspect at crime location) */
function findInterrogationTarget(npcId: string, agent: Agent, ctx: AffordanceContext, event?: WorldEvent): AffordanceTarget | null {
  if (!agent.state.beliefs) return null;

  const crimeBeliefs = agent.state.beliefs.getAllBeliefs().filter(
    (b: Belief) => isEventCategory(b.eventType, 'crime') && b.confidence >= 0.3,
  );
  if (crimeBeliefs.length === 0) return null;

  // Find an NPC who might know something (anyone with beliefs about same crime, or at crime location)
  for (const belief of crimeBeliefs) {
    for (const [otherId, other] of ctx.agents) {
      if (otherId === npcId || !other.state.alive || other.profile.isPlayer) continue;
      if (isStatusAbsent(other.state.status)) continue;

      // Check if this NPC has relevant beliefs about the same crime (match by eventType + victim)
      const otherBeliefs = other.state.beliefs?.getAllBeliefs() ?? [];
      const relevant = otherBeliefs.find(
        (ob: Belief) => ob.eventType === belief.eventType && ob.confidence >= 0.3 &&
          // Disambiguate: if both beliefs know the victim, they must match
          (!belief.object || !ob.object || belief.object === ob.object),
      );
      if (relevant) {
        return {
          targetId: otherId, targetName: other.profile.name, targetLocation: other.state.location,
          extra: {
            crimeType: getEventLabel(belief.eventType) ?? 'crime',
            victimName: belief.object ?? 'someone',
            crimeLocation: belief.location,
          },
        };
      }
    }
  }

  return null;
}

/** Find a suspect to arrest (high confidence belief about them) */
function findArrestTarget(npcId: string, agent: Agent, ctx: AffordanceContext, event?: WorldEvent): AffordanceTarget | null {
  if (!agent.state.beliefs) return null;

  // Find suspects: any named subject in a crime belief
  const crimeBeliefs = agent.state.beliefs.getAllBeliefs().filter(
    (b: Belief) => isEventCategory(b.eventType, 'crime') && b.subject,
  );
  // Deduplicate suspect names
  const suspects = new Map<string, Belief>();
  for (const b of crimeBeliefs) {
    if (!suspects.has(b.subject!)) suspects.set(b.subject!, b);
  }

  for (const [suspectName, belief] of suspects) {
    // Aggregate confidence: max across ALL beliefs about this suspect
    const aggConf = agent.state.beliefs.getMaxConfidenceFor(
      suspectName,
      (et) => isEventCategory(et, 'crime'),
    );
    if (aggConf < 0.7) continue;

    for (const [otherId, other] of ctx.agents) {
      if (otherId === npcId || !other.state.alive) continue;
      if (other.state.status) continue; // can't arrest someone already detained/exiled

      if (matchesNpc(suspectName, other)) {
        return {
          targetId: otherId, targetName: other.profile.name, targetLocation: other.state.location,
          extra: {
            crimeType: getEventLabel(belief.eventType) ?? 'crime',
            victimName: belief.object ?? 'someone',
          },
        };
      }
    }
  }

  return null;
}

/** Find a crime scene for a criminal to destroy evidence */
function findCrimeSceneForCriminal(npcId: string, agent: Agent, ctx: AffordanceContext): AffordanceTarget | null {
  // Criminal knows where the crime happened (from their own belief or memory)
  if (!agent.state.beliefs) return null;
  const ownCrime = agent.state.beliefs.getAllBeliefs().find(
    (b: Belief) => isEventCategory(b.eventType, 'crime') &&
      (b.subject === agent.profile.name || b.subject === agent.profile.id) && b.location,
  );
  if (!ownCrime) return null;
  return {
    targetId: npcId, targetName: agent.profile.name, targetLocation: ownCrime.location,
    extra: { crimeLocation: ownCrime.location },
  };
}

/** Find a witness to intimidate */
function findWitnessTarget(npcId: string, agent: Agent, ctx: AffordanceContext): AffordanceTarget | null {
  // Find NPCs who have witness beliefs about this NPC's crime
  // Prioritize co-located > adjacent > anywhere (proximity preference)
  let bestTarget: AffordanceTarget | null = null;
  let bestProximity = Infinity; // 0=co-located, 1=adjacent, 2=anywhere

  const agentLocation = agent.state.location;
  const agentLoc = ctx.locations.get(agentLocation);
  const adjacentLocations = agentLoc ? new Set(agentLoc.connections) : new Set<string>();

  for (const [otherId, other] of ctx.agents) {
    if (otherId === npcId || !other.state.alive || other.profile.isPlayer || other.profile.investigator) continue;
    if (isStatusAbsent(other.state.status)) continue; // only free NPCs can be intimidated

    const otherBeliefs = other.state.beliefs?.getAllBeliefs() ?? [];
    const witnessOfMyCrime = otherBeliefs.find(
      (b: Belief) => isEventCategory(b.eventType, 'crime') &&
        matchesNpc(b.subject, agent) &&
        b.confidence >= 0.3,
    );
    if (witnessOfMyCrime) {
      const proximity = other.state.location === agentLocation ? 0
        : adjacentLocations.has(other.state.location) ? 1 : 2;
      if (proximity < bestProximity) {
        bestTarget = {
          targetId: otherId, targetName: other.profile.name, targetLocation: other.state.location,
          extra: { crimeType: witnessOfMyCrime.eventType === 'NPC_KILLED' ? 'murder' : 'crime' },
        };
        bestProximity = proximity;
        if (proximity === 0) break; // co-located is optimal, stop searching
      }
    }
  }
  return bestTarget;
}

/** Find a crime scene to investigate — returns the crime location as target, with crimeLocation in extra */
function findInvestigateTarget(npcId: string, agent: Agent, ctx: AffordanceContext): AffordanceTarget | null {
  if (!agent.state.beliefs) return null;

  const crimeBeliefs = agent.state.beliefs.getAllBeliefs().filter(
    (b: Belief) => isEventCategory(b.eventType, 'crime') && b.confidence >= 0.3 && b.location,
  );
  if (crimeBeliefs.length === 0) return null;

  // Pick strongest crime belief with a known location
  const belief = crimeBeliefs.sort((a: Belief, b: Belief) => b.confidence - a.confidence)[0];

  return {
    targetId: npcId, // self — the goal is about the location, not a person
    targetName: agent.profile.name,
    targetLocation: belief.location!,
    extra: {
      crimeType: getEventLabel(belief.eventType) ?? 'crime',
      victimName: belief.object ?? 'someone',
      crimeLocation: belief.location!,
      suspectName: belief.subject ?? 'an unknown suspect',
    },
  };
}

/** Find a detained NPC for the judge to evaluate */
function findDetainedTarget(ctx: AffordanceContext): AffordanceTarget | null {
  for (const [id, agent] of ctx.agents) {
    if (agent.state.status === 'detained') {
      return { targetId: id, targetName: agent.profile.name, targetLocation: agent.state.location };
    }
  }
  return null;
}

// ─── Registration ───

export function registerCrimeTargetFinders(): void {
  // Proactive finders (used when NPC evaluates affordances each tick)
  TARGET_FINDERS.set('steal', findStealTarget);
  TARGET_FINDERS.set('kill', findMostHatedTarget);
  TARGET_FINDERS.set('motive', findMotiveTarget); // kept for other affordances if needed
  TARGET_FINDERS.set('crime_belief', (npcId, agent, ctx, aff) => findCrimeBeliefTarget(npcId, agent, ctx, aff.requires.beliefConfidence ?? 0.5));
  TARGET_FINDERS.set('blackmail', findBlackmailTarget);
  TARGET_FINDERS.set('interrogation', (npcId, agent, ctx) => findInterrogationTarget(npcId, agent, ctx));
  TARGET_FINDERS.set('investigate', (npcId, agent, ctx) => findInvestigateTarget(npcId, agent, ctx));
  TARGET_FINDERS.set('arrest', (npcId, agent, ctx) => findArrestTarget(npcId, agent, ctx));
  TARGET_FINDERS.set('gossip', findGossipTarget);
  TARGET_FINDERS.set('crime_scene', findCrimeSceneForCriminal);
  TARGET_FINDERS.set('witness_target', findWitnessTarget);
  TARGET_FINDERS.set('self_gate', (npcId, agent) => ({ targetId: npcId, targetName: agent.profile.name, targetLocation: 'town-gate' }));
  TARGET_FINDERS.set('detained', (_npcId, _agent, ctx) => findDetainedTarget(ctx));

  // Reactive finders (used when events trigger affordance evaluation)
  REACTIVE_TARGET_FINDERS.set('report_crime', (npcId, agent, ctx, event) => {
    const guard = findByRole('guard', npcId, agent, ctx);
    if (!guard) return null;
    const suspectName = (event.payload?.suspectName as string) ?? 'someone';
    const victimName = (event.payload?.victimName as string) ?? 'someone';
    guard.extra = { ...guard.extra, suspectName, victimName, crimeLocation: event.location, eventType: event.type };
    return guard;
  });

  REACTIVE_TARGET_FINDERS.set('investigate', (npcId, agent, _ctx, event) => {
    if (!agent.profile.investigator) return null;
    const crimeLocation = (event.payload?.crimeLocation as string) ?? event.location;
    const suspectName = (event.payload?.suspectName as string) ?? 'an unknown suspect';
    const victimName = (event.payload?.victimName as string) ?? 'the victim';
    return { targetId: npcId, targetName: agent.profile.name, targetLocation: crimeLocation, extra: { crimeLocation, suspectName, victimName } };
  });

  REACTIVE_TARGET_FINDERS.set('gossip', (npcId, agent, ctx, event) => {
    const target = findGossipTarget(npcId, agent, ctx);
    if (!target) return null;
    // Merge event payload crime details (more specific than belief-derived)
    target.extra = {
      ...target.extra,
      suspectName: (event.payload?.suspectName as string) ?? target.extra?.suspectName ?? 'someone',
      victimName: (event.payload?.victimName as string) ?? target.extra?.victimName ?? 'someone',
      crimeLocation: (event.payload?.crimeLocation as string) ?? event.location ?? target.extra?.crimeLocation ?? '',
    };
    return target;
  });

  REACTIVE_TARGET_FINDERS.set('grieve', (npcId, agent, ctx, event) => {
    const victimId = event.object;
    if (!victimId) return null;
    const rel = agent.state.relationships?.getRelationship(victimId);
    if (!rel || rel.sentiment < 0.2) return null; // only close relationships
    const priest = findByRole('priest', npcId, agent, ctx);
    if (!priest) return null;
    const victimName = (event.payload?.victimName as string) ?? 'someone';
    priest.extra = { ...priest.extra, victimName, relationship: rel.type };
    return priest;
  });

  REACTIVE_TARGET_FINDERS.set('lay_low', (npcId, agent, ctx, event) => {
    const criminalName = (event.payload?.suspectName as string) ?? event.subject;
    if (agent.profile.name !== criminalName && agent.profile.id !== criminalName) return null;
    const home = ctx.npcHomes.get(npcId) ?? agent.state.location;
    return { targetId: npcId, targetName: agent.profile.name, targetLocation: home };
  });

  REACTIVE_TARGET_FINDERS.set('seek_forgiveness', (npcId, agent, ctx, event) => {
    const criminalName = (event.payload?.suspectName as string) ?? event.subject;
    if (agent.profile.name !== criminalName && agent.profile.id !== criminalName) return null;
    const priest = findByRole('priest', npcId, agent, ctx);
    if (!priest) return null;
    const victimName = (event.payload?.victimName as string) ?? 'someone';
    const crimeEventType = (event.payload?.originalEventType as string) ?? event.type;
    priest.extra = { ...priest.extra, victimName, crimeType: crimeEventType === 'GOODS_STOLEN' ? 'theft' : 'crime' };
    return priest;
  });

  REACTIVE_TARGET_FINDERS.set('interrogate', (npcId, agent, ctx, event) => {
    if (!agent.profile.investigator) return null;
    return findInterrogationTarget(npcId, agent, ctx, event);
  });

  REACTIVE_TARGET_FINDERS.set('arrest', (npcId, agent, ctx, event) => {
    if (!agent.profile.investigator) return null;
    return findArrestTarget(npcId, agent, ctx, event);
  });

  REACTIVE_TARGET_FINDERS.set('testify', (npcId, agent, ctx, event) => {
    const guard = findByRole('guard', npcId, agent, ctx);
    if (!guard) return null;
    const vName = (event.payload?.victimName as string) ?? 'someone';
    const cType = event.type === 'NPC_KILLED' ? 'murder' : 'crime';
    guard.extra = { ...guard.extra, victimName: vName, crimeType: cType };
    return guard;
  });

  REACTIVE_TARGET_FINDERS.set('demand_justice', (npcId, agent, ctx, event) => {
    const guard = findByRole('guard', npcId, agent, ctx);
    if (!guard) return null;
    const vName = (event.payload?.victimName as string) ?? 'someone';
    guard.extra = { ...guard.extra, victimName: vName, crimeType: 'crime' };
    return guard;
  });

  REACTIVE_TARGET_FINDERS.set('destroy_evidence', (npcId, agent, ctx, event) => {
    const criminalName = (event.payload?.suspectName as string) ?? event.subject;
    if (agent.profile.name !== criminalName && agent.profile.id !== criminalName) return null;
    return findCrimeSceneForCriminal(npcId, agent, ctx);
  });

  REACTIVE_TARGET_FINDERS.set('intimidate_witness', (npcId, agent, ctx, event) => {
    const criminalName = (event.payload?.suspectName as string) ?? event.subject;
    if (agent.profile.name !== criminalName && agent.profile.id !== criminalName) return null;
    return findWitnessTarget(npcId, agent, ctx);
  });

  REACTIVE_TARGET_FINDERS.set('flee_town', (npcId, agent, _ctx, event) => {
    const criminalName = (event.payload?.suspectName as string) ?? event.subject;
    if (agent.profile.name !== criminalName && agent.profile.id !== criminalName) return null;
    return { targetId: npcId, targetName: agent.profile.name, targetLocation: 'town-gate' };
  });

  REACTIVE_TARGET_FINDERS.set('evaluate_case', (_npcId, agent, ctx) => {
    if (!agent.profile.canSentence) return null;
    return findDetainedTarget(ctx);
  });
}
