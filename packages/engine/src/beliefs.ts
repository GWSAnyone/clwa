import { getBeliefSourceLabel, getSourceTransferWeight, getSourceDecayRate, getEventTypeDecayRate, getEventLabelSafe, phraseBelief } from './event-registry';

// BeliefSource is a string — modules can add new sources via registry
export type BeliefSource = string;

export interface Belief {
  id: string;
  /** Event type: "NPC_KILLED", etc. */
  eventType: string;
  /** Who did it (null if unknown) */
  subject: string | null;
  /** Who was it done to (null if unknown) */
  object: string | null;
  /** Where it happened (null if unknown) */
  location: string | null;
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

/** Recency-weighted belief score (confidence × recencyFactor) — newer beliefs rank higher. The SINGLE ranking
 *  shared by the prompt path (summarizeForPrompt) and the memory snapshot (Agent.serializeMemoryState) so both
 *  order beliefs identically. recencyFactor: ~0.91 at 1 day, 0.5 at 10 days since last reinforcement. */
function beliefRecencyScore(b: Belief, currentDay: number): number {
  const daysSince = Math.max(0, currentDay - b.lastUpdated);
  return b.confidence * (1 / (1 + daysSince * 0.1));
}

/** Human recency cue for a belief line, mirroring the memory time labels (today / yesterday / N days ago). */
function beliefRecencyLabel(daysSince: number): string {
  return daysSince <= 0 ? 'today' : daysSince === 1 ? 'yesterday' : `${daysSince} days ago`;
}

export class BeliefManager {
  private beliefs: Map<string, Belief> = new Map();

  addBelief(belief: Belief): void {
    // Contract guard
    if (!belief.id) throw new Error(`[Belief] Missing id for ${belief.eventType}`);
    if (!belief.eventType) throw new Error(`[Belief] Missing eventType`);
    if (!belief.source) throw new Error(`[Belief] Missing source for ${belief.eventType}`);
    if (typeof belief.confidence !== 'number' || belief.confidence < 0 || belief.confidence > 1) {
      throw new Error(`[Belief] Invalid confidence ${belief.confidence} for ${belief.eventType}`);
    }
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

  /** Top beliefs ranked by confidence × recency — the SINGLE ranking, used by summarizeForPrompt AND
   *  Agent.serializeMemoryState (was two divergent orderings: confidence-only vs an inline confidence×recency).
   *  Without currentDay falls back to confidence DESC (getAllBeliefs order). `requireParticipant` keeps only
   *  beliefs that name a subject/object (the prompt wants those); `topic` prefers a matching eventType. */
  getTopBeliefs(maxBeliefs = 3, opts?: { currentDay?: number; topic?: string; requireParticipant?: boolean }): Belief[] {
    let pool = this.getAllBeliefs();
    if (opts?.requireParticipant) pool = pool.filter((b) => b.object != null || b.subject != null);
    if (opts?.topic) {
      const onTopic = pool.filter((b) => b.eventType === opts.topic);
      if (onTopic.length > 0) pool = onTopic;
    }
    if (opts?.currentDay != null) {
      const cd = opts.currentDay;
      pool = [...pool].sort((a, b) => beliefRecencyScore(b, cd) - beliefRecencyScore(a, cd));
    }
    return pool.slice(0, maxBeliefs);
  }

  /** Compact summary for LLM system prompt (2nd person: "You certain: X committed...") */
  summarizeForPrompt(maxBeliefs = 3, nameResolver?: (id: string) => string, currentDay?: number): string {
    const resolveName = nameResolver ?? ((id: string) => id);
    const beliefs = this.getTopBeliefs(maxBeliefs, { currentDay, requireParticipant: true });
    if (beliefs.length === 0) return '';

    return beliefs.map((b) => {
      const certainty = b.confidence > 0.8 ? 'certain' : b.confidence > 0.5 ? 'believe' : 'heard rumor';
      const verb = getEventLabelSafe(b.eventType); // safe + warn instead of a silent null-drop
      const who = b.subject ? resolveName(b.subject) : 'someone unknown';
      const target = b.object ? resolveName(b.object) : 'someone';
      const where = b.location ? ` at ${b.location}` : '';
      const how = getBeliefSourceLabel(b.source);
      const when = currentDay != null ? `, ${beliefRecencyLabel(currentDay - b.lastUpdated)}` : '';
      const relation = phraseBelief({ eventType: b.eventType, source: b.source, confidence: b.confidence, verb, who, target });
      return `- You ${certainty}: ${relation}${where} (${how}${when})`;
    }).join('\n');
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
      const verb = getEventLabelSafe(b.eventType); // safe + warn instead of a silent null-drop
      const who = b.subject ? resolveName(b.subject) : 'someone';
      const target = b.object ? resolveName(b.object) : 'someone';
      const relation = phraseBelief({ eventType: b.eventType, source: b.source, confidence: b.confidence, verb, who, target });
      return `${ownerName} ${conf} ${relation}`;
    }).join('. ');
  }

  /** Serializable snapshot */
  toJSON(): Belief[] {
    return this.getAllBeliefs();
  }

  /** Restore from saved snapshot — validates fields, skips corrupted entries */
  static fromJSON(data: Belief[]): BeliefManager {
    const manager = new BeliefManager();
    for (const belief of data) {
      if (!belief.id || !belief.eventType || !belief.source) {
        console.warn(`  [Save] Skipping belief with missing fields: id=${belief.id}, type=${belief.eventType}, source=${belief.source}`);
        continue;
      }
      if (typeof belief.confidence !== 'number' || belief.confidence < 0 || belief.confidence > 1) {
        console.warn(`  [Save] Clamping invalid confidence ${belief.confidence} for belief ${belief.id}`);
        belief.confidence = Math.max(0, Math.min(1, Number(belief.confidence) || 0));
      }
      manager.beliefs.set(belief.id, belief);
    }
    return manager;
  }
}
