/**
 * LLM façade — engine code calls these primitives, never providers directly.
 *
 * Все вызовы проходят через router (task → provider+model) и per-provider семафор.
 * acquire/release живёт ВНУТРИ примитивов — call-sites больше не пишут try/finally вручную.
 * INV-01 обеспечивается архитектурно: нет публичного acquire().
 *
 * Контракт ошибок: facade ВСЕГДА возвращает `T | null` / `string | null` / `number[] | null`,
 * НИКОГДА не throws. Network / schema_violation / provider exception — все сводятся к `null`,
 * логируются. Call-sites обрабатывают `null` как «модель не дала ответа».
 */

import {
  _resolveRoute,
  _getLlmProvider,
  _getLlmSemaphore,
  _emitUsage,
  _checkCostGate,
  callWithSchemaRetry,
} from './llm-registry';
import type {
  LlmTask,
  LlmJsonSchema,
  LlmRoute,
  SamplingHints,
  LlmCallResponse,
  FinishReason,
} from './llm-types';

/** Helper: emit a usage event after a façade call. Always called, even on error/null response. */
function emitUsage(
  task: LlmTask,
  agentId: string | undefined,
  startMs: number,
  resp: LlmCallResponse | null,
  hadSchema: boolean,
  fallbackProvider: string,
  fallbackModel: string,
  finishReason: FinishReason,
): void {
  _emitUsage({
    timestamp: Date.now(),
    task,
    agentId,
    providerId: resp?.providerId ?? fallbackProvider,
    modelId: resp?.modelId ?? fallbackModel,
    finishReason: resp?.finishReason ?? finishReason,
    promptTokens: resp?.usage?.promptTokens ?? 0,
    completionTokens: resp?.usage?.completionTokens ?? 0,
    cacheReadTokens: resp?.usage?.cacheReadTokens ?? 0,
    cacheCreationTokens: resp?.usage?.cacheCreationTokens ?? 0,
    costUsd: resp?.usage?.costUsd ?? 0,
    latencyMs: Date.now() - startMs,
    hadSchema,
  });
}

// ─── New façade: classify / generate / generateStream / embed ──────

export interface ClassifyRequest<T> {
  system: string;
  user: string;
  schema: LlmJsonSchema;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  /** Phantom — выводится тип T из вызова, в runtime ничего не делает. */
  _phantomType?: T;
  /** Локальный override — обычно НЕ нужен, всё живёт в роуте. Использовать в исключениях:
   *  per-NPC LlmPersonality в Agent.chat/chatStream (миграция Stage 2). */
  maxTokensOverride?: number;
  samplingOverride?: SamplingHints;
  abortSignal?: AbortSignal;
  /** Контекст агента — для провайдеров с per-NPC изоляцией (ClaudeCodeProvider). */
  agentContext?: { id: string };
}

/** Structured classification. Гарантия: возвращённый T валидно соответствует schema. */
export async function classify<T>(task: LlmTask, req: ClassifyRequest<T>): Promise<T | null> {
  return classifyWithRoute<T>(_resolveRoute(task), req, task);
}

async function classifyWithRoute<T>(
  route: LlmRoute,
  req: ClassifyRequest<T>,
  task: LlmTask = 'classify',
): Promise<T | null> {
  // Stage 7b cost gate — checked BEFORE seizing semaphore + provider. Universal across all providers.
  const blocked = await _checkCostGate(task, req.agentContext?.id);
  if (blocked) {
    console.warn(`[LLM:classify] cost gate blocked task='${task}': ${blocked.reason}`);
    emitUsage(task, req.agentContext?.id, Date.now(), null, true, route.provider, route.model, 'error');
    return null;
  }
  const provider = _getLlmProvider(route.provider);
  const sem = _getLlmSemaphore(route.provider);
  await sem.acquire();
  const startMs = Date.now();
  try {
    let resp: LlmCallResponse | null = null;
    try {
      resp = await callWithSchemaRetry(provider, {
        model: route.model,
        system: req.system,
        user: req.user,
        history: req.history,
        maxTokens: req.maxTokensOverride ?? route.maxTokens,
        sampling: { ...route.sampling, ...req.samplingOverride },
        jsonSchema: req.schema,
        abortSignal: req.abortSignal,
        agentContext: req.agentContext,
        warm: route.warm,
        schemaInPrompt: route.schemaInPrompt,
      });
    } catch (err) {
      console.error(`[LLM:classify] provider '${route.provider}' threw:`, err);
      emitUsage(task, req.agentContext?.id, startMs, null, true, route.provider, route.model, 'error');
      return route.fallback ? classifyWithRoute<T>(route.fallback, req, task) : null;
    }
    emitUsage(task, req.agentContext?.id, startMs, resp, true, route.provider, route.model, resp.finishReason);
    if (
      resp.finishReason === 'error' ||
      resp.finishReason === 'schema_violation' ||
      !resp.content
    ) {
      return route.fallback ? classifyWithRoute<T>(route.fallback, req, task) : null;
    }
    try {
      return JSON.parse(resp.content) as T;
    } catch (err) {
      console.error(
        `[LLM:classify] JSON.parse failed for provider='${route.provider}':`,
        err,
        resp.content.slice(0, 200),
      );
      return null;
    }
  } finally {
    sem.release();
  }
}

export interface GenerateRequest {
  system: string;
  user: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  maxTokensOverride?: number;
  samplingOverride?: SamplingHints;
  abortSignal?: AbortSignal;
  /** Контекст агента — для провайдеров с per-NPC изоляцией (ClaudeCodeProvider). */
  agentContext?: { id: string };
}

/** Свободный текстовый ответ. Никакой схемы. Возвращает null на любую инфраструктурную ошибку. */
export async function generate(task: LlmTask, req: GenerateRequest): Promise<string | null> {
  const route = _resolveRoute(task);
  const blocked = await _checkCostGate(task, req.agentContext?.id);
  if (blocked) {
    console.warn(`[LLM:generate] cost gate blocked task='${task}': ${blocked.reason}`);
    emitUsage(task, req.agentContext?.id, Date.now(), null, false, route.provider, route.model, 'error');
    return null;
  }
  const provider = _getLlmProvider(route.provider);
  const sem = _getLlmSemaphore(route.provider);
  await sem.acquire();
  const startMs = Date.now();
  try {
    let resp: LlmCallResponse | null = null;
    try {
      resp = await provider.call({
        model: route.model,
        system: req.system,
        user: req.user,
        history: req.history,
        maxTokens: req.maxTokensOverride ?? route.maxTokens,
        sampling: { ...route.sampling, ...req.samplingOverride },
        abortSignal: req.abortSignal,
        agentContext: req.agentContext,
        warm: route.warm,
        schemaInPrompt: route.schemaInPrompt,
      });
    } catch (err) {
      console.error(`[LLM:generate] provider '${route.provider}' threw:`, err);
      emitUsage(task, req.agentContext?.id, startMs, null, false, route.provider, route.model, 'error');
      return null;
    }
    emitUsage(task, req.agentContext?.id, startMs, resp, false, route.provider, route.model, resp.finishReason);
    return resp.finishReason === 'error' ? null : resp.content;
  } finally {
    sem.release();
  }
}

export interface GenerateStreamRequest extends GenerateRequest {
  onToken: (token: string) => void;
}

/**
 * Streaming free text. На любую ошибку — резолвится строкой "..." (graceful degradation,
 * call-site Agent.chatStream УЖЕ ждёт string не string|null).
 */
export async function generateStream(
  task: LlmTask,
  req: GenerateStreamRequest,
): Promise<string> {
  const route = _resolveRoute(task);
  const blocked = await _checkCostGate(task, req.agentContext?.id);
  if (blocked) {
    console.warn(`[LLM:generateStream] cost gate blocked task='${task}': ${blocked.reason}`);
    return '...';
  }
  const provider = _getLlmProvider(route.provider);
  const sem = _getLlmSemaphore(route.provider);
  await sem.acquire();
  let full = '';
  const startMs = Date.now();
  let finishReason: FinishReason = 'stop';
  // Заполняется из финального `done` чанка, если провайдер его отдаёт (Claude stream-json result).
  let streamedUsage:
    | { promptTokens: number; completionTokens: number; cacheReadTokens: number; cacheCreationTokens: number; costUsd: number }
    | undefined;
  try {
    try {
      for await (const chunk of provider.stream({
        model: route.model,
        system: req.system,
        user: req.user,
        history: req.history,
        maxTokens: req.maxTokensOverride ?? route.maxTokens,
        sampling: { ...route.sampling, ...req.samplingOverride },
        abortSignal: req.abortSignal,
        agentContext: req.agentContext,
        warm: route.warm,
      })) {
        if (chunk.type === 'error' && chunk.error) {
          console.error(
            `[LLM:generateStream] provider '${route.provider}' streamed error:`,
            chunk.error,
          );
          finishReason = 'error';
          break;
        }
        if (chunk.type === 'token' && chunk.content) {
          full += chunk.content;
          req.onToken(chunk.content);
        }
        if (chunk.type === 'done' && chunk.usage) {
          streamedUsage = chunk.usage;
        }
      }
    } catch (err) {
      console.error(`[LLM:generateStream] provider '${route.provider}' threw:`, err);
      finishReason = 'error';
    }
    // Реальный usage из `done` чанка (Claude), иначе approx completionTokens=length/4, cost=0 (LM Studio local).
    _emitUsage({
      timestamp: Date.now(),
      task,
      agentId: req.agentContext?.id,
      providerId: route.provider,
      modelId: route.model,
      finishReason,
      promptTokens: streamedUsage?.promptTokens ?? 0,
      completionTokens: streamedUsage?.completionTokens ?? Math.ceil(full.length / 4),
      cacheReadTokens: streamedUsage?.cacheReadTokens ?? 0,
      cacheCreationTokens: streamedUsage?.cacheCreationTokens ?? 0,
      costUsd: streamedUsage?.costUsd ?? 0,
      latencyMs: Date.now() - startMs,
      hadSchema: false,
    });
    return full || '...';
  } finally {
    sem.release();
  }
}

/** Embeddings — отдельный примитив, всегда роутится через task='embeddings'. */
export async function embed(text: string): Promise<number[] | null> {
  const route = _resolveRoute('embeddings');
  const blocked = await _checkCostGate('embeddings', undefined);
  if (blocked) {
    console.warn(`[LLM:embed] cost gate blocked: ${blocked.reason}`);
    return null;
  }
  const provider = _getLlmProvider(route.provider);
  const sem = _getLlmSemaphore(route.provider);
  await sem.acquire();
  const startMs = Date.now();
  try {
    try {
      const resp = await provider.embed({ model: route.model, input: text });
      _emitUsage({
        timestamp: Date.now(),
        task: 'embeddings',
        providerId: route.provider,
        modelId: resp.modelId,
        finishReason: 'stop',
        promptTokens: resp.usage?.promptTokens ?? 0,
        completionTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        costUsd: resp.usage?.costUsd ?? 0,
        latencyMs: Date.now() - startMs,
        hadSchema: false,
      });
      return resp.vector;
    } catch (err) {
      console.error(`[LLM:embed] provider '${route.provider}' threw:`, err);
      _emitUsage({
        timestamp: Date.now(),
        task: 'embeddings',
        providerId: route.provider,
        modelId: route.model,
        finishReason: 'error',
        promptTokens: 0,
        completionTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        costUsd: 0,
        latencyMs: Date.now() - startMs,
        hadSchema: false,
      });
      return null;
    }
  } finally {
    sem.release();
  }
}

// ─── Re-exports for backward compatibility ─────────────────────────

export { truncateToFirstJsonObject } from './llm-json-utils';
export type { LlmJsonSchema } from './llm-types';

// (Legacy llmCall/llmStream shim removed in Stage 4 — Stage 2 migrated all call-sites)
