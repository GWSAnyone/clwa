/**
 * Chat-staleness TTL tests (M6) — the real-time conversation reset that replaced clear-on-NPC-switch.
 * Covers the pure staleness decision (`_isStaleConversation`) across every edge case (first turn, fresh,
 * exact boundary, stale, clock-backwards), config defaulting, and the `clearChatHistory` reset action.
 * No LLM/network: the predicate is pure and `resetAgentSessions` is a no-op without a claude provider.
 *
 * Run: bun test tests/chat-ttl.test.ts
 */
import { describe, test, expect, beforeAll } from 'bun:test';
import { Agent, VectorMemory, BeliefManager, RelationshipGraph } from '@clwa/engine';
import type { AgentProfile } from '@clwa/engine';
import { setupFakeLlm } from './fixtures/fake-llm-provider';

beforeAll(setupFakeLlm);

const STALE = 300_000; // engine default (5 real minutes)

function makeProfile(id: string): AgentProfile {
  return {
    id, name: id.charAt(0).toUpperCase() + id.slice(1), role: 'villager', background: 't', speechStyle: 't',
    bigFive: { openness: 0.5, conscientiousness: 0.5, extraversion: 0.5, agreeableness: 0.5, neuroticism: 0.5, honesty: 0.5 },
    enneagram: { type: 5, wing: 4, coreFear: 't', coreDesire: 't', stressType: 7, growthType: 8 },
  };
}
function makeAgent(opts?: { chatStaleMs?: number }): Agent {
  return new Agent(makeProfile('ttl-npc'), {
    alive: true, location: 'market-square', mood: 0, baseMood: 0, moodModifiers: [], status: undefined,
    currentDay: 1, knownFacts: [], beliefs: new BeliefManager(), relationships: new RelationshipGraph(),
    processingState: 'idle', inTransit: false,
  }, new VectorMemory('ttl-npc', { maxCapacity: 20 }), opts ?? {});
}

describe('chat-staleness TTL — _isStaleConversation predicate', () => {
  test('first turn is never stale (lastChatMs = 0)', () => {
    const a = makeAgent() as any;
    expect(a._lastChatMs).toBe(0);
    // Even an enormous "now" is not stale before the first turn is recorded.
    expect(a._isStaleConversation(10 * STALE)).toBe(false);
  });

  test('fresh conversation (gap < staleMs) is not stale', () => {
    const a = makeAgent() as any;
    a._lastChatMs = 1_000_000;
    expect(a._isStaleConversation(1_000_000 + STALE - 1)).toBe(false);
  });

  test('exact boundary (gap == staleMs) is not stale (strict >)', () => {
    const a = makeAgent() as any;
    a._lastChatMs = 1_000_000;
    expect(a._isStaleConversation(1_000_000 + STALE)).toBe(false);
  });

  test('past boundary (gap > staleMs) is stale', () => {
    const a = makeAgent() as any;
    a._lastChatMs = 1_000_000;
    expect(a._isStaleConversation(1_000_000 + STALE + 1)).toBe(true);
  });

  test('clock running backwards is not stale (conservative — keep continuity)', () => {
    const a = makeAgent() as any;
    a._lastChatMs = 5_000_000;
    expect(a._isStaleConversation(1_000_000)).toBe(false);
  });

  test('default staleMs is 5 minutes (300000) when no option given', () => {
    const a = makeAgent() as any;
    expect(a.chatStaleMs).toBe(STALE);
  });

  test('custom chatStaleMs from options is honored by the predicate', () => {
    const a = makeAgent({ chatStaleMs: 15_000 }) as any;
    expect(a.chatStaleMs).toBe(15_000);
    a._lastChatMs = 1_000_000;
    expect(a._isStaleConversation(1_000_000 + 15_001)).toBe(true);
    expect(a._isStaleConversation(1_000_000 + 14_999)).toBe(false);
  });
});

describe('chat-staleness TTL — clearChatHistory reset', () => {
  test('clears short-term buffer + rolling summary, resolves without a claude provider', async () => {
    const a = makeAgent() as any;
    a._chatHistory = [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello there' }];
    a._historySummary = 'they greeted me earlier';
    await a.clearChatHistory(); // must not throw even with no warm claude session to reset
    expect(a._chatHistory).toEqual([]);
    expect(a._historySummary).toBe('');
  });
});
