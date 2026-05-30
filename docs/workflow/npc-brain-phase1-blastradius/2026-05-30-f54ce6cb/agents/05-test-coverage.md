# Agent 5 — Tests exercising the prompt / dialogue / config path (Phase 1 refactor regression tripwires)

## Map: тесты на prompt / dialogue / config path (tripwires для Phase 1)

**TL;DR:** Ни один тест НЕ ассертит точный английский текст Rules-блока — локализация промпта прямых ассертов не ломает. Единственный косвенный страж промпт-текста — `architecture.test.ts:134`, который сканирует все string-литералы движка (включая Rules-блок в `agent.ts`) на 8 английских crime-слов. Реальная масса tripwires — это 7 файлов с inline-литералом `AgentProfile` (любая смена полей профиля ломает их) и save-load round-trip состояния агента. WorldConfig defaults и сам dialogue-runtime (`chat`/`chatStream`/`runConversation`) тестами не покрыты вообще.

**Архитектура того, что покрыто тестами:**
- `buildSystemPrompt` — приватный метод `Agent` (`agent.ts:306`), Rules-блок на `agent.ts:350-358`. Тестами напрямую не вызывается.
- Серверный билдер промпта — `packages/server/src/llm-npc-prompt-builder.ts`. НЕ покрыт CRIME_PROSE-сканом (тот читает только `ENGINE_DIR`).
- world-loader маппинг `NpcJson -> AgentProfile` — `world-loader.ts:16-48`. Маппинг полей профиля unit-тестами не проверяется.

**Поток данных (что тесты реально щупают):**
- prompt-content ассерты есть только для consolidation-промпта (`llm-consolidation.test.ts:115-128`, окно 25 наблюдений obs-0..obs-24), НЕ для dialogue system prompt.
- dialogue-runtime → не тестируется (grep `chat/chatStream/generateResponse/runConversation` по `tests/` = 0). Тестируется только IL dialogue-EFFECT hook (`investigation.test.ts:132-173`, `applyDialogueMeaning` + реестр хендлеров, sentinel `__E2E_SECTION__`).
- config → `DEFAULT_WORLD_CONFIG/IL/CONVERSATION/MOVEMENT` (engine `world-types.ts`) не ассертятся нигде; save-load гоняет только STATE агента, не WorldConfig.

**Ключевые tripwires (что должно остаться зелёным / что обновлять осознанно):**
1. **`architecture.test.ts:134` 'no crime-justice prose in engine string literals'** — сканирует литералы `agent.ts` (Rules + stress/growth прозу) на `CRIME_PROSE = /\b(murder|crime|criminal|arrest|theft|robbery|suspect|perpetrator)\b/i` (`:123`). Сейчас чисто. При локализации/правке промпта в engine — не вносить эти 8 английских слов. Regex латинский → переводы на кириллицу его не триггерят (coverage gap, если ждёте что страж проверит перевод).
2. **AgentProfile inline-литерал в 7 файлах** — `genre-neutrality.test.ts:34`, `save-load.test.ts:48`, `investigation.test.ts:19`, `inventory.test.ts:18`, `living-millhaven.test.ts:20`, `relationships-factions.test.ts:20`, `position-movement.test.ts:125`, `attributes.test.ts:22`. Любой rename / новое required-поле профиля → правка всех. Форма: `{id,name,role,background,speechStyle,bigFive{O,C,E,A,N,honesty},enneagram{type,wing,coreFear,coreDesire,stressType,growthType}}` + опц. `capabilities/isPlayer/secret/innerConflict`.
3. **save-load round-trip** — `:149` identical output, `:375` required snapshot-поля, `:388` transient-поля не сериализуются (`TRANSIENT_FIELDS` `:141`). Ломается при изменении полей `AgentState`/снапшота.
4. **world-data.test.ts:30/41** — обязательные поля и OCEAN+H в сыром NPC JSON; **`:135`** — единственный вызов `loadWorld()` с ассертами на B1/B2/B3-карты (gold.base===200, factions, inventory, standing). Сам объект профиля не ассертится.
5. **fake-llm fixture** — `setupFakeLlm` (`:135`) регистрирует таски `dialogue/npc-dialogue/reflection/...` + `validateLlmRouterContract()`. Переименование dialogue-таска без правки фикстуры роняет `beforeAll` во многих файлах.

**Referenced answers:**
- Q: Что должно остаться зелёным, что обновлять? / A: Зелёным — все 7 AgentProfile-литералов и save-load (если не трогать поля профиля/состояния). Обновлять осознанно при локализации — только `architecture.test.ts:134` (косвенно, по crime-словам). Прямых ассертов на текст Rules-блока нет — править их не нужно.
- Q: Кто ассертит ТОЧНЫЙ текст Rules-блока (сломается при локализации)? / A: Никто. Repo-wide grep фраз Rules-блока даёт хиты только в `agent.ts`, серверном `llm-npc-prompt-builder.ts`, tools/ и docs/ — НЕ в `tests/`. Единственное косвенное завязывание — CRIME_PROSE-скан (`architecture.test.ts:123/134`).
- Q: exactApi / точные ассерты на текст промпта? / A: см. поле exactApi — прямых равенств на Rules-блок нет; есть regex-страж CRIME_PROSE и content-ассерты consolidation-промпта (obs-0/obs-24/25/49, '25 observations', 'distilled wisdom').

**Not explored:**
- Содержимое серверного `llm-npc-prompt-builder.ts` (он в server, вне CRIME_PROSE-скана) — отмечен как непокрытая стражем поверхность, но детально его текст не разбирал.
- Полная реализация `conversation.ts runConversation` — подтверждено отсутствие тестов, тело функции не читал.
