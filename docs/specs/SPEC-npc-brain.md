# SPEC: NPC Brain — maximize roleplay quality via layered prompts + context engineering + model routing

> **Milestone**: M6 (NPC Brain — roleplay quality; LLM + context tuning). Follows M5 (Engine Generalization).
> **Status**: ✅ **CLOSED (2026-05-30, v0.17.0)** — **P0–P5 all ✅** on `feature/npc-brain` (tsc 0, bun test 280, final clwa-auditor:
>   no MUST-FIX, INV-14 PERFECT, quality A-). Both auditor SHOULD/NICE fixes applied (history-summary task registered;
>   dup JSDoc removed). Harness final (JUDGE_RUNS=3): layered dialogue uplift **mean +2.0**, grounding n→Y in 5/6 cells,
>   Qwen meta-deflect 1.0→5.0; report `docs/workflow/npc-brain-final/2026-05-30/`. Pending: live walkthrough + merge to master.
>   Plus: real-time **chat-staleness TTL** (replaced clear-on-NPC-switch; default 5 min, `WorldConfig.chatStaleMs`) — auditor CLEAN, 8 unit tests.
>   Branch `feature/npc-brain` (not pushed). clwa-auditor reviewed the plan (verdict: safe as-phased, 0 design violations);
>   all 10 amendments folded in (dual-path building blocks, CLAUDE.local.md volatile-out, unified getTopBeliefs,
>   judge methodology, LM-Studio cache empirical check, history-summary task + warm-session reset, server-side
>   persona builder, reflection-mechanism split, IL trade-category registry, INV-21 field defaults).
> **Branch (planned)**: `feature/npc-brain` (off `master`).
> **Depends on**: M5 (genre-neutral engine + B1/B2/B3), observability landed (timestamps + `[Chat]`/`[NPC↔NPC]`/`[LLM]` logs).
> **Source of truth**: `docs/workflow/npc-brain-research/2026-05-29-219fc2b1/` (5-site context audit + 4 best-practice
>   threads, 9 agents) and `docs/workflow/map-logging-and-dialogue/2026-05-29-36b69108/` (prompt/flow map).
> **Created**: 2026-05-29

---

## Цель

Поднять качество отыгрыша и «интеллекта» NPC до максимума, достижимого без fine-tuning, через **слоёную
архитектуру промпта** + **инженерию контекста** + **осознанный роутинг моделей**, и сделать всё это **управляемым из
World Editor** (данные, не хардкод). Параллельно — **харнесс сравнения 3 моделей** (Qwen / Haiku / Sonnet) в
одинаковых условиях, чтобы решения принимались по данным, а не на глаз.

## Главные инварианты этой работы (success criteria)

1. **Нулевая поведенческая регрессия** crime-игры — она регресс-оракул (как и в Living Millhaven). Сравнение
   до/после на одинаковых сценариях обязано показать «не хуже».
2. **Движок остаётся genre-neutral (INV-14)**: общий guardrail-каркас в движке содержит ТОЛЬКО универсальные
   правила (не-AI, краткость, граница знаний, язык, действия-не-нарратив). Вся crime-специфичная проза остаётся в
   модуле (`registerRoleDirectiveBuilder` / secret-builders / heat) — её не трогаем по смыслу, только по форме.
3. **Bilateral (INV-16)**: изменения в сборке контекста одинаково работают для NPC и игрока, где это применимо.
4. **Единый источник правды на факт**: устранить дубль «прозовая персона (`buildSystemPrompt`) vs числовая
   (`CLAUDE.local.md`)»; ни один факт не должен жить в двух местах с риском конфликта.
5. **Никакого платного Anthropic API** — только claude-code (подписка) + локальный LM Studio.
6. **Всё настраиваемое — в World Editor, на регистрах/данных, без хардкод-списков.** No-op тумблеры отключены.

## Архитектурное решение (утверждено): слоёный промпт

Три слоя с чётким разделением «стабильное → кэш» / «волатильное → каждый вызов»:

```
┌ LAYER 1 — SHARED SCAFFOLD (универсальный, байт-стабильный, кэшируемый, engine-side, genre-neutral)
│   guardrails: только-речь / не-нарратив-в-тексте · не ломать характер · никогда не «я AI» ·
│   отвечай на языке игрока · ТОЛЬКО известные факты, не знаешь — скажи «не знаю», не выдумывай имён ·
│   краткость (зеркаль регистр собеседника) · действия описываем поведением, не отрицаниями.
│   Смягчённый тон (без ALL-CAPS «CRITICAL» — Claude 4.5/4.6 пере-триггерятся).
├ LAYER 2 — PER-NPC PERSONA (из world JSON, стабильная на NPC, тоже кэшируемая в префиксе)
│   плотно: имя/роль/фон/ценности · речь + 3-5 few-shot реплик (ротация) · черты СЛОВАМИ
│   (градации и для середины 0.3-0.7) · Эннеаграмма (страх/желание). ОДНО представление.
└ LAYER 3 — VOLATILE STATE (в USER-тёрне, обновляется каждый вызов; НЕ ломает кэш префикса)
    настроение (+ mood-biased recall) · топ-5..8 беливов (свежесть+релевантность, по возрастанию) ·
    воспоминания · сцена/собеседник (атрибутированная речь «Игрок говорит: …») · активная директива.
    Самое важное правило — ПОСЛЕДНЕЙ строкой (U-кривая / instruction attenuation).
```

**Портируемый промпт**: пишем под потолок Qwen (короткий, явный, с примером, schema-pinned, reason-перед-ответом,
правило в конце) — он же корректно работает на Haiku/Sonnet. Обратное не выполняется.

**Роутинг по типу задачи**: структурные/чёткие (`volition`, `il`, `verdict`) → **Haiku** (не хуже Sonnet, дешевле);
открытые/голосовые (`dialogue`, `reflection`) → **Sonnet**; горячие/массовые (`volition`, `il`, `embeddings`) могут
оставаться на локальном Qwen. Точные назначения — по данным харнесса (Phase 0/5).

### Dual-path сборка (КРИТИЧНО — по аудиту P2/P3/P4)

Сейчас два маршрута дают NPC контекст РАЗНО: lm-studio → `engine/agent.ts buildSystemPrompt` (system) ;
claude-code → ТО ЖЕ `buildSystemPrompt` (как `--system-prompt`) ПЛЮС авто-загрузка `CLAUDE.local.md` из cwd
(`server/llm-npc-prompt-builder.ts`) с volatile `@memory/*.md` import'ами. Двойной/расходящийся контекст.

**Решение — три переиспользуемых кирпича, оба маршрута собирают из них:**
- `buildSharedScaffold()` → **Layer 1** (engine, genre-neutral, байт-стабильный).
- `buildPersonaBlock(agent)` → **Layer 2** (стабильная персона; **единый билдер живёт в server**, не в engine —
  иначе capability→проза маппинги станут module-vocabulary в движке = INV-14. Engine отдаёт только данные
  AgentProfile/beliefs/relationships; server/модуль форматируют прозу через `registerRoleDirectiveBuilder`).
- `buildVolatileContext(agent, query)` → **Layer 3** (волатильное, каждый вызов).

Раскладка по маршрутам (ОДИН источник на факт):
- **lm-studio**: `system = L1 + L2`, `user = L3 + сообщение`.
- **claude-code**: `CLAUDE.local.md = ТОЛЬКО L2` (стабильная персона) ; `--system-prompt = L1` ; `stdin user = L3 +
  сообщение`. **Volatile `@memory/*.md` import'ы (current-state/relationships/beliefs) ВЫНОСЯТСЯ из `CLAUDE.local.md`
  в user-тёрн** — иначе они входят в кэшируемый префикс и ломают prompt-cache на cold-spawn (12.5× дороже).

**Единое ранжирование беливов**: `BeliefManager.getTopBeliefs(k, {recency, relevance, topic})` — ОДНА функция,
вызываемая обоими путями (сейчас расходятся: `serializeMemoryState` сортирует по confidence×recency top-30, а
`summarizeForPrompt` берёт без сортировки slice(3) — разные топ-беливы в зависимости от провайдера).

### Локализация (решение пользователя — first-class)

Язык — **настройка игры** (`config.language`, сейчас `en | ru`, расширяемо). Промпт собирается на выбранном языке;
переводим контент по мере необходимости. Эмпирика baseline: при английских промптах Qwen **срывается с языка**
(украинский/английский вместо русского) — поэтому язык должен быть явным, а не «угадай по сообщению игрока».
- **L1-каркас + языковое правило + few-shot — на целевом языке** (локализованы per-language; правило «отвечай
  только на <язык>» в КОНЦЕ user-тёрна). Прототип v2 (`tools/npc-brain/fixtures-layered.ts`) подтверждает: русские
  few-shot вместо английских убирают language-drift (v1 с английскими few-shot уводил ответы в английский).
- **L2 персона** (background/speech/secret) — авторится на базовом языке, переводится при необходимости (меньше
  немедленных правок контента). Допустимо смешение: английская проза персоны + локализованный каркас/few-shot.
- **World Editor**: поле `language` + локализованные строки каркаса/few-shot редактируемы (Phase 4).
- Engine остаётся genre/locale-neutral: каркас-строки приходят как данные (WorldConfig), не хардкод (INV-14 + INV-21 дефолт).

---

## Фазы (каждая: tsc 0 + `bun test` зелёный + игра запускаема; коммит по фазе)

### Phase 0 — Comparison harness + baseline ✅ DONE (harness a4ee28e · baseline 08a9d22)
- Свести существующие bench-инструменты (`tools/bench-*`) в один **harness**: фикстуры одинаковых сценариев на ВСЕ
  6 задач (`volition`, `il`, `verdict`, `reflection`, `dialogue`, `npc-dialogue`) из реальных ситуаций Millhaven
  (Элару спрашивают о Гаррете; кража при свидетеле; обвинение со слабой уликой; рефлексия после события; NPC↔NPC о
  слухе). По несколько сценариев: лёгкий / неоднозначный / адверсариальный.
- Матрица: Qwen × Haiku × Sonnet. Держать константой: embedding-модель, json_schema (strict), inline-пример, порядок
  полей, обрезанный контекст. Варьировать ТОЛЬКО LLM.
- Метрики: **главная — качество решения/отыгрыша** (LLM-as-judge рубрика: в характере? заземлён на данные факты?
  верное действие/вердикт? верный отказ vs over-conservatism?); вторичные — токены in/out, costUsd, latencyMs (уже в
  `LlmUsageEvent` + консольный `[LLM]`), schema-pass-rate + retry-count.
- **LLM-judge методология (по аудиту P5 — иначе шум >20%)**: судья — **НЕ Sonnet** (он участник; self-preference);
  брать Haiku (дешёвый, не участник большинства задач) или Opus через подписку. Pairwise с **рандомизацией позиции +
  double-pass (AB и BA)**, расхождение → tie. **≥3 прогона** на сценарий; дивергенция >25% → рубрика нечёткая,
  пересмотреть. **10 моих hand-labeled примеров** как калибровочный якорь.
- **Prompt-cache эмпирическая проверка (по аудиту P1)**: 10 идентичных запросов к LM Studio, сравнить prompt-eval
  time req1 vs req10 — одинаково ⇒ KV-cache для Qwen3.5 в LM Studio НЕ работает (известная проблема hybrid-моделей);
  тогда байт-стабильность префикса оставляем как code-discipline, но НЕ оптимизируем ROI под несуществующий кэш. Для
  claude-code кэш реален (server-side по content-hash, min ~1024 токена, TTL 5 мин).
- **Зафиксировать baseline** текущих промптов (это и регресс-оракул для последующих фаз).
- *Verify*: отчёт-таблица по задачам × моделям; харнесс воспроизводим (фикстуры в репо).

### Phase 1 — Layered prompt на `dialogue` ✅ DONE (1583ad2 + ddfe7b6 · auditor fixes 2d2f8fa)
- Ввести три кирпича `buildSharedScaffold()` / `buildPersonaBlock(agent)` / `buildVolatileContext(agent, query)`
  (см. «Dual-path сборка»); собрать оба маршрута из них. `buildSystemPrompt` становится тонкой обёрткой над L1+L2.
- **Унифицировать две персоны**: единый `buildPersonaBlock` (server-side) → один источник; убрать конфликт
  прозовая/числовая `CLAUDE.local.md`; honesty/черты — единообразно, с градациями для середины 0.3-0.7.
- **Реструктурировать `CLAUDE.local.md`** (claude-code path): убрать volatile `@memory/current-state.md /
  relationships.md / beliefs.md` из персона-файла (он = только L2 стабильная персона); volatile state передавать в
  stdin user-тёрне (правка `ClaudeCodeProvider` + `NpcMemoryManager`). Иначе кэш на cold-spawn бесполезен (P3).
- Few-shot: 3-5 in-voice примеров (ротация `speechReminder`, не сырые copyable-строки), вкл. edge-cases (уход от
  мета-вопроса, враждебность, молчание). Author-framing + атрибутированная речь игрока.
- Смягчить ALL-CAPS; добавить universal knowledge-boundary в Layer 1.
- **Backward-compat (INV-21)**: новое поле `fewShotExamples?: string[]` в AgentProfile — дефолт `?? []` в
  world-loader и loadState; старые save.json не должны падать.
- *Verify*: прогон харнесса `dialogue` vs baseline (3 модели) — качество ↑, регрессии нет; prompt-cache префикс
  стабилен на claude-code (проверить `cacheReadTokens` растёт, `cacheCreationTokens` не на каждый вызов).
- **Прототип измерен** (`fixtures-layered.ts` v2, Qwen RUNS=3): локализованный каркас+few-shot **починил
  language-drift** (baseline сваливался в украинский) и дал **+0.7** на обоих сценариях. Уроки для порта: (a) few-shot
  ДОЛЖНЫ ротироваться (v2 скопировал пример дословно) — использовать `speechReminder`-ротацию; (b) Qwen даже с
  лучшим промптом упирается в ~2.0 на grounded free-text диалоге → **`dialogue` роутится на Claude** (Haiku/Sonnet
  4-5 на baseline), Qwen остаётся на структурных задачах; (c) одного knowledge-boundary правила Qwen'у мало против
  embellishment — для high-stakes реплик опционально name/fact post-check (deferred).

### Phase 2 — Context-assembly fixes (беливы / память / история) ✅ DONE 4/4
- **✅ Беливы** (`43b32e1`): единая `getTopBeliefs(k, {currentDay, topic, requireParticipant})` для обоих путей
  (`summarizeForPrompt` + `serializeMemoryState` — было два расходящихся ранжирования); recency-cue на строке белива;
  `getEventLabelSafe` вместо тихого null-drop; per-event фрейзинг в crime-модуле (theft→«stole from Y», kill→«killed Y»,
  attack→«attacked Y»; blanket-fallback для прочих). ⏸ дедуп `## What you know` ↔ role-директива — отложено (low-value).
- **✅ Память** (`bb6a3be`): `recall` через единый нормализованный `compositeScore` (÷10 внутри — relevance больше не
  тонет под importance) + guard на вырожденный запрос. cap оставлен 5 (баг был в нормализации, не в количестве).
  ⏸ recency по last-access — отложено (нужно новое поле `MemoryEntry` + миграция save/Qdrant).
- **✅ История диалога** (`f3945fc` окно + `4efa429` 3b): окно последних 3 строк для NPC↔NPC; `clearChatHistory()`
  при смене NPC (per-connection `currentChatAgentId` в server) + сброс warm-сессии
  (`resetAgentSessions`→`ClaudeCodeProvider.resetAgentSession`→`ClaudeSessionPool.killAgent`, exact + `agentId::` ключи);
  rolling `history-summary` (fire-and-forget при trim >12, default→Qwen, bounded, блок «Earlier in this conversation»).
  Boot-проверен (сервер стартует чисто); рантайм-поведение (сброс при смене NPC, сжатие длинного диалога) — live-прогон.
- *Verify*: харнесс `dialogue`/`npc-dialogue` ↑; unit-тесты на ранжирование/нормализацию/историю.

### Phase 3 — Propagate на остальные задачи ✅ DONE (verdict 41b88d6 · reflection+npc-dialogue 46bd948 · il 2660341)
- **`npc-dialogue`**: tight character block + ростер сущностей (нет выдуманных имён) + persona-reinject в конце;
  presence_penalty только тут/в reflection.
- **`il`**: 2-3 inline few-shot (benign→{speechAct,conf}, claim+question, threat); пример с null-полем (INV-07);
  фильтр/cap инъектируемых списков сущностей; **добавить fallback-маршрут**; reason-перед-полями; **вынести trade
  categories (`weapon/armor/potion/food/general`) в registry** (`registerILTradeCategories`) — последний хардкод-
  вокабуляр в IL (INV-14).
- **`verdict`**: reason-перед-verdict (порядок полей); показать severity-диапазоны опций; 2-3 калибровочных примера;
  нейтральные «observable demeanor» факты вместо утечки вины через тон defense; cap+ранжирование улик.
- **`reflection`**: крошечная схема/валидация + strip префиксов + non-empty перед сохранением (imp 9). **Решение по
  двум механизмам (P7): разграничить, не объединять** — `ReflectionTracker` (threshold, importance≥50) = «эпифании»
  в VectorMemory; `consolidateObservations` (периодическая) = «дневник» в `reflections.md`. Разные триггеры →
  одно событие не запускает оба; дедуп новой рефлексии против существующих в `reflections.md`.
- *Verify*: tsc 0 + 272 теста на каждом шаге (харнесс/baseline — в Phase 5, без LM Studio сейчас).
- **✅ Сделано**: verdict (reason-before-verdict + severity-диапазоны в опциях + калибровочные примеры + «вес улик > демеанора»);
  reflection (`sanitizeReflection`: strip префиксов/кавычек + non-empty перед imp 9); npc-dialogue (`presencePenalty` 0.5
  на Qwen-роуте против cross-NPC повторов; grounding уже от L1-scaffold + L3 «People you know» из Phase 1);
  il (3 genre-neutral few-shot против над-экстракции + claude-code/haiku **fallback-маршрут**).
- **⏸ Отложено**: trade-categories registry (INV-14 cleanliness, low behavioral value); il reason-поле (extraction, не decision);
  evidence cap/rank в verdict; разграничение двух механизмов рефлексии (P7); дедуп `## What you know` ↔ role-секция.

### Phase 4 — World Editor (всё управляемое, на данных)
- Редактируемые из редактора: **Layer 1 каркас** (общий текст guardrails — поле `WorldConfig`, дефолт при отсутствии
  в save/world JSON, INV-21), **Layer 2 персона** (включая few-shot примеры на NPC), **роутинг** (provider/model/
  maxTokens/temp/warm/schema/fallback — уже есть, дополнить few-shot и per-NPC sampling). Registry/данные, без
  хардкод-списков; no-op тумблеры отключены (как сделано для warm/schema).
- *Verify*: правка в редакторе → видна в промпте/поведении; save/load round-trip.
- **✅ Сделано**: L1-каркас стал `WorldConfig.scaffold` (engine `defaultScaffold(lang)` — genre-neutral дефолт при
  отсутствии, INV-21/INV-14); редактор: Language (en/ru) + Chat staleness (ms) в Simulation Parameters, карточка
  **Prompt Scaffold (L1)** (показывает engine-дефолт, load-to-edit, clear), редактор **Few-shot Voice Examples** на NPC.
  Per-NPC sampling (temp/maxTokens) и полный per-task routing уже были. `server.ts` не менялся (PUT пишет весь JSON-блоб).
  Verify: tsc 0, bun test 280, editor boots, `/api/registry` отдаёт `scaffoldDefaults`, save/load round-trip
  `config.{chatStaleMs,scaffold}` через editor API подтверждён, world.json восстановлен байт-в-байт.

### Phase 5 — Verify & close
- Полный прогон харнесса (новые промпты, 3 модели) vs Phase-0 baseline → итоговая таблица + назначения роутинга.
- `bun test` + tsc 0. **`clwa-auditor`**: INV-14 (движок genre-neutral — в каркас Layer 1 не протекла module-проза),
  INV-16 (bilateral), LLM-дисциплина. Live-walkthrough (сервер + браузер + LM Studio + claude-code).
- Persist comparison-отчёт в `docs/workflow/` (или `docs/`); обновить ROADMAP/ARCHITECTURE; закрыть спеку.
- **✅ Сделано**: харнесс JUDGE_RUNS=3 (baseline 8×3 + dialogue baseline-vs-layered) → отчёт
  `docs/workflow/npc-brain-final/2026-05-30/` (report/meta/baseline/dialogue-compare). Layered dialogue: mean **+2.0**
  (base 2.5→4.5), grounding n→Y в 5/6 ячейках, **Qwen meta-deflect 1.0→5.0** (починен слом «я ИИ»); честная оговорка —
  Qwen open-ended recall (about-garrett) остался 2.0 → подтверждает роутинг **dialogue → Haiku**. Schema-pass 100% у всех.
  Routing-назначения совпали с live `world.json`. `bun test` 280 + tsc 0. Финальный **clwa-auditor** по всей спеке:
  **0 MUST-FIX**, INV-14 PERFECT (Economy Module Test пройден), INV-16/01/21 CLEAN, A-; оба SHOULD/NICE fix'а внесены.
  ROADMAP/ARCHITECTURE обновлены. **Спека закрыта.** Остаётся: live-walkthrough игроком + merge в master.

---

## Риски и нюансы
- **Prompt-cache**: на **claude-code** кэш реален (server-side content-hash, TTL 5 мин, min ~1024 токена) — любое
  волатильное поле в system-префиксе/`CLAUDE.local.md` ломает его и поднимает costUsd → держать L1+L2 байт-стабильными,
  L3 только в user. **На lm-studio (Qwen3.5) кэш ТОЖЕ работает** — эмпирически измерено `tools/npc-brain/cache-check.ts`:
  идентичный префикс 1585 токенов, первый вызов 1178ms, последующие ~150ms (ratio 0.13). Значит байт-стабильность
  префикса — реальный рычаг на ОБОИХ маршрутах (опровергает опасение аудитора P1, что KV-cache для Qwen3.5 сломан).
- **INV-14**: соблазн положить crime-прозу в общий каркас. Нельзя — каркас универсален, crime-директивы остаются
  module-registered. Аудитор проверяет в Phase 5.
- **Субъективность сравнения**: LLM-as-judge может шуметь — фиксировать рубрику, несколько прогонов, держать судью
  одной моделью; вторичные метрики (токены/латентность) объективны.
- **claude-code латентность**: warm-сессии и `effort=low` для chat; не гонять Sonnet с effort=high на простых тёрнах.
- **Регрессия**: crime-флоу — оракул; харнесс ловит деградацию до мержа.

## Open / deferred
- **RoleFact full verify-loop** (draft→decompose→verify→rewrite) — дорого по вызовам; только опционально для
  high-stakes реплик, не в базовом потоке.
- **Name-hallucination post-pass** (Haiku-чек над Qwen-черновиком) — опционально, если ростер-ограничения мало.
- **LoRA fine-tuning персон** — остаётся deferred (инфраструктура готова; малый curated датасет > большой
  синтетический, по данным ресёрча).
- **Multi-act speechAct** (массив вместо одного) — кандидат, оценить после Phase 3.
