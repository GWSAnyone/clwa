/**
 * LlmUsageTracker — пишет JSONL-лог всех LLM-вызовов CLWA для cost/usage observability.
 *
 * Формат: data/llm-usage.jsonl — одно событие на строку (LlmUsageEvent).
 * Append-only — записи не модифицируются и не удаляются. Файл переживает рестарты.
 *
 * Wire-up: server bootstrap создаёт tracker и регистрирует через registerLlmUsageRecorder.
 * Façade вызывает _emitUsage после каждого provider call'а → tracker.record() append'ит в файл.
 *
 * Aggregation: getStats({sinceMs?}) парсит файл, агрегирует by task / provider / model / agent.
 * Эндпоинт GET /api/debug/llm-usage возвращает stats как JSON.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { LlmUsageEvent } from '@clwa/engine';

export interface UsageStatsBucket {
  count: number;
  costUsd: number;
  promptTokens: number;
  completionTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalLatencyMs: number;
  errors: number;
}

export interface UsageStats {
  eventCount: number;
  totalCostUsd: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalCacheReadTokens: number;
  totalCacheCreationTokens: number;
  avgLatencyMs: number;
  errorCount: number;
  windowFromMs?: number;
  windowToMs?: number;
  byTask: Record<string, UsageStatsBucket>;
  byProvider: Record<string, UsageStatsBucket>;
  byModel: Record<string, UsageStatsBucket>;
  byAgent: Record<string, UsageStatsBucket>;
}

function emptyBucket(): UsageStatsBucket {
  return {
    count: 0,
    costUsd: 0,
    promptTokens: 0,
    completionTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    totalLatencyMs: 0,
    errors: 0,
  };
}

function addToBucket(b: UsageStatsBucket, e: LlmUsageEvent): void {
  b.count++;
  b.costUsd += e.costUsd;
  b.promptTokens += e.promptTokens;
  b.completionTokens += e.completionTokens;
  b.cacheReadTokens += e.cacheReadTokens;
  b.cacheCreationTokens += e.cacheCreationTokens;
  b.totalLatencyMs += e.latencyMs;
  if (e.finishReason === 'error' || e.finishReason === 'schema_violation') b.errors++;
}

export class LlmUsageTracker {
  /** Serialize все appendFile через Promise-chain — append системно atomic, но мы перестрахуемся. */
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  /** Записать одно событие. Никогда не throws — error логируется, app продолжает работу. */
  async record(event: LlmUsageEvent): Promise<void> {
    this._bumpCumulative(event.costUsd);
    const next = this.writeQueue.then(async () => {
      try {
        // Ensure directory exists once (idempotent, no error if exists)
        await fs.mkdir(path.dirname(this.filePath), { recursive: true });
        await fs.appendFile(this.filePath, JSON.stringify(event) + '\n');
      } catch (err) {
        console.error('[LlmUsageTracker] write failed:', err);
      }
    });
    this.writeQueue = next;
    await next;
  }

  /** Прочитать все события из файла. Возвращает [] если файла нет. */
  async readAll(): Promise<LlmUsageEvent[]> {
    let text: string;
    try {
      text = await fs.readFile(this.filePath, 'utf-8');
    } catch {
      return [];
    }
    const events: LlmUsageEvent[] = [];
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        events.push(JSON.parse(line) as LlmUsageEvent);
      } catch {
        // Skip corrupt lines (partial writes if process killed mid-line)
      }
    }
    return events;
  }

  /** Полная aggregation по периоду. По умолчанию — все события файла. */
  async getStats(opts?: { sinceMs?: number; untilMs?: number }): Promise<UsageStats> {
    const events = await this.readAll();
    const since = opts?.sinceMs ?? 0;
    const until = opts?.untilMs ?? Number.MAX_SAFE_INTEGER;
    const filtered = events.filter((e) => e.timestamp >= since && e.timestamp <= until);

    const byTask: Record<string, UsageStatsBucket> = {};
    const byProvider: Record<string, UsageStatsBucket> = {};
    const byModel: Record<string, UsageStatsBucket> = {};
    const byAgent: Record<string, UsageStatsBucket> = {};

    let totalCost = 0;
    let totalPrompt = 0;
    let totalCompletion = 0;
    let totalCacheRead = 0;
    let totalCacheCreation = 0;
    let totalLatency = 0;
    let errors = 0;
    let windowFrom: number | undefined;
    let windowTo: number | undefined;

    for (const e of filtered) {
      totalCost += e.costUsd;
      totalPrompt += e.promptTokens;
      totalCompletion += e.completionTokens;
      totalCacheRead += e.cacheReadTokens;
      totalCacheCreation += e.cacheCreationTokens;
      totalLatency += e.latencyMs;
      if (e.finishReason === 'error' || e.finishReason === 'schema_violation') errors++;
      if (windowFrom === undefined || e.timestamp < windowFrom) windowFrom = e.timestamp;
      if (windowTo === undefined || e.timestamp > windowTo) windowTo = e.timestamp;

      const taskBucket = (byTask[e.task] ??= emptyBucket());
      addToBucket(taskBucket, e);
      const providerBucket = (byProvider[e.providerId] ??= emptyBucket());
      addToBucket(providerBucket, e);
      const modelBucket = (byModel[e.modelId] ??= emptyBucket());
      addToBucket(modelBucket, e);
      const agentKey = e.agentId ?? '(no-agent)';
      const agentBucket = (byAgent[agentKey] ??= emptyBucket());
      addToBucket(agentBucket, e);
    }

    return {
      eventCount: filtered.length,
      totalCostUsd: totalCost,
      totalPromptTokens: totalPrompt,
      totalCompletionTokens: totalCompletion,
      totalCacheReadTokens: totalCacheRead,
      totalCacheCreationTokens: totalCacheCreation,
      avgLatencyMs: filtered.length > 0 ? totalLatency / filtered.length : 0,
      errorCount: errors,
      windowFromMs: windowFrom,
      windowToMs: windowTo,
      byTask,
      byProvider,
      byModel,
      byAgent,
    };
  }

  /** Дождаться завершения всех pending записей. Полезно перед readAll() в тестах. */
  async flush(): Promise<void> {
    await this.writeQueue;
  }

  /**
   * Hot cumulative cost since `sinceMs`. Без disk re-read'а — поддерживает in-memory tally.
   * Не идеально точный (события до boot'а tracker'а не учтены), но используется только
   * для budget enforcement где допустима лёгкая погрешность.
   */
  private _cumulativeCost = 0;
  private _cumulativeStart = Date.now();

  /** Cost с момента старта tracker'а (in-memory, fast). Для precise — getStats(). */
  getCumulativeCostSinceBoot(): { costUsd: number; sinceMs: number } {
    return { costUsd: this._cumulativeCost, sinceMs: this._cumulativeStart };
  }

  /** Reset cumulative counter (например при rollover суток). */
  resetCumulative(): void {
    this._cumulativeCost = 0;
    this._cumulativeStart = Date.now();
  }

  /** Internal — вызывается из record() для in-memory cumulative tally. */
  _bumpCumulative(costUsd: number): void {
    this._cumulativeCost += costUsd;
  }

  /** Очистить файл лога (для тестов). */
  async clear(): Promise<void> {
    try {
      await fs.unlink(this.filePath);
    } catch {
      /* ok if didn't exist */
    }
  }
}
