// EventType is a string — modules define their event types via registries.
// No hardcoded union — engine is content-agnostic.
export type EventType = string;

export interface WorldEvent {
  id: string;
  type: EventType;
  subject: string;        // who did it (entity id)
  object?: string;        // target entity id
  location: string;
  gameDay: number;
  importance: number;
  payload: Record<string, unknown>;
}

export interface ConsequenceRule {
  id: string;
  trigger: EventType;
  conditions: RuleCondition[];
  consequence: {
    type: EventType;
    importance: number;
    delayDays: number;
    probability: number;
  };
  maxChainDepth: number;
  /** If true, the subject of beliefs created from this rule's consequence should be null (discoverer doesn't know perpetrator) */
  subjectUnknown?: boolean;
  /** If true, targets of this rule are tracked as witnesses (for body discovery dedup) */
  tracksWitness?: boolean;
  /** How to select initial target candidates. Default: 'affected' */
  targetMode?: 'witnesses' | 'location' | 'affected' | 'all';
  /** Exclusive group name. Rules in same group: only highest-priority match fires per target set. */
  exclusive?: string;
  /** Priority within exclusive group. Higher = wins. Default 0. */
  priority?: number;
}

export interface RuleCondition {
  field?: string;          // for eq/gt/lt on event payload
  op: string;              // 'trait', 'relationship', 'belief', 'has_capability', 'is_public_place', 'eq', 'gt', 'lt'
  value?: unknown;
  // ─── NPC-state condition fields (CG v2) ───
  /** Whose state to check: target (filter), subject/object (gate) */
  of?: 'target' | 'subject' | 'object';
  /** For op='trait': which OCEAN+H trait */
  trait?: string;
  /** For op='relationship': who feels */
  actor?: 'target' | 'subject' | 'object';
  /** For op='relationship': toward whom (role ref or payload field name) */
  toward?: string;
  /** Numeric comparator for trait/relationship */
  comparator?: '>' | '<' | '>=' | '<=';
  /** For op='belief': filter by event type */
  eventType?: string;
  /** For op='belief': minimum confidence threshold */
  minConfidence?: number;
  /** For op='belief': belief.subject matches event subject */
  aboutSubject?: boolean;
}

export interface ConsequenceResult {
  rule: ConsequenceRule;
  targets: string[];      // agent ids that receive the consequence
  event: WorldEvent;      // the generated consequence event
}
