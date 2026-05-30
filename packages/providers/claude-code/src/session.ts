/**
 * Persistent `claude` conversation sessions for streaming player↔NPC dialogue.
 *
 * One ClaudeSession = one long-lived `claude -p --input-format stream-json` process
 * holding a single NPC conversation. The process stays warm between the player's turns,
 * so only the FIRST message pays the cold-spawn (~8s); subsequent turns stream immediately.
 *
 * ClaudeSessionPool keeps one session per agentId and evicts each after `idleMs` of
 * inactivity. Talking to a different NPC spawns a separate session — they coexist.
 *
 * Why this is safe vs the rejected "all NPCs persistent" model: player dialogue is
 * low-volume (usually 1 active conversation) and latency-tolerant. The background world
 * stays on local Qwen. See SPEC-llm-provider.md.
 */

import type { LlmStreamChunk } from '@clwa/engine';

/** Bun.spawn with stdin:'pipe' returns a FileSink exposing write/flush/end. */
type SinkLike = { write: (s: string) => number; flush: () => void; end: () => void };

export interface ClaudeSessionSpawn {
  binary: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
}

interface StreamJsonResult {
  type: 'result';
  is_error?: boolean;
  subtype?: string;
  result?: string;
  /** Present when the session was spawned with --json-schema (structured output). */
  structured_output?: unknown;
  total_cost_usd?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
}

/**
 * One long-lived `claude` process bound to a single NPC conversation.
 * Identity is (model, systemPrompt) — if either changes, the provider discards
 * and respawns (the persona/model of a conversation is fixed at its start).
 */
export class ClaudeSession {
  readonly model: string;
  readonly systemPrompt: string;
  private readonly proc: ReturnType<typeof Bun.spawn>;
  private readonly stdin: SinkLike;
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  private readonly decoder = new TextDecoder();
  private buffer = '';
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private busy = false;
  private dead = false;

  constructor(
    spawn: ClaudeSessionSpawn,
    model: string,
    systemPrompt: string,
    private readonly idleMs: number,
    private readonly onExpire: () => void,
  ) {
    this.model = model;
    this.systemPrompt = systemPrompt;
    this.proc = Bun.spawn([spawn.binary, ...spawn.args], {
      cwd: spawn.cwd,
      env: spawn.env,
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    });
    this.stdin = this.proc.stdin as unknown as SinkLike;
    this.reader = (this.proc.stdout as ReadableStream<Uint8Array>).getReader();
  }

  get alive(): boolean {
    return !this.dead && this.proc.killed !== true;
  }

  private clearIdle(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  /** Arm the idle-eviction timer (no-op for ephemeral sessions). */
  private armIdle(): void {
    if (this.idleMs <= 0) return;
    this.clearIdle();
    this.idleTimer = setTimeout(() => {
      this.onExpire();
      void this.kill();
    }, this.idleMs);
    // Don't let an idle session keep the process from exiting on shutdown.
    (this.idleTimer as unknown as { unref?: () => void })?.unref?.();
  }

  /**
   * Send one user message; stream assistant text tokens; finish on the `result` event.
   * Yields {type:'token'} per text delta, then {type:'done', usage} (or {type:'error'}).
   * The session stays alive afterwards (idle timer armed) for the next turn.
   */
  async *send(userText: string): AsyncIterable<LlmStreamChunk> {
    if (this.dead) {
      yield { type: 'error', error: new Error('claude session is dead') };
      return;
    }
    if (this.busy) {
      yield { type: 'error', error: new Error('claude session busy (concurrent send)') };
      return;
    }
    this.busy = true;
    this.clearIdle();
    try {
      const msg =
        JSON.stringify({ type: 'user', message: { role: 'user', content: userText } }) + '\n';
      this.stdin.write(msg);
      this.stdin.flush();

      while (true) {
        const { done, value } = await this.reader.read();
        if (done) {
          this.dead = true;
          yield { type: 'error', error: new Error('claude session stdout closed') };
          return;
        }
        this.buffer += this.decoder.decode(value, { stream: true });
        const lines = this.buffer.split('\n');
        this.buffer = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          let ev: Record<string, unknown>;
          try {
            ev = JSON.parse(trimmed) as Record<string, unknown>;
          } catch {
            continue; // skip malformed / partial
          }
          const text = extractTextDelta(ev);
          if (text !== null) {
            yield { type: 'token', content: text };
          } else if (ev.type === 'result') {
            const res = ev as unknown as StreamJsonResult;
            if (res.is_error) {
              yield {
                type: 'error',
                error: new Error(`claude result error: ${res.subtype ?? 'unknown'}`),
              };
            } else {
              yield { type: 'done', usage: mapUsage(res) };
            }
            return; // finally arms idle
          }
          // else: system / assistant / message_* / rate_limit_event — ignore
        }
      }
    } finally {
      this.busy = false;
      if (this.alive) this.armIdle();
    }
  }

  /**
   * Send one user message and return the final result (no token streaming) — used by the warm
   * structured-call path. If the session was spawned with --json-schema, returns the JSON-stringified
   * structured_output; otherwise the result text. Keeps the session warm afterwards (idle armed).
   */
  async request(userText: string): Promise<{ content: string; finishReason: 'stop' | 'length' | 'error'; usage?: NonNullable<LlmStreamChunk['usage']> }> {
    if (this.dead) return { content: '', finishReason: 'error' };
    if (this.busy) return { content: '', finishReason: 'error' };
    this.busy = true;
    this.clearIdle();
    try {
      const msg = JSON.stringify({ type: 'user', message: { role: 'user', content: userText } }) + '\n';
      this.stdin.write(msg);
      this.stdin.flush();
      while (true) {
        const { done, value } = await this.reader.read();
        if (done) { this.dead = true; return { content: '', finishReason: 'error' }; }
        this.buffer += this.decoder.decode(value, { stream: true });
        const lines = this.buffer.split('\n');
        this.buffer = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          let ev: Record<string, unknown>;
          try { ev = JSON.parse(trimmed) as Record<string, unknown>; } catch { continue; }
          if (ev.type !== 'result') continue; // ignore stream_event/assistant/system deltas
          const res = ev as unknown as StreamJsonResult;
          if (res.is_error) return { content: '', finishReason: 'error' };
          const content = res.structured_output !== undefined
            ? JSON.stringify(res.structured_output)
            : (res.result ?? '');
          return { content, finishReason: 'stop', usage: mapUsage(res) };
        }
      }
    } finally {
      this.busy = false;
      if (this.alive) this.armIdle();
    }
  }

  async kill(): Promise<void> {
    if (this.dead && this.proc.killed) return;
    this.dead = true;
    this.clearIdle();
    try {
      this.stdin.end();
    } catch {
      /* sink already closed */
    }
    try {
      this.reader.releaseLock();
    } catch {
      /* reader in use */
    }
    try {
      this.proc.kill();
    } catch {
      /* already exited */
    }
    try {
      await this.proc.exited;
    } catch {
      /* ignore */
    }
  }
}

/** Extract assistant text from a stream-json partial-message event, or null if not a text delta. */
function extractTextDelta(ev: Record<string, unknown>): string | null {
  if (ev.type !== 'stream_event') return null;
  const inner = ev.event as { type?: string; delta?: { type?: string; text?: unknown } } | undefined;
  if (inner?.type !== 'content_block_delta') return null;
  if (inner.delta?.type !== 'text_delta') return null;
  return typeof inner.delta.text === 'string' ? inner.delta.text : null;
}

function mapUsage(res: StreamJsonResult): NonNullable<LlmStreamChunk['usage']> {
  const u = res.usage ?? {};
  return {
    promptTokens: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
    completionTokens: u.output_tokens ?? 0,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    cacheCreationTokens: u.cache_creation_input_tokens ?? 0,
    costUsd: res.total_cost_usd ?? 0,
  };
}

/** One warm session per agentId, idle-evicted. Multiple NPCs coexist. */
export class ClaudeSessionPool {
  private readonly sessions = new Map<string, ClaudeSession>();

  get(agentId: string): ClaudeSession | undefined {
    const s = this.sessions.get(agentId);
    if (s && !s.alive) {
      this.sessions.delete(agentId);
      return undefined;
    }
    return s;
  }

  set(agentId: string, session: ClaudeSession): void {
    this.sessions.set(agentId, session);
  }

  remove(agentId: string): void {
    this.sessions.delete(agentId);
  }

  size(): number {
    return this.sessions.size;
  }

  async disposeAll(): Promise<void> {
    const all = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.all(all.map((s) => s.kill()));
  }

  /** Kill + drop every session belonging to one agent: the exact `agentId` key (streaming pool) AND any
   *  compound `${agentId}::model::schema` key (structured pool). Used to reset a warm conversation on NPC switch. */
  async killAgent(agentId: string): Promise<void> {
    const prefix = `${agentId}::`;
    const toKill: ClaudeSession[] = [];
    for (const [key, s] of this.sessions) {
      if (key === agentId || key.startsWith(prefix)) {
        this.sessions.delete(key);
        toKill.push(s);
      }
    }
    await Promise.all(toKill.map((s) => s.kill()));
  }
}
