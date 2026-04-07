import type { Agent } from './agent';

// ─── Mood Modifiers (SPEC-mood-modifiers) ───

export interface MoodModifier {
  id: string;
  source: string;           // human-readable: 'argument_with_bess', 'social_stress'
  category: string;         // stacking group: 'social_stress', 'conversation', 'event', 'pressure', 'routine'
  magnitude: number;        // -0.35 to +0.35
  remaining: number;        // game minutes left (0 = permanent until removed)
  duration: number;         // original duration (for decay calc; 0 = permanent)
  decay: 'exponential' | 'linear' | 'none';
}

/** Compute decayed effective magnitude of a modifier */
export function modifierEffective(m: MoodModifier): number {
  if (m.decay === 'none' || m.duration === 0) return m.magnitude;
  const ratio = m.remaining / m.duration;
  if (m.decay === 'exponential') return m.magnitude * ratio * ratio;
  return m.magnitude * ratio; // linear
}

/** Location definition */
export interface LocationDef {
  id: string;
  name: string;
  /** Adjacent location IDs */
  connections: string[];
  /** Is this a public place (for rumor spreading) */
  isPublic: boolean;
}

/** Location graph — maps location id to definition */
export type LocationGraph = Map<string, LocationDef>;

/** NPC movement configuration */
export interface NpcMovementConfig {
  /** NPC IDs that can move between locations */
  mobileNpcs: Set<string>;
  /** Probability of a mobile NPC moving on each tick (0-1) */
  moveProbability: number;
}

/** Result of NPC movement on a tick */
export interface MovementResult {
  agentId: string;
  agentName: string;
  from: string;
  to: string;
  /** True when NPC has arrived at destination (not starting transit) */
  arrived?: boolean;
}

/** Single line of NPC-to-NPC dialogue */
export interface ConversationLine {
  speaker: string;       // agent id
  speakerName: string;
  text: string;
}

/** Result of a completed NPC-to-NPC conversation */
export interface ConversationResult {
  initiator: string;     // agent id
  responder: string;     // agent id
  location: string;
  lines: ConversationLine[];
  gameDay: number;
  /** Estimated topic importance (affects memory storage) */
  importance: number;
  /** Topic subject (for debugging/analytics) */
  topic?: string;
  /** Topic category group (casual/event/relationship/mood/etc.) */
  topicGroup?: string;
}

/** NPC wants to approach the player — triggered by tick phase handlers */
export interface ApproachEvent {
  npcId: string;
  npcName: string;
  /** Injected into NPC system prompt when player opens chat */
  promptContext: string;
  /** Display text for client notification */
  displayText: string;
  /** 0-1, UI priority/urgency */
  urgency: number;
}

/** Result of a single world tick */
export interface TickResult {
  tickNumber: number;
  /** Absolute game minute (for cooldowns, time display) */
  gameMinute: number;
  gameDay: number;
  /** Current time of day info */
  time?: { minuteOfDay: number; period: string; hour: string };
  /** Whether a new day started on this tick */
  dayAdvanced?: boolean;
  conversation: ConversationResult | null;
  /** NPC movements that happened this tick */
  movements?: MovementResult[];
  /** Goal-driven actions that happened this tick */
  goalActions?: import('./goals').GoalActionResult[];
  /** Idle reason if no conversation happened */
  idleReason?: string;
  /** Murder that happened this tick (NPC-on-NPC, motivation system) */
  murder?: { killerId: string; victimId: string; killerName: string; victimName: string };
  /** New crime scene created this tick */
  crimeScene?: { id: string; locationId: string; crimeType: string; pointCount: number };
  /** NPCs that want to approach the player this tick */
  approaches?: ApproachEvent[];
}

/** A single point of interest at a crime scene that can be examined */
export interface ExaminationPoint {
  id: string;
  /** Type of evidence */
  type: string; // modules define examination point types
  /** What the player sees when examining */
  description: string;
  /** The clue revealed after examination (goes to player journal) */
  clueText: string;
  /** Has the player examined this point */
  examined: boolean;
}

/** Crime scene marker on a location */
export interface CrimeScene {
  id: string;
  locationId: string;
  crimeType: string;
  /** EventType that triggered this scene (e.g. 'NPC_KILLED', 'GOODS_STOLEN') */
  eventType?: string;
  /** Points the player can examine */
  points: ExaminationPoint[];
  /** When the crime happened */
  gameDay: number;
  /** Game minute when the crime occurred (absolute, not minute-of-day) */
  gameMinute: number;
  /** NPCs who already passively noticed this scene */
  noticedBy: Set<string>;
  /** Whether the scene is still active (evidence not cleaned up) */
  active: boolean;
  /** Who committed the crime (if known to the system) */
  perpetratorId?: string;
  /** Victim of the crime */
  victimId?: string;
  /** All NPCs present at the location when the crime occurred (includes perpetrator) */
  personsPresent: string[];
}

/** Serialized CrimeScene for persistence (Set → array) */
export interface CrimeSceneJSON {
  id: string;
  locationId: string;
  crimeType: string;
  eventType?: string;
  points: ExaminationPoint[];
  gameDay: number;
  gameMinute: number;
  noticedBy: string[];
  active: boolean;
  perpetratorId?: string;
  victimId?: string;
  personsPresent: string[];
}

/** NPC home location — where they return at night */
export interface NpcHome {
  npcId: string;
  /** Home location name */
  location: string;
}

/** World configuration */
export interface WorldConfig {
  /** Minimum score for a pair to have a conversation (default: 2) */
  minConversationScore: number;
  /** Cooldown in game minutes before same pair can talk again (default: 240 = 4h) */
  pairCooldownMinutes: number;
  /** Per-NPC cooldown in game minutes — minimum gap between any conversations for one NPC (default: 30) */
  npcConversationCooldownMinutes: number;
  /** Number of exchanges per conversation: 1 = each speaks once (default: 1) */
  exchangeCount: number;
  /** LM Studio base URL */
  lmStudioUrl: string;
  /** Model identifier */
  model: string;
  /** Public gathering places where information spreads (used by day advance handlers) */
  publicPlaces?: Set<string>;
  /** Cooldown in game minutes before same NPC can use the same affordance again (default: 180 = 3h) */
  affordanceCooldownMinutes?: number;
  /** Cooldown in game minutes before same NPC re-evaluates volition (LLM decision) (default: 60 = 1h) */
  decisionCooldownMinutes?: number;
  /** Starting game minute (default 420 = 07:00). Absolute minute of day. */
  startMinute?: number;
  /** Game speed multiplier: 1 = 1 game min per real sec, 2 = 2/sec, 3 = 3/sec, 0 = paused */
  gameSpeed?: number;
  /** Game minutes per pathfinding hop for NPC transit (default: 30 = 30 min per hop) */
  minutesPerHop?: number;
  /** Mood bias applied to every conversation mood_impact. Negative = darker world, positive = lighter.
   *  Default 0 (neutral). Demo: -0.02 (crime within ~1 day). Peaceful: +0.02. */
  moodBias?: number;
  /** Penalize repeated tokens in LLM output. 1.0 = none, 1.1-1.15 recommended. */
  repeatPenalty?: number;
  /** Penalize tokens proportional to how often they appeared. 0.0-2.0. */
  frequencyPenalty?: number;
  /** Penalize any token already present in output. 0.0-2.0. */
  presencePenalty?: number;
  /** Intent Layer configuration — player speech → engine effects */
  il?: Partial<ILConfig>;
  /** NPC-NPC conversation behavioral constants */
  conversationBehavior?: Partial<ConversationConfig>;
  /** Mood modifier system config (SPEC-mood-modifiers) */
  moodSystem?: {
    /** Social stress target weight: target = -stress × personality × this (default: 0.5) */
    socialStressRate?: number;
    /** Drift rate per 5min toward target (default: 0.02 → 63% in 4h, 87% in 8h) */
    socialStressDrift?: number;
    /** Positive relationship buffer factor (default: 0.5) */
    socialStressBuffer?: number;
    /** Max modifiers per stacking category (default: 3) */
    maxPerCategory?: number;
    /** Modifier duration defaults (game minutes) */
    durations?: {
      conversationNeg?: number;   // rival/negative conversation (default: 360 = 6h)
      conversationPos?: number;   // friend/positive conversation (default: 120 = 2h)
      bystander?: number;         // bystander overhear (default: 60 = 1h)
      event?: number;             // traumatic event (default: 1440 = 24h)
      pressure?: number;          // IL pressure (default: 240 = 4h)
      routine?: number;           // goal completion (default: 180 = 3h)
    };
    /** Game minutes without interaction before loneliness kicks in (default: 30) */
    lonelinessThreshold?: number;
    /** Loneliness rate per 5min (default: 0.001), scaled by E (default: 0.001) */
    lonelinessRate?: number;
  };
}

// ─── IL Config ───

/** Effect multiplier per emotional pressure type (scaled by intensity 0-1) */
export interface PressureEffect {
  mood: number; sentiment: number; trust: number;
  /** Template for NPC memory — $player replaced with player name. If set, engine creates memory. */
  memoryText?: string;
  memoryImportance?: number;
}

/** Importance value for memory storage */
export interface ImportanceConfig { base: number; intensityMultiplier?: number; }

/** Intent Layer behavioral parameters */
export interface ILConfig {
  /** Minimum NPC→Player trust to accept player action requests */
  trustThresholdForGoals: number;
  /** Minimum effective confidence (claim.conf × trust) to create belief */
  beliefConfidenceFloor: number;
  /** Player-side relationship delta multiplier (NPC reacts fully, player partially) */
  bilateralFactor: number;
  /** Emotional pressure multipliers keyed by pressure type, scaled by intensity */
  pressureEffects: Record<string, PressureEffect>;
  /** Bare speech act effects (flat, not scaled by intensity) */
  speechActEffects: Record<string, PressureEffect>;
  /** Memory importance values for player actions */
  importanceValues: Record<string, ImportanceConfig>;
}

export const DEFAULT_IL_CONFIG: ILConfig = {
  trustThresholdForGoals: 0.4,
  beliefConfidenceFloor: 0.1,
  bilateralFactor: 0.5,
  pressureEffects: {
    threat:       { mood: -0.20, sentiment: -0.15, trust: -0.10 },
    bribe:        { mood:  0,    sentiment:  0,    trust:  0    },
    flattery:     { mood:  0.10, sentiment:  0.05, trust:  0.05 },
    guilt:        { mood: -0.10, sentiment:  0,    trust:  0    },
    intimidation: { mood: -0.15, sentiment: -0.10, trust: -0.10 },
  },
  speechActEffects: {
    compliment: { mood:  0.08, sentiment:  0.05, trust:  0.03, memoryText: '$player said something kind to me.', memoryImportance: 2 },
    insult:     { mood: -0.08, sentiment: -0.08, trust: -0.05, memoryText: '$player insulted me.', memoryImportance: 3 },
  },
  importanceValues: {
    threat:     { base: 3, intensityMultiplier: 4 },
    bribe:      { base: 5 },
    compliment: { base: 2 },
    insult:     { base: 3 },
  },
};

/** Resolve partial IL config with defaults */
export function resolveILConfig(partial?: Partial<ILConfig>): ILConfig {
  if (!partial) return DEFAULT_IL_CONFIG;
  return {
    trustThresholdForGoals: partial.trustThresholdForGoals ?? DEFAULT_IL_CONFIG.trustThresholdForGoals,
    beliefConfidenceFloor: partial.beliefConfidenceFloor ?? DEFAULT_IL_CONFIG.beliefConfidenceFloor,
    bilateralFactor: partial.bilateralFactor ?? DEFAULT_IL_CONFIG.bilateralFactor,
    pressureEffects: partial.pressureEffects ?? DEFAULT_IL_CONFIG.pressureEffects,
    speechActEffects: partial.speechActEffects ?? DEFAULT_IL_CONFIG.speechActEffects,
    importanceValues: partial.importanceValues ?? DEFAULT_IL_CONFIG.importanceValues,
  };
}

// ─── Conversation Config ───

/** NPC-NPC conversation behavioral constants */
export interface ConversationConfig {
  /** Sentiment boost per NPC-NPC conversation (mutual) */
  sentimentBoost: number;
  /** Mood impact clamp range from LLM conversation analysis */
  moodImpactClamp: { min: number; max: number };
  /** Sentiment valence clamp for mentioned NPCs */
  sentimentValenceClamp: { min: number; max: number };
  /** Skip sentiment changes smaller than this */
  sentimentValenceThreshold: number;
  /** Confidence for secret discovery beliefs */
  secretDiscoveryConfidence: number;
  /** Mood modifier based on participant relationship — proportional to sentiment (SPEC-mood-pressure).
   *  Always applied: negative sentiment → rivalMoodScale, positive → friendMoodScale. No threshold. */
  relationshipMoodModifier: {
    friendMoodScale: number;   // sentiment × scale for friends (e.g., 0.5 × 0.02 = +0.01)
    rivalMoodScale: number;    // sentiment × scale for rivals (e.g., -0.7 × 0.04 = -0.028)
  };
}

export const DEFAULT_CONVERSATION_CONFIG: ConversationConfig = {
  sentimentBoost: 0.05,
  moodImpactClamp: { min: -0.08, max: 0.06 },
  sentimentValenceClamp: { min: -0.15, max: 0.15 },
  sentimentValenceThreshold: 0.02,
  secretDiscoveryConfidence: 0.4,
  relationshipMoodModifier: {
    friendMoodScale: 0.02,
    rivalMoodScale: 0.04,
  },
};

/** Resolve partial conversation config with defaults */
export function resolveConversationConfig(partial?: Partial<ConversationConfig>): ConversationConfig {
  if (!partial) return DEFAULT_CONVERSATION_CONFIG;
  return {
    sentimentBoost: partial.sentimentBoost ?? DEFAULT_CONVERSATION_CONFIG.sentimentBoost,
    moodImpactClamp: partial.moodImpactClamp ?? DEFAULT_CONVERSATION_CONFIG.moodImpactClamp,
    sentimentValenceClamp: partial.sentimentValenceClamp ?? DEFAULT_CONVERSATION_CONFIG.sentimentValenceClamp,
    sentimentValenceThreshold: partial.sentimentValenceThreshold ?? DEFAULT_CONVERSATION_CONFIG.sentimentValenceThreshold,
    secretDiscoveryConfidence: partial.secretDiscoveryConfidence ?? DEFAULT_CONVERSATION_CONFIG.secretDiscoveryConfidence,
    relationshipMoodModifier: partial.relationshipMoodModifier ?? DEFAULT_CONVERSATION_CONFIG.relationshipMoodModifier,
  };
}

export const DEFAULT_WORLD_CONFIG: WorldConfig = {
  minConversationScore: 2,
  pairCooldownMinutes: 240,
  npcConversationCooldownMinutes: 30,
  exchangeCount: 1,
  lmStudioUrl: 'http://localhost:1234',
  model: 'qwen3.5-9b-abliterated',
  affordanceCooldownMinutes: 180,
  decisionCooldownMinutes: 60,
  gameSpeed: 1,
  repeatPenalty: 1.1,
  frequencyPenalty: 0.3,
  presencePenalty: 0.2,
};

export const DEFAULT_MOVEMENT_CONFIG: NpcMovementConfig = {
  mobileNpcs: new Set(),
  moveProbability: 0.08,
};
