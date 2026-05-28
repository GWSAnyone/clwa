/**
 * LLM provider types — provider-agnostic contract.
 *
 * Engine знает ТОЛЬКО эти типы. Конкретные провайдеры (LM Studio, Claude Code, …)
 * живут в packages/providers/* и регистрируются на boot. Имя task'а — open string,
 * модули регистрируют свои task'и через registerLlmTask(name, requirements).
 */

/**
 * Имя LLM-задачи — open string. Модули регистрируют свои задачи через `registerLlmTask`.
 * Engine ОБЯЗАН знать ровно одну инфраструктурную задачу — `'embeddings'`. Всё остальное
 * (`'volition'`, `'verdict'`, `'il'`, …) — это слова доменных модулей, и они НЕ должны
 * жить в engine-типах: иначе добавление Economy/Politics модуля = engine change.
 */
export type LlmTask = string;

/** Свойства task'а, известные при регистрации. validateLlmRouterContract по ним проверяет capability. */
export interface LlmTaskRequirements {
  requiresStreaming?: boolean;
  requiresStructuredOutput?: boolean;
  requiresEmbeddings?: boolean;
}

/** Структурная схема, которой ДОЛЖЕН соответствовать ответ. Контракт — JSON.parse(response.content) ⊨ schema. */
export interface LlmJsonSchema {
  name: string;
  strict?: boolean;
  schema: Record<string, unknown>;
}

/** Какой механизм провайдер использует для structured output. */
export type StructuredOutputMode =
  | 'json_schema'   // OpenAI-style response_format (LM Studio, OpenAI) ИЛИ Claude Code CLI --json-schema
  | 'tool_use'      // Anthropic-style tool with input_schema + tool_choice
  | 'grammar'       // llama.cpp GBNF
  | 'none';         // нет нативной поддержки — провайдер делает best-effort через промпт + retry

export interface LlmCapabilities {
  structuredOutput: StructuredOutputMode;
  streaming: boolean;
  embeddings: boolean;
  multiTurnHistory: boolean;
  sampler: {
    temperature: boolean;
    topP: boolean;
    topK: boolean;
    repeatPenalty: boolean;
    frequencyPenalty: boolean;
    presencePenalty: boolean;
  };
  maxConcurrency: number;
  maxOutputTokens: number;
}

export interface SamplingHints {
  temperature?: number;
  topP?: number;
  topK?: number;
  repeatPenalty?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
}

export interface LlmCallRequest {
  /** Конкретная модель, выбранная роутером по task'у. Provider её использует. */
  model: string;
  system: string;
  user: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  maxTokens?: number;
  sampling?: SamplingHints;
  /** Если задан — провайдер ОБЯЗАН вернуть JSON, парсящийся по схеме. */
  jsonSchema?: LlmJsonSchema;
  abortSignal?: AbortSignal;
  /**
   * Опциональный контекст агента — используется провайдерами с per-agent изоляцией
   * (e.g., ClaudeCodeProvider читает <npcsRoot>/<id>/ как cwd). Другие провайдеры игнорируют.
   */
  agentContext?: { id: string };
}

export type FinishReason = 'stop' | 'length' | 'schema_violation' | 'error';

export interface LlmCallResponse {
  content: string;
  finishReason: FinishReason;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    /** Tokens read from prompt cache (Anthropic API caches system prompt + early messages). 0 если нет кэша. */
    cacheReadTokens?: number;
    /** Tokens записанные в кэш на этом вызове (Anthropic cache_creation). 0 если нет. */
    cacheCreationTokens?: number;
    /** Стоимость вызова в USD. Заполняется провайдером если знает (Claude Code result.total_cost_usd). 0 для local providers. */
    costUsd?: number;
  };
  providerId: string;
  modelId: string;
}

export interface LlmStreamRequest {
  model: string;
  system: string;
  user: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  maxTokens?: number;
  sampling?: SamplingHints;
  abortSignal?: AbortSignal;
  agentContext?: { id: string };
}

export interface LlmStreamChunk {
  type: 'token' | 'done' | 'error';
  content?: string;
  error?: Error;
  /** Present on the final `done` chunk for providers that report it (e.g. Claude stream-json result). */
  usage?: {
    promptTokens: number;
    completionTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    costUsd: number;
  };
}

export interface LlmEmbedRequest {
  /** Конкретная embedding-модель из route. */
  model: string;
  input: string;
}

export interface LlmEmbedResponse {
  vector: number[];
  modelId: string;
  vectorSize: number;
  /** Embeddings обычно дешёвые. costUsd опционален: 0 для local, считается провайдером для cloud. */
  usage?: { promptTokens: number; costUsd?: number };
}

/**
 * Событие use'а LLM — эмитится façade'ом после каждого provider call'а.
 * Записывается LlmUsageTracker'ом в data/llm-usage.jsonl для cost-monitoring.
 * Engine не знает про tracker — он только эмитит через registerLlmUsageRecorder hook.
 */
/**
 * Cost gate — façade-level callback вызываемый ПЕРЕД любым provider call'ом.
 * Принимает task name и agentId (если есть). Возвращает либо null (OK to proceed),
 * либо объект с `reason` (блокирует вызов, façade возвращает null/error).
 *
 * Не ограничен бюджетом по деньгам — может быть любая логика: rate limit, role-based block,
 * per-NPC ban, A/B test gating. Регистрируется через registerLlmCostGate.
 */
export type LlmCostGate = (task: LlmTask, agentId: string | undefined) => Promise<{ reason: string } | null>;

export interface LlmUsageEvent {
  /** Unix ms timestamp вызова */
  timestamp: number;
  /** Тип задачи (volition, verdict, dialogue, embeddings, ...) */
  task: LlmTask;
  /** ID агента из agentContext (если был) */
  agentId?: string;
  /** Provider который реально ответил (cold spawn может уехать на fallback) */
  providerId: string;
  /** Конкретная модель которая работала */
  modelId: string;
  /** Stop / length / error / schema_violation */
  finishReason: FinishReason;
  promptTokens: number;
  completionTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  /** Стоимость в USD. 0 для LM Studio (local), >0 для Claude Code / paid API */
  costUsd: number;
  /** Wall-clock latency façade-вызова в ms */
  latencyMs: number;
  /** Был ли вызов с jsonSchema (structured output) */
  hadSchema: boolean;
}

/**
 * Контракт провайдера. Engine знает только это.
 * `model` приходит внутри request — провайдер не должен принимать его вторым аргументом
 * (требование TypeScript `implements`-контракта).
 */
export interface LlmProvider {
  readonly id: string;
  readonly capabilities: LlmCapabilities;
  call(req: LlmCallRequest): Promise<LlmCallResponse>;
  stream(req: LlmStreamRequest): AsyncIterable<LlmStreamChunk>;
  embed(req: LlmEmbedRequest): Promise<LlmEmbedResponse>;
  /** Закрыть пулы, остановить heartbeat, отменить in-flight. Вызывается при shutdown. */
  dispose?(): Promise<void>;
}

/** Маршрут одной задачи. */
export interface LlmRoute {
  provider: string;
  model: string;
  maxTokens?: number;
  sampling?: SamplingHints;
  /** Если primary провайдер бросает или возвращает finishReason='error' — engine пробует fallback. Рекурсивно. */
  fallback?: LlmRoute;
}

export interface LlmRouterConfig {
  default: LlmRoute;
  routes: Partial<Record<LlmTask, LlmRoute>>;
}
