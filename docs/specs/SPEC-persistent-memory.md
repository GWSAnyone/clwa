# SPEC: Persistent NPC Memory (v2 — post-audit)

> **Milestone**: M2.5 (Memory & Infrastructure)
> **Статус**: Ready for implementation
> **Связанные спеки**: [SPEC-multiplayer-memory](SPEC-multiplayer-memory.md) (deferred, builds on this)
>
> NPC помнят не только ЧТО произошло (beliefs), но и КАК проходили разговоры.
> Память переживает рестарт сервера.

## Проблема

`memory.init({ reset: true })` в `index.ts:270` уничтожает Qdrant коллекции при каждом запуске. NPC теряют episodic memory (текст разговоров, наблюдения). Beliefs (структурированные факты) сохраняются в save.json, но vector memories — нет.

Игрок поговорил с Garrett об убийстве → рестарт → Garrett не помнит разговор (хотя belief "Mark подозреваемый" сохранился).

## Решение: Dual Storage (Stanford подход)

In-memory массив `_memoryLog` на VectorMemory — **primary storage**. Qdrant — **search index**, перестраивается из массива при загрузке.

```
store(text) → embed → push to _memoryLog (text + vector + meta) → upsert to Qdrant
save()      → _memoryLog → save.json
load()      → save.json → _memoryLog → batch upsert to Qdrant (parallel)
recall()    → search Qdrant (как сейчас)
getAllMemories() → read from _memoryLog (NOT Qdrant)
```

Qdrant — expendable index. Можно удалить, переустановить, сменить версию — данные восстановятся из save.json.

## Scope v1: Single-player only

**playerId / multiplayer isolation — DEFERRED.** По рекомендации аудита: v1 реализует persistence без player isolation. Все memories = world memories. Player-NPC multiplayer filtering — отдельная спецификация когда мультиплеер станет актуален.

Причина: playerId смешивает два концепта (bilateral `isPlayer` flag vs multiplayer session identity), и требует отдельной архитектурной проработки.

## MemoryEntry

```typescript
interface MemoryEntry {
  id: string;              // UUID
  text: string;            // "Talked to Garrett about the murder near the blacksmith"
  importance: number;      // 1-10
  gameDay: number;         // in-game day
  timestamp: number;       // unix ms
  vector: number[];        // 768-dim nomic-embed-text-v1.5, cached
  embeddingModel: string;  // "nomic-embed-text-v1.5" — для drift detection
}
```

### Реальные размеры

768-dim float в JSON ≈ 8.4KB per vector + ~200B metadata = **~8.6KB per entry**.

| Сценарий | Memories | Реальный размер |
|----------|----------|-----------------|
| Одна сессия, 9 NPC, ~50/NPC | 450 | ~3.9 MB |
| Длинная сессия, 200/NPC | 1800 | ~15.5 MB |
| Текущий save.json (без memories) | — | ~50-100 KB |

Допустимо для v1. `writeFileSync` 15MB на SSD ≈ 10ms.

**v1.1 optimization**: base64 Float32 encoding (768 × 4 bytes × 4/3 ≈ 4KB per vector, экономия 50%).

## Изменения в коде

### 1. VectorMemory (engine/src/memory.ts)

```typescript
class VectorMemory {
  private _memoryLog: MemoryEntry[] = [];
  private _qdrantAvailable: boolean = true;

  // ─── Store: dual write ───────────────────────────────────────────

  async store(text: string, importance: number, gameDay: number): Promise<void> {
    const vector = await this.embed(text);
    const entry: MemoryEntry = {
      id: crypto.randomUUID(),
      text, importance, gameDay,
      timestamp: Date.now(),
      vector,
      embeddingModel: this.embeddingModel,
    };

    // Primary storage (always succeeds)
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

  // ─── Recall: Qdrant search ──────────────────────────────────────

  async recall(query: string, limit: number): Promise<ScoredMemory[]> {
    if (!this._qdrantAvailable) return this.fallbackRecall(query, limit);
    const vector = await this.embed(query);
    return this.qdrant.search(this.collection, { vector, limit, with_payload: true });
  }

  // Fallback: brute-force cosine similarity on _memoryLog (when Qdrant down)
  private async fallbackRecall(query: string, limit: number): Promise<ScoredMemory[]> {
    const qVec = await this.embed(query);
    const scored = this._memoryLog.map(e => ({
      ...e,
      relevance: cosineSimilarity(qVec, e.vector),
    }));
    scored.sort((a, b) => b.relevance - a.relevance);
    return scored.slice(0, limit);
  }

  // ─── getAllMemories: read from _memoryLog (NOT Qdrant) ──────────

  getAllMemories(currentDay: number): ScoredMemory[] {
    return this._memoryLog.map(e => {
      const daysPassed = currentDay - e.gameDay;
      const decayed = decayedImportance(e.importance, daysPassed);
      const fresh = freshness(daysPassed);
      return {
        id: e.id, text: e.text, importance: e.importance,
        gameDay: e.gameDay, timestamp: e.timestamp,
        relevance: 0, decayedImportance: decayed,
        freshness: fresh, compositeScore: 0,
      };
    });
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
        done++;
        if (done % 50 === 0) console.log(`[Memory] Re-embedded ${done}/${entries.length}...`);
      }
    }

    // Batch upsert to Qdrant (single batch, optimal for <1000 points)
    if (entries.length > 0 && this._qdrantAvailable) {
      try {
        await this.qdrant.upsert(this.collection, {
          points: entries.map(e => ({
            id: e.id, vector: e.vector, payload: this.entryPayload(e),
          })),
        });
      } catch (e) {
        console.warn(`[Memory] Qdrant batch upsert failed: ${e}`);
        this._qdrantAvailable = false;
      }
    }
  }

  // ─── Eviction: decayedImportance scoring ────────────────────────

  private evictIfNeeded(): void {
    const MAX = 200;
    if (this._memoryLog.length <= MAX) return;

    // Score by decayed importance (uses existing decayedImportance function)
    const currentDay = Math.max(...this._memoryLog.map(e => e.gameDay));
    let worstIdx = 0;
    let worstScore = Infinity;
    for (let i = 0; i < this._memoryLog.length; i++) {
      const e = this._memoryLog[i];
      const daysPassed = currentDay - e.gameDay;
      const score = decayedImportance(e.importance, daysPassed);
      if (score < worstScore) { worstScore = score; worstIdx = i; }
    }

    const victim = this._memoryLog[worstIdx];
    this._memoryLog.splice(worstIdx, 1);
    if (this._qdrantAvailable) {
      this.qdrant.delete(this.collection, { points: [victim.id] }).catch(() => {});
    }
  }

  // ─── Init: conditional reset ────────────────────────────────────

  async init(options: { reset?: boolean } = {}): Promise<void> {
    if (options.reset) {
      await this.qdrant.deleteCollection(this.collection).catch(() => {});
    }
    try {
      await this.ensureCollection();
      this._qdrantAvailable = true;
      if (await this.checkEmbeddingDrift()) {
        // Model changed — collection recreated. Memories will be re-embedded on loadState.
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
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]; magA += a[i] * a[i]; magB += b[i] * b[i];
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB) + 1e-8);
}
```

### 2. Agent (engine/src/agent.ts) — include memories in save/load

```typescript
// toJSON() — добавить:
memories: this.memory?.toJSON() ?? [],

// loadState() — НЕ трогать (остаётся sync).
// Memory restore вызывается ОТДЕЛЬНО сервером (см. п.3).
```

### 3. Server boot sequence (server/src/index.ts)

Ключевое: `World.loadState()` остаётся **sync**. Memory restore — **отдельный async шаг** после loadState, до startMasterClock.

```typescript
// ─── Boot with save ───────────────────────────────────────────────
if (savedData) {
  // Step 1: sync restore (beliefs, relationships, mood, goals)
  world.loadState(savedData.world);

  // Step 2: init Qdrant WITHOUT reset (preserve if available)
  for (const [id, agent] of agents) {
    await agent.memory.init({ reset: false });
  }

  // Step 3: async restore memories into Qdrant (PARALLEL for all NPCs)
  await Promise.all(
    Array.from(agents.entries()).map(async ([id, agent]) => {
      const agentData = savedData.world.agents?.find(a => a.id === id);
      const memories = agentData?.memories ?? [];
      if (memories.length > 0) {
        await agent.memory.loadState(memories);
        console.log(`  [Memory] ${agent.profile.name}: ${memories.length} memories restored`);
      }
    })
  );

  // Step 4: start simulation
  world.startMasterClock();

} else {
  // ─── Fresh start (new game) ───────────────────────────────────
  for (const [id, agent] of agents) {
    await agent.memory.init({ reset: true }); // wipe Qdrant
  }
  // Seed knownFacts (ONLY on fresh start, not on restore)
  await seedBackgroundMemories(agents, worldData);
  world.startMasterClock();
}
```

**Критическое**: `seedBackgroundMemories()` (текущие строки 295-303 в index.ts) вызывается **ТОЛЬКО при fresh start**. При restore из save — knownFacts уже в saved memories, повторный seeding создаст дубликаты.

### 4. Named saves (server/src/routes.ts)

Named save load тоже sync (`world.loadState(data)`). Добавить async memory restore:

```typescript
// POST /api/debug/load/:name
const data = JSON.parse(readFileSync(savePath, 'utf-8'));

// Step 1: stop simulation
world.stopMasterClock();

// Step 2: sync restore
world.loadState(data);

// Step 3: async memory restore
for (const [id, agent] of agents) {
  await agent.memory.init({ reset: true }); // clean Qdrant for named save
}
await Promise.all(
  Array.from(agents.entries()).map(async ([id, agent]) => {
    const agentData = data.agents?.find(a => a.id === id);
    const memories = agentData?.memories ?? [];
    if (memories.length > 0) await agent.memory.loadState(memories);
  })
);

// Step 4: restart
world.startMasterClock();
```

Named saves используют `reset: true` — чтобы не было "ghost memories from the future" (текущее поведение, SPEC-dev-tools:50).

### 5. New Game (server/src/routes.ts)

```typescript
// POST /api/new-game
for (const [id, agent] of agents) {
  await agent.memory.init({ reset: true }); // wipe all memories
}
await seedBackgroundMemories(agents, worldData); // fresh knownFacts
```

## Graceful degradation: Qdrant unavailable

Если Qdrant не запущен при старте:
- `init()` ловит exception, ставит `_qdrantAvailable = false`
- `store()` пишет в `_memoryLog` (primary storage), skip Qdrant upsert
- `recall()` использует `fallbackRecall()` — brute-force cosine similarity по `_memoryLog`
- `loadState()` восстанавливает `_memoryLog` из JSON, skip Qdrant batch upsert
- Сервер запускается и работает. Memory search медленнее (O(n) vs O(log n)), но функционален
- Лог: `[Memory] Qdrant unavailable, running in degraded mode`

При 200 memories per NPC, brute-force cosine = ~0.5ms — незаметно.

## Миграция

Старые save.json без `memories` field → `data.memories ?? []` → пустой массив, нет crash. Обратная совместимость автоматическая.

## Known limitations (v1)

1. **ReflectionTracker state не персистируется** — `accumulatedImportance` и `unreflectedMemories` сбрасываются при рестарте. Minor — reflection threshold начинает с 0.
2. **Server crash (no SIGINT) = потеря memories** — save только на graceful shutdown. Periodic autosave — deferred to v1.1.
3. **Player-NPC memory isolation** — отсутствует в v1. Все memories = world. Multiplayer isolation — отдельная спека.
4. **Save.json size** — ~4-15MB с memories vs ~100KB без. Допустимо для single-player.

## Тестирование

1. **Round-trip**: store 5 memories → save → restart → load → recall returns same memories
2. **No knownFacts duplication**: save → restart → load → count knownFacts memories = same as before save
3. **Embedding drift**: change model name in config → load → re-embed triggered → recall still works, progress logged
4. **Eviction**: store 201 memories → oldest/least-important evicted → count = 200
5. **New game**: new game → all memories wiped, knownFacts re-seeded fresh
6. **Named save round-trip**: save checkpoint → advance time → load checkpoint → memories restored to checkpoint state
7. **Backward compat**: load old save without memories field → empty array, no crash
8. **Qdrant down**: stop Docker Qdrant → start server → store/recall still work (degraded mode)
9. **getAllMemories reads _memoryLog**: store memory → kill Qdrant → getAllMemories returns it

## Не делаем (scope out)

- Player-NPC multiplayer isolation — separate spec when multiplayer is active
- Consolidation/reflections — M3+
- Base64 vector encoding — v1.1 optimization
- Graph memory (Mem0 style) — overkill for 9 NPCs
- MemGPT self-directed memory management — 9B model won't handle
- Periodic autosave — v1.1
- ReflectionTracker persistence — minor, deferred
