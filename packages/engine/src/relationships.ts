export type RelationType =
  | 'friend'
  | 'rival'
  | 'family'
  | 'acquaintance'
  | 'romantic'
  | 'mentor'
  | 'colleague';

export interface Relationship {
  targetId: string;
  targetName: string;
  type: RelationType;
  /** -1.0 (hostile) to 1.0 (warm) */
  sentiment: number;
  /** 0.0 to 1.0: how much they trust this person's word */
  trust: number;
}

/** Default trust by relationship type */
export const DEFAULT_TRUST: Record<RelationType, number> = {
  family: 0.9,
  romantic: 0.85,
  friend: 0.8,
  mentor: 0.7,
  colleague: 0.6,
  acquaintance: 0.4,
  rival: 0.2,
};

/** Default sentiment by relationship type */
export const DEFAULT_SENTIMENT: Record<RelationType, number> = {
  family: 0.7,
  romantic: 0.8,
  friend: 0.6,
  mentor: 0.5,
  colleague: 0.3,
  acquaintance: 0.1,
  rival: -0.3,
};

export class RelationshipGraph {
  private relationships: Map<string, Relationship> = new Map(); // targetId -> Relationship

  addRelationship(rel: Relationship): void {
    this.relationships.set(rel.targetId, rel);
  }

  getRelationship(targetId: string): Relationship | null {
    return this.relationships.get(targetId) ?? null;
  }

  getAllRelationships(): Relationship[] {
    return Array.from(this.relationships.values());
  }

  adjustSentiment(targetId: string, delta: number): void {
    const rel = this.relationships.get(targetId);
    if (rel) {
      rel.sentiment = Math.max(-1, Math.min(1, rel.sentiment + delta));
    }
  }

  adjustTrust(targetId: string, delta: number): void {
    const rel = this.relationships.get(targetId);
    if (rel) {
      rel.trust = Math.max(0, Math.min(1, rel.trust + delta));
    }
  }

  /** Get trust-weighted confidence for testimony from a specific NPC */
  getTestimonyWeight(sourceId: string): number {
    const rel = this.relationships.get(sourceId);
    return rel?.trust ?? 0.3; // strangers get low trust
  }

  /** Extra mood penalty when a related NPC dies */
  getGriefPenalty(targetId: string): number {
    const rel = this.relationships.get(targetId);
    if (!rel) return 0;
    if (rel.sentiment <= 0) return 0; // no grief for enemies

    switch (rel.type) {
      case 'family': return -0.4;
      case 'romantic': return -0.5;
      case 'friend': return -0.3;
      case 'mentor': return -0.25;
      case 'colleague': return -0.15;
      default: return -0.05;
    }
  }

  /** Compact summary for LLM system prompt */
  summarizeForPrompt(): string {
    const rels = this.getAllRelationships();
    if (rels.length === 0) return '';

    // Only include meaningful relationships (not bare acquaintances)
    // Include relationships with notable sentiment or non-default type
    const meaningful = rels.filter((r) => Math.abs(r.sentiment) > 0.15 || r.trust > 0.5);
    if (meaningful.length === 0) return '';

    return meaningful.map((r) => {
      const feeling = r.sentiment > 0.5 ? 'close'
        : r.sentiment > 0 ? 'friendly'
        : r.sentiment > -0.3 ? 'neutral'
        : 'tense';
      return `- ${r.targetName}: ${r.type} (${feeling})`;
    }).join('\n');
  }

  /** Serializable snapshot */
  toJSON(): Relationship[] {
    return this.getAllRelationships();
  }

  /** Restore from saved snapshot */
  static fromJSON(data: Relationship[]): RelationshipGraph {
    const graph = new RelationshipGraph();
    for (const rel of data) {
      graph.addRelationship(rel);
    }
    return graph;
  }
}
