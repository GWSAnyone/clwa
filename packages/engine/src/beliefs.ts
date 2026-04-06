import { getBeliefSourceLabel, getSourceTransferWeight, getSourceDecayRate, getEventTypeDecayRate, getEventLabel } from './event-registry';

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
    // Check for existing belief about same event+object+source — reinforce instead of duplicate.
    // Different sources create separate beliefs (observation vs evidence vs testimony = coexist).
    // Same source about same event+object = merge (two testimonies about same crime reinforce).
    const existing = this.findExisting(belief.eventType, belief.object, belief.source);
    if (existing) {
      // Take the higher confidence, update sourceNpcId if new is more direct
      if (belief.confidence > existing.confidence) {
        existing.confidence = belief.confidence;
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

  /** Find existing belief about same event type, object, AND source */
  private findExisting(eventType: string, object: string | null | undefined, source: string): Belief | null {
    for (const b of this.beliefs.values()) {
      if (b.eventType === eventType && b.object === object && b.source === source) return b;
    }
    return null;
  }

  /** Get max confidence across ALL beliefs about a suspect for a given event category */
  getMaxConfidenceFor(subject: string, eventTypeMatcher?: (eventType: string) => boolean): number {
    let max = 0;
    for (const b of this.beliefs.values()) {
      if (b.subject !== subject) continue;
      if (eventTypeMatcher && !eventTypeMatcher(b.eventType)) continue;
      if (b.confidence > max) max = b.confidence;
    }
    return max;
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
  decayBeliefs(currentDay: number): void {
    for (const b of this.beliefs.values()) {
      const daysSince = currentDay - b.lastUpdated;
      if (daysSince > 0) {
        const sourceRate = getSourceDecayRate(b.source);
        if (sourceRate === 0) continue; // source never decays (e.g. secret knowledge)
        const effectiveRate = sourceRate * getEventTypeDecayRate(b.eventType);
        b.confidence = Math.max(0.1, b.confidence - effectiveRate * daysSince);
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

  /** Compact summary for LLM system prompt (2nd person: "You certain: X committed...") */
  summarizeForPrompt(maxBeliefs = 3, nameResolver?: (id: string) => string): string {
    const resolveName = nameResolver ?? ((id: string) => id);
    const beliefs = this.getAllBeliefs()
      .filter(b => b.object != null || b.subject != null)
      .slice(0, maxBeliefs);
    if (beliefs.length === 0) return '';

    return beliefs.map((b) => {
      const certainty = b.confidence > 0.8 ? 'certain' : b.confidence > 0.5 ? 'believe' : 'heard rumor';
      const verb = getEventLabel(b.eventType);
      if (!verb) return null;
      const who = b.subject ? resolveName(b.subject) : 'someone unknown';
      const target = b.object ? resolveName(b.object) : 'someone';
      const where = b.location ? ` at ${b.location}` : '';
      const how = getBeliefSourceLabel(b.source);
      return `- You ${certainty}: ${who} committed ${verb} against ${target}${where} (${how})`;
    }).filter(Boolean).join('\n');
  }

  /**
   * 3rd person summary for conversation memories (stored in OTHER NPC's memory).
   * Optional eventTypeFilter: only include beliefs matching the conversation topic's eventType.
   * Falls back to top beliefs by confidence if filter yields nothing.
   */
  summarizeForMemory(ownerName: string, maxBeliefs = 2, eventTypeFilter?: string, nameResolver?: (id: string) => string): string {
    const resolveName = nameResolver ?? ((id: string) => id);
    const all = this.getAllBeliefs()
      .filter(b => b.object != null || b.subject != null);

    // Prefer beliefs matching topic eventType; fall back to top by confidence
    let beliefs = eventTypeFilter
      ? all.filter(b => b.eventType === eventTypeFilter).slice(0, maxBeliefs)
      : [];
    if (beliefs.length === 0) beliefs = all.slice(0, maxBeliefs);
    if (beliefs.length === 0) return '';

    return beliefs.map((b) => {
      const conf = b.confidence > 0.7 ? 'is convinced' : b.confidence > 0.4 ? 'believes' : 'has heard';
      const verb = getEventLabel(b.eventType);
      if (!verb) return null;
      const who = b.subject ? resolveName(b.subject) : 'someone';
      const target = b.object ? resolveName(b.object) : 'someone';
      return `${ownerName} ${conf} ${who} committed ${verb} against ${target}`;
    }).filter(Boolean).join('. ');
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
