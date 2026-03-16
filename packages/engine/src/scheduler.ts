import type { Agent } from './agent';
import type { WorldConfig } from './world-types';
import { isEventCategory, isStatusAbsent } from './event-registry';

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

        // Score: based on recent memory importance
        const score = await this.scorePair(agentA, agentB, key);
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

    return winner;
  }

  /**
   * Score a pair based on how much they have to discuss.
   * Higher score = more urgent/interesting conversation.
   */
  private async scorePair(agentA: Agent, agentB: Agent, key: string): Promise<number> {
    let score = 1; // Base: NPCs in the same social space want to talk sometimes

    // Belief-based scoring: unshared crime knowledge = high conversation value
    const beliefsA = agentA.state.beliefs?.getAllBeliefs().filter(
      (b) => isEventCategory(b.eventType, 'crime') && b.confidence >= 0.3,
    ) ?? [];
    const beliefsB = agentB.state.beliefs?.getAllBeliefs().filter(
      (b) => isEventCategory(b.eventType, 'crime') && b.confidence >= 0.3,
    ) ?? [];

    // A knows something B doesn't
    for (const ba of beliefsA) {
      const bKnows = beliefsB.some((bb) => bb.eventType === ba.eventType && bb.object === ba.object);
      score += bKnows ? 2 : 5; // Unshared = much higher value
    }

    // B knows something A doesn't
    for (const bb of beliefsB) {
      const aKnows = beliefsA.some((ba) => ba.eventType === bb.eventType && ba.object === bb.object);
      score += aKnows ? 2 : 5;
    }

    // Relationship warmth bonus
    const rel = agentA.state.relationships?.getRelationship(agentB.profile.id);
    if (rel && rel.sentiment > 0.2) score += 2;

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
