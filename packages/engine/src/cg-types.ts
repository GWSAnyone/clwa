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
}

export interface RuleCondition {
  field: string;          // e.g. "location", "importance"
  op: string; // 'eq', 'gt', 'lt', 'has_witnesses', 'is_public_place', 'has_capability', etc.
  value?: unknown;
}

export interface ConsequenceResult {
  rule: ConsequenceRule;
  targets: string[];      // agent ids that receive the consequence
  event: WorldEvent;      // the generated consequence event
}
