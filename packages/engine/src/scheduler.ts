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
  /** pairKey → game minute of last conversation */
  private cooldowns: Map<string, number> = new Map();
  /** pairKey → conversation count today (for diversity) */
  private dailyCounts: Map<string, number> = new Map();
  /** npcId → game minute of last conversation (for social hunger) */
  private npcLastConversation: Map<string, number> = new Map();
  private config: WorldConfig;

  constructor(config: WorldConfig) {
    this.config = config;
  }

  /** Check if a pair is on conversation cooldown */
  isOnCooldown(a: string, b: string, gameMinute: number): boolean {
    const lastMinute = this.cooldowns.get(pairKey(a, b)) ?? -Infinity;
    return gameMinute - lastMinute < this.config.pairCooldownMinutes;
  }

  /**
   * Find the best pair of NPCs to have a conversation.
   * Returns null if no suitable pair found.
   */
  async findPair(
    agents: Map<string, Agent>,
    gameMinute: number,
    excludeIds?: Set<string>,
  ): Promise<ScoredPair | null> {
    const candidates: ScoredPair[] = [];
    const agentList = Array.from(agents.entries())
      .filter(([id, a]) => {
        if (!a.state.alive || excludeIds?.has(id)) return false;
        if (a.profile.isPlayer) return false; // Player initiates conversations manually
        if (a.state.inPlayerChat === true) return false; // busy in the player's chat — don't pull into an NPC↔NPC convo (P6)
        if (a.state.inTransit) return false; // NPC still walking — can't talk
        return !isStatusAbsent(a.state.status);
      });

    // Generate all co-located pairs
    for (let i = 0; i < agentList.length; i++) {
      for (let j = i + 1; j < agentList.length; j++) {
        const [idA, agentA] = agentList[i];
        const [idB, agentB] = agentList[j];

        // Must be in same location
        if (agentA.state.location !== agentB.state.location) continue;

        // Check pair cooldown
        const key = pairKey(idA, idB);
        const lastMinute = this.cooldowns.get(key) ?? -Infinity;
        if (gameMinute - lastMinute < this.config.pairCooldownMinutes) continue;

        // Per-NPC cooldown: avoid one NPC dominating consecutive conversations
        const npcCd = this.config.npcConversationCooldownMinutes ?? 30;
        const lastA = this.npcLastConversation.get(idA) ?? -Infinity;
        const lastB = this.npcLastConversation.get(idB) ?? -Infinity;
        if (gameMinute - lastA < npcCd || gameMinute - lastB < npcCd) continue;

        // Score: balanced social + information value
        const score = this.scorePair(agentA, agentB, key, gameMinute);
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
    this.cooldowns.set(pairKey(winner.a, winner.b), gameMinute);
    // Track daily count
    const key = pairKey(winner.a, winner.b);
    this.dailyCounts.set(key, (this.dailyCounts.get(key) ?? 0) + 1);
    // Track individual NPC last conversation
    this.npcLastConversation.set(winner.a, gameMinute);
    this.npcLastConversation.set(winner.b, gameMinute);

    return winner;
  }

  /**
   * Score a pair — balanced between social connection and information exchange.
   * Crime beliefs still matter but don't dominate.
   */
  private scorePair(agentA: Agent, agentB: Agent, key: string, gameMinute: number): number {
    let score = 3; // Base: NPCs share a social space

    // Belief-based scoring: information exchange value
    const beliefsA = agentA.state.beliefs?.getAllBeliefs().filter(
      (b) => isTransferable(b.eventType) && b.confidence >= 0.3,
    ) ?? [];
    const beliefsB = agentB.state.beliefs?.getAllBeliefs().filter(
      (b) => isTransferable(b.eventType) && b.confidence >= 0.3,
    ) ?? [];

    for (const ba of beliefsA) {
      const bKnows = beliefsB.some((bb) => bb.eventType === ba.eventType && bb.object === ba.object);
      score += bKnows ? 1 : 3;
    }
    for (const bb of beliefsB) {
      const aKnows = beliefsA.some((ba) => ba.eventType === bb.eventType && ba.object === bb.object);
      score += aKnows ? 1 : 3;
    }

    // Relationship warmth
    const rel = agentA.state.relationships?.getRelationship(agentB.profile.id);
    if (rel) {
      if (rel.sentiment > 0.3) score += 4;
      else if (rel.sentiment > 0.1) score += 2;
      else if (rel.sentiment < -0.2) score += 1;
    }

    // Extraversion compatibility
    const eA = agentA.profile.bigFive?.extraversion ?? 0.5;
    const eB = agentB.profile.bigFive?.extraversion ?? 0.5;
    score += ((eA - 0.3) + (eB - 0.3)) * 2;

    // Social hunger — NPC who hasn't talked recently wants to chat (360 game min = 6h)
    const lastA = this.npcLastConversation.get(agentA.profile.id) ?? Math.max(0, gameMinute - 180);
    const lastB = this.npcLastConversation.get(agentB.profile.id) ?? Math.max(0, gameMinute - 180);
    const hungerA = Math.min(3, (gameMinute - lastA) / 360); // max +3 after 360 min (6h game)
    const hungerB = Math.min(3, (gameMinute - lastB) / 360);
    score += (hungerA + hungerB) * 0.5;

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
