/**
 * Event Registry — modules declare event metadata here.
 * Engine uses registries instead of hardcoding module-specific event types.
 *
 * Categories: modules group their events by semantic role.
 * Labels: human-readable display names for event types.
 * Goal cleanup: which goal types to complete when an event fires.
 * Belief zeroing: which events should zero out investigator beliefs about a suspect.
 */

// ─── Event Categories ───
// Engine defines category NAMES it cares about. Modules register which eventTypes belong.
// Engine categories: 'crime', 'information_spread', 'death', 'justice_resolution'
const EVENT_CATEGORIES: Map<string, Set<string>> = new Map();

export function registerEventCategory(category: string, eventTypes: string[]): void {
  const set = EVENT_CATEGORIES.get(category) ?? new Set();
  for (const t of eventTypes) set.add(t);
  EVENT_CATEGORIES.set(category, set);
}

export function isEventCategory(eventType: string, category: string): boolean {
  return EVENT_CATEGORIES.get(category)?.has(eventType) ?? false;
}

// ─── Event Display Labels ───
// Human-readable names for event types (used in prompts, display text)
const EVENT_LABELS: Map<string, string> = new Map();

export function registerEventLabels(labels: Record<string, string>): void {
  for (const [eventType, label] of Object.entries(labels)) {
    EVENT_LABELS.set(eventType, label);
  }
}

export function getEventLabel(eventType: string): string {
  return EVENT_LABELS.get(eventType) ?? eventType;
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
const BELIEF_ZEROING_EVENTS: Set<string> = new Set();

export function registerBeliefZeroingEvents(eventTypes: string[]): void {
  for (const t of eventTypes) BELIEF_ZEROING_EVENTS.add(t);
}

export function shouldZeroBeliefs(eventType: string): boolean {
  return BELIEF_ZEROING_EVENTS.has(eventType);
}

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

export interface EventHandlerContext {
  agents: Map<string, Agent>;
  goalManager: GoalManager;
  crimeScenes: Map<string, CrimeScene[]>;
  getCurrentDay: () => number;
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

// ─── Crime Scene Templates ───
// Modules register examination point templates per scene type.
export interface CrimeSceneTemplate {
  points: Omit<ExaminationPoint, 'id' | 'examined'>[];
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
const ACTIVE_STATUSES: Set<string> = new Set(['free']); // default
const ABSENT_STATUSES: Set<string> = new Set();

export function registerActiveStatuses(statuses: string[]): void {
  for (const s of statuses) ACTIVE_STATUSES.add(s);
}

export function registerAbsentStatuses(statuses: string[]): void {
  for (const s of statuses) ABSENT_STATUSES.add(s);
}

export function isStatusActive(status: string): boolean {
  return ACTIVE_STATUSES.has(status);
}

export function isStatusAbsent(status: string): boolean {
  return ABSENT_STATUSES.has(status);
}

// ─── Interact Post-Hooks ───
// Modules register hooks that run after an interact step (e.g., suspect evaluation)
export type InteractPostHookFn = (owner: Agent, target: Agent, step: GoalStep, agents: Map<string, Agent>, crimeScenes?: Map<string, CrimeScene[]>) => void;

const INTERACT_POST_HOOKS: InteractPostHookFn[] = [];

export function registerInteractPostHook(hook: InteractPostHookFn): void {
  INTERACT_POST_HOOKS.push(hook);
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
