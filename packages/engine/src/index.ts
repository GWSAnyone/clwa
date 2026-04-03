// ─── Agent ───
export { Agent, llmSemaphore } from './agent';
export type { AgentOptions } from './agent';
export type { AgentProfile, AgentState, BigFive, Enneagram, LlmPersonality, Memory, ScoredMemory, ShopItem, NpcProcessingState } from './agent-types';
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
  validatePlayerAction,
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
  ValidationResult,
} from './al';

// ─── Perception ───
export { canSee, canInteract, canHear, getCoPresent, getWitnesses, getPlayerAgent, isPlayerAt, getNpcsAt } from './perception';

// ─── Volition ───
export { evaluateAllVolition, evaluateReactiveVolition, createGoalFromRequest } from './volition';
export { llmCall, llmStream, truncateToFirstJsonObject } from './llm-client';
export type { LlmCallOptions, LlmStreamOptions, LlmJsonSchema } from './llm-client';
export type { ParsedIntention } from './volition';
export { resetConsideration } from './volition';
export { buildInstinctDescription, getTierName } from './instinct-builder';
export type { InstinctInput } from './instinct-builder';

// ─── Goals ───
export { GoalManager } from './goals';
export type {
  AnnounceStep,
  GoalActionResult,
  GoalStep,
  InteractPresentStep,
  InteractStep,
  InteractionRunner,
  ModuleStep,
  MoveStep,
  NpcFilter,
  NpcGoal,
  WaitStep,
} from './goals';

// ─── World ───
export { World } from './world';
export type { WorldCallbacks } from './world';
export { ProcessingQueue } from './processing-queue';
export type { ProcessingTask, TaskType, TaskHandler } from './processing-queue';

// ─── World Types ───
export type {
  ConversationLine,
  ConversationResult,
  CrimeScene,
  ApproachEvent,
  CrimeSceneJSON,
  ExaminationPoint,
  LocationDef,
  MovementResult,
  NpcHome,
  NpcMovementConfig,
  TickResult,
  WorldConfig,
} from './world-types';
export { DEFAULT_MOVEMENT_CONFIG, DEFAULT_WORLD_CONFIG, DEFAULT_IL_CONFIG, DEFAULT_CONVERSATION_CONFIG, resolveILConfig, resolveConversationConfig } from './world-types';
export type { ILConfig, ConversationConfig, PressureEffect, ImportanceConfig } from './world-types';
export type { LocationGraph } from './world-types';

// ─── Schedule ───
export { ScheduleManager, getTimePeriod, minuteToHour, tickToHour, MINUTES_PER_DAY, TICKS_PER_DAY } from './schedule';
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
export { TopicEngine, TOPIC_SOURCE_REGISTRY, getTopicGroup, registerTopicGroupMapping } from './topic-engine';
export type { TopicSource } from './topic-engine';
export type { TopicContext, TopicProposal } from './topic-engine';


// ─── IL (Intent Layer) — Dialogue Meaning Extraction ───
export { extractDialogueMeaning, applyDialogueMeaning, processEvidencePresentation, buildAccusationContext, PLAYER_ACTION_EVENT, PLAYER_ACTIONS } from './il';
export type { DialogueMeaning, Claim, Question, RequestedAction, EmotionalPressure, TradeIntent, SpeechAct, ILContext, ILEffectContext, ILEffect, PresentedEvidence, AccusationContext, ConversationSession } from './il';

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
export type { JournalEntry, CaseSummary } from './journal';

// ─── Secret Directives ───
export { buildSecretDirectives } from './secret-directives';

// ─── Event Registry ───
export {
  registerEventCategory, isEventCategory, getAllRegisteredEventTypes,
  registerEventTypeFlags, registerEventTypeFlagsBatch, isTransferable, isInformationOnly,
  registerSourceFlags, isPerpetrator, isFirsthand, isConcealment,
  BELIEF_SOURCE,
  registerEventLabels, getEventLabel, getEventLabelSafe,
  registerEventGoalCleanup, getGoalCleanupForEvent,
  registerEventSceneTypes, getSceneTypeForEvent,
  registerDeathEvents, isDeathEvent, getDefaultDeathEvent,
  registerPursuitEvents, isPursuitEvent,
  registerEventHandler, getEventHandlers,
  registerActionVerbs, getAffordanceIdsForVerb,
  registerCrimeSceneTemplate, getCrimeSceneTemplate,
  registerRelationshipLabels, getRelationshipLabel,
  registerBeliefSourceLabels, getBeliefSourceLabel,
  registerSourceTransferWeights, getSourceTransferWeight,
  registerSourceDecayRates, getSourceDecayRate,
  registerStepHandler, getStepHandler,
  registerActiveStatuses, registerAbsentStatuses, isStatusActive, isStatusAbsent,
  registerInteractPostHook, runInteractPostHooks,
  registerWitnessEventType, getWitnessEventType,
  registerEventMoodShifts, getEventMoodShift,
  registerGoalMoodBoost, getGoalMoodBoost,
  registerBodyDiscoveryEventType, getBodyDiscoveryEventType,
  registerRoleTopicPool, getRoleTopicPool,
  registerLocationHook, getLocationHook,
  registerDiscoveryHandler, getDiscoveryHandler,
  registerRumorEventType, getRumorEventType,
  registerBeliefCreator, getBeliefCreator,
  registerMemoryTextBuilder, getMemoryTextBuilder,
  registerDayAdvanceHandler, getDayAdvanceHandlers,
  registerSourceCategory, isSourceCategory,
  registerInteractionResultHook, getInteractionResultHooks,
  registerTickPhaseHandler, getTickPhaseHandlers,
  registerSecretDirectiveBuilder, getSecretDirectiveBuilders,
  getAllRegisteredVerbs,
  registerSecretEventType, getSecretEventType,
} from './event-registry';
export type { TickPhaseContext, TickPhaseHandlerFn } from './event-registry';
export type { StepExecutionContext, StepHandlerFn, InteractionRunner as StepInteractionRunner } from './event-registry';
export type { EventHandlerContext, EventHandlerFn, CrimeSceneTemplate, BeliefCreatorFn, MemoryTextBuilderFn, DayAdvanceHandlerFn, DayAdvanceContext, DiscoveryContext, DiscoveryHandlerFn } from './event-registry';
