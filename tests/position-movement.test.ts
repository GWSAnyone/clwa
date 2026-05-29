/**
 * Position-authoritative movement (Item 2, SPEC-position-movement).
 *  - Phase A: server-side A* (computePath), transit-time estimation, advancePositions arrival
 *    detection (zone-boundary, zero-distance, player guard), waypoint-driven multi-hop + off-route.
 *  - Cutover: the engine API (World.handleArrivals / handleIntermediateLocationUpdate) and the
 *    end-to-end chain advancePositions → handleArrivals (what the server wires into onTimeUpdate).
 */
import { describe, test, expect } from 'bun:test';
import { PositionManager } from '../packages/server/src/position-manager';
import { World, Agent, ConsequenceEngine, InMemoryEventStore, BeliefManager, RelationshipGraph } from '@clwa/engine';
import type { AgentProfile, AgentState, MovementResult } from '@clwa/engine';

// Tiny synthetic map: a walkable corridor along ty=0, tx 0..5. tileSize 64 → px 0..320.
const MAP = {
  tiles: [[0, 0, 1, 1], [1, 0, 1, 1], [2, 0, 1, 1], [3, 0, 1, 1], [4, 0, 1, 1], [5, 0, 1, 1]] as [number, number, number, number][],
  tileSize: 64,
};
const box = (cx: number, cy: number, r = 50): [number, number][] =>
  [[cx - r, cy - r], [cx + r, cy - r], [cx + r, cy + r], [cx - r, cy + r]];
const ZONES = [
  { id: 'a', zone: { center: [0, 0] as [number, number], polygon: box(0, 0) } },
  { id: 'c', zone: { center: [160, 0] as [number, number], polygon: box(160, 0) } },
  { id: 'b', zone: { center: [320, 0] as [number, number], polygon: box(320, 0) } },
];

function mgr(zones = ZONES): PositionManager {
  const pm = new PositionManager();
  pm.loadZones(zones);
  pm.loadWalkableGrid(MAP);
  return pm;
}

describe('PositionManager — A* + estimation (Phase A)', () => {
  test('computePath returns walkable waypoints ending at the exact destination', () => {
    const pm = mgr();
    const path = pm.computePath(0, 0, 320, 0);
    expect(path.length).toBeGreaterThanOrEqual(2);
    expect(path[path.length - 1]).toEqual({ x: 320, y: 0 }); // exact pixel destination appended
    for (const wp of path) {
      const tx = Math.round(wp.x / 64), ty = Math.round(wp.y / 64);
      expect(MAP.tiles.some(([a, b]) => a === tx && b === ty)).toBe(true); // never cuts water
    }
  });

  test('computePath falls back to a direct segment when no grid is loaded', () => {
    const pm = new PositionManager();
    expect(pm.computePath(0, 0, 320, 0)).toEqual([{ x: 320, y: 0 }]);
  });

  test('checkZoneCentersWalkable: clean when centers are on the grid, flags drift otherwise', () => {
    expect(mgr().checkZoneCentersWalkable()).toEqual([]);
    const drifted = new PositionManager();
    drifted.loadZones([{ id: 'off', zone: { center: [9999, 9999], polygon: box(9999, 9999) } }]);
    drifted.loadWalkableGrid(MAP);
    expect(drifted.checkZoneCentersWalkable()).toEqual(['off']);
  });

});

describe('PositionManager.advancePositions — arrival + multi-hop (Phase A)', () => {
  test('NPC arrives when it physically enters the destination zone', () => {
    const pm = mgr();
    pm.initPosition('npc1', 'a');
    expect(pm.restoreTransit('npc1', 'b')).toBe(true);

    let arrived: { entityId: string; location: string } | undefined;
    for (let i = 0; i < 5 && !arrived; i++) arrived = pm.advancePositions(10).arrivals[0];
    expect(arrived).toMatchObject({ entityId: 'npc1', location: 'b' });
    const pos = pm.getPosition('npc1')!;
    expect(pos.inTransit).toBe(false);
    expect(Math.abs(pos.x - 320)).toBeLessThan(60); // landed in/near zone b
  });

  test('zero-distance: an NPC already inside the destination arrives immediately, no motion', () => {
    const pm = mgr();
    pm.initPosition('npc2', 'b');
    const startX = pm.getPosition('npc2')!.x;
    pm.restoreTransit('npc2', 'b');
    const { arrivals } = pm.advancePositions(10);
    expect(arrivals).toEqual([{ entityId: 'npc2', location: 'b' }]);
    expect(pm.getPosition('npc2')!.x).toBe(startX); // did not move
    expect(pm.getPosition('npc2')!.inTransit).toBe(false);
  });

  test('player is never advanced server-side (INV-16)', () => {
    const pm = mgr();
    pm.setPlayerId('player');
    pm.initPosition('player', 'a');
    pm.restoreTransit('player', 'b');
    expect(pm.advancePositions(10).arrivals).toEqual([]);
    expect(pm.getPosition('player')!.inTransit).toBe(true); // untouched
  });

  test('multi-hop: crosses the intermediate zone (location update, no stop) THEN arrives', () => {
    const pm = mgr();
    pm.initPosition('npc3', 'a');
    pm.startMovement('npc3', ['a', 'c', 'b']); // findPath-style logical path (start..dest inclusive)

    const ints: { entityId: string; location: string }[] = [];
    const arrs: { entityId: string; location: string }[] = [];
    for (let i = 0; i < 20 && pm.getPosition('npc3')!.inTransit; i++) {
      const r = pm.advancePositions(2); // 160px/tick — small steps so the intermediate is not skipped
      ints.push(...r.intermediates);
      arrs.push(...r.arrivals);
    }
    expect(ints).toContainEqual({ entityId: 'npc3', location: 'c' }); // intermediate fired
    expect(arrs).toContainEqual({ entityId: 'npc3', location: 'b' }); // final arrival fired
    expect(arrs).not.toContainEqual({ entityId: 'npc3', location: 'c' }); // 'c' never emitted as arrival
  });

  test('off-route zone is NOT reported as an intermediate (waypoint-driven, not pixel-in-polygon)', () => {
    // 'off' polygon overlaps the a→b corridor but is NOT on the logical path → must never fire.
    const pm = mgr([...ZONES, { id: 'off', zone: { center: [100, 0] as [number, number], polygon: box(100, 0) } }]);
    pm.initPosition('npc4', 'a');
    pm.startMovement('npc4', ['a', 'b']); // direct, no intermediate hop
    const ints: { entityId: string; location: string }[] = [];
    for (let i = 0; i < 20 && pm.getPosition('npc4')!.inTransit; i++) ints.push(...pm.advancePositions(2).intermediates);
    expect(ints).toEqual([]); // 'off' clipped geometrically but never reported
  });
});

// ─── Cutover: engine API + end-to-end chain ───

function makeAgent(id: string, name: string, location: string, stateOverrides: Partial<AgentState> = {}): Agent {
  const profile: AgentProfile = {
    id, name, role: 'villager', background: 't', speechStyle: 'plain',
    bigFive: { openness: .5, conscientiousness: .5, extraversion: .5, agreeableness: .5, neuroticism: .5, honesty: .5 },
    enneagram: { type: 5, wing: 4, coreFear: 'x', coreDesire: 'y', stressType: 7, growthType: 8 },
  };
  const state: AgentState = {
    alive: true, status: null as any, location, mood: .1, baseMood: .1, moodModifiers: [],
    currentDay: 1, knownFacts: [], beliefs: new BeliefManager(), relationships: new RelationshipGraph(),
    ...stateOverrides,
  };
  const memory = { recall: async () => [], observe: async () => {}, toJSON: () => [], loadState: () => {} } as any;
  return new Agent(profile, state, memory);
}

function makeWorld(agents: Map<string, Agent>, onMovement: (m: MovementResult[]) => void): World {
  const locations = new Map<string, { id: string; name: string; connections: string[] }>();
  locations.set('a', { id: 'a', name: 'A', connections: ['c'] });
  locations.set('c', { id: 'c', name: 'C', connections: ['a', 'b'] });
  locations.set('b', { id: 'b', name: 'B', connections: ['c'] });
  return new World(agents, new InMemoryEventStore(), new ConsequenceEngine([]), {}, { onMovement }, locations as any);
}

describe('World.handleArrivals / handleIntermediateLocationUpdate (Item 2 engine API)', () => {
  test('handleArrivals updates location, clears transit, resets processingState, fires onMovement', () => {
    const moves: MovementResult[] = [];
    const npc = makeAgent('npc', 'Npc', 'a', { inTransit: true, transitTo: 'b', transitPath: ['c', 'b'], processingState: 'in_transit' });
    const world = makeWorld(new Map([['npc', npc]]), (m) => moves.push(...m));
    world.handleArrivals([{ entityId: 'npc', location: 'b' }]);
    expect(npc.state.location).toBe('b');
    expect(npc.state.inTransit).toBe(false);
    expect(npc.state.transitTo).toBeUndefined();
    expect(npc.state.processingState).toBe('idle'); // no active goal
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ agentId: 'npc', to: 'b', arrived: true });
  });

  test('handleArrivals is idempotent for an NPC not in transit (no double-fire)', () => {
    const moves: MovementResult[] = [];
    const npc = makeAgent('npc', 'Npc', 'b', { inTransit: false });
    const world = makeWorld(new Map([['npc', npc]]), (m) => moves.push(...m));
    world.handleArrivals([{ entityId: 'npc', location: 'b' }]);
    expect(moves).toHaveLength(0);
  });

  test('handleArrivals does NOT clobber an NPC pulled into conversation on the same tick', () => {
    const npc = makeAgent('npc', 'Npc', 'a', { inTransit: true, transitTo: 'b', processingState: 'in_conversation' });
    const world = makeWorld(new Map([['npc', npc]]), () => {});
    world.handleArrivals([{ entityId: 'npc', location: 'b' }]);
    expect(npc.state.location).toBe('b');                       // location still updates
    expect(npc.state.inTransit).toBe(false);                    // transit cleared
    expect(npc.state.processingState).toBe('in_conversation');  // NOT reset to idle
  });

  test('handleIntermediateLocationUpdate updates location WITHOUT stopping transit or broadcasting', () => {
    const moves: MovementResult[] = [];
    const npc = makeAgent('npc', 'Npc', 'a', { inTransit: true, transitTo: 'b', transitPath: ['c', 'b'], processingState: 'in_transit' });
    const world = makeWorld(new Map([['npc', npc]]), (m) => moves.push(...m));
    world.handleIntermediateLocationUpdate('npc', 'c');
    expect(npc.state.location).toBe('c');
    expect(npc.state.inTransit).toBe(true);              // keeps walking
    expect(npc.state.processingState).toBe('in_transit');
    expect(moves).toHaveLength(0);                        // no arrival broadcast
  });
});

describe('Cutover end-to-end: advancePositions → handleArrivals (Item 2)', () => {
  test('NPC physically walks into the destination zone and the engine records arrival exactly once', () => {
    const moves: MovementResult[] = [];
    const npc = makeAgent('npc', 'Npc', 'a', { inTransit: true, transitTo: 'b', transitPath: ['b'], processingState: 'in_transit' });
    const world = makeWorld(new Map([['npc', npc]]), (m) => moves.push(...m));

    const pm = mgr();
    pm.initPosition('npc', 'a');
    expect(pm.restoreTransit('npc', 'b')).toBe(true);

    for (let i = 0; i < 10 && npc.state.inTransit; i++) {
      const { arrivals, intermediates } = pm.advancePositions(2);
      world.handleArrivals(arrivals);
      for (const it of intermediates) world.handleIntermediateLocationUpdate(it.entityId, it.location);
    }
    expect(npc.state.location).toBe('b');
    expect(npc.state.inTransit).toBe(false);
    expect(moves.filter(m => m.arrived && m.to === 'b')).toHaveLength(1); // arrival fired exactly once
  });
});

describe('Save/load mid-transit (Item 2, D5 / INV-21)', () => {
  test('persists the LIVE pixel (not the target) and resumes to exactly one arrival', () => {
    const pm = mgr();
    pm.initPosition('npc', 'a');
    pm.startMovement('npc', ['a', 'b']);
    pm.advancePositions(1); pm.advancePositions(1); // partway, not arrived
    const liveX = pm.getPosition('npc')!.x;
    expect(pm.getPosition('npc')!.inTransit).toBe(true);

    const save = pm.toJSON();
    expect(save['npc']).toMatchObject({ inTransit: true, transitTo: 'b' });
    expect(save['npc'].x).toBe(liveX); // LIVE pixel saved — NOT the destination target

    // Reload into a fresh manager.
    const pm2 = mgr();
    const pending = pm2.loadFromJSON(save);
    expect(pending).toContainEqual({ id: 'npc', transitTo: 'b', transitPath: ['b'] });
    expect(pm2.getPosition('npc')!.x).toBe(liveX);          // restored to saved live pixel (not teleported)
    expect(pm2.getPosition('npc')!.inTransit).toBe(false);  // intent re-established by restoreTransit, not load

    expect(pm2.restoreTransit('npc', 'b')).toBe(true);
    const arrivals: { entityId: string; location: string }[] = [];
    for (let i = 0; i < 10 && pm2.getPosition('npc')!.inTransit; i++) arrivals.push(...pm2.advancePositions(2).arrivals);
    expect(arrivals.filter(a => a.location === 'b')).toHaveLength(1); // resumes → arrives exactly once
  });

  test('multi-hop save/load resumes the remaining intermediate hops (not a direct single hop)', () => {
    const pm = mgr();
    pm.initPosition('npc', 'a');
    pm.startMovement('npc', ['a', 'c', 'b']); // remaining hops = ['c','b']
    pm.advancePositions(1); // nudge forward, still before zone c

    const save = pm.toJSON();
    expect(save['npc'].transitPath).toEqual(['c', 'b']); // remaining multi-hop persisted

    const pm2 = mgr();
    const pending = pm2.loadFromJSON(save);
    expect(pending).toContainEqual({ id: 'npc', transitTo: 'b', transitPath: ['c', 'b'] });
    expect(pm2.restoreTransit('npc', 'b', pending[0].transitPath)).toBe(true);

    const ints: { entityId: string; location: string }[] = [];
    const arrs: { entityId: string; location: string }[] = [];
    for (let i = 0; i < 20 && pm2.getPosition('npc')!.inTransit; i++) {
      const r = pm2.advancePositions(2);
      ints.push(...r.intermediates);
      arrs.push(...r.arrivals);
    }
    expect(ints).toContainEqual({ entityId: 'npc', location: 'c' }); // intermediate resumed after reload
    expect(arrs).toContainEqual({ entityId: 'npc', location: 'b' });
  });

  test('old-format save (no inTransit field) loads as at-rest, no pending transit (back-compat)', () => {
    const pm = mgr();
    const pending = pm.loadFromJSON({ npc: { x: 100, y: 0 } });
    expect(pending).toEqual([]);
    expect(pm.getPosition('npc')).toMatchObject({ x: 100, y: 0, inTransit: false });
  });
});
