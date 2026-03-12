import type { LocationGraph } from './world-types';

/**
 * BFS pathfinding through the location graph.
 * Returns array of location NAMES from start to end (inclusive).
 * Returns empty array if no path exists.
 */
export function findPath(
  graph: LocationGraph,
  fromName: string,
  toName: string,
): string[] {
  if (fromName === toName) return [fromName];

  // Build name→id and id→name maps
  const nameToId = new Map<string, string>();
  const idToName = new Map<string, string>();
  for (const [id, loc] of graph) {
    nameToId.set(loc.name, id);
    idToName.set(id, loc.name);
  }

  const startId = nameToId.get(fromName);
  const endId = nameToId.get(toName);
  if (!startId || !endId) return [];

  // BFS
  const visited = new Set<string>([startId]);
  const parent = new Map<string, string>();
  const queue: string[] = [startId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const loc = graph.get(current);
    if (!loc) continue;

    for (const neighborId of loc.connections) {
      if (visited.has(neighborId)) continue;
      visited.add(neighborId);
      parent.set(neighborId, current);

      if (neighborId === endId) {
        // Reconstruct path
        const path: string[] = [];
        let node: string | undefined = endId;
        while (node !== undefined) {
          path.unshift(idToName.get(node) ?? node);
          node = parent.get(node);
        }
        return path;
      }

      queue.push(neighborId);
    }
  }

  return []; // no path
}

/**
 * Get the next hop (location name) on the shortest path from → to.
 * Returns null if already there or no path exists.
 */
export function nextHop(
  graph: LocationGraph,
  fromName: string,
  toName: string,
): string | null {
  const path = findPath(graph, fromName, toName);
  if (path.length <= 1) return null; // already there or no path
  return path[1]; // next step
}
