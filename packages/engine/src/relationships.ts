/** Bond type — OPEN string (B3). The engine ships universal social bonds as defaults; modules register
 *  their own (alliance, betrothed, vassal, faction-ally) via registerRelationshipType with zero engine edit. */
export type RelationType = string;

export interface Relationship {
  targetId: string;
  targetName: string;
  type: RelationType;
  /** -1.0 (hostile) to 1.0 (warm) */
  sentiment: number;
  /** 0.0 to 1.0: how much they trust this person's word */
  trust: number;
  /** Optional social standing / favor / rank this agent grants the target (-1..1). The court/politics
   *  win-condition axis (B3). Undefined = no explicit standing. Adjust via adjustStanding. */
  standing?: number;
}

/** Per-bond-type defaults: starting trust/sentiment + grief penalty on the target's death. */
export interface RelationshipTypeDefaults { trust: number; sentiment: number; grief: number; }

const FALLBACK_DEFAULTS: RelationshipTypeDefaults = { trust: 0.4, sentiment: 0, grief: -0.05 };

/** Registry-backed bond-type defaults. Seeded with universal social bonds; modules add their own. */
const RELATIONSHIP_TYPE_DEFAULTS: Map<string, RelationshipTypeDefaults> = new Map([
  ['family',       { trust: 0.9,  sentiment: 0.7,  grief: -0.4 }],
  ['romantic',     { trust: 0.85, sentiment: 0.8,  grief: -0.5 }],
  ['friend',       { trust: 0.8,  sentiment: 0.6,  grief: -0.3 }],
  ['mentor',       { trust: 0.7,  sentiment: 0.5,  grief: -0.25 }],
  ['colleague',    { trust: 0.6,  sentiment: 0.3,  grief: -0.15 }],
  ['acquaintance', { trust: 0.4,  sentiment: 0.1,  grief: -0.05 }],
  ['rival',        { trust: 0.2,  sentiment: -0.3, grief: 0 }],
]);

/** Register a bond type's defaults (e.g. 'alliance', 'betrothed', 'vassal') — zero engine edit. */
export function registerRelationshipType(type: string, defaults: RelationshipTypeDefaults): void {
  RELATIONSHIP_TYPE_DEFAULTS.set(type, defaults);
}

/** Defaults for a bond type (registered or universal); neutral fallback for unknown types. */
export function getRelationshipDefaults(type: string): RelationshipTypeDefaults {
  return RELATIONSHIP_TYPE_DEFAULTS.get(type) ?? FALLBACK_DEFAULTS;
}

export class RelationshipGraph {
  private relationships: Map<string, Relationship> = new Map(); // targetId -> Relationship
  onChange?: (targetId: string, targetName: string, field: 'trust' | 'sentiment', oldVal: number, newVal: number) => void;

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
      const old = rel.sentiment;
      rel.sentiment = Math.max(-1, Math.min(1, rel.sentiment + delta));
      if (Math.abs(old - rel.sentiment) > 0.001) this.onChange?.(targetId, rel.targetName, 'sentiment', old, rel.sentiment);
    }
  }

  adjustTrust(targetId: string, delta: number): void {
    const rel = this.relationships.get(targetId);
    if (rel) {
      const old = rel.trust;
      rel.trust = Math.max(0, Math.min(1, rel.trust + delta));
      if (Math.abs(old - rel.trust) > 0.001) this.onChange?.(targetId, rel.targetName, 'trust', old, rel.trust);
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
    return getRelationshipDefaults(rel.type).grief;
  }

  /** Adjust social standing/favor toward a target (clamped -1..1). Fires onChange via the sentiment channel
   *  is NOT triggered — standing is a separate axis; callers broadcast it themselves if needed. */
  adjustStanding(targetId: string, delta: number): void {
    const rel = this.relationships.get(targetId);
    if (!rel) return;
    rel.standing = Math.max(-1, Math.min(1, (rel.standing ?? 0) + delta));
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
