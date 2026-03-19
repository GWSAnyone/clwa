/**
 * Event Registry — modules declare event metadata here.
 * Engine uses registries instead of hardcoding module-specific event types.
 *
 * Flags: boolean properties on event types/sources (engine checks flags, not category names).
 * Categories: modules group their events for internal use.
 * Labels: human-readable display names for event types.
 * Goal cleanup: which goal types to complete when an event fires.
 * Belief zeroing: which events should zero out investigator beliefs about a suspect.
 */
import type { Agent } from './agent';

// ─── Event Type Flags ───
// Engine defines WHAT properties exist. Modules declare WHICH event types have them.
// Same pattern as AgentProfile capability flags (investigator, detersCrime, canSentence).

export interface EventTypeFlags {
  /** Beliefs about these events should transfer between agents during interactions */
  transferable?: boolean;
  /** Purely informational events — skip reactive volition evaluation */
  informationOnly?: boolean;
}

const EVENT_TYPE_FLAGS: Map<string, EventTypeFlags> = new Map();

/** Register flags for event types. Modules call this to declare properties. */
export function registerEventTypeFlags(eventType: string, flags: EventTypeFlags): void {
  const existing = EVENT_TYPE_FLAGS.get(eventType) ?? {};
  EVENT_TYPE_FLAGS.set(eventType, { ...existing, ...flags });
}

/** Batch register same flags for multiple event types */
export function registerEventTypeFlagsBatch(eventTypes: string[], flags: EventTypeFlags): void {
  for (const t of eventTypes) registerEventTypeFlags(t, flags);
}

/** Check if beliefs about this event type should transfer during interactions */
export function isTransferable(eventType: string): boolean {
  return EVENT_TYPE_FLAGS.get(eventType)?.transferable === true;
}

/** Check if this event type is purely informational (skip reactive volition) */
export function isInformationOnly(eventType: string): boolean {
  return EVENT_TYPE_FLAGS.get(eventType)?.informationOnly === true;
}

// ─── Source Flags ───
// Same pattern: engine defines WHAT source properties exist, modules assign them.

export interface SourceFlags {
  /** Source indicates perpetrator involvement */
  perpetrator?: boolean;
  /** Source is from firsthand experience */
  firsthand?: boolean;
  /** Source involves hiding/covering up */
  concealment?: boolean;
}

const SOURCE_FLAGS: Map<string, SourceFlags> = new Map();

export function registerSourceFlags(source: string, flags: SourceFlags): void {
  const existing = SOURCE_FLAGS.get(source) ?? {};
  SOURCE_FLAGS.set(source, { ...existing, ...flags });
}

export function isPerpetrator(source: string | null | undefined): boolean {
  return source != null && (SOURCE_FLAGS.get(source)?.perpetrator === true);
}

export function isFirsthand(source: string | null | undefined): boolean {
  return source != null && (SOURCE_FLAGS.get(source)?.firsthand === true);
}

export function isConcealment(source: string | null | undefined): boolean {
  return source != null && (SOURCE_FLAGS.get(source)?.concealment === true);
}

// ─── Event Categories (module-internal, NOT used by engine logic) ───
const EVENT_CATEGORIES: Map<string, Set<string>> = new Map();

export function registerEventCategory(category: string, eventTypes: string[]): void {
  const set = EVENT_CATEGORIES.get(category) ?? new Set();
  for (const t of eventTypes) set.add(t);
  EVENT_CATEGORIES.set(category, set);
}

export function isEventCategory(eventType: string, category: string): boolean {
  return EVENT_CATEGORIES.get(category)?.has(eventType) ?? false;
}

/** Get all registered event types across all categories (for IL context, prompts, etc.) */
export function getAllRegisteredEventTypes(): string[] {
  const all = new Set<string>();
  for (const types of EVENT_CATEGORIES.values()) {
    for (const t of types) all.add(t);
  }
  return Array.from(all);
}

// ─── Event Display Labels ───
// Human-readable names for event types (used in prompts, display text)
const EVENT_LABELS: Map<string, string> = new Map();

export function registerEventLabels(labels: Record<string, string>): void {
  for (const [eventType, label] of Object.entries(labels)) {
    EVENT_LABELS.set(eventType, label);
  }
}

export function getEventLabel(eventType: string): string | null {
  return EVENT_LABELS.get(eventType) ?? null;
}

// ─── Event → Goal Cleanup ───
// When an event fires, which goal types should be completed
const EVENT_GOAL_CLEANUP: Map<string, string[]> = new Map();

export function registerEventGoalCleanup(mapping: Record<string, string[]>): void {
  for (const [eventType, goalTypes] of Object.entries(mapping)) {
    EVENT_GOAL_CLEANUP.set(eventType, goalTypes);
  }
}

export function getGoalCleanupForEvent(eventType: string): string[] {
  return EVENT_GOAL_CLEANUP.get(eventType) ?? [];
}

// ─── Belief Zeroing Events ───
// Events that should zero out investigator beliefs about the suspect (case resolved)
// Belief zeroing moved to module event handlers (verdict-conditional).
// Modules call ctx.bodyDiscoveries / iterate ctx.crimeScenes directly.

// ─── Event → Scene Type mapping ───
// Maps eventType to crime scene type string (modules define what scene types exist)
const EVENT_TO_SCENE_TYPE: Map<string, string> = new Map();

export function registerEventSceneTypes(mapping: Record<string, string>): void {
  for (const [eventType, sceneType] of Object.entries(mapping)) {
    EVENT_TO_SCENE_TYPE.set(eventType, sceneType);
  }
}

export function getSceneTypeForEvent(eventType: string): string | null {
  return EVENT_TO_SCENE_TYPE.get(eventType) ?? null;
}

// ─── Death events ───
// Events that mean an entity died (engine needs this for alive=false)
const DEATH_EVENTS: Set<string> = new Set();

export function registerDeathEvents(eventTypes: string[]): void {
  for (const t of eventTypes) DEATH_EVENTS.add(t);
}

export function isDeathEvent(eventType: string): boolean {
  return DEATH_EVENTS.has(eventType);
}

export function getDefaultDeathEvent(): string | null {
  return DEATH_EVENTS.size > 0 ? DEATH_EVENTS.values().next().value! : null;
}

// ─── Pursuit/wanted events ───
// Events that mean an entity is being pursued (for prompt building)
const PURSUIT_EVENTS: Set<string> = new Set();

export function registerPursuitEvents(eventTypes: string[]): void {
  for (const t of eventTypes) PURSUIT_EVENTS.add(t);
}

export function isPursuitEvent(eventType: string): boolean {
  return PURSUIT_EVENTS.has(eventType);
}

// ─── Event Handlers ───
// Modules register handlers that execute when specific events fire in handleEventForGoals.
// Each handler receives the event and a context with agents, goalManager, etc.
import type { Agent } from './agent';
import type { WorldEvent } from './cg-types';
import type { GoalManager } from './goals';
import type { NpcGoal, GoalStep, GoalActionResult } from './goals';
import type { CrimeScene, LocationGraph } from './world-types';
import type { ExaminationPoint } from './world-types';
import type { EvidenceLayer } from './evidence';
import type { IEventStore } from './event-types';

export interface EventHandlerContext {
  agents: Map<string, Agent>;
  goalManager: GoalManager;
  crimeScenes: Map<string, CrimeScene[]>;
  getCurrentDay: () => number;
  /** Body discovery tracking — module can mark bodies as discovered to prevent re-discovery loops */
  bodyDiscoveries: Set<string>;
}

export type EventHandlerFn = (event: WorldEvent, ctx: EventHandlerContext) => void | Promise<void>;

const EVENT_HANDLERS: Map<string, EventHandlerFn[]> = new Map();

export function registerEventHandler(eventType: string, handler: EventHandlerFn): void {
  const handlers = EVENT_HANDLERS.get(eventType) ?? [];
  handlers.push(handler);
  EVENT_HANDLERS.set(eventType, handlers);
}

export function getEventHandlers(eventType: string): EventHandlerFn[] {
  return EVENT_HANDLERS.get(eventType) ?? [];
}

// ─── Action Verb → Affordance ID mapping ───
// LLM outputs verbs (steal, kill, investigate). Modules map verbs to their affordance IDs.
const ACTION_VERB_MAP: Map<string, string[]> = new Map();

export function registerActionVerbs(mapping: Record<string, string[]>): void {
  for (const [verb, ids] of Object.entries(mapping)) {
    ACTION_VERB_MAP.set(verb, ids);
  }
}

export function getAffordanceIdsForVerb(verb: string): string[] {
  return ACTION_VERB_MAP.get(verb) ?? [];
}

/** Get all registered action verbs (for schema enum constraints) */
export function getAllRegisteredVerbs(): string[] {
  return Array.from(ACTION_VERB_MAP.keys());
}

// ─── Crime Scene Templates ───
// Modules register examination point templates per scene type.
export interface CrimeSceneTemplate {
  points: Omit<ExaminationPoint, 'id' | 'examined'>[];
  /** Prose text for NPCs who passively notice this scene. {locationName} is interpolated. */
  passiveNoticeText?: string;
  /** Module callback: personalize points based on victim/perpetrator context */
  personalizePoints?: (points: ExaminationPoint[], ctx: { victim?: Agent; perpetrator?: Agent }) => void;
  /** Module callback: generate additional points based on context (e.g. profession clues) */
  additionalPoints?: (ctx: { victim?: Agent; perpetrator?: Agent }) => Omit<ExaminationPoint, 'id' | 'examined'>[];
}

const CRIME_SCENE_TEMPLATES: Map<string, CrimeSceneTemplate> = new Map();

export function registerCrimeSceneTemplate(sceneType: string, template: CrimeSceneTemplate): void {
  CRIME_SCENE_TEMPLATES.set(sceneType, template);
}

export function getCrimeSceneTemplate(sceneType: string): CrimeSceneTemplate | null {
  return CRIME_SCENE_TEMPLATES.get(sceneType) ?? null;
}

// ─── Relationship Display Labels ───
const RELATIONSHIP_LABELS: Map<string, string> = new Map([
  ['friend', 'your friend'],
  ['colleague', 'your colleague'],
  ['family', 'your family member'],
  ['rival', 'your rival'],
  ['mentor', 'your mentor'],
  ['romantic', 'a loved one'],
  ['acquaintance', 'an acquaintance'],
]);

export function registerRelationshipLabels(labels: Record<string, string>): void {
  for (const [type, label] of Object.entries(labels)) {
    RELATIONSHIP_LABELS.set(type, label);
  }
}

export function getRelationshipLabel(type: string): string {
  return RELATIONSHIP_LABELS.get(type) ?? type;
}

// ─── Belief Source Display Labels ───
const BELIEF_SOURCE_LABELS: Map<string, string> = new Map([
  ['witness', 'saw it happen'],
  ['body_discovery', 'found the body'],
  ['testimony', 'was told directly'],
  ['interrogation', 'testimony under questioning'],
  ['rumor', 'hearsay'],
  ['observation', 'observed directly'],
  ['evidence', 'physical evidence'],
  ['deduction', 'deduced from clues'],
  ['perpetrator', 'committed the act'],
  ['cover_up', 'covering up'],
]);

export function registerBeliefSourceLabels(labels: Record<string, string>): void {
  for (const [source, label] of Object.entries(labels)) {
    BELIEF_SOURCE_LABELS.set(source, label);
  }
}

export function getBeliefSourceLabel(source: string): string {
  return BELIEF_SOURCE_LABELS.get(source) ?? source;
}

// ─── Belief Source Constants ───
// Engine-defined source type identifiers. Used when creating beliefs in engine code.
export const BELIEF_SOURCE = {
  TESTIMONY: 'testimony',
  OBSERVATION: 'observation',
  BODY_DISCOVERY: 'body_discovery',
  EVIDENCE: 'evidence',
  DEDUCTION: 'deduction',
} as const;

// ─── Belief Source Transfer Weights ───
// When beliefs transfer between NPCs, confidence is multiplied by source weight
const SOURCE_TRANSFER_WEIGHTS: Map<string, number> = new Map([
  ['witness', 0.85],
  ['observation', 0.85],
  ['body_discovery', 0.7],
  ['testimony', 0.7],
  ['evidence', 0.8],
  ['deduction', 0.6],
  ['rumor', 0.5],
  ['perpetrator', 0.0],  // perpetrator knowledge should not transfer
  ['cover_up', 0.0],
]);

export function registerSourceTransferWeights(weights: Record<string, number>): void {
  for (const [source, weight] of Object.entries(weights)) {
    SOURCE_TRANSFER_WEIGHTS.set(source, weight);
  }
}

export function getSourceTransferWeight(source: string): number {
  return SOURCE_TRANSFER_WEIGHTS.get(source) ?? 0.6;
}

// ─── Step Handlers Registry ───
// Modules register custom goal step handlers. Engine handles universal primitives
// (move_to, interact, announce, wait). Everything else → registry.

export type InteractionRunner = (initiator: Agent, target: Agent, purpose: string, importance: number) => Promise<{ ownerLine: string; targetLine: string }>;

export interface StepExecutionContext {
  goal: NpcGoal;
  step: GoalStep;
  ownerId: string;
  owner: Agent;
  agents: Map<string, Agent>;
  locations: LocationGraph;
  runInteraction: InteractionRunner;
  onCrimeEvent?: (event: { type: string; subject: string; object?: string; location: string; importance: number; payload: Record<string, unknown> }) => Promise<void>;
  crimeScenes?: Map<string, CrimeScene[]>;
  evidenceLayer?: EvidenceLayer;
  /** GoalManager for clearing goals (arrest → clear target goals, flee → clear own goals) */
  goalManager: GoalManager;
}

export type StepHandlerFn = (ctx: StepExecutionContext) => Promise<GoalActionResult | null>;

const STEP_HANDLERS: Map<string, StepHandlerFn> = new Map();

export function registerStepHandler(action: string, handler: StepHandlerFn): void {
  STEP_HANDLERS.set(action, handler);
}

export function getStepHandler(action: string): StepHandlerFn | null {
  return STEP_HANDLERS.get(action) ?? null;
}

// ─── Status Categories ───
// Modules register which statuses mean "active" (can act) vs "absent" (not in world)
const ACTIVE_STATUSES: Set<string> = new Set(); // null/undefined = active by default
const ABSENT_STATUSES: Set<string> = new Set();

export function registerActiveStatuses(statuses: string[]): void {
  for (const s of statuses) ACTIVE_STATUSES.add(s);
}

export function registerAbsentStatuses(statuses: string[]): void {
  for (const s of statuses) ABSENT_STATUSES.add(s);
}

export function isStatusActive(status: string | null | undefined): boolean {
  if (!status) return true; // null/undefined = default free state = active
  return ACTIVE_STATUSES.has(status);
}

export function isStatusAbsent(status: string | null | undefined): boolean {
  if (!status) return false; // null/undefined = default free state = not absent
  return ABSENT_STATUSES.has(status);
}

// ─── Interact Post-Hooks ───
// Modules register hooks that run after an interact step (e.g., suspect evaluation)
export type InteractPostHookFn = (owner: Agent, target: Agent, step: GoalStep, agents: Map<string, Agent>, crimeScenes?: Map<string, CrimeScene[]>) => void;

const INTERACT_POST_HOOKS: InteractPostHookFn[] = [];

export function registerInteractPostHook(hook: InteractPostHookFn): void {
  INTERACT_POST_HOOKS.push(hook);
}

// ─── Interaction Result Hooks ───
// Modules register hooks that run after a goal-driven interaction completes.
// Richer context than InteractPostHooks — includes purpose, eventStore, and event emission.
export type InteractionResultHookFn = (ctx: {
  initiator: Agent;
  target: Agent;
  step: GoalStep;
  purpose: string;
  eventStore: IEventStore;
  onExtraEvent?: (e: WorldEvent) => Promise<void>;
}) => Promise<void>;

const INTERACTION_RESULT_HOOKS: InteractionResultHookFn[] = [];

export function registerInteractionResultHook(hook: InteractionResultHookFn): void {
  INTERACTION_RESULT_HOOKS.push(hook);
}

export function getInteractionResultHooks(): InteractionResultHookFn[] {
  return INTERACTION_RESULT_HOOKS;
}

// ─── Witness Event Type ───
// What event type to create when a lone discoverer finds a body
let WITNESS_EVENT_TYPE: string | null = null;

export function registerWitnessEventType(eventType: string): void {
  WITNESS_EVENT_TYPE = eventType;
}

export function getWitnessEventType(): string | null {
  return WITNESS_EVENT_TYPE;
}

export function runInteractPostHooks(owner: Agent, target: Agent, step: GoalStep, agents: Map<string, Agent>, crimeScenes?: Map<string, CrimeScene[]>): void {
  for (const hook of INTERACT_POST_HOOKS) {
    hook(owner, target, step, agents, crimeScenes);
  }
}

// ─── Mood Shifts per Event Type ───
// Modules register how much mood changes when an NPC is affected by an event
const EVENT_MOOD_SHIFTS: Map<string, number> = new Map();

export function registerEventMoodShifts(shifts: Record<string, number>): void {
  for (const [eventType, shift] of Object.entries(shifts)) {
    EVENT_MOOD_SHIFTS.set(eventType, shift);
  }
}

export function getEventMoodShift(eventType: string): number {
  return EVENT_MOOD_SHIFTS.get(eventType) ?? 0;
}

// ─── Goal Completion Mood Boost ───
// Modules register mood reward per goal type
const GOAL_MOOD_BOOST: Map<string, number> = new Map();

export function registerGoalMoodBoost(mapping: Record<string, number>): void {
  for (const [goalType, boost] of Object.entries(mapping)) {
    GOAL_MOOD_BOOST.set(goalType, boost);
  }
}

export function getGoalMoodBoost(goalType: string): number {
  return GOAL_MOOD_BOOST.get(goalType) ?? 0;
}

// ─── Body Discovery Event Type ───
let BODY_DISCOVERY_EVENT_TYPE: string | null = null;

export function registerBodyDiscoveryEventType(eventType: string): void {
  BODY_DISCOVERY_EVENT_TYPE = eventType;
}

export function getBodyDiscoveryEventType(): string | null {
  return BODY_DISCOVERY_EVENT_TYPE;
}

// ─── Role Topic Pool ───
// Modules register role-specific conversation topic pools
interface RoleTopicDef {
  subject: string;
  tone: string;
  weight: number;
  initiatorHook: string;
  category: string;
  responderHook?: string;
}

const ROLE_TOPIC_POOLS: Map<string, RoleTopicDef[]> = new Map();

export function registerRoleTopicPool(role: string, topics: RoleTopicDef[]): void {
  ROLE_TOPIC_POOLS.set(role, topics);
}

export function getRoleTopicPool(role: string): RoleTopicDef[] {
  return ROLE_TOPIC_POOLS.get(role) ?? [];
}

// ─── Rumor Event Type ───
let RUMOR_EVENT_TYPE: string | null = null;

export function registerRumorEventType(eventType: string): void {
  RUMOR_EVENT_TYPE = eventType;
}

export function getRumorEventType(): string | null {
  return RUMOR_EVENT_TYPE;
}

// ─── CG Belief Creators ───
// Modules register how beliefs are created from CG consequence types
export type BeliefCreatorFn = (agent: Agent, event: WorldEvent, rule: any, crimeEventType: string, killer: string | null, victimName: string | null) => void;

const BELIEF_CREATORS: Map<string, BeliefCreatorFn> = new Map();

export function registerBeliefCreator(consequenceType: string, creator: BeliefCreatorFn): void {
  BELIEF_CREATORS.set(consequenceType, creator);
}

export function getBeliefCreator(consequenceType: string): BeliefCreatorFn | null {
  return BELIEF_CREATORS.get(consequenceType) ?? null;
}

// ─── CG Memory Text Builders ───
export type MemoryTextBuilderFn = (event: WorldEvent, killer: string, victimName: string) => string;

const MEMORY_TEXT_BUILDERS: Map<string, MemoryTextBuilderFn> = new Map();

export function registerMemoryTextBuilder(consequenceType: string, builder: MemoryTextBuilderFn): void {
  MEMORY_TEXT_BUILDERS.set(consequenceType, builder);
}

export function getMemoryTextBuilder(consequenceType: string): MemoryTextBuilderFn | null {
  return MEMORY_TEXT_BUILDERS.get(consequenceType) ?? null;
}

// ─── Day Advance Handlers ───
// Modules register handlers that run during day advance (e.g., rumor spreading)
export interface DayAdvanceContext {
  agents: Map<string, Agent>;
  currentDay: number;
  eventStore: IEventStore;
  onEvent?: (event: WorldEvent) => void;
  publicPlaces: Set<string>;
}

export type DayAdvanceHandlerFn = (ctx: DayAdvanceContext) => Promise<void>;

const DAY_ADVANCE_HANDLERS: DayAdvanceHandlerFn[] = [];

export function registerDayAdvanceHandler(handler: DayAdvanceHandlerFn): void {
  DAY_ADVANCE_HANDLERS.push(handler);
}

export function getDayAdvanceHandlers(): DayAdvanceHandlerFn[] {
  return DAY_ADVANCE_HANDLERS;
}

// ─── Source Categories ───
// Classify belief sources into semantic categories (e.g., 'guilt', 'direct_experience', 'concealment')
// Engine uses categories for behavioral prompt building. Modules define which sources belong to which categories.

const SOURCE_CATEGORIES = new Map<string, Set<string>>();

export function registerSourceCategory(category: string, sources: string[]): void {
  if (!SOURCE_CATEGORIES.has(category)) SOURCE_CATEGORIES.set(category, new Set());
  const set = SOURCE_CATEGORIES.get(category)!;
  for (const s of sources) set.add(s);
}

export function isSourceCategory(source: string | null | undefined, category: string): boolean {
  if (!source) return false;
  return SOURCE_CATEGORIES.get(category)?.has(source) ?? false;
}

// ─── Tick Phase Handlers ───
// Modules register per-tick handlers for discovery checks (e.g., theft discovery).
// Called during _tick at the appropriate phase.
export interface TickPhaseContext {
  agents: Map<string, Agent>;
  eventStore: IEventStore;
  currentDay: number;
  tickCount: number;
  processEvent: (event: WorldEvent) => Promise<void>;
  discoveries: Set<string>;
  /** NPC approach events — tick phase handlers push to this array */
  approaches: import('./world-types').ApproachEvent[];
}

export type TickPhaseHandlerFn = (ctx: TickPhaseContext) => Promise<void>;

const TICK_PHASE_HANDLERS: TickPhaseHandlerFn[] = [];

export function registerTickPhaseHandler(handler: TickPhaseHandlerFn): void {
  TICK_PHASE_HANDLERS.push(handler);
}

export function getTickPhaseHandlers(): TickPhaseHandlerFn[] {
  return TICK_PHASE_HANDLERS;
}

// ─── Secret Directive Builders ───
// Modules/server register functions that produce secret behavioral prompt sections.
// buildSecretDirectives calls all registered builders.
export type SecretDirectiveBuilderFn = (ctx: {
  agent: Agent;
  agents: Map<string, Agent>;
  eventStore: IEventStore;
}) => string[];

const SECRET_DIRECTIVE_BUILDERS: SecretDirectiveBuilderFn[] = [];

export function registerSecretDirectiveBuilder(builder: SecretDirectiveBuilderFn): void {
  SECRET_DIRECTIVE_BUILDERS.push(builder);
}

export function getSecretDirectiveBuilders(): SecretDirectiveBuilderFn[] {
  return SECRET_DIRECTIVE_BUILDERS;
}
