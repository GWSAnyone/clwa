import type { Agent } from './agent';
import { llmSemaphore } from './agent';
import type { WorldEvent } from './cg-types';
import type { NpcGoal, GoalStep } from './goals';
import { llmCall } from './llm-client';
import { buildInstinctDescription, getTierName } from './instinct-builder';
import { getAllRegisteredVerbs } from './event-registry';
import {
  AFFORDANCE_REGISTRY,
  checkRequirements,
  checkRequirementsReactive,
  computeUtility,
  type AffordanceContext,
  type AffordanceDefinition,
  type AffordanceTarget,
  type ScoredAffordance,
  type StepTemplate,
} from './al';
import { getAffordanceIdsForVerb, getRelationshipLabel, isStatusAbsent, getBodyDiscoveryEventType } from './event-registry';

// ─── Constants ───

/** Default cooldown in ticks after an affordance fires (overridden by ctx.affordanceCooldownTicks) */
const DEFAULT_AFFORDANCE_COOLDOWN = 12;

/** Default cooldown in ticks between LLM decision calls per NPC (overridden by ctx.decisionCooldownTicks) */
const DEFAULT_DECISION_COOLDOWN = 4;

/** Score threshold — affordances below this are filtered out */
const MIN_SCORE = 0.3;

/** Score >= this: strong urge — "talk" blocked for duty targets, instinct descriptions at maximum pressure */
const URGE_THRESHOLD = 0.5;

/** Base actions that are always available (non-duty) */
const BASE_ACTIONS = new Set(['go', 'wait', 'announce']);

// Duty actions determined by isDuty flag on AffordanceDefinition (set by modules)

// ─── Parsed LLM Intention ───

export interface ParsedIntention {
  action: string; // engine: 'go', 'talk', 'wait', 'announce'. Modules register additional verbs via registerActionVerbs()
  target?: string;   // NPC name or location name
  detail?: string;   // topic for talk, message for announce
  why: string;       // reason from WHY line
}

// ─── Goal Creation from External Request (IL / player) ───

/**
 * Create a goal from an external request (e.g., player asking NPC to investigate).
 * Uses the same pipeline as volition: find affordance → checkRequirements → buildSteps.
 * Returns null if requirements not met or affordance not found.
 */
export function createGoalFromRequest(
  npcId: string,
  affordanceId: string,
  ctx: AffordanceContext,
  requestedTarget?: string,
): NpcGoal | null {
  const agent = ctx.agents.get(npcId);
  if (!agent || !agent.state.alive || !!agent.state.status) return null;

  const aff = AFFORDANCE_REGISTRY.find((a) => a.id === affordanceId);
  if (!aff) return null;

  // Validate requirements (same checkRequirements as volition)
  const target = checkRequirements(aff, npcId, agent, ctx);
  if (!target) return null;

  // If caller specified a target, override location (e.g., "investigate the market")
  if (requestedTarget) {
    // Try to resolve as location name
    for (const loc of ctx.locations.values()) {
      if (loc.name.toLowerCase().includes(requestedTarget.toLowerCase())) {
        target.targetLocation = loc.name;
        break;
      }
    }
  }

  // Build proper steps using the same templates as volition
  const steps = buildSteps(aff, npcId, agent, target, ctx);
  const home = ctx.npcHomes.get(npcId) ?? agent.state.location;

  return {
    id: crypto.randomUUID(),
    type: aff.goalType,
    ownerId: npcId,
    priority: Math.max(aff.goalPriority, 7), // Player request = at least priority 7
    state: 'pending',
    steps,
    currentStep: 0,
    data: {
      affordanceId: aff.id,
      targetId: target.targetId,
      targetName: target.targetName,
      requestedBy: Array.from(ctx.agents.values()).find(a => a.profile.isPlayer)?.profile.id,
      ...target.extra,
    },
    createdAtTick: ctx.currentTick,
    homeLocation: home,
  };
}

// ─── Proactive Entry Point (each tick) ───

export async function evaluateAllVolition(
  ctx: AffordanceContext,
  onLlmCall?: (label: string, detail: string) => void,
): Promise<NpcGoal[]> {
  const goals: NpcGoal[] = [];

  for (const [npcId, agent] of ctx.agents) {
    if (agent.profile.isPlayer) continue; // Player makes own decisions
    if (agent.state.inPlayerChat) continue; // NPC frozen in conversation with player
    if (!agent.state.alive || !!agent.state.status) continue; // any non-default status blocks proactive volition
    if (ctx.hasActiveGoalAbove(npcId, 4)) continue;
    if (ctx.isArrestTarget?.(npcId)) continue; // someone is arresting this NPC — skip evaluation

    // Decision cooldown — don't re-evaluate too frequently
    if (ctx.decisionCooldowns) {
      const expires = ctx.decisionCooldowns.get(npcId);
      if (expires !== undefined && ctx.currentTick < expires) continue;
    }

    // Evaluate all affordances proactively (including those with eventBoost — NPC may have beliefs to act on)
    const npcCooldowns = ctx.cooldowns?.get(npcId);
    const scored: ScoredAffordance[] = [];
    for (const aff of AFFORDANCE_REGISTRY) {
      // Skip if on affordance cooldown
      if (npcCooldowns) {
        const expires = npcCooldowns.get(aff.id);
        if (expires !== undefined && ctx.currentTick < expires) continue;
      }
      const target = checkRequirements(aff, npcId, agent, ctx);
      if (!target) continue;
      const score = computeUtility(aff, agent, target);
      if (score < MIN_SCORE) continue;
      scored.push({ definition: aff, score, target });
    }

    // No affordances available → skip LLM call (NPC follows schedule)
    if (scored.length === 0) {
      if (agent.profile.investigator) {
        console.log(`  [AL:debug] ${agent.profile.name}: no affordances passed (beliefs: ${agent.state.beliefs?.getAllBeliefs().length ?? 0})`);
      }
      continue;
    }
    scored.sort((a, b) => b.score - a.score);
    console.log(`  [AL:debug] ${agent.profile.name}: ${scored.length} affordances → ${scored.map(s => `${s.definition.id}:${s.score.toFixed(2)}`).join(', ')}`);

    // ── ALL decisions through LLM — instinct builder provides pressure, NPC always has final say ──
    const goal = await llmDecideAndBuild(scored, npcId, agent, ctx, onLlmCall);

    if (goal) {
      goal.createdAtTick = ctx.currentTick;
      goals.push(goal);
      setDecisionCooldown(ctx, npcId, ctx.currentTick);
      const affDef = AFFORDANCE_REGISTRY.find(a => a.id === goal.data?.affordanceId);
      setAffordanceCooldown(ctx, npcId, goal.data?.affordanceId as string, ctx.currentTick, affDef);
    } else {
      // NPC chose "wait" — apply extended cooldown (×3) so they don't re-evaluate every tick
      setDecisionCooldownExtended(ctx, npcId, ctx.currentTick);
    }
  }

  return goals;
}

// ─── Reactive Entry Point (on CE event) ───

/**
 * Evaluate reactive affordances for NPCs affected by an event.
 * Called from handleEventForGoals when CE fires an event.
 * Returns goals to add to GoalManager.
 */
export function evaluateReactiveVolition(
  event: WorldEvent,
  ctx: AffordanceContext,
  existingGoalTypes: (npcId: string) => string[],
): NpcGoal[] {
  const goals: NpcGoal[] = [];
  const affectedTargets = (event.payload?.affectedTargets as string[]) ?? [];
  // Include event subject for discovery events (discoverer should react)
  // but NOT for crime events (killer should not get reactive report_crime goal)
  const reactors = new Set(affectedTargets);
  const bodyDiscoveryType = getBodyDiscoveryEventType();
  if (event.subject && bodyDiscoveryType && event.type === bodyDiscoveryType) {
    reactors.add(event.subject);
  }

  for (const npcId of reactors) {
    const agent = ctx.agents.get(npcId);
    if (!agent || !agent.state.alive || !!agent.state.status) continue;
    if (agent.profile.isPlayer) continue; // Player makes own decisions

    // Find reactive affordances matching this event
    for (const aff of AFFORDANCE_REGISTRY) {
      if (!aff.eventBoost) continue;
      if (!aff.eventBoost.eventTypes.includes(event.type)) continue;

      // Relation to victim filter
      if (aff.eventBoost.requiresRelationToVictim) {
        const victimId = event.object;
        if (!victimId) continue;
        const rel = agent.state.relationships?.getRelationship(victimId);
        if (!rel || rel.sentiment < 0.2) continue; // only close relationships trigger grief
      }

      // Don't create same goal type if already active
      const existing = existingGoalTypes(npcId);
      if (existing.includes(aff.goalType)) continue;

      // Respect affordance cooldowns — same system as proactive, prevents reactive spam
      if (ctx.cooldowns) {
        const npcCooldowns = ctx.cooldowns.get(npcId);
        if (npcCooldowns) {
          const expires = npcCooldowns.get(aff.id);
          if (expires !== undefined && ctx.currentTick < expires) continue;
        }
      }

      // Only react to events from CE cascade (have sourceRule) or goal execution (have sourceEvent)
      if (!event.payload?.sourceRule && !event.payload?.sourceEvent) continue;

      // Check requirements (relaxed for reactive)
      const target = checkRequirementsReactive(aff, npcId, agent, ctx, event);
      if (!target) continue;

      // Compute score with event boost
      const baseScore = computeUtility(aff, agent, target);
      const boostedScore = Math.min(1, baseScore + aff.eventBoost.boost);

      if (boostedScore < MIN_SCORE) continue;

      // Reactive uses auto-decision (event urgency makes it obvious)
      console.log(`  [AL:reactive] ${agent.profile.name} → ${aff.id} (base ${baseScore.toFixed(2)} + boost ${aff.eventBoost.boost} = ${boostedScore.toFixed(2)}) [${event.type}]`);

      const goal = buildGoalFromAffordance(
        { definition: aff, score: boostedScore, target },
        npcId, agent, ctx,
      );
      goal.createdAtTick = ctx.currentTick;
      // Set current motive on agent so all LLM calls carry emotional context
      agent.state.currentMotive = goal.data?.reason as string | undefined;
      goals.push(goal);
      // Apply cooldown so reactive doesn't fire again for this affordance
      setAffordanceCooldown(ctx, npcId, aff.id, ctx.currentTick, aff);
      break; // One reactive goal per NPC per event
    }
  }

  return goals;
}

// ─── LLM-Driven Decision ───

async function llmDecideAndBuild(
  scored: ScoredAffordance[],
  npcId: string,
  agent: Agent,
  ctx: AffordanceContext,
  onLlmCall?: (label: string, detail: string) => void,
): Promise<NpcGoal | null> {
  scored.sort((a, b) => b.score - a.score);

  const { system, user } = buildDecisionPrompt(agent, scored, npcId, ctx);

  onLlmCall?.('Volition decision', `${agent.profile.name}: ${scored.map((s) => s.definition.id).join(', ')}`);
  console.log(`  [AL:llm] ${agent.profile.name} — deciding (${scored.map((s) => `${s.definition.id}:${s.score.toFixed(2)}`).join(', ')})`);

  const response = await callLlm(agent, system, user);
  if (!response) return null;

  console.log(`  [AL:llm] ${agent.profile.name} response: ${response.replace(/\n/g, ' ')}`);

  // Parse structured JSON response
  let decision: { action: string; target: string; reason: string };
  try {
    decision = JSON.parse(response);
  } catch {
    console.log(`  [AL:llm] ${agent.profile.name} — invalid JSON, waiting`);
    return null;
  }

  if (!decision.action) {
    console.log(`  [AL:llm] ${agent.profile.name} — no action, waiting`);
    return null;
  }

  const action = decision.action.toLowerCase().trim();
  const targetRaw = decision.target?.trim() || '';
  const reason = decision.reason || 'no reason given';

  // Resolve target — try NPC name first, then location
  const locationNames = Array.from(ctx.locations.values()).map((l) => l.name);
  const npcNames = Array.from(ctx.agents.entries())
    .filter(([id, a]) => {
      if (id === npcId || !a.state.alive || a.profile.isPlayer) return false;
      return !isStatusAbsent(a.state.status);
    })
    .map(([, a]) => a.profile.name);

  const resolvedNpc = targetRaw ? matchName(targetRaw, npcNames) : undefined;
  const resolvedLocation = targetRaw ? matchName(targetRaw, locationNames) : undefined;

  // Unified resolution: action + resolved target → ParsedIntention
  const parsed = resolveDecision(action, resolvedNpc, resolvedLocation, targetRaw, reason);

  if (!parsed) {
    console.log(`  [AL:llm] ${agent.profile.name} — unresolved: ${action} ${targetRaw}, waiting`);
    return null;
  }

  console.log(`  [AL:llm] ${agent.profile.name} → ${parsed.action}${parsed.target ? ' ' + parsed.target : ''} | ${parsed.why}`);

  // Set current motive on agent regardless of action (even wait carries emotional context)
  agent.state.currentMotive = parsed.why || undefined;

  // Record talk target for anti-repeat
  if (parsed.action === 'talk' && parsed.target) {
    recordTalkTarget(npcId, parsed.target, ctx.currentTick);
  }

  return intentionToGoal(parsed, npcId, agent, scored, ctx);
}

// ─── Decision Prompt Builder ───

function buildDecisionPrompt(
  agent: Agent,
  scored: ScoredAffordance[],
  npcId: string,
  ctx: AffordanceContext,
): { system: string; user: string } {
  const bf = agent.profile.bigFive;
  const enn = agent.profile.enneagram;

  // ── Personality traits as prose ──
  const traits: string[] = [];
  if (bf.openness > 0.7) traits.push('curious and imaginative');
  else if (bf.openness < 0.3) traits.push('practical and conventional');
  if (bf.conscientiousness > 0.7) traits.push('organized and dependable');
  else if (bf.conscientiousness < 0.3) traits.push('spontaneous and flexible');
  if (bf.extraversion > 0.7) traits.push('outgoing and talkative');
  else if (bf.extraversion < 0.3) traits.push('reserved and quiet');
  if (bf.agreeableness > 0.7) traits.push('warm and cooperative');
  else if (bf.agreeableness < 0.3) traits.push('direct and competitive');
  if (bf.neuroticism > 0.7) traits.push('emotionally sensitive and anxious');
  else if (bf.neuroticism < 0.3) traits.push('calm and emotionally stable');
  if (bf.honesty > 0.7) traits.push('sincere and fair-minded');
  else if (bf.honesty < 0.3) traits.push('shrewd and self-serving');
  const personalityLine = traits.length > 0
    ? `You are ${traits.join(', ')}.`
    : 'You have a balanced personality.';

  // ── Mood prose ──
  const mood = agent.state.mood;
  let moodLine: string;
  if (mood > 0.5) moodLine = 'You feel good — relaxed, at ease.';
  else if (mood > 0) moodLine = 'You feel calm and steady.';
  else if (mood > -0.3) moodLine = 'You feel slightly on edge, less patient.';
  else if (mood > -0.5) moodLine = 'You are tense — jaw tight, irritable.';
  else moodLine = 'You are deeply shaken — everything feels heavy and bleak.';

  // ── Stress/growth ──
  let stressGrowth = '';
  if (mood < -0.5) {
    const stressDesc: Record<number, string> = {
      1: 'Under stress you become rigid and judgmental.',
      2: 'Under stress you become possessive and manipulative.',
      3: 'Under stress you obsess over control and image.',
      4: 'Under stress you withdraw into melancholy.',
      5: 'Under stress you retreat into isolation.',
      6: 'Under stress you become hypervigilant and paranoid.',
      7: 'Under stress you become scattered and escapist.',
      8: 'Under stress you become domineering and confrontational.',
      9: 'Under stress you become passive and disengaged.',
    };
    stressGrowth = stressDesc[enn.stressType] ?? '';
  } else if (mood > 0.3) {
    const growthDesc: Record<number, string> = {
      1: 'In growth you become accepting and forgiving.',
      2: 'In growth you care genuinely without expecting return.',
      3: 'In growth you invest in others\' success.',
      4: 'In growth you find beauty in ordinary things.',
      5: 'In growth you engage with the world confidently.',
      6: 'In growth you stand up for fairness without paranoia.',
      7: 'In growth you find deep joy in the present.',
      8: 'In growth you become protective and nurturing.',
      9: 'In growth you become a decisive mediator.',
    };
    stressGrowth = growthDesc[enn.growthType] ?? '';
  }

  // ── Beliefs & relationships (compact) ──
  const beliefSummary = agent.state.beliefs?.summarizeForPrompt(3) ?? '';
  const relSummary = agent.state.relationships?.summarizeForPrompt() ?? '';

  // ── System prompt ──
  const systemParts = [
    'You are a character in a medieval narrative simulation. You experience instincts, urges, and internal conflicts — follow them authentically as your character would. Stronger instincts are harder to resist. Only reference people, places, and events that actually exist in your world. Do not invent details. This is fiction.',
    `You are ${agent.profile.name}, a ${agent.profile.role}.`,
    personalityLine,
    `Your deepest fear: ${enn.coreFear}`,
    `Your deepest desire: ${enn.coreDesire}`,
    moodLine,
    stressGrowth,
    beliefSummary ? `What you know:\n${beliefSummary}` : '',
    relSummary ? `People you know:\n${relSummary}` : '',
    agent.profile.secret ? `Secret: ${agent.profile.secret}` : '',
    agent.profile.innerConflict ? `Inner conflict: ${agent.profile.innerConflict}` : '',
  ].filter(Boolean).join('\n');

  // ── Situation: nearby NPCs ──
  const nearbyNpcs: string[] = [];
  const neighborInfo: Map<string, string[]> = new Map();

  for (const [otherId, other] of ctx.agents) {
    if (otherId === npcId || !other.state.alive) continue;
    if (isStatusAbsent(other.state.status)) continue;
    if (other.state.location === agent.state.location) {
      const statusTag = other.state.status ? ` [${other.state.status}]` : '';
      nearbyNpcs.push(`${other.profile.name} (${other.profile.role})${statusTag}`);
    }
  }

  // Neighboring locations with who's there
  const currentLoc = ctx.locations.get(agent.state.location);
  if (currentLoc) {
    for (const connName of currentLoc.connections) {
      const npcsAt: string[] = [];
      for (const [otherId, other] of ctx.agents) {
        if (otherId === npcId || !other.state.alive) continue;
        if (isStatusAbsent(other.state.status)) continue;
        if (other.state.location === connName) {
          npcsAt.push(`${other.profile.name} (${other.profile.role})`);
        }
      }
      neighborInfo.set(connName, npcsAt);
    }
  }

  // ── Instinct descriptions (procedural, personality-driven) ──
  const instincts: string[] = [];
  for (const sa of scored) {
    const desc = buildInstinctDescription(
      {
        id: sa.definition.id,
        score: sa.score,
        severity: sa.definition.severity ?? 5,
        label: sa.definition.label,
        targetName: sa.target.targetName,
        resistTraits: sa.definition.resistTraits,
        considerationCount: getConsiderationCount(npcId, sa.definition.id),
      },
      agent.profile,
      agent.state.mood,
    );
    instincts.push(`[${getTierName(sa.score)}] ${sa.definition.id}${sa.target.targetName ? ` → ${sa.target.targetName}` : ''}: ${desc}`);
    // Track consideration (NPC saw this option)
    trackConsideration(npcId, sa.definition.id);
  }

  // ── Available actions (dynamic vocabulary) ──
  const locationNames = Array.from(ctx.locations.values()).map((l) => l.name);
  const aliveNpcNames = Array.from(ctx.agents.entries())
    .filter(([id, a]) => {
      if (id === npcId || !a.state.alive || a.profile.isPlayer) return false;
      return !isStatusAbsent(a.state.status);
    })
    .map(([, a]) => a.profile.name);

  // ── Duty target collection (Tier 2: urge) ──
  // NPC names that are targets of duty affordances with score >= URGE_THRESHOLD
  // "talk" is blocked for these targets — duty action is the only way to interact
  const dutyTargetNames = new Set<string>();
  const dutyConstraintLines: string[] = [];
  for (const sa of scored) {
    if (sa.score >= URGE_THRESHOLD && sa.definition.isDuty) {
      dutyTargetNames.add(sa.target.targetName);
      dutyConstraintLines.push(
        `To interact with ${sa.target.targetName}, you must use '${sa.definition.id}' — your duty demands it.`,
      );
    }
  }

  const actionLines: string[] = [
    'go — move to a location (set target to location name)',
  ];
  if (dutyTargetNames.size === 0) {
    actionLines.push('talk — talk to someone (set target to NPC name)');
  }
  actionLines.push('wait — stay and observe');
  actionLines.push('announce — say something to everyone here (set target to your words)');

  // Add module-registered action verbs from scored affordances
  const addedVerbs = new Set<string>();
  for (const sa of scored) {
    const verb = sa.definition.actionVerb ?? sa.definition.id;
    const desc = sa.definition.actionDescription;
    if (desc && !addedVerbs.has(verb)) {
      actionLines.push(`${verb} — ${desc} (set target to NPC name)`);
      addedVerbs.add(verb);
    }
  }

  // ── Build neighbor lines ──
  const neighborLines: string[] = [];
  for (const [locName, npcs] of neighborInfo) {
    if (npcs.length > 0) {
      neighborLines.push(`  ${locName}: ${npcs.join(', ')}`);
    } else {
      neighborLines.push(`  ${locName}: empty`);
    }
  }

  // ── User prompt ──
  const userParts = [
    `SITUATION:`,
    `You are at ${agent.state.location}. Time: ${ctx.period}.`,
    nearbyNpcs.length > 0
      ? `Nearby: ${nearbyNpcs.join(', ')}.`
      : 'You are alone here.',
    neighborLines.length > 0 ? `Neighboring locations:\n${neighborLines.join('\n')}` : '',
    '',
    'YOUR INSTINCTS (the stronger the urge, the harder it is to resist):',
    ...instincts,
    '',
    'AVAILABLE ACTIONS:',
    ...actionLines.map((l) => `  ${l}`),
    '',
    ...(dutyConstraintLines.length > 0 ? ['DUTY CONSTRAINTS:', ...dutyConstraintLines, ''] : []),
    `LOCATIONS: ${locationNames.join(', ')}`,
    `NPCs: ${aliveNpcNames.map(n => hasRecentTalk(npcId, n, ctx.currentTick) ? `${n} (spoke recently — try someone else)` : n).join(', ')}`,
    '',
    'Choose ONE action. Use EXACTLY the action words listed above.',
    'Respond with: action (verb), target (NPC name or location), reason (one sentence in character).',
  ].filter((l) => l !== undefined).join('\n');

  return { system: systemParts, user: userParts };
}

// ─── Recent Talk Target Tracking (anti-repeat) ───

const _recentTalkTargets = new Map<string, Map<string, number>>(); // npcId → targetName → lastTick

/** Check if NPC talked to this target recently (within 8 ticks) */
function hasRecentTalk(npcId: string, targetName: string, currentTick: number): boolean {
  const lastTick = _recentTalkTargets.get(npcId)?.get(targetName) ?? -Infinity;
  return currentTick - lastTick < 8;
}

/** Record that NPC talked to target */
export function recordTalkTarget(npcId: string, targetName: string, tick: number): void {
  if (!_recentTalkTargets.has(npcId)) _recentTalkTargets.set(npcId, new Map());
  _recentTalkTargets.get(npcId)!.set(targetName, tick);
}

// ─── Consideration Tracking (escalation) ───

const _considerations = new Map<string, Map<string, number>>();

function getConsiderationCount(npcId: string, affId: string): number {
  return _considerations.get(npcId)?.get(affId) ?? 0;
}

function trackConsideration(npcId: string, affId: string): void {
  if (!_considerations.has(npcId)) _considerations.set(npcId, new Map());
  const npcMap = _considerations.get(npcId)!;
  npcMap.set(affId, (npcMap.get(affId) ?? 0) + 1);
}

/** Reset consideration count when NPC acts on an affordance (or mood recovers) */
export function resetConsideration(npcId: string, affId?: string): void {
  if (affId) {
    _considerations.get(npcId)?.delete(affId);
  } else {
    _considerations.delete(npcId);
  }
}

// ─── LLM Call ───

/** Build volition schema with dynamic action enum from registered verbs */
let _volitionSchema: import('./llm-client').LlmJsonSchema | null = null;
function getVolitionSchema(): import('./llm-client').LlmJsonSchema {
  if (!_volitionSchema) {
    const engineVerbs = Object.keys(ENGINE_ACTIONS); // go, talk, wait, announce
    const moduleVerbs = getAllRegisteredVerbs();       // steal, kill, attack, investigate, etc.
    const allVerbs = [...new Set([...engineVerbs, ...moduleVerbs])];
    _volitionSchema = {
      name: 'npc_decision',
      strict: true,
      schema: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: allVerbs },
          target: { type: 'string', description: 'NPC name, location name, or empty string' },
          reason: { type: 'string', description: 'One sentence in character' },
        },
        required: ['action', 'target', 'reason'],
        additionalProperties: false,
      },
    };
  }
  return _volitionSchema;
}

// ─── Decision Resolution ───

/** Engine-level actions that don't go through ACTION_VERB_MAP */
const ENGINE_ACTIONS: Record<string, (npc: string | undefined, loc: string | undefined, raw: string, why: string) => ParsedIntention | null> = {
  go: (_npc, loc, _raw, why) => loc ? { action: 'go', target: loc, why } : null,
  talk: (npc, _loc, _raw, why) => npc ? { action: 'talk', target: npc, detail: 'general conversation', why } : null,
  wait: (_npc, _loc, _raw, why) => ({ action: 'wait', why }),
  announce: (_npc, _loc, raw, why) => raw ? { action: 'announce', detail: raw, why } : null,
};

function resolveDecision(
  action: string,
  resolvedNpc: string | undefined,
  resolvedLocation: string | undefined,
  rawTarget: string,
  reason: string,
): ParsedIntention | null {
  // Check engine-level actions first
  const engineHandler = ENGINE_ACTIONS[action];
  if (engineHandler) return engineHandler(resolvedNpc, resolvedLocation, rawTarget, reason);

  // Check module-registered verbs (steal, kill, investigate, arrest, etc.)
  const verbIds = getAffordanceIdsForVerb(action);
  if (verbIds.length > 0) {
    return { action, target: resolvedNpc || undefined, why: reason };
  }

  return null;
}

// ─── LLM Call ───

async function callLlm(agent: Agent, system: string, user: string): Promise<string | null> {
  const temperature = agent.profile.llm?.temperature ?? 0.7;

  await llmSemaphore.acquire();
  try {
    const result = await llmCall({
      system,
      user,
      temperature,
      maxTokens: 100,
      jsonSchema: getVolitionSchema(),
    });
    return result;
  } catch (err) {
    console.error(`  [AL:llm] LLM call failed:`, err);
    return null;
  } finally {
    llmSemaphore.release();
  }
}

// ─── DO/WHY Parser ───

export function parseDoWhy(
  response: string,
  validLocations: string[],
  validNpcs: string[],
  availableCrimeActions: Set<string>,
): ParsedIntention | null {
  const lines = response.split('\n').map((l) => l.trim()).filter(Boolean);

  // Find DO: and WHY: lines
  const doLine = lines.find((l) => l.startsWith('DO:'));
  const whyLine = lines.find((l) => l.startsWith('WHY:'));

  if (!doLine) return null;

  const doContent = doLine.slice(3).trim();
  const why = whyLine ? whyLine.slice(4).trim() : 'no reason given';

  if (!doContent) return null;

  // Parse action
  const parts = doContent.split(/\s+/);
  const action = parts[0].toLowerCase();

  switch (action) {
    case 'go': {
      // Remaining parts form the location name
      const locationInput = parts.slice(1).join(' ');
      const location = matchName(locationInput, validLocations);
      if (!location) return null;
      return { action: 'go', target: location, why };
    }

    case 'talk': {
      // talk NPC_NAME topic...
      // NPC name could be 1-2 words, try to match against known NPCs
      const rest = parts.slice(1).join(' ');
      const { matched, remainder } = matchNameWithRemainder(rest, validNpcs);
      if (!matched) return null;
      return { action: 'talk', target: matched, detail: remainder || 'general conversation', why };
    }

    case 'wait': {
      return { action: 'wait', why };
    }

    case 'announce': {
      const message = parts.slice(1).join(' ');
      if (!message) return null;
      return { action: 'announce', detail: message, why };
    }

    default: {
      // Module-registered action verbs — try to parse as verb [NPC_NAME]
      const verbIds = getAffordanceIdsForVerb(action);
      if (verbIds.length === 0) return null;
      // If verb has remaining parts, try to match NPC name
      const npcInput = parts.slice(1).join(' ');
      if (npcInput) {
        const npc = matchName(npcInput, validNpcs);
        if (npc) return { action, target: npc, why };
      }
      // No target or no match — verb-only action
      return { action, why };
    }
  }
}

/** Exact case-insensitive match against a list of valid names */
function matchName(input: string, validNames: string[]): string | null {
  if (!input) return null;
  const lower = input.toLowerCase();
  // Exact match
  const exact = validNames.find((n) => n.toLowerCase() === lower);
  if (exact) return exact;
  // Fuzzy: input contains a valid name (e.g. "Garrett and Traveler" → "Garrett")
  const sorted = [...validNames].sort((a, b) => b.length - a.length);
  for (const name of sorted) {
    if (lower.includes(name.toLowerCase())) return name;
  }
  return null;
}

/** Match NPC name at the start of input, return matched name and remaining text */
function matchNameWithRemainder(input: string, validNames: string[]): { matched: string | null; remainder: string } {
  if (!input) return { matched: null, remainder: '' };

  // Sort by name length descending (try longer names first: "Old Bess" before "Bess")
  const sorted = [...validNames].sort((a, b) => b.length - a.length);

  for (const name of sorted) {
    if (input.toLowerCase().startsWith(name.toLowerCase())) {
      const rest = input.slice(name.length).trim();
      return { matched: name, remainder: rest };
    }
  }

  return { matched: null, remainder: input };
}

// ─── Intention → Goal Mapping ───

function intentionToGoal(
  parsed: ParsedIntention,
  npcId: string,
  agent: Agent,
  scored: ScoredAffordance[],
  ctx: AffordanceContext,
): NpcGoal | null {
  const home = ctx.npcHomes.get(npcId) ?? agent.state.location;

  switch (parsed.action) {
    case 'wait':
      return null;

    case 'go': {
      if (!parsed.target) return null;
      if (parsed.target === agent.state.location) return null; // already there
      return {
        id: crypto.randomUUID(),
        type: 'wander',
        ownerId: npcId,
        priority: 2,
        state: 'pending',
        steps: [{ action: 'move_to', location: parsed.target }],
        currentStep: 0,
        data: { reason: parsed.why },
        createdAtTick: 0,
        homeLocation: home,
      };
    }

    case 'talk': {
      if (!parsed.target) return null;
      // Find NPC by name
      const targetEntry = findNpcByName(parsed.target, npcId, ctx);
      if (!targetEntry) return null;
      const [targetId, targetAgent] = targetEntry;
      const steps: GoalStep[] = [];
      if (agent.state.location !== targetAgent.state.location) {
        steps.push({ action: 'move_to', location: targetAgent.state.location });
      }
      steps.push({
        action: 'interact',
        targetId,
        purpose: parsed.detail ?? 'general conversation',
        importance: 4,
      });
      return {
        id: crypto.randomUUID(),
        type: 'social',
        ownerId: npcId,
        priority: 3,
        state: 'pending',
        steps,
        currentStep: 0,
        data: { targetName: parsed.target, topic: parsed.detail, reason: parsed.why },
        createdAtTick: 0,
        homeLocation: home,
      };
    }

    case 'announce': {
      if (!parsed.detail) return null;
      return {
        id: crypto.randomUUID(),
        type: 'announce',
        ownerId: npcId,
        priority: 2,
        state: 'pending',
        steps: [{ action: 'announce', message: parsed.detail, importance: 3 }],
        currentStep: 0,
        data: { reason: parsed.why },
        createdAtTick: 0,
        homeLocation: home,
      };
    }

    default: {
      // Module-registered action verbs → affordance IDs lookup
      const affordanceIds = getAffordanceIdsForVerb(parsed.action);
      if (affordanceIds.length > 0) {
        const aff = affordanceIds.reduce<ScoredAffordance | null>(
          (found, id) => found ?? scored.find((s) => s.definition.id === id) ?? null,
          null,
        );
        if (aff) {
          const goal = buildGoalFromAffordance(aff, npcId, agent, ctx);
          goal.data.reason = parsed.why;
          return goal;
        }
      }
      return null;
    }
  }
}

/** Find NPC entry by display name */
function findNpcByName(name: string, excludeId: string, ctx: AffordanceContext): [string, Agent] | null {
  const lower = name.toLowerCase();
  for (const [id, agent] of ctx.agents) {
    if (id === excludeId || !agent.state.alive || agent.profile.isPlayer) continue;
    if (agent.profile.name.toLowerCase() === lower) return [id, agent];
  }
  return null;
}

// ─── Goal Building (from scored affordance — preserves step logic) ───

function buildGoalFromAffordance(scored: ScoredAffordance, npcId: string, agent: Agent, ctx: AffordanceContext): NpcGoal {
  const { definition: aff, target } = scored;
  const steps = buildSteps(aff, npcId, agent, target, ctx);
  const home = ctx.npcHomes.get(npcId) ?? agent.state.location;

  return {
    id: crypto.randomUUID(),
    type: aff.goalType,
    ownerId: npcId,
    priority: aff.goalPriority,
    state: 'pending',
    steps,
    currentStep: 0,
    data: {
      affordanceId: aff.id,
      targetId: target.targetId,
      targetName: target.targetName,
      score: scored.score,
      ...target.extra,
    },
    createdAtTick: 0,
    homeLocation: home,
  };
}

// ─── Declarative Step Template Resolver ───

function buildSteps(
  aff: AffordanceDefinition,
  npcId: string,
  agent: Agent,
  target: AffordanceTarget,
  ctx: AffordanceContext,
): GoalStep[] {
  // Use declarative templates if defined
  if (aff.stepTemplates) {
    return resolveTemplates(aff.stepTemplates, npcId, agent, target, ctx);
  }

  // Fallback for affordances without templates
  const steps: GoalStep[] = [];
  if (agent.state.location !== target.targetLocation) {
    steps.push({ action: 'move_to', location: target.targetLocation });
  }
  steps.push({ action: 'interact', targetId: target.targetId, purpose: aff.label, importance: 5 });
  return steps;
}

/**
 * Resolve step templates into concrete GoalSteps.
 * Handles location references ($target, $home, $extra.KEY),
 * target ID references ($target), and string interpolation ({var:fallback}).
 */
function resolveTemplates(
  templates: StepTemplate[],
  npcId: string,
  agent: Agent,
  target: AffordanceTarget,
  ctx: AffordanceContext,
): GoalStep[] {
  const home = ctx.npcHomes.get(npcId) ?? agent.state.location;
  const vars = buildVarMap(target);
  const steps: GoalStep[] = [];

  for (const tmpl of templates) {
    switch (tmpl.action) {
      case 'move_to': {
        const location = resolveLocation(tmpl.location ?? '$target', target, home);
        if (tmpl.skipIfAt && agent.state.location === location) continue;
        steps.push({ action: 'move_to', location });
        break;
      }
      case 'interact': {
        const targetId = resolveTargetId(tmpl.targetId ?? '$target', target);
        steps.push({
          action: 'interact',
          targetId,
          purpose: interpolate(tmpl.purpose ?? '', vars),
          importance: tmpl.importance ?? 5,
          beliefTransfer: tmpl.beliefTransfer,
          beliefTransferDirection: tmpl.beliefTransferDirection,
          evaluateSuspect: tmpl.evaluateSuspect,
        });
        break;
      }
      case 'interact_present': {
        steps.push({
          action: 'interact_present',
          purpose: interpolate(tmpl.purpose ?? '', vars),
          importance: tmpl.importance ?? 5,
          filter: tmpl.filter,
          beliefTransfer: tmpl.beliefTransfer,
        });
        break;
      }
      case 'announce': {
        steps.push({
          action: 'announce',
          message: interpolate(tmpl.message ?? '', vars),
          importance: tmpl.importance ?? 3,
        });
        break;
      }
      case 'wait': {
        steps.push({ action: 'wait', ticks: tmpl.ticks ?? 1 });
        break;
      }
      case 'steal_from': {
        const targetId = resolveTargetId(tmpl.targetId ?? '$target', target);
        steps.push({
          action: 'steal_from',
          targetId,
          importance: tmpl.importance ?? 6,
        });
        break;
      }
      case 'attack_npc': {
        const targetId = resolveTargetId(tmpl.targetId ?? '$target', target);
        steps.push({
          action: 'attack_npc',
          targetId,
          importance: tmpl.importance ?? 7,
          reason: interpolate(tmpl.reason ?? '', vars),
          lethal: tmpl.lethal,
        });
        break;
      }
      case 'arrest_npc': {
        const targetId = resolveTargetId(tmpl.targetId ?? '$target', target);
        steps.push({
          action: 'arrest_npc',
          targetId,
          importance: tmpl.importance ?? 9,
        });
        break;
      }
      case 'destroy_evidence': {
        steps.push({
          action: 'destroy_evidence',
          importance: tmpl.importance ?? 7,
        });
        break;
      }
      case 'flee': {
        steps.push({
          action: 'flee',
          importance: tmpl.importance ?? 8,
        });
        break;
      }
      case 'examine_scene': {
        steps.push({
          action: 'examine_scene',
          importance: tmpl.importance ?? 7,
        });
        break;
      }
      case 'sentence_npc': {
        const targetId = resolveTargetId(tmpl.targetId ?? '$target', target);
        steps.push({
          action: 'sentence_npc',
          targetId,
          importance: tmpl.importance ?? 9,
        });
        break;
      }
    }
  }

  return steps;
}

/** Build variable map for string interpolation */
function buildVarMap(target: AffordanceTarget): Record<string, string> {
  const vars: Record<string, string> = {
    targetName: target.targetName,
    targetId: target.targetId,
    targetLocation: target.targetLocation,
  };
  // Add all extra fields as string vars
  if (target.extra) {
    for (const [key, value] of Object.entries(target.extra)) {
      if (typeof value === 'string') vars[key] = value;
    }
  }
  // Computed: relationshipDesc from relationship
  const rel = vars.relationship;
  if (rel) {
    vars.relationshipDesc = getRelationshipLabel(rel);
  }
  return vars;
}

/** Resolve location reference: $target, $home, $extra.KEY, or literal */
function resolveLocation(ref: string, target: AffordanceTarget, home: string): string {
  if (ref === '$target') return target.targetLocation;
  if (ref === '$home') return home;
  if (ref.startsWith('$extra.')) {
    const key = ref.slice(7);
    return (target.extra?.[key] as string) ?? target.targetLocation;
  }
  return ref; // literal location name
}

/** Resolve target ID reference: $target or literal */
function resolveTargetId(ref: string, target: AffordanceTarget): string {
  return ref === '$target' ? target.targetId : ref;
}

/** Interpolate {var:fallback} patterns in a template string */
function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)(?::([^}]*))?\}/g, (_, key, fallback) => {
    return vars[key] ?? fallback ?? key;
  });
}

// ─── Cooldown Helpers ───

function setAffordanceCooldown(ctx: AffordanceContext, npcId: string, affordanceId: string, currentTick: number, aff?: AffordanceDefinition): void {
  if (!ctx.cooldowns || !affordanceId) return;
  let npcMap = ctx.cooldowns.get(npcId);
  if (!npcMap) {
    npcMap = new Map();
    ctx.cooldowns.set(npcId, npcMap);
  }
  const cooldown = aff?.cooldownOverride ?? ctx.affordanceCooldownTicks ?? DEFAULT_AFFORDANCE_COOLDOWN;
  npcMap.set(affordanceId, currentTick + cooldown);
}

function setDecisionCooldown(ctx: AffordanceContext, npcId: string, currentTick: number): void {
  if (!ctx.decisionCooldowns) return;
  ctx.decisionCooldowns.set(npcId, currentTick + (ctx.decisionCooldownTicks ?? DEFAULT_DECISION_COOLDOWN));
}

function setDecisionCooldownExtended(ctx: AffordanceContext, npcId: string, currentTick: number): void {
  if (!ctx.decisionCooldowns) return;
  const base = ctx.decisionCooldownTicks ?? DEFAULT_DECISION_COOLDOWN;
  ctx.decisionCooldowns.set(npcId, currentTick + base * 3);
}
