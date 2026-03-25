/**
 * PositionManager — server-authoritative pixel positions for all entities.
 * Engine operates on location slugs. PositionManager maps slugs to pixel coordinates.
 * Separate from engine to maintain engine purity (engine never knows about pixels).
 */

export interface EntityPosition {
  x: number;
  y: number;
  targetX?: number;
  targetY?: number;
  inTransit: boolean;
}

export interface ZoneData {
  id: string;         // slug
  center: [number, number];
  polygon: [number, number][];
}

export class PositionManager {
  private positions: Map<string, EntityPosition> = new Map();
  private zones: Map<string, ZoneData> = new Map();

  /** Load zone data from world.json locations */
  loadZones(locations: { id: string; zone?: { center: [number, number]; polygon: [number, number][] } }[]): void {
    for (const loc of locations) {
      if (loc.zone) {
        this.zones.set(loc.id, { id: loc.id, center: loc.zone.center, polygon: loc.zone.polygon });
      }
    }
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

  /** NPC starts moving to new location — compute target and mark in-transit */
  startMovement(entityId: string, targetLocationSlug: string): { targetX: number; targetY: number } {
    const zone = this.zones.get(targetLocationSlug);
    const pos = this.positions.get(entityId);
    if (!zone || !pos) return { targetX: 0, targetY: 0 };

    // Commit previous movement — self-heal position drift
    if (pos.targetX !== undefined && pos.targetY !== undefined) {
      pos.x = pos.targetX;
      pos.y = pos.targetY;
    }

    const target = this.seededPointInZone(entityId, zone);
    pos.targetX = target.x;
    pos.targetY = target.y;
    pos.inTransit = true;
    return { targetX: target.x, targetY: target.y };
  }

  /** NPC arrived at destination */
  completeMovement(entityId: string): void {
    const pos = this.positions.get(entityId);
    if (pos && pos.targetX !== undefined && pos.targetY !== undefined) {
      pos.x = pos.targetX;
      pos.y = pos.targetY;
      pos.targetX = undefined;
      pos.targetY = undefined;
      pos.inTransit = false;
    }
  }

  /** Compute approach points for conversation (midpoint between two entities) */
  computeApproachPoints(entityA: string, entityB: string): { ax: number; ay: number; bx: number; by: number } | null {
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

    // Update positions
    posA.x = result.ax; posA.y = result.ay; posA.inTransit = false;
    posB.x = result.bx; posB.y = result.by; posB.inTransit = false;

    return result;
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
    // Allow positions near zone edges (50px margin)
    for (const zone of this.zones.values()) {
      const dx = x - zone.center[0], dy = y - zone.center[1];
      if (Math.sqrt(dx * dx + dy * dy) < 600) return true; // within reasonable distance
    }
    return false;
  }

  /** Serialize positions for save.json */
  toJSON(): Record<string, { x: number; y: number }> {
    const data: Record<string, { x: number; y: number }> = {};
    for (const [id, pos] of this.positions) {
      // Save final position (if in transit, save target)
      data[id] = {
        x: pos.targetX ?? pos.x,
        y: pos.targetY ?? pos.y,
      };
    }
    return data;
  }

  /** Restore positions from save.json */
  loadFromJSON(data: Record<string, { x: number; y: number }>): void {
    for (const [id, { x, y }] of Object.entries(data)) {
      this.positions.set(id, { x, y, inTransit: false });
    }
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
}
