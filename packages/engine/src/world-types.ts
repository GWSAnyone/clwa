import type { Agent } from './agent';

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
}

/** Result of a single world tick */
export interface TickResult {
  tickNumber: number;
  gameDay: number;
  /** Current time of day info */
  time?: { tickInDay: number; period: string; hour: string };
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
  tick: number;
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
  tick: number;
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
  /** Cooldown in ticks before same pair can talk again */
  pairCooldownTicks: number;
  /** Number of exchanges per conversation: 1 = each speaks once (default: 1) */
  exchangeCount: number;
  /** LM Studio base URL */
  lmStudioUrl: string;
  /** Model identifier */
  model: string;
  /** Public gathering places where information spreads (used by day advance handlers) */
  publicPlaces?: Set<string>;
  /** Cooldown in ticks before same NPC can use the same affordance again */
  affordanceCooldownTicks?: number;
  /** Cooldown in ticks before same NPC re-evaluates volition (LLM decision) */
  decisionCooldownTicks?: number;
  /** Starting tick (default 0). Set to 28 for morning start (07:00 with 96 ticks/day) */
  startTick?: number;
}

export const DEFAULT_WORLD_CONFIG: WorldConfig = {
  minConversationScore: 2,
  pairCooldownTicks: 16,
  exchangeCount: 1,
  lmStudioUrl: 'http://localhost:1234',
  model: 'qwen/qwen3.5-9b',
  affordanceCooldownTicks: 12,
  decisionCooldownTicks: 4,
};

export const DEFAULT_MOVEMENT_CONFIG: NpcMovementConfig = {
  mobileNpcs: new Set(),
  moveProbability: 0.08,
};
