import type { Agent } from './agent';
import type { LocationGraph, NpcMovementConfig, MovementResult } from './world-types';
import { isStatusAbsent } from './event-registry';

/** Find a LocationDef by ID or display name (backwards compat) */
function findLocation(locations: LocationGraph, idOrName: string) {
  // Try ID first (primary lookup)
  const byId = locations.get(idOrName);
  if (byId) return { id: idOrName, loc: byId };
  // Fallback: search by display name
  for (const [id, loc] of locations) {
    if (loc.name === idOrName) return { id, loc };
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

    const found = findLocation(locations, agent.state.location);
    if (!found || found.loc.connections.length === 0) continue;

    // Pick a random adjacent location
    const targetId = found.loc.connections[
      Math.floor(Math.random() * found.loc.connections.length)
    ];
    const targetLoc = locations.get(targetId);
    if (!targetLoc) continue;

    const from = agent.state.location;
    agent.state.location = targetId;
    agent.state.inTransit = true;

    results.push({
      agentId: id,
      agentName: agent.profile.name,
      from,
      to: targetId,
    });
  }

  return results;
}
