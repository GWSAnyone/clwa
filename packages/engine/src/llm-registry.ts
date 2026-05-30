/**
 * LLM provider registry — пустые карты, заполняются на boot из server'а.
 *
 * Engine знает: что есть реестр провайдеров, реестр task'ов, роутер.
 * Engine НЕ знает: какие провайдеры, какие модели, какие URL.
 *
 * Доменные строки (model ids, URLs) живут в packages/server/src/llm-defaults.ts.
 * Конкретные провайдеры — в packages/providers/* и регистрируются server'ом на boot.
 */

import type {
  LlmProvider,
  LlmRouterConfig,
  LlmRoute,
  LlmTask,
  LlmTaskRequirements,
  LlmCallRequest,
  LlmCallResponse,
  LlmUsageEvent,
  LlmCostGate,
} from './llm-types';
import { LlmSemaphore } from './llm-semaphore';

const LLM_PROVIDERS = new Map<string, LlmProvider>();
const LLM_SEMAPHORES = new Map<string, LlmSemaphore>();
const LLM_TASKS = new Map<LlmTask, LlmTaskRequirements>();
let LLM_ROUTER: LlmRouterConfig | null = null;
let LLM_USAGE_RECORDER: ((event: LlmUsageEvent) => void | Promise<void>) | null = null;
let LLM_COST_GATE: LlmCostGate | null = null;

// ─── Registration (public) ─────────────────────────────────────────

/** Регистрация провайдера. Идемпотентна по id (повторный вызов = реплейс, dispose старого). */
export function registerLlmProvider(provider: LlmProvider): void {
  if (!provider.id || typeof provider.id !== 'string') {
    throw new Error(`[LLM] registerLlmProvider: provider.id must be non-empty string`);
  }
  const existing = LLM_PROVIDERS.get(provider.id);
  if (existing) {
    existing.dispose?.().catch(() => {});
  }
  LLM_PROVIDERS.set(provider.id, provider);
  LLM_SEMAPHORES.set(provider.id, new LlmSemaphore(provider.capabilities.maxConcurrency));
}

/**
 * Регистрация task'а. Модуль вызывает с именем и требованиями.
 * Engine сам регистрирует ровно одну инфраструктурную задачу — `'embeddings'`.
 * Все доменные task'и (volition/verdict/il/...) регистрируются модулями.
 */
export function registerLlmTask(name: LlmTask, requirements: LlmTaskRequirements = {}): void {
  if (!name || typeof name !== 'string') {
    throw new Error(`[LLM] registerLlmTask: name must be non-empty string`);
  }
  LLM_TASKS.set(name, requirements);
}

/** All registered LLM task names + requirements (read-only accessor for tooling/UI). */
export function getRegisteredLlmTasks(): Array<{ name: string; requirements: LlmTaskRequirements }> {
  return [...LLM_TASKS.entries()].map(([name, requirements]) => ({ name, requirements }));
}

/** All registered provider ids (read-only accessor for tooling/UI). */
export function getRegisteredLlmProviderIds(): string[] {
  return [...LLM_PROVIDERS.keys()];
}

export function registerLlmRouter(config: LlmRouterConfig): void {
  if (!config.default?.provider) {
    throw new Error(`[LLM] registerLlmRouter: default.provider is required`);
  }
  LLM_ROUTER = config;
}

/**
 * Регистрация cost/usage recorder'а. Server вызывает с callback который пишет JSONL в файл.
 * Engine не знает про file I/O. Callback вызывается из façade после КАЖДОГО provider call'а
 * (classify / generate / generateStream / embed) — успешного или нет.
 *
 * Errors в recorder'е логируются, не блокируют LLM-вызов.
 */
export function registerLlmUsageRecorder(fn: (event: LlmUsageEvent) => void | Promise<void>): void {
  LLM_USAGE_RECORDER = fn;
}

/** @internal — only façade calls this. */
export function _emitUsage(event: LlmUsageEvent): void {
  if (!LLM_USAGE_RECORDER) return;
  try {
    Promise.resolve(LLM_USAGE_RECORDER(event)).catch((err) => {
      console.error('[LLM] usage recorder threw:', err);
    });
  } catch (err) {
    console.error('[LLM] usage recorder sync throw:', err);
  }
}

/**
 * Регистрация cost gate — façade-level callback который проверяется перед КАЖДЫМ
 * provider call'ом (classify/generate/generateStream/embed). Применяется ко ВСЕМ task'ам
 * и провайдерам. Server решает что считать (cumulative cost since boot / per-day /
 * per-task etc.) — engine просто вызывает callback и blocks если он не nil.
 */
export function registerLlmCostGate(fn: LlmCostGate): void {
  LLM_COST_GATE = fn;
}

/** @internal — only façade calls this. Returns null if OK, или {reason} если блокировать. */
export async function _checkCostGate(task: LlmTask, agentId: string | undefined): Promise<{ reason: string } | null> {
  if (!LLM_COST_GATE) return null;
  try {
    return await LLM_COST_GATE(task, agentId);
  } catch (err) {
    console.error('[LLM] cost gate threw, allowing call:', err);
    return null;
  }
}

// ─── Internal — НЕ экспортируются из @clwa/engine. Доступны только llm-client.ts (façade). ───

/** @internal */
export function _getLlmProvider(id: string): LlmProvider {
  const p = LLM_PROVIDERS.get(id);
  if (!p) {
    throw new Error(
      `[LLM] No provider registered with id='${id}'. Did server bootstrap forget to register?`,
    );
  }
  return p;
}

/** @internal */
export function _getLlmSemaphore(providerId: string): LlmSemaphore {
  const s = LLM_SEMAPHORES.get(providerId);
  if (!s) throw new Error(`[LLM] No semaphore for provider '${providerId}'`);
  return s;
}

/** @internal */
export function _resolveRoute(task: LlmTask): LlmRoute {
  if (!LLM_ROUTER) {
    throw new Error(`[LLM] No router configured. Call registerLlmRouter() on boot.`);
  }
  return LLM_ROUTER.routes[task] ?? LLM_ROUTER.default;
}

// ─── Contract validation ───────────────────────────────────────────

/**
 * Boot-time проверка:
 *  - каждая зарегистрированная задача имеет route или default
 *  - провайдер по route зарегистрирован
 *  - capability матчатся: streaming task → streaming provider; embeddings task → embeddings=true;
 *    structuredOutput task → не 'none' (warn если 'none' — будет работать через retry-loop)
 */
export function validateLlmRouterContract(): void {
  if (!LLM_ROUTER) throw new Error(`[LLM] Router not registered`);
  if (LLM_TASKS.size === 0) {
    throw new Error(`[LLM] No tasks registered. Modules must call registerLlmTask() on boot.`);
  }

  for (const [task, reqs] of LLM_TASKS) {
    const route = LLM_ROUTER.routes[task] ?? LLM_ROUTER.default;
    const provider = LLM_PROVIDERS.get(route.provider);
    if (!provider) {
      throw new Error(`[LLM] Route '${task}' references unregistered provider '${route.provider}'`);
    }
    if (reqs.requiresEmbeddings && !provider.capabilities.embeddings) {
      throw new Error(
        `[LLM] Task '${task}' requires embeddings, but provider '${route.provider}' has embeddings=false`,
      );
    }
    if (reqs.requiresStreaming && !provider.capabilities.streaming) {
      throw new Error(
        `[LLM] Task '${task}' requires streaming, but provider '${route.provider}' has streaming=false. Re-route to a streaming provider.`,
      );
    }
    if (reqs.requiresStructuredOutput && provider.capabilities.structuredOutput === 'none') {
      console.warn(
        `[LLM] Task '${task}' requires structured output but provider '${route.provider}' has structuredOutput='none'. Will use prompt-engineered retry — may degrade quality.`,
      );
    }
  }
}

// ─── Capability adapter — best-effort schema retry for providers without native structured output ───

export async function callWithSchemaRetry(
  provider: LlmProvider,
  req: LlmCallRequest,
  maxRetries = 2,
): Promise<LlmCallResponse> {
  // Provider with native structured output — pass-through
  if (!req.jsonSchema || provider.capabilities.structuredOutput !== 'none') {
    return provider.call(req);
  }

  // Soft adapter: inject schema description into user prompt, parse with retry
  const augmented: LlmCallRequest = {
    ...req,
    user: `${req.user}\n\nReturn ONLY valid JSON matching this schema (no markdown fences):\n${JSON.stringify(req.jsonSchema.schema, null, 2)}`,
  };
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const resp = await provider.call(augmented);
    if (resp.finishReason === 'error') return resp;
    try {
      JSON.parse(resp.content);
      return resp;
    } catch {
      // retry
    }
  }
  return {
    content: '',
    finishReason: 'schema_violation',
    providerId: provider.id,
    modelId: req.model,
  };
}

// ─── Lifecycle ─────────────────────────────────────────────────────

/** Для shutdown / тестов. */
export async function disposeAllLlmProviders(): Promise<void> {
  await Promise.all(
    Array.from(LLM_PROVIDERS.values()).map((p) => p.dispose?.() ?? Promise.resolve()),
  );
  LLM_PROVIDERS.clear();
  LLM_SEMAPHORES.clear();
  LLM_TASKS.clear();
  LLM_ROUTER = null;
  LLM_USAGE_RECORDER = null;
  LLM_COST_GATE = null;
}


/** Reset per-agent warm sessions across every provider that keeps them (e.g. claude-code). Called when a
 *  player switches NPCs so a fresh conversation does not resume stale session memory. Stateless providers
 *  (lm-studio) implement no resetAgentSession and are skipped. Never throws. */
export async function resetAgentSessions(agentId: string): Promise<void> {
  await Promise.all(
    Array.from(LLM_PROVIDERS.values()).map((p) => p.resetAgentSession?.(agentId) ?? Promise.resolve()),
  );
}

// ─── Engine bootstrap: universal infrastructure tasks (genre-neutral, registered by the engine itself
//     rather than a content module — every world needs them regardless of genre) ────────

registerLlmTask('embeddings', { requiresEmbeddings: true });
// Rolling chat-history summary (agent.ts:summarizeIntoHistory) — folds evicted player-chat turns into a
// one-line summary so context older than the window isn't lost. Plain text output, no special requirements.
// Engine chat infrastructure (like embeddings), not world content → registered here, not in a module, so it
// is visible in the World Editor task list + checked by validateLlmRouterContract for ALL worlds.
registerLlmTask('history-summary', {});
