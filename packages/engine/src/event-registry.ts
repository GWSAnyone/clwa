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
import type { CrimeScene } from './world-types';

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
