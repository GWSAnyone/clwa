// ─── Agent ───
export { Agent } from './agent';
export type { AgentOptions } from './agent';
export type { AgentProfile, AgentState, BigFive, Enneagram, LlmPersonality, Memory, MemoryEntry, ScoredMemory, ShopItem, NpcProcessingState } from './agent-types';
export { DEFAULT_LLM_PERSONALITY, hasCapability } from './agent-types';
// ─── Scalar Attributes (B1) — universal quantified-state primitive ───
export { createAttribute, attributeEffective, getAttributeValue, decayAttribute } from './attributes';
export type { ScalarAttribute, AttributeModifier } from './attributes';
// ─── Inventory (B2) — conserved, ownable, transferable item instances ───
export { countItems, addItem, removeItems } from './inventory';
export type { Item } from './inventory';
export type { NpcStatus } from './agent-types';

// ─── Beliefs ───
export { BeliefManager } from './beliefs';
export type { BeliefSource } from './beliefs';
export type { Belief } from './beliefs';

// ─── Relationships ───
export { RelationshipGraph, registerRelationshipType, getRelationshipDefaults, getRegisteredRelationshipTypes } from './relationships';
export type { RelationType, RelationshipTypeDefaults } from './relationships';
export type { Relationship } from './relationships';

// ─── Memory ───
export { VectorMemory, WORLD_MEMORY_OWNER } from './memory';

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
  POST_TARGET_REQUIREMENT_CHECKERS,
  registerTargetEnricher,
  computeUtility,
  checkRequirements,
  checkRequirementsReactive,
  findByRole,
  validatePlayerAction,
  registerBlockingGoalTypes,
  registerScoringContributor, getScoringContributors, clearScoringContributors,
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
export { evaluateAllVolition, evaluateReactiveVolition, createGoalFromRequest, forceGoalFromAffordance } from './volition';
export type { ParsedIntention } from './volition';
export { resetConsideration } from './volition';
export { buildInstinctDescription, getTierName } from './instinct-builder';
export type { InstinctInput } from './instinct-builder';

// ─── LLM façade & provider system ───
export { classify, generate, generateStream, embed } from './llm-client';
export type { ClassifyRequest, GenerateRequest, GenerateStreamRequest } from './llm-client';
// JSON utility:
export { truncateToFirstJsonObject } from './llm-json-utils';
// Provider interface and types — для packages/providers/* реализаций:
export type {
  LlmProvider,
  LlmCapabilities,
  LlmCallRequest,
  LlmCallResponse,
  LlmStreamRequest,
  LlmStreamChunk,
  LlmEmbedRequest,
  LlmEmbedResponse,
  LlmJsonSchema,
  LlmTask,
  LlmTaskRequirements,
  LlmRoute,
  LlmRouterConfig,
  SamplingHints,
  StructuredOutputMode,
  FinishReason,
  LlmUsageEvent,
  LlmCostGate,
} from './llm-types';
// NPC memory snapshot (Stage 5):
export type { NpcMemoryState } from './agent-types';
// Public registry API — для server boot:
export {
  registerLlmProvider,
  registerLlmTask,
  registerLlmRouter,
  registerLlmUsageRecorder,
  registerLlmCostGate,
  validateLlmRouterContract,
  callWithSchemaRetry,
  disposeAllLlmProviders,
  getRegisteredLlmTasks,
  getRegisteredLlmProviderIds,
} from './llm-registry';
// NOTE: _getLlmProvider/_getLlmSemaphore/_resolveRoute — internal, НЕ экспортируются.

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
export type { WorldCallbacks, WorldSaveData, WorldSaveAgentData } from './world';
export { ProcessingQueue } from './processing-queue';
export type { ProcessingTask, TaskType, TaskHandler } from './processing-queue';

// ─── World Types ───
export type {
  ConversationLine,
  ConversationResult,
  SceneResidue,
  ApproachEvent,
  SceneResidueJSON,
  ExaminationPoint,
  LocationDef,
  MovementResult,
  NpcHome,
  NpcMovementConfig,
  TickResult,
  WorldConfig,
  ArrivalEvent,
} from './world-types';
export { DEFAULT_MOVEMENT_CONFIG, DEFAULT_WORLD_CONFIG, DEFAULT_IL_CONFIG, DEFAULT_CONVERSATION_CONFIG, resolveILConfig, resolveConversationConfig } from './world-types';
export type { ILConfig, ConversationConfig, PressureEffect, ImportanceConfig } from './world-types';
export type { LocationGraph, MoodModifier } from './world-types';
export { modifierEffective } from './world-types';

// ─── Schedule ───
export { ScheduleManager, getTimePeriod, minuteToHour, MINUTES_PER_DAY } from './schedule';
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
export { TopicEngine, TOPIC_SOURCE_REGISTRY, registerTopicSource, getTopicGroup, registerTopicGroupMapping } from './topic-engine';
export type { TopicSource } from './topic-engine';
export type { TopicContext, TopicProposal } from './topic-engine';


// ─── IL (Intent Layer) — Dialogue Meaning Extraction ───
export { extractDialogueMeaning, applyDialogueMeaning, registerDialogueEffectHandler, getDialogueEffectHandlers } from './il';
export type { DialogueMeaning, Claim, Question, RequestedAction, EmotionalPressure, TradeIntent, SpeechAct, ILContext, ILEffectContext, ILEffect, DialogueEffectHandlerFn } from './il';

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

// ─── Scene Residue (generic location-state from an event) ───
export { createSceneResidue, getPassiveNoticeText } from './scene-residue';

// ─── Journal/investigation moved to crime-justice module (A10+A4b) — engine carries no journal. ───

// ─── Secret Directives ───
export { buildSecretDirectives } from './secret-directives';

// ─── Event Registry ───
export {
  registerEventCategory, isEventCategory, getAllRegisteredEventTypes, getEventTypesByCategory, getAllRegisteredSources,
  registerEventTypeFlags, registerEventTypeFlagsBatch, isTransferable, isInformationOnly, subjectReacts,
  registerSourceFlags, isPerpetrator, isFirsthand, isConcealment,
  BELIEF_SOURCE,
  registerEventLabels, getEventLabel, getEventLabelSafe,
  registerEventGoalCleanup, getGoalCleanupForEvent,
  registerEventSceneTypes, getSceneTypeForEvent,
  registerDeathEvents, isDeathEvent, getDefaultDeathEvent,
  registerPursuitEvents, isPursuitEvent,
  registerEventHandler, getEventHandlers,
  registerActionVerbs, getAffordanceIdsForVerb,
  registerSceneResidueTemplate, getSceneResidueTemplate,
  registerRelationshipLabels, getRelationshipLabel,
  registerBeliefSourceLabels, getBeliefSourceLabel,
  registerSourceTransferWeights, getSourceTransferWeight,
  registerSourceDecayRates, getSourceDecayRate, getEventTypeDecayRate,
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
  registerRoleDirectiveBuilder, getRoleDirectiveBuilders,
  registerBeliefPhrasing, phraseBelief,
  registerConsequencePostHandler, getConsequencePostHandlers,
  getAllRegisteredVerbs,
  registerSecretEventType, getSecretEventType,
  registerPressureTypes, getRegisteredPressureTypes,
  registerPressureHandler, getPressureHandler,
  registerSpeechActs, getRegisteredSpeechActs, isValidSpeechAct, isBenignSpeechAct, isTradeSpeechAct, isAccusationSpeechAct,
  registerClaimSources, getRegisteredClaimSources,
  registerILTradeVerbs, getILTradeVerbs,
  registerQuestionTopics, getRegisteredQuestionTopics,
  registerDefaultSpeechAct, getDefaultSpeechAct,
} from './event-registry';
export type { TickPhaseContext, TickPhaseHandlerFn } from './event-registry';
export type { StepExecutionContext, StepHandlerFn, InteractionRunner as StepInteractionRunner } from './event-registry';
export type { PressureHandlerContext, PressureHandlerFn } from './event-registry';
export type { EventHandlerContext, EventHandlerFn, SceneResidueTemplate, BeliefCreatorFn, MemoryTextBuilderFn, DayAdvanceHandlerFn, DayAdvanceContext, DiscoveryContext, DiscoveryHandlerFn, MoodModifierCallback } from './event-registry';
