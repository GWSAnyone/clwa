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
 * Process random NPC movement. Mobile NPCs have a chance to start
 * walking to an adjacent location (transit, not teleport).
 * NPCs in excludeIds or already in transit are skipped.
 */
export function processMovement(
  agents: Map<string, Agent>,
  locations: LocationGraph,
  config: NpcMovementConfig,
  excludeIds: Set<string> | undefined,
  gameMinute: number,
  minutesPerHop: number,
): MovementResult[] {
  const results: MovementResult[] = [];

  for (const [id, agent] of agents) {
    if (agent.profile.isPlayer) continue; // Player excluded from random movement (isPlayer guard)
    if (!agent.state.alive) continue;
    if (isStatusAbsent(agent.state.status)) continue;
    if (agent.state.inTransit) continue; // already walking
    if (!config.mobileNpcs.has(id)) continue;
    if (excludeIds?.has(id)) continue;
    if (Math.random() > config.moveProbability) continue;

    const found = findLocation(locations, agent.state.location);
    if (!found || found.loc.connections.length === 0) continue;

    const targetId = found.loc.connections[
      Math.floor(Math.random() * found.loc.connections.length)
    ];
    const targetLoc = locations.get(targetId);
    if (!targetLoc) continue;

    const from = agent.state.location;
    const hopMin = minutesPerHop;

    // Start transit (1 hop to adjacent location)
    agent.state.inTransit = true;
    agent.state.transitTo = targetId;
    agent.state.transitPath = [targetId];
    agent.state.transitProgress = 0;
    agent.state.transitStartMinute = gameMinute;
    agent.state.transitDuration = hopMin;

    results.push({
      agentId: id,
      agentName: agent.profile.name,
      from,
      to: targetId,
    });
  }

  return results;
}
