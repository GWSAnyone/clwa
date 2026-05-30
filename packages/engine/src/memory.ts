import { QdrantClient } from '@qdrant/js-client-rest';
import { decayedImportance, freshness, compositeScore } from './decay';
import type { MemoryEntry, ScoredMemory } from './agent-types';
import { embed } from './llm-client';

const DEFAULT_VECTOR_SIZE = 768; // nomic-embed-text-v1.5 full Matryoshka (raw fetch bypasses SDK truncation)
const DEFAULT_EMBEDDING_MODEL = 'text-embedding-nomic-embed-text-v1.5@q8_0';
/** Qdrant payload key storing embedding metadata for drift detection */
const META_POINT_ID = '00000000-0000-0000-0000-000000000000';

/** Sentinel for world-scope memories (NPC-NPC, events, knownFacts). Multiplayer-ready. */
export const WORLD_MEMORY_OWNER = '__world__' as const;

export class VectorMemory {
  private qdrant: QdrantClient;
  private lmStudioUrl: string;
  private collection: string;
  private embeddingModel: string;
  private vectorSize: number;
  private _memoryLog: MemoryEntry[] = [];
  private _qdrantAvailable: boolean = false; // set to true by init() if Qdrant responds
  private _maxCapacity: number;

  constructor(
    agentId: string,
    options?: { lmStudioUrl?: string; embeddingModel?: string; vectorSize?: number; maxCapacity?: number },
  ) {
    this.qdrant = new QdrantClient({ url: 'http://localhost:6333' });
    this.lmStudioUrl = options?.lmStudioUrl ?? 'http://localhost:1234/v1';
    this.collection = `agent_${agentId}`;
    this.embeddingModel = options?.embeddingModel ?? DEFAULT_EMBEDDING_MODEL;
    this.vectorSize = options?.vectorSize ?? DEFAULT_VECTOR_SIZE;
    this._maxCapacity = options?.maxCapacity ?? 200;
  }

  // ─── Init: conditional reset, graceful degradation ──────────────

  async init(options?: { reset?: boolean }): Promise<void> {
    if (options?.reset) {
      this._memoryLog = [];
      try {
        await this.qdrant.deleteCollection(this.collection).catch(() => {});
        await this.ensureCollection();
        this._qdrantAvailable = true;
      } catch (e) {
        console.warn(`[Memory] Qdrant unavailable on reset, running degraded: ${e}`);
        this._qdrantAvailable = false;
      }
      return;
    }

    // Non-reset: ensure collection exists, check drift
    try {
      await this.ensureCollection();
      this._qdrantAvailable = true;
    } catch (e) {
      console.warn(`[Memory] Qdrant unavailable, running in degraded mode: ${e}`);
      this._qdrantAvailable = false;
    }
  }

  private async ensureCollection(): Promise<void> {
    const collections = await this.qdrant.getCollections();
    const exists = collections.collections.some((c) => c.name === this.collection);

    if (exists) {
      const needsRecreate = await this.checkEmbeddingDrift();
      if (!needsRecreate) return;
      await this.qdrant.deleteCollection(this.collection);
    }

    await this.qdrant.createCollection(this.collection, {
      vectors: { size: this.vectorSize, distance: 'Cosine' },
    });

    // Store metadata point for drift detection
    await this.qdrant.upsert(this.collection, {
      points: [{
        id: META_POINT_ID,
        vector: new Array(this.vectorSize).fill(0),
        payload: {
          _meta: true,
          embeddingModel: this.embeddingModel,
          vectorSize: this.vectorSize,
          createdAt: Date.now(),
        },
      }],
    });
  }

  /** Returns true if collection must be recreated (model or dimension mismatch) */
  private async checkEmbeddingDrift(): Promise<boolean> {
    try {
      const points = await this.qdrant.retrieve(this.collection, { ids: [META_POINT_ID], with_payload: true });
      if (points.length === 0) return true; // no metadata → legacy collection, recreate
      const payload = points[0].payload as Record<string, unknown>;
      if (payload.embeddingModel !== this.embeddingModel) return true;
      if (payload.vectorSize !== this.vectorSize) return true;
      return false;
    } catch {
      return true; // any error → safer to recreate
    }
  }

  // ─── Embed ──────────────────────────────────────────────────────

  private async embed(text: string): Promise<number[]> {
    // Идёт через façade → embeddings route → LMStudioProvider (raw fetch внутри, Matryoshka сохраняется)
    const vec = await embed(text);
    if (!vec) {
      throw new Error(`[Memory] embed() returned null — LM Studio down? Check provider logs.`);
    }
    return vec;
  }

  // ─── Store: dual write ──────────────────────────────────────────

  async store(text: string, importance: number, gameDay: number, isProtected?: boolean, playerId?: string): Promise<void> {
    const vector = await this.embed(text);
    const entry: MemoryEntry = {
      id: crypto.randomUUID(),
      text,
      importance,
      gameDay,
      timestamp: Date.now(),
      vector,
      embeddingModel: this.embeddingModel,
      protected: isProtected || undefined,
      playerId: playerId ?? WORLD_MEMORY_OWNER,
    };

    this._memoryLog.push(entry);
    this.evictIfNeeded();

    // Search index (best-effort)
    if (this._qdrantAvailable) {
      try {
        await this.qdrant.upsert(this.collection, {
          points: [{ id: entry.id, vector: entry.vector, payload: this.entryPayload(entry) }],
        });
      } catch (e) {
        console.warn(`[Memory] Qdrant upsert failed, search degraded: ${e}`);
        this._qdrantAvailable = false;
      }
    }
  }

  // ─── Recall: composite scoring, 3-level fallback ───────────────

  async recall(query: string, currentDay: number, topK: number = 5, playerId?: string): Promise<ScoredMemory[]> {
    // Degenerate-query guard: a too-short query embeds to noise and the composite would return
    // importance-topped junk. Skip recall entirely rather than inject irrelevant memories.
    if (query.trim().split(/\s+/).filter((w) => w.length > 2).length === 0) return [];

    let results: ScoredMemory[];

    if (this._qdrantAvailable) {
      try {
        const vector = await this.embed(query);
        const raw = await this.qdrant.search(this.collection, {
          vector, limit: topK * 3, with_payload: true,
        });
        results = raw
          .filter((r) => r.id !== META_POINT_ID)
          .map((r) => {
            const p = r.payload as Record<string, unknown>;
            const entryPlayerId = (p.playerId as string) ?? WORLD_MEMORY_OWNER;
            return { ...this.payloadToScore(p, currentDay), relevance: r.score, entryPlayerId };
          })
          .filter((m) => this.matchesPlayerScope(m.entryPlayerId, playerId))
          .map(({ entryPlayerId: _, ...rest }) => rest);
      } catch (e) {
        console.warn(`[Memory] Qdrant search failed, falling back to cosine: ${e}`);
        this._qdrantAvailable = false;
        results = await this.fallbackRecall(query, currentDay, topK * 3, playerId);
      }
    } else {
      results = await this.fallbackRecall(query, currentDay, topK * 3, playerId);
    }

    // Composite scoring via the SINGLE source of truth (decay.ts compositeScore) — it normalizes
    // decayedImportance (÷10) so relevance/freshness aren't swamped by raw importance. (Previously this was
    // inlined WITHOUT the ÷10, so a fresh importance-10 memory scored 4.0 and drowned out relevance.)
    for (const m of results) {
      m.compositeScore = compositeScore(m.relevance, m.decayedImportance, m.freshness);
    }
    results.sort((a, b) => b.compositeScore - a.compositeScore);
    return results.slice(0, topK);
  }

  /** Fallback: brute-force cosine on _memoryLog */
  private async fallbackRecall(query: string, currentDay: number, limit: number, playerId?: string): Promise<ScoredMemory[]> {
    let qVec: number[];
    try {
      qVec = await this.embed(query);
    } catch {
      // LM Studio also down — keyword fallback
      return this.keywordRecall(query, currentDay, limit, playerId);
    }
    const filtered = this.filterByPlayer(playerId);
    return filtered.map((e) => ({
      ...this.baseScore(e, currentDay),
      relevance: cosineSimilarity(qVec, e.vector),
    })).sort((a, b) => b.relevance - a.relevance).slice(0, limit);
  }

  /** Last resort: keyword match when both Qdrant and LM Studio down */
  private keywordRecall(query: string, currentDay: number, limit: number, playerId?: string): ScoredMemory[] {
    const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
    const filtered = this.filterByPlayer(playerId);
    return filtered
      .map((e) => {
        const text = e.text.toLowerCase();
        const hits = words.filter((w) => text.includes(w)).length;
        return { ...this.baseScore(e, currentDay), relevance: hits / Math.max(words.length, 1) };
      })
      .filter((m) => m.relevance > 0)
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, limit);
  }

  // ─── getAllMemories: sync, from _memoryLog ──────────────────────

  getAllMemories(currentDay: number, playerId?: string): ScoredMemory[] {
    const filtered = this.filterByPlayer(playerId);
    return filtered.map((e) => this.baseScore(e, currentDay));
  }

  // ─── Persistence ────────────────────────────────────────────────

  toJSON(): MemoryEntry[] {
    return this._memoryLog;
  }

  async loadState(entries: MemoryEntry[]): Promise<void> {
    // Migration: add playerId if missing (v1 → v2)
    for (const e of entries) {
      if (!e.playerId) e.playerId = WORLD_MEMORY_OWNER;
    }
    this._memoryLog = entries;

    // Re-embed if model changed
    const needsReembed = entries.length > 0 && entries.some((e) => e.embeddingModel !== this.embeddingModel);
    if (needsReembed) {
      console.warn(`[Memory] Embedding model changed, re-embedding ${entries.length} memories...`);
      let done = 0;
      for (const e of entries) {
        if (e.embeddingModel !== this.embeddingModel) {
          e.vector = await this.embed(e.text);
          e.embeddingModel = this.embeddingModel;
        }
        if (++done % 50 === 0) console.log(`[Memory] Re-embedded ${done}/${entries.length}...`);
      }
    }

    // Batch upsert to Qdrant (rebuild search index from _memoryLog)
    if (entries.length > 0 && this._qdrantAvailable) {
      try {
        await this.qdrant.upsert(this.collection, {
          points: entries.map((e) => ({ id: e.id, vector: e.vector, payload: this.entryPayload(e) })),
        });
      } catch (e) {
        console.warn(`[Memory] Qdrant batch upsert failed: ${e}`);
        this._qdrantAvailable = false;
      }
    }
  }

  // ─── Eviction: decayedImportance, protected memories immune ─────

  private evictIfNeeded(): void {
    if (this._memoryLog.length <= this._maxCapacity) return;

    // Single-pass: find currentDay and worst entry simultaneously
    let currentDay = 0;
    for (const e of this._memoryLog) {
      if (e.gameDay > currentDay) currentDay = e.gameDay;
    }
    let worstIdx = -1;
    let worstScore = Infinity;
    for (let i = 0; i < this._memoryLog.length; i++) {
      const e = this._memoryLog[i];
      if (e.protected) continue; // protected memories NEVER evicted
      const score = decayedImportance(e.importance, currentDay - e.gameDay);
      if (score < worstScore) { worstScore = score; worstIdx = i; }
    }

    if (worstIdx === -1) return; // all protected — over capacity but can't evict
    const victim = this._memoryLog[worstIdx];
    this._memoryLog.splice(worstIdx, 1);
    if (this._qdrantAvailable) {
      this.qdrant.delete(this.collection, { points: [victim.id] }).catch(() => {});
    }
  }

  // ─── Player scope filtering (multiplayer-ready) ────────────────

  private filterByPlayer(playerId?: string): MemoryEntry[] {
    if (!playerId) return this._memoryLog.filter((e) => e.playerId === WORLD_MEMORY_OWNER);
    return this._memoryLog.filter((e) => e.playerId === playerId || e.playerId === WORLD_MEMORY_OWNER);
  }

  private matchesPlayerScope(entryPlayerId: string, queryPlayerId?: string): boolean {
    if (!queryPlayerId) return entryPlayerId === WORLD_MEMORY_OWNER;
    return entryPlayerId === queryPlayerId || entryPlayerId === WORLD_MEMORY_OWNER;
  }

  // ─── Helpers ────────────────────────────────────────────────────

  private entryPayload(e: MemoryEntry): Record<string, unknown> {
    return { text: e.text, importance: e.importance, gameDay: e.gameDay, timestamp: e.timestamp, playerId: e.playerId ?? WORLD_MEMORY_OWNER };
  }

  private baseScore(e: MemoryEntry, currentDay: number): ScoredMemory {
    const daysPassed = currentDay - e.gameDay;
    return {
      id: e.id, text: e.text, importance: e.importance,
      gameDay: e.gameDay, timestamp: e.timestamp,
      relevance: 0,
      decayedImportance: decayedImportance(e.importance, daysPassed),
      freshness: freshness(daysPassed),
      compositeScore: 0,
    };
  }

  private payloadToScore(p: Record<string, unknown>, currentDay: number): ScoredMemory {
    const imp = p.importance as number;
    const day = p.gameDay as number;
    const daysPassed = currentDay - day;
    return {
      id: String(p.id ?? ''),
      text: p.text as string,
      importance: imp,
      gameDay: day,
      timestamp: p.timestamp as number,
      relevance: 0,
      decayedImportance: decayedImportance(imp, daysPassed),
      freshness: freshness(daysPassed),
      compositeScore: 0,
    };
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]; magA += a[i] * a[i]; magB += b[i] * b[i];
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB) + 1e-8);
}
