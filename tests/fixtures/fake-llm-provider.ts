/**
 * FakeLlmProvider — детерминированный mock для тестов.
 *
 * Не делает реальных вызовов. Embedding = deterministic hash → vector (768 dims).
 * Chat/classify = пустой dialogue response или заглушка JSON по схеме.
 *
 * Использование в тестах:
 *   import { setupFakeLlm } from './fixtures/fake-llm-provider';
 *   beforeAll(setupFakeLlm);
 */

import {
  registerLlmProvider,
  registerLlmTask,
  registerLlmRouter,
  validateLlmRouterContract,
  disposeAllLlmProviders,
} from '@clwa/engine';
import type {
  LlmProvider,
  LlmCallRequest,
  LlmCallResponse,
  LlmCapabilities,
  LlmEmbedRequest,
  LlmEmbedResponse,
  LlmStreamChunk,
  LlmStreamRequest,
} from '@clwa/engine';

const VECTOR_SIZE = 768;

function deterministicVector(text: string): number[] {
  // FNV-1a hash → seed → simple xorshift
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const out = new Array<number>(VECTOR_SIZE);
  let state = h | 1;
  for (let i = 0; i < VECTOR_SIZE; i++) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    // Map int32 → [-1, 1] float
    out[i] = (state / 0x7fffffff) * 0.5;
  }
  return out;
}

export class FakeLlmProvider implements LlmProvider {
  readonly id = 'fake';
  readonly capabilities: LlmCapabilities = {
    structuredOutput: 'json_schema',
    streaming: true,
    embeddings: true,
    multiTurnHistory: true,
    sampler: {
      temperature: true,
      topP: true,
      topK: true,
      repeatPenalty: true,
      frequencyPenalty: true,
      presencePenalty: true,
    },
    maxConcurrency: 8,
    maxOutputTokens: 2048,
  };

  async call(req: LlmCallRequest): Promise<LlmCallResponse> {
    let content = '';
    if (req.jsonSchema) {
      // Возвращаем минимальный валидный JSON по схеме (только required поля с дефолтами).
      content = JSON.stringify(buildDefaultFromSchema(req.jsonSchema.schema));
    } else {
      content = `[fake reply to: ${req.user.slice(0, 60)}]`;
    }
    return {
      content,
      finishReason: 'stop',
      providerId: this.id,
      modelId: req.model,
    };
  }

  async *stream(req: LlmStreamRequest): AsyncIterable<LlmStreamChunk> {
    const text = `[fake stream reply to: ${req.user.slice(0, 40)}]`;
    for (const ch of text) yield { type: 'token', content: ch };
    yield { type: 'done' };
  }

  async embed(req: LlmEmbedRequest): Promise<LlmEmbedResponse> {
    const vector = deterministicVector(req.input);
    return { vector, modelId: req.model, vectorSize: vector.length };
  }
}

/** Сгенерировать минимальный объект-заглушку из JSON Schema по required-полям. */
function buildDefaultFromSchema(schema: unknown): Record<string, unknown> {
  const s = schema as { type?: string; properties?: Record<string, unknown>; required?: string[] };
  if (s.type !== 'object' || !s.properties) return {};
  const out: Record<string, unknown> = {};
  for (const key of s.required ?? Object.keys(s.properties)) {
    const prop = s.properties[key] as {
      type?: string;
      enum?: unknown[];
      properties?: Record<string, unknown>;
      items?: unknown;
    };
    if (prop.enum && prop.enum.length > 0) {
      out[key] = prop.enum[0];
    } else if (prop.type === 'string') {
      out[key] = '';
    } else if (prop.type === 'number' || prop.type === 'integer') {
      out[key] = 0;
    } else if (prop.type === 'boolean') {
      out[key] = false;
    } else if (prop.type === 'array') {
      out[key] = [];
    } else if (prop.type === 'object' && prop.properties) {
      out[key] = buildDefaultFromSchema(prop);
    } else {
      out[key] = null;
    }
  }
  return out;
}

/**
 * Boot LLM registry для тестов: регистрирует FakeLlmProvider, все стандартные task'и,
 * и router который роутит ВСЁ на 'fake'.
 *
 * Идемпотентен: disposeAllLlmProviders() сбрасывает state перед re-setup.
 */
export async function setupFakeLlm(): Promise<void> {
  await disposeAllLlmProviders();

  registerLlmProvider(new FakeLlmProvider());

  // Registry уже зарегистрировал 'embeddings' на bootstrap engine'а — после disposeAll он сброшен,
  // регистрируем заново.
  registerLlmTask('embeddings', { requiresEmbeddings: true });
  registerLlmTask('volition', { requiresStructuredOutput: true });
  registerLlmTask('il', { requiresStructuredOutput: true });
  registerLlmTask('verdict', { requiresStructuredOutput: true });
  registerLlmTask('dialogue', { requiresStreaming: true });
  registerLlmTask('npc-dialogue', {});
  registerLlmTask('reflection', {});

  registerLlmRouter({
    default: { provider: 'fake', model: 'fake-model' },
    routes: {
      embeddings: { provider: 'fake', model: 'fake-embed' },
    },
  });

  validateLlmRouterContract();
}
