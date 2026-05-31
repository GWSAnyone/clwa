# SPEC: Scenario Manager

> **Milestone**: M1 (Replayable Crime)
> **Status**: Implemented (v0.11.0)
> **Depends on**: None
> **Engine changes**: World.reset(), server /api/new-game endpoint.
> **Created**: 2026-04-01
> **Completed**: 2026-04-01
> Milestone 1, задача 4. New game / restart без перезапуска сервера.

---

## Цель

`POST /api/new-game` — сервер создаёт новый мир с новым seed, без перезапуска процесса. Игрок может рестартить прямо из UI.

## Почему это нужно

Сейчас для нового прогона нужно: остановить сервер → удалить save.json → запустить заново. Для roguelike с 1.5-2h сессиями это неприемлемо. Кнопка «New Game» — обязательна.

---

## Дизайн

### GameContext — мутабельный контейнер

```typescript
interface GameContext {
  world: World;
  eventStore: InMemoryEventStore;
  agents: Map<string, Agent>;
  positionManager: PositionManager;
  approachContexts: Map<string, string>;
  seed: number;
  resetting: boolean;  // true во время new-game, все handlers возвращают 503
}
```

Один объект, передаётся по ссылке. При new game — свойства заменяются атомарно через `Object.assign(ctx, newCtx)`.

### Доступ через destructuring (минимизация blast radius)

Handlers НЕ заменяют `world` → `ctx.world` по всему файлу. Вместо этого — destructuring в начале функции:

```typescript
// routes.ts — ОДНА строка вместо 50+ замен
export function handleRequest(req: Request, ctx: GameContext): Response {
  if (ctx.resetting) return Response.json({ error: 'Server restarting' }, { status: 503 });
  const { world, agents, eventStore } = ctx;
  // ... весь остальной код без изменений — world, agents, eventStore работают как раньше
}

// server.ts fetch handler
async fetch(req, server) {
  const { world, agents } = ctx;
  // ... без изменений
}
```

**Эффект**: blast radius routes.ts падает с ~50 механических замен до ~3 изменений (сигнатура + guard + destructuring). Код внутри функции идентичен.

### Endpoint

```
POST /api/new-game           — новый seed (Date.now())
POST /api/new-game?seed=42   — конкретный seed
```

Ответ: `{ seed: number, message: "New game started" }`
Ошибки:
- `?seed=abc` → `{ error: "Invalid seed" }` (400)
- Вызов во время reset → `{ error: "Reset in progress" }` (429)

### Разделение: main() vs createGameContext()

```
main() — ONE-TIME SETUP (вызывается один раз при старте процесса):
├── Module registrations (registerCrimeJusticeModule, registerSocialModule)
├── Parse CLI args (--world, --seed)
├── Create CG engine with ctx-aware callback (один раз, reused)
├── createGameContext() — первый мир (с loadSave)
├── startServer(ctx, cgEngine)
└── Register SIGINT handler (с resetting guard)

createGameContext(worldPath, seed, cgEngine) — REPEATABLE (new game):
├── loadWorld(worldPath)
├── Randomize traits + mood + relationships
├── Create fresh EventStore
├── Create fresh agents (VectorMemory reset)
├── Create fresh PositionManager
├── Seed background memories + secrets
├── Create player agent
├── Create new World(agents, eventStore, cgEngine, ...)
└── Return GameContext (resetting: false)
```

**Ключевое разделение**:
- `createGameContext()` НИКОГДА не вызывает loadState. Всегда чистый мир.
- loadState вызывается ТОЛЬКО в main() при boot, ПОСЛЕ createGameContext, если save exists.
- Module registrations — только в main(). createGameContext() не трогает глобальные регистры.

### CG Engine — создаётся ОДИН РАЗ в main()

ConsequenceEngine stateless (rules + callback). Callback читает `ctx.eventStore`/`ctx.world`:

```typescript
// main() — one-time
const cgEngine = new ConsequenceEngine(CRIME_CG_RULES, {
  onEvent: (event) => {
    ctx.eventStore.append(event);
    broadcast({ type: 'event', data: event });
    ctx.world?.handleEventForGoals(event);
  },
});
```

При new-game: тот же engine передаётся новому World. Callback автоматически пишет в актуальный ctx. Не нужно пересоздавать.

### Алгоритм new-game (build-then-swap)

```
1. Validate seed (parseInt, isNaN → 400)
2. if (ctx.resetting) return 429                         ← rate limit: one at a time
3. ctx.resetting = true                                  ← блокирует все handlers
4. --- GRACEFUL SHUTDOWN старого мира ---
5. ctx.world.stopMasterClock()                           ← clearInterval — no new ticks
6. ctx.world.processingQueue.clear()                     ← drop pending tasks
7. await ctx.world.processingQueue.drain()               ← wait for in-flight task
8. --- BUILD NEW CONTEXT (старый мир полностью мёртв) ---
9. const newCtx = await createGameContext(worldPath, newSeed, cgEngine)
10. --- SWAP ---
11. Broadcast { type: 'new_game', data: { seed } }       ← BEFORE resetting=false
12. Object.assign(ctx, newCtx)                            ← newCtx НЕ содержит resetting
13. ctx.resetting = false                                 ← ОТДЕЛЬНАЯ строка — explicit unlock
14. ctx.world.startMasterClock()
15. Delete save.json
```

**Контракт createGameContext()**: возвращает объект БЕЗ поля `resetting`. Caller контролирует lifecycle flag. Между 12 и 13 — ctx имеет новый мир, но resetting=true. Handlers заблокированы до шага 13.

**Порядок критичен**:
- Шаги 5-7: graceful shutdown — clock stops, pending dropped, in-flight awaited
- Шаг 9: новый контекст строится целиком, включая async Qdrant init
- Шаг 11: broadcast ДО unlock — клиент перезагрузится до новых запросов
- Шаг 12: Object.assign — newCtx не содержит resetting, старое значение (true) сохраняется
- Шаг 13: resetting=false — explicit unlock, отдельная строка после swap

### Защита от race conditions

**API handlers и WS chat:**
```typescript
if (ctx.resetting) {
  return Response.json({ error: 'Server restarting' }, { status: 503 });
}
```

**SIGINT во время resetting:**
```typescript
process.on('SIGINT', () => {
  if (ctx.resetting) { console.log('Reset in progress, exiting'); process.exit(0); return; }
  saveToDisk(ctx);
  process.exit(0);
});
```

**WS chatStream:** если `ctx.resetting` стало true во время стриминга — stream завершается gracefully (send error frame, close).

### Что НЕ меняется

- HTTP server (Bun.serve) — тот же процесс, тот же порт
- WS connections — остаются открытыми, клиент получает `new_game` event
- Module registrations — один раз при старте, не при new-game
- CG engine — один раз при старте, callback через ctx
- World path — тот же мир, новый seed

---

## Файлы

| Файл | Изменение | Объём |
|------|-----------|-------|
| `engine/src/processing-queue.ts` | Добавить `drain(): Promise<void>` | Tiny (5 строк) |
| `server/src/index.ts` | Разделить на main() + createGameContext(). CG engine один раз. Убрать `_seed`. `saveToDisk(ctx)` вместо `saveToDisk(world, eventStore)`. SIGINT guard | Medium |
| `server/src/server.ts` | Принимать ctx. Destructure в fetch handler | Small (~5 строк) |
| `server/src/routes.ts` | Сигнатура `(req, ctx)` вместо `(req, world, eventStore, agents, options)`. Destructure + resetting guard. POST /api/new-game. Убрать RouteOptions.seed (redundant → ctx.seed) | Small (~10 строк новых, 0 замен внутри) |
| `server/src/ws.ts` | Без изменений | — |
| `public/game.js` | Handler new_game → clear localStorage + location.reload() | Small (5 строк) |

### Engine изменение (единственное)

`ProcessingQueue.drain()` — generic lifecycle метод:

```typescript
async drain(): Promise<void> {
  if (!this._processing) return;
  return new Promise<void>(resolve => {
    const prev = this._onEmpty;
    this._onEmpty = () => { prev?.(); resolve(); };
  });
}
```

---

## Edge Cases

| Case | Handling |
|------|---------|
| **Race: chatStream vs new-game** | `ctx.resetting` guard → graceful close |
| **Race: in-flight LLM call** | `clear()` + `await drain()` — ждёт завершения |
| **Race: any API during reset** | `ctx.resetting` guard → 503 |
| **Race: broadcast timing** | Broadcast ДО resetting=false |
| **Spam new-game** | `if (ctx.resetting) return 429` |
| **SIGINT during reset** | Skip save, exit immediately |
| **CG callback freshness** | CG engine один раз, callback читает ctx (не captured refs) |
| **loadState on new-game** | createGameContext() НИКОГДА не вызывает loadState. Только main() при boot |
| **Atomic swap** | Object.assign → resetting=false после |
| **NaN seed** | parseInt + isNaN → 400 |
| **approachContexts leak** | new Map() в новом контексте |
| **Old world GC** | Timer stopped, queue drained, no persistent connections. GC safe |
| **Save.json** | Удаляется после swap |
| **Qdrant** | VectorMemory.init({ reset: true }) per-NPC в createGameContext |
| **WS clients** | new_game event → clear localStorage + location.reload() |
| **saveToDisk** | Читает ctx.seed (не _seed). SIGINT guard при resetting |

---

## Отложено (не блокирует)

| Что | Почему | Когда |
|-----|--------|-------|
| Save архивация | Roguelike не нужен | Persistent mode (Milestone 4+) |
| Кэш loadWorld() | ~50ms. Не критично | При масштабировании |
| Seed history | /api/seed возвращает текущий | По необходимости |
| Health check после rebuild | Qdrant fail = no memories, но мир работает | По необходимости |

---

## Тест

1. Запустить сервер с `--seed=42`
2. `GET /api/seed` → `{ seed: 42 }`
3. `GET /api/agents` → записать Mark.bigFive.honesty
4. `POST /api/new-game` → `{ seed: N, message: "New game started" }`
5. `GET /api/seed` → `{ seed: N }` (N ≠ 42)
6. `GET /api/agents` → Mark.bigFive.honesty отличается
7. `POST /api/new-game?seed=42` → seed 42 снова
8. `GET /api/agents` → Mark.bigFive.honesty совпадает с шагом 3
9. `POST /api/new-game?seed=abc` → 400 Bad Request
10. `POST /api/new-game` во время reset → 429
11. SIGINT во время reset → clean exit, no save
12. **Client**: открыть game.html → `POST /api/new-game` → клиент автоматически перезагрузился, localStorage очищен, отображаются NPC нового мира

---

## Проведённый анализ

Четыре раунда ревью, 26 пунктов проверены:

| Раунд | Критичных | Средних | Низких | Ключевые фиксы |
|-------|-----------|---------|--------|-----------------|
| 1 | 2 | 4 | 2 | resetting flag, atomic swap, approachContexts, NaN validation |
| 2 | 2 | 3 | 3 | drain() в engine, CG closure через ctx, broadcast ordering, rate limit |
| 3 | 0 | 1 | 1 | SIGINT guard, destructuring (blast radius ÷15), CG один раз, boot vs new-game |
| 4 | 0 | 2 | 1 | createGameContext не возвращает resetting, game.js тест обязателен, saveToDisk(ctx), RouteOptions.seed redundant |
