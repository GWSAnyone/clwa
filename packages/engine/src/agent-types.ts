export interface BigFive {
  openness: number;         // 0-1
  conscientiousness: number;
  extraversion: number;
  agreeableness: number;
  neuroticism: number;
  honesty: number;          // Honesty-Humility (HEXACO H factor)
}

/** Per-NPC LLM inference settings */
export interface LlmPersonality {
  /** Sampling temperature (0-1). Higher = more creative/chaotic */
  temperature: number;
  /** Max response tokens. Short for terse NPCs, long for verbose ones */
  maxTokens: number;
}

export const DEFAULT_LLM_PERSONALITY: LlmPersonality = {
  temperature: 0.8,
  maxTokens: 250,
};

/** Enneagram motivational core — defines WHY an NPC acts */
export interface Enneagram {
  type: number;              // 1-9
  wing: number;              // adjacent type (e.g. 6w5 → wing=5)
  coreFear: string;          // deepest fear driving behavior
  coreDesire: string;        // deepest desire driving behavior
  stressType: number;        // under stress, shifts toward this type's behavior
  growthType: number;        // in growth, shifts toward this type's behavior
}

export interface AgentProfile {
  id: string;
  name: string;
  role: string;              // "bartender", "guard", "merchant"
  background: string;
  speechStyle: string;
  bigFive: BigFive;
  enneagram: Enneagram;
  /** Per-NPC LLM sampling settings */
  llm?: Partial<LlmPersonality>;
  /** What the NPC knows but will not reveal unless confronted with evidence */
  secret?: string;
  /** Internal tension the NPC struggles with — leaks through behavior */
  innerConflict?: string;
  /** Grudge/motive against another NPC — may lead to violence if conditions align */
  motive?: {
    targetId: string;
    reason: string;
  };
  /** NPC investigates crimes (guards, sheriffs, etc.) — gets ACTIVE DUTY directive */
  investigator?: boolean;
  /** NPC presence at location deters crime attempts (guards, paladins, etc.) */
  detersCrime?: boolean;
  /** NPC can evaluate cases and pass judgment (judges, magistrates, elders) */
  canSentence?: boolean;
  /** Shop inventory — NPC can sell these items */
  shop?: ShopItem[];
}

export interface ShopItem {
  id: string;
  name: string;
  price: number;
  description: string;
}

/** NPC legal/movement status */
export type NpcStatus = 'free' | 'detained' | 'exiled' | 'fled';

export interface AgentState {
  alive: boolean;
  /** Legal/movement status — detained NPCs can't act, exiled/fled are removed from world */
  status: NpcStatus;
  location: string;
  mood: number;              // -1 to 1
  currentDay: number;
  knownFacts: string[];
  /** Structured beliefs about events (who did what). Optional for backward compat */
  beliefs?: import('./beliefs').BeliefManager;
  /** Relationships with other NPCs. Optional for backward compat */
  relationships?: import('./relationships').RelationshipGraph;
  /** Current activity from schedule (set by World each tick). Optional */
  currentActivity?: string;
  /** Whether a player/traveler is present at the same location */
  playerPresent?: boolean;
  /** Current emotional motive from AL decision (WHY). Cleared on goal completion */
  currentMotive?: string;
}

export interface Memory {
  id: string;
  text: string;
  importance: number;        // 1-10
  gameDay: number;
  timestamp: number;         // unix ms
}

export interface ScoredMemory extends Memory {
  relevance: number;         // cosine similarity from Qdrant
  decayedImportance: number;
  freshness: number;
  compositeScore: number;
}
