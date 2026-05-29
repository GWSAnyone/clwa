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


/**
 * NPC Memory Snapshot — серилизуемое представление engine state для LLM-провайдеров с
 * per-NPC изоляцией (ClaudeCodeProvider). Engine собирает через Agent.serializeMemoryState(),
 * server рендерит в markdown файлы (current-state.md / relationships.md / beliefs.md)
 * через NpcMemoryManager.snapshotState(). Pure data, ZERO file I/O в engine.
 */
export interface NpcMemoryState {
  /** Absolute game minute snapshot was taken */
  gameMinute: number;
  /** Current location id */
  location: string;
  /** Effective mood (-1..1) — already includes modifiers */
  mood: number;
  /** Base mood without modifiers */
  baseMood: number;
  /** Current status (free|detained|imprisoned|exiled|fled|dead) — undefined = free */
  status: string | undefined;
  /** Current activity from schedule (e.g. "trading goods") */
  currentActivity: string | undefined;
  /** True если NPC в transit между локациями */
  inTransit: boolean;
  /** Destination location id (если inTransit) */
  transitTo?: string;
  /** Alive flag */
  alive: boolean;
  /** Все relationships агента к другим NPC, с display names резолвенными */
  relationships: Array<{
    targetId: string;
    targetName: string;
    type: string;
    sentiment: number;
    trust: number;
  }>;
  /** Top-N beliefs by composite score (confidence × recency). Resolved subject/object → display names. */
  beliefs: Array<{
    eventType: string;
    subject: string | null;
    subjectName?: string;
    object: string | null;
    objectName?: string;
    location: string | null;
    confidence: number;
    source: string;
    gameDay: number;
    lastUpdated: number;
  }>;
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
  /**
   * Open capability flags — string-keyed so ANY genre declares its own roles without an engine
   * edit (crime: investigator/detersCrime/canSentence; economy: isMerchant; politics: canGrantFavor).
   * Read via hasCapability() or the CG `has_capability` op — the engine never reads a named crime
   * capability as a typed field (INV-14).
   */
  capabilities?: Record<string, boolean>;
  /** Shop inventory — NPC can sell these items */
  shop?: ShopItem[];
  /** Player-controlled agent — skips volition, schedule, movement; includes beliefs, relationships, perception */
  isPlayer?: boolean;
}

/** Whether an agent profile has a given capability flag set. Single source of truth for capability reads. */
export function hasCapability(profile: AgentProfile, key: string): boolean {
  return profile.capabilities?.[key] === true;
}

export interface ShopItem {
  id: string;
  name: string;
  price: number;
  description: string;
}

/** NPC status — extensible string. Engine checks isActive()/isPresent() helpers. */
export type NpcStatus = string | undefined;

/** NPC processing lifecycle state — prevents double-processing, guides Master Clock enqueue logic */
export type NpcProcessingState =
  | 'idle'               // No goal, available for volition/conversation
  | 'awaiting_decision'  // In queue for VOLITION task
  | 'executing_goal'     // Has active goal, steps advancing
  | 'in_conversation'    // In queue for or executing CONVERSATION
  | 'in_transit'         // Walking between locations (Master Clock drives progress)
  | 'in_player_chat';    // Frozen — player talking to this NPC

export interface AgentState {
  alive: boolean;
  /** Legal/movement status — detained NPCs can't act, exiled/fled are removed from world */
  status: NpcStatus;
  location: string;
  mood: number;              // -1 to 1 — computed effectiveMood from baseMood + modifiers
  /** Personality-derived mood baseline: 0.3 - N×0.4 + E×0.2 */
  baseMood: number;
  /** Active mood modifiers (SPEC-mood-modifiers) */
  moodModifiers: import('./world-types').MoodModifier[];
  /** Open string-keyed numeric attributes (B1): module-defined quantified state — gold / HP / standing /
   *  needs. base + clamped range + timed modifiers. Read via getAttributeValue / World.getAttribute. */
  attributes?: Record<string, import('./attributes').ScalarAttribute>;
  /** Faction/group memberships (B3): open string keys (guild / house / coalition / cult). Collective-actor
   *  primitive — read via World.isFactionMember / CG op 'faction'. Per-faction standing uses an attribute. */
  factions?: string[];
  /** Item instances owned by the agent (B2): conserved, transferable goods. kind is a free module string.
   *  Managed via World.giveItem / removeItem / transferItem. */
  inventory?: import('./inventory').Item[];
  currentDay: number;
  knownFacts: string[];
  /** Structured beliefs about events (who did what). Optional for backward compat */
  beliefs?: import('./beliefs').BeliefManager;
  /** Relationships with other NPCs. Optional for backward compat */
  relationships?: import('./relationships').RelationshipGraph;
  /** Current activity from schedule (set by World each tick). Optional */
  currentActivity?: string;
  /** NPC is in active conversation with player — tick skips movement/goals for this agent */
  inPlayerChat?: boolean;
  /** Processing lifecycle state. Transient — not persisted. Default: 'idle'. */
  processingState?: NpcProcessingState;
  /** Structured outcome from last interaction post-hook (transient, cleared after use) */
  lastInteractionOutcome?: { type: string; detail?: string };
  /** Current emotional motive from AL decision (WHY). Cleared on goal completion */
  currentMotive?: string;
  /** NPC is moving between locations — not yet arrived. Transient, not persisted. */
  inTransit?: boolean;
  /** Destination location slug (set when transit starts, cleared on arrival) */
  transitTo?: string;
  /** Full path of location slugs from current to destination (for multi-hop) */
  transitPath?: string[];
  /** Game minute of the last transit progress (start / intermediate-zone crossing / arrival). Transient.
   *  Position-authoritative watchdog baseline: a transit that stalls past goalStuckMinutes is aborted
   *  rather than frozen forever (there is no engine-side timer self-clear anymore). */
  lastTransitProgressMinute?: number;
  /** Game minute of last social interaction — for loneliness decay. Transient, not persisted. */
  lastInteractionMinute?: number;
}

export interface Memory {
  id: string;
  text: string;
  importance: number;        // 1-10
  gameDay: number;
  timestamp: number;         // unix ms
}

/** Persistent memory entry with cached embedding vector */
export interface MemoryEntry {
  id: string;
  text: string;
  importance: number;        // 1-10
  gameDay: number;
  timestamp: number;         // unix ms
  vector: number[];          // cached embedding (768-dim nomic-embed-text-v1.5)
  embeddingModel: string;    // drift detection
  protected?: boolean;       // true = never evicted (crime evidence, key events)
  playerId?: string;         // memory owner: "__world__" or player ID (multiplayer-ready)
}

export interface ScoredMemory extends Memory {
  relevance: number;         // cosine similarity from Qdrant
  decayedImportance: number;
  freshness: number;
  compositeScore: number;
}
