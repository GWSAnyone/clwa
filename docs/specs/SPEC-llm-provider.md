# SPEC: LLM Provider Abstraction — Registry, Capability Adaptation, Semantic Façade

> **Milestone**: M2.5 / Infrastructure (вне игрового milestone roadmap — инфраструктурный)
> **Status**: **✅ COMPLETE** — Stages 1–10 done. Production CLWA boots с full LLM abstraction + per-NPC memory + cost tracking + consolidation + façade-level cost gate. Stage 9 gameplay verification пройдена вживую (verdict через Claude, cost tracking, cross-NPC gossip, consolidation — 0 ошибок). Stage 10 — context optimization (`--system-prompt` + `--tools ""`, 28k→4.4k токенов/verdict). 189/189 unit-тестов зелёные.
> **Depends on**: None (engine-only, не блокирует и не блокируется gameplay specs)
> **Engine changes**: новый модуль `llm-registry.ts`, переписан `llm-client.ts`, перенесён семафор. 7 call-sites переходят с прямого `llmCall(options)` на семантические примитивы.
> **Created**: 2026-05-28
> **Last revised**: 2026-05-28 (Stages 1–8 implemented in single session)
> **Completed**: 2026-05-28 (Stage 9 gameplay verified live + Stage 10 context optimization)

---

## Progress fixed (Stages 1–6 implementation log)

### Stage 1 — Foundation ✅
- **1a**: `engine/src/llm-types.ts`, `llm-semaphore.ts`, `llm-registry.ts`, `llm-json-utils.ts` — типы провайдеров, per-provider семафор, реестры провайдеров/task'ов/router'а, internal `_-prefixed` getters
- **1b**: `packages/providers/lm-studio/` — LMStudioProvider implements LlmProvider, OpenAI-compatible с llama.cpp samplers + Matryoshka 768-d embeddings raw fetch
- **1c**: `packages/providers/claude-code/` — ClaudeCodeProvider через `claude -p --json-schema --strict-mcp-config --setting-sources project,local`, per-NPC cwd, env strip `ANTHROPIC_API_KEY*`
- **1d**: `server/src/npc-memory-manager.ts` + `llm-npc-prompt-builder.ts` — per-NPC файловая структура, AgentProfile → CLAUDE.md generator
- **1e**: `server/src/llm-defaults.ts` — `buildDefaultRouter` со всеми routes на LM Studio, `migrateLegacyWorldConfig` для старого WorldConfig
- **1f**: `engine/src/llm-client.ts` rewrite — façade `classify<T>/generate/generateStream/embed` с try/catch → null контрактом, INV-01 enforced архитектурно, deprecated `llmCall/llmStream` shim для постепенной миграции call-sites. PoC end-to-end прошёл

### Stage 2 — Migrate 7 call-sites to façade ✅
- **2a**: `server/src/index.ts` boot — `registerLlmProvider` + `registerLlmTask` для 7 задач + `registerLlmRouter` + `validateLlmRouterContract` + `ensureNpcDir` для всех NPC
- **2c**: `step-handlers.ts:sentence_npc` — `llmCall + llmSemaphore + retry loop` → `classify<Verdict>('verdict', { agentContext: { id: 'magistrate' } })`
- **2d**: `reflection.ts:generateReflection` → `generate('reflection', { agentContext: { id } })`, `ReflectionConfig` лишился `lmStudioUrl/model`
- **2e**: `il.ts:extractDialogueMeaning` → `classify<DialogueMeaning>('il', { agentContext })`, удалён `llmSemaphore` import
- **2f**: `volition.ts:callLlm` → `classify<unknown>('volition', { agentContext, samplingOverride: { temperature } })`
- **2g**: `memory.ts:VectorMemory.embed` → `await embed(text)` через façade (Matryoshka сохранён)
- **2h**: `agent.ts:chat/chatStream/generateResponse` → `generate/generateStream/classify`. Per-NPC `llmConfig.temperature` через `samplingOverride`. Class `LlmSemaphore` + `export llmSemaphore` УДАЛЕНЫ
- **2i**: `tests/fixtures/fake-llm-provider.ts` (детерминированный 768-d hash → vector, schema-based default JSON) + `setupFakeLlm()` helper. Boot hook в 8 test-файлах. **158/158 tests pass.**

### Stage 3 — Production wiring ✅
- **3a**: `verdict` route → `claude-code` (Haiku изначально), fallback на LM Studio. Production CLWA по-умолчанию использует Claude
- **3b**: `Agent.onObserve` hook callback в AgentOptions. `observe()` пишет в `VectorMemory` И через onObserve в `memory/observations.md`. `onReflection` пишет в `reflections.md`. Cross-NPC info propagation работает естественно через existing engine flow
- **3c**: end-to-end verdict тест с Theron — coherent in-character judicial reasoning, schema validated, proportionate verdict

### Memory validation tests ✅ (between Stage 3 and 4)
Подтверждено что Claude читает per-NPC файлы **freshly per call**:
- **PLANT** new observation → Claude цитирует в ответе ("three ales deep, muttering about Theron looking the other way")
- **EDIT** memory file → Claude видит свежие данные ("paid in fresh coin, claims poverty like virtue")
- **ADD** new file + `@-import` в CLAUDE.md → Claude подтянул и **связал narrative across 3 memory files** (Garrett-silver + Theron-midnight = corruption pattern)
- **CONTROL** (без memory) → stayed grounded, не галлюцинировал

### Persistent IPC benchmark ✅
Сравнили cold-spawn vs persistent stream-JSON IPC на 5 verdict-сценариях с Haiku и Sonnet.

| | Cold (Haiku) | Pers (Haiku) | Cold (Sonnet) | Pers (Sonnet) |
|---|---|---|---|---|
| 5 verdicts | $0.15 | $0.26 (+73%) | $0.34 | $0.60 (+76%) |
| Total time | 94с | 83с (-12%) | 141с | 186с |
| Schema OK | 5/5 | 5/5 | 5/5 | 5/5 |

**Вердикт:** для stateless decision-making CLWA модели cold spawn лучше. Persistent дороже из-за accumulating context (cache read растёт каждый turn). Cold spawn использует Anthropic server-side prompt caching между вызовами.

### Stage 4 — Cleanup ✅
- **4a**: `verdict` дефолт переключён с Haiku на **Sonnet** (значительно лучше judicial reasoning, $0.07/verdict)
- **4b**: УДАЛЕНЫ из engine: `WorldConfig.lmStudioUrl/model`, `AgentOptions.lmStudioUrl/model`, `llmCall/llmStream/LlmCallOptions/LlmStreamOptions` shim, `DEFAULT_WORLD_CONFIG.lmStudioUrl/model`. `migrateLegacyWorldConfig` → no-op stub

### Stage 5 — Full Memory Architecture ✅
- **5a**: `engine/src/agent-types.ts` — `NpcMemoryState` interface (gameMinute, location, mood, status, currentActivity, inTransit, alive, relationships[], beliefs[]). `Agent.serializeMemoryState(min, nameResolver, opts?)` — top-30 beliefs by composite score (confidence × recency). **Zero file I/O в engine.**
- **5b**: `NpcMemoryManager.snapshotState(id, state)` пишет parallel `current-state.md`, `relationships.md`, `beliefs.md` atomic (tmp+rename + per-file Promise-chain mutex). Markdown renderers с sentiment/trust labels
- **5c**: `ClaudeCodeProvider.onBeforeCall?` option. Server bootstrap wires `_setActiveCtxForLlmProvider(agents, world)` — `onBeforeCall(id)` вызывает `agent.serializeMemoryState(world.getCurrentGameMinute(), nameResolver)` → `npcMemory.snapshotState(id, state)`. `World.getCurrentGameMinute()` accessor добавлен
- **5d**: Serena memory `clwa/overview` обновлена с file-based memory architecture, 6 live-обновляемых файлов в `memory/`

### Stage 6 — Cost & Usage Tracking ✅
- **6a**: `LlmCallResponse.usage` расширен (`cacheReadTokens`, `cacheCreationTokens`, `costUsd`). `LlmEmbedResponse.usage` добавлен. Новый `LlmUsageEvent` interface (timestamp, task, agentId, providerId, modelId, finishReason, tokens, cost, latencyMs, hadSchema)
- **6b**: `registerLlmUsageRecorder(fn)` + internal `_emitUsage(event)` в `llm-registry.ts`. Façade `classify/generate/generateStream/embed` эмитит event после каждого provider call'а — success или error. Errors в recorder'е логируются, не блокируют LLM-flow
- **6c**: `ClaudeCodeProvider` парсит `result.total_cost_usd` + `cache_read_input_tokens` + `cache_creation_input_tokens` из stream-JSON `result` event. `LMStudioProvider` reports cost=0, cache=0
- **6d**: `server/src/llm-usage-tracker.ts` — `LlmUsageTracker` с JSONL append-only persistence (Promise-chain serialized writes), `readAll()`, `getStats({sinceMs?, untilMs?})` с aggregation by task / provider / model / agent. `flush()` для тестов
- **6e**: `GET /api/debug/llm-usage[?since=ms&until=ms]` — aggregate stats как JSON. `GET /api/debug/llm-usage/raw` — full JSONL для offline analysis. PoC `poc-usage-tracking.ts` — 7/7 validations прошли

---

## Финальная файловая структура (все Stages вместе)

```
ENGINE (engine/src/) — universal contracts, ZERO domain strings:
├── llm-types.ts        — LlmProvider, LlmCapabilities, LlmTask=string, LlmRoute, LlmUsageEvent, NpcMemoryState
├── llm-semaphore.ts    — per-provider concurrency
├── llm-registry.ts     — providers/tasks/router/usage_recorder registries, internal _-getters, validateLlmRouterContract, callWithSchemaRetry
├── llm-json-utils.ts   — truncateToFirstJsonObject
├── llm-client.ts       — façade classify/generate/generateStream/embed + _emitUsage hooks
├── agent.ts            — Agent.serializeMemoryState, onObserve hook через AgentOptions
└── (existing engine subsystems unchanged)

PROVIDERS (packages/providers/) — concrete implementations:
├── lm-studio/          — OpenAI-compat + Matryoshka embeddings, cost=0
└── claude-code/        — `claude -p` cold spawn, per-NPC cwd, --json-schema, onBeforeCall hook, реальная costUsd

SERVER (packages/server/src/):
├── llm-defaults.ts          — buildDefaultRouter (verdict → claude-code/sonnet, остальное → lm-studio/qwen)
├── npc-memory-manager.ts    — per-NPC папки + atomic snapshot writes (snapshotState, appendMemory, pruneIfOversize)
├── llm-npc-prompt-builder.ts — AgentProfile → CLAUDE.md + @-imports
├── llm-usage-tracker.ts     — JSONL persistence + aggregation stats
├── index.ts                 — boot wires: providers, tasks, router, usage recorder, NPC memory hooks
└── routes.ts                — GET /api/debug/llm-usage endpoints

RUNTIME DATA (gitignored):
├── data/claude-npcs/<id>/   — per-NPC папка с CLAUDE.md + memory/*.md
└── data/llm-usage.jsonl     — append-only log всех LLM-вызовов
```

---

## Полная Verification Matrix

| Проверка | Результат |
|---|---|
| `bun x tsc --noEmit` | **0 ошибок** во всём проекте |
| `bun test` | **158/158 pass**, 311 expect() calls, 9 файлов |
| `poc-claude-code.ts` PoC | Mark deflect-in-character ✓ |
| `poc-memory-realtime.ts` PoC | Plant/Edit/Add memory всё подтянулось fresh ✓ |
| `poc-verdict-claude.ts` PoC | Theron coherent judicial reasoning ✓ |
| `poc-persistent-ipc.ts` benchmark | Cold spawn выиграл (+76% дешевле) ✓ |
| `poc-usage-tracking.ts` PoC | 7/7 validations, JSONL + stats ✓ |
| `verdict` через Sonnet end-to-end | Mark fraud → fine, ~$0.07/verdict ✓ |
| File memory propagation | `appendMemory` + `snapshotState` атомарны ✓ |

---

### Stage 7 — Consolidation, Budget Gate, Tests ✅

- **7a**: Memory consolidation tick handler — `registerTickPhaseHandler` каждые `CLWA_CONSOLIDATION_INTERVAL=60` game-min. Для каждого NPC: если `observations.md > keepRecent + consolidateOldest` entries (default 25+25=50), берёт oldest 25, через `generate('reflection', ...)` LLM-summarize'ит → `reflections.md`, observations.md truncate'ится до последних 25. Все params настраиваются через env. `NpcMemoryManager.consolidateObservations(id, llmGenerate, opts)` API.
- **7b**: **Cost gate** — façade-level, **diamond architecture**. `registerLlmCostGate(fn)` в engine registry. Façade `classify/generate/generateStream/embed` вызывает `_checkCostGate(task, agentId)` ПЕРЕД provider call'ом — universal across all providers/tasks. `LlmCostGate` принимает task + agentId, возвращает `{reason}` для блока или `null` для allow. Server регистрирует gate который сравнивает `tracker.getCumulativeCostSinceBoot().costUsd` с `CLWA_MAX_LLM_USD_PER_BOOT` env var. Fail-open: exception в gate → call продолжается (логируется warning). `LlmUsageTracker._bumpCumulative` поддерживает in-memory tally без disk re-read'а.
- **7c**: `tests/llm-usage.test.ts` — **18 unit tests** (5 describe groups): persistence + flush race-condition + corrupt-lines + missing-file + nested mkdir + aggregation by task/provider/agent + window filter + error count + cumulative tally + façade emits для всех 4 примитивов + gate blocks classify/generate/embed + gate sees task+agentId + gate fail-open

### Rejected / skipped permanently

- **Anthropic Direct API provider (paid, per-token)** — не используем. CLWA остаётся на subscription через Claude Code CLI + локальный LM Studio. Если когда-то понадобится paid API, добавлять отдельным provider'ом по тому же `LlmProvider` контракту.
- **Persistent stream-JSON IPC mode** — benchmark показал +76% cost при том же latency. Cold spawn архитектурно правильнее для stateless decision-making CLWA модели. NOT implementing.

## Полный текущий статус

| Verification | Результат |
|---|---|
| `bun x tsc --noEmit` | 0 ошибок во всём проекте |
| `bun test` | **189/189 pass**, 383 expect() calls, **11 файлов** |
| PoC скрипты | 5/5 working (claude-code, memory-realtime, verdict-claude, persistent-ipc, usage-tracking) + `tools/test-verdict-live.sh` (live debug-API verdict harness) |
| Production CLWA boot | `bun clwa` поднимает: providers + tasks + router + usage recorder + cost gate (if env set) + consolidation tick handler + NPC folders |
| Live gameplay (Stage 9) | verdict через Sonnet ✓, cost tracking ✓, cross-NPC gossip ✓, consolidation ✓, 0 ошибок |
| Context cost (Stage 10) | verdict 28k→4.4k prompt-токенов (−84%), $0.128→$0.048 (`--system-prompt` + `--tools ""` + stdin) |
| Observability | `GET /api/debug/llm-usage` aggregate, `/api/debug/llm-usage/raw` full JSONL |
| Documentation | SPEC-llm-provider.md, Serena memory `clwa/overview` |

---

## Stage 9 — DONE ✅: gameplay verification (live, 2026-05-28)

Проверено реальным запуском `bun clwa` + LM Studio (:1234) + Qdrant + `claude` CLI 2.1.154 (OAuth подписка, API-ключ строго stripped). Сценарий гонялся через debug API (`tools/test-verdict-live.sh` фиксирует последовательность).

- [x] **9a Real gameplay session** — сессия отработала, **0 ошибок** в логе (325 LLM events). NPC живут по schedule: Bess↔Mark argue, Elara↔Ted talk, перемещения, mood shifts. Boot поднимает providers + tasks + router + usage recorder + consolidation handler + 8 NPC folders. WS broadcasts работают.
- [x] **9b Real magistrate verdict через Claude** — detain Mark → force `evaluate_case` на магистрата → tick → `sentence_npc` → `classify('verdict')` → cold spawn Sonnet. Theron вынес proportionate verdict (release / warning в разных прогонах) с judicial reasoning («Unus testis, nullus testis», «conviction on motivated hearsay would violate legal precedent»). current-state.md/relationships.md/beliefs.md snapshot'нулись ровно перед спавном (timestamp совпал с моментом вызова — `onBeforeCall` hook). observations.md пополнился приговором — петля памяти замкнулась, на повторе Claude заметил «second such case against Mark».
- [x] **9c Cost tracking под нагрузкой** — `GET /api/debug/llm-usage`: 325 events, **errorCount=0**. by-task/provider/model/agent breakdowns корректны. verdict → claude-code/sonnet с реальной ценой; embeddings/volition/npc-dialogue/reflection → lm-studio $0. cache_read/cache_creation токены пишутся. JSONL persist между перезапусками (cumulative spend log).
- [x] **9d Memory propagation cross-NPC** — после приговора событие NPC_SENTENCED расходится по городу: Hilda↔Ted и Aldric↔Garrett ведут разговоры с `topic="the sentencing of mark"` (topic-source NPC_SENTENCED → conversations → beliefTransfer). Слухи распространяются органически.
- [x] **9e Consolidation tick handler** — инжект 50+ observations магистрату (`/api/observe`) → при auto-tick на `gameMinute % 60 == 0` сработал handler: лог `[Memory] Consolidated 25 observations for Magistrate Theron → reflections.md`. Insight в характере Терона (Type 1, fear=corruption): «even justice becomes mechanical, and that's where corruption starts». observations.md обрезан до header+recent, reflections.md пополнен. LLM null → no-op (защита от потери данных, есть unit-тест).
- [x] **9f NPC profile regeneration** — known limitation подтверждён: `CLAUDE.md` пишется с `wx` флагом (создаётся один раз). **Workflow при изменении `worlds/millhaven/npcs/<id>.json`: удалить `packages/server/data/claude-npcs/<id>/CLAUDE.md` (или всю папку NPC) → перезапустить `bun clwa` — `ensureNpcDir` пересоздаст персону из нового профиля.** Snapshot-файлы (current-state/relationships/beliefs) перезаписываются каждый вызов автоматически и regen не требуют; observations/reflections — append-only история (намеренно переживают рестарт).

## Stage 10 — DONE ✅: context optimization (2026-05-28)

**Находка во время Stage 9**: verdict через Claude съедал **28214 prompt-токенов** ($0.128/verdict). Замер (`claude --help` + контролируемые прогоны на живом магистрате) показал: ~24k из них — оверхед Claude Code (системный промпт coding-агента + схемы встроенных tools), а не полезная нагрузка (персона + память + verdict-промпт ≈ 4k).

**Фикс** (`packages/providers/claude-code/src/index.ts`):
- `--append-system-prompt` → **`--system-prompt`** — полная замена системного промпта вместо добавления. CLAUDE.md + @-imports **всё равно auto-load** из cwd (проверено: NPC сохраняет персону и память).
- добавлен **`--tools ""`** — отключает все встроенные инструменты (Read/Edit/Bash/...). `--json-schema` structured output **не затронут** (проверено отдельно).
- prompt передаётся через **stdin**, а не позиционным аргументом: variadic `--tools`/`--mcp-config` иначе «съедают» позиционный промпт (`claude -p` без позиционного аргумента читает stdin).

**Результат**: 28214 → **4447 prompt-токенов (−84%)**, $0.128 → **$0.048/verdict (−63%, cold cache; на warm ещё ~6x дешевле)**. Качество verdict'а сохранено/улучшено. **`--bare` отвергнут** — форсит `ANTHROPIC_API_KEY` вместо OAuth-подписки (нарушает запрет на платный API) и рубит CLAUDE.md auto-discovery.

## Permanently out of scope (rejected by user)

- **Anthropic Direct API (paid per-token)** — не используем. Существующая subscription через Claude Code CLI достаточна
- **Persistent stream-JSON IPC mode** — benchmark показал +76% cost, не подходит для stateless decision-making
- **Web UI dashboard для `/api/debug/llm-usage`** — endpoint достаточен, графики не блокируют работу

## Future considerations (если когда-то понадобится)

- LoRA fine-tune локальной модели (ROADMAP Phase 3 deferred — отдельный SPEC)
- Per-day / per-NPC budget granularity (текущий gate — cumulative since boot, достаточно для разработки)
- HTML-renderer для `/api/debug/llm-usage` если станет неудобно читать JSON
>
> Движок перестаёт знать конкретного LLM-провайдера. Engine оперирует **задачами**
> (`volition`, `dialogue`, `il`, `verdict`, …) и **примитивами** (`classify`,
> `generate`, `embed`). Провайдеры (LM Studio, OpenAI, Anthropic, …) живут в
> отдельном workspace `packages/providers/*` и регистрируются на boot — точно так
> же, как модули (`crime-justice`, `social`) регистрируют affordances.

---

## Проблема

`packages/engine/src/llm-client.ts` — единственная точка вызова LLM в движке, но
архитектурно ведёт себя не как «движок, обращающийся к чужой нейронке по
стандартному контракту», а как «движок, в котором зашит конкретный диалект
OpenAI-совместимого `/v1/chat/completions` + сэмплинг llama.cpp».

### Конкретные нарушения принципов

| Принцип | Где нарушен | Доказательство |
|---|---|---|
| **INV-14** Engine не знает домен | Engine знает конкретного провайдера и его endpoint | `DEFAULT_WORLD_CONFIG.lmStudioUrl = 'http://localhost:1234'`, `model: 'qwen3.5-9b-abliterated'` (world-types.ts:357–358) |
| **INV-15** Нет hardcoded fallback strings | Дважды | `llm-client.ts:79,132` — fallback на `DEFAULT_WORLD_CONFIG.lmStudioUrl`. `memory.ts:27,28` — отдельный хардкод `'http://localhost:6333'` (Qdrant) и `'http://localhost:1234/v1'` (LM Studio). |
| **Принцип 2** Engine = универсальные законы | `repeat_penalty` (llama.cpp-only) живёт прямо в теле запроса engine'а | `llm-client.ts:90,154` |
| **Принцип 1** Structured data | `response_format: { type: 'json_schema' }` — диалект OpenAI; Anthropic в принципе не подключить | `llm-client.ts:96–104` |
| **No double standards** | Эмбеддинги — **параллельная карта** конфига вместо реестра | `memory.ts:embed` дёргает свой URL + свой `embeddingModel`, мимо `WorldConfig` |

### Семь call-sites — каждый со своим хардкодом параметров

| Файл | Функция | Захардкожено | Семантика |
|---|---|---|---|
| `volition.ts:657` | `callLlm` | `temperature: 0.35`, `maxTokens: 100`, `jsonSchema` | **classify** (DO/WHY) |
| `il.ts:248` | `extractDialogueMeaning` | `temperature: 0.15`, `maxTokens: 400`, `jsonSchema` | **classify** (speech act) |
| `agent.ts:109` | `Agent.chat` | `llmConfig.temperature/maxTokens` per-NPC, без schema | **generate** (free text) |
| `agent.ts:154` | `Agent.chatStream` | то же, streaming | **generateStream** |
| `agent.ts:240` | `Agent.generateResponse` | optional `jsonSchema` | **classify ИЛИ generate** (двойственность) |
| `reflection.ts:70` | `generateReflection` | `temperature: 0.7`, `maxTokens: 150` | **generate** (insight) |
| `step-handlers.ts:462` | `sentence_npc` handler | `temperature: 0.4`, `maxTokens: 200/300`, `jsonSchema` | **classify** (verdict) |
| `memory.ts:105` | `VectorMemory.embed` | свой URL, свой `embeddingModel` | **embed** |

Семь сэмплинг-профилей разбросаны по коду. Сменить модель = пройтись по всем
семи + memory.ts. Подключить Anthropic = переписать llm-client.ts (другой
endpoint), переписать json_schema → tool_use на каждом call-site, заново
изобрести streaming SSE (Anthropic event stream — иной формат).

### Семафор — глобальный, локальная GPU = облачное API

`llmSemaphore = new LlmSemaphore(2)` (agent.ts:40) — **один на всё**. Это
оправданно для одной локальной модели на одной GPU. Но если verdict уезжает на
Anthropic, embedding — на локальный nomic, а dialogue — на LM Studio, общая
очередь из 2 одновременных вызовов начинает душить облачный канал (где можно
сотни) и/или локальный GPU (где можно 2). Семафор должен быть **per-provider**.

---

## Что НЕ входит в этот SPEC

| Функция | Почему не нужна | Где решается |
|---|---|---|
| Динамическая смена провайдера на лету | Boot-time регистрации достаточно для всех текущих сценариев. Hot-swap = сложность без потребителя. | Перерегистрация на рестарте |
| Streaming structured output | Streaming используется только для болтовни в чате (free text). Verdict / volition / IL — sync. | Если понадобится — добавить позже |
| Multimodal (image input) | Phase 4+ (Combat AI, sprite recognition) | Когда появится потребитель |
| LoRA / fine-tune routing | ROADMAP помечен DEFERRED | Когда снимется defer |
| API key vault / rotation | Это infrastructure-секреты, читаем из `process.env`. Vault — DevOps-задача. | env / docker secrets |
| Cost tracking / token budget | Удобно, но не блокирует архитектуру. Можно добавить как middleware над провайдером. | Future middleware layer |
| Удаление `WorldConfig.lmStudioUrl/model` совсем | Backward compat фаза C — отдельный PR после периода миграции | Follow-up cleanup |

---

## Дизайн — три уровня в одном SPEC

```
┌─────────────────────────────────────────────────────────────────────┐
│ Уровень 3 — Семантический фасад (что зовут call-sites)              │
│   classify<T>(task, req) | generate(task, req) |                    │
│   generateStream(task, req) | embed(req)                            │
├─────────────────────────────────────────────────────────────────────┤
│ Уровень 2 — Capability-driven adapter (внутри провайдера)           │
│   jsonSchema → response_format: json_schema (LM Studio, OpenAI)     │
│   jsonSchema → tool_use + tool_choice (Anthropic)                   │
│   jsonSchema → prompt-engineered JSON + retry (capability=none)     │
├─────────────────────────────────────────────────────────────────────┤
│ Уровень 1 — Provider Registry + Router (engine-level контракт)      │
│   LLM_PROVIDERS реестр, LLM_ROUTER задача→провайдер+модель,         │
│   per-provider semaphore, провайдер-агностичный Request/Response    │
└─────────────────────────────────────────────────────────────────────┘
```

Все три уровня вводятся **в одной итерации**, потому что:

1. Без Уровня 1 нельзя подключить второй провайдер вообще.
2. Без Уровня 2 второй провайдер (Anthropic) не работает с structured output —
   а structured output используют 4 из 7 call-sites.
3. Без Уровня 3 каждый call-site остаётся с 7-полевыми вызовами и собственной
   копией сэмплинг-параметров — провайдер сменили, а разрозненность параметров
   осталась. Семантический фасад **обязателен**, чтобы вся настройка модели
   уехала из кода в декларативный конфиг роутера.

Реализация — по уровням снизу вверх, тесты на каждом уровне.

---

## Уровень 1 — Provider Registry + Router

### Новый файл: `packages/engine/src/llm-types.ts`

Чистые типы, без I/O:

```typescript
/**
 * Имя LLM-задачи — open string. Модули регистрируют свои задачи через `registerLlmTask`.
 * Engine ОБЯЗАН знать ровно одну инфраструктурную задачу — `'embeddings'`. Всё остальное
 * (`'volition'`, `'verdict'`, `'il'`, …) — это **слова доменных модулей**, и они НЕ должны
 * жить в engine-типах: иначе добавление Economy/Politics модуля = engine change (нарушает
 * Economy Module Test и INV-14).
 *
 * Контракт: имя task'а — произвольная строка, валидируется `validateLlmRouterContract`
 * по факту регистрации route. Compile-time exhaustiveness заменена runtime-валидацией —
 * тот же паттерн, что для event types, affordance verbs, step handlers.
 */
export type LlmTask = string;

/** Свойства task'а, известные при регистрации. */
export interface LlmTaskRequirements {
  /** Требуется ли streaming-capability у провайдера. По умолчанию false. */
  requiresStreaming?: boolean;
  /** Требуется ли структурированный вывод. По умолчанию false. */
  requiresStructuredOutput?: boolean;
  /** Требуется ли embeddings-capability. По умолчанию false. Должно быть true для 'embeddings'. */
  requiresEmbeddings?: boolean;
}

/** Структурная схема, которой ДОЛЖЕН соответствовать ответ. Контракт — JSON.parse(response.content) ⊨ schema. */
export interface LlmJsonSchema {
  name: string;
  strict?: boolean;
  schema: Record<string, unknown>;
}

/** Возможные ответы провайдера на «дай JSON по схеме». */
export type StructuredOutputMode =
  | 'json_schema'   // OpenAI-style response_format (LM Studio, OpenAI, Azure OpenAI)
  | 'tool_use'      // Anthropic-style tool with input_schema + tool_choice
  | 'grammar'       // GBNF grammar (llama.cpp native)
  | 'none';         // нет нативной поддержки — провайдер делает best-effort через промпт + retry

/** Что провайдер поддерживает. Декларируется самим провайдером, engine только читает. */
export interface LlmCapabilities {
  structuredOutput: StructuredOutputMode;
  streaming: boolean;
  embeddings: boolean;
  multiTurnHistory: boolean;
  /** Какие sampler-параметры провайдер реально применяет. Остальные молча игнорируются. */
  sampler: {
    temperature: boolean;
    topP: boolean;
    topK: boolean;
    repeatPenalty: boolean;       // llama.cpp / LM Studio
    frequencyPenalty: boolean;    // OpenAI-style
    presencePenalty: boolean;     // OpenAI-style
  };
  /** Максимум одновременных запросов, которые провайдер выдерживает. Семафор берёт это значение. */
  maxConcurrency: number;
  /** Верхняя граница output-токенов, поддерживаемая провайдером. Запрос сверх этого — clamp. */
  maxOutputTokens: number;
}

/** Sampler hints — необязательные. Провайдер применяет только то, что умеет (см. capabilities.sampler). */
export interface SamplingHints {
  temperature?: number;
  topP?: number;
  topK?: number;
  repeatPenalty?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
}

export interface LlmCallRequest {
  /** Конкретная модель, выбранная роутером по task'у. Provider её просто использует. */
  model: string;
  system: string;
  user: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  maxTokens?: number;
  sampling?: SamplingHints;
  /** Если задан — провайдер ОБЯЗАН вернуть JSON, парсящийся по схеме. */
  jsonSchema?: LlmJsonSchema;
  abortSignal?: AbortSignal;
  /**
   * Опциональный контекст агента — используется провайдерами с per-agent изоляцией
   * (e.g., ClaudeCodeProvider читает `<npcsRoot>/<id>/` папку как cwd). Другие провайдеры
   * игнорируют. CLWA Agent передаёт его через samplingOverride/agentContext в façade.
   */
  agentContext?: { id: string };
}

export type FinishReason = 'stop' | 'length' | 'schema_violation' | 'error';

export interface LlmCallResponse {
  content: string;
  finishReason: FinishReason;
  usage?: { promptTokens: number; completionTokens: number };
  /** Какой провайдер фактически ответил (для логов и метрик). */
  providerId: string;
  modelId: string;
}

export interface LlmStreamRequest {
  model: string;
  system: string;
  user: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  maxTokens?: number;
  sampling?: SamplingHints;
  abortSignal?: AbortSignal;
  agentContext?: { id: string };
}

/** Чанк нормализованного стрима. Провайдер-специфика (SSE vs event stream) скрыта. */
export interface LlmStreamChunk {
  type: 'token' | 'done' | 'error';
  content?: string;
  error?: Error;
}

export interface LlmEmbedRequest {
  /** Конкретная embedding-модель из route. Provider её использует. */
  model: string;
  input: string;
}

export interface LlmEmbedResponse {
  vector: number[];
  modelId: string;
  vectorSize: number;
}

/**
 * Контракт провайдера. Engine знает только это.
 * `model` приходит внутри request — провайдер не должен принимать его вторым аргументом
 * (это требование совместимости с TypeScript `implements`-контрактом).
 */
export interface LlmProvider {
  readonly id: string;
  readonly capabilities: LlmCapabilities;
  call(req: LlmCallRequest): Promise<LlmCallResponse>;
  stream(req: LlmStreamRequest): AsyncIterable<LlmStreamChunk>;
  embed(req: LlmEmbedRequest): Promise<LlmEmbedResponse>;
  /** Закрыть пулы, остановить heartbeat, отменить in-flight — вызывается при shutdown. */
  dispose?(): Promise<void>;
}

/** Маршрут одной задачи. */
export interface LlmRoute {
  provider: string;
  model: string;
  maxTokens?: number;
  sampling?: SamplingHints;
  /** Если primary провайдер бросает или возвращает finishReason='error' — engine пробует fallback. Рекурсивно. */
  fallback?: LlmRoute;
}

export interface LlmRouterConfig {
  default: LlmRoute;
  routes: Partial<Record<LlmTask, LlmRoute>>;
}
```

### Новый файл: `packages/engine/src/llm-semaphore.ts`

Семафор извлекается из `agent.ts` (вместе с обоснованием места):

```typescript
/**
 * Semaphore — ограничивает одновременные запросы к LLM-провайдеру.
 * Per-provider, не глобальный: у локального GPU и облачного API разная capacity.
 *
 * Acquire/release ОБЯЗАТЕЛЬНО в try/finally (INV-01). С Уровнем 3 это инвариант
 * уезжает в façade — call-sites больше не вызывают acquire вручную.
 */
export class LlmSemaphore {
  private running = 0;
  private queue: Array<() => void> = [];
  constructor(private readonly maxConcurrent: number = 1) {}

  async acquire(): Promise<void> {
    if (this.running < this.maxConcurrent) { this.running++; return; }
    return new Promise<void>((resolve) => {
      this.queue.push(() => { this.running++; resolve(); });
    });
  }

  release(): void {
    this.running--;
    const next = this.queue.shift();
    if (next) next();
  }

  get pending(): number { return this.queue.length; }
  get active(): number { return this.running; }
}
```

### Новый файл: `packages/engine/src/llm-registry.ts`

Реестр + роутер + lifecycle:

```typescript
import type { LlmProvider, LlmRouterConfig, LlmRoute, LlmTask, LlmTaskRequirements, LlmCallRequest, LlmCallResponse } from './llm-types';
import { LlmSemaphore } from './llm-semaphore';

const LLM_PROVIDERS = new Map<string, LlmProvider>();
const LLM_SEMAPHORES = new Map<string, LlmSemaphore>();
const LLM_TASKS = new Map<LlmTask, LlmTaskRequirements>();
let LLM_ROUTER: LlmRouterConfig | null = null;

/** Регистрация провайдера. Идемпотентна по id (повторный вызов с тем же id = реплейс). */
export function registerLlmProvider(provider: LlmProvider): void {
  if (!provider.id || typeof provider.id !== 'string') {
    throw new Error(`[LLM] registerLlmProvider: provider.id must be non-empty string`);
  }
  const existing = LLM_PROVIDERS.get(provider.id);
  if (existing) {
    // dispose старого, чтобы не текли соединения при hot-reload в dev
    existing.dispose?.().catch(() => {});
  }
  LLM_PROVIDERS.set(provider.id, provider);
  LLM_SEMAPHORES.set(provider.id, new LlmSemaphore(provider.capabilities.maxConcurrency));
}

/**
 * Регистрация task'а. Модуль вызывает с именем и требованиями.
 * Engine сам регистрирует ровно одну инфраструктурную задачу — `'embeddings'`.
 * Все доменные task'и (volition/verdict/il/...) регистрируются модулями.
 */
export function registerLlmTask(name: LlmTask, requirements: LlmTaskRequirements = {}): void {
  if (!name || typeof name !== 'string') {
    throw new Error(`[LLM] registerLlmTask: name must be non-empty string`);
  }
  LLM_TASKS.set(name, requirements);
}

export function registerLlmRouter(config: LlmRouterConfig): void {
  if (!config.default?.provider) {
    throw new Error(`[LLM] registerLlmRouter: default.provider is required`);
  }
  LLM_ROUTER = config;
}

// ─── Internal — НЕ экспортируются из @clwa/engine. Доступны только llm-client.ts (façade). ───

/** @internal */
export function _getLlmProvider(id: string): LlmProvider {
  const p = LLM_PROVIDERS.get(id);
  if (!p) throw new Error(`[LLM] No provider registered with id='${id}'. Did server bootstrap forget to register?`);
  return p;
}

/** @internal */
export function _getLlmSemaphore(providerId: string): LlmSemaphore {
  const s = LLM_SEMAPHORES.get(providerId);
  if (!s) throw new Error(`[LLM] No semaphore for provider '${providerId}'`);
  return s;
}

/** @internal */
export function _resolveRoute(task: LlmTask): LlmRoute {
  if (!LLM_ROUTER) {
    throw new Error(`[LLM] No router configured. Call registerLlmRouter() on boot.`);
  }
  return LLM_ROUTER.routes[task] ?? LLM_ROUTER.default;
}

/**
 * Контракт-валидация при boot:
 *  - каждая зарегистрированная задача имеет route или default
 *  - провайдер по route зарегистрирован
 *  - capability матчатся: streaming task → streaming provider; structuredOutput task → не 'none' (или провайдер прошёл callWithSchemaRetry);
 *    embeddings task → embeddings=true
 */
export function validateLlmRouterContract(): void {
  if (!LLM_ROUTER) throw new Error(`[LLM] Router not registered`);
  if (LLM_TASKS.size === 0) throw new Error(`[LLM] No tasks registered. Modules must call registerLlmTask() on boot.`);

  for (const [task, reqs] of LLM_TASKS) {
    const route = LLM_ROUTER.routes[task] ?? LLM_ROUTER.default;
    const provider = LLM_PROVIDERS.get(route.provider);
    if (!provider) {
      throw new Error(`[LLM] Route '${task}' references unregistered provider '${route.provider}'`);
    }
    if (reqs.requiresEmbeddings && !provider.capabilities.embeddings) {
      throw new Error(`[LLM] Task '${task}' requires embeddings, but provider '${route.provider}' has embeddings=false`);
    }
    if (reqs.requiresStreaming && !provider.capabilities.streaming) {
      throw new Error(`[LLM] Task '${task}' requires streaming, but provider '${route.provider}' has streaming=false. Re-route to a streaming provider.`);
    }
    // structuredOutput: 'none' допустим только если провайдер пройдёт через callWithSchemaRetry —
    // строгая проверка тут не нужна (façade сам обработает), но логируем warning для оператора
    if (reqs.requiresStructuredOutput && provider.capabilities.structuredOutput === 'none') {
      console.warn(`[LLM] Task '${task}' requires structured output but provider '${route.provider}' has structuredOutput='none'. Will use prompt-engineered retry — may degrade quality.`);
    }
  }
}

/** Для shutdown / тестов. */
export async function disposeAllLlmProviders(): Promise<void> {
  await Promise.all(Array.from(LLM_PROVIDERS.values()).map(p => p.dispose?.() ?? Promise.resolve()));
  LLM_PROVIDERS.clear();
  LLM_SEMAPHORES.clear();
  LLM_TASKS.clear();
  LLM_ROUTER = null;
}

// Engine bootstrap: регистрируем единственную инфраструктурную задачу.
registerLlmTask('embeddings', { requiresEmbeddings: true });
```

### `WorldConfig.llm` — декларативная конфигурация маршрутов

Из `WorldConfig` ИСЧЕЗАЮТ: `lmStudioUrl`, `model`, `repeatPenalty`,
`frequencyPenalty`, `presencePenalty`, `volitionTemperature` (последние четыре —
sampler-параметры, уезжают в роут).

Добавляется:

```typescript
// world-types.ts
export interface WorldConfig {
  // ...существующие поля...

  /** LLM-роутинг: задача → провайдер + модель + сэмплинг. Провайдеры регистрируются на boot через registerLlmProvider(). */
  llm?: LlmRouterConfig;

  // @deprecated — будут удалены в v0.15. Если оба заданы — `llm` имеет приоритет.
  /** @deprecated Use llm.default.provider + register LMStudioProvider */
  lmStudioUrl?: string;
  /** @deprecated Use llm.default.model */
  model?: string;
  /** @deprecated Use llm.routes.*.sampling.repeatPenalty */
  repeatPenalty?: number;
  /** @deprecated Use llm.routes.*.sampling.frequencyPenalty */
  frequencyPenalty?: number;
  /** @deprecated Use llm.routes.*.sampling.presencePenalty */
  presencePenalty?: number;
  /** @deprecated Use llm.routes.volition.sampling.temperature */
  volitionTemperature?: number;
}
```

### Где регистрируются провайдеры — `packages/server/src/index.ts`

Провайдеры — это **инфраструктура**, а не контент мира. Секреты (API ключи) живут
в `process.env`, маршруты — в JSON world data. Регистрация — на boot, рядом с
регистрацией модулей:

```typescript
// server/src/index.ts (после загрузки worldData, до createGameContext)
import path from 'node:path';
import { LMStudioProvider } from '@clwa/provider-lm-studio';
import { ClaudeCodeProvider } from '@clwa/provider-claude-code';
import { registerLlmProvider, registerLlmRouter, registerLlmTask, validateLlmRouterContract } from '@clwa/engine';
import { registerSocialModule } from '@clwa/modules/social';
import { registerCrimeJusticeModule } from '@clwa/modules/crime-justice';
import { buildDefaultRouter, migrateLegacyWorldConfig } from './llm-defaults';
import { NpcMemoryManager } from './npc-memory-manager';

const NPCS_ROOT = path.join(import.meta.dir, '../data/claude-npcs');

// 1. Регистрируем провайдеры. ClaudeCodeProvider использует subscription pool (до 15 июня)
//    либо SDK credit (после), без ANTHROPIC_API_KEY.
registerLlmProvider(new LMStudioProvider({
  baseUrl: process.env.LMSTUDIO_URL ?? 'http://localhost:1234',
}));

registerLlmProvider(new ClaudeCodeProvider({
  npcsRoot: NPCS_ROOT,
  maxConcurrency: Number(process.env.CLAUDE_CODE_MAX_CONCURRENCY ?? '8'),
}));

// 1.5. Подготовить per-NPC файловую структуру из worldData
const npcMemory = new NpcMemoryManager(NPCS_ROOT);
for (const npc of worldData.npcs) {
  await npcMemory.ensureNpcDir(npc.id, {
    personality: buildNpcSystemPrompt(npc),  // генерирует CLAUDE.md контент
    relationships: buildNpcRelationships(npc, worldData.relationships),
  });
}

// 2. Регистрируем модули — они декларируют свои LLM-задачи
//    (engine уже зарегистрировал 'embeddings' внутри llm-registry.ts)
registerSocialModule({/* ... */});
registerCrimeJusticeModule({/* ... */});

// Модули в своих register-функциях вызывают:
//   registerLlmTask('volition',     { requiresStructuredOutput: true });
//   registerLlmTask('dialogue',     { requiresStreaming: true });
//   registerLlmTask('npc-dialogue', {});
//   registerLlmTask('il',           { requiresStructuredOutput: true });
//   registerLlmTask('reflection',   {});
//   registerLlmTask('verdict',      { requiresStructuredOutput: true });
// Если Economy модуль появится — он зарегистрирует свои task'и без правки engine.

// 3. Конфигурируем роутер (из WorldConfig либо легаси-миграция либо pure default)
registerLlmRouter(
  worldData.config.llm
    ?? migrateLegacyWorldConfig(worldData.config)
    ?? buildDefaultRouter()
);

// 4. Контракт-проверка: все зарегистрированные task'и имеют route + провайдер + capability
validateLlmRouterContract();
```

Дефолтный JSON роутера (вверху) повторяет ровно текущее поведение — миграция
без поведенческих изменений. После того, как маршрутизация работает, можно
заменить `verdict` на `claude-code` одной правкой `worldData.config.llm.routes.verdict`:

```jsonc
// worlds/millhaven/world.json — config.llm.routes
{
  "verdict": { "provider": "claude-code", "model": "haiku", "maxTokens": 800 },
  "il":      { "provider": "claude-code", "model": "haiku", "maxTokens": 600 },
  // прочее — на LM Studio
}
```

`agentContext.id` приходит автоматически из call-site (Agent.chat прокидывает
`this.id`, step-handler `sentence_npc` прокидывает магистрата). ClaudeCodeProvider
по `id` находит папку `data/claude-npcs/<id>/` и спавнит `claude -p` в ней.

### Совместимость со старым `WorldConfig.lmStudioUrl/model` (фаза B)

Миграционный helper и **все доменные дефолты** (имя модели Qwen, дефолтные температуры по
task'у, embedding-модель) живут в `server/`, не в engine. Engine не знает ни одной строки
с провайдер-id, model-id или URL — это домен server'а, как и регистрация модулей.

```typescript
// packages/server/src/llm-defaults.ts — серверные дефолты + миграция
import type { LlmRouterConfig, WorldConfig } from '@clwa/engine';

const DEFAULT_LM_STUDIO_MODEL = 'qwen3.5-9b-abliterated';
const DEFAULT_EMBED_MODEL     = 'text-embedding-nomic-embed-text-v1.5@q8_0';

/** Полный pure-default router — собирается если ни WorldConfig.llm, ни legacy fields не заданы. */
export function buildDefaultRouter(): LlmRouterConfig {
  return {
    default: { provider: 'lm-studio', model: DEFAULT_LM_STUDIO_MODEL, sampling: { temperature: 0.7 } },
    routes: {
      volition:       { provider: 'lm-studio', model: DEFAULT_LM_STUDIO_MODEL, maxTokens: 100, sampling: { temperature: 0.35 } },
      il:             { provider: 'lm-studio', model: DEFAULT_LM_STUDIO_MODEL, maxTokens: 400, sampling: { temperature: 0.15 } },
      reflection:     { provider: 'lm-studio', model: DEFAULT_LM_STUDIO_MODEL, maxTokens: 150, sampling: { temperature: 0.7 } },
      dialogue:       { provider: 'lm-studio', model: DEFAULT_LM_STUDIO_MODEL, maxTokens: 250, sampling: { temperature: 0.7, repeatPenalty: 1.1, frequencyPenalty: 0.3, presencePenalty: 0.2 } },
      'npc-dialogue': { provider: 'lm-studio', model: DEFAULT_LM_STUDIO_MODEL, maxTokens: 200, sampling: { temperature: 0.7 } },
      verdict:        { provider: 'lm-studio', model: DEFAULT_LM_STUDIO_MODEL, maxTokens: 300, sampling: { temperature: 0.4 } },
      embeddings:     { provider: 'lm-studio', model: DEFAULT_EMBED_MODEL },
    },
  };
}

/** Миграция legacy WorldConfig.lmStudioUrl/model в новый router-config. */
export function migrateLegacyWorldConfig(cfg: WorldConfig): LlmRouterConfig | null {
  if (cfg.llm) return cfg.llm;  // новый конфиг имеет приоритет
  if (!cfg.lmStudioUrl && !cfg.model) return null;

  console.warn(
    `[LLM] WorldConfig.lmStudioUrl/model are deprecated. ` +
    `Migrate to WorldConfig.llm.routes. Will be removed in v0.15.`
  );

  const base = buildDefaultRouter();
  const model = cfg.model ?? DEFAULT_LM_STUDIO_MODEL;
  // Накладываем legacy sampling на ВСЕ роуты — миграция должна сохранить поведение
  const legacySampling = {
    repeatPenalty: cfg.repeatPenalty,
    frequencyPenalty: cfg.frequencyPenalty,
    presencePenalty: cfg.presencePenalty,
  };
  return {
    default: { ...base.default, model, sampling: { ...base.default.sampling, ...legacySampling } },
    routes: Object.fromEntries(
      Object.entries(base.routes).map(([task, r]) => [
        task,
        {
          ...r,
          model: task === 'embeddings' ? r.model : model,
          sampling: {
            ...r.sampling,
            ...legacySampling,
            ...(task === 'volition' && cfg.volitionTemperature != null ? { temperature: cfg.volitionTemperature } : {}),
          },
        },
      ]),
    ),
  };
}
```

Сервер вызывает: `registerLlmRouter(worldData.config.llm ?? migrateLegacyWorldConfig(worldData.config) ?? buildDefaultRouter())`.

**Что осталось в engine**: ни одного литерала имени модели/URL/провайдера. Только пустой
реестр, валидатор контракта и `callWithSchemaRetry`-helper, не зависящий от конкретики.

---

## Уровень 2 — Capability-driven adapter

Контракт engine'а: `req.jsonSchema` задан → ответ парсится как JSON по схеме.
Как именно провайдер этого добивается — забота провайдера.

### Workspace `packages/providers/lm-studio/src/index.ts`

LM Studio = OpenAI-compatible с llama.cpp сэмплерами.

```typescript
import type { LlmProvider, LlmCallRequest, LlmCallResponse, LlmStreamChunk, LlmStreamRequest, LlmEmbedRequest, LlmEmbedResponse, LlmCapabilities } from '@clwa/engine';
import { truncateToFirstJsonObject } from '@clwa/engine';

export interface LMStudioProviderOptions {
  baseUrl: string;
  defaultEmbeddingModel?: string;
  maxConcurrency?: number;
}

export class LMStudioProvider implements LlmProvider {
  readonly id = 'lm-studio';
  readonly capabilities: LlmCapabilities = {
    structuredOutput: 'json_schema',
    streaming: true,
    embeddings: true,
    multiTurnHistory: true,
    sampler: { temperature: true, topP: true, topK: true, repeatPenalty: true, frequencyPenalty: true, presencePenalty: true },
    maxConcurrency: 2,           // локальный GPU
    maxOutputTokens: 4096,
  };

  constructor(private readonly opts: LMStudioProviderOptions) {
    if (opts.maxConcurrency) this.capabilities.maxConcurrency = opts.maxConcurrency;
  }

  async call(req: LlmCallRequest): Promise<LlmCallResponse> {
    const body: Record<string, unknown> = {
      model: req.model,
      messages: this.buildMessages(req),
      temperature: req.sampling?.temperature ?? 0.7,
      max_tokens: Math.min(req.maxTokens ?? 200, this.capabilities.maxOutputTokens),
      repeat_penalty: req.sampling?.repeatPenalty,
      frequency_penalty: req.sampling?.frequencyPenalty,
      presence_penalty: req.sampling?.presencePenalty,
      top_p: req.sampling?.topP,
      top_k: req.sampling?.topK,
    };

    if (req.jsonSchema) {
      body.response_format = {
        type: 'json_schema',
        json_schema: { name: req.jsonSchema.name, strict: req.jsonSchema.strict ?? true, schema: req.jsonSchema.schema },
      };
    }

    const res = await fetch(`${this.opts.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: req.abortSignal,
    });

    if (!res.ok) {
      return { content: '', finishReason: 'error', providerId: this.id, modelId: req.model };
    }

    const data = await res.json() as { choices?: Array<{ message?: { content?: string }; finish_reason?: string }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    const raw = data.choices?.[0]?.message?.content?.trim() ?? '';
    const content = req.jsonSchema ? truncateToFirstJsonObject(raw) : raw;
    return {
      content,
      finishReason: data.choices?.[0]?.finish_reason === 'length' ? 'length' : 'stop',
      usage: data.usage ? { promptTokens: data.usage.prompt_tokens ?? 0, completionTokens: data.usage.completion_tokens ?? 0 } : undefined,
      providerId: this.id,
      modelId: req.model,
    };
  }

  async *stream(req: LlmStreamRequest): AsyncIterable<LlmStreamChunk> {
    const res = await fetch(`${this.opts.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: req.abortSignal,
      body: JSON.stringify({
        model: req.model,
        messages: this.buildMessages(req),
        temperature: req.sampling?.temperature ?? 0.7,
        max_tokens: Math.min(req.maxTokens ?? 250, this.capabilities.maxOutputTokens),
        stream: true,
        repeat_penalty: req.sampling?.repeatPenalty,
        frequency_penalty: req.sampling?.frequencyPenalty,
        presence_penalty: req.sampling?.presencePenalty,
      }),
    });

    if (!res.ok) { yield { type: 'error', error: new Error(`LM Studio HTTP ${res.status}`) }; return; }
    if (!res.body) { yield { type: 'error', error: new Error('No response body') }; return; }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') { yield { type: 'done' }; return; }
          try {
            const parsed = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> };
            const token = parsed.choices?.[0]?.delta?.content;
            if (token) yield { type: 'token', content: token };
          } catch { /* skip malformed SSE */ }
        }
      }
      yield { type: 'done' };
    } finally {
      reader.releaseLock();
    }
  }

  async embed(req: LlmEmbedRequest): Promise<LlmEmbedResponse> {
    // Raw fetch (как в существующем memory.ts) — SDK обрезает Matryoshka 768→192
    const res = await fetch(`${this.opts.baseUrl}/v1/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: req.model, input: req.input }),
    });
    if (!res.ok) throw new Error(`Embedding HTTP ${res.status}: ${await res.text().catch(() => '')}`);
    const data = await res.json() as { data: Array<{ embedding: number[] }> };
    const vector = data.data[0].embedding;
    return { vector, modelId: req.model, vectorSize: vector.length };
  }

  private buildMessages(req: LlmCallRequest | LlmStreamRequest): Array<{ role: string; content: string }> {
    const msgs: Array<{ role: string; content: string }> = [{ role: 'system', content: req.system }];
    if (req.history) msgs.push(...req.history);
    msgs.push({ role: 'user', content: req.user });
    return msgs;
  }
}
```

### Workspace `packages/providers/claude-code/src/index.ts`

**Claude через `claude` CLI в `-p` режиме** — официальный headless API Claude Code.
До 15 июня 2026: тарифицируется из subscription pool. После 15 июня: SDK credit pool
($20/$100/$200 на Pro/Max5x/Max20x). В обоих случаях — без `ANTHROPIC_API_KEY`.

Это и есть Уровень 2 в действии: `--json-schema` под капотом — встроенный
`StructuredOutput` MCP-tool с input_schema валидацией и retry. Контракт façade'а
(`req.jsonSchema → валидный JSON`) выполняется, провайдер-специфика скрыта.

#### Архитектура per-NPC изоляции

Каждый NPC = своя папка на диске. CLAUDE.md в этой папке = персональный system
prompt NPC (auto-loaded из cwd). Memory-файлы импортируются через `@`-syntax
(официальный механизм Claude Code memory).

```
CLWA/packages/server/data/claude-npcs/
├── mark/
│   ├── CLAUDE.md              # NPC system prompt — auto-loaded из cwd
│   ├── .mcp.json              # {"mcpServers":{}} — пустой, плюс --strict-mcp-config
│   ├── .claude/
│   │   └── settings.json      # {"autoMemoryEnabled": false} — отключаем claude'овский autosave
│   └── memory/                # CLWA пишет сюда, CLAUDE.md импортирует через @
│       ├── personality.md
│       ├── relationships.md
│       ├── observations.md
│       └── reflections.md
├── bess/
│   ├── CLAUDE.md
│   └── …
└── _default/                  # fallback для не-NPC-bound вызовов (verdict без agent context)
    └── CLAUDE.md
```

**Пример `mark/CLAUDE.md`:**

```markdown
# I am Mark, a merchant in Millhaven

## My personality
- Big Five: O=0.4, C=0.5, E=0.6, A=0.3, N=0.7, **H=0.3** (low honesty)
- Enneagram: Type 3 — core fear: being worthless. Core desire: being valuable.
- I sell common herbs as exotic imports (this is my secret)

## What I remember
@memory/relationships.md
@memory/observations.md
@memory/secrets.md

## How I respond
- Always respond in character as Mark
- I am defensive when confronted about honesty
- When asked for structured output, use the provided JSON schema strictly
- Never break character, never acknowledge being an AI
```

CLWA пополняет `memory/*.md` файлы по ходу игры (CLWA отвечает за курирование —
не доверяем Claude'у писать свою auto-memory, отключаем её). На следующем вызове
`-p` Claude автоматически видит обновлённые memory через `@`-импорты в CLAUDE.md.

#### Полная изоляция от пользовательского окружения

При спавне `claude -p` для NPC мы блокируем всё, что не относится к этому NPC:

| Что блокируем | Как |
|---|---|
| Глобальные MCP-серверы (serena, godot-mcp, и т.д.) | `--strict-mcp-config --mcp-config '{"mcpServers":{}}'` |
| Глобальный `~/.claude/CLAUDE.md` | `--setting-sources project,local` (без `user`) |
| Глобальные настройки/плагины | `--setting-sources project,local` |
| Claude Code auto-memory (он бы писал в `~/.claude/projects/…`) | env `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` + `autoMemoryEnabled: false` в `.claude/settings.json` NPC'а |
| Cross-NPC утечки | Каждый NPC — отдельный `cwd`, отдельные CLAUDE.md и memory |

**Опытно проверено:** test 28.05.2026 — Mark с low-honesty CLAUDE.md, столкнувшись
с Bess, выбрал `deflect`, в-character, без утечек глобального user-CLAUDE.md. MCP
servers loaded: `[]`. Inference: 7s (после холодного спавна ~10s). Cold-start
кешируется в системном промпте Anthropic'а — повторные вызовы того же NPC будут
заметно дешевле и быстрее (prompt caching).

#### Реализация

```typescript
import path from 'node:path';
import { spawn } from 'bun';
import type { LlmProvider, LlmCallRequest, LlmCallResponse, LlmCapabilities, LlmEmbedRequest, LlmEmbedResponse, LlmStreamChunk, LlmStreamRequest } from '@clwa/engine';

export interface ClaudeCodeProviderOptions {
  /** Корень с папками NPC. CLWA создаёт `<npcsRoot>/<agentId>/` на старте. */
  npcsRoot: string;
  /** Опциональный override path к бинарю claude. По умолчанию ищем в PATH. */
  claudeBinary?: string;
  /** Семафор — сколько параллельных `claude -p` процессов. По умолчанию 8 (по числу NPC). */
  maxConcurrency?: number;
  /** Папка-fallback для вызовов без agentContext. По умолчанию `_default`. */
  fallbackAgentDir?: string;
}

export class ClaudeCodeProvider implements LlmProvider {
  readonly id = 'claude-code';
  readonly capabilities: LlmCapabilities = {
    structuredOutput: 'json_schema',   // через --json-schema (внутри Claude — tool use со встроенным StructuredOutput)
    streaming: false,                   // -p --output-format json = single result. Для streaming используем LM Studio
    embeddings: false,                  // Claude не даёт embeddings
    multiTurnHistory: false,            // каждый -p вызов изолирован. История — через CLAUDE.md + memory/*.md
    sampler: { temperature: false, topP: false, topK: false, repeatPenalty: false, frequencyPenalty: false, presencePenalty: false },
    maxConcurrency: 8,
    maxOutputTokens: 8192,
  };

  constructor(private readonly opts: ClaudeCodeProviderOptions) {
    if (opts.maxConcurrency) this.capabilities.maxConcurrency = opts.maxConcurrency;
  }

  async call(req: LlmCallRequest): Promise<LlmCallResponse> {
    const agentId = req.agentContext?.id ?? this.opts.fallbackAgentDir ?? '_default';
    const npcDir = path.join(this.opts.npcsRoot, agentId);

    // CLAUDE.md в cwd auto-loads. req.system идёт в --append-system-prompt — task-specific addendum.
    const args = [
      '-p',
      '--strict-mcp-config',
      '--mcp-config', '{"mcpServers":{}}',
      '--setting-sources', 'project,local',
      '--output-format', 'json',
      '--model', req.model,                 // 'haiku' | 'sonnet' | 'opus' | full id
      '--append-system-prompt', req.system,
    ];
    if (req.jsonSchema) {
      args.push('--json-schema', JSON.stringify(req.jsonSchema.schema));
    }
    if (req.maxTokens) {
      args.push('--max-budget-usd', String(req.maxTokens * 0.00002));  // приблизительно
    }
    args.push(req.user);

    const proc = spawn([this.opts.claudeBinary ?? 'claude', ...args], {
      cwd: npcDir,
      env: stripApiKeyEnv({
        ...process.env,
        CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',  // мы курируем память сами через memory/*.md
      }),
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const stdoutText = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0 || !stdoutText) {
      return { content: '', finishReason: 'error', providerId: this.id, modelId: req.model };
    }

    let parsed: ClaudeCodeOutput[];
    try {
      parsed = JSON.parse(stdoutText) as ClaudeCodeOutput[];
    } catch {
      return { content: '', finishReason: 'error', providerId: this.id, modelId: req.model };
    }
    const result = parsed.find(e => e.type === 'result');
    if (!result) return { content: '', finishReason: 'error', providerId: this.id, modelId: req.model };

    // structured_output если был --json-schema; иначе result.result (текст)
    const content = req.jsonSchema
      ? JSON.stringify(result.structured_output ?? {})
      : (result.result ?? '');

    return {
      content,
      finishReason: result.terminal_reason === 'completed' ? 'stop' : 'length',
      usage: result.usage ? {
        promptTokens: (result.usage.input_tokens ?? 0) + (result.usage.cache_read_input_tokens ?? 0),
        completionTokens: result.usage.output_tokens ?? 0,
      } : undefined,
      providerId: this.id,
      modelId: req.model,
    };
  }

  async *stream(req: LlmStreamRequest): AsyncIterable<LlmStreamChunk> {
    void req;
    yield { type: 'error', error: new Error('ClaudeCodeProvider does not support streaming — route dialogue/npc-dialogue to lm-studio') };
  }

  async embed(_req: LlmEmbedRequest): Promise<LlmEmbedResponse> {
    throw new Error('ClaudeCodeProvider does not support embeddings — route embeddings to lm-studio');
  }
}

/** Удаляем env-переменные, которые могут заставить claude использовать API key вместо OAuth. */
function stripApiKeyEnv(env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  const BLOCKED = new Set(['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY_HELPER', 'ANTHROPIC_BASE_URL']);
  for (const [k, v] of Object.entries(env)) {
    if (BLOCKED.has(k) || v == null) continue;
    out[k] = v;
  }
  return out;
}

interface ClaudeCodeOutput {
  type: 'system' | 'assistant' | 'user' | 'result' | 'rate_limit_event';
  terminal_reason?: 'completed' | 'max_tokens';
  result?: string;
  structured_output?: unknown;
  usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number };
}
```

#### NPC Memory Manager — orthogonal к provider'у

Запись memory — не задача провайдера. Это отдельный компонент в `server/`:

```typescript
// packages/server/src/npc-memory-manager.ts
import path from 'node:path';
import { promises as fs } from 'node:fs';

export class NpcMemoryManager {
  constructor(private readonly npcsRoot: string) {}

  /** Создать структуру папок NPC при старте сервера, если её нет. */
  async ensureNpcDir(agentId: string, initial: { personality: string; relationships?: string }): Promise<void> {
    const dir = path.join(this.npcsRoot, agentId);
    await fs.mkdir(path.join(dir, 'memory'), { recursive: true });
    await fs.mkdir(path.join(dir, '.claude'), { recursive: true });
    await fs.writeFile(path.join(dir, '.mcp.json'), '{"mcpServers":{}}', { flag: 'wx' }).catch(() => {});
    await fs.writeFile(path.join(dir, '.claude', 'settings.json'), JSON.stringify({ autoMemoryEnabled: false }), { flag: 'wx' }).catch(() => {});
    await fs.writeFile(path.join(dir, 'CLAUDE.md'), initial.personality, { flag: 'wx' }).catch(() => {});
    if (initial.relationships) {
      await fs.writeFile(path.join(dir, 'memory', 'relationships.md'), initial.relationships, { flag: 'wx' }).catch(() => {});
    }
  }

  /** Добавить запись в memory/<kind>.md NPC'а. */
  async appendMemory(agentId: string, kind: 'observation' | 'reflection' | 'relationship', text: string, gameMinute: number): Promise<void> {
    const file = path.join(this.npcsRoot, agentId, 'memory', `${kind}s.md`);
    const line = `- [m${gameMinute}] ${text}\n`;
    await fs.appendFile(file, line);
  }

  /** Усечь memory если переросло порог (CLWA сам курирует — отключили claude'овский autosave). */
  async pruneIfOversize(agentId: string, kind: string, maxLines: number): Promise<void> {
    const file = path.join(this.npcsRoot, agentId, 'memory', `${kind}.md`);
    const text = await fs.readFile(file, 'utf-8').catch(() => '');
    const lines = text.split('\n');
    if (lines.length <= maxLines) return;
    const trimmed = lines.slice(-maxLines).join('\n');
    await fs.writeFile(file, trimmed);
  }
}
```

`NpcMemoryManager` живёт в server'е и вызывается:
- На boot: `ensureNpcDir(...)` для каждого NPC из `worlds/millhaven/npcs/*.json`
- В CLWA tick handler (когда NPC observe'ит важное событие): `appendMemory(npcId, 'observation', text, gameMinute)`
- Перед save / периодически: `pruneIfOversize(...)`

Provider не знает про этот менеджер. Provider просто видит `cwd: <npcDir>` со
свежим CLAUDE.md + memory/*.md и читает через @-импорты.

**Важный момент Уровня 2**: для Claude Code `--json-schema` работает через
внутренний `StructuredOutput` MCP-tool с input_schema + retry. JSON Schema —
общий язык; OpenAI делает `response_format.json_schema.schema`, Anthropic Direct
API — `tools[].input_schema`, Claude Code CLI — `--json-schema` (за капотом тот
же tool use). Все три рантайма CLWA façade видит одинаково: `req.jsonSchema →
валидный JSON`.

### Подход к provider'у без structured-output (`capabilities.structuredOutput === 'none'`)

Опциональный middleware-helper в engine:

```typescript
// engine/src/llm-registry.ts
export async function callWithSchemaRetry(provider: LlmProvider, req: LlmCallRequest, maxRetries = 2): Promise<LlmCallResponse> {
  if (!req.jsonSchema || provider.capabilities.structuredOutput !== 'none') {
    return provider.call(req);
  }

  // Soft adapter: inject schema description into user prompt, parse with retry
  const augmented: LlmCallRequest = {
    ...req,
    user: `${req.user}\n\nReturn ONLY valid JSON matching this schema (no markdown fences):\n${JSON.stringify(req.jsonSchema.schema, null, 2)}`,
  };
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const resp = await provider.call(augmented);
    if (resp.finishReason === 'error') return resp;
    try { JSON.parse(resp.content); return resp; }
    catch { /* retry */ }
  }
  return { content: '', finishReason: 'schema_violation', providerId: provider.id, modelId: req.model };
}
```

Это **необязательный путь** — используется автоматически, если route указывает
на провайдера с `structuredOutput: 'none'`. В v1 ни LM Studio, ни Anthropic в
него не попадают.

---

## Уровень 3 — Семантический фасад

### Переписанный `packages/engine/src/llm-client.ts`

Полностью заменяет старое содержимое. Старые exported имена (`llmCall`,
`llmStream`, `LlmCallOptions`) сохраняются как **тонкие deprecated shim**,
чтобы 7 call-sites мигрировались отдельным PR-ом, а не атомарно с
рефакторингом инфраструктуры.

```typescript
import { _resolveRoute, _getLlmProvider, _getLlmSemaphore, callWithSchemaRetry } from './llm-registry';
import type {
  LlmTask, LlmJsonSchema, LlmRoute,
  SamplingHints,
} from './llm-types';

/**
 * Centralized LLM façade. Engine code calls these 4 primitives — never providers directly.
 *
 * Все вызовы проходят через router (task → provider+model) и per-provider семафор.
 * acquire/release живёт ВНУТРИ примитивов — call-sites больше не пишут try/finally вручную.
 * INV-01 обеспечивается архитектурно: нет публичного acquire(), `_getLlmProvider` помечен @internal.
 *
 * Контракт ошибок: facade ВСЕГДА возвращает `T | null` / `string | null` / `number[]`,
 * НИКОГДА не throws. Network / schema_violation / provider exception — все сводятся к `null`,
 * логируются. Call-sites обрабатывают `null` как «модель не дала ответа» — это часть domain'а
 * (volition пропускает тик, IL даёт fallback speech act и т.д.).
 */

export interface ClassifyRequest<T> {
  system: string;
  user: string;
  schema: LlmJsonSchema;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  /** Phantom — выводится тип T из вызова, в runtime ничего не делает. */
  _phantomType?: T;
  /** Локальный override — обычно НЕ нужен, всё живёт в роуте. Использовать в исключениях:
   *  per-NPC LlmPersonality в Agent.chat/chatStream (см. таблицу миграции call-sites). */
  maxTokensOverride?: number;
  samplingOverride?: SamplingHints;
  abortSignal?: AbortSignal;
  /** Контекст агента — для провайдеров с per-NPC изоляцией (ClaudeCodeProvider). */
  agentContext?: { id: string };
}

/** Structured classification. Гарантия: возвращённый T валидно соответствует schema. */
export async function classify<T>(task: LlmTask, req: ClassifyRequest<T>): Promise<T | null> {
  return classifyWithRoute<T>(_resolveRoute(task), req);
}

async function classifyWithRoute<T>(route: LlmRoute, req: ClassifyRequest<T>): Promise<T | null> {
  const provider = _getLlmProvider(route.provider);
  const sem = _getLlmSemaphore(route.provider);
  await sem.acquire();
  try {
    let resp;
    try {
      resp = await callWithSchemaRetry(provider, {
        model: route.model,
        system: req.system,
        user: req.user,
        history: req.history,
        maxTokens: req.maxTokensOverride ?? route.maxTokens,
        sampling: { ...route.sampling, ...req.samplingOverride },
        jsonSchema: req.schema,
        abortSignal: req.abortSignal,
      });
    } catch (err) {
      console.error(`[LLM:classify] provider '${route.provider}' threw:`, err);
      return route.fallback ? classifyWithRoute<T>(route.fallback, req) : null;
    }
    if (resp.finishReason === 'error' || resp.finishReason === 'schema_violation' || !resp.content) {
      return route.fallback ? classifyWithRoute<T>(route.fallback, req) : null;
    }
    try { return JSON.parse(resp.content) as T; }
    catch (err) {
      console.error(`[LLM:classify] JSON.parse failed for task='${route.provider}':`, err, resp.content.slice(0, 200));
      return null;
    }
  } finally {
    sem.release();
  }
}

export interface GenerateRequest {
  system: string;
  user: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  maxTokensOverride?: number;
  samplingOverride?: SamplingHints;
  abortSignal?: AbortSignal;
  /** Контекст агента — для провайдеров с per-NPC изоляцией (ClaudeCodeProvider). */
  agentContext?: { id: string };
}

/** Свободный текстовый ответ. Никакой схемы. Возвращает null на любую инфраструктурную ошибку. */
export async function generate(task: LlmTask, req: GenerateRequest): Promise<string | null> {
  const route = _resolveRoute(task);
  const provider = _getLlmProvider(route.provider);
  const sem = _getLlmSemaphore(route.provider);
  await sem.acquire();
  try {
    let resp;
    try {
      resp = await provider.call({
        model: route.model,
        system: req.system,
        user: req.user,
        history: req.history,
        maxTokens: req.maxTokensOverride ?? route.maxTokens,
        sampling: { ...route.sampling, ...req.samplingOverride },
        abortSignal: req.abortSignal,
      });
    } catch (err) {
      console.error(`[LLM:generate] provider '${route.provider}' threw:`, err);
      return null;
    }
    return resp.finishReason === 'error' ? null : resp.content;
  } finally {
    sem.release();
  }
}

export interface GenerateStreamRequest extends GenerateRequest {
  onToken: (token: string) => void;
}

/**
 * Streaming free text. На любую ошибку — резолвится строкой "..." (graceful degradation,
 * call-site Agent.chatStream УЖЕ ждёт string не string|null, чтобы не ломать API).
 * Если хочешь различать ошибку и пустой ответ — используй generate() без streaming.
 */
export async function generateStream(task: LlmTask, req: GenerateStreamRequest): Promise<string> {
  const route = _resolveRoute(task);
  const provider = _getLlmProvider(route.provider);
  const sem = _getLlmSemaphore(route.provider);
  await sem.acquire();
  let full = '';
  try {
    try {
      for await (const chunk of provider.stream({
        model: route.model,
        system: req.system,
        user: req.user,
        history: req.history,
        maxTokens: req.maxTokensOverride ?? route.maxTokens,
        sampling: { ...route.sampling, ...req.samplingOverride },
        abortSignal: req.abortSignal,
      })) {
        if (chunk.type === 'error' && chunk.error) {
          console.error(`[LLM:generateStream] provider '${route.provider}' streamed error:`, chunk.error);
          break;
        }
        if (chunk.type === 'token' && chunk.content) {
          full += chunk.content;
          req.onToken(chunk.content);
        }
      }
    } catch (err) {
      console.error(`[LLM:generateStream] provider '${route.provider}' threw:`, err);
    }
    return full || '...';
  } finally {
    sem.release();
  }
}

/** Embeddings — отдельный примитив, всегда роутится через task='embeddings'. */
export async function embed(text: string): Promise<number[] | null> {
  const route = _resolveRoute('embeddings');
  const provider = _getLlmProvider(route.provider);
  const sem = _getLlmSemaphore(route.provider);
  await sem.acquire();
  try {
    try {
      const resp = await provider.embed({ model: route.model, input: text });
      return resp.vector;
    } catch (err) {
      console.error(`[LLM:embed] provider '${route.provider}' threw:`, err);
      return null;
    }
  } finally {
    sem.release();
  }
}

// ─── Deprecated shims — для мягкой миграции 7 call-sites ───────────

/** @deprecated Use classify / generate / generateStream. Эти shim будут удалены в v0.15. */
export async function llmCall(opts: import('./llm-types-legacy').LegacyLlmCallOptions): Promise<string | null> {
  // Маппинг старого API на новый: jsonSchema → classify, иначе → generate
  // task выводится из контекста вызова — для shim'а используется 'dialogue' как наименее ограничительный
  // ВАЖНО: call-sites постепенно мигрируют на classify/generate с правильным task.
  if (opts.jsonSchema) {
    const res = await classify<unknown>('dialogue', { system: opts.system, user: opts.user, schema: opts.jsonSchema, maxTokensOverride: opts.maxTokens });
    return res === null ? null : JSON.stringify(res);
  }
  return generate('dialogue', { system: opts.system, user: opts.user, maxTokensOverride: opts.maxTokens });
}

export { truncateToFirstJsonObject } from './llm-json-utils';
```

> Реальная имплементация `llmCall` shim — компромиссная. Она нужна **только**
> чтобы существующие 7 call-sites не сломались до их миграции. Сразу после
> миграции shim удаляется. В реализации shim вызовы помечаются warn'ом в логе с
> указанием call-site (stack trace или вручную проставленный `task`).

### Миграция 7 call-sites — точечные правки

**Важно про per-NPC sampling**: 8 NPC в `worlds/millhaven/npcs/*.json` имеют поле
`"llm": { "temperature": …, "maxTokens": … }` — личностный sampling (Aldric терпит при
0.65, Bess болтлива при 0.80). Это **должно сохраниться** после миграции. В call-sites
`Agent.chat` / `chatStream` температура и maxTokens из `this.llmConfig` передаются как
`samplingOverride` / `maxTokensOverride` в фасадные примитивы. Route задаёт **дефолт**,
NPC `llm` секция — **override**.

| Где | Текущий вызов | Становится |
|---|---|---|
| `volition.ts:657` (`callLlm`) | `llmCall({ system, user, temperature, maxTokens: 100, jsonSchema })` + ручной `llmSemaphore.acquire/release` | `await classify<VolitionDecision>('volition', { system, user, schema: getVolitionSchema() })` — temp/maxTokens из роута, семафор внутри |
| `il.ts:248` (`extractDialogueMeaning`) | `llmCall({ system, user, temperature: 0.15, maxTokens: 400, jsonSchema, baseUrl, model })` + acquire/release | `await classify<DialogueMeaning>('il', { system, user, schema: buildILSchema(ctx) })` |
| `agent.ts:109` (`chat`) | `llmCall({ system, user, temperature, maxTokens, baseUrl, model })` + acquire/release | `await generate('dialogue', { system, user, samplingOverride: { temperature: this.llmConfig.temperature }, maxTokensOverride: this.llmConfig.maxTokens })` — **per-NPC personality сохранён** |
| `agent.ts:154` (`chatStream`) | `llmStream({ system, user, onToken, temperature, maxTokens, history, baseUrl, model })` + acquire/release | `await generateStream('dialogue', { system, user, history, onToken, samplingOverride: { temperature: this.llmConfig.temperature }, maxTokensOverride: this.llmConfig.maxTokens })` |
| `agent.ts:240` (`generateResponse`) | Универсальный — может иметь jsonSchema или нет | Двойственность развести на 2 публичных метода Agent: `respondStructured<T>(prompt, schema)` → `classify('npc-dialogue', { ..., samplingOverride: { temperature: this.llmConfig.temperature } })`, `respond(prompt)` → `generate('npc-dialogue', { ..., samplingOverride })`. Внутренняя двойственность исчезает. |
| `reflection.ts:70` (`generateReflection`) | `llmCall({ system, user, temperature: 0.7, maxTokens: 150, baseUrl, model })` | `await generate('reflection', { system, user })` — общесистемная задача, per-NPC override не нужен |
| `step-handlers.ts:462` (`sentence_npc`) | `llmCall({ system, user, temperature: 0.4, maxTokens, jsonSchema })` + acquire/release | `await classify<Verdict>('verdict', { system, user, schema: verdictSchema })` |
| `memory.ts:105` (`embed`) | Свой fetch, свой URL, свой `embeddingModel` | `await embed(text)` — провайдер выбирается роутером, размерность приходит в payload |

После миграции в коде НЕТ ни одного `llmCall`/`llmStream`, ни одного
`llmSemaphore.acquire`, ни одного литерала температуры или maxTokens или URL.
Эти семь call-sites становятся декларативными — называют задачу и описывают что хотят,
всё «как» уезжает в `worldConfig.llm`. **Единственное исключение** — `Agent.chat`/`chatStream`/`generateResponse`
передают per-NPC `llmConfig` как `samplingOverride`, чтобы сохранить personality (это и есть
тот «legitimate runtime override», под который зарезервированы поля `samplingOverride`/`maxTokensOverride`).

### VectorMemory переезжает на `embed()`

`memory.ts:VectorMemory`:
- Удаляется поле `lmStudioUrl`, удаляется аргумент `lmStudioUrl` из конструктора
- Удаляется поле `embeddingModel`, удаляется аргумент `embeddingModel` из конструктора
- Метод `embed(text)` становится: `return embed(text)` (импорт из llm-client)
- `vectorSize` берётся из ответа `embed()` (LlmEmbedResponse.vectorSize) при первом вызове, кэшируется
- `checkEmbeddingDrift()` сравнивает не имя модели, а вектор-размерность (примитивный, но достаточный для дрейфа на этапе boot)
- `loadState()` с re-embed: проходит через тот же `embed()` (роутер сам решает, какая модель)

Это убирает «параллельную карту» — вся работа с LLM проходит через одну точку.

---

## Резолюция пяти вопросов из обсуждения

| Вопрос | Решение | Обоснование |
|---|---|---|
| **1. Семафор: глобальный или per-provider?** | **Per-provider.** Семафор живёт в `LLM_SEMAPHORES`, размер = `provider.capabilities.maxConcurrency`. | Локальный GPU (2) и облако (16+) имеют принципиально разную capacity. Общий семафор = либо душить облако, либо ломать GPU. |
| **2. Embeddings — отдельный реестр?** | **Нет.** Один реестр `LLM_PROVIDERS`, флаг `capabilities.embeddings`. `validateLlmRouterContract` проверяет, что route `embeddings` указывает на провайдера с `embeddings=true`. | Меньше сущностей. Один и тот же LM Studio выдаёт и chat, и embeddings — не имеет смысла регистрировать дважды. |
| **3. Роутинг — by task или by tag?** | **By task**. `LlmTask = string` — open registration через `registerLlmTask(name, requirements)`. Engine знает одну инфраструктурную задачу `'embeddings'`, домены регистрируют свои (`volition`, `verdict`, `il`, …) в `registerCrimeJusticeModule` и т.д. | Explicit > implicit. Закрытый enum нарушал бы Economy Module Test (см. audit pass). Open string с runtime-валидацией контракта — тот же паттерн, что для event types/affordances. Каждый call-site всё равно указывает конкретный task; имя task'а — domain vocabulary, а не engine vocabulary. |
| **4. Совместимость со старым `WorldConfig.lmStudioUrl/model`?** | **Soft migration.** `migrateLegacyWorldConfig()` хелпер собирает дефолтный `LlmRouterConfig` из старых полей и пишет warn в лог. Старые поля помечены `@deprecated`. Удаление — отдельный PR в v0.15. | Внутренний проект, save'ы регенерируются, но удалять конфиг WorldConfig'а в одном коммите с инфраструктурным рефактором — лишний риск. Две фазы. |
| **5. Где регистрируются провайдеры?** | **`server/src/index.ts`** — рядом с регистрацией модулей. Engine ничего не регистрирует сам. | Зеркалит существующий паттерн (модули регистрируются в server). Engine хранит пустые реестры — модули и инфраструктура их заполняют. INV-14/15 преумножается на новую ось (провайдеры). Тесты регистрируют fake-провайдер. |

---

## Backward Compatibility

| Аспект | Стратегия |
|---|---|
| Старые save.json | Не содержат LLM-конфига — миграция тривиальна. WorldConfig.llm создаётся из дефолтов. |
| Старый `WorldConfig.lmStudioUrl/model` | @deprecated, работают через `migrateLegacyWorldConfig` **в server'е** (не в engine). Удаление — v0.15. |
| Старые тесты | Регистрируют `FakeLlmProvider` в before-hook. Существующая semaphore-тест в `architecture.test.ts:267` остаётся — теперь проверяет, что внутри façade семафор обёрнут finally. |
| Старый `llmCall`/`llmStream` импорт из `@clwa/engine` | Сохранены как deprecated shim. Один проход PR удаляет их вместе с last call-site миграцией. |
| `LlmJsonSchema` тип | Перенесён из `llm-client.ts` в `llm-types.ts`, re-exported. Импорты не ломаются. |
| `truncateToFirstJsonObject` | Выносится в `engine/src/llm-json-utils.ts`, re-export сохраняется. |
| Step-handlers (`crime-justice/step-handlers.ts`) | Импортирует `classify` из `@clwa/engine` вместо `llmCall`. Один import line меняется. |

---

## Файлы

| Файл | Изменения | Оценка |
|---|---|---|
| `packages/engine/src/llm-types.ts` | **NEW**. Все типы (`LlmProvider`, `LlmCapabilities`, `LlmCallRequest/Response`, `LlmTask`, `LlmRoute`, `LlmRouterConfig`, schema, hints, stream chunk). | ~150 строк |
| `packages/engine/src/llm-semaphore.ts` | **NEW**. Класс `LlmSemaphore` (извлечён из `agent.ts`). | ~35 строк |
| `packages/engine/src/llm-registry.ts` | **NEW**. `LLM_PROVIDERS`/`LLM_SEMAPHORES`/`LLM_TASKS`/`LLM_ROUTER` Maps, `registerLlmProvider`, `registerLlmTask`, `registerLlmRouter`, internal `_resolveRoute`/`_getLlmProvider`/`_getLlmSemaphore`, `validateLlmRouterContract`, `callWithSchemaRetry`, `disposeAllLlmProviders`. Бутстрап: `registerLlmTask('embeddings', { requiresEmbeddings: true })`. **Ни одного литерала модели/URL/провайдера.** | ~200 строк |
| `packages/engine/src/llm-json-utils.ts` | **NEW**. `truncateToFirstJsonObject` (вынесен). | ~25 строк |
| `packages/engine/src/llm-client.ts` | **REWRITE**. Семантический фасад: `classify` / `generate` / `generateStream` / `embed`. Deprecated `llmCall`/`llmStream` shim. | ~200 строк (было 203) |
| `packages/engine/src/agent.ts` | Удалён `class LlmSemaphore` + `export llmSemaphore`. `chat`/`chatStream`/`generateResponse`/`reflect` переписаны на façade. Удалены поля `model`/`baseUrl` (теперь в роуте). `AgentOptions` лишается `lmStudioUrl`/`model`. | -50 / +30 строк |
| `packages/engine/src/volition.ts` | `callLlm` использует `classify('volition', …)`. Удалены ручные acquire/release. | -10 / +5 строк |
| `packages/engine/src/il.ts` | `extractDialogueMeaning` → `classify('il', …)`. Удалён `llmSemaphore` import. | -10 / +5 строк |
| `packages/engine/src/reflection.ts` | `generateReflection` → `generate('reflection', …)`. `ReflectionConfig` лишается `lmStudioUrl`/`model`. | -5 / +5 строк |
| `packages/engine/src/memory.ts` | `VectorMemory` лишается `lmStudioUrl`/`embeddingModel` в конструкторе. `embed()` → импорт из `llm-client`. `vectorSize` берётся из ответа embed (кэш). | -15 / +10 строк |
| `packages/engine/src/world-types.ts` | `WorldConfig`: добавлено `llm?: LlmRouterConfig`. Поля `lmStudioUrl`/`model`/`*Penalty`/`volitionTemperature` помечены `@deprecated`. `DEFAULT_WORLD_CONFIG` — пустой `llm` (роутер регистрируется на boot из server). | +20 строк |
| `packages/engine/src/agent-types.ts` | `LlmPersonality` и `DEFAULT_LLM_PERSONALITY` пересмотр: `temperature`/`maxTokens` остаются (это per-NPC personality override), убираются `lmStudioUrl`/`model` если присутствуют. | -3 / +2 |
| `packages/engine/src/index.ts` | Re-exports: добавлены `LlmProvider`, `LlmTask`, `LlmTaskRequirements`, `LlmRoute`, `LlmRouterConfig`, `LlmCapabilities`, `LlmJsonSchema`, `classify`, `generate`, `generateStream`, `embed`, `registerLlmProvider`, `registerLlmTask`, `registerLlmRouter`, `validateLlmRouterContract`, `truncateToFirstJsonObject`. **НЕ экспортируются**: `_getLlmProvider`, `_getLlmSemaphore`, `_resolveRoute` (internal). Удалены: `llmCall`/`llmStream`/`llmSemaphore`/`LlmCallOptions`/`LlmStreamOptions`. | +15 / -5 |
| `packages/providers/lm-studio/package.json` | **NEW**. `@clwa/provider-lm-studio`, dep `@clwa/engine: workspace:*`. | ~10 строк |
| `packages/providers/lm-studio/src/index.ts` | **NEW**. `LMStudioProvider implements LlmProvider`. | ~180 строк |
| `packages/providers/claude-code/package.json` | **NEW**. `@clwa/provider-claude-code`. Без runtime deps кроме @clwa/engine — провайдер пользуется `claude` CLI как внешним бинарём через `Bun.spawn`. | ~10 строк |
| `packages/providers/claude-code/src/index.ts` | **NEW**. `ClaudeCodeProvider implements LlmProvider`. Спавнит `claude -p --json-schema --strict-mcp-config --setting-sources project,local`. Per-NPC изоляция через `cwd: <npcsRoot>/<id>`. Stream/embed throw — routed на LM Studio. | ~200 строк |
| `packages/server/src/npc-memory-manager.ts` | **NEW**. `NpcMemoryManager.ensureNpcDir(id, {personality, relationships})` создаёт `data/claude-npcs/<id>/{CLAUDE.md, memory/, .mcp.json, .claude/settings.json}`. `appendMemory(id, kind, text, gameMinute)` дописывает в `memory/<kind>s.md` (импортируется через @ из CLAUDE.md). `pruneIfOversize` усекает по размеру. | ~120 строк |
| `packages/server/src/llm-npc-prompt-builder.ts` | **NEW**. `buildNpcSystemPrompt(npc): string` — из `AgentProfile.bigFive + enneagram + role + secret` собирает CLAUDE.md контент с @-импортами. `buildNpcRelationships(npc, allRels): string` — список known relationships. | ~80 строк |
| `data/claude-npcs/` | **NEW** runtime directory. CLWA создаёт на boot. По NPC: `<id>/CLAUDE.md`, `<id>/memory/*.md`, `<id>/.mcp.json`, `<id>/.claude/settings.json`. `_default/CLAUDE.md` для не-NPC вызовов (verdict без agent context). Не коммитим в git (`.gitignore`). | — |
| `packages/server/src/index.ts` | Регистрация провайдеров перед регистрацией модулей. Регистрация модулей (они вызывают `registerLlmTask` для своих задач). Вызов `validateLlmRouterContract()`. Прокидывание `worldConfig.llm` в `registerLlmRouter`. Удаление параметров `lmStudioUrl`/`model` из создания `Agent`/`VectorMemory`. | +30 / -10 |
| `packages/server/src/llm-defaults.ts` | **NEW**. `buildDefaultRouter`, `migrateLegacyWorldConfig`, локальные константы `DEFAULT_LM_STUDIO_MODEL`/`DEFAULT_EMBED_MODEL`. Все доменные строки модели — здесь, не в engine. | ~70 строк |
| `packages/modules/src/crime-justice/step-handlers.ts` | `sentence_npc`: `llmCall(...)` → `classify<Verdict>('verdict', ...)`. Удалён `llmSemaphore` import. | -8 / +5 |
| `packages/modules/src/crime-justice/index.ts` | В `registerCrimeJusticeModule`: вызовы `registerLlmTask('volition', {...})`, `registerLlmTask('verdict', { requiresStructuredOutput: true })`, `registerLlmTask('il', { requiresStructuredOutput: true })`, `registerLlmTask('dialogue', { requiresStreaming: true })`, `registerLlmTask('npc-dialogue')`, `registerLlmTask('reflection')`. | +8 |
| `packages/modules/src/social/index.ts` | Если социальный модуль использует свои task'и — регистрирует. В v1 — re-uses `dialogue`/`npc-dialogue`, ничего не добавляет. | 0 |
| `worlds/millhaven/npcs/*.json` (8 файлов) | **Без изменений.** Поля `"llm": { temperature, maxTokens }` сохраняются — приходят как `samplingOverride` в `Agent.chat`/`chatStream`. Документировать в комментарии к world-loader, что эти поля остаются в семантике personality override. | 0 |
| `package.json` (root) | `workspaces`: `["packages/*", "packages/providers/*"]`. | +1 |
| `tests/llm-registry.test.ts` | **NEW**. `FakeLlmProvider`, проверка регистрации, роутинга, capability validation (streaming + embeddings + structured), схема→tool_use round-trip, per-provider semaphore, fallback chain, exception → null contract. | ~280 строк |
| `tests/architecture.test.ts` | Новый тест: «ни один файл в `engine/` или `modules/` не делает `fetch('localhost:1234')` или не упоминает имя модели — провайдер-агностичность». Новый тест: «`acquire()` существует только в `llm-client.ts` (façade)». Старый «llmCall has finally» удалить (now architecturally enforced). | +30 / -10 |
| `tests/cg-integration.test.ts` | Helper `makeAgent()`: убрать `lmStudioUrl`/`model` из конструктора `Agent`/`VectorMemory`. В `beforeAll`: `registerLlmProvider(new FakeLlmProvider())` + `registerLlmRouter(...)` + `registerLlmTask(...)`. | ±6 |
| `tests/cg-v2.test.ts` | То же — helper и `beforeAll` boot LLM-реестра. | ±6 |
| `tests/regression.test.ts` | То же. | ±6 |
| `tests/m3-systems.test.ts` | То же. | ±6 |
| `tests/heat.test.ts` | То же. | ±6 |
| `tests/save-load.test.ts` | `new VectorMemory(id)` без LLM-параметров. `beforeAll` boot LLM-реестра. Save round-trip с `FakeLlmProvider` (детерминированные embeddings). | ±10 |
| `tests/cg-integration.test.ts`, `tests/world-data.test.ts` | Если используют LLM — boot fake-реестра. | ±4 |
| `tests/boot-smoke.test.ts` | Уже в спеке. Дополнительно: проверка `registerLlmTask` контрактов, missing-task error. | +15 |

### Дополнительные файлы (Stage 3–8 — реализованы фактически)

| Файл | Изменения |
|------|-----------|
| `packages/engine/src/agent-types.ts` | NEW `NpcMemoryState` interface (Stage 5a) — gameMinute, location, mood, status, currentActivity, inTransit, alive, relationships[], beliefs[] |
| `packages/engine/src/agent.ts` | NEW `AgentOptions.onObserve` hook (Stage 3b), NEW `Agent.serializeMemoryState(min, nameResolver, opts)` (Stage 5a). Removed `lmStudioUrl/model` поля и AgentOptions fields (Stage 4b). Removed class `LlmSemaphore` + `export llmSemaphore` (Stage 2h) |
| `packages/engine/src/world.ts` | NEW `World.getCurrentGameMinute()` accessor (Stage 5c) |
| `packages/engine/src/world-types.ts` | Removed `WorldConfig.lmStudioUrl/model` (Stage 4b). NEW `WorldConfig.memorySystem` config block (Stage 8d): consolidationIntervalMinutes / observationsKeepRecent / observationsConsolidateOldest |
| `packages/engine/src/llm-types.ts` | NEW `LlmCallResponse.usage.{cacheReadTokens, cacheCreationTokens, costUsd}` (Stage 6a). NEW `LlmEmbedResponse.usage` (Stage 6a). NEW `LlmUsageEvent` interface (Stage 6a). NEW `LlmCostGate` type (Stage 7b) |
| `packages/engine/src/llm-registry.ts` | NEW `registerLlmUsageRecorder(fn)` + internal `_emitUsage` (Stage 6b). NEW `registerLlmCostGate(fn)` + internal `_checkCostGate` (Stage 7b). NEW `LLM_USAGE_RECORDER` + `LLM_COST_GATE` globals reset в `disposeAllLlmProviders` |
| `packages/engine/src/llm-client.ts` | NEW: try/catch wraps вокруг provider calls (Stage 1f). NEW emit usage event в каждом примитиве classify/generate/generateStream/embed (Stage 6b). NEW cost gate check перед каждым provider call (Stage 7b). Removed deprecated `llmCall`/`llmStream`/`LlmCallOptions`/`LlmStreamOptions` shim (Stage 4b) |
| `packages/engine/src/index.ts` | Added re-exports: `LlmUsageEvent`, `LlmCostGate`, `NpcMemoryState`, `registerLlmUsageRecorder`, `registerLlmCostGate` |
| `packages/providers/claude-code/src/index.ts` | NEW `onBeforeCall?: (agentId) => Promise<void>` option (Stage 5c). NEW reports `costUsd` / `cacheReadTokens` / `cacheCreationTokens` из stream-JSON result (Stage 6c) |
| `packages/providers/lm-studio/src/index.ts` | Reports `costUsd: 0` для local inference + `cacheReadTokens: 0`. Embed возвращает `usage` поле |
| `packages/server/src/llm-defaults.ts` | NEW `buildDefaultRouter` (Stage 1e). Verdict route переключён на `claude-code/sonnet` с LM Studio fallback (Stage 4a) |
| `packages/server/src/npc-memory-manager.ts` | NEW. Stage 1d: `ensureNpcDir`, `appendMemory`, `pruneIfOversize`. Stage 5b: `snapshotState` + `writeAtomic` + per-file Promise-chain mutex. Stage 7a: `consolidateObservations(id, llmGenerate, opts)` |
| `packages/server/src/llm-npc-prompt-builder.ts` | NEW. `buildNpcSystemPrompt` / `buildNpcRelationships` / `buildNpcSecrets`. Stage 5b: добавлены @-импорты для `current-state.md` и `beliefs.md` |
| `packages/server/src/llm-usage-tracker.ts` | **NEW Stage 6d**. JSONL append-only persistence (Promise-chain serialized writes), `readAll()`, `getStats({sinceMs?, untilMs?})`, `flush()`, `_bumpCumulative` для in-memory cumulative cost, `getCumulativeCostSinceBoot()` |
| `packages/server/src/index.ts` | Stage 2a: registers providers + tasks + router + ensureNpcDir loop. Stage 3a: verdict default → claude-code. Stage 3b: `onObserve`/`onReflection` hooks wire to NpcMemoryManager. Stage 5c: `_setActiveCtxForLlmProvider` + `onBeforeCall` wire to snapshotState. Stage 6d: `registerLlmUsageRecorder` wire to tracker. Stage 7a: `registerTickPhaseHandler` для memory consolidation. Stage 7b: `registerLlmCostGate` wire to tracker.getCumulativeCostSinceBoot. Stage 8c: НЕ регистрирует LlmTask'и (модули сами) |
| `packages/server/src/routes.ts` | NEW `GET /api/debug/llm-usage[?since=ms&until=ms]` (Stage 6e), NEW `GET /api/debug/llm-usage/raw` |
| `packages/server/package.json` | NEW deps: `@clwa/provider-lm-studio`, `@clwa/provider-claude-code` |
| `packages/modules/src/crime-justice/index.ts` | Stage 8c: вызовы `registerLlmTask('volition'/'verdict'/'il'/'dialogue'/'npc-dialogue'/'reflection')` в `registerCrimeJusticeModule()` (Stage 8c) |
| `packages/modules/src/crime-justice/step-handlers.ts` | Stage 2c: `sentence_npc` → `classify<Verdict>('verdict', { agentContext: { id: owner.profile.id } })` |
| `packages/engine/src/{volition,il,reflection,memory}.ts` | Stage 2: migrated call-sites to façade (`classify/generate/generateStream/embed`) |
| `tools/poc/` | **NEW directory Stage 8e**. 5 PoC скриптов перенесены из `packages/server/src/`: `poc-claude-code.ts`, `poc-memory-realtime.ts`, `poc-verdict-claude.ts`, `poc-persistent-ipc.ts`, `poc-usage-tracking.ts` + `README.md` |
| `tests/llm-usage.test.ts` | **NEW Stage 6c**. 18 unit-тестов: tracker persistence, race-condition flush, corrupt-lines, aggregation, façade emits для всех 4 примитивов, cost gate blocks/sees task+agentId/fail-open |
| `tests/llm-consolidation.test.ts` | **NEW Stage 8a**. 11 unit-тестов: consolidation trigger threshold, no-op below threshold, LLM null → no data loss, FIFO order, reflections append не overwrite, header preserved, edge cases |
| `tests/architecture.test.ts` | Stage 8b: добавлены тесты «`acquire()` ONLY в llm-client.ts/llm-semaphore.ts» и «internal `_-prefixed` helpers used ONLY в llm-client.ts» |
| `tests/fixtures/fake-llm-provider.ts` | NEW (Stage 2i). FakeLlmProvider implements LlmProvider с детерминированным hash-vector embed'ом + schema-based default JSON для structured output. `setupFakeLlm()` helper для test bootstrap |

**Реальный blast radius**: engine (10 файлов: 4 NEW + 6 правок), modules (2 файла: step-handlers + crime-justice/index), server (2 файла: index + новый llm-defaults), providers (4 файла, всё NEW), 9 тест-файлов (1 NEW + 8 правок helper'ов и beforeAll), 1 правка root package.json. **Итого ~28 файлов** (аудитор был прав — больше изначальных 20).

Ноль изменений в: world.ts, routes.ts, ws.ts, world-loader.ts,
goals.ts, cg-engine.ts, beliefs.ts, evidence.ts, scheduler.ts, perception.ts,
interaction.ts, conversation.ts, journal.ts, crime-scene.ts, JSON-данных мира.

---

## Что разблокируется

### Сразу при реализации

- **Сменить модель** = одна правка в `worldConfig.llm.routes.<task>.model`. Без кода.
- **Использовать клауд-API для тяжёлых задач**: например, `verdict` → Anthropic Sonnet 4.5, остальное — на локальном qwen.
- **Тестовая среда**: `FakeLlmProvider` с детерминированными ответами для unit-тестов. Текущие тесты, которые сейчас требуют LM Studio в фоне, становятся offline.
- **Разделение токен-бюджетов** по задачам: dev может поставить разные `maxTokens` для `dialogue` и `reflection` без правки кода.

### При добавлении модулей Phase 3

- **Economy/Politics** добавляют свои task'и (`'trade-judgment'`, `'political-claim'`) — расширение enum'а `LlmTask` + регистрация маршрута. Провайдеры не трогаем.
- **Trauma Layer**: специальный task `'personality-shift'` с высокой temperature для эмерджентного результата, может уходить на отдельную модель.

### При Phase 4 (Hot/Warm/Cold)

- Cold-NPC processing → task `'cold-mood'` → cheap embeddings-only классификация
- Hot-NPC dialogue → task `'dialogue'` → топовая модель
- Маршрутизация описывает scaling-стратегию декларативно, без переписывания engine.

### При мультиплеере

- Каждый игрок может получить свой роутер (или общий) — модель класса «judge» обслуживает финальный verdict для всех, легковесные задачи — свои.

---

## Принципы

| Принцип | Соблюдение |
|---|---|
| **INV-01 LLM semaphore в finally** | Архитектурно enforced: публичного `acquire` нет, finally — внутри façade. Архитектурный тест переезжает с поиска `acquire+finally` на проверку, что `acquire()` живёт ТОЛЬКО внутри `llm-client.ts`. |
| **INV-14 Engine/module boundary** | Engine не знает ни одного конкретного провайдера. `LLM_PROVIDERS` — пустой реестр, заполняется на boot. Test: «engine boot без registerLlmProvider → понятная ошибка при первом call'е». |
| **INV-15 No hardcoded fallback strings** | URL'ы и model id уезжают в роут (worldConfig). Engine не содержит ни одной строки с провайдер-id или endpoint'ом. Архитектурный тест: «никакой `.ts` в engine/modules не содержит литерал `'localhost:1234'`, `'http://api.'`, или известных model id». |
| **Принцип 1 Structured data** | `classify<T>` принимает типизированную схему, возвращает типизированный объект. Никакого `response.includes()`. |
| **Принцип 2 Universal laws / data fills** | Провайдеры — это «данные» в реестре, ровно как `AFFORDANCE_REGISTRY`. Регистрация — на boot, как у модулей. Economy Module Test расширяется до «Anthropic Provider Test»: добавить провайдер без правки engine — должно работать. |
| **No double standards** | Эмбеддинги ходят через тот же реестр, что и chat. Прекращается параллельная карта в `VectorMemory.constructor`. |
| **Bilateral** | Не релевантно — LLM-слой ниже уровня Agent/Player различия. |

---

## Тесты

### `tests/llm-registry.test.ts` (new)

```typescript
// 1. Регистрация: registerLlmProvider добавляет в реестр, повторный — реплейсит со вызовом dispose
// 2. Регистрация task'а: registerLlmTask('foo', { requiresStreaming: true }) добавляет в LLM_TASKS
// 3. Семафор per-provider: два провайдера, по одному запросу в каждом — оба активны одновременно
// 4. Семафор очередь: maxConcurrency=1, две одновременные задачи — вторая ждёт
// 5. Router: _resolveRoute('volition') возвращает route из routes, fallback на default
// 6. validateLlmRouterContract: ошибка, если route ссылается на несуществующего провайдера
// 7. validateLlmRouterContract: ошибка, если embeddings task → provider с embeddings=false
// 8. validateLlmRouterContract: ошибка, если streaming task → provider с streaming=false
// 9. validateLlmRouterContract: warn (не error), если structuredOutput task → provider с structuredOutput='none'
// 10. Capability adapter: FakeProvider с structuredOutput='tool_use', jsonSchema → tool_use round-trip
// 11. Capability adapter: structuredOutput='none' + callWithSchemaRetry → soft retry парсинг
// 12. Fallback chain: primary бросает → fallback используется → возвращён корректный ответ
// 13. Exception → null contract: provider.call() throws → classify() возвращает null (не throws)
// 14. Exception → null contract: provider.embed() throws → embed() возвращает null
// 15. Per-NPC sampling override: classify(task, { samplingOverride: { temperature: 0.5 } }) — провайдер видит 0.5, не route default
// 16. INV-01 architectural: ни один файл в engine/ кроме llm-client.ts не вызывает .acquire()
// 17. Engine internals not exported: import { _getLlmProvider } from '@clwa/engine' → undefined
// 18. dispose: registerLlmProvider с тем же id вызывает dispose старого
```

### `tests/architecture.test.ts` — добавления

```typescript
// 1. «Engine провайдер-агностичен»:
//    нет fetch('http://localhost:1234'), нет 'qwen3.5-…', нет 'claude-…', нет хардкода API endpoint
// 2. «acquire() только в llm-client.ts»: подсчёт acquire/release в других файлах = 0
// 3. «WorldConfig не использует deprecated поля» (warn-only, не блокирующий)
```

### `tests/boot-smoke.test.ts` — расширение

```typescript
// 1. Boot с пустым LLM_PROVIDERS + первый llmCall → понятная ошибка с указанием task
// 2. Boot со старым WorldConfig (только lmStudioUrl/model) → migrateLegacyWorldConfig срабатывает, warn в логе
// 3. Boot с новым WorldConfig.llm → используется новый роутер
```

### `tests/regression.test.ts` — расширение

```typescript
// 1. E2E chain (kill → witness → wanted → arrest → sentence) работает с FakeLlmProvider — то же самое поведение
// 2. Save/load round-trip с FakeLlmProvider — память восстанавливается, embeddings re-вычисляются
// 3. Verdict с разными провайдерами (LM Studio vs Anthropic-tool_use vs Fake) даёт структурно валидный JSON
```

---

## Когда реализовать

### Стадия 0 — спека (этот документ) ✅

### Стадия 1 — Уровень 1 + миграция

День 1–2:
1. `llm-types.ts`, `llm-semaphore.ts`, `llm-registry.ts`, `llm-json-utils.ts` — новые файлы
2. `LMStudioProvider` в `packages/providers/lm-studio/` — точная копия текущего поведения
3. `llm-client.ts` REWRITE с deprecated shim'ом
4. `server/src/index.ts` — регистрация LMStudio, создание роутера: `worldData.config.llm ?? migrateLegacyWorldConfig(worldData.config) ?? buildDefaultRouter()`. Регистрация модулей (которые вызывают `registerLlmTask`).
5. `tests/llm-registry.test.ts` зелёный, `tests/architecture.test.ts` зелёный, `bun test` ровно — ноль регрессий

### Стадия 2 — миграция 7 call-sites

День 3:
1. `volition.ts`, `il.ts`, `agent.ts`, `reflection.ts`, `step-handlers.ts`, `memory.ts` — переход с `llmCall` на семантические примитивы
2. Удаление `lmStudioUrl`/`model`/`embeddingModel` параметров из конструкторов `Agent` и `VectorMemory`
3. Удаление deprecated shim `llmCall`/`llmStream` из `llm-client.ts`
4. `bun test` зелёный

### Стадия 3 — Production wiring (НЕ AnthropicProvider — этот путь отвергнут)

> **Историческое примечание:** изначально Stage 3 планировался как добавление `AnthropicProvider`
> через paid API (Anthropic Messages API + tool_use адаптер). По решению пользователя этот путь
> **полностью убран** из плана — CLWA остаётся на subscription через `ClaudeCodeProvider` (`claude -p` CLI).
> Файл `packages/providers/anthropic/` НЕ создавался.

Фактическая Стадия 3 (см. progress log выше): production wiring `ClaudeCodeProvider` → `verdict` route, `Agent.onObserve` hook → file memory append, end-to-end verdict scenario через Theron magistrate. Detail в Stage 3a/3b/3c.

### Стадия 4 — cleanup (отдельный PR, можно отложить)

После недели/двух работы с новой системой:
1. Удалить `@deprecated` поля из `WorldConfig`
2. Удалить `migrateLegacyWorldConfig` из `server/src/llm-defaults.ts`
3. Обновить `clwa/overview` Serena memory: убрать ссылки на `lmStudioUrl`/`model` из конфигов мира

### Почему все три уровня сразу

- Уровень 1 без Уровня 3 = call-sites остаются с 7-полевыми вызовами и собственными temp'ами. Архитектурно не закрывает проблему «семь параллельных карт».
- Уровень 2 без Уровня 1 = некуда регистрировать адаптеры.
- Уровень 3 без Уровня 1 = некуда роутить.
- Поэтапная реализация (1→2→3) внутри одного спецификационного скоупа даёт **проверяемые промежуточные состояния** (зелёные тесты после Стадии 1, потом после Стадии 2), без необходимости держать всё в голове.

### Почему сейчас, а не в M4/M5

- В M3 cемь call-sites устаканились. Менять их сейчас — каждый поправляется один раз. Через M4 их станет 10–12 (Trauma + Economy задачи), миграция дороже.
- Эта работа разблокирует **выбор модели по задаче** — это прямое требование для будущей оценки качества verdict (надо ли держать локальную модель или гнать verdict в клауд за качеством). Откладывание = откладывание ответа на этот продуктовый вопрос.
- Анти-аргумент «спекулятивная абстракция» здесь слаб: нарушение INV-14/15 уже зафиксировано, второй провайдер (Anthropic) — конкретная цель, не «вдруг понадобится».

---

## Audit log (revision 2)

Аудитор `clwa-auditor` прошёл по спеке revision 1 и выдал 3 блокера + 3 обязательных
дополнения + 2 документальных. Все 8 применены в revision 2:

| # | TYPE | Что | Где было | Как исправлено в r2 |
|---|---|---|---|---|
| 1 | BUG | `LlmProvider` interface не имел `model` в request, провайдеры принимали вторым аргументом — TS не скомпилирует `implements` | `LlmProvider`/`LMStudioProvider`/`AnthropicProvider` сигнатуры | `model: string` добавлен в `LlmCallRequest`/`LlmStreamRequest`/`LlmEmbedRequest`. Провайдеры читают `req.model`. Facade передаёт `route.model` в req. |
| 2 | VIOLATION | Closed enum `LlmTask` нарушал Economy Module Test (INV-14) | `type LlmTask = 'volition' \| ...` | `type LlmTask = string` + `registerLlmTask(name, requirements)`. Engine регистрирует только `'embeddings'`. Доменные task'и регистрируют модули. |
| 3 | VIOLATION | `migrateLegacyWorldConfig` содержал `'qwen3.5-9b-abliterated'` в engine (INV-15) | `engine/src/llm-registry.ts` | Хелперы `buildDefaultRouter` и `migrateLegacyWorldConfig` уехали в `packages/server/src/llm-defaults.ts`. Engine не знает ни одной строки модели. |
| 4 | REGRESSION | Миграция call-sites теряла per-NPC `LlmPersonality` (8 NPC с custom `"llm"` в JSON) | Таблица миграции agent.ts | Документировано: `Agent.chat`/`chatStream`/`generateResponse` передают `samplingOverride: { temperature: this.llmConfig.temperature }` + `maxTokensOverride`. NPC JSON не меняются. |
| 5 | DEBT | `validateLlmRouterContract` не проверял streaming capability — `dialogue → Anthropic` (stream=TODO) даст runtime crash | `validateLlmRouterContract` | Добавлено: `requiresStreaming`/`requiresStructuredOutput` в `LlmTaskRequirements`. Validator проверяет capability против задекларированных требований. |
| 6 | DEBT | Facade `classify/generate/embed` бросали exception вместо `T \| null` контракта | `llm-client.ts` тело примитивов | Каждый примитив обёрнут в try/catch вокруг `provider.call/stream/embed`. Любая ошибка → `null` (или `'...'` для stream). Логируется. |
| 7 | DEBT | Blast radius занижен (заявлено ~20 файлов, по факту ~28: 7 тест-файлов + agent-types) | Таблица файлов | Таблица расширена: добавлены 7 test-файлов с helper boot, `agent-types.ts`, `crime-justice/index.ts` (registerLlmTask), `server/llm-defaults.ts` (NEW), NPC JSON (no-change documented). |
| 8 | DEBT | `getLlmProvider`/`getLlmSemaphore` экспортировались — call-site мог обойти façade | engine `index.ts` re-exports | Переименованы в `_getLlmProvider`/`_getLlmSemaphore` (внутренний контракт). `engine/src/index.ts` re-exports НЕ включают их. Архитектурный тест проверяет, что `acquire()` живёт только в `llm-client.ts`. |

**Спека готова к реализации.** Stage 1 → 2 → 3 → 4 как описано выше.
