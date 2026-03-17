import { registerStepHandler, getEventLabel, getBeliefSourceLabel, nextHop } from '@clwa/engine';
import type { StepExecutionContext } from '@clwa/engine';
import type { GoalActionResult } from '@clwa/engine';

/** Gather evidence from all NPC beliefs about a suspect */
function gatherEvidence(suspect: any, agents: Map<string, any>): string {
  const lines: string[] = [];
  const suspectName = suspect.profile.name;
  const suspectId = suspect.profile.id;
  const matchesSuspect = (field: string | null | undefined): boolean =>
    !!field && (field === suspectName || field === suspectId);

  for (const [, agent] of agents) {
    if (!agent.state.alive) continue;
    const beliefs = agent.state.beliefs?.getAllBeliefs() ?? [];
    for (const b of beliefs) {
      if (b.confidence >= 0.3 && (matchesSuspect(b.subject) || matchesSuspect(b.object))) {
        const sourceLabel = getBeliefSourceLabel(b.source);
        lines.push(`- ${agent.profile.name} (${sourceLabel}, confidence ${Math.round(b.confidence * 100)}%): ${b.subject} committed ${getEventLabel(b.eventType)} of ${b.object ?? 'unknown'}`);
      }
    }
  }

  if (lines.length === 0) return 'No evidence gathered against this suspect.';
  return lines.join('\n');
}

/** Check if suspect is guilty (perpetrator of an active crime scene) */
function checkGuilt(suspectId: string, crimeScenes?: Map<string, any[]>): boolean {
  if (!crimeScenes) return false;
  for (const scenes of crimeScenes.values()) {
    for (const scene of scenes) {
      if (scene.active && scene.perpetratorId === suspectId) return true;
    }
  }
  return false;
}

/** Evaluate interrogation outcome based on guilt + honesty trait */
function evaluateInterrogationOutcome(owner: any, target: any, currentDay: number, crimeScenes: Map<string, any[]>): void {
  if (!owner.state.beliefs) return;
  const deductionBelief = owner.state.beliefs.getAllBeliefs().find(
    (b: any) => b.source === 'deduction' && b.subject === target.profile.name,
  );
  if (!deductionBelief) return;

  const isGuilty = checkGuilt(target.profile.id, crimeScenes);
  const honesty = target.profile.bigFive.honesty;
  const HONESTY_THRESHOLD = 0.6;
  const CONFESSION_CONFIDENCE = 0.85;
  const NERVOUS_BOOST = 0.15;
  const ALIBI_DROP = 0.2;

  if (isGuilty) {
    if (honesty >= HONESTY_THRESHOLD) {
      deductionBelief.confidence = Math.min(1, CONFESSION_CONFIDENCE);
      deductionBelief.lastUpdated = currentDay;
    } else {
      deductionBelief.confidence = Math.min(1, deductionBelief.confidence + NERVOUS_BOOST);
      deductionBelief.lastUpdated = currentDay;
    }
  } else {
    deductionBelief.confidence = Math.max(0.1, deductionBelief.confidence - ALIBI_DROP);
    deductionBelief.lastUpdated = currentDay;
  }
}

export function registerCrimeStepHandlers(): void {

  registerStepHandler('steal_from', async (ctx: StepExecutionContext): Promise<GoalActionResult | null> => {
    const { goal, step, owner, agents } = ctx;
    const baseResult = { goalId: goal.id, goalType: goal.type, ownerId: goal.ownerId, ownerName: owner.profile.name };
    const target = agents.get(step.targetId);
    if (!target || !target.state.alive) {
      goal.currentStep++;
      return { ...baseResult, action: 'steal_from', description: `${owner.profile.name}: target not available` };
    }
    if (owner.state.location !== target.state.location) {
      const maxWait = goal.priority >= 7 ? 3 : goal.priority >= 4 ? 2 : 1;
      goal.waitTicks = (goal.waitTicks ?? 0) + 1;
      if (goal.waitTicks >= maxWait) { goal.currentStep++; goal.waitTicks = 0; return { ...baseResult, action: 'steal_from', description: `${owner.profile.name}: target left` }; }
      return { ...baseResult, action: 'wait', description: `${owner.profile.name} waiting for opportunity` };
    }
    goal.waitTicks = 0;
    await owner.observe(`I stole goods from ${target.profile.name}'s shop. I was desperate — I had no choice. The guilt weighs on me.`, step.importance);
    owner.state.mood = Math.min(1, owner.state.mood + 0.15);
    if (ctx.onCrimeEvent) {
      await ctx.onCrimeEvent({ type: 'GOODS_STOLEN', subject: goal.ownerId, object: step.targetId, location: owner.state.location, importance: step.importance, payload: { thiefName: owner.profile.name, victimName: target.profile.name, victimRole: target.profile.role } });
    }
    goal.currentStep++;
    return { ...baseResult, action: 'steal_from', description: `${owner.profile.name} stole from ${target.profile.name}'s shop`, crimeEvent: { type: 'GOODS_STOLEN', targetId: step.targetId, targetName: target.profile.name } };
  });

  registerStepHandler('attack_npc', async (ctx: StepExecutionContext): Promise<GoalActionResult | null> => {
    const { goal, step, owner, agents } = ctx;
    const baseResult = { goalId: goal.id, goalType: goal.type, ownerId: goal.ownerId, ownerName: owner.profile.name };
    const target = agents.get(step.targetId);
    if (!target || !target.state.alive) { goal.currentStep++; return { ...baseResult, action: 'attack_npc', description: `${owner.profile.name}: target not available` }; }
    if (owner.state.location !== target.state.location) {
      const maxWait = goal.priority >= 7 ? 3 : goal.priority >= 4 ? 2 : 1;
      goal.waitTicks = (goal.waitTicks ?? 0) + 1;
      if (goal.waitTicks >= maxWait) { goal.currentStep++; goal.waitTicks = 0; return { ...baseResult, action: 'attack_npc', description: `${owner.profile.name}: ${target.profile.name} escaped` }; }
      return { ...baseResult, action: 'wait', description: `${owner.profile.name} searching for ${target.profile.name}` };
    }
    goal.waitTicks = 0;
    const isLethal = step.lethal === true;
    const eventType = isLethal ? 'NPC_KILLED' : 'SELF_JUSTICE';
    if (isLethal) {
      target.state.alive = false;
      await owner.observe(`You killed ${target.profile.name}. ${step.reason}. It is done. The weight of what you have done is crushing.`, 10);
      owner.state.mood = Math.max(-1, owner.state.mood - 0.5);
      owner.state.beliefs?.addBelief({ id: crypto.randomUUID(), eventType: 'NPC_KILLED', subject: owner.profile.name, object: target.profile.name, location: target.state.location, confidence: 1.0, source: 'perpetrator', sourceNpcId: null, gameDay: owner.state.currentDay, lastUpdated: owner.state.currentDay });
    } else {
      await owner.observe(`I attacked ${target.profile.name}. ${step.reason}. My hands are shaking — but they deserved it.`, step.importance);
      await target.observe(`${owner.profile.name} attacked me! They were furious, screaming about ${step.reason}. I'm hurt and terrified.`, step.importance);
      owner.state.mood = Math.min(1, owner.state.mood + 0.1);
      target.state.mood = Math.max(-1, target.state.mood - 0.4);
    }
    if (target.state.relationships) { target.state.relationships.adjustSentiment(goal.ownerId, -0.5); target.state.relationships.adjustTrust(goal.ownerId, -0.6); }
    if (owner.state.relationships) { owner.state.relationships.adjustSentiment(step.targetId, -0.2); }
    if (ctx.onCrimeEvent) {
      await ctx.onCrimeEvent({ type: eventType, subject: goal.ownerId, object: step.targetId, location: owner.state.location, importance: isLethal ? 10 : step.importance, payload: isLethal ? { killerName: owner.profile.name, victimName: target.profile.name, victimRole: target.profile.role } : { attackerName: owner.profile.name, victimName: target.profile.name, reason: step.reason } });
    }
    goal.currentStep++;
    return { ...baseResult, action: 'attack_npc', description: isLethal ? `${owner.profile.name} killed ${target.profile.name}` : `${owner.profile.name} attacked ${target.profile.name}`, crimeEvent: { type: eventType, targetId: step.targetId, targetName: target.profile.name } };
  });

  registerStepHandler('arrest_npc', async (ctx: StepExecutionContext): Promise<GoalActionResult | null> => {
    const { goal, step, owner, agents, locations } = ctx;
    const baseResult = { goalId: goal.id, goalType: goal.type, ownerId: goal.ownerId, ownerName: owner.profile.name };
    const target = agents.get(step.targetId);
    if (!target || !target.state.alive) { goal.currentStep++; return { ...baseResult, action: 'arrest_npc', description: `${owner.profile.name}: target not available` }; }
    if (target.state.status) { goal.currentStep++; return { ...baseResult, action: 'arrest_npc', description: `${owner.profile.name}: ${target.profile.name} already ${target.state.status}` }; }
    if (owner.state.location !== target.state.location) {
      const pursuitTicks = (goal.waitTicks ?? 0) + 1;
      goal.waitTicks = pursuitTicks;
      if (pursuitTicks > 10) { goal.currentStep++; goal.waitTicks = 0; return { ...baseResult, action: 'arrest_npc', description: `${owner.profile.name}: lost pursuit` }; }
      const next = nextHop(locations, owner.state.location, target.state.location);
      if (next) { const from = owner.state.location; owner.state.location = next; return { ...baseResult, action: 'move_to', description: `${owner.profile.name} pursuing ${target.profile.name}`, movement: { agentId: goal.ownerId, agentName: owner.profile.name, from, to: next } }; }
      goal.currentStep++; goal.waitTicks = 0; return { ...baseResult, action: 'arrest_npc', description: `${owner.profile.name}: cannot reach ${target.profile.name}` };
    }
    goal.waitTicks = 0;
    target.state.status = 'detained';
    target.state.location = 'Courthouse';
    ctx.goalManager.clearGoals(step.targetId);
    await owner.observe(`I arrested ${target.profile.name} and escorted them to the Courthouse. Justice will be served.`, step.importance);
    await target.observe(`${owner.profile.name} arrested me. I am being held at the Courthouse awaiting judgment.`, step.importance);
    target.state.mood = Math.max(-1, target.state.mood - 0.4);
    if (ctx.onCrimeEvent) {
      await ctx.onCrimeEvent({ type: 'NPC_ARRESTED', subject: goal.ownerId, object: step.targetId, location: owner.state.location, importance: step.importance, payload: { guardName: owner.profile.name, suspectName: target.profile.name, suspectRole: target.profile.role, affectedTargets: Array.from(agents.keys()) } });
    }
    goal.currentStep++;
    return { ...baseResult, action: 'arrest_npc', description: `${owner.profile.name} arrested ${target.profile.name}` };
  });

  registerStepHandler('destroy_evidence', async (ctx: StepExecutionContext): Promise<GoalActionResult | null> => {
    const { goal, step, owner, agents } = ctx;
    const baseResult = { goalId: goal.id, goalType: goal.type, ownerId: goal.ownerId, ownerName: owner.profile.name };
    const destroyed = ctx.evidenceLayer?.destroyAt(owner.state.location, ['trace']) ?? 0;
    await owner.observe(`I destroyed evidence at ${owner.state.location}. ${destroyed > 0 ? `Removed ${destroyed} piece(s).` : 'Nothing to destroy.'} I hope no one saw me.`, step.importance);
    if (ctx.onCrimeEvent) {
      await ctx.onCrimeEvent({ type: 'EVIDENCE_DESTROYED', subject: goal.ownerId, location: owner.state.location, importance: step.importance, payload: { criminalName: owner.profile.name, affectedTargets: Array.from(agents.entries()).filter(([id, a]) => id !== goal.ownerId && a.state.alive && a.state.location === owner.state.location).map(([id]) => id) } });
    }
    goal.currentStep++;
    return { ...baseResult, action: 'destroy_evidence', description: `${owner.profile.name} destroyed evidence` };
  });

  registerStepHandler('flee', async (ctx: StepExecutionContext): Promise<GoalActionResult | null> => {
    const { goal, step, owner, agents } = ctx;
    const baseResult = { goalId: goal.id, goalType: goal.type, ownerId: goal.ownerId, ownerName: owner.profile.name };
    owner.state.status = 'fled';
    await owner.observe(`I fled the town through the gate. I can never return. Everything I had here is gone.`, step.importance);
    owner.state.mood = Math.max(-1, owner.state.mood - 0.3);
    if (ctx.onCrimeEvent) {
      await ctx.onCrimeEvent({ type: 'NPC_FLED', subject: goal.ownerId, location: owner.state.location, importance: step.importance, payload: { fledName: owner.profile.name, fledRole: owner.profile.role, affectedTargets: Array.from(agents.keys()) } });
    }
    goal.state = 'completed';
    goal.currentStep++;
    ctx.goalManager.clearGoals(goal.ownerId);
    return { ...baseResult, action: 'flee', description: `${owner.profile.name} fled the town!` };
  });

  registerStepHandler('examine_scene', async (ctx: StepExecutionContext): Promise<GoalActionResult | null> => {
    const { goal, step, owner, agents } = ctx;
    const baseResult = { goalId: goal.id, goalType: goal.type, ownerId: goal.ownerId, ownerName: owner.profile.name };
    const undiscovered = ctx.evidenceLayer?.getUndiscovered(owner.state.location, goal.ownerId) ?? [];
    if (undiscovered.length === 0) { goal.currentStep++; return { ...baseResult, action: 'examine_scene', description: `${owner.profile.name}: no evidence here` }; }
    const currentDay = goal.createdAtTick ? Math.floor(goal.createdAtTick / 24) + 1 : 1;
    let suspectCount = 0;
    for (const e of undiscovered) {
      ctx.evidenceLayer!.discover(e.id, goal.ownerId);
      if (!e.subjectName || !owner.state.beliefs) continue;
      // addBelief now deduplicates by (eventType, object, source).
      // evidence beliefs coexist with observation/testimony beliefs as separate proof.
      // Multiple evidence pieces about same suspect merge (cumulative physical proof).
      owner.state.beliefs.addBelief({
        id: crypto.randomUUID(),
        eventType: e.eventType,
        subject: e.subjectName,
        object: e.objectName ?? null,
        location: owner.state.location,
        confidence: e.weight,
        source: 'evidence',
        sourceNpcId: null,
        gameDay: currentDay,
        lastUpdated: currentDay,
      });
      suspectCount++;
    }
    const scenes = ctx.crimeScenes?.get(owner.state.location) ?? [];
    const activeScene = scenes.find((s: any) => s.active);
    const victimName = activeScene?.victimId ? agents.get(activeScene.victimId)?.profile.name ?? 'unknown' : 'unknown';
    const crimeLabel = activeScene?.crimeType ? getEventLabel(activeScene.eventType ?? activeScene.crimeType) : 'crime';
    await owner.observe(`I examined the crime scene. ${suspectCount > 0 ? `Found ${suspectCount} suspect(s) in the ${crimeLabel} of ${victimName}.` : `Reinforced suspicions about ${victimName}.`}`, step.importance);
    goal.currentStep++;
    return { ...baseResult, action: 'examine_scene', description: `${owner.profile.name} examined evidence: ${undiscovered.length} clue(s), ${suspectCount} suspect(s)` };
  });

  registerStepHandler('sentence_npc', async (ctx: StepExecutionContext): Promise<GoalActionResult | null> => {
    const { goal, step, owner, agents } = ctx;
    const baseResult = { goalId: goal.id, goalType: goal.type, ownerId: goal.ownerId, ownerName: owner.profile.name };
    const target = agents.get(step.targetId);
    if (!target || target.state.status !== 'detained') { goal.currentStep++; return { ...baseResult, action: 'sentence_npc', description: `${owner.profile.name}: no detained suspect` }; }
    const evidenceSummary = gatherEvidence(target, agents);
    const prompt = `You are ${owner.profile.name}, the town magistrate. ${target.profile.name} the ${target.profile.role} has been arrested and brought before you.\n\nEvidence gathered:\n${evidenceSummary}\n\nBased on this evidence, you must decide:\n- If evidence is strong and clear: sentence to EXILE (banished from town)\n- If evidence is weak or contradictory: RELEASE (freed, insufficient proof)\n\nRespond with exactly one word: EXILE or RELEASE`;
    const response = await owner.generateResponse(prompt, { maxTokens: 10 });
    const firstWord = response.trim().split(/\s+/)[0].toUpperCase().replace(/[^A-Z]/g, '');
    const verdict = firstWord === 'EXILE' ? 'exile' : 'release';
    if (verdict === 'exile') {
      target.state.status = 'exiled';
      ctx.goalManager.clearGoals(step.targetId);
      await owner.observe(`I sentenced ${target.profile.name} to exile. Justice is served.`, step.importance);
      await target.observe(`Magistrate ${owner.profile.name} sentenced me to exile. I must leave.`, step.importance);
      target.state.mood = -1;
    } else {
      target.state.status = undefined;
      await owner.observe(`I released ${target.profile.name}. Insufficient evidence.`, step.importance);
      await target.observe(`Magistrate ${owner.profile.name} released me. I am free.`, step.importance);
      target.state.mood = Math.min(1, target.state.mood + 0.3);
    }
    if (ctx.onCrimeEvent) {
      // Find victim from crime scenes linked to this suspect — needed for CG cascade payload
      let victimName: string | null = null;
      if (ctx.crimeScenes) {
        for (const scenes of ctx.crimeScenes.values()) {
          for (const scene of scenes) {
            if (scene.perpetratorId === step.targetId && scene.victimId) {
              victimName = agents.get(scene.victimId)?.profile.name ?? null;
              break;
            }
          }
          if (victimName) break;
        }
      }
      await ctx.onCrimeEvent({ type: 'NPC_SENTENCED', subject: goal.ownerId, object: step.targetId, location: owner.state.location, importance: step.importance, payload: { judgeName: owner.profile.name, suspectName: target.profile.name, killerName: target.profile.name, victimName, verdict, affectedTargets: Array.from(agents.keys()) } });
    }
    goal.currentStep++;
    return { ...baseResult, action: 'sentence_npc', description: `${owner.profile.name} ${verdict === 'exile' ? 'exiled' : 'released'} ${target.profile.name}` };
  });
}
