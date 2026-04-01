/**
 * GameContext — mutable container for all per-game state.
 *
 * Passed by reference to server, routes, WS handlers.
 * On new-game: properties replaced atomically via Object.assign.
 * Handlers destructure at entry point — zero changes to internal logic.
 */

import type { World, Agent, InMemoryEventStore } from '@clwa/engine';
import type { PositionManager } from './position-manager';

export interface GameContext {
  world: World;
  eventStore: InMemoryEventStore;
  agents: Map<string, Agent>;
  positionManager: PositionManager;
  approachContexts: Map<string, string>;
  seed: number;
  /** True during new-game reset. All handlers return 503. */
  resetting: boolean;
  /** Restart with new seed. Set by index.ts, called by routes.ts POST /api/new-game */
  newGame?: (seed: number) => Promise<void>;
  /** Save current state to disk. Set by index.ts, called by routes.ts POST /api/save */
  onSave?: () => void;
}
