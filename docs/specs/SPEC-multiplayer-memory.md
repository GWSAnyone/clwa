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

## Что НЕ решает эта спека

- **Multiplayer Agent architecture** — сколько player Agent'ов, как они соотносятся с bilateral design, shared world vs instanced zones. Отдельная спека.
- **Concurrent NPC processing** — сейчас ProcessingQueue serial. С multiplayer нужен параллелизм. Отдельная спека.
- **Player authentication** — откуда берётся playerId (auth, session cookie, etc.). Отдельная спека.
- **Consolidation** — memory summarization при overflow. DEFERRED M3+.

## Реализация (checklist)

Когда придёт время имплементировать:

1. [ ] Добавить `playerId: string` в `MemoryEntry` (default `"__world__"`)
2. [ ] Миграция: loadState добавляет `"__world__"` если playerId отсутствует
3. [ ] `store()` принимает optional playerId
4. [ ] `recall()` принимает optional playerId, строит Qdrant filter
5. [ ] `toJSON()` возвращает только world memories
6. [ ] `toPlayerJSON(playerId)` возвращает player-specific memories
7. [ ] `loadPlayerMemories()` / `unloadPlayerMemories()` для connect/disconnect
8. [ ] Server: WS handshake с playerId
9. [ ] Server: onConnect → load player file → upsert
10. [ ] Server: onDisconnect → extract player memories → save file
11. [ ] Server: chat handler передаёт playerId в memory.store()
12. [ ] Per-scope eviction (200 world, 100 per player)
13. [ ] `inPlayerChat` блокировка для concurrent chat attempts
14. [ ] Tests: player isolation, concurrent access, migration, round-trip
