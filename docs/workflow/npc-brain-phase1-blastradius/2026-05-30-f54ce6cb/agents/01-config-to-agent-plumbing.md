# Agent 1 — World CONFIG → Engine flow + threading config.language into Agent prompt-building

## Map: World CONFIG → Engine, и как протянуть `config.language` (en|ru) в построение промптов Agent

**TL;DR:** `WorldConfig` живёт в engine (`world-types.ts:183`), собирается в `World` ctor как `{...DEFAULT_WORLD_CONFIG, ...config}` (`world.ts:186`). `World` держит `config` и прокидывает его позиционно в `runConversation` (`world.ts:1295`). КЛЮЧЕВОЙ ФАКТ: **`Agent` НЕ имеет доступа к `WorldConfig`** — он получает только `profile/state/memory` + `AgentOptions` (resolvers/hooks). `dialogueRule` доходит до речи NPC не через `Agent`, а читается прямо из `config` внутри `runConversation` и инъектится как `additionalContext`.

**Architecture:**
- `WorldConfig` / `DEFAULT_WORLD_CONFIG`: тип + дефолты (`world-types.ts:183`, `:371`)
- `Agent`: профиль NPC, память, построение промптов; поля приходят через `AgentOptions` (`agent.ts:32`, ctor `:50`)
- `World`: держит `config`, готовых агентов (Map), вызывает `runConversation` (`world.ts:130`, ctor `:172`, `:1295`)
- `runConversation`: NPC↔NPC диалог, читает `config.dialogueRule` (`conversation.ts:83`, `:107`)
- server `index.ts`: строит каждого `Agent` (`:406`), плеера (`:537`), затем `World` с **inline** config-литералом (`:566`)
- `world-loader.ts`: парсит JSON → `LoadedWorld.config` (узкий тип, `:76`, pass-through `:369`)

**Data flow (config):**
world JSON → `loadWorld` (`world-loader.ts:369`, тип `{startMinute?,exchangeCount?,moodBias?}`) → `worldData.config` → в `index.ts` НЕ передаётся целиком в `World`; берётся только `startMinute` в inline-литерал `new World(...)` (`index.ts:566/569`) → `World` ctor: `this.config = {...DEFAULT_WORLD_CONFIG, ...config}` (`world.ts:186`) → `this.config` → `runConversation(..., this.config, ...)` (`world.ts:1295`).

**Data flow (dialogueRule — образец, путь A):**
`config.dialogueRule` → внутри `runConversation` собирается `DIALOGUE_RULE` (`conversation.ts:107`) → кладётся в `initContext`/`respContext` → `agent.generateResponse(prompt, { additionalContext })` → `Agent.buildSystemPrompt(memories, additionalContext)` (`agent.ts:306`) вставляет `additionalContext` перед `## Rules`. `dialogueRule` НЕ хранится в `Agent` — транзитом через параметр.

**Player chat (путь B — другой!):** `Agent.chat`/`chatStream` (`agent.ts:77/103`) → `buildSystemPrompt` → строка `## Rules` с захардкоженным `Reply in the SAME language the player speaks` (`agent.ts:352`). Здесь `config` недоступен — значит language для player-chat надо дать `Agent`'у через `AgentOptions`.

**Key decisions / patterns:**
1. `Agent` получает «мирские» значения через `AgentOptions` callbacks (`locationResolver`, `nameResolver`), не через ссылку на config — это и есть чистый паттерн для `language` (`agent.ts:50-60`).
2. `dialogueRule` дефолтится в use-site через `??` (`conversation.ts:107`), а НЕ в `DEFAULT_WORLD_CONFIG`. Для INV-21-safe дефолта `language` правильнее положить в `DEFAULT_WORLD_CONFIG` (`world-types.ts:371`): мердж `{...DEFAULT_WORLD_CONFIG, ...config}` в ctor применяется на ОБОИХ boot-путях (fresh и saved — `loadState` не пересобирает config).
3. `World` в `index.ts:566` строится из inline-литерала, а не из `worldData.config` — конфиг мира и JSON-конфиг частично рассинхронизированы (forward только `startMinute`).

**Gotchas:**
- Добавить `language` ТОЛЬКО в `WorldConfig` недостаточно для player-chat: `Agent.buildSystemPrompt` не видит config. Нужны ДВА места: (1) `AgentOptions`+ctor для путей через `Agent`, (2) `conversation.ts:107` для NPC↔NPC (`agent.ts:352`, `conversation.ts:107`).
- `World(...)` в `index.ts:566` берёт inline-config — `worldData.config.language` дойдёт до `runConversation` только если явно прописать его в этот литерал (`index.ts:569`).
- `loadState` (`world.ts:1918`) восстанавливает state агентов, но НЕ config — language де-факто boot-time, не персистится (как `dialogueRule`).
- Player Agent тоже строится с options (`index.ts:537`) — решить, навязывать ли ему language.

**Referenced answers:**
- Q1: Есть ли у Agent доступ к WorldConfig? — **Нет.** `Agent` хранит profile/state/memory + поля из `AgentOptions` (`agent.ts:32-66`). Чистейший минимум: добавить `language?: 'en'|'ru'` в `AgentOptions`, поле + присваивание в ctor (зеркало `nameResolver`), использовать в `buildSystemPrompt` (`agent.ts:352`), прокинуть из `index.ts:406` через `worldData.config.language ?? 'en'`. Параметр через chat/chatStream/generateResponse возможен, но грязнее (3+ сигнатуры + `runConversation`); поле через ctor — минимальнее.
- Q2: Где определён WorldConfig и дефолт? — Тип: `world-types.ts:183` (`language` рядом с `dialogueRule`, `:243`). Дефолт INV-21-safe `'en'`: `DEFAULT_WORLD_CONFIG` (`world-types.ts:371`) — мерджится в `World` ctor (`world.ts:186`) на обоих boot-путях.
- Q3: Как передаётся dialogueRule (зеркалить)? — `config.dialogueRule` читается внутри `runConversation` (`conversation.ts:107`) и инъектится как `additionalContext` в `generateResponse`. Для NPC↔NPC зеркаль ровно тут (config уже в scope). Для player-chat dialogueRule не используется — нужен отдельный канал через `AgentOptions` (см. Q1).

**Not explored:**
- `buildInitiatorPrompt`/`buildResponderPrompt`/`buildFollowUpPrompt` (тела) — user-промпт диалога; language туда обычно не нужен (язык в system/additionalContext).
- IL-промпты для player-speech — вне scope.
- Конкретные значения config в `worlds/millhaven/*.json` — смотрел только тип в loader.
