/**
 * Centralized LLM client — single point for all LLM calls.
 *
 * Uses OpenAI-compatible endpoint (/v1/chat/completions).
 * Supports structured output via response_format: json_schema.
 * Does NOT manage semaphore — callers handle concurrency.
 */

import { DEFAULT_WORLD_CONFIG } from './world-types';

// ─── Types ───

export interface LlmCallOptions {
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
  /** If provided, model MUST return JSON conforming to this schema */
  jsonSchema?: LlmJsonSchema;
  /** Base URL override (default: from DEFAULT_WORLD_CONFIG) */
  baseUrl?: string;
  /** Model override (default: from DEFAULT_WORLD_CONFIG) */
  model?: string;
  /** Penalize repeated tokens (1.0 = none, >1.0 = penalty). Default from WorldConfig. */
  repeatPenalty?: number;
  /** Penalize tokens proportional to frequency. 0.0-2.0. Default from WorldConfig. */
  frequencyPenalty?: number;
  /** Penalize any token already present. 0.0-2.0. Default from WorldConfig. */
  presencePenalty?: number;
}

export interface LlmJsonSchema {
  name: string;
  strict?: boolean;
  schema: Record<string, unknown>;
}

export interface LlmStreamOptions {
  system: string;
  user: string;
  onToken: (token: string) => void;
  temperature?: number;
  maxTokens?: number;
  /** Additional messages for multi-turn (chat history) */
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  baseUrl?: string;
  model?: string;
}

// ─── JSON utilities ───

/**
 * Truncate raw LLM output to first complete JSON object.
 * Handles multi-object output (e.g. {"speech":"..."} {"name":"..."})
 * by brace-matching with proper string/escape awareness.
 */
export function truncateToFirstJsonObject(raw: string): string {
  const trimmed = raw.trim().replace(/,\s*}/g, '}').replace(/,\s*$/g, '');
  if (!trimmed.startsWith('{')) return trimmed;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\' && inString) { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    if (ch === '}') { depth--; if (depth === 0) return trimmed.slice(0, i + 1); }
  }
  return trimmed; // no matching close brace — return as-is, let JSON.parse handle
}

// ─── Single call ───

export async function llmCall(options: LlmCallOptions): Promise<string | null> {
  const baseUrl = options.baseUrl ?? DEFAULT_WORLD_CONFIG.lmStudioUrl;
  const model = options.model ?? DEFAULT_WORLD_CONFIG.model;

  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: 'system', content: options.system },
      { role: 'user', content: options.user },
    ],
    temperature: options.temperature ?? 0.7,
    max_tokens: options.maxTokens ?? 200,
    repeat_penalty: options.repeatPenalty ?? DEFAULT_WORLD_CONFIG.repeatPenalty ?? 1.0,
    frequency_penalty: options.frequencyPenalty ?? DEFAULT_WORLD_CONFIG.frequencyPenalty ?? 0,
    presence_penalty: options.presencePenalty ?? DEFAULT_WORLD_CONFIG.presencePenalty ?? 0,
  };

  if (options.jsonSchema) {
    body.response_format = {
      type: 'json_schema',
      json_schema: {
        name: options.jsonSchema.name,
        strict: options.jsonSchema.strict ?? true,
        schema: options.jsonSchema.schema,
      },
    };
  }

  try {
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      console.error(`  [LLM] Error ${res.status}: ${await res.text().catch(() => 'unknown')}`);
      return null;
    }

    const data = await res.json() as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    return data.choices?.[0]?.message?.content?.trim() || null;
  } catch (err) {
    console.error(`  [LLM] Call failed:`, err);
    return null;
  }
}

// ─── Streaming call ───

export async function llmStream(options: LlmStreamOptions): Promise<string> {
  const baseUrl = options.baseUrl ?? DEFAULT_WORLD_CONFIG.lmStudioUrl;
  const model = options.model ?? DEFAULT_WORLD_CONFIG.model;

  const messages: Array<{ role: string; content: string }> = [
    { role: 'system', content: options.system },
  ];

  if (options.history) {
    messages.push(...options.history);
  }

  messages.push({ role: 'user', content: options.user });

  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 250,
      stream: true,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LLM stream error ${res.status}: ${text}`);
  }

  let fullReply = '';
  const reader = res.body!.getReader();
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
        if (data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data);
          // OpenAI SSE format: { choices: [{ delta: { content: "..." } }] }
          const token = parsed.choices?.[0]?.delta?.content;
          if (token) {
            fullReply += token;
            options.onToken(token);
          }
        } catch {
          // skip unparseable SSE lines
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return fullReply || '...';
}
