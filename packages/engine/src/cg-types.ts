export type EventType =
  | 'NPC_KILLED'
  | 'WITNESS_MEMORY'
  | 'BODY_DISCOVERED'
  | 'RUMOR_SPREAD'
  | 'WANTED_STATUS'
  | 'NPC_CONVERSATION'
  | 'TRADE'
  | 'PLAYER_ACTION'
  | 'GOODS_STOLEN'
  | 'THEFT_DISCOVERED'
  | 'SELF_JUSTICE'
  // Investigation & punishment
  | 'NPC_INTERROGATED'
  | 'NPC_ARRESTED'
  | 'NPC_SENTENCED'
  | 'NPC_FLED'
  | 'EVIDENCE_DESTROYED'
  | 'WITNESS_INTIMIDATED'
  | 'JUSTICE_DEMANDED'
  | 'TRIAL_REQUESTED';

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
  op: 'eq' | 'gt' | 'lt' | 'has_witnesses' | 'is_public_place' | 'is_guard';
  value?: unknown;
}

export interface ConsequenceResult {
  rule: ConsequenceRule;
  targets: string[];      // agent ids that receive the consequence
  event: WorldEvent;      // the generated consequence event
}
