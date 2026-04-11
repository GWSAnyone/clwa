import { registerStepHandler, registerTickPhaseHandler, getEventLabel, getBeliefSourceLabel, isFirsthand, nextHop, llmCall, llmSemaphore } from '@clwa/engine';
import type { Agent, StepExecutionContext, LlmJsonSchema, GoalActionResult, Belief, NpcGoal, GoalManager } from '@clwa/engine';
import type { CrimeScene } from '@clwa/engine';

// ─── Module Step Types (typed shapes for engine's generic ModuleStep) ─────
interface StealFromStep { action: 'steal_from'; targetId: string; importance: number; [k: string]: unknown }
interface AttackNpcStep { action: 'attack_npc'; targetId: string; importance: number; lethal: boolean; reason: string; [k: string]: unknown }
interface ArrestNpcStep { action: 'arrest_npc'; targetId: string; importance: number; [k: string]: unknown }
interface DestroyEvidenceStep { action: 'destroy_evidence'; importance: number; [k: string]: unknown }
interface FleeStep { action: 'flee'; importance: number; [k: string]: unknown }
interface ExamineSceneStep { action: 'examine_scene'; importance: number; [k: string]: unknown }
interface SentenceNpcStep { action: 'sentence_npc'; targetId: string; importance: number; [k: string]: unknown }

// ─── Punishment System v2 — Graduated Verdicts ──────────────────

/** Crime severity by event type (module data, not engine) */
const CRIME_SEVERITY: Record<string, number> = {
  GOODS_STOLEN: 4,
  SELF_JUSTICE: 7,
  EVIDENCE_DESTROYED: 5,
  WITNESS_INTIMIDATED: 6,
  NPC_KILLED: 10,
};

interface VerdictOption {
  id: string;
  label: string;
  severityRange: [number, number];
  effects: { status?: string; durationDays?: number; moodShift: number };
  isAcquittal?: boolean;
}

const VERDICT_OPTIONS: VerdictOption[] = [
  { id: 'release', label: 'Acquittal — insufficient evidence', severityRange: [0, 10], effects: { moodShift: 0.3 }, isAcquittal: true },
  { id: 'warning', label: 'Public Warning', severityRange: [1, 4], effects: { moodShift: -0.1 } },
  { id: 'fine', label: 'Heavy Fine', severityRange: [2, 6], effects: { moodShift: -0.2 } },
  { id: 'imprisonment', label: 'Temporary Imprisonment', severityRange: [4, 8], effects: { status: 'imprisoned', durationDays: 2, moodShift: -0.5 } },
  { id: 'exile', label: 'Permanent Exile', severityRange: [6, 10], effects: { status: 'exiled', moodShift: -1.0 } },
];

function getAvailableVerdicts(severity: number): VerdictOption[] {
  return VERDICT_OPTIONS.filter(v => severity >= v.severityRange[0] && severity <= v.severityRange[1]);
}

/** Module-level imprisonment timers: npcId → game day when they should be released */
export const imprisonmentTimers: Map<string, number> = new Map();

/** Gather evidence grouped by quality tier */
function gatherEvidenceGrouped(suspect: Agent, agents: Map<string, Agent>): { strong: string[]; moderate: string[]; weak: string[]; crimeTypes: Set<string> } {
  const strong: string[] = [];
  const moderate: string[] = [];
  const weak: string[] = [];
  const crimeTypes = new Set<string>();
  const suspectName = suspect.profile.name;
  const suspectId = suspect.profile.id;
  const matchesSuspect = (field: string | null | undefined): boolean =>
    !!field && (field === suspectName || field === suspectId);

  for (const [, agent] of agents) {
    if (!agent.state.alive || agent.profile.id === suspectId) continue;
    const beliefs = agent.state.beliefs?.getAllBeliefs() ?? [];
    for (const b of beliefs) {
      if (b.confidence < 0.3 || (!matchesSuspect(b.subject) && !matchesSuspect(b.object))) continue;
      const sourceLabel = getBeliefSourceLabel(b.source);
      const eventLabel = getEventLabel(b.eventType);
      if (!eventLabel) continue;
      const subjectDisplay = b.subject ? (agents.get(b.subject)?.profile.name ?? b.subject) : 'unknown';
      const objectDisplay = b.object ? (agents.get(b.object)?.profile.name ?? b.object) : 'unknown';
      const line = `${agent.profile.name} (${sourceLabel}, ${Math.round(b.confidence * 100)}%): ${subjectDisplay} committed ${eventLabel} against ${objectDisplay}`;

      if (b.eventType) crimeTypes.add(b.eventType);

      if (isFirsthand(b.source) || b.source === 'evidence') {
        strong.push(line);
      } else if (b.source === 'deduction' || b.source === 'interrogation' || b.confidence >= 0.6) {
        moderate.push(line);
      } else {
        weak.push(line);
      }
    }
  }

  return { strong, moderate, weak, crimeTypes };
}

/** Build suspect defense text from H trait + own beliefs */
function buildSuspectDefense(suspect: Agent): string {
  const h = suspect.profile.bigFive?.honesty ?? 0.5;
  const name = suspect.profile.name;

  // Check if suspect actually has perpetrator belief (they KNOW they did it)
  const hasPerpBelief = suspect.state.beliefs?.getAllBeliefs().some(
    (b: Belief) => b.source === 'perpetrator' && b.subject === suspect.profile.id,
  ) ?? false;

  if (!hasPerpBelief) {
    // Genuinely innocent (or doesn't remember) — defense is more convincing
    return `${name} maintains their innocence with steady conviction. They provide clear answers and seem genuinely confused by the accusations. ${h >= 0.6 ? 'Their sincerity is apparent.' : 'Though their manner is rough, nothing suggests deception.'}`;
  }

  // Guilty — H trait determines how well they lie
  if (h >= 0.7) return `${name} appears genuinely remorseful. They lower their eyes and do not deny the accusations directly. Their voice cracks with guilt.`;
  if (h >= 0.4) return `${name} is evasive and uncomfortable. They offer no clear defense but do not confess either. Their answers are vague and contradictory.`;
  return `${name} vehemently denies all charges. They claim innocence with aggressive confidence, dismissing every piece of evidence and blaming others.`;
}

/** Build judge personality context from PM */
function buildJudgeContext(judge: Agent): string {
  const pm = judge.profile.bigFive;
  if (!pm) return '';
  const lines: string[] = [];
  if (pm.conscientiousness >= 0.7) lines.push('Your sense of duty demands order and precedent. The law must be applied consistently.');
  if (pm.agreeableness >= 0.7) lines.push('You see a person before you, not just a criminal. Rehabilitation matters.');
  else if (pm.agreeableness <= 0.3) lines.push('The village needs to see consequences. Leniency invites more crime.');
  if (pm.honesty >= 0.8) lines.push('Truth and fairness are sacred. Punish honestly — neither too much nor too little.');
  if (pm.neuroticism >= 0.6) lines.push('The weight of judgment burdens you. What if you are wrong?');
  return lines.join(' ');
}

/** Build community pressure summary — relationships to suspect AND victim, completed goals */
function buildCommunityPressure(suspect: Agent, victimId: string | null, agents: Map<string, Agent>, goalManager: GoalManager): string {
  const lines: string[] = [];
  const suspectId = suspect.profile.id;

  for (const [id, agent] of agents) {
    if (!agent.state.alive || id === suspectId || agent.profile.isPlayer) continue;

    // Check completed goals related to this case
    const goals = goalManager?.getGoals(id) ?? [];
    const demandedJustice = goals.some((g: NpcGoal) => g.type === 'demand_justice' && g.state === 'completed');
    const testified = goals.some((g: NpcGoal) => g.type === 'testify' && g.state === 'completed');

    // Relationship to victim (friend of victim → wants punishment)
    const relToVictim = victimId ? agent.state.relationships?.getRelationship(victimId) : null;
    const closenessToVictim = relToVictim?.sentiment ?? 0;

    // Relationship to suspect
    const relToSuspect = agent.state.relationships?.getRelationship(suspectId);
    const sentimentToSuspect = relToSuspect?.sentiment ?? 0;

    if (demandedJustice) {
      lines.push(`${agent.profile.name} publicly demanded justice — wants harsh punishment`);
    } else if (testified) {
      lines.push(`${agent.profile.name} testified against the suspect`);
    } else if (closenessToVictim > 0.3) {
      lines.push(`${agent.profile.name} (close to the victim): likely wants punishment`);
    } else if (sentimentToSuspect >= 0.3) {
      lines.push(`${agent.profile.name} (sympathetic to suspect): urges leniency`);
    }
  }

  return lines.length > 0 ? lines.join('\n') : 'No notable community pressure.';
}

/** Check if suspect is guilty (perpetrator of an active crime scene) */
function checkGuilt(suspectId: string, crimeScenes?: Map<string, CrimeScene[]>): boolean {
  if (!crimeScenes) return false;
  for (const scenes of crimeScenes.values()) {
    for (const scene of scenes) {
      if (scene.active && scene.perpetratorId === suspectId) return true;
    }
  }
  return false;
}

/** Evaluate interrogation outcome based on guilt + honesty trait */
function evaluateInterrogationOutcome(owner: Agent, target: Agent, currentDay: number, crimeScenes: Map<string, CrimeScene[]>): void {
  if (!owner.state.beliefs) return;
  const deductionBelief = owner.state.beliefs.getAllBeliefs().find(
    (b: Belief) => b.source === 'deduction' && b.subject === target.profile.id,
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
    const { goal, owner, agents } = ctx;
    const step = ctx.step as StealFromStep;
    const baseResult = { goalId: goal.id, goalType: goal.type, ownerId: goal.ownerId, ownerName: owner.profile.name };
    const target = agents.get(step.targetId);
    if (!target || !target.state.alive) {
      goal.state = 'failed';
      return { ...baseResult, action: 'steal_from', description: `${owner.profile.name}: target not available — steal failed` };
    }
    if (owner.state.location !== target.state.location) {
      const maxWait = goal.priority >= 7 ? 3 : goal.priority >= 4 ? 2 : 1;
      goal.waitTicks = (goal.waitTicks ?? 0) + 1;
      if (goal.waitTicks >= maxWait) { goal.state = 'failed'; goal.waitTicks = 0; return { ...baseResult, action: 'steal_from', description: `${owner.profile.name}: target left — steal failed` }; }
      return { ...baseResult, action: 'wait', description: `${owner.profile.name} waiting for opportunity` };
    }
    goal.waitTicks = 0;
    await owner.observe(`I stole goods from ${target.profile.name}'s shop. I was desperate — I had no choice. The guilt weighs on me.`, step.importance);
    if (ctx.onCrimeEvent) {
      await ctx.onCrimeEvent({ type: 'GOODS_STOLEN', subject: goal.ownerId, object: step.targetId, location: owner.state.location, importance: step.importance, payload: { suspectName: owner.profile.name, victimName: target.profile.name, victimRole: target.profile.role } });
    }
    goal.currentStep++;
    return { ...baseResult, action: 'steal_from', description: `${owner.profile.name} stole from ${target.profile.name}'s shop`, crimeEvent: { type: 'GOODS_STOLEN', targetId: step.targetId, targetName: target.profile.name } };
  });

  registerStepHandler('attack_npc', async (ctx: StepExecutionContext): Promise<GoalActionResult | null> => {
    const { goal, owner, agents } = ctx;
    const step = ctx.step as AttackNpcStep;
    const baseResult = { goalId: goal.id, goalType: goal.type, ownerId: goal.ownerId, ownerName: owner.profile.name };
    const target = agents.get(step.targetId);
    if (!target || !target.state.alive) { goal.state = 'failed'; return { ...baseResult, action: 'attack_npc', description: `${owner.profile.name}: target not available — attack failed` }; }
    if (owner.state.location !== target.state.location) {
      const maxWait = goal.priority >= 7 ? 3 : goal.priority >= 4 ? 2 : 1;
      goal.waitTicks = (goal.waitTicks ?? 0) + 1;
      if (goal.waitTicks >= maxWait) { goal.state = 'failed'; goal.waitTicks = 0; return { ...baseResult, action: 'attack_npc', description: `${owner.profile.name}: ${target.profile.name} escaped — attack failed` }; }
      return { ...baseResult, action: 'wait', description: `${owner.profile.name} searching for ${target.profile.name}` };
    }
    goal.waitTicks = 0;
    const isLethal = step.lethal === true;
    const eventType = isLethal ? 'NPC_KILLED' : 'SELF_JUSTICE';
    if (isLethal) {
      target.state.alive = false;
      await owner.observe(`You killed ${target.profile.name}. ${step.reason}. It is done. The weight of what you have done is crushing.`, 10);
      ctx.addMoodModifier(goal.ownerId, { source: 'murder_committed', category: 'event', magnitude: -0.5, remaining: 1440, duration: 1440, decay: 'exponential' });
      owner.state.beliefs?.addBelief({ id: crypto.randomUUID(), eventType: 'NPC_KILLED', subject: goal.ownerId, object: step.targetId, location: target.state.location, confidence: 1.0, source: 'perpetrator', sourceNpcId: null, gameDay: owner.state.currentDay, lastUpdated: owner.state.currentDay });
    } else {
      await owner.observe(`I attacked ${target.profile.name}. ${step.reason}. My hands are shaking — but they deserved it.`, step.importance);
      await target.observe(`${owner.profile.name} attacked me! They were furious, screaming about ${step.reason}. I'm hurt and terrified.`, step.importance);
      ctx.addMoodModifier(step.targetId, { source: 'attack_victim', category: 'event', magnitude: -0.4, remaining: 1440, duration: 1440, decay: 'exponential' });
    }
    if (target.state.relationships) { target.state.relationships.adjustSentiment(goal.ownerId, -0.5); target.state.relationships.adjustTrust(goal.ownerId, -0.6); }
    if (owner.state.relationships) { owner.state.relationships.adjustSentiment(step.targetId, -0.2); }
    if (ctx.onCrimeEvent) {
      await ctx.onCrimeEvent({ type: eventType, subject: goal.ownerId, object: step.targetId, location: owner.state.location, importance: isLethal ? 10 : step.importance, payload: isLethal ? { suspectName: owner.profile.name, victimName: target.profile.name, victimRole: target.profile.role } : { attackerName: owner.profile.name, victimName: target.profile.name, reason: step.reason } });
    }
    goal.currentStep++;
    return { ...baseResult, action: 'attack_npc', description: isLethal ? `${owner.profile.name} killed ${target.profile.name}` : `${owner.profile.name} attacked ${target.profile.name}`, crimeEvent: { type: eventType, targetId: step.targetId, targetName: target.profile.name } };
  });

  registerStepHandler('arrest_npc', async (ctx: StepExecutionContext): Promise<GoalActionResult | null> => {
    const { goal, owner, agents, locations } = ctx;
    const step = ctx.step as ArrestNpcStep;
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
    // Resolve courthouse location ID from graph (never hardcode display names)
    let courthouseId = 'courthouse';
    for (const [id, loc] of locations) {
      if (id === 'courthouse' || loc.name === 'Courthouse') { courthouseId = id; break; }
    }
    target.state.location = courthouseId;
    ctx.goalManager.clearGoals(step.targetId);
    await owner.observe(`I arrested ${target.profile.name} and escorted them to the Courthouse. Justice will be served.`, step.importance);
    await target.observe(`${owner.profile.name} arrested me. I am being held at the Courthouse awaiting judgment.`, step.importance);
    ctx.addMoodModifier(step.targetId, { source: 'arrest_shock', category: 'event', magnitude: -0.4, remaining: 720, duration: 720, decay: 'exponential' });
    if (ctx.onCrimeEvent) {
      await ctx.onCrimeEvent({ type: 'NPC_ARRESTED', subject: goal.ownerId, object: step.targetId, location: owner.state.location, importance: step.importance, payload: { guardName: owner.profile.name, suspectName: target.profile.name, suspectRole: target.profile.role, affectedTargets: Array.from(agents.keys()) } });
    }
    goal.currentStep++;
    return { ...baseResult, action: 'arrest_npc', description: `${owner.profile.name} arrested ${target.profile.name}` };
  });

  registerStepHandler('destroy_evidence', async (ctx: StepExecutionContext): Promise<GoalActionResult | null> => {
    const { goal, owner, agents } = ctx;
    const step = ctx.step as DestroyEvidenceStep;
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
    const { goal, owner, agents } = ctx;
    const step = ctx.step as FleeStep;
    const baseResult = { goalId: goal.id, goalType: goal.type, ownerId: goal.ownerId, ownerName: owner.profile.name };
    owner.state.status = 'fled';
    await owner.observe(`I fled the town through the gate. I can never return. Everything I had here is gone.`, step.importance);
    ctx.addMoodModifier(goal.ownerId, { source: 'fled_town', category: 'event', magnitude: -0.3, remaining: 1440, duration: 1440, decay: 'exponential' });
    if (ctx.onCrimeEvent) {
      await ctx.onCrimeEvent({ type: 'NPC_FLED', subject: goal.ownerId, location: owner.state.location, importance: step.importance, payload: { fledName: owner.profile.name, fledRole: owner.profile.role, affectedTargets: Array.from(agents.keys()) } });
    }
    goal.state = 'completed';
    goal.currentStep++;
    ctx.goalManager.clearGoals(goal.ownerId);
    return { ...baseResult, action: 'flee', description: `${owner.profile.name} fled the town!` };
  });

  registerStepHandler('examine_scene', async (ctx: StepExecutionContext): Promise<GoalActionResult | null> => {
    const { goal, owner, agents } = ctx;
    const step = ctx.step as ExamineSceneStep;
    const baseResult = { goalId: goal.id, goalType: goal.type, ownerId: goal.ownerId, ownerName: owner.profile.name };
    const undiscovered = ctx.evidenceLayer?.getUndiscovered(owner.state.location, goal.ownerId) ?? [];
    if (undiscovered.length === 0) { goal.currentStep++; return { ...baseResult, action: 'examine_scene', description: `${owner.profile.name}: no evidence here` }; }
    const currentDay = goal.createdAtMinute ? Math.floor(goal.createdAtMinute / 1440) + 1 : 1;
    let suspectCount = 0;
    for (const e of undiscovered) {
      ctx.evidenceLayer?.discover(e.id, goal.ownerId);
      if (!e.subjectName || !owner.state.beliefs) continue;
      // addBelief now deduplicates by (eventType, object, source).
      // evidence beliefs coexist with observation/testimony beliefs as separate proof.
      // Multiple evidence pieces about same suspect merge (cumulative physical proof).
      owner.state.beliefs.addBelief({
        id: crypto.randomUUID(),
        eventType: e.eventType,
        subject: e.subjectName,
        object: e.objectName ?? '',
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
    const activeScene = scenes.find((s: CrimeScene) => s.active);
    const victimName = activeScene?.victimId ? agents.get(activeScene.victimId)?.profile.name ?? 'unknown' : 'unknown';
    const crimeLabel = activeScene?.crimeType ? (getEventLabel(activeScene.eventType ?? activeScene.crimeType) ?? 'crime') : 'crime';
    await owner.observe(`I examined the crime scene. ${suspectCount > 0 ? `Found ${suspectCount} suspect(s) in the ${crimeLabel} of ${victimName}.` : `Reinforced suspicions about ${victimName}.`}`, step.importance);
    goal.currentStep++;
    return { ...baseResult, action: 'examine_scene', description: `${owner.profile.name} examined evidence: ${undiscovered.length} clue(s), ${suspectCount} suspect(s)` };
  });

  registerStepHandler('sentence_npc', async (ctx: StepExecutionContext): Promise<GoalActionResult | null> => {
    const { goal, owner, agents } = ctx;
    const step = ctx.step as SentenceNpcStep;
    const baseResult = { goalId: goal.id, goalType: goal.type, ownerId: goal.ownerId, ownerName: owner.profile.name };
    const target = agents.get(step.targetId as string);
    if (!target || target.state.status !== 'detained') { goal.currentStep++; return { ...baseResult, action: 'sentence_npc', description: `${owner.profile.name}: no detained suspect` }; }

    // 1. Determine crime severity from crime scenes, fallback to beliefs
    let crimeSeverity = 3; // conservative fallback
    let victimName: string | null = null;
    let victimId: string | null = null;
    let crimeEventType: string | null = null;
    if (ctx.crimeScenes) {
      for (const scenes of ctx.crimeScenes.values()) {
        for (const scene of scenes) {
          if (scene.perpetratorId === step.targetId && scene.active !== false) {
            crimeEventType = scene.eventType ?? scene.crimeType ?? null;
            if (crimeEventType && CRIME_SEVERITY[crimeEventType]) {
              crimeSeverity = CRIME_SEVERITY[crimeEventType];
            }
            victimId = scene.victimId ?? null;
            if (victimId) {
              victimName = agents.get(victimId)?.profile.name ?? null;
            }
            break;
          }
        }
        if (crimeEventType) break;
      }
    }
    // Fallback: if no crime scene found, infer severity from evidence beliefs
    if (!crimeEventType) {
      const evidence = gatherEvidenceGrouped(target, agents);
      for (const et of evidence.crimeTypes) {
        if (CRIME_SEVERITY[et] && CRIME_SEVERITY[et] > crimeSeverity) {
          crimeSeverity = CRIME_SEVERITY[et];
          crimeEventType = et;
        }
      }
    }

    // 2. Get available verdicts for this crime severity
    const available = getAvailableVerdicts(crimeSeverity);
    const verdictIds = available.map(v => v.id);
    const verdictDescriptions = available.map(v => `${v.id}: ${v.label}`).join('\n');

    // 3. Gather evidence grouped by quality
    const evidence = gatherEvidenceGrouped(target, agents);
    const evidenceLines: string[] = [];
    if (evidence.strong.length > 0) evidenceLines.push(`STRONG EVIDENCE (direct witness, physical proof):\n${evidence.strong.map(l => `  • ${l}`).join('\n')}`);
    if (evidence.moderate.length > 0) evidenceLines.push(`MODERATE EVIDENCE (deduction, interrogation):\n${evidence.moderate.map(l => `  • ${l}`).join('\n')}`);
    if (evidence.weak.length > 0) evidenceLines.push(`WEAK EVIDENCE (rumors, hearsay):\n${evidence.weak.map(l => `  • ${l}`).join('\n')}`);
    const evidenceSummary = evidenceLines.length > 0 ? evidenceLines.join('\n\n') : 'No evidence gathered against this suspect.';
    const totalEvidence = evidence.strong.length + evidence.moderate.length + evidence.weak.length;

    // 4. Suspect defense (H trait)
    const suspectDefense = buildSuspectDefense(target);

    // 5. Community pressure (relationships to victim + completed goals)
    const communityPressure = buildCommunityPressure(target, victimId, agents, ctx.goalManager);

    // 6. Judge personality context
    const judgeContext = buildJudgeContext(owner);

    // 7. Build prompt + structured output
    const crimeLabel = crimeEventType ? (getEventLabel(crimeEventType) ?? 'crime') : 'crime';
    const system = `You are ${owner.profile.name}, the town magistrate. You must deliver a just verdict.\n${judgeContext}`;
    const user = [
      `${target.profile.name} the ${target.profile.role} stands accused of ${crimeLabel}${victimName ? ` against ${victimName}` : ''}.`,
      `Crime severity: ${crimeSeverity}/10.`,
      ``,
      evidenceSummary,
      ``,
      `SUSPECT'S DEFENSE:`,
      suspectDefense,
      ``,
      `COMMUNITY:`,
      communityPressure,
      ``,
      `AVAILABLE VERDICTS (choose one appropriate to evidence strength and crime severity):`,
      verdictDescriptions,
      ``,
      `Consider: strong evidence + severe crime → harsher verdict. Weak evidence → acquittal. Moderate crime → proportionate response.`,
    ].join('\n');

    const verdictSchema: LlmJsonSchema = {
      name: 'verdict_decision',
      strict: true,
      schema: {
        type: 'object',
        properties: {
          verdict: { type: 'string', enum: verdictIds },
          reasoning: { type: 'string' },
        },
        required: ['verdict', 'reasoning'],
        additionalProperties: false,
      },
    };

    // 8. LLM call with structured output (retry once on failure)
    let chosenVerdict = 'release';
    let reasoning = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      await llmSemaphore.acquire();
      try {
        const content = await llmCall({ system, user, temperature: 0.4, maxTokens: attempt === 0 ? 200 : 300, jsonSchema: verdictSchema });
        if (content) {
          try {
            const parsed = JSON.parse(content);
            if (verdictIds.includes(parsed.verdict)) {
              chosenVerdict = parsed.verdict;
              reasoning = parsed.reasoning ?? '';
              break;
            }
          } catch { /* retry */ }
        }
      } finally {
        llmSemaphore.release();
      }
      if (attempt === 0) console.warn(`[Verdict] Attempt 1 failed for ${target.profile.name}, retrying with higher maxTokens`);
    }
    if (chosenVerdict === 'release' && reasoning === '') {
      console.warn(`[Verdict:ERROR] Both attempts failed for ${target.profile.name}, fallback=release`);
    }

    // 9. Apply verdict effects
    const verdictDef = available.find(v => v.id === chosenVerdict) ?? available[0];
    const verdictLabel = verdictDef.label;
    console.log(`  [Verdict] ${owner.profile.name} → ${target.profile.name}: ${chosenVerdict} (severity ${crimeSeverity}, evidence ${totalEvidence}). ${reasoning}`);

    if (chosenVerdict === 'exile') {
      target.state.status = 'exiled';
      ctx.goalManager.clearGoals(step.targetId as string);
      await owner.observe(`I sentenced ${target.profile.name} to permanent exile. ${reasoning}`, step.importance as number);
      await target.observe(`Magistrate ${owner.profile.name} banished me from the village forever. ${reasoning}`, step.importance as number);
      ctx.addMoodModifier(step.targetId as string, { source: 'sentence_exile', category: 'event', magnitude: -2.0, remaining: 1440, duration: 1440, decay: 'exponential' });
    } else if (chosenVerdict === 'imprisonment') {
      target.state.status = 'imprisoned';
      const durationDays = verdictDef.effects.durationDays ?? 2;
      const sentenceDay = owner.state.currentDay;
      const releaseDay = sentenceDay + durationDays;
      imprisonmentTimers.set(target.profile.id, releaseDay);
      await owner.observe(`I sentenced ${target.profile.name} to ${durationDays} days of imprisonment. ${reasoning}`, step.importance as number);
      await target.observe(`Magistrate ${owner.profile.name} sentenced me to ${durationDays} days of imprisonment. I must serve my time.`, step.importance as number);
      ctx.addMoodModifier(step.targetId as string, { source: 'sentence_imprisonment', category: 'event', magnitude: verdictDef.effects.moodShift, remaining: 720, duration: 720, decay: 'exponential' });
    } else if (chosenVerdict === 'release') {
      target.state.status = undefined as unknown as string;
      await owner.observe(`I released ${target.profile.name}. ${reasoning}`, step.importance as number);
      await target.observe(`Magistrate ${owner.profile.name} released me. I am free.`, step.importance as number);
      ctx.addMoodModifier(step.targetId as string, { source: 'sentence_release', category: 'event', magnitude: 0.3, remaining: 720, duration: 720, decay: 'exponential' });
    } else {
      // warning, fine — NPC is freed but punished. Social stigma remains.
      target.state.status = undefined as unknown as string;
      await owner.observe(`I gave ${target.profile.name} a ${verdictLabel.toLowerCase()}. ${reasoning}`, step.importance as number);
      await target.observe(`Magistrate ${owner.profile.name} sentenced me: ${verdictLabel.toLowerCase()}. The shame is public. ${reasoning}`, step.importance as number);
      ctx.addMoodModifier(step.targetId as string, { source: 'sentence_reaction', category: 'event', magnitude: verdictDef.effects.moodShift, remaining: 720, duration: 720, decay: 'exponential' });
      // Victim reaction: mild punishments may frustrate the victim
      if (victimId) {
        const victim = agents.get(victimId);
        if (victim?.state.alive) {
          victim.state.relationships?.adjustSentiment(step.targetId as string, -0.1);
          if (chosenVerdict === 'warning') {
            ctx.addMoodModifier(victimId as string, { source: 'verdict_frustration', category: 'pressure', magnitude: -0.1, remaining: 240, duration: 240, decay: 'linear' });
          }
        }
      }
    }

    if (ctx.onCrimeEvent) {
      await ctx.onCrimeEvent({
        type: 'NPC_SENTENCED', subject: goal.ownerId, object: step.targetId as string,
        location: owner.state.location, importance: step.importance as number,
        payload: {
          judgeName: owner.profile.name, suspectName: target.profile.name,
          victimName, verdict: chosenVerdict, verdictLabel, reasoning,
          crimeSeverity, evidenceCount: totalEvidence,
          releaseDay: chosenVerdict === 'imprisonment' ? imprisonmentTimers.get(target.profile.id) : undefined,
          affectedTargets: Array.from(agents.keys()),
        },
      });
    }
    goal.currentStep++;
    return { ...baseResult, action: 'sentence_npc', description: `${owner.profile.name} sentenced ${target.profile.name}: ${verdictLabel}` };
  });
}
