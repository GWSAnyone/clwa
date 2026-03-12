import { QdrantClient } from '@qdrant/js-client-rest';
import { decayedImportance, freshness, compositeScore } from './decay';
import type { Memory, ScoredMemory } from './agent-types';

const DEFAULT_VECTOR_SIZE = 768; // nomic-embed-text-v1.5 full Matryoshka (raw fetch bypasses SDK truncation)
const DEFAULT_EMBEDDING_MODEL = 'text-embedding-nomic-embed-text-v1.5@q8_0';
/** Qdrant payload key storing embedding metadata for drift detection */
const META_POINT_ID = '00000000-0000-0000-0000-000000000000';

export class VectorMemory {
  private qdrant: QdrantClient;
  private lmStudioUrl: string;
  private collection: string;
  private embeddingModel: string;
  private vectorSize: number;

  constructor(
    agentId: string,
    options?: { lmStudioUrl?: string; embeddingModel?: string; vectorSize?: number },
  ) {
    this.qdrant = new QdrantClient({ url: 'http://localhost:6333' });
    this.lmStudioUrl = options?.lmStudioUrl ?? 'http://localhost:1234/v1';
    this.collection = `agent_${agentId}`;
    this.embeddingModel = options?.embeddingModel ?? DEFAULT_EMBEDDING_MODEL;
    this.vectorSize = options?.vectorSize ?? DEFAULT_VECTOR_SIZE;
  }

  /**
   * @param options.reset — if true, delete and recreate collection (wipe all memories)
   */
  async init(options?: { reset?: boolean }): Promise<void> {
    const collections = await this.qdrant.getCollections();
    const exists = collections.collections.some((c) => c.name === this.collection);

    if (exists) {
      if (options?.reset) {
        await this.qdrant.deleteCollection(this.collection);
      } else {
        // Check for embedding drift: if model or dimension changed, recreate
        const needsRecreate = await this.checkEmbeddingDrift();
        if (!needsRecreate) return; // collection is compatible, keep data
        await this.qdrant.deleteCollection(this.collection);
      }
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

  private async embed(text: string): Promise<number[]> {
    // Raw fetch instead of OpenAI SDK — SDK sends extra params that cause LM Studio
    // to truncate Matryoshka embeddings from 768d to 192d
    const res = await fetch(`${this.lmStudioUrl}/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.embeddingModel, input: text }),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Embedding error ${res.status}: ${errText}`);
    }
    const data = await res.json() as { data: Array<{ embedding: number[] }> };
    return data.data[0].embedding;
  }

  async store(text: string, importance: number, gameDay: number): Promise<void> {
    const vector = await this.embed(text);
    const id = crypto.randomUUID();
    await this.qdrant.upsert(this.collection, {
      points: [
        {
          id,
          vector,
          payload: {
            text,
            importance,
            gameDay,
            timestamp: Date.now(),
          },
        },
      ],
    });
  }

  async recall(query: string, currentDay: number, topK: number = 5): Promise<ScoredMemory[]> {
    const queryVector = await this.embed(query);
    const results = await this.qdrant.search(this.collection, {
      vector: queryVector,
      limit: topK * 3,
      with_payload: true,
    });

    const scored: ScoredMemory[] = results.filter((r) => r.id !== META_POINT_ID).map((r) => {
      const p = r.payload as Record<string, unknown>;
      const imp = p.importance as number;
      const day = p.gameDay as number;
      const daysPassed = currentDay - day;
      const decayed = decayedImportance(imp, daysPassed);
      const fresh = freshness(daysPassed);
      const relevance = r.score;

      return {
        id: String(r.id),
        text: p.text as string,
        importance: imp,
        gameDay: day,
        timestamp: p.timestamp as number,
        relevance,
        decayedImportance: decayed,
        freshness: fresh,
        compositeScore: compositeScore(relevance, decayed, fresh),
      };
    });

    scored.sort((a, b) => b.compositeScore - a.compositeScore);
    return scored.slice(0, topK);
  }

  async getAllMemories(currentDay: number): Promise<ScoredMemory[]> {
    const result = await this.qdrant.scroll(this.collection, {
      limit: 100,
      with_payload: true,
      with_vector: false,
    });

    return result.points.filter((p) => p.id !== META_POINT_ID).map((p) => {
      const payload = p.payload as Record<string, unknown>;
      const imp = payload.importance as number;
      const day = payload.gameDay as number;
      const daysPassed = currentDay - day;
      const decayed = decayedImportance(imp, daysPassed);
      const fresh = freshness(daysPassed);

      return {
        id: String(p.id),
        text: payload.text as string,
        importance: imp,
        gameDay: day,
        timestamp: payload.timestamp as number,
        relevance: 0,
        decayedImportance: decayed,
        freshness: fresh,
        compositeScore: 0,
      };
    });
  }
}
