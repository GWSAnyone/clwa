/**
 * PositionManager — server-authoritative pixel positions for all entities.
 * Engine operates on location slugs. PositionManager maps slugs to pixel coordinates.
 * Separate from engine to maintain engine purity (engine never knows about pixels).
 */

import type { ArrivalEvent } from '@clwa/engine';

interface EntityPosition {
  x: number;
  y: number;
  targetX?: number;
  targetY?: number;
  inTransit: boolean;
  // Position-authoritative transit (Item 2). Set at startMovement/restoreTransit, advanced by advancePositions.
  transitTo?: string;              // final destination slug
  transitPath?: string[];          // remaining logical hops incl. final; shifted as zones are crossed
  path?: { x: number; y: number }[]; // pixel A* waypoints
  pathIdx?: number;                // index of the next waypoint to walk toward
  hopWaypointIdx?: number[];       // parallel to transitPath: waypoint index at which each hop's zone is entered
}

interface ZoneData {
  id: string;         // slug
  center: [number, number];
  polygon: [number, number][];
}

export class PositionManager {
  private positions: Map<string, EntityPosition> = new Map();
  private zones: Map<string, ZoneData> = new Map();

  // Server-side A* grid (ported from client game.js buildWalkableGrid). Source of truth for NPC routing.
  private walkableTiles: Set<string> = new Set();   // "tx,ty" membership = walkable, absent = water
  private tileCost: Map<string, number> = new Map(); // "tx,ty" → movement cost (edge tiles cost more)
  private tileSize = 64;                              // overwritten by loadWalkableGrid from map-data.json

  // NPC walk speed in px per game-minute (used by advancePositions, the movement broadcast, and the
  // reconnect snapshot). At 1x that's 80 px/real-sec.
  readonly transitSpeed = 80;
  private playerId: string | null = null;            // excluded from advancePositions (INV-16)

  /** Load zone data from world.json locations */
  loadZones(locations: { id: string; zone?: { center: [number, number]; polygon: [number, number][] } }[]): void {
    for (const loc of locations) {
      if (loc.zone) {
        this.zones.set(loc.id, { id: loc.id, center: loc.zone.center, polygon: loc.zone.polygon });
      }
    }
  }

  /**
   * Load the walkable tile grid from map-data.json (server-side A* source of truth).
   * Ported verbatim from client game.js buildWalkableGrid: membership = walkable, absent = water;
   * edge tiles get higher cost so paths prefer interior tiles (reproduces client routing, no water-cut).
   */
  loadWalkableGrid(mapData: { tiles: [number, number, number, number][]; tileSize: number }): void {
    this.tileSize = mapData.tileSize;
    this.walkableTiles = new Set();
    for (const [tx, ty] of mapData.tiles) {
      this.walkableTiles.add(tx + ',' + ty);
    }
    this.tileCost = new Map();
    const offsets: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1], [1, 1], [-1, -1], [1, -1], [-1, 1]];
    for (const [tx, ty] of mapData.tiles) {
      let neighbors = 0;
      for (const [dx, dy] of offsets) {
        if (this.walkableTiles.has((tx + dx) + ',' + (ty + dy))) neighbors++;
      }
      const key = tx + ',' + ty;
      if (neighbors <= 3) this.tileCost.set(key, 8);        // very edge — avoid
      else if (neighbors <= 5) this.tileCost.set(key, 3);   // edge-ish — expensive
      else this.tileCost.set(key, 1);                       // interior — cheap
    }
  }

  /**
   * Server-side A* on the tile grid, pixel → pixel, returns waypoints in pixels.
   * Direct TS port of client game.js astarPath: 8-directional, no corner cutting,
   * edge-weighted (tileCost), collinear-simplified, exact pixel destination appended.
   * Falls back to a direct [{x:toX,y:toY}] segment when no grid is loaded or no path is found.
   */
  computePath(fromX: number, fromY: number, toX: number, toY: number): { x: number; y: number }[] {
    if (this.walkableTiles.size === 0) return [{ x: toX, y: toY }];

    const ts = this.tileSize;
    const startTx = Math.round(fromX / ts), startTy = Math.round(fromY / ts);
    const endTx = Math.round(toX / ts), endTy = Math.round(toY / ts);
    if (startTx === endTx && startTy === endTy) return [{ x: toX, y: toY }];

    interface PathNode { tx: number; ty: number; g: number; f: number; parent: PathNode | null }
    const key = (x: number, y: number) => x + ',' + y;
    const heuristic = (tx: number, ty: number) => Math.abs(tx - endTx) + Math.abs(ty - endTy);

    const openSet: PathNode[] = [{ tx: startTx, ty: startTy, g: 0, f: heuristic(startTx, startTy), parent: null }];
    const closed = new Set<string>();
    const dirs: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];
    const dirCost = [1, 1, 1, 1, 1.41, 1.41, 1.41, 1.41];

    let found: PathNode | null = null;
    let iterations = 0;
    const maxIter = 2000;

    while (openSet.length > 0 && iterations++ < maxIter) {
      let bestIdx = 0;
      for (let i = 1; i < openSet.length; i++) {
        if (openSet[i].f < openSet[bestIdx].f) bestIdx = i;
      }
      const current = openSet.splice(bestIdx, 1)[0];
      const ck = key(current.tx, current.ty);

      if (current.tx === endTx && current.ty === endTy) { found = current; break; }
      if (closed.has(ck)) continue;
      closed.add(ck);

      for (let d = 0; d < dirs.length; d++) {
        const ntx = current.tx + dirs[d][0], nty = current.ty + dirs[d][1];
        const nk = key(ntx, nty);
        if (closed.has(nk)) continue;
        if (!this.isWalkable(ntx, nty)) continue;
        // Diagonal: require both adjacent cardinals walkable (no corner cutting)
        if (d >= 4) {
          if (!this.isWalkable(current.tx + dirs[d][0], current.ty) || !this.isWalkable(current.tx, current.ty + dirs[d][1])) continue;
        }
        const ng = current.g + dirCost[d] * (this.tileCost.get(nk) ?? 1);
        const nf = ng + heuristic(ntx, nty);
        openSet.push({ tx: ntx, ty: nty, g: ng, f: nf, parent: current });
      }
    }

    if (!found) return [{ x: toX, y: toY }]; // fallback direct

    const tilePath: { x: number; y: number }[] = [];
    let node: PathNode | null = found;
    while (node) {
      tilePath.unshift({ x: node.tx * ts, y: node.ty * ts });
      node = node.parent;
    }

    // Simplify: keep only turns (drop collinear points), then append exact destination
    const simplified: { x: number; y: number }[] = [tilePath[0]];
    for (let i = 1; i < tilePath.length - 1; i++) {
      const prev = tilePath[i - 1], curr = tilePath[i], next = tilePath[i + 1];
      const dx1 = curr.x - prev.x, dy1 = curr.y - prev.y;
      const dx2 = next.x - curr.x, dy2 = next.y - curr.y;
      if (dx1 !== dx2 || dy1 !== dy2) simplified.push(curr);
    }
    simplified.push({ x: toX, y: toY });
    return simplified;
  }

  /**
   * Sanity check for tilemap/zone drift: returns zone slugs whose center tile is NOT walkable.
   * map-data.json (tilemap) and world.json (zone polygons) are independent sources that can drift.
   */
  checkZoneCentersWalkable(): string[] {
    if (this.walkableTiles.size === 0) return [];
    const ts = this.tileSize;
    const offenders: string[] = [];
    for (const [id, zone] of this.zones) {
      const tx = Math.round(zone.center[0] / ts), ty = Math.round(zone.center[1] / ts);
      if (!this.isWalkable(tx, ty)) offenders.push(id);
    }
    return offenders;
  }

  /** Initialize NPC position using seeded random within zone */
  initPosition(entityId: string, locationSlug: string): EntityPosition {
    const zone = this.zones.get(locationSlug);
    if (!zone) {
      const pos: EntityPosition = { x: 0, y: 0, inTransit: false };
      this.positions.set(entityId, pos);
      return pos;
    }

    const { x, y } = this.seededPointInZone(entityId, zone);
    const pos: EntityPosition = { x, y, inTransit: false };
    this.positions.set(entityId, pos);
    return pos;
  }

  /** Get current position */
  getPosition(entityId: string): EntityPosition | undefined {
    return this.positions.get(entityId);
  }

  /** Get all positions */
  getAllPositions(): Map<string, EntityPosition> {
    return this.positions;
  }

  /**
   * Snapshot of an entity's in-flight transit for client reconnect-resume: the REMAINING pixel
   * waypoints (from the current pathIdx), the destination slug, and the walk speed. null if not in transit.
   */
  getActiveTransit(entityId: string): { path: { x: number; y: number }[]; transitTo: string; speed: number } | null {
    const pos = this.positions.get(entityId);
    if (!pos || !pos.inTransit || !pos.path || pos.transitTo === undefined) return null;
    return { path: pos.path.slice(pos.pathIdx ?? 0), transitTo: pos.transitTo, speed: this.transitSpeed };
  }

  /** Set position directly (for player updates or restore from save) */
  setPosition(entityId: string, x: number, y: number): void {
    const pos = this.positions.get(entityId);
    if (pos) {
      pos.x = x; pos.y = y; pos.inTransit = false;
      pos.targetX = undefined; pos.targetY = undefined;
    } else {
      this.positions.set(entityId, { x, y, inTransit: false });
    }
  }

  /** Mark which entity is the player — excluded from server-side NPC advancement (INV-16). */
  setPlayerId(id: string): void { this.playerId = id; }

  /**
   * Build a server A* pixel path through a sequence of logical zone hops — intermediates routed through
   * zone centers, the final hop through a seeded zone point — plus the parallel hopWaypointIdx markers.
   * Shared by startMovement (fresh transit) and restoreTransit (save/load resume). Returns null if no hop
   * resolves to a known zone / the resulting path is empty.
   */
  private _buildTransitPath(entityId: string, fromX: number, fromY: number, hops: string[]): { path: { x: number; y: number }[]; hopWaypointIdx: number[]; transitPath: string[]; finalX: number; finalY: number } | null {
    let px = fromX, py = fromY;
    const path: { x: number; y: number }[] = [];
    const transitPath: string[] = [];
    const hopWaypointIdx: number[] = [];
    for (let i = 0; i < hops.length; i++) {
      const slug = hops[i];
      const zone = this.zones.get(slug);
      if (!zone) continue;
      const isFinal = i === hops.length - 1;
      const target = isFinal ? this.seededPointInZone(entityId, zone) : { x: zone.center[0], y: zone.center[1] };
      const seg = this.computePath(px, py, target.x, target.y);
      for (const wp of seg) path.push(wp);
      transitPath.push(slug);
      hopWaypointIdx.push(path.length); // pathIdx ≥ this ⟺ reached this hop's zone target
      px = target.x; py = target.y;
    }
    if (path.length === 0) return null;
    return { path, hopWaypointIdx, transitPath, finalX: px, finalY: py };
  }

  /**
   * NPC starts moving along a logical slug path (Item 2, position-authoritative). `logicalPath` is
   * findPath output (start..dest inclusive); the hops to walk are everything after the current location.
   */
  startMovement(entityId: string, logicalPath: string[]): { targetX: number; targetY: number; distance: number; path: { x: number; y: number }[] } {
    const pos = this.positions.get(entityId);
    const empty = { targetX: pos?.x ?? 0, targetY: pos?.y ?? 0, distance: 0, path: [] as { x: number; y: number }[] };
    if (!pos || logicalPath.length === 0) return empty;

    const hops = logicalPath.length > 1 ? logicalPath.slice(1) : logicalPath;
    const built = this._buildTransitPath(entityId, pos.x, pos.y, hops);
    if (!built) return empty;

    pos.path = built.path;
    pos.pathIdx = 0;
    pos.transitPath = built.transitPath;
    pos.hopWaypointIdx = built.hopWaypointIdx;
    pos.transitTo = built.transitPath[built.transitPath.length - 1];
    pos.targetX = built.finalX;
    pos.targetY = built.finalY;
    pos.inTransit = true;

    let distance = 0, px = pos.x, py = pos.y;
    for (const wp of built.path) { distance += Math.sqrt((wp.x - px) ** 2 + (wp.y - py) ** 2); px = wp.x; py = wp.y; }
    return { targetX: built.finalX, targetY: built.finalY, distance, path: built.path };
  }

  /**
   * Advance all in-transit NPC pixel positions by `dtMinutes` of game time (position-authoritative).
   * Returns final arrivals (→ world.handleArrivals) and intermediate zone crossings
   * (→ world.handleIntermediateLocationUpdate). The player is never advanced here (INV-16).
   *
   * Transitions are WAYPOINT-DRIVEN, not raw pixel-in-polygon: each logical hop is tied to a path
   * waypoint index (hopWaypointIdx), so an A* route that geometrically clips an off-route zone does NOT
   * false-fire, and the final zone is not arrived early. Motion is segment-sampled (sub-steps ≤ one tile)
   * so a zone narrower than transitSpeed*dt is not overshot at high gameSpeed.
   */
  advancePositions(dtMinutes: number): { arrivals: ArrivalEvent[]; intermediates: { entityId: string; location: string }[] } {
    const arrivals: ArrivalEvent[] = [];
    const intermediates: { entityId: string; location: string }[] = [];
    const budget = this.transitSpeed * dtMinutes;
    const subStepCap = this.tileSize; // ≤ one tile per sub-step → don't overshoot narrow zones/waypoints

    for (const [entityId, pos] of this.positions) {
      if (entityId === this.playerId) continue;                       // INV-16
      if (!pos.inTransit || !pos.path || pos.path.length === 0) continue;

      // Zero-distance / already inside destination — arrive idempotently before any motion.
      if (this._processTransitTransitions(entityId, pos, arrivals, intermediates)) continue;

      let remaining = budget;
      while (remaining > 0 && pos.path && pos.pathIdx !== undefined && pos.pathIdx < pos.path.length) {
        const wp = pos.path[pos.pathIdx];
        const dx = wp.x - pos.x, dy = wp.y - pos.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist === 0) { pos.pathIdx++; continue; }
        const step = Math.min(remaining, dist, subStepCap);
        if (step >= dist) {
          pos.x = wp.x; pos.y = wp.y; pos.pathIdx++;
          remaining -= dist;
        } else {
          const r = step / dist;
          pos.x += dx * r; pos.y += dy * r;
          remaining -= step;
        }
        if (this._processTransitTransitions(entityId, pos, arrivals, intermediates)) break;
      }

      // Path exhausted but still in transit (pathological) → force arrival, snap to zone center.
      if (pos.inTransit && pos.path && pos.pathIdx !== undefined && pos.pathIdx >= pos.path.length) {
        const zone = pos.transitTo ? this.zones.get(pos.transitTo) : undefined;
        if (zone) { pos.x = zone.center[0]; pos.y = zone.center[1]; }
        if (pos.transitTo) arrivals.push({ entityId, location: pos.transitTo });
        this._clearTransitPath(pos);
      }
    }
    return { arrivals, intermediates };
  }

  /**
   * Recompute the A* path from the entity's CURRENT pixel to its destination (save/load resume). The saved
   * `transitPath` is the REMAINING logical hops (incl. final) so multi-hop intermediate crossings resume too;
   * falls back to a direct single hop. Returns false (snaps to zone center, clears transit) if unreachable.
   */
  restoreTransit(entityId: string, transitTo: string, transitPath?: string[]): boolean {
    const pos = this.positions.get(entityId);
    if (!pos) return false;
    const zone = this.zones.get(transitTo);
    if (!zone) return false;

    const hops = (transitPath && transitPath.length > 0) ? transitPath : [transitTo];
    const built = this._buildTransitPath(entityId, pos.x, pos.y, hops);
    if (!built) {
      pos.x = zone.center[0]; pos.y = zone.center[1];
      pos.inTransit = false;
      return false;
    }

    pos.path = built.path;
    pos.pathIdx = 0;
    pos.transitPath = built.transitPath;
    pos.hopWaypointIdx = built.hopWaypointIdx;
    pos.transitTo = built.transitPath[built.transitPath.length - 1];
    pos.targetX = built.finalX;
    pos.targetY = built.finalY;
    pos.inTransit = true;
    return true;
  }

  /**
   * Emit intermediate-zone crossings (every hop except the final) by waypoint progress, then the final
   * arrival once no earlier hop is pending. Returns true if the entity arrived (transit cleared).
   * Arrival is checked AFTER intermediates so the last hop is never double-emitted.
   */
  private _processTransitTransitions(
    entityId: string,
    pos: EntityPosition,
    arrivals: ArrivalEvent[],
    intermediates: { entityId: string; location: string }[],
  ): boolean {
    while (
      pos.transitPath && pos.transitPath.length > 1 &&
      pos.hopWaypointIdx && pos.hopWaypointIdx.length > 0 &&
      pos.pathIdx !== undefined && pos.pathIdx >= pos.hopWaypointIdx[0]
    ) {
      intermediates.push({ entityId, location: pos.transitPath[0] });
      pos.transitPath.shift();
      pos.hopWaypointIdx.shift();
    }

    if (!pos.transitPath || pos.transitPath.length <= 1) {
      const finalSlug = pos.transitTo;
      const zone = finalSlug ? this.zones.get(finalSlug) : undefined;
      const atEnd = !pos.path || (pos.pathIdx !== undefined && pos.pathIdx >= pos.path.length);
      const inZone = !!zone && this.pointInPolygon(pos.x, pos.y, zone.polygon);
      if (finalSlug && (atEnd || inZone)) {
        arrivals.push({ entityId, location: finalSlug });
        this._clearTransitPath(pos);
        return true;
      }
    }
    return false;
  }

  /** Reset all position-authoritative transit fields on a position. */
  private _clearTransitPath(pos: EntityPosition): void {
    pos.inTransit = false;
    pos.path = undefined;
    pos.pathIdx = 0;
    pos.transitTo = undefined;
    pos.transitPath = undefined;
    pos.hopWaypointIdx = undefined;
    pos.targetX = undefined;
    pos.targetY = undefined;
  }

  /**
   * Idempotent safety no-op (Item 2). Position-authoritative arrival (advancePositions) already moved the
   * NPC into the destination zone and cleared transit, so this must NOT snap to a stale targetX/targetY
   * (the legacy teleport bug). Clears any lingering transit defensively without moving the pixel position.
   */
  completeMovement(entityId: string): void {
    const pos = this.positions.get(entityId);
    if (!pos || !pos.inTransit) return;
    this._clearTransitPath(pos);
  }

  /**
   * Compute conversation approach points (midpoint ± offset) for two entities AND the server A*
   * waypoints each walks to reach them (Item 2: no client-side NPC A*). This is cosmetic intra-location
   * repositioning, not a transit, so inTransit is left untouched (conversing NPCs are at a location).
   */
  computeApproachPoints(entityA: string, entityB: string): { ax: number; ay: number; bx: number; by: number; aWaypoints: { x: number; y: number }[]; bWaypoints: { x: number; y: number }[] } | null {
    const posA = this.positions.get(entityA);
    const posB = this.positions.get(entityB);
    if (!posA || !posB) return null;

    const midX = (posA.x + posB.x) / 2;
    const midY = (posA.y + posB.y) / 2;

    // Offset slightly so they don't overlap
    const dx = posB.x - posA.x;
    const dy = posB.y - posA.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    const offsetX = len > 1 ? (dx / len) * 20 : 20;
    const offsetY = len > 1 ? (dy / len) * 20 : 0;

    const result = {
      ax: Math.round(midX - offsetX),
      ay: Math.round(midY - offsetY),
      bx: Math.round(midX + offsetX),
      by: Math.round(midY + offsetY),
    };

    // Waypoints from each NPC's CURRENT pixel to its approach point (server-authoritative routing).
    const aWaypoints = this.computePath(posA.x, posA.y, result.ax, result.ay);
    const bWaypoints = this.computePath(posB.x, posB.y, result.bx, result.by);

    // Authoritative end state = approach points (do NOT clear inTransit — see method doc).
    posA.x = result.ax; posA.y = result.ay;
    posB.x = result.bx; posB.y = result.by;

    return { ...result, aWaypoints, bWaypoints };
  }

  /** Determine which location zone a point is inside (for player location detection) */
  getLocationAtPoint(x: number, y: number): string | null {
    for (const [id, zone] of this.zones) {
      if (this.pointInPolygon(x, y, zone.polygon)) {
        return id;
      }
    }
    return null;
  }

  /** Validate player position — must be within some zone or reasonable distance */
  validatePosition(x: number, y: number): boolean {
    // Check if within any zone polygon (with margin)
    for (const zone of this.zones.values()) {
      if (this.pointInPolygon(x, y, zone.polygon)) return true;
    }
    // Allow positions near zone edges
    for (const zone of this.zones.values()) {
      const dx = x - zone.center[0], dy = y - zone.center[1];
      if (Math.sqrt(dx * dx + dy * dy) < 600) return true; // within reasonable distance
    }
    return false;
  }

  /**
   * Serialize positions for save.json. Persists the LIVE pixel (x,y) — NOT the transit target — plus the
   * remaining logical hops (transitPath, incl. final) so a mid-transit NPC resumes its full multi-hop walk.
   */
  toJSON(): Record<string, { x: number; y: number; inTransit?: boolean; transitTo?: string; transitPath?: string[] }> {
    const data: Record<string, { x: number; y: number; inTransit?: boolean; transitTo?: string; transitPath?: string[] }> = {};
    for (const [id, pos] of this.positions) {
      data[id] = (pos.inTransit && pos.transitTo)
        ? { x: pos.x, y: pos.y, inTransit: true, transitTo: pos.transitTo, transitPath: pos.transitPath }
        : { x: pos.x, y: pos.y };
    }
    return data;
  }

  /**
   * Restore positions from save.json (warns on out-of-bounds entries). Returns the entities that were
   * mid-transit (destination slug + remaining hops) so the boot path can re-establish the A* path + engine
   * intent. Old saves (no inTransit field) load as at-destination — backward compatible, no migration.
   */
  loadFromJSON(data: Record<string, { x: number; y: number; inTransit?: boolean; transitTo?: string; transitPath?: string[] }>): { id: string; transitTo: string; transitPath?: string[] }[] {
    const pending: { id: string; transitTo: string; transitPath?: string[] }[] = [];
    for (const [id, saved] of Object.entries(data)) {
      const { x, y } = saved;
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        console.warn(`  [Save] Invalid position for ${id}: (${x}, ${y}) — skipping`);
        continue;
      }
      if (this.zones.size > 0 && !this.validatePosition(x, y)) {
        console.warn(`  [Save] Out-of-bounds position for ${id}: (${x}, ${y})`);
      }
      this.positions.set(id, { x, y, inTransit: false });
      if (saved.inTransit && saved.transitTo) pending.push({ id, transitTo: saved.transitTo, transitPath: saved.transitPath });
    }
    return pending;
  }

  // ─── Private ───

  /** Deterministic seeded point within zone polygon */
  private seededPointInZone(entityId: string, zone: ZoneData): { x: number; y: number } {
    const hash = this.simpleHash(entityId + zone.id);
    const cx = zone.center[0], cy = zone.center[1];

    // Use hash to compute angle + radius from centroid
    const angle = ((hash & 0xFFFF) / 0xFFFF) * Math.PI * 2;
    const radius = ((hash >> 16 & 0xFF) / 0xFF) * 30 + 10; // 10-40px from center

    const px = cx + Math.cos(angle) * radius;
    const py = cy + Math.sin(angle) * radius;

    // Verify point is inside polygon, fallback to center
    if (this.pointInPolygon(px, py, zone.polygon)) {
      return { x: Math.round(px), y: Math.round(py) };
    }
    return { x: cx, y: cy };
  }

  /** Simple deterministic hash from string */
  private simpleHash(str: string): number {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash + str.charCodeAt(i)) & 0xFFFFFFFF;
    }
    return hash >>> 0;
  }

  /** Ray-casting point-in-polygon test */
  private pointInPolygon(px: number, py: number, polygon: [number, number][]): boolean {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i][0], yi = polygon[i][1];
      const xj = polygon[j][0], yj = polygon[j][1];
      if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) {
        inside = !inside;
      }
    }
    return inside;
  }

  /** Tile-grid walkability test (ported from client game.js isWalkable). */
  private isWalkable(tx: number, ty: number): boolean {
    return this.walkableTiles.has(tx + ',' + ty);
  }
}
