import type { Agent } from './agent';
import type { LocationGraph, NpcMovementConfig, MovementResult } from './world-types';
import { isStatusAbsent } from './event-registry';

/** Find a LocationDef by its name in the graph (keyed by id) */
function findByName(locations: LocationGraph, name: string) {
  for (const loc of locations.values()) {
    if (loc.name === name) return loc;
  }
  return null;
}

/**
 * Process NPC movement for a single tick.
 * Mobile NPCs have a chance to move to an adjacent location.
 * NPCs in excludeIds are skipped (e.g. those with active goals).
 */
export function processMovement(
  agents: Map<string, Agent>,
  locations: LocationGraph,
  config: NpcMovementConfig,
  excludeIds?: Set<string>,
): MovementResult[] {
  const results: MovementResult[] = [];

  for (const [id, agent] of agents) {
    if (!agent.state.alive) continue;
    if (agent.state.status) continue; // any non-default status blocks random movement
    if (!config.mobileNpcs.has(id)) continue;
    if (excludeIds?.has(id)) continue;
    if (Math.random() > config.moveProbability) continue;

    const currentLoc = findByName(locations, agent.state.location);
    if (!currentLoc || currentLoc.connections.length === 0) continue;

    // Pick a random adjacent location
    const targetId = currentLoc.connections[
      Math.floor(Math.random() * currentLoc.connections.length)
    ];
    const targetLoc = locations.get(targetId);
    if (!targetLoc) continue;

    const from = agent.state.location;
    agent.state.location = targetLoc.name;

    results.push({
      agentId: id,
      agentName: agent.profile.name,
      from,
      to: targetLoc.name,
    });
  }

  return results;
}
