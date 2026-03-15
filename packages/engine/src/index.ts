// ─── Agent ───
export { Agent, llmSemaphore } from './agent';
export type { AgentOptions } from './agent';
export type { AgentProfile, AgentState, BigFive, Enneagram, LlmPersonality, Memory, ScoredMemory, ShopItem } from './agent-types';
export { DEFAULT_LLM_PERSONALITY } from './agent-types';
export type { NpcStatus } from './agent-types';

// ─── Beliefs ───
export { BeliefManager, SOURCE_CONFIDENCE } from './beliefs';
export type { BeliefSource } from './beliefs';
export type { Belief } from './beliefs';

// ─── Relationships ───
export { RelationshipGraph, DEFAULT_SENTIMENT, DEFAULT_TRUST } from './relationships';
export type { RelationType } from './relationships';
export type { Relationship } from './relationships';

// ─── Memory ───
export { VectorMemory } from './memory';

// ─── Reflection ───
export { ReflectionTracker } from './reflection';
export type { ReflectionConfig } from './reflection';

// ─── Decay ───
export { compositeScore, decayedImportance, freshness } from './decay';

// ─── Consequence Engine ───
export type { ConsequenceResult, ConsequenceRule, RuleCondition, WorldEvent } from './cg-types';
export type { EventType } from './cg-types';
export { ConsequenceEngine } from './cg-engine';
export type { EngineOptions, WorldContext } from './cg-engine';

// ─── Event Store ───
export type { EventQuery, IEventStore, WorldState } from './event-types';
export { InMemoryEventStore } from './event-store';
export { buildWorldState } from './event-projection';

// ─── Affordance Layer ───
export {
  AFFORDANCE_REGISTRY,
  TARGET_FINDERS,
  REACTIVE_TARGET_FINDERS,
  REQUIREMENT_CHECKERS,
  computeUtility,
  checkRequirements,
  checkRequirementsReactive,
  findByRole,
} from './al';
export type {
  AffordanceContext,
  AffordanceDefinition,
  AffordanceRequirement,
  AffordanceTarget,
  AffordanceWeight,
  BeliefModifier,
  EventBoost,
  OceanHTrait,
  ReactiveTargetFinderFn,
  ScoredAffordance,
  StepTemplate,
  TargetFinderFn,
} from './al';

// ─── Volition ───
export { evaluateAllVolition, evaluateReactiveVolition, parseDoWhy } from './volition';
export type { ParsedIntention } from './volition';

// ─── Goals ───
export { GoalManager } from './goals';
export type {
  AnnounceStep,
  ArrestNpcStep,
  AttackNpcStep,
  DestroyEvidenceStep,
  ExamineSceneStep,
  FleeStep,
  GoalActionResult,
  GoalStep,
  InteractPresentStep,
  InteractStep,
  InteractionRunner,
  MoveStep,
  NpcFilter,
  NpcGoal,
  SentenceNpcStep,
  StealFromStep,
  WaitStep,
} from './goals';

// ─── World ───
export { World } from './world';
export type { WorldCallbacks } from './world';

// ─── World Types ───
export type {
  ConversationLine,
  ConversationResult,
  CrimeScene,
  CrimeSceneJSON,
  ExaminationPoint,
  LocationDef,
  MovementResult,
  NpcHome,
  NpcMovementConfig,
  TickResult,
  WorldConfig,
} from './world-types';
export { DEFAULT_MOVEMENT_CONFIG, DEFAULT_WORLD_CONFIG } from './world-types';
export type { LocationGraph } from './world-types';

// ─── Schedule ───
export { ScheduleManager, getTimePeriod, tickToHour, TICKS_PER_DAY } from './schedule';
export type { TimePeriod } from './schedule';
export type { ScheduleEntry } from './schedule';

// ─── Movement ───
export { processMovement } from './movement';

// ─── Pathfinding ───
export { findPath, nextHop } from './pathfinding';

// ─── Conversation ───
export { runConversation } from './conversation';

// ─── Scheduler ───
export { ConversationScheduler } from './scheduler';
export type { ScoredPair } from './scheduler';

// ─── Topic Engine ───
export { TopicEngine, TOPIC_SOURCE_REGISTRY } from './topic-engine';
export type { TopicSource } from './topic-engine';
export type { TopicContext, TopicProposal } from './topic-engine';

// ─── Intent ───
export { classifyIntent } from './intent';
export type { IntentType } from './intent';
export type { IntentResult } from './intent';

// ─── Interaction ───
export { createInteractionRunner } from './interaction';

// ─── Evidence Layer ───
export { EvidenceLayer, EVIDENCE_RULES, EVIDENCE_SOURCES } from './evidence';
export type {
  Evidence,
  EvidenceCandidate,
  EvidenceContext,
  EvidenceJSON,
  EvidenceRule,
  EvidenceSourceFn,
  EvidenceTemplate,
} from './evidence';

// ─── Crime Scene ───
export { createCrimeScene, getPassiveNoticeText } from './crime-scene';

// ─── Journal ───
export { PlayerJournal } from './journal';
export type { JournalEntry } from './journal';

// ─── Secret Directives ───
export { buildSecretDirectives } from './secret-directives';

// ─── Event Registry ───
export {
  registerEventCategory, isEventCategory,
  registerEventLabels, getEventLabel,
  registerEventGoalCleanup, getGoalCleanupForEvent,
  registerBeliefZeroingEvents, shouldZeroBeliefs,
  registerEventSceneTypes, getSceneTypeForEvent,
  registerDeathEvents, isDeathEvent, getDefaultDeathEvent,
  registerPursuitEvents, isPursuitEvent,
  registerEventHandler, getEventHandlers,
  registerActionVerbs, getAffordanceIdsForVerb,
  registerCrimeSceneTemplate, getCrimeSceneTemplate,
  registerRelationshipLabels, getRelationshipLabel,
} from './event-registry';
export type { EventHandlerContext, EventHandlerFn, CrimeSceneTemplate } from './event-registry';
