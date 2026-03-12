# CLWA — Causal Living World Architecture

> Полная архитектурная документация: `ARCHITECTURE.md`

## Быстрый старт

```bash
# 1. Поднять Qdrant
docker compose up -d

# 2. Запустить LM Studio, загрузить модели, запустить сервер

# 3. Установить зависимости
bun install

# 4. Запустить сервер
bun run packages/server/src/index.ts
# → http://localhost:3000 (REST + WebSocket + Web UI)
```

## Статус
- **Веха 5: Преступление и наказание** ← СЕЙЧАС
- Слои 1-11 ✅ (Intent, Crime Scene, Journal, PM, AL, Crime & Punishment, Topic Engine, Architectural Audit, Legacy cleanup)
- 19 affordances, 14 CE rules, 8 NPC (вкл. Magistrate Theron), 8 локаций (вкл. Courthouse)
- NPC status machine: `free → detained → exiled/fled`
- **Персистентность**: ✅ (save.json при SIGINT + POST /api/save)
- **Трёхуровневая модель решений**: Рефлекс (>=0.7, bypass LLM) → Позыв (0.5-0.7, duty constraint) → Мысль (<0.5, полная свобода)

## Три ключевые подсистемы

**Тезис**: Система эмерджентного нарратива. Декларативные слои задают физику поведения. LLM свободно принимает решения в рамках возможного. Сюжет не программируется — он возникает.

| Подсистема | Назначение | Статус |
|---|---|---|
| **CG (Consequence Graph)** | Действие → каскад последствий → state update | ✅ Работает |
| **PM (Personality Model)** | OCEAN+H + Enneagram → характер как контекст для LLM | ✅ Реализована |
| **AL (Affordance Layer)** | Декларативный реестр возможностей + фильтр доступности | ✅ Реализована |

**Петля**: State → AL (что можно) → PM (кто ты, prose) → LLM (свободное решение) → CG (последствия) → State

**Принцип принятия решений**: AL фильтрует доступное, PM scores → описание инстинктов в промпте, LLM свободно решает как персонаж. Никаких numbered menus, никаких fallback на числа. PM = инстинкт, LLM = сознание.

## Стек
- **Runtime**: Bun monorepo с workspaces
- **LLM**: LM Studio → Qwen3.5-9B Q6_K (чат) + nomic-embed-text-v1.5 Q8_0 (embeddings)
- **LM Studio API**: нативный `/api/v1/chat` с `reasoning: "off"` (НЕ OpenAI-compat для чата)
- **Embeddings**: raw fetch на `/v1/embeddings` (НЕ OpenAI SDK — SDK обрезает 768d→192d)
- **Векторная память**: Qdrant (Docker, localhost:6333), 768d Cosine
- **Godot**: 4.6.1, проект в `godot/`, MCP addon подключен

## Пакеты (packages/) — трёхуровневая архитектура

| Слой | Пакет | Путь | Назначение |
|---|---|---|---|
| **Engine** | `@clwa/engine` | `engine/` | Подсистемы движка: Agent, Memory, Beliefs, Relationships, CG, EventStore, AL, Volition, Goals, World, Conversations, Schedule, Crime Scene, Journal, Topic Engine |
| **Modules** | `@clwa/modules` | `modules/` | Мировой контент: affordance definitions, CG rules, target finders. Регистрируется при старте через `registerCrimeJusticeModule()` |
| **Server** | `@clwa/server` | `server/` | HTTP + WebSocket сервер (Bun.serve), REST API, NPC profiles/relationships/schedules, bootstrap, persistence |

> **Принцип разделения**: Engine содержит пустые реестры (`AFFORDANCE_REGISTRY`, `TARGET_FINDERS`, `REQUIREMENT_CHECKERS`). Modules наполняет их данными при регистрации. Зависимость строго однонаправленная: `modules → engine`, `server → engine + modules`.

## Ключевые файлы

### Engine (`packages/engine/src/`)
- `agent.ts` — Agent class, buildSystemPrompt(), buildRoleDirective(), LLM Semaphore
- `beliefs.ts` — BeliefManager (confidence/source/decay/dedup), BeliefSource includes 'observation', 'cover_up'
- `relationships.ts` — RelationshipGraph (sentiment/trust/grief)
- `memory.ts` — VectorMemory (Qdrant + raw fetch embeddings)
- `cg-types.ts` — EventType (17 типов: NPC_KILLED, GOODS_STOLEN, NPC_ARRESTED, NPC_SENTENCED, NPC_FLED, etc.)
- `cg-engine.ts` — ConsequenceEngine, rules application, cascade
- `al.ts` — AFFORDANCE_REGISTRY (пустой, заполняется modules), TARGET_FINDERS, REQUIREMENT_CHECKERS, computeUtility(), checkRequirements()
- `volition.ts` — Трёхуровневая модель (reflex/urge/thought), LLM DO/WHY, parseDoWhy(), reactive evaluation
- `goals.ts` — GoalManager, NpcGoal, 12 типов шагов (move_to, interact, announce, wait, steal_from, attack_npc, interact_present, arrest_npc, destroy_evidence, flee, sentence_npc, examine_scene)
- `world.ts` — World.tick(), processKill(), checkTheftDiscoveries(), toJSON()/loadState()
- `crime-scene.ts` — createCrimeScene(), templates (murder, robbery, assault)
- `journal.ts` — PlayerJournal (clue, testimony, observation)
- `secret-directives.ts` — buildSecretDirectives() (structured belief queries, no legacy tag/text fields)
- `topic-engine.ts` — TopicEngine, 7 plugin topic sources (вкл. justiceTopics), anti-repeat
- `conversation.ts` — topic-directed prompts, speech reminder, action beats, grounded memory
- `scheduler.ts` — ConversationScheduler, cooldown 8 тиков, diversity penalty
- `schedule.ts` — ScheduleManager, TICKS_PER_DAY=24
- `interaction.ts` — createInteractionRunner(), goal-driven NPC interactions
- `intent.ts` — classifyIntent() for player chat

### Modules (`packages/modules/src/`)
- `crime-justice/affordances.ts` — CRIME_AFFORDANCES (19 определений)
- `crime-justice/target-finders.ts` — 14 finder-функций + registerCrimeTargetFinders()
- `crime-justice/cg-rules.ts` — CRIME_CG_RULES (14 правил)
- `crime-justice/index.ts` — registerCrimeJusticeModule() (заполняет реестры engine)

### Server (`packages/server/src/`)
- `index.ts` — Bootstrap, NPC profiles/schedules/relationships, persistence, registerCrimeJusticeModule() call
- `server.ts` — Bun.serve(), WebSocket handler, player chat, intent classification
- `routes.ts` — REST API endpoints
- `ws.ts` — WebSocket message types, broadcast/sendTo

### Godot
- `godot/scenes/main.tscn` — главная сцена (изометрическая деревня)
- `godot/scripts/autoload/backend.gd` — WS+HTTP к серверу (127.0.0.1, НЕ localhost)
- `godot/scripts/main.gd` — game loop, crime scene markers, debug LLM overlay
- `godot/scripts/ui/` — dialog_panel, examine_panel, journal_panel, shop_panel, hud, day_night_overlay

## API (http://localhost:3000)

| Метод | Endpoint | Описание |
|---|---|---|
| GET | /api/agents | Все NPC (состояние, mood, beliefs, relationships) |
| GET | /api/events | Лог событий |
| GET | /api/locations | Граф локаций с NPC |
| GET | /api/time | Текущее время (tick, period, hour, day) |
| GET | /api/beliefs/:id | Beliefs NPC |
| GET | /api/relationships/:id | Relationships NPC |
| GET | /api/memories/:id | Векторные воспоминания NPC |
| GET | /api/goals | Все цели NPC |
| POST | /api/tick | Один тик мира |
| POST | /api/kill/:id | Убить NPC → каскад |
| POST | /api/day | Advance day + слухи |
| POST | /api/save | Сохранить состояние на диск |
| POST | /api/auto | Toggle auto-tick |
| GET | /api/shop/:id | Товары NPC (если есть shop) |
| GET | /api/crime-scenes | Все места преступлений (обзор) |
| GET | /api/crime-scene/:locationId | Детали crime scene + точки осмотра |
| POST | /api/examine/:locationId/:pointId | Осмотреть точку → улика → journal |
| GET | /api/journal | Журнал игрока |
| WS | /ws | Реалтайм: chat, events, ticks, movements, intents, shop, crime:scene, journal:entry, debug:llm |

## NPC (8)

| ID | Имя | Роль | Дом | Секрет | Shop | Flags |
|---|---|---|---|---|---|---|
| ted | Ted | bartender | Tavern | Разбавляет эль из-за долгов | — | — |
| mark | Mark | merchant | Residential | Продаёт обычные травы как экзотику | ✅ общие товары | — |
| elara | Elara | bard | Residential | Шпионит для знатного дома | — | — |
| garrett | Garrett | guard | Gate | Пропустил беглеца за взятку | — | investigator |
| aldric | Father Aldric | priest | Temple | Потерял веру | — | — |
| hilda | Hilda | blacksmith | Blacksmith | Отец погиб в драке в таверне Теда | ✅ оружие | motive: vs Ted |
| bess | Old Bess | herbalist | Residential | Видит будущее, видела убийство заранее | ✅ зелья | — |
| theron | Magistrate Theron | judge | Courthouse | Однажды осудил невиновного | — | — |

## Трёхуровневая модель решений (volition.ts)

| Уровень | Порог score | Поведение | Аналогия |
|---|---|---|---|
| **Рефлекс** | >= 0.7 | LLM **не вызывается**. Система автоматически строит goal из топ-affordance | Отдёргивание руки от огня |
| **Позыв** | 0.5 — 0.7 | LLM решает, но `talk` заблокирован для duty-целей. Duty action = единственный способ взаимодействия с этим NPC | Голод — можно сопротивляться, но с усилием |
| **Мысль** | < 0.5 | Полная свобода. Все действия доступны | Мелькнувшая идея |

> **Принцип**: PM = инстинкт, LLM = сознание. Рефлексы обходят сознание. Сильные позывы ограничивают выбор. Слабые мысли оставляют полную свободу.

## Критичные паттерны (НЕ нарушать)

1. **LLM вызовы через семафор**: `llmSemaphore.acquire()` → вызов → `release()` **в finally** (все 8 точек вызова)
2. **LLM concurrency = 1**: НЕ увеличивать — GPU context switching замедляет, код последовательный
3. **Tick mutex**: World.tick() бросает ошибку если предыдущий тик ещё выполняется
4. **Embeddings через raw fetch**: НЕ использовать OpenAI SDK (обрезает 768d→192d). Проверять `res.ok`
5. **[CRIME] маркеры**: structured tags `[CRIME killer=X victim=Y]` в purpose, стрипаются перед LLM. Использовать `[CRIME` для urgency detection (НЕ keyword regex)
6. **Body discovery**: discoverer получает memory/belief напрямую, НЕ через cascade
7. **Reasoning mode**: `reasoning: "off"` везде
8. **Model ID**: `qwen/qwen3.5-9b` (с префиксом `qwen/`)
9. **Intent detection**: классификация через LLM, не keyword matching. Action buttons в диалоге
10. **Secret directives**: `buildSecretDirectives()` — универсальные скрытые директивы без доп. LLM вызовов
11. **Персистентность**: save.json в packages/server/data/, автосохранение при SIGINT
12. **Godot WS**: `127.0.0.1` вместо `localhost` (IPv6 таймаут на Windows)
13. **Никакого text matching**: всё через structured data (beliefs, events, topic.category). НЕ text.includes() по LLM-тексту
14. **Declarative affordances**: новое поведение = данные в modules + stepTemplates + targetFinder, не код в engine
15. **Registry pattern**: Engine содержит пустые реестры, Modules заполняет их при регистрации. Engine НЕ зависит от Modules
16. **DO/WHY format**: 15 actions (go/talk/wait/announce/steal/kill/attack + investigate/interrogate/arrest/report/testify/flee/evaluate). Duty actions появляются в промпте только если affordance прошёл AL. Детерминированный парсер
17. **Трёхуровневая модель**: Рефлекс (>=0.7) обходит LLM. Позыв (0.5-0.7) блокирует `talk` на duty-цели. Мысль (<0.5) = полная свобода
18. **Topic Engine**: NPC-NPC разговоры через TopicEngine (7 sources вкл. justiceTopics), не "chat casually"
19. **Conversation prompts**: speech reminder + action beats + maxTokens 55 + "under 25 words"
20. **No hardcoded facts**: buildDynamicFacts читает knownFacts (`#`-prefix = structural metadata, стрипается в промпте)
21. **NPC Status**: `free → detained → exiled/fled`. isActive() = can act, isPresent() = physically in world
22. **Belief summarization**: verb mapping по eventType (НЕ хардкод "killed" для всех типов)
23. **Profile flags**: `investigator: true` вместо хардкода `role === 'guard'` в prompt-building
24. **Cover-up beliefs**: `source === 'cover_up'` (структурный Belief), НЕ legacy `tag`/`text` поля. Secret-directives фильтрует по source

## Дорожная карта
- ✅ Веха 2: Деревня, движение, Goal System
- ✅ Веха 3: Beliefs, Relationships, buildRoleDirective, LLM Semaphore
- ✅ Веха 4: Godot 2D клиент (изометрическая деревня, WASD, диалоги, день/ночь)
- ✅ Веха 4.5: Персистентность
- 🔨 **Веха 5: Преступление и наказание** ← СЕЙЧАС
  - ✅ Слои 1-5: Intent, Crime Scene, Journal, Godot UI, Secret Directives
  - ✅ Слой 6: PM (Personality Model — OCEAN+H + Enneagram)
  - ✅ Слой 7: AL (19 affordances, target finder registry, declarative step templates)
  - ✅ Слой 8: Crime & Punishment (расследование, арест, суд, приговор, побег, NPC status)
  - ✅ Слой 9: Topic Engine + Dialogue (7 sources, justice topics, structured importance)
  - ✅ Слой 10: Architectural Audit (устранение text matching, semaphore safety, verb mapping)
  - ✅ Слой 11: Legacy cleanup + Package restructure (engine/modules/server)
  - ✅ Слой 12: Трёхуровневая модель решений (reflex/urge/thought)
  - ⏳ Тестирование полного цикла crime → investigation → arrest → trial → sentence
  - ⏳ Trauma (постоянные сдвиги OCEAN+H)
  - ⏳ CG v2 (полные цепочки для всех типов)
- ⏳ Веха 6+: Сторителлинг/квесты, фракции, Reputation
