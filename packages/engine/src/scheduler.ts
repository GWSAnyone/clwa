import type { Agent } from './agent';
import type { WorldConfig } from './world-types';
import { isStatusAbsent, isTransferable } from './event-registry';

/** Pair key for cooldown tracking */
function pairKey(a: string, b: string): string {
  return [a, b].sort().join(':');
}

export interface ScoredPair {
  a: string;
  b: string;
  score: number;
}

export class ConversationScheduler {
  /** pairKey → tick number of last conversation */
  private cooldowns: Map<string, number> = new Map();
  /** pairKey → conversation count today (for diversity) */
  private dailyCounts: Map<string, number> = new Map();
  /** npcId → tick number of last conversation (for social hunger) */
  private npcLastConversation: Map<string, number> = new Map();
  private config: WorldConfig;

  constructor(config: WorldConfig) {
    this.config = config;
  }

  /**
   * Find the best pair of NPCs to have a conversation this tick.
   * Returns null if no suitable pair found.
   */
  async findPair(
    agents: Map<string, Agent>,
    currentTick: number,
    excludeIds?: Set<string>,
  ): Promise<ScoredPair | null> {
    const candidates: ScoredPair[] = [];
    const agentList = Array.from(agents.entries())
      .filter(([id, a]) => {
        if (!a.state.alive || excludeIds?.has(id)) return false;
        if (a.profile.isPlayer) return false; // Player initiates conversations manually
        return !isStatusAbsent(a.state.status);
      });

    // Generate all co-located pairs
    for (let i = 0; i < agentList.length; i++) {
      for (let j = i + 1; j < agentList.length; j++) {
        const [idA, agentA] = agentList[i];
        const [idB, agentB] = agentList[j];

        // Must be in same location
        if (agentA.state.location !== agentB.state.location) continue;

        // Check cooldown
        const key = pairKey(idA, idB);
        const lastTick = this.cooldowns.get(key) ?? -Infinity;
        if (currentTick - lastTick < this.config.pairCooldownTicks) continue;

        // Score: balanced social + information value
        const score = this.scorePair(agentA, agentB, key, currentTick);
        if (score >= this.config.minConversationScore) {
          candidates.push({ a: idA, b: idB, score });
        }
      }
    }

    if (candidates.length === 0) return null;

    // Sort by score descending, add small random noise for variety
    candidates.sort((x, y) => (y.score + Math.random() * 2) - (x.score + Math.random() * 2));

    const winner = candidates[0];
    // Record cooldown
    this.cooldowns.set(pairKey(winner.a, winner.b), currentTick);
    // Track daily count
    const key = pairKey(winner.a, winner.b);
    this.dailyCounts.set(key, (this.dailyCounts.get(key) ?? 0) + 1);
    // Track individual NPC last conversation
    this.npcLastConversation.set(winner.a, currentTick);
    this.npcLastConversation.set(winner.b, currentTick);

    return winner;
  }

  /**
   * Score a pair — balanced between social connection and information exchange.
   * Crime beliefs still matter but don't dominate.
   */
  private scorePair(agentA: Agent, agentB: Agent, key: string, currentTick: number): number {
    let score = 3; // Base: NPCs share a social space (was 1 — too low)

    // Belief-based scoring: information exchange value (reduced from +5/+2)
    const beliefsA = agentA.state.beliefs?.getAllBeliefs().filter(
      (b) => isTransferable(b.eventType) && b.confidence >= 0.3,
    ) ?? [];
    const beliefsB = agentB.state.beliefs?.getAllBeliefs().filter(
      (b) => isTransferable(b.eventType) && b.confidence >= 0.3,
    ) ?? [];

    for (const ba of beliefsA) {
      const bKnows = beliefsB.some((bb) => bb.eventType === ba.eventType && bb.object === ba.object);
      score += bKnows ? 1 : 3; // Reduced from 2/5
    }
    for (const bb of beliefsB) {
      const aKnows = beliefsA.some((ba) => ba.eventType === bb.eventType && ba.object === bb.object);
      score += aKnows ? 1 : 3;
    }

    // Relationship warmth (increased from +2)
    const rel = agentA.state.relationships?.getRelationship(agentB.profile.id);
    if (rel) {
      if (rel.sentiment > 0.3) score += 4;        // Close friends — strong pull
      else if (rel.sentiment > 0.1) score += 2;   // Friendly
      else if (rel.sentiment < -0.2) score += 1;   // Tension — still has conversation value
    }

    // Extraversion compatibility — extraverts seek conversation, introverts avoid it
    const eA = agentA.profile.bigFive?.extraversion ?? 0.5;
    const eB = agentB.profile.bigFive?.extraversion ?? 0.5;
    score += ((eA - 0.3) + (eB - 0.3)) * 2; // E=0.9+0.9→+2.4, E=0.5+0.5→+0.8, E=0.2+0.2→-0.4

    // Social hunger — NPC who hasn't talked recently wants to chat
    const lastA = this.npcLastConversation.get(agentA.profile.id) ?? 0;
    const lastB = this.npcLastConversation.get(agentB.profile.id) ?? 0;
    const hungerA = Math.min(3, (currentTick - lastA) / 24); // max +3 after 24 ticks (6h game)
    const hungerB = Math.min(3, (currentTick - lastB) / 24);
    score += (hungerA + hungerB) * 0.5; // +0 to +3

    // Diversity penalty: each conversation today with same pair reduces score
    const todayCount = this.dailyCounts.get(key) ?? 0;
    score -= todayCount * 3;

    return Math.max(0, score);
  }

  /** Reset daily conversation counts (call on day advance) */
  resetDailyCounts(): void {
    this.dailyCounts.clear();
  }
}
