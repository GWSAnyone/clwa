/**
 * Inventory subsystem tests (M5 Phase B / B2) — conserved, ownable, transferable item instances.
 * Covers fungible stacking, unique state-bearing instances, removal, and atomic conserved transfer.
 *
 * Run: bun test tests/inventory.test.ts
 */
import { describe, test, expect, beforeAll } from 'bun:test';
import {
  Agent, VectorMemory, BeliefManager, RelationshipGraph, World, ConsequenceEngine, InMemoryEventStore,
  addItem, removeItems, countItems,
} from '@clwa/engine';
import type { AgentProfile, Item } from '@clwa/engine';
import { setupFakeLlm } from './fixtures/fake-llm-provider';

beforeAll(setupFakeLlm);

function makeAgent(id: string): Agent {
  const profile: AgentProfile = {
    id, name: id, role: 'villager', background: 't', speechStyle: 't',
    bigFive: { openness: 0.5, conscientiousness: 0.5, extraversion: 0.5, agreeableness: 0.5, neuroticism: 0.5, honesty: 0.5 },
    enneagram: { type: 5, wing: 4, coreFear: 't', coreDesire: 't', stressType: 7, growthType: 8 },
  };
  return new Agent(profile, {
    alive: true, location: 'market-square', mood: 0, baseMood: 0, moodModifiers: [], status: undefined,
    currentDay: 1, knownFacts: [], beliefs: new BeliefManager(), relationships: new RelationshipGraph(),
    processingState: 'idle', inTransit: false,
  }, new VectorMemory(id, { maxCapacity: 20 }), {});
}
function makeWorld(agents: Map<string, Agent>): World {
  const locations = new Map();
  locations.set('market-square', { id: 'market-square', name: 'Market Square', connections: [] });
  return new World(agents, new InMemoryEventStore(), new ConsequenceEngine([]), {}, {}, locations);
}

describe('Inventory item helpers (pure)', () => {
  test('fungible kinds stack; unique state-bearing items stay distinct', () => {
    const inv: Item[] = [];
    addItem(inv, 'bread', 3);
    addItem(inv, 'bread', 2);              // stacks → 5
    expect(countItems(inv, 'bread')).toBe(5);
    expect(inv.filter((i) => i.kind === 'bread').length).toBe(1); // one stack

    addItem(inv, 'sword', 1, { durability: 80 }); // unique instance
    addItem(inv, 'sword', 1, { durability: 40 }); // distinct instance
    expect(countItems(inv, 'sword')).toBe(2);
    expect(inv.filter((i) => i.kind === 'sword').length).toBe(2); // not stacked (different state)
  });

  test('removeItems is conserved and rejects over-withdrawal', () => {
    const inv: Item[] = [];
    addItem(inv, 'coin', 100);
    expect(removeItems(inv, 'coin', 30)).toBe(true);
    expect(countItems(inv, 'coin')).toBe(70);
    expect(removeItems(inv, 'coin', 999)).toBe(false); // insufficient → no-op
    expect(countItems(inv, 'coin')).toBe(70);
    expect(removeItems(inv, 'coin', 70)).toBe(true);
    expect(countItems(inv, 'coin')).toBe(0);
    expect(inv.length).toBe(0); // empty stack pruned
  });
});

describe('World inventory API', () => {
  test('give / count / has / remove', () => {
    const a = makeAgent('aldric');
    const world = makeWorld(new Map([['aldric', a]]));
    world.giveItem('aldric', 'apple', 5);
    expect(world.countItem('aldric', 'apple')).toBe(5);
    expect(world.hasItem('aldric', 'apple', 5)).toBe(true);
    expect(world.hasItem('aldric', 'apple', 6)).toBe(false);
    expect(world.removeItem('aldric', 'apple', 2)).toBe(true);
    expect(world.countItem('aldric', 'apple')).toBe(3);
    expect(world.getInventory('aldric').length).toBe(1);
  });

  test('transferItem is atomic + conserved; rejects insufficient and missing target', () => {
    const seller = makeAgent('seller');
    const buyer = makeAgent('buyer');
    const world = makeWorld(new Map([['seller', seller], ['buyer', buyer]]));
    world.giveItem('seller', 'grain', 10);

    expect(world.transferItem('seller', 'buyer', 'grain', 4)).toBe(true);
    expect(world.countItem('seller', 'grain')).toBe(6);
    expect(world.countItem('buyer', 'grain')).toBe(4);   // total conserved (10)

    expect(world.transferItem('seller', 'buyer', 'grain', 100)).toBe(false); // insufficient → no-op
    expect(world.countItem('seller', 'grain')).toBe(6);
    expect(world.countItem('buyer', 'grain')).toBe(4);

    expect(world.transferItem('seller', 'ghost', 'grain', 1)).toBe(false); // missing target → no-op
    expect(world.countItem('seller', 'grain')).toBe(6);
  });
});
