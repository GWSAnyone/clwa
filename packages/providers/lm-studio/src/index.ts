/**
 * LMStudioProvider — OpenAI-compatible endpoint with llama.cpp samplers.
 *
 * Adapts CLWA's provider-agnostic LlmCallRequest to LM Studio's
 * /v1/chat/completions (with response_format: json_schema for structured output)
 * and /v1/embeddings (raw fetch — SDK would truncate Matryoshka 768→192).
 */

import type {
  LlmProvider,
  LlmCallRequest,
  LlmCallResponse,
  LlmStreamChunk,
  LlmStreamRequest,
  LlmEmbedRequest,
  LlmEmbedResponse,
  LlmCapabilities,
} from '@clwa/engine';
import { truncateToFirstJsonObject } from '@clwa/engine';

export interface LMStudioProviderOptions {
  baseUrl: string;
  /** Default 2 для локального GPU. Можно поднять до 4 для тестов на M-series. */
  maxConcurrency?: number;
}

export class LMStudioProvider implements LlmProvider {
  readonly id = 'lm-studio';
  readonly capabilities: LlmCapabilities;

  constructor(private readonly opts: LMStudioProviderOptions) {
    this.capabilities = {
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
      maxConcurrency: opts.maxConcurrency ?? 2,
      maxOutputTokens: 4096,
    };
  }

  async call(req: LlmCallRequest): Promise<LlmCallResponse> {
    const body: Record<string, unknown> = {
      model: req.model,
      messages: this.buildMessages(req),
      temperature: req.sampling?.temperature ?? 0.7,
      max_tokens: Math.min(req.maxTokens ?? 200, this.capabilities.maxOutputTokens),
    };
    if (req.sampling?.repeatPenalty !== undefined) body.repeat_penalty = req.sampling.repeatPenalty;
    if (req.sampling?.frequencyPenalty !== undefined) body.frequency_penalty = req.sampling.frequencyPenalty;
    if (req.sampling?.presencePenalty !== undefined) body.presence_penalty = req.sampling.presencePenalty;
    if (req.sampling?.topP !== undefined) body.top_p = req.sampling.topP;
    if (req.sampling?.topK !== undefined) body.top_k = req.sampling.topK;

    if (req.jsonSchema) {
      body.response_format = {
        type: 'json_schema',
        json_schema: {
          name: req.jsonSchema.name,
          strict: req.jsonSchema.strict ?? true,
          schema: req.jsonSchema.schema,
        },
      };
    }

    const res = await fetch(`${this.opts.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: req.abortSignal,
    });

    if (!res.ok) {
      return { content: '', finishReason: 'error', providerId: this.id, modelId: req.model };
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const raw = data.choices?.[0]?.message?.content?.trim() ?? '';
    const content = req.jsonSchema ? truncateToFirstJsonObject(raw) : raw;
    return {
      content,
      finishReason: data.choices?.[0]?.finish_reason === 'length' ? 'length' : 'stop',
      usage: data.usage
        ? {
            promptTokens: data.usage.prompt_tokens ?? 0,
            completionTokens: data.usage.completion_tokens ?? 0,
            cacheReadTokens: 0,           // LM Studio не имеет кэша
            cacheCreationTokens: 0,
            costUsd: 0,                   // Local inference — бесплатно
          }
        : undefined,
      providerId: this.id,
      modelId: req.model,
    };
  }

  async *stream(req: LlmStreamRequest): AsyncIterable<LlmStreamChunk> {
    const res = await fetch(`${this.opts.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: req.abortSignal,
      body: JSON.stringify({
        model: req.model,
        messages: this.buildMessages(req),
        temperature: req.sampling?.temperature ?? 0.7,
        max_tokens: Math.min(req.maxTokens ?? 250, this.capabilities.maxOutputTokens),
        stream: true,
        ...(req.sampling?.repeatPenalty !== undefined && { repeat_penalty: req.sampling.repeatPenalty }),
        ...(req.sampling?.frequencyPenalty !== undefined && { frequency_penalty: req.sampling.frequencyPenalty }),
        ...(req.sampling?.presencePenalty !== undefined && { presence_penalty: req.sampling.presencePenalty }),
      }),
    });

    if (!res.ok) {
      yield { type: 'error', error: new Error(`LM Studio HTTP ${res.status}`) };
      return;
    }
    if (!res.body) {
      yield { type: 'error', error: new Error('LM Studio response has no body') };
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') {
            yield { type: 'done' };
            return;
          }
          try {
            const parsed = JSON.parse(data) as {
              choices?: Array<{ delta?: { content?: string } }>;
            };
            const token = parsed.choices?.[0]?.delta?.content;
            if (token) yield { type: 'token', content: token };
          } catch {
            // skip malformed SSE lines
          }
        }
      }
      yield { type: 'done' };
    } finally {
      reader.releaseLock();
    }
  }

  async embed(req: LlmEmbedRequest): Promise<LlmEmbedResponse> {
    // Raw fetch (как в существующем memory.ts) — SDK обрезает Matryoshka 768→192
    const res = await fetch(`${this.opts.baseUrl}/v1/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: req.model, input: req.input }),
    });
    if (!res.ok) {
      throw new Error(`Embedding HTTP ${res.status}: ${await res.text().catch(() => '')}`);
    }
    const data = (await res.json()) as {
      data: Array<{ embedding: number[] }>;
      usage?: { prompt_tokens?: number };
    };
    const vector = data.data[0].embedding;
    return {
      vector,
      modelId: req.model,
      vectorSize: vector.length,
      usage: { promptTokens: data.usage?.prompt_tokens ?? 0, costUsd: 0 },
    };
  }

  private buildMessages(
    req: LlmCallRequest | LlmStreamRequest,
  ): Array<{ role: string; content: string }> {
    const msgs: Array<{ role: string; content: string }> = [{ role: 'system', content: req.system }];
    if (req.history) msgs.push(...req.history);
    msgs.push({ role: 'user', content: req.user });
    return msgs;
  }
}
