/**
 * Perception System — centralized visibility and awareness.
 *
 * Replaces scattered location === location checks.
 * All perception queries go through this module.
 * Future: stealth, darkness, walls — same API, additional conditions.
 */

import type { Agent } from './agent';
import type { LocationGraph } from './world-types';
import { isStatusAbsent } from './event-registry';

// ─── Core Queries ───

/** Can observer see the target? Same location, both alive, target not absent. */
export function canSee(
  observer: Agent,
  target: Agent,
): boolean {
  if (!observer.state.alive || !target.state.alive) return false;
  if (isStatusAbsent(target.state.status)) return false;
  return observer.state.location === target.state.location;
}

/** Can observer interact with the target? canSee + observer not absent. */
export function canInteract(
  observer: Agent,
  target: Agent,
): boolean {
  if (isStatusAbsent(observer.state.status)) return false;
  return canSee(observer, target);
}

/** Can observer hear events at the given location? Same or adjacent location. */
export function canHear(
  observer: Agent,
  location: string,
  locations: LocationGraph,
): boolean {
  if (!observer.state.alive) return false;
  if (isStatusAbsent(observer.state.status)) return false;
  if (observer.state.location === location) return true;

  // Adjacent location check
  const observerLoc = findLocationByName(observer.state.location, locations);
  if (!observerLoc) return false;
  const targetLoc = findLocationByName(location, locations);
  if (!targetLoc) return false;
  return observerLoc.connections.includes(targetLoc.id);
}

// ─── Aggregate Queries ───

/** Get all agents co-present at a location (alive + not absent). */
export function getCoPresent(
  location: string,
  agents: Map<string, Agent>,
): Agent[] {
  const result: Agent[] = [];
  for (const agent of agents.values()) {
    if (!agent.state.alive) continue;
    if (isStatusAbsent(agent.state.status)) continue;
    if (agent.state.location === location) result.push(agent);
  }
  return result;
}

/** Get all agents who could witness an event at a location (alive + present). */
export function getWitnesses(
  location: string,
  agents: Map<string, Agent>,
  excludeIds?: Set<string>,
): Agent[] {
  const result: Agent[] = [];
  for (const [id, agent] of agents) {
    if (excludeIds?.has(id)) continue;
    if (!agent.state.alive) continue;
    if (isStatusAbsent(agent.state.status)) continue;
    if (agent.state.location === location) result.push(agent);
  }
  return result;
}

/** Get the player agent from agents map (cached-friendly). */
export function getPlayerAgent(agents: Map<string, Agent>): Agent | null {
  for (const agent of agents.values()) {
    if (agent.profile.isPlayer) return agent;
  }
  return null;
}

/** Is the player at the given location? */
export function isPlayerAt(
  location: string,
  agents: Map<string, Agent>,
): boolean {
  const player = getPlayerAgent(agents);
  return player != null && player.state.alive && player.state.location === location;
}

/** Get all NPCs (non-player active agents) at a location. */
export function getNpcsAt(
  location: string,
  agents: Map<string, Agent>,
): Agent[] {
  return getCoPresent(location, agents).filter((a) => !a.profile.isPlayer);
}

// ─── Helpers ───

function findLocationByName(name: string, locations: LocationGraph) {
  for (const loc of locations.values()) {
    if (loc.name === name) return loc;
  }
  return null;
}
