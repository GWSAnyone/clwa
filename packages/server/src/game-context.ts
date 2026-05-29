/**
 * GameContext — mutable container for all per-game state.
 *
 * Passed by reference to server, routes, WS handlers.
 * On new-game: properties replaced atomically via Object.assign.
 * Handlers destructure at entry point — zero changes to internal logic.
 */

import type { World, Agent, InMemoryEventStore } from '@clwa/engine';
import type { PlayerJournal } from '@clwa/modules';
import type { PositionManager } from './position-manager';

/** Location history entry — where an NPC was at a given game minute */
export interface LocationSnapshot {
  minute: number;
  location: string;
}

/** Location history — ring buffer per NPC for alibi checking */
export class LocationHistory {
  private history = new Map<string, LocationSnapshot[]>();
  private maxEntries = 200;

  record(npcId: string, minute: number, location: string): void {
    let entries = this.history.get(npcId);
    if (!entries) {
      entries = [];
      this.history.set(npcId, entries);
    }
    // Skip if location hasn't changed
    if (entries.length > 0 && entries[entries.length - 1].location === location) return;
    entries.push({ minute, location });
    // Ring buffer
    if (entries.length > this.maxEntries) entries.shift();
  }

  /** Get where NPC was at a specific game minute (linear scan) */
  getLocationAt(npcId: string, minute: number): string | null {
    const entries = this.history.get(npcId);
    if (!entries || entries.length === 0) return null;
    // Before first recorded entry → unknown
    if (minute < entries[0].minute) return null;
    // Find the last entry at or before the given minute
    let result = entries[0].location;
    for (const e of entries) {
      if (e.minute > minute) break;
      result = e.location;
    }
    return result;
  }

  /** Get full history for an NPC (for debug/alibi endpoint) */
  getHistory(npcId: string): LocationSnapshot[] {
    return this.history.get(npcId) ?? [];
  }

  clear(): void {
    this.history.clear();
  }
}

export interface GameContext {
  world: World;
  eventStore: InMemoryEventStore;
  agents: Map<string, Agent>;
  positionManager: PositionManager;
  /** Player's investigation journal (crime-justice module concept; server-owned, persisted in save). */
  journal: PlayerJournal;
  approachContexts: Map<string, string>;
  locationHistory: LocationHistory;
  seed: number;
  /** True during new-game reset. All handlers return 503. */
  resetting: boolean;
  /** Restart with new seed. Set by index.ts, called by routes.ts POST /api/new-game */
  newGame?: (seed: number) => Promise<void>;
  /** Save current state to disk. Set by index.ts, called by routes.ts POST /api/save */
  onSave?: () => void;
}
