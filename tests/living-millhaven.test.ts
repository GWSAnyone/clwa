/**
 * Living Millhaven demo — Phase 1 (mechanics made real in the crime module, zero engine edits).
 * Covers: real theft moves conserved inventory + thief joins the emergent `criminals` faction; and the
 * merchant-guild-alarm CG rule (the `faction` condition op driving a collective-actor reaction).
 *
 * Run: bun test tests/living-millhaven.test.ts
 */
import { describe, test, expect, beforeAll } from 'bun:test';
import {
  Agent, BeliefManager, RelationshipGraph, ConsequenceEngine,
  getStepHandler, addItem,
} from '@clwa/engine';
import type { AgentProfile, StepExecutionContext, WorldEvent, WorldContext, ConsequenceRule } from '@clwa/engine';
import { registerCrimeJusticeModule, CRIME_CG_RULES } from '@clwa/modules';

let registered = false;
beforeAll(() => { if (!registered) { registerCrimeJusticeModule(); registered = true; } });

function makeAgent(id: string, factions?: string[]): Agent {
  const profile: AgentProfile = {
    id, name: id.charAt(0).toUpperCase() + id.slice(1), role: 'villager', background: 't', speechStyle: 't',
    bigFive: { openness: 0.5, conscientiousness: 0.5, extraversion: 0.5, agreeableness: 0.5, neuroticism: 0.5, honesty: 0.5 },
    enneagram: { type: 5, wing: 4, coreFear: 't', coreDesire: 't', stressType: 7, growthType: 8 },
  };
  // Stub memory — avoids Qdrant/LLM; store/observe are no-ops (we assert state, not memories).
  const memory = { store: async () => {}, recall: async () => [], observe: async () => {}, toJSON: () => [], loadState: () => {} } as any;
  const agent = new Agent(profile, {
    alive: true, location: 'market-square', mood: 0, baseMood: 0, moodModifiers: [], status: undefined,
    currentDay: 1, knownFacts: [], beliefs: new BeliefManager(), relationships: new RelationshipGraph(),
    processingState: 'idle', inTransit: false,
  }, memory, {});
  if (factions) agent.state.factions = [...factions];
  return agent;
}

describe('Phase 1 — real theft (B2) moves conserved inventory + marks criminal (B3)', () => {
  test('steal_from transfers a real item from victim to thief and the thief joins `criminals`', async () => {
    const thief = makeAgent('thief');
    const merchant = makeAgent('merchant', ['merchants_guild']);
    merchant.state.inventory = [];
    addItem(merchant.state.inventory, 'bread', 5);
    const agents = new Map([['thief', thief], ['merchant', merchant]]);

    const emitted: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const ctx = {
      goal: { id: 'g1', type: 'theft', ownerId: 'thief', priority: 5, currentStep: 0, state: 'active', waitTicks: 0 },
      step: { action: 'steal_from', targetId: 'merchant', importance: 5 },
      ownerId: 'thief', owner: thief, agents,
      locations: new Map(), goalManager: {} as any,
      runInteraction: (async () => {}) as any,
      addMoodModifier: () => {},
      onEmitEvent: async (e: { type: string; payload: Record<string, unknown> }) => { emitted.push(e); },
    } as unknown as StepExecutionContext;

    const handler = getStepHandler('steal_from')!;
    expect(handler).toBeTruthy();
    await handler(ctx);

    // Conserved transfer: merchant down 1, thief up 1, total unchanged (5).
    const merchantBread = (merchant.state.inventory ?? []).filter((i) => i.kind === 'bread').reduce((s, i) => s + i.quantity, 0);
    const thiefBread = (thief.state.inventory ?? []).filter((i) => i.kind === 'bread').reduce((s, i) => s + i.quantity, 0);
    expect(merchantBread).toBe(4);
    expect(thiefBread).toBe(1);
    expect(merchantBread + thiefBread).toBe(5);

    // Emitted event carries the stolen kind; thief is now in the criminals faction.
    expect(emitted.some((e) => e.type === 'GOODS_STOLEN' && e.payload.stolenKind === 'bread')).toBe(true);
    expect(thief.state.factions).toContain('criminals');
  });

  test('steal_from with an empty victim inventory still emits (event-only fallback), no item created', async () => {
    const thief = makeAgent('thief2');
    const merchant = makeAgent('merchant2', ['merchants_guild']); // no inventory set
    const agents = new Map([['thief2', thief], ['merchant2', merchant]]);
    const emitted: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const ctx = {
      goal: { id: 'g2', type: 'theft', ownerId: 'thief2', priority: 5, currentStep: 0, state: 'active', waitTicks: 0 },
      step: { action: 'steal_from', targetId: 'merchant2', importance: 5 },
      ownerId: 'thief2', owner: thief, agents,
      locations: new Map(), goalManager: {} as any,
      runInteraction: (async () => {}) as any,
      addMoodModifier: () => {},
      onEmitEvent: async (e: { type: string; payload: Record<string, unknown> }) => { emitted.push(e); },
    } as unknown as StepExecutionContext;
    await getStepHandler('steal_from')!(ctx);
    expect(emitted.some((e) => e.type === 'GOODS_STOLEN')).toBe(true);
    expect((thief.state.inventory ?? []).length).toBe(0); // nothing to take → no phantom item
    expect(thief.state.factions).toContain('criminals');
  });
});

describe('Phase 1 — merchant-guild-alarm CG rule (B3 faction op drives a collective reaction)', () => {
  test('GOODS_STOLEN alarms merchants_guild members at the location, not outsiders', async () => {
    const rule = CRIME_CG_RULES.find((r) => r.id === 'merchant-guild-alarm');
    expect(rule).toBeDefined();

    const guildA = makeAgent('guildA', ['merchants_guild']);
    const guildB = makeAgent('guildB', ['merchants_guild']);
    const outsider = makeAgent('outsider', ['town_guard']);
    const plain = makeAgent('plain'); // no faction
    const agents = new Map([['guildA', guildA], ['guildB', guildB], ['outsider', outsider], ['plain', plain]]);
    const engine = new ConsequenceEngine([rule as ConsequenceRule]);
    const ctx = { agents } as unknown as WorldContext;
    const event: WorldEvent = {
      id: 'e1', type: 'GOODS_STOLEN', subject: 'thief', object: 'guildA',
      location: 'market-square', gameDay: 1, importance: 4,
      payload: { perpetratorName: 'Thief', affectedName: 'GuildA' },
    };

    const results = await engine.process(event, ctx);
    const alarm = results.find((r) => r.rule.id === 'merchant-guild-alarm');
    expect(alarm).toBeDefined();
    // every merchants_guild member at the location reacts; town_guard + factionless do not.
    expect(alarm!.targets).toContain('guildA');
    expect(alarm!.targets).toContain('guildB');
    expect(alarm!.targets).not.toContain('outsider');
    expect(alarm!.targets).not.toContain('plain');
  });
});
