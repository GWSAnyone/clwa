import { getBeliefSourceLabel, getSourceTransferWeight, getEventLabel } from './event-registry';

// BeliefSource is a string — modules can add new sources via registry
export type BeliefSource = string;

export interface Belief {
  id: string;
  /** Event type: "NPC_KILLED", etc. */
  eventType: string;
  /** Who did it (null if unknown) */
  subject: string | null;
  /** Who was it done to */
  object: string;
  /** Where it happened */
  location: string;
  /** 0.0 - 1.0 */
  confidence: number;
  /** How the NPC learned this */
  source: BeliefSource;
  /** Who told them (null if witnessed directly) */
  sourceNpcId: string | null;
  /** Game day when formed */
  gameDay: number;
  /** Game day when last reinforced */
  lastUpdated: number;
}

/** Default confidence by source type */
export const SOURCE_CONFIDENCE: Record<BeliefSource, number> = {
  witness: 0.95,
  body_discovery: 0.7,
  testimony: 0.6,
  rumor: 0.4,
  interrogation: 0.7,
  observation: 0.8,
  cover_up: 0.95,
  deduction: 0.5,
  evidence: 0.5,
  perpetrator: 1.0,
};

export class BeliefManager {
  private beliefs: Map<string, Belief> = new Map();

  addBelief(belief: Belief): void {
    // Check for existing belief about same event+object — reinforce instead of duplicate
    const existing = this.findExisting(belief.eventType, belief.object);
    if (existing) {
      // Take the higher confidence, update source if new is more direct
      if (belief.confidence > existing.confidence) {
        existing.confidence = belief.confidence;
        existing.source = belief.source;
        existing.sourceNpcId = belief.sourceNpcId;
      }
      // Update subject if we now have a specific suspect (replace null)
      if (belief.subject && !existing.subject) {
        existing.subject = belief.subject;
        existing.confidence = Math.max(existing.confidence, belief.confidence);
      }
      existing.lastUpdated = belief.gameDay;
      return;
    }
    this.beliefs.set(belief.id, belief);
  }

  /** Find existing belief about same event type and object */
  private findExisting(eventType: string, object: string): Belief | null {
    for (const b of this.beliefs.values()) {
      if (b.eventType === eventType && b.object === object) return b;
    }
    return null;
  }

  queryBeliefs(filter: {
    eventType?: string;
    subject?: string;
    object?: string;
  }): Belief[] {
    const results: Belief[] = [];
    for (const b of this.beliefs.values()) {
      if (filter.eventType && b.eventType !== filter.eventType) continue;
      if (filter.subject && b.subject !== filter.subject) continue;
      if (filter.object && b.object !== filter.object) continue;
      results.push(b);
    }
    return results.sort((a, b) => b.confidence - a.confidence);
  }

  /** Decay all beliefs per day advance. Rumors fade faster, direct evidence holds longer. */
  decayBeliefs(currentDay: number, _decayRate = 0.02): void {
    const SOURCE_DECAY: Record<string, number> = {
      witness: 0.01, body_discovery: 0.01, observation: 0.015,
      testimony: 0.02, interrogation: 0.02, deduction: 0.03,
      rumor: 0.04, cover_up: 0.01, perpetrator: 0.01,
    };
    for (const b of this.beliefs.values()) {
      const daysSince = currentDay - b.lastUpdated;
      if (daysSince > 0) {
        const rate = SOURCE_DECAY[b.source] ?? 0.02;
        b.confidence = Math.max(0.1, b.confidence - rate * daysSince);
      }
    }
  }

  getStrongestBelief(eventType: string, object: string): Belief | null {
    let best: Belief | null = null;
    for (const b of this.beliefs.values()) {
      if (b.eventType !== eventType) continue;
      if (b.object !== object) continue;
      if (!best || b.confidence > best.confidence) best = b;
    }
    return best;
  }

  getAllBeliefs(): Belief[] {
    return Array.from(this.beliefs.values()).sort((a, b) => b.confidence - a.confidence);
  }

  /** Compact summary for LLM system prompt */
  summarizeForPrompt(maxBeliefs = 3): string {
    const beliefs = this.getAllBeliefs().slice(0, maxBeliefs);
    if (beliefs.length === 0) return '';

    return beliefs.map((b) => {
      const certainty = b.confidence > 0.8 ? 'certain' : b.confidence > 0.5 ? 'believe' : 'heard rumor';
      const who = b.subject ?? 'someone unknown';
      const verb = getEventLabel(b.eventType);
      const how = getBeliefSourceLabel(b.source);
      return `- You ${certainty}: ${who} ${verb} ${b.object} at ${b.location} (${how})`;
    }).join('\n');
  }

  /** Serializable snapshot */
  toJSON(): Belief[] {
    return this.getAllBeliefs();
  }

  /** Restore from saved snapshot */
  static fromJSON(data: Belief[]): BeliefManager {
    const manager = new BeliefManager();
    for (const belief of data) {
      manager.beliefs.set(belief.id, belief);
    }
    return manager;
  }
}
