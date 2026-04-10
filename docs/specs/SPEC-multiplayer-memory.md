# SPEC: Multiplayer Memory Isolation

> **Milestone**: M2.5 (Memory & Infrastructure) — DEFERRED часть, реализация при Phase 3
> **Статус**: Spec ready, implementation deferred
> **Зависит от**: [SPEC-persistent-memory](SPEC-persistent-memory.md) (must be implemented first)
> **Связанные спеки**: SPEC-persistent-memory → **эта спека** → будущая SPEC-multiplayer-architecture
> **Цель**: NPC помнит каждого игрока отдельно. Player A рассказал Garrett одно, Player B — другое. Garrett не путает.

## Проблема

В single-player (SPEC-persistent-memory v1) все memories = world memories. Один игрок, одна линия разговоров. В мультиплеере:

- Player A говорит Garrett: "Я видел Mark у кузницы ночью"
- Player B говорит Garrett: "Mark мой друг, он ни при чём"
- Garrett должен помнить **обе** линии **раздельно** и не путать

Без изоляции: Garrett в разговоре с Player B вспомнит "вы сказали что видели Mark у кузницы" — но это сказал Player A.

## Два типа памяти

| Тип | Фильтр | Пример | Видимость |
|-----|--------|--------|-----------|
| **World** | `playerId = "__world__"` | NPC-NPC разговоры, события мира, knownFacts | Все игроки |
| **Player-NPC** | `playerId = "player_abc"` | Разговоры конкретного игрока с NPC | Только этот игрок |

**Sentinel string `"__world__"`** вместо null — Qdrant надёжнее фильтрует по string match чем по is_null. Все memories из SPEC-persistent-memory v1 получают `playerId = "__world__"` при миграции.

## Ключевые архитектурные решения

### 1. Player identity: playerId ≠ isPlayer

`isPlayer` — bilateral design flag на Agent. Один Agent, один flag.

`playerId` — session identity. В мультиплеере каждый человеческий клиент имеет уникальный playerId (UUID или auth ID). Несколько playerId могут быть в мире одновременно.

**Как они связаны**: при single-player `playerId = agent.id` (player Agent ID). При мультиплеере каждый WS connection несёт свой playerId. Player Agent может быть один (shared world) или несколько (per-player instances) — это решение отдельной multiplayer architecture спеки.

### 2. Qdrant: один collection per NPC, фильтрация по playerId

Не создаём отдельные collections per player — это collection explosion (100 players × 9 NPCs = 900 collections).

Вместо этого: одна collection per NPC (как сейчас), каждый point имеет `playerId` в payload:

```typescript
// Store
payload: { text, importance, gameDay, timestamp, playerId: "__world__" | "player_abc" }

// Recall for player chat
filter: {
  should: [
    { key: "playerId", match: { value: playerId } },    // player-specific memories
    { key: "playerId", match: { value: "__world__" } },  // world memories always included
  ]
}

// Recall for NPC-NPC conversation
filter: {
  must: [
    { key: "playerId", match: { value: "__world__" } }   // world only
  ]
}
```

### 3. Storage: per-player files

```
data/
  save.json                     ← world state + world memories (all agents)
  players/
    {playerId}.json             ← player-NPC memories для конкретного игрока
    {playerId}.json
```

**Player file format:**
```json
{
  "playerId": "player_abc",
  "lastConnected": 1712700000,
  "npcMemories": {
    "garrett": [
      { "id": "...", "text": "...", "importance": 6, "gameDay": 2, "timestamp": 1712700100, "vector": [...], "embeddingModel": "nomic-embed-text-v1.5" }
    ],
    "mark": [],
    "aldric": [...]
  }
}
```

### 4. Connection/disconnection flow

**Player connects:**
```
WS handshake with playerId
  → load data/players/{playerId}.json (or create empty)
  → for each NPC that has memories with this player:
      memory.loadPlayerMemories(playerId, entries)
        → append to _memoryLog
        → batch upsert to Qdrant with playerId payload
  → player ready to chat
```

**Player disconnects:**
```
WS close
  → for each NPC:
      extract memories where playerId == this player
      → write to data/players/{playerId}.json
  → remove player-specific points from Qdrant (optional optimization, they'll be ignored by filter)
```

**Periodic save (v1.1):**
```
Every N minutes:
  → for each connected player:
      dump player memories to file (crash protection)
```

### 5. store() API change

```typescript
// v1 (current — SPEC-persistent-memory):
async store(text: string, importance: number, gameDay: number): Promise<void>

// v2 (multiplayer):
async store(text: string, importance: number, gameDay: number, playerId?: string): Promise<void>
// playerId defaults to "__world__" for NPC-NPC
// playerId = specific ID for player-NPC chat
```

Вызывающий код (server chat handler, conversation system) передаёт playerId при store. Engine не знает откуда playerId приходит — bilateral design preserved.

### 6. recall() API change

```typescript
// v1 (current):
async recall(query: string, limit: number): Promise<ScoredMemory[]>

// v2 (multiplayer):
async recall(query: string, limit: number, playerId?: string): Promise<ScoredMemory[]>
// playerId set → filter: this player OR world
// playerId not set → filter: world only (NPC-NPC recall)
```

### 7. _memoryLog management

С multiplayer `_memoryLog` содержит ВСЕ memories — и world, и всех подключённых players. Методы:

```typescript
getWorldMemories(): MemoryEntry[]
  → filter playerId === "__world__"

getPlayerMemories(playerId: string): MemoryEntry[]
  → filter playerId === playerId

toJSON(): MemoryEntry[]
  → return only world memories (for save.json)

toPlayerJSON(playerId: string): MemoryEntry[]
  → return only this player's memories (for player file)

loadPlayerMemories(playerId: string, entries: MemoryEntry[]): Promise<void>
  → append to _memoryLog + batch upsert to Qdrant

unloadPlayerMemories(playerId: string): MemoryEntry[]
  → extract from _memoryLog, return for saving to file
  → optionally delete from Qdrant
```

### 8. Eviction: per-scope limits

```
World memories: max 200 per NPC (shared)
Player memories: max 100 per NPC per player
```

Eviction по `decayedImportance()` в рамках каждого scope отдельно.

## Edge cases

| Сценарий | Решение |
|----------|---------|
| **Два игрока к одному NPC одновременно** | `inPlayerChat` блокирует второго. Второй игрок видит "NPC is busy". Очередь не нужна — игрок подождёт и попробует позже. |
| **Player disconnect без clean close** | Memories в `_memoryLog`. При следующем save (SIGINT или autosave) — запишутся в player file. Потеря только при crash без save. |
| **NPC вспоминает player A info при разговоре с player B** | Невозможно — Qdrant filter по playerId. World memories (NPC-NPC) доступны обоим, но player-specific — только своему owner. |
| **NPC рассказывает player B о том что player A говорил** | Это BELIEF, не memory. Если player A создал belief через IL ("Mark подозрителен"), NPC может поделиться этим belief с player B через belief transfer. Memories изолированы, beliefs — общие. Это корректное поведение. |
| **100 игроков, каждый по 100 memories с 9 NPC** | 100 × 100 × 9 = 90,000 entries в Qdrant. При 768-dim vectors ≈ 280MB RAM. Qdrant справляется (документация: 1M+ vectors). Player files: 100 × ~2.7MB = 270MB на диске. |
| **Player не играл месяц, подключается** | Его файл загружается, memories upsert в Qdrant. NPC вспоминает старые разговоры. `decayedImportance` снизит relevance старых memories — корректно. |
| **New game** | Wipe world memories + delete ALL player files в `data/players/`. |
| **Player file corruption** | `JSON.parse` в try/catch → если fail, пустые memories для этого player. Log warning. |
| **Migration from v1 (no playerId)** | Все existing memories получают `playerId = "__world__"`. Автоматическая миграция в loadState: `if (!entry.playerId) entry.playerId = "__world__"`. |

## Gaps identified by audit (must close before implementation)

### Gap 1: Player Agent memory scope

Player Agent тоже имеет VectorMemory. В мультиплеере:
- Player A обнаружил труп → Player A's Agent gets memory. World event? Player-specific?
- Player B подслушал разговор NPC → memory для Player B's Agent.

**Решение**: Player Agent memories = **всегда private** (playerId = own ID). Мировые события (body discovered, crime scenes) создают memories для ВСЕХ agents, включая players — это world-scope через event system, но каждый Agent получает свою копию в свой VectorMemory. Player Agent's memories не расшариваются.

### Gap 2: fallbackRecall с playerId

v1 добавляет fallbackRecall (brute-force cosine). v2 добавляет playerId filtering. fallbackRecall должен тоже фильтровать:

```typescript
private async fallbackRecall(query: string, currentDay: number, limit: number, playerId?: string): Promise<ScoredMemory[]> {
  const filtered = playerId
    ? this._memoryLog.filter(e => e.playerId === playerId || e.playerId === WORLD_MEMORY_OWNER)
    : this._memoryLog.filter(e => e.playerId === WORLD_MEMORY_OWNER);
  // ...cosine similarity on filtered...
}
```

### Gap 3: getAllMemories scope filtering

`getAllMemories()` читает из `_memoryLog`. В v2 `_memoryLog` содержит все scopes. API `/api/memories/:id` не должен показывать player-specific memories.

```typescript
getAllMemories(currentDay: number, playerId?: string): ScoredMemory[]
  // playerId set → this player + world
  // playerId not set → world only
```

### Gap 4: `"__world__"` как engine constant

```typescript
// В engine/src/memory.ts:
export const WORLD_MEMORY_OWNER = "__world__" as const;
```

Не хардкодить строку — engine-level constant, аналогично `BELIEF_SOURCE.TESTIMONY`.

### Gap 5: inPlayerChatWith вместо inPlayerChat boolean

```typescript
// Сейчас: inPlayerChat: boolean
// Мультиплеер: inPlayerChatWith: string | null  (playerId или null)
```

Boolean не показывает КТО занял NPC. Для multiplayer нужен ID чтобы:
- Показать другим "NPC is talking to someone"
- Разрешить тому же player пере-подключиться к чату после disconnect

### Gap 6: Player file retention policy

Без TTL файлы копятся вечно. 10,000 игроков × 2.7MB = 27GB.

```
Retention policy:
- Files older than 90 days without connection → archive/delete
- Max 1000 active player files. FIFO eviction on overflow.
- Configurable in WorldConfig: playerMemoryTTLDays, maxPlayerFiles
```

### Gap 7: unloadPlayerMemories — explicit strategy

Не "optional". Явное решение:

**На disconnect**: удалить player-specific points из Qdrant. Причины:
- Без удаления Qdrant растёт с каждым подключением (points never removed)
- При reconnect — loadPlayerMemories upsert'ит заново из файла
- Qdrant delete по filter = быстро (~10ms)

```typescript
async unloadPlayerMemories(playerId: string): MemoryEntry[] {
  const entries = this._memoryLog.filter(e => e.playerId === playerId);
  this._memoryLog = this._memoryLog.filter(e => e.playerId !== playerId);
  // Delete from Qdrant
  if (this._qdrantAvailable) {
    const ids = entries.map(e => e.id);
    await this.qdrant.delete(this.collection, { points: ids }).catch(() => {});
  }
  return entries;
}
```

### Gap 8: toJSON() breaking change v1→v2

v1: `toJSON()` returns all memories.
v2: `toJSON()` returns world-only. `toPlayerJSON(playerId)` returns player-specific.

**Migration strategy**: v2 code checks `toJSON()` caller context. Main save → world-only. Player file → player-specific. No breaking change if callers are updated at same time as VectorMemory.

Document in implementation checklist: "Update all toJSON() callers in World.toJSON() and player save logic".

### Gap 9: Integration test v1→v2

```
Test: v1 save → v2 code load → player connects → memories correct
1. Create v1 save.json with memories (no playerId field)
2. Load with v2 code → migration adds "__world__" to all
3. Player connects → gets world memories in recall
4. Player stores new memory → gets playerId
5. Save → world memories in save.json, player memories in player file
6. Reload → both restored correctly
```

## Что НЕ решает эта спека

- **Multiplayer Agent architecture** — сколько player Agent'ов, shared world vs instanced zones. Отдельная спека.
- **Concurrent NPC processing** — ProcessingQueue serial → parallel. Отдельная спека.
- **Player authentication** — откуда playerId (auth, session cookie). Отдельная спека.
- **Consolidation** — memory summarization при overflow. DEFERRED M3+.

## Реализация (checklist)

Когда придёт время имплементировать:

1. [ ] `WORLD_MEMORY_OWNER` constant в engine/src/memory.ts
2. [ ] Добавить `playerId: string` в `MemoryEntry` (default `WORLD_MEMORY_OWNER`)
3. [ ] Миграция: loadState добавляет `WORLD_MEMORY_OWNER` если playerId отсутствует
4. [ ] `store()` принимает optional playerId
5. [ ] `recall()` принимает optional playerId, строит Qdrant filter
6. [ ] `fallbackRecall()` фильтрует по playerId
7. [ ] `keywordRecall()` фильтрует по playerId
8. [ ] `getAllMemories()` принимает optional playerId
9. [ ] `toJSON()` возвращает только world memories
10. [ ] `toPlayerJSON(playerId)` возвращает player-specific memories
11. [ ] `loadPlayerMemories()` / `unloadPlayerMemories()` (с Qdrant delete)
12. [ ] `inPlayerChatWith: string | null` вместо `inPlayerChat: boolean`
13. [ ] Server: WS handshake с playerId
14. [ ] Server: onConnect → load player file → upsert
15. [ ] Server: onDisconnect → unload + save player file
16. [ ] Server: chat handler передаёт playerId в memory.store()
17. [ ] Per-scope eviction (configurable в WorldConfig)
18. [ ] Player file retention policy (TTL + max count)
19. [ ] Tests: player isolation, concurrent access, migration v1→v2, round-trip, fallback with playerId
20. [ ] Integration test: v1 save → v2 load → player connect → verify
