# SPEC: Persistent NPC Memory (v3 — post-audit + manual review)

> **Milestone**: M2.5 (Memory & Infrastructure)
> **Статус**: IMPLEMENTED (v0.12.0, 2026-04-10)
> **Связанные спеки**: [SPEC-multiplayer-memory](SPEC-multiplayer-memory.md) (deferred, builds on this)
>
> NPC помнят не только ЧТО произошло (beliefs), но и КАК проходили разговоры.
> Память переживает рестарт сервера.

## Проблема

`memory.init({ reset: true })` в `index.ts:270` уничтожает Qdrant коллекции при каждом запуске. NPC теряют episodic memory. Beliefs сохраняются в save.json, vector memories — нет.

## Решение: Dual Storage (Stanford подход)

In-memory массив `_memoryLog` на VectorMemory — **primary storage**. Qdrant — **search index**, перестраивается из массива при загрузке.

```
store(text) → embed → push to _memoryLog (text + vector + meta) → upsert to Qdrant
save()      → _memoryLog → save.json (через World.toJSON → WorldSaveAgentData.memories)
load()      → save.json → _memoryLog → batch upsert to Qdrant (parallel)
recall()    → Qdrant search → composite scoring (relevance + decayedImportance + freshness)
getAllMemories() → read from _memoryLog (NOT Qdrant) — sync
```

## Scope: Single-player only

playerId / multiplayer isolation — DEFERRED (see SPEC-multiplayer-memory).

## MemoryEntry

```typescript
interface MemoryEntry {
  id: string;              // UUID
  text: string;            // "Talked to Garrett about the murder near the blacksmith"
  importance: number;      // 1-10
  gameDay: number;         // in-game day
  timestamp: number;       // unix ms
  vector: number[];        // 768-dim nomic-embed-text-v1.5, cached
  embeddingModel: string;  // "nomic-embed-text-v1.5" — drift detection
  protected?: boolean;     // true = never evicted (crime evidence, key events)
}
```

### Реальные размеры (с pretty-print)

768-dim float pretty-printed ≈ 15.6KB per entry. Без pretty-print ≈ 8.6KB.

| Сценарий | Memories | Pretty-print | Compact |
|----------|----------|-------------|---------|
| Одна сессия, 9 NPC, ~50/NPC | 450 | ~7 MB | ~3.9 MB |
| Длинная сессия, 200/NPC | 1800 | ~28 MB | ~15.5 MB |

**Решение**: save.json для memories использовать compact stringify (без indent). `JSON.stringify(data)` для memories section, pretty для остального. Или: единый compact stringify для всего save.json (машинный формат, не для ручного чтения).

**v1.1**: base64 Float32 encoding — 768 × 4 bytes × 4/3 ≈ 4KB per vector. Экономия 50-75%.

## Изменения в коде

### 1. WorldConfig — configurable limits

```typescript
// В WorldConfig (engine/src/world-types.ts):
memoryCapacity?: number;  // default 200. Max memories per NPC.
```

Не magic number, а конфигурируемый параметр (Invariant 16 principle).

### 2. VectorMemory (engine/src/memory.ts)

```typescript
class VectorMemory {
  private _memoryLog: MemoryEntry[] = [];
  private _qdrantAvailable: boolean = true;
  private _maxCapacity: number = 200; // from WorldConfig

  // ─── Store: dual write ───────────────────────────────────────────

  async store(text: string, importance: number, gameDay: number, isProtected?: boolean): Promise<void> {
    const vector = await this.embed(text);
    const entry: MemoryEntry = {
      id: crypto.randomUUID(),
      text, importance, gameDay,
      timestamp: Date.now(),
      vector,
      embeddingModel: this.embeddingModel,
      protected: isProtected || undefined,
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

  // ─── Recall: composite scoring preserved ────────────────────────

  async recall(query: string, currentDay: number, topK: number = 5): Promise<ScoredMemory[]> {
    let results: ScoredMemory[];

    if (this._qdrantAvailable) {
      const vector = await this.embed(query);
      const raw = await this.qdrant.search(this.collection, {
        vector, limit: topK * 3, with_payload: true,
      });
      results = raw.map(p => this.scoreMemory(p, currentDay));
    } else {
      results = await this.fallbackRecall(query, currentDay, topK * 3);
    }

    // Composite scoring: relevance × 0.4 + decayedImportance × 0.4 + freshness × 0.2
    for (const m of results) {
      m.compositeScore = m.relevance * 0.4 + m.decayedImportance * 0.4 + m.freshness * 0.2;
    }
    results.sort((a, b) => b.compositeScore - a.compositeScore);
    return results.slice(0, topK);
  }

  // Fallback: brute-force cosine on _memoryLog
  private async fallbackRecall(query: string, currentDay: number, limit: number): Promise<ScoredMemory[]> {
    let qVec: number[];
    try {
      qVec = await this.embed(query);
    } catch {
      // LM Studio also down — keyword fallback
      return this.keywordRecall(query, currentDay, limit);
    }
    return this._memoryLog.map(e => ({
      ...this.baseScore(e, currentDay),
      relevance: cosineSimilarity(qVec, e.vector),
    })).sort((a, b) => b.relevance - a.relevance).slice(0, limit);
  }

  // Last resort: keyword match when both Qdrant and LM Studio down
  private keywordRecall(query: string, currentDay: number, limit: number): ScoredMemory[] {
    const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    return this._memoryLog
      .map(e => {
        const text = e.text.toLowerCase();
        const hits = words.filter(w => text.includes(w)).length;
        return { ...this.baseScore(e, currentDay), relevance: hits / Math.max(words.length, 1) };
      })
      .filter(m => m.relevance > 0)
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, limit);
  }

  // ─── getAllMemories: sync, from _memoryLog ──────────────────────

  getAllMemories(currentDay: number): ScoredMemory[] {
    // BREAKING CHANGE: was async (Qdrant scroll), now sync (_memoryLog).
    // All callers must remove await. TypeScript will catch.
    return this._memoryLog.map(e => this.baseScore(e, currentDay));
  }

  // ─── Persistence ────────────────────────────────────────────────

  toJSON(): MemoryEntry[] {
    return this._memoryLog;
  }

  async loadState(entries: MemoryEntry[]): Promise<void> {
    this._memoryLog = entries;

    // Re-embed if model changed
    const needsReembed = entries.length > 0 && entries.some(e => e.embeddingModel !== this.embeddingModel);
    if (needsReembed) {
      console.warn(`[Memory] Embedding model changed, re-embedding ${entries.length} memories...`);
      let done = 0;
      for (const e of entries) {
        e.vector = await this.embed(e.text);
        e.embeddingModel = this.embeddingModel;
        if (++done % 50 === 0) console.log(`[Memory] Re-embedded ${done}/${entries.length}...`);
      }
    }

    // Batch upsert to Qdrant
    if (entries.length > 0 && this._qdrantAvailable) {
      try {
        await this.qdrant.upsert(this.collection, {
          points: entries.map(e => ({ id: e.id, vector: e.vector, payload: this.entryPayload(e) })),
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

    const currentDay = Math.max(...this._memoryLog.map(e => e.gameDay));
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

  // ─── Init: conditional reset, graceful degradation ──────────────

  async init(options: { reset?: boolean } = {}): Promise<void> {
    if (options.reset) {
      await this.qdrant.deleteCollection(this.collection).catch(() => {});
      this._memoryLog = [];
    }
    try {
      await this.ensureCollection();
      this._qdrantAvailable = true;
      if (await this.checkEmbeddingDrift()) {
        // Model changed — collection recreated. Re-embed on loadState.
      }
    } catch (e) {
      console.warn(`[Memory] Qdrant unavailable, running in degraded mode: ${e}`);
      this._qdrantAvailable = false;
    }
  }

  // ─── Helpers ────────────────────────────────────────────────────

  private entryPayload(e: MemoryEntry): Record<string, unknown> {
    return { text: e.text, importance: e.importance, gameDay: e.gameDay, timestamp: e.timestamp };
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
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]; magA += a[i] * a[i]; magB += b[i] * b[i];
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB) + 1e-8);
}
```

### 3. Serialization: WorldSaveAgentData + World.toJSON()

**Agent.toJSON() НЕ существует.** Сериализация идёт через World.toJSON() → WorldSaveAgentData.

```typescript
// В WorldSaveAgentData (world-types.ts или world.ts):
interface WorldSaveAgentData {
  // ...existing fields...
  memories?: MemoryEntry[];  // NEW
}

// В World.toJSON():
for (const [id, agent] of this.agents) {
  agentData[id] = {
    ...existingFields,
    memories: agent.memory?.toJSON() ?? [],  // NEW
  };
}

// В World.loadState() — НЕ ТРОГАТЬ (остаётся sync)
// Memory restore = отдельный async шаг (см. п.4)
```

### 4. Server boot sequence (server/src/index.ts)

World.loadState() остаётся **sync**. Memory restore — **отдельный async шаг**.

```typescript
if (savedData) {
  // Step 1: sync restore (beliefs, relationships, mood, goals)
  world.loadState(savedData.world);

  // Step 2: init Qdrant WITHOUT reset
  for (const [id, agent] of agents) {
    await agent.memory.init({ reset: false });
  }

  // Step 3: async restore memories (PARALLEL)
  await Promise.all(
    Array.from(agents.entries()).map(async ([id, agent]) => {
      const agentData = savedData.world.agents[id]; // Record access, NOT .find()
      const memories = agentData?.memories ?? [];
      if (memories.length > 0) {
        await agent.memory.loadState(memories);
        console.log(`  [Memory] ${agent.profile.name}: ${memories.length} memories restored`);
      }
    })
  );

  // Step 4: start simulation (NO knownFacts seeding — already in saved memories)
  world.startMasterClock();

} else {
  // Fresh start
  for (const [id, agent] of agents) {
    await agent.memory.init({ reset: true });
  }
  await seedBackgroundMemories(agents, worldData); // knownFacts ONLY on fresh start
  world.startMasterClock();
}
```

**Критическое**: `seedBackgroundMemories()` вызывается **ТОЛЬКО при fresh start**. При restore — knownFacts уже в saved memories.

**Qdrant пустой + save.json есть** (crash recovery): flow покрывает — `init({ reset: false })` создаёт пустую collection, `loadState()` делает batch upsert из saved memories. Qdrant заполняется из JSON.

### 5. Named saves (server/src/routes.ts)

```typescript
// POST /api/debug/load/:name
world.stopMasterClock();
const data = JSON.parse(readFileSync(savePath, 'utf-8'));

// Step 1: sync restore
world.loadState(data);

// Step 2: Qdrant reset (clean — named saves = time travel)
for (const [id, agent] of agents) {
  await agent.memory.init({ reset: true });
}

// Step 3: async memory restore (PARALLEL)
await Promise.all(
  Array.from(agents.entries()).map(async ([id, agent]) => {
    const memories = data.agents?.[id]?.memories ?? []; // Record access
    if (memories.length > 0) await agent.memory.loadState(memories);
  })
);

// Step 4: restart
world.startMasterClock();
```

### 6. Protected memories — кто ставит флаг

Engine предоставляет механизм (`protected: boolean` на MemoryEntry). Модули решают что защищать:

- `agent.observe()` получает optional `protected` parameter
- IL: player показал улику → `store(text, importance, gameDay, true)`
- CG cascade: NPC стал свидетелем убийства → `store(text, importance, gameDay, true)`
- Обычные разговоры, рутинные наблюдения → `protected = false` (default)

## Миграция

Старые save.json без `memories` → `agentData.memories ?? []` → пустой массив. Без crash.

## Known limitations (v1)

1. **ReflectionTracker state не персистируется** — accumulatedImportance сбрасывается при рестарте
2. **Server crash = потеря memories** — save только на SIGINT. Periodic autosave — v1.1
3. **No player isolation** — все memories = world. Multiplayer — SPEC-multiplayer-memory
4. **getAllMemories() стал sync** — callers должны убрать await (TypeScript поймает)
5. **_memoryLog = O(n) array** — eviction scan линейный. Для 200 entries = <1ms. При масштабировании: рассмотреть sorted structure.
6. **Qdrant recovery** — `_qdrantAvailable = false` не recovery'ится до рестарта. v1.1: retry через N минут.

## Тестирование

1. **Round-trip**: store 5 memories → save → restart → load → recall returns same memories with same composite scores
2. **No knownFacts duplication**: save → restart → count memories = same as before (no double seeding)
3. **Embedding drift**: change model name → load → re-embed triggered → recall works, progress logged
4. **Eviction**: store 201 memories → oldest/least-important unprotected evicted → count = 200
5. **Protected eviction**: store 200 protected + 1 unprotected → unprotected evicted, all protected stay
6. **New game**: all memories wiped, knownFacts re-seeded fresh
7. **Named save round-trip**: save checkpoint → advance → load checkpoint → memories at checkpoint state
8. **Backward compat**: old save without memories → empty array, no crash
9. **Qdrant down**: stop Docker → start server → store/recall work (degraded)
10. **LM Studio down + Qdrant down**: recall falls back to keyword search
11. **getAllMemories from _memoryLog**: store → kill Qdrant → getAllMemories returns it (sync)
12. **Qdrant empty + save exists**: restart with empty Qdrant → loadState fills it from save

## Не делаем (scope out)

- Player isolation — SPEC-multiplayer-memory
- Consolidation/reflections — M3+
- Base64 vector encoding — v1.1
- Periodic autosave — v1.1
- Qdrant auto-recovery — v1.1
- ReflectionTracker persistence — minor, deferred
