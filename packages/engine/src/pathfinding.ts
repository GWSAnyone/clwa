import type { LocationGraph } from './world-types';

/**
 * BFS pathfinding through the location graph.
 * Accepts location IDs (graph keys). Returns array of IDs from start to end (inclusive).
 * Falls back to name→id lookup if input is a display name (backwards compat).
 * Returns empty array if no path exists.
 */
export function findPath(
  graph: LocationGraph,
  from: string,
  to: string,
): string[] {
  // Resolve input: accept both IDs and display names
  const fromId = graph.has(from) ? from : resolveNameToId(graph, from);
  const toId = graph.has(to) ? to : resolveNameToId(graph, to);
  if (!fromId || !toId) return [];
  if (fromId === toId) return [fromId];

  // BFS
  const visited = new Set<string>([fromId]);
  const parent = new Map<string, string>();
  const queue: string[] = [fromId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const loc = graph.get(current);
    if (!loc) continue;

    for (const neighborId of loc.connections) {
      if (visited.has(neighborId)) continue;
      visited.add(neighborId);
      parent.set(neighborId, current);

      if (neighborId === toId) {
        // Reconstruct path (IDs)
        const path: string[] = [];
        let node: string | undefined = toId;
        while (node !== undefined) {
          path.unshift(node);
          node = parent.get(node);
        }
        return path;
      }

      queue.push(neighborId);
    }
  }

  return []; // no path
}

/** Resolve a display name to a graph ID */
function resolveNameToId(graph: LocationGraph, name: string): string | null {
  for (const [id, loc] of graph) {
    if (loc.name === name) return id;
  }
  return null;
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
