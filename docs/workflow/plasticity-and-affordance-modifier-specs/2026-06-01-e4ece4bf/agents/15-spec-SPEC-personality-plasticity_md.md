# SPEC-personality-plasticity: Personality Plasticity (the deformation physics)

> **Milestone**: M8 (Personality Plasticity) — *proposed*. ⚠️ NOTE: politics was tentatively pencilled as M8 in `SPEC-economy.md` (line 197: «политика/интриги = M8»). These two cannot both be M8 — **the ordering is the user's call**. Plasticity is engine-layer and unblocks the «Negation» world; politics is a content module on the economy substrate. Recommendation (non-binding): plasticity is a *lower-risk, foundational* engine layer that politics/Negation both want, so it could land first as M8 with politics sliding to M9 — but flag and defer the decision.
> **Status**: 📋 SPEC — not started, proposed v0.19.0
> **Depends on**: M5 B1 scalar attributes (`packages/engine/src/attributes.ts` — `ScalarAttribute`, `attributeEffective`, `decayAttribute`, `driftAttribute`, `adjustAttributeBase`) + the mood-modifier machinery (`SPEC-mood-modifiers.md`, `_computeMoodTick` in `world.ts`).
> **Created**: DATE_PLACEHOLDER
> **Source of truth**: this design workflow + `docs/CONCEPT_Negation.md` as the *breadth compass* (a brainstorm that bounds the design space — **NOT a build target**; the engine must never contain the words Negation/trauma/wound/debt).

---

## Цель

Дать движку **универсальный закон пластичности личности**: прожитый опыт — **включая собственные действия и применение способностей агента** — может **навсегда** сдвинуть базовую диспозицию агента.

Физика одна:
- **mood-модификаторы = УПРУГАЯ деформация** (springs back to baseline — затухают).
- **пластичность = ПЛАСТИЧЕСКАЯ деформация** (permanent set — сдвиг `base`).

Это **тот же** закон `effective = clamp(base + Σ затухающих модификаторов, min, max)`, который уже живёт дважды: в mood (`baseMood + Σ MoodModifier`) и в `ScalarAttribute` (`base + Σ modifiers + drift`). Personality Plasticity **не изобретает третью физику** — она маршрутизирует личность через **существующий** примитив `ScalarAttribute`.

Целевой тест успеха (его **не строим** в этой спеке, но он должен быть выразим как чистые **module-данные** поверх двух engine-слоёв — этого + `SPEC-affordance-modifier`):

- Мир «Negation»: Type I = self affordance-override + пластичная цена («кусок себя»); Type II = cross-agent/zone affordance-modifier, масштабируемый верой/сентиментом; «никто не делает оба» — правило модуля.
- Движок **никогда** не содержит слов Negation/trauma/wound/debt.

Это **engine-слой**, genre-neutral, implementation-ready с фазированием. Движок владеет **ЗАКОНОМ**; модули задают **значения** (trigger / mode / magnitude / reversibility / открытые оси).

---

## Анализ

### Текущее состояние (с file-refs)

**Что уже есть и переиспользуется (REUSE, не reinvent):**

| Примитив | Файл | Что даёт |
|---|---|---|
| `ScalarAttribute` (`base`/`min`/`max`/`modifiers`/опц. `drift`) | `packages/engine/src/attributes.ts:26-36` | носитель деформируемого скаляра |
| `attributeEffective(attr)` | `attributes.ts:54-58` | `clamp(base + Σ modifierEffective, min, max)` — закон |
| `decayAttribute(attr, dt)` | `attributes.ts:61-74` | затухание **только модификаторов** (НЕ `base`) |
| `driftAttribute(attr, dt)` | `attributes.ts:76-91` | дрейф `base` (early-return если `drift` отсутствует) |
| `createAttribute(base,min,max)` | `attributes.ts:49-51` | конструктор с clamp |
| `adjustAttributeBase(npcId,key,delta)` | `world.ts:673-681` | **легальная ПЛАСТИЧЕСКАЯ запись** `base` (lazy-create, clamp) |
| `setAttribute(npcId,key,base,min,max)` | `world.ts` | сидирование атрибута |
| `addAttributeModifier(...)` | `world.ts` | **легальная УПРУГАЯ запись** (модификатор) |
| per-tick decay+drift loop | `world.ts:589-593` (`for attr of Object.values(state.attributes) { decayAttribute; driftAttribute }`) | annealing «бесплатно» |
| save/load атрибутов | toJSON `world.ts:1890` (omit-when-empty), loadState `world.ts:1992-2004` (SL-07 NaN-defense + полная замена) | round-trip «бесплатно» |
| `registerTickPhaseHandler` | `event-registry.ts:692-698` | per-tick module hook, итерирует всех агентов |
| `registerScoringContributor` | `al.ts:437-440` (+ `clearScoringContributors` `al.ts:445`) | канал computeUtility |
| `BeliefManager.getMaxConfidenceFor(subject, matcher)` | `beliefs.ts:81-89` | seam к верованиям |
| `RelationshipGraph.getRelationship(id)?.sentiment` | `relationships.ts:64` | seam к отношениям |
| Enneagram stress/growth (`getStressGrowthDirective`) | `personality-prose.ts:46` | **уже** даёт ВРЕМЕННЫЕ поведенческие сдвиги (упругие, prose-only) |
| `onMoodChange` callback (bilateral, рулит на all-agent tick) | `world.ts:63`, `world.ts:596` | образец для `onTraitChange` |
| `onGoalAction` callback (NPC-only, на goal-execution) | `world.ts:53`, `world.ts:1242` | точка детекции «действие выполнено» (NPC) |

**Где живут traits сейчас:**
- `BigFive` — закрытый interface (6 ключей: openness/conscientiousness/extraversion/agreeableness/neuroticism/honesty), на `AgentProfile` — **статично, immutable, не сериализуется**.
- Читается в **21 файле** (verified grep, см. ниже migration) — НЕ «17 engine + 4 module». Engine: `al.ts`, `agent.ts`, `cg-engine.ts`, `il.ts`, `world.ts`, `scheduler.ts`, `topic-engine.ts`, `volition.ts`, `instinct-builder.ts`, `personality-prose.ts`. Module: `crime-justice/index.ts`, `crime-justice/step-handlers.ts`, `crime-justice/investigation.ts`, `social/topic-sources.ts`. Server: `routes.ts`, `index.ts`, `world-loader.ts`, `llm-npc-prompt-builder.ts`, `trait-randomizer.ts`, `game.js`.

**Закрытость, которую вскрыли adversarial-проверки (КРИТИЧНО):**
- `AffordanceWeight.trait` типизирован закрытым union `OceanHTrait = 'O'|'C'|'E'|'A'|'N'|'H'` (`al.ts:30,33`); `computeUtility` скорит через `TRAIT_MAP: Record<OceanHTrait, keyof BigFive>` (`al.ts:391,451`). Скорить можно только 6.
- `cg-engine.checkTrait` (`cg-engine.ts:341-346`) читает `agent.profile.bigFive` по **полному имени** (`cond.trait` = `'openness'`), а объект `bigFive` имеет **только 6 полных ключей** → `trait:'stability'` → `undefined → false`. **Утверждение «checkTrait already string-keyed, reads module axes natively» — ЛОЖНО.**
- `resistTraits` — закрытый union полных имён (`al.ts:134`).
- `boot-smoke.test.ts:317` и `:497` хардкодят `validTraits` (6 полных имён) — модуль, использующий открытую ось в CG-правиле или resistTrait, **сломает suite**.

→ **registerTraitAxis без расширения путей ПОТРЕБЛЕНИЯ — декоративен.** Это фиксируется как MUST-FIX в DD-PP-04.

### 3-pillar framing

CLWA-мир стоит на трёх столпах состояния:

| Столп | Что это | Где живёт |
|---|---|---|
| **AFFORDANCES** | что ВОЗМОЖНО | `SPEC-affordance-modifier` (`isAffordanceForbidden` + scoring) |
| **PERSONALITY** | КТО ты | **эта спека** — `trait:` оси (деформируемые) + `BigFive` seed |
| **BELIEFS** | что ты считаешь ИСТИНОЙ | `BeliefManager` |

Компас «Negation» связывает три: применение способности (affordance) **стоит куска того, кто-ты-есть** (personality plasticity); способность масштабируется верой (belief); способность меняет ВОЗМОЖНЫЕ действия ДРУГОГО агента (affordance-modifier). Эта спека реализует столп **PERSONALITY как деформируемый**, плюс чистые **швы** к двум другим столпам и к `SPEC-affordance-modifier`.

### Почему «unify physics» + «open axes»

- **Unify** удовлетворяется **переиспользованием** того же `base+Σdecaying+clamp+drift`-закона `ScalarAttribute`, а НЕ миграцией mood на `ScalarAttribute` (см. DD-PP-02 — отвергнуто). Личность присоединяется к **той же машинерии**.
- **Open axes**: OCEAN+H засеяны движком (универсальная психометрика, INV-14-clean), модули регистрируют доп. оси (`stability`, и т.п. — НЕ хардкодим `wound`/`devotion` в движке). НО открытость должна простираться через **все** consumer-пути (scoring/gating/prose), иначе она косметическая (MUST-FIX, DD-PP-04).

---

## Проектные решения

### DD-PP-01 — traits как state-backed `ScalarAttribute` в существующем `AgentState.attributes` под зарезервированным namespace `trait:<axis>`; `profile.bigFive` остаётся immutable SEED

**Решение.** Trait-оси хранятся как `state.attributes['trait:O'..'trait:H']` (и модульные — `attributes['trait:<axisKey>']`), `min=0 max=1 base=seed`. Аккумуляторы пластичности — `attributes['pp:<ruleId>']` (см. DD-PP-10 о форме). `profile.bigFive` НЕ меняется и НЕ удаляется.

**Rationale.** Снимает highest-risk (persistence gap) с **нулём нового save/load-кода**: `attributes` уже round-trip'ятся (toJSON `world.ts:1890` omit-when-empty; loadState `world.ts:1992-2004` с SL-07 NaN-defense + drift preservation), уже decay+drift в реальном tick (`world.ts:592`), уже CG-gateable (`attr` op) и scoreable. INV-21 тривиален — старые сейвы не имеют `trait:`-ключей, аксессор падает на seed.

**Rejected.** Новый bespoke блок `AgentState.personality` → требует нового `WorldSaveAgentData`-поля + новых toJSON/load-веток + новой INV-21-default-ветки + нового tick-decay-loop = четыре новых failure-поверхности без выгоды. Мутация `profile.bigFive` в рантайме — отвергнута наотрез: profile не сериализуется → тихая потеря данных при reload.

### DD-PP-02 — REUSE `ScalarAttribute` как есть; НЕ мигрировать mood на `ScalarAttribute`

**Решение.** «Unify physics» honored через переиспользование того же закона, а не через слияние `MoodModifier`/`AttributeModifier` и перенос `baseMood` в `attributes`.

**Rationale.** Миграция mood — большой деструктивный рефактор, затрагивающий калибровочную математику (`advanceMoodMath`), с риском дрейфа оракула, при идентичных и так двух копиях `modifierEffective`.

**⚠️ Корректировка adversarial-фактов (обязательна к усвоению автором):** `advanceMoodMath` (`world.ts:806`) **ПИШЕТ** `agent.state.mood` каждый tick — он side-effect-free **относительно attribute-decay**, НЕ относительно mood. Комментарий `world.ts:551-553` узко про атрибуты. Поэтому если trait-чтения внутри `_computeMoodTick` переключить на деформированный `trait()`, калибровка начнёт незаметно складывать пластичные сдвиги в кривую И оставлять их в `state.mood`. Это разрешено явной развязкой temperament/character ниже (DD-PP-09 + DD-PP-12).

**Rejected.** Слияние `MoodModifier`+`AttributeModifier` и перенос `baseMood` в `attributes` — высокий blast radius, трогает калибровку, нарушает additive-before-destructive без поведенческой выгоды.

### DD-PP-03 — единственный read-аксессор `Agent.trait(axis)`; ВСЕ bigFive-read-сайты идут через него

**Решение.** `Agent.trait(axisKey: string): number` с цепочкой фолбэка: state-ось → profile-seed → `0.5`.

**Rationale.** Убирает split-brain (часть сайтов читает frozen base, часть — деформированный). Фолбэк делает Phase 0 **byte-identical** (state ещё не засеян), так что шов приземляется и проверяется ДО появления пластичного состояния.

**⚠️ Ключевая поправка (MUST-FIX, hot-path verdict #3): единое axis-key пространство.** `bigFive` ключуется **полными** именами (`openness`), `trait:`-оси — **однобуквенными** (`trait:O`). Наивный `state.attributes['trait:'+cond.trait]` для CG даст `'trait:openness'` → промах → тихий fall-through на seed = тот самый split-brain. **Канонизируем:** одно пространство — **однобуквенные** оси для OCEAN+H, и ОДНА общая карта `TRAIT_NAME_TO_AXIS` (`'openness'→'O'`, …), используемая И `computeUtility` (уже имеет `TRAIT_MAP O→openness`, инвертируем) И `cg-engine.checkTrait`. `Agent.trait(axis)` принимает **либо** однобуквенную ось, **либо** полное имя (внутренне нормализует через карту), чтобы оба класса вызовов были безопасны. Точную трансляцию задаёт §«Open-axis registry».

**Rejected.** Per-site ad-hoc чтения `state.attributes['trait:X']` (гарантируют пропущенный сайт → тихий stale-trait баг). Getter на `AgentProfile` (profile immutable+несериализуем — не тот слой).

### DD-PP-04 — open-axis registry `registerTraitAxis`, НО закрытый `BigFive` interface остаётся; открытость ПРОТЯНУТА через ВСЕ consumer-пути

**Решение.** `registerTraitAxis(key, opts)` — открытый реестр; движок сам сеет OCEAN+H в boot. `BigFive` interface **остаётся** как типизированная seed-форма на `AgentProfile` (immutable), чтобы `keyof BigFive`-типизации (`TRAIT_MAP`, inline-тип в instinct-builder) **компилировались** (tsc-0). Модульные оси достижимы только через string-keyed `trait()` / CG `attr`-путь.

**⚠️ MUST-FIX (INV-14 verdict #1): открытость должна быть РЕАЛЬНОЙ, не косметической.** Расширить ВСЕ три consumer-пути:
1. **Scoring:** добавить `AffordanceWeight.axis?: string` (альтернатива закрытому `trait?: OceanHTrait`). `computeUtility` для `w.axis` читает `agent.trait(w.axis)`; для legacy `w.trait` — как сейчас (через `TRAIT_MAP`, но теперь тоже через `agent.trait`). Никакой ломки `keyof BigFive`.
2. **CG gating:** `cg-engine.checkTrait` редиректнуть на `agent.trait(traitName)` (нормализует полное имя → ось, читает state→seed→undefined). Так модульные оси И пластичные сдвиги видны CG-правилам.
3. **Resistance prose:** `resistTraits` сохраняет типизированный union для OCEAN, **плюс** открытый escape-hatch `axis?: string` (instinct-builder.ts:205 уже берёт `resistTraits` обобщённо — передаём axis-reader вместо struct).

Без всех трёх `registerTraitAxis` декоративен — `'stability'`/`'wound'`/`'devotion'`-ось недостижима системами, ради которых traits существуют (это и есть весь смысл Negation-мира).

**⚠️ SHOULD-FIX (INV-14 verdict #2): boot-smoke тесты.** В фазе P0 заменить хардкод `validTraits` в `boot-smoke.test.ts:317` и `:497` на множество из реестра: `new Set(getTraitAxes().flatMap(a => [a.key, AXIS_TO_TRAIT_NAME[a.key]].filter(Boolean)))`. Иначе первый же модуль, **использующий** открытую ось, валит suite (нарушение quality-bar «bun test green»).

**Документируемая асимметрия (NICE, INV-14 verdict #4).** В отличие от `INTENT_KINDS`/event-categories (полностью module-seeded), trait-axis-реестр **engine-seeded** для OCEAN+H — потому что `computeUtility`/`personality-prose`/`baseMood`/loneliness/stress суть engine-resident потребители именно этих 6. Перенос seed в модуль осиротил бы их. Асимметрия **намеренная**.

**Rejected.** Замена `BigFive` на полностью открытый `Record<string,number>` на profile — ломает каждый типизированный аксессор, форсирует unsafe-касты, теряет compile-time-safety на OCEAN+H-ядре без функциональной выгоды.

### DD-PP-05 — reversibility/annealing через существующее поле `ScalarAttribute.drift`; отсутствие drift = irreversible (default)

**Решение.** `anneal?: { ratePerMinute; toward }` пишется на `drift` оси при первом сдвиге. `driftAttribute` (`attributes.ts:76`) уже бежит каждый real-tick для каждого атрибута → annealing с НУЛЁМ нового tick-кода. Отсутствие `anneal` = нет drift = **необратимо** (locked default).

**⚠️ SHOULD-FIX (mood verdict #3): `anneal` — свойство ОСИ, не сдвига.** `drift` — единственное поле на атрибут (`attributes.ts:31-36`), `driftAttribute` применяет его безусловно. Два пластичных сдвига одной оси с разными `anneal.toward` тихо перезатрут/скомпаундят друг друга (undefined). **Правило:** `anneal` задаётся ОДИН раз — в `registerTraitAxis(key, { anneal })` ИЛИ при первом сдвиге, и далее иммутабелен для оси. `applyPlasticShift(..., anneal?)` пишет drift **только если оси ещё не задан drift**; повторный `anneal` с другим `toward` → лог-warning + ignore (документированный last-wins-at-axis-level, не silent compound). Per-shift расхождение `anneal` запрещено.

**⚠️ NICE (composition verdict #11): `anneal` ВСЕГДА exponential-toward.** `driftAttribute` имеет две ветки: `toward===undefined` → линейный дрейф `base += rate*dt` (монотонно к clamp!); `toward` set → exp-приближение к `toward` (`Math.abs(rate)`). `applyPlasticShift` при записи `anneal` **ВСЕГДА** ставит `drift.toward` (никогда линейную ветку), `ratePerMinute` передаётся как есть (abs применяется внутри `driftAttribute`). Гарантия: annealing сходится к `toward`, не уезжает к clamp.

**Rejected.** Отдельный anneal-scheduler/loop (дублирует `driftAttribute`, риск double-decay/неверного dt).

### DD-PP-06 — `PlasticityRule` = module-данные; движок поставляет ОДИН evaluator; три шва — тонкие обёртки над существующими примитивами

**Решение.** `PlasticityRule` регистрируется модулем. Движок ставит ОДИН module-agnostic evaluator. Три шва (ability-use, beliefs, relationships) — тонкие обёртки в `PlasticityTriggerCtx`. `selfBeliefConfidence` оборачивает `getMaxConfidenceFor(self,...)`; `sentimentTo` оборачивает `getRelationship(id)?.sentiment ?? 0`. INV-14 сохранён: self-id и matchers поставляет модуль, движок их не перечисляет.

**⚠️ MUST-FIX (hot-path verdict #2 + composition #1/#2): «no new plumbing» — ЛОЖНО, нужна явная точка эмиссии/потребления событий.** `TickPhaseContext` (`event-registry.ts:670-690`, verified) НЕ имеет per-tick списка событий — только `eventStore` (вся история, unbounded) и `approaches` (output-буфер). `WorldEvent` не имеет `gameMinute`, `EventQuery` — day-resolution. Поэтому evaluator НЕ может «видеть ability-use события без нового plumbing».

**Решение шва (две части, обе обязательны):**
- **(a) Событийный/decisive-trigger путь** — ввести ОДИН engine-хук на ВЫПОЛНЕНИИ действия: `World.onActionExecuted(actorId, affordanceId, target?, usedOverrideId?)`, эмитируемый в NPC-goal-execution пути (рядом с `onGoalAction`, `world.ts:1242`) **И** в player-action пути (см. bilateral §). PP-evaluator подписывается на **этот** хук (не на воображаемый tick-stream). `when.eventType`/`when.abilityUse` матчатся payload'ом хука.
- **(b) Tick-driven decay/anneal** — едет на существующих `decayAttribute`/`driftAttribute` (`world.ts:592`), т.к. и аккумулятор, и ось — `ScalarAttribute`. dt=5 наследуется → нет mis-scaling.

Это разносит «decisive threshold/event» (на хуке выполнения) и «накопительную эрозию/затухание» (на tick). PP **не блокирует** на `SPEC-affordance-modifier`: тот эмитит обычный хук, PP матчит строкой.

**Rejected.** Хардкод belief/sentiment-scaling внутри evaluator (запёк бы module-словарь в движок). Новый выделенный plasticity-tick-loop (существующий хук выполнения + tick-decay уже дают всё). Re-scan `eventStore` каждый tick (O(agents×events), unbounded).

### DD-PP-07 — пластичные сдвиги используют RAW sentiment (не `sentimentCurve`); self-belief subject = `agent.profile.id`, поставляемый обёрткой, не hardcoded eventType-set

**Решение.** `sentimentTo` читает **сырой** `getRelationship(id)?.sentiment ?? 0` (диапазон `[-1,1]`), НЕ `sentimentCurve` (несёт crime-tuned нелинейные пороги). Self-belief subject = `agent.profile.id`, передаётся обёрткой; matcher (какие eventTypes self-relevant) — module-supplied.

**⚠️ MUST-FIX (hot-path verdict #1 + composition #6): belief-floor 0.1 НЕ существует на read-пути.** `getMaxConfidenceFor` (`beliefs.ts:81-89`, verified) возвращает **0** при отсутствии совпадающего belief. `Math.max(0.1, …)` живёт в `decayBeliefs` (`beliefs.ts:~115`) и флорит только УЖЕ существующий belief при day-decay. Поэтому **чисто мультипликативный** `magnitudeScale`, читающий веру, при отсутствии веры даёт **0-множитель** → правило тихо ничего не делает (мёртвое правило — реальный footgun).

**Правило API:** `magnitudeScale` по умолчанию `1.0`; вклад веры/сентимента — **аддитивный бонус над базой**, не множитель-с-нуля. Каноническая форма множителя в доке шва: `scale = 1 + weightBelief*selfBeliefConfidence(...) + weightRel*max(0, sentimentTo(target))` (модуль волен иначе, но дока ПРЕДУПРЕЖДАЕТ: pure-multiplicative-from-belief = dead rule). Также документировать subject-семантику (composition #6): `getMaxConfidenceFor` ключуется по **subject** (кто СУБЪЕКТ веры — «верования, где субъектом назначен self»), не по holder. Переименовать prose обоих швов из «self-belief» в «confidence of beliefs the bearer holds whose SUBJECT the module designates as self».

**Self-directed триггеры** не имеют relationship-строки (`getRelationship(self)→null`) → фолбэк на self-belief (Seam B). Strangers (нет строки) → `sentimentTo→0`, модуль задаёт floor в `magnitudeScale` если нужно (зеркалит `getTestimonyWeight`-паттерн 0.3-фолбэка).

**Rejected.** `sentimentCurve` (импортирует crime-tuning в универсальный шов). Хардкод self-relevant eventTypes (module-знание в движке).

### DD-PP-08 — seeding state-осей из `profile.bigFive` через loadState-семантику; ФАКТ — это seed-then-replace, НЕ «XOR-skip»

**⚠️ MUST-FIX (save/load verdict #1+#2): «fresh-seeder SKIPPED on load» — ЛОЖНО.** Verified boot-порядок:
- `createGameContext` (`server/index.ts:793`) бежит ВСЕГДА (fresh и loaded), сеет атрибуты `world.setAttribute(...)` **безусловно** (`index.ts:729`).
- ЗАТЕМ `loadState` (`index.ts:800`) при `if (saved.attributes)` делает **полную замену** `agent.state.attributes = clean` (`world.ts:2004`).

Ничего не «пропускается». Сохранённое пластичное состояние выживает только потому, что loadState **полностью заменяет** map. Следствия:
- НОВЫЙ сейв со сдвинутым `trait:N`: выживает (полная замена). OK.
- СТАРЫЙ сейв с `attributes:{gold}` (нет `trait:`-ключей): свежезасеянные `trait:O..H` **СТИРАЮТСЯ** полной заменой → чтения OK через seed-фолбэк, но агент state-less по traits.
- СТАРЫЙ сейв БЕЗ `attributes` (bob): `if (saved.attributes)` ложно → блок пропущен → bob **СОХРАНЯЕТ** засеянные оси.
- → два агента в одном loaded-мире в РАЗНЫХ представлениях (state-backed vs seed-fallback). Не corruption (фолбэк спасает чтения), но непоследовательность.

**Решение (канонизируем ОДНО представление, save/load verdict #2):** в `loadState`, ПОСЛЕ блока `if (saved.attributes)` (и в ветке его отсутствия), **MERGE-засеять** недостающие engine-owned `trait:`-оси из `profile.bigFive`, чтобы каждый агент пост-load был единообразно state-backed. То есть: загруженные `trait:`/`pp:` ключи имеют приоритет; недостающие OCEAN+H оси доливаются из seed. `pp:`-аккумуляторы — lazy (не доливаются, создаются на первом триггере).

`trait-randomizer.ts` продолжает писать `profile.bigFive` без изменений (это канонический seed для НОВЫХ игр; на loaded-boot он детерминированно воспроизводится из restored seed — `index.ts` re-randomize). Сидирование state-осей идёт там же, где сейчас сеются атрибуты/factions (`index.ts:728-739`), для NPC **И** player.

**Rejected.** Сидирование на каждом boot без merge-логики (клобберит loaded state для агентов с непустыми attributes). Заявление о несуществующем `if(!savedData)`-skip.

### DD-PP-09 — `baseMood` и прочие trait-производные пересчитываются только явным module-проводимым путём на `applyPlasticShift`, не пассивно при каждом чтении; temperament(seed)/character(deformed) развязка

**Решение.** `baseMood` — само деформируемый скаляр (но не `ScalarAttribute`, см. DD-PP-11), засеянный из traits. Пластичный N-сдвиг НЕ должен двойного-счёта через и хранимый `baseMood`, и пассивный re-read. Load-time `baseMood`-default (`world.ts:1988`) продолжает читать profile **SEED**, так что прежний сдвиг не реаплаится.

**⚠️ MUST-FIX (mood verdict #1+#2 — флагманский use-case иначе no-op):** Спека ОБЯЗАНА конкретно специфицировать N/E→baseMood-coupling как **engine-OPTIONAL, но ОПРЕДЕЛЁННЫЙ** механизм, а не туманное «модуль провяжет». «Trauma поднимает neuroticism → агент навсегда мрачнее» иначе **тихо no-op на mood**, т.к. baseMood заморожен на seed, а единственный выживший N→mood-coupling (social-stress ps-фактор) — per-tick множитель давления, не сдвиг baseline.

**Механизм (выбран вариант (a) — единый источник формулы):** `applyPlasticShift` принимает опциональный коллбэк `derivedRecompute?`, И тот же коллбэк используется сидером baseMood в boot. Так ОДНА формула (`0.3 - N*0.4 + E*0.2`, текущая `world.ts:1988`/`index.ts`) сеет baseMood при boot И реаплаит **дельту** при сдвиге N/E — single source of truth, без двойного счёта. Если модуль НЕ провязывает N→baseMood, trait-сдвиг НЕ трогает baseMood (явная развязка — temperament-seed-driven mood vs character-deformed utility).

**Temperament/character развязка (mood verdict #4, явно записать):** mood-subsystem-чтения traits (см. DD-PP-12) ОСТАЮТСЯ на `profile.bigFive` SEED (immutable temperament), а behavioral utility (`computeUtility` personality-channel) использует деформированный `trait()` (character). Это защитимая «temperament vs character» развязка — но она ДОЛЖНА быть записана, иначе тихое смешение = тот самый split-brain. Coupling N→baseMood (если модуль захочет) идёт ТОЛЬКО через явный `derivedRecompute`-путь на сдвиге, не пассивно.

**Rejected.** Пассивный пересчёт baseMood из effective-traits при каждом чтении (двойной счёт уже свёрнутого в baseMood сдвига; неявная связка mood↔traits).

### DD-PP-10 — `pp:`-аккумулятор хранится как затухающий МОДИФИКАТОР, не как `base`

**⚠️ SHOULD-FIX (hot-path verdict #6 + mood #6):** `pp:`-аккумулятор как `ScalarAttribute.base` **НЕ затухает** — `decayAttribute` тикает только `modifiers`, не `base` (verified `attributes.ts:61-74`). Под-пороговое накопление росло бы вечно (unbounded base, «никогда не забывает»), а SL-07 re-clamp на `[0,Infinity]` — no-op.

**Решение:** `mode='threshold'` аккумулятор хранится как ОДИН затухающий модификатор на `attributes['pp:<ruleId>']` (а не как base) — тогда `decayAttribute` гасит его «бесплатно», совпадая с упругой моделью (накопление между событиями естественно остывает). Пересечение порога читает `attributeEffective(pp-attr)`; на пересечении — применяет `step` к **оси** через `applyPlasticShift` и **сбрасывает** аккумулятор (очищает модификаторы). Длительность/decay модификатора-аккумулятора — module-knob (default: `decay:'none'` если модуль хочет «никогда не забывать»; иначе linear/exp с заданной duration).

**Аккумуляторы lazy-create (hot-path verdict #5):** не сеять `pp:`-ключи заранее; создавать на первом триггере. `mode='accumulation'` вообще не нуждается в аккумуляторе (каждый триггер сразу добавляет `step×scale` к оси-base через `applyPlasticShift`).

**`pp:` — base-only-or-modifier-only по дизайну (mood #6):** evaluator читает аккумулятор через `attributeEffective` (модификаторная форма); `trait:`-оси тоже через `attributeEffective`. Документировать: модули НЕ навешивают drift на `pp:`-ключи.

### DD-PP-11 — `baseMood` получает легальный пластичный путь (без миграции в `attributes`)

**⚠️ MUST-FIX (mood verdict #2):** `baseMood` — голый `number` на `AgentState` (`world.ts:94`), НЕ `ScalarAttribute`. `applyPlasticShift` (обёртка `adjustAttributeBase('trait:'+axis)`) **не может** его тронуть. «Trauma навсегда понижает baseline mood» иначе требует прямой мутации baseMood без finite-guard/clamp/onChange.

**Решение:** добавить `World.applyPlasticBaseMoodShift(npcId, delta)` — finite-guard + clamp `[-1,1]` + эмит `onMoodChange`. Это **легальная пластичная цель для mood**, тогда как `trait:`-оси — легальная пластичная цель для **личности**. НЕ мигрируем baseMood в `attributes` (отвергнуто в DD-PP-02: затронуло бы `world.ts:550/586/1890/1988` + `index.ts` — реальный рефактор калибровки). Записать в спеке: trait-пластичность сама по себе НЕ достаточна для mood-релевантной «травмы» — для неё используется `applyPlasticBaseMoodShift` (напрямую, или через `derivedRecompute` из DD-PP-09).

**Rejected.** Миграция baseMood в reserved `attributes['mood:base']` (рефактор калибровки, отвергнут DD-PP-02). Прямая мутация `state.baseMood` без guard (риск INV-06-parity).

### DD-PP-12 — какую версию каждого trait читает каждый mood-терм — ЗАФИКСИРОВАНО

**⚠️ SHOULD-FIX (mood verdict #4):** `_computeMoodTick` читает `profile.bigFive` напрямую (SEED) каждый tick для social-stress ps (`world.ts:536`: `bf.neuroticism*1.5 + (1-bf.agreeableness)*0.5 + (1-bf.honesty)*0.3`), loneliness читает `bigFive.extraversion` (`world.ts:578`), `moodCurve` читает `bigFive.honesty` (`al.ts:457`). Если их переключить на деформированный `trait()`, а baseMood держать на seed (DD-PP-09) — внутри одной mood-математики baseline читает frozen-N, а pressure-термы деформированный-N = split-brain ВНУТРИ mood.

**Решение (зафиксировано):** mood-subsystem-чтения traits (`_computeMoodTick` ps/loneliness, `moodCurve` honesty-arg) **ОСТАЮТСЯ на `profile.bigFive` SEED** (temperament). Только `computeUtility` personality-channel (`al.ts:451`) и CG-gating переключаются на деформированный `trait()` (character). Это «temperament vs character» развязка из DD-PP-09. **Тест пинит**, какую N читает каждый mood-терм. Это означает: в migration-списке сайты `world.ts:536/578` и `al.ts:457` (moodCurve honesty-arg) **НЕ** переключаются на `trait()` — они остаются seed-чтениями (правка к наивному migration-плану).

---

## Спецификация реализации

### Data Model

Носитель: расширяем `AgentState.attributes` (`agent-types.ts`) БЕЗ нового bespoke-struct.

```
attributes['trait:O'] : ScalarAttribute  // min=0 max=1 base=seed(openness)
attributes['trait:C'] , ['trait:E'] , ['trait:A'] , ['trait:N'] , ['trait:H']
attributes['trait:<axisKey>']            // module axes (e.g. 'trait:stability')
attributes['pp:<ruleId>']                // plasticity accumulator (threshold mode), as a DECAYING MODIFIER (DD-PP-10)
```

Зарезервированные префиксы — `trait:` и `pp:`. Это ЕДИНСТВЕННАЯ конвенция движка; namespace'нуто, так что module-атрибуты (gold, hp) не коллизят.

**⚠️ Reserved-namespace collision (save/load verdict #6):** авторские NPC `attributes`-ключи текут verbatim через `world-loader.ts:286` → `index.ts:729 setAttribute`. Автор может написать `"trait:O"` или `"pp:x"` в JSON (editor допускает free-text-ключи) и клобберить engine-оси. **Решение:** (a) boot-сидер ОТКЛОНЯЕТ/пропускает любой авторский `attributes`-ключ с префиксом `trait:`/`pp:` с warning; (b) `world-data.test.ts` ассертит, что ни один authored NPC `attributes`-ключ не использует reserved-префиксы; (c) сидировать trait-оси ПОСЛЕ авторских атрибутов, чтобы engine-значения побеждали. Документировать резервацию в `world-loader`.

### Open-axis registry

```typescript
export interface TraitAxisDef {
  key: string;          // canonical axis key (single-letter for OCEAN+H; module-defined for the rest)
  seed: number;         // default base for fresh agents lacking an explicit seed
  min: number;          // default 0
  max: number;          // default 1
  anneal?: { ratePerMinute: number; toward: number }; // axis-level reversibility (DD-PP-05); absent = irreversible
}
export function registerTraitAxis(def: Partial<TraitAxisDef> & { key: string }): void;
export function getTraitAxes(): readonly TraitAxisDef[];   // OCEAN+H always present + module axes
export function clearTraitAxes(): void;                    // test-support; re-seeds OCEAN+H

// canonical name<->axis maps shared by computeUtility AND cg-engine.checkTrait (DD-PP-03)
export const TRAIT_NAME_TO_AXIS: Record<string, string>; // 'openness'->'O', ... 'honesty'->'H'
export const AXIS_TO_TRAIT_NAME: Record<string, string>; // 'O'->'openness', ...
```

Движок сеет 6 OCEAN+H осей в boot (универсальная психометрика — INV-14-clean; это allowed built-in seed-set, см. DD-PP-04). Модули зовут `registerTraitAxis('stability', {...})`. Реестр — открытая замена закрытому `BigFive`, но `BigFive` ОСТАЁТСЯ типизированной seed-формой (закрытые типизации компилируются). Новые оси достигаются string-keyed `trait()`-путём.

### `PlasticityRule` schema

```typescript
export interface PlasticityRule {
  id: string;                         // stable; used for accumulator key 'pp:<id>'
  axis: string;                       // trait axis key to deform (must be a registered axis)
  when: {
    eventType?: string;               // matched against onActionExecuted/processed-event payload (INV-14: opaque)
    abilityUse?: string;              // SPEC-affordance-modifier seam: an affordance-modifier id whose USE triggers this
    predicate?: (ctx: PlasticityTriggerCtx) => boolean;  // module gate (self-action etc.)
  };
  mode: 'threshold' | 'accumulation';
  step: number;                       // signed axis-unit shift (threshold: per cross; accumulation: per trigger)
  threshold?: number;                 // required for mode==='threshold'
  accumulatorDecay?: { decay: 'none' | 'linear' | 'exponential'; duration: number }; // DD-PP-10; default 'none'
  // magnitude scaling — ADDITIVE bonus over 1.0 (DD-PP-07). Default 1.0 ⇒ no scaling.
  magnitudeScale?: (ctx: PlasticityTriggerCtx) => number;
  // reversibility — written onto the axis ScalarAttribute.drift on first shift; absent = irreversible.
  // ALWAYS exponential-toward (DD-PP-05). Axis-level: set once, last-write-warns (not silent compound).
  anneal?: { ratePerMinute: number; toward: number };
  // optional seam emission (decoupled; null-safe). Source MUST be module-distinct (Seam B).
  emitBelief?: (ctx: PlasticityTriggerCtx) => { eventType: string; object: string | null; source: string; confidence: number } | null;
}

export interface PlasticityTriggerCtx {
  agent: Agent;                       // the bearer (bilateral: may be player)
  targetId?: string;                  // for cross-agent / sentiment-scaled rules
  event?: WorldEvent;                 // the matched event, if event-driven
  affordanceId?: string;              // populated when fired from onActionExecuted
  usedOverrideId?: string;            // SPEC-affordance-modifier seam payload
  // self-belief: confidence of beliefs whose SUBJECT is the bearer (selfId = agent.profile.id),
  // matcher is module-supplied. Returns 0 when no matching belief (NO 0.1 floor — DD-PP-07).
  selfBeliefConfidence: (matcher: (eventType: string) => boolean) => number;
  sentimentTo: (id: string) => number; // raw getRelationship(id)?.sentiment ?? 0 (DD-PP-07)
}

export function registerPlasticityRule(rule: PlasticityRule): void;
export function getPlasticityRules(): readonly PlasticityRule[];
export function clearPlasticityRules(): void;   // test-support (mirrors clearScoringContributors al.ts:445)
```

### Engine Law + tick integration

**Закон (genre-neutral, restated):** квантованное состояние агента — `base` + Σ затухающих `modifiers`, clamp'нутое в `[min,max]`. ELASTIC = модификатор (springs back). PLASTIC = перманентный сдвиг `base`. Закон уже существует дважды (mood `_computeMoodTick` `world.ts:547-550`; `ScalarAttribute` `attributeEffective` `attributes.ts:54`). PP маршрутизирует личность через **существующий** `ScalarAttribute` — новой деформ-математики НЕ пишется.

**Tick / event-интеграция (без новых loop'ов):**
- **Decisive/событийные правила** фаерятся из единого `World.onActionExecuted`-хука (DD-PP-06) — НЕ из re-scan'а eventStore. Хук эмитится в NPC-goal-execution (`world.ts:1242` рядом) И в player-action-пути (bilateral §). PP-evaluator (установленный через `registerTickPhaseHandler`-инфраструктуру, но потребляющий хук) матчит `when.eventType`/`when.abilityUse`/`predicate`, применяет сдвиг.
- **Decay аккумулятора + annealing оси-base** едут на СУЩЕСТВУЮЩИХ `decayAttribute`/`driftAttribute` (`world.ts:592`) — и аккумулятор (модификатор), и ось ЕСТЬ `ScalarAttribute`. dt=5 наследуется.
- **Пластичная запись base** зовёт `adjustAttributeBase` (`world.ts:673`) — УЖЕ существующую permanent-base-операцию (legal PLASTIC write).
- Bilateral: evaluator/хук итерируют/покрывают всех агентов **включая player** (INV-16).

**threshold mode:** при пересечении `attributeEffective('pp:<id>') ≥ threshold` → применить `step` к оси-base ОДИН раз (`applyPlasticShift`) → сбросить аккумулятор (очистить его модификаторы). Под-порог → нет сдвига.
**accumulation mode:** каждый триггер добавляет `step × magnitudeScale(ctx)` прямо к оси-base (`applyPlasticShift`); медленная эрозия; аккумулятор не нужен.

### World API

```typescript
class World {
  // effective trait read (state axis -> profile seed -> 0.5). Bilateral. Accepts axis key OR full name.
  getTrait(npcId: string, axis: string): number;

  // PLASTIC shift — wraps adjustAttributeBase('trait:'+axis); writes anneal.drift on first shift (exp-toward);
  // clamps finite; emits onTraitChange when |Δ|>0.0005.
  applyPlasticShift(
    npcId: string, axis: string, delta: number,
    anneal?: { ratePerMinute: number; toward: number },
    derivedRecompute?: (agent: Agent, axis: string, oldEff: number, newEff: number) => void, // DD-PP-09
  ): number;

  // ELASTIC trait modifier (rare; e.g. temporary disposition buff). Wraps addAttributeModifier('trait:'+axis,...).
  addTraitModifier(npcId: string, axis: string, mod: Omit<AttributeModifier, 'id'>): void;

  // PLASTIC mood-baseline shift (DD-PP-11) — finite-guard + clamp[-1,1] + emit onMoodChange.
  applyPlasticBaseMoodShift(npcId: string, delta: number): number;

  // execution hook (DD-PP-06) — fired on NPC goal-execution AND player action; bilateral.
  onActionExecuted?: (actorId: string, affordanceId: string, target?: string, usedOverrideId?: string) => void;

  // new trait-change callback, parallels onMoodChange (world.ts:63/596).
  onTraitChange?: (npcId: string, npcName: string, axis: string, oldVal: number, newVal: number) => void;
}

class Agent {
  // attributeEffective(state.attributes['trait:'+normalize(axis)]) ?? profile.bigFive[mapped] ?? 0.5
  trait(axis: string): number;   // accepts single-letter axis OR full OCEAN+H name (normalizes internally)
}
```

### Три шва (genre-neutral, null-safe)

**Seam A — `SPEC-affordance-modifier` ability-use = plasticity trigger («кусок себя»).** `PlasticityRule.when.abilityUse` матчит id affordance-override, который `SPEC-affordance-modifier` регистрирует. Когда override ИСПОЛЬЗУЕТСЯ, тот спек эмитит `World.onActionExecuted(actorId, affId, target, usedOverrideId)`; PP-evaluator матчит `usedOverrideId === when.abilityUse`. Движок НЕ поставляет coupling-код — `SPEC-affordance-modifier` зовёт общий хук, PP матчит строкой. Decoupled: оба спека независимо тестируемы. Это «using a power costs who-you-are» как чистые rule-данные (Negation Type I). **Точка эмиссии — общий `onActionExecuted` (DD-PP-06), НЕ tick-stream.**

**Seam B — magnitude scaled from self-belief (beliefs).** `magnitudeScale(ctx)` зовёт `ctx.selfBeliefConfidence(matcher)` — тонкая обёртка над `BeliefManager.getMaxConfidenceFor(selfId, matcher)` (`beliefs.ts:82`). `selfId = agent.profile.id` передаётся обёрткой; matcher — module-supplied (INV-14). **Возвращает 0 при отсутствии веры (НЕТ 0.1-floor — DD-PP-07)** — поэтому magnitudeScale аддитивен над 1.0. Сдвиг может ЭМИТИТЬ belief через `rule.emitBelief` → `BeliefManager.addBelief`; эмитируемый `(eventType,object,source)`-triple ДОЛЖЕН быть module-distinct, иначе тихо переподтвердит crime-belief (addBelief дедупит по triple, `beliefs.ts:~55` — surface'нуто авторам модулей, движок нейтрален). **Subject-семантика:** «self-belief» = верования, чей SUBJECT модуль назначил self, не «во что верит holder».

**Seam C — magnitude scaled from sentiment-to-target (relationships).** `ctx.sentimentTo(targetId)` оборачивает `RelationshipGraph.getRelationship(targetId)?.sentiment ?? 0` (`relationships.ts:64`). RAW sentiment, НЕ `sentimentCurve` (DD-PP-07). Self-directed (нет relationship-строки) → фолбэк на Seam B. Strangers → 0; модуль задаёт floor в `magnitudeScale`.

**Связь с Enneagram stress/growth (НЕ шов — дизамбигуация).** `getStressGrowthDirective` (`personality-prose.ts:46`) — ELASTIC и PROSE-ONLY: читает live `mood`-пороги, эмитит system-prompt-строку, ничего не мутирует. Plasticity — ортогональная PLASTIC-ось. Они КОМПОЗИРУЮТСЯ без двойного счёта: пластичный сдвиг может двигать `baseMood` (через `applyPlasticBaseMoodShift`/`derivedRecompute`) или `stability`-ось, что меняет, в какую Enneagram-полосу попадает `mood` — связь КОСВЕННАЯ (через mood), никогда прямая запись в Enneagram-директиву. Кода в `personality-prose.ts` менять НЕ нужно.

### bigFive profile→state migration (additive, INV-21-clean, no data loss)

**Subtle ordering trap (resolved, DD-PP-08).** `trait-randomizer.ts` мутирует `profile.bigFive` на boot, КАЖДЫЙ boot. Если trait-baselines станут persisted state, re-randomization на LOADED-сейве клобберит пластичный сдвиг. Резолв: `profile.bigFive` ОСТАЁТСЯ immutable seed, randomizer пишет его без изменений (world-JSON-equivalent baseline). State-оси сеются ИЗ (уже-рандомизированного) `profile.bigFive`; на LOADED-boot loadState восстанавливает `attributes` (вкл. `trait:`/`pp:`) И **merge-доливает** недостающие OCEAN+H оси (DD-PP-08), так что сохранённый сдвиг выживает.

**Read-site migration (full blast radius — verified 21 файл, НЕ «17+4»).** Каждый `agent.profile.bigFive[X]`-read переключается на `agent.trait('X')` / `world.getTrait` — КРОМЕ зафиксированных temperament-чтений mood (DD-PP-12). Т.к. `trait()` падает на `profile.bigFive` при отсутствии state-оси, переключение БЕЗОПАСНО даже до сидирования (Phase 0 byte-identical).

Сайты (с указанием формы):
- **Engine, переключаются на `trait()`:**
  - `al.ts:451` computeUtility personality-channel; `al.ts:457` moodCurve honesty-arg — **СТОП:** honesty-arg остаётся SEED (DD-PP-12, mood-терм). personality-channel переключается.
  - `instinct-builder.ts:205` (getResistanceVoice) — передать axis-reader вместо bigFive-struct.
  - `volition.ts:385`, `agent.ts:267/524` (`bigFiveToDescription`) — построить синтетический `BigFive`-view из `trait()` для 6 OCEAN+H-ключей, prose-fn без изменений.
  - `cg-engine.ts:344` checkTrait — редирект на `agent.trait(traitName)` через `TRAIT_NAME_TO_AXIS` (DD-PP-03); читает state→seed→undefined; становится естественным reader'ом модульных осей.
  - `il.ts` (читает bigFive), `topic-engine.ts:238-239`, `scheduler.ts:133-134`, `social/topic-sources.ts`, `crime-justice/index.ts` / `step-handlers.ts` / `investigation.ts` — механический switch на `trait()` (для struct-consumers — синтетический view).
- **Engine, ОСТАЮТСЯ на SEED (DD-PP-12, temperament/mood):**
  - `world.ts:536` social-stress ps (N/A/H); `world.ts:578` loneliness (E); `world.ts:1988` baseMood-seed (N/E); `al.ts:457` moodCurve honesty-arg.
  - N→baseMood-coupling (если модуль захочет) идёт ТОЛЬКО через явный `derivedRecompute` на `applyPlasticShift`, не пассивно.
- **Server, сериализуют EFFECTIVE (save/load verdict #7 — UI-truth):**
  - `routes.ts:118/801/819` + `routes.ts:654` (`1 - bigFive.honesty` venality) + `game.js` personality-панель — сериализовать через `world.getTrait()` / синтетический view, чтобы UI показывал деформированные значения; форма остаётся `{O..C..H}` numbers (frontend не трогается).
  - `server/index.ts` (player hand-build + seeding) — добавить trait-axis-сидер.
  - `llm-npc-prompt-builder.ts` — через синтетический view.
  - `trait-randomizer.ts` — БЕЗ изменений (пишет seed).

Для struct-consumers (`bigFiveToDescription`, topic-engine, routes-serialization, llm-prompt-builder) специфицируется адаптер: `function effectiveBigFive(agent): BigFive` — собирает `{openness: trait('O'), …, honesty: trait('H')}`. Пропуск любого сайта реинтродуцирует split-brain — поэтому единый аксессор + адаптер обязательны.

### Bilateral (INV-16)

Player hand-build'ится (`server/index.ts`) с литеральным `bigFive` и без attributes до сидирования. Fresh-seed-шаг ЯВНО покрывает `'player'` → player получает `trait:`-оси. Player ИМЕЕТ plasticity и ЕСТЬ валидный plasticity-source/target. PP-evaluator/хук покрывают player.

**⚠️ MUST-FIX (bilateral + save/load verdict — player execution detection):** `onGoalAction` (`world.ts:1242`) — NPC-only (после `isPlayer continue` `volition.ts:139/230`). Player НЕ производит `GoalActionResult`; его state-изменяющие акты — IL-pressure-события (`server/index.ts` pressure-handlers) без affordance-identity. Поэтому Seam A («using a power costs you») для player НЕдетектируем через NPC-путь. **Решение:** `World.onActionExecuted` эмитится ТАКЖЕ из player-action-пути — когда player выполняет действие (IL/speech-act handler или будущий player-action-endpoint), эмитить `onActionExecuted(playerId, affId, target, usedOverrideId?)`. PP-evaluator одинаково обрабатывает player и NPC (нет NPC-only-фильтра). Это решается вместе с player-execution-точкой `SPEC-affordance-modifier`.

**Связка с `SPEC-affordance-modifier` bilateral-долгом:** тот спек отмечает, что `validatePlayerAction` — dead code (zero production callers, verified) и player affordance-gating латентен. Это НЕ блокирует PP: PP подписывается на `onActionExecuted`, который должен эмититься в РЕАЛЬНОМ player-пути. Записать как named prerequisite: «player override-use detection и PP-trigger активируются, когда player-action-эмиссия `onActionExecuted` приземлится» (общий workstream с `SPEC-affordance-modifier`).

### INV-06 / INV-14 compliance proof

**INV-06 (mood ONLY via addModifier; mood computed = baseMood + Σ decayed modifiers).** Traits наследуют single-writer-дисциплину: effective ВЫЧИСЛЯЕТСЯ (`attributeEffective`), никогда не хранится; ELASTIC через `addTraitModifier` (→ `addAttributeModifier`), PLASTIC через `applyPlasticShift` (→ `adjustAttributeBase`) — оба finite-guarded и clamp'нуты. Mood-машинерия НЕ трогается (DD-PP-02). Новый прямой mood-write — ТОЛЬКО `applyPlasticBaseMoodShift` (DD-PP-11), который сам идёт через guard+clamp+`onMoodChange`, не через `agent.state.mood =` в loop'е → architecture-test mood-mutation-guard не тривожится. Пластичный base-shift зовёт `adjustAttributeBase`, не `.mood =`.

**INV-14 (engine/module boundary; zero module strings).** В движок входят ТОЛЬКО префиксы `trait:`/`pp:` и литералы `'threshold'`/`'accumulation'`/`'O'..'H'` — универсальная психометрика/термины. Слова Negation/trauma/wound/debt НЕ появляются. Триггеры, matchers, self-id-семантика, axis-имена за пределами OCEAN+H — всё module-supplied. **⚠️ (composition verdict #8 + save/load #INV-14):** архитектурный grep на `Negation|trauma|wound|debt` **НЕ существует сегодня** (`architecture.test.ts` сканит crime/trade-слова, verified). Добавить НОВЫЙ guard-тест (зеркалит CRIME_PROSE-блок с self-test-fixture). Подтвердить, что `'forbid'|'permit'|'threshold'|'accumulation'|'trait:'|'pp:'` НЕ ловятся существующими guard'ами (verified — не ловятся). **⚠️ (composition #11):** новый engine-файл и комментарии — только абстрактные примеры, никогда `curfew`/`power`/`Negation` (иначе валит собственный grep спеки).

**OCEAN-coupling boundary (INV-14 verdict #3, явная scoping-граница).** Движок печёт OCEAN-психологию в non-registry-код (baseMood из N/E; loneliness из E; social-stress из N/A/H; OCEAN+Enneagram prose). Это **pre-existing, test-blessed** позиция (`genre-neutrality.test.ts:137` зовёт её «pure OCEAN+H psychology» = engine-universal). Допустимо, НО спека ЗАЯВЛЯЕТ это явной границей, не подразумевая полную открытость: *«OCEAN+H — engine-universal психометрический примитив; модульные оси — ADDITIVE-каналы для scoring/gating/prose, но встроенные mood/stress-деривации движка остаются OCEAN-coupled by design. Жанр, не желающий OCEAN, сеет все 6 в 0.5 и игнорирует.»*

---

## План тестов

### Новые engine-тесты (`tests/plasticity.test.ts` — нейтральный домен, INV-14)

1. `registerTraitAxis` добавляет открытую ось; `getTraitAxes` включает OCEAN+H + новую. `clearTraitAxes` восстанавливает OCEAN+H.
2. `Agent.trait` цепочка фолбэка: нет state-оси → profile seed; засеяна → `effective(base+mods)`; ни того ни другого → 0.5. Принимает И однобуквенную ось, И полное имя (нормализация).
3. `applyPlasticShift` двигает base навсегда; clamp `[0,1]`; отвергает NaN; фаерит `onTraitChange` только при `|Δ|>0.0005`.
4. `mode='threshold'`: аккумулятор (`pp:<id>` как затухающий модификатор) пересекает threshold → ОДИН step применён → аккумулятор сброшен. Под-порог → нет сдвига. **Аккумулятор затухает между событиями** (decayAttribute-путь — DD-PP-10).
5. `mode='accumulation'`: каждый триггер добавляет `step×magnitudeScale` прямо; много триггеров эродируют base монотонно до clamp оси.
6. `anneal`: сдвинутая ось с `anneal` дрейфует base к `toward` (driftAttribute, **exp-toward**, не overshoot); без `anneal` — base заморожен (irreversible default). Второй `anneal` с другим `toward` на той же оси → warn + ignore (DD-PP-05).
7. `magnitudeScale` читает `selfBeliefConfidence` (засеять self-belief, ассертить **больший** сдвиг; **без веры → scale=1.0, НЕ 0** — DD-PP-07) и `sentimentTo` (засеять sentiment, ассертить scaling); strangers → module-fallback.
8. `emitBelief` пишет belief с distinct source; re-trigger НЕ клобберит crime-belief (distinct triple).
9. `clearPlasticityRules` изолирует тесты (process-global-registry hygiene, зеркалит `clearScoringContributors`).
10. **`pp:`-аккумулятор base-unbounded НЕ происходит** (DD-PP-10): под-пороговое накопление затухает, не растёт вечно.
11. **`applyPlasticBaseMoodShift`** (DD-PP-11): двигает baseMood навсегда; clamp `[-1,1]`; finite-guard; фаерит `onMoodChange`.
12. **`derivedRecompute`** (DD-PP-09): N-сдвиг с derivedRecompute обновляет baseMood по формуле один раз; без него baseMood не трогается (нет двойного счёта).

### Save/load (расширить `tests/save-load.test.ts`)

13. Round-trip: агент со сдвинутыми `trait:`-осями + `pp:`-аккумулятором → идентичный JSON после save/load; SL-07 NaN в trait-оси санируется.
14. INV-21 / **seed-then-replace** (save/load verdict): загрузить СТАРЫЙ сейв с `attributes:{gold}` (нет trait-ключей) → после **merge-seed** (DD-PP-08) `trait('O')` state-backed И == profile seed; и пустой агент (bob) тоже единообразно state-backed после load (не остаётся seed-fallback-only). Ассертить выбранное каноническое представление.
15. Loaded пластичный сдвиг НЕ ре-рандомизируется: загрузить сейв со сдвинутым `trait:N`, ассертить `trait('N') ≠ profile.bigFive.neuroticism` после boot (loadState merge не клобберит сохранённую ось).
16. **Trait-seeding ВНЕ engine Agent-конструктора/`makeState`** (save/load verdict #3): engine-тесты, строящие агентов напрямую (без серверного сидера), остаются byte-identical; засеянный агент round-trip'ит trait-оси; un-seeded агент (bob-style) даёт ноль `attributes`-вывода (omit-when-empty). Player получает trait-оси в том же fresh-boot-блоке (player toJSON-форма не отличается fresh-vs-loaded).
17. **Reserved-namespace** (save/load verdict #6): авторский NPC `attributes`-ключ с префиксом `trait:`/`pp:` отклоняется boot-сидером (warn) и/или валит `world-data.test.ts`.

### Регрессия / parity (расширить существующие suites)

18. PHASE 0/1 oracle: crime + economy behavior-тесты НЕИЗМЕННЫ при нуле зарегистрированных правил (доказывает additive).
19. Bilateral (INV-16): player получает trait-оси; `applyPlasticShift` на player работает; `onActionExecuted` фаерит PP-триггер для player (когда player-эмиссия приземлена); player-trigger тест зеркалит NPC-тест.
20. computeUtility читает деформированный trait: сдвинуть `trait:H`, ассертить personality-channel использует новое значение (single accessor, no split-brain). **И отдельно:** moodCurve honesty-arg + social-stress + loneliness ОСТАЮТСЯ на seed (DD-PP-12 — пинит, какую версию читает каждый mood-терм).
21. **boot-smoke validTraits из реестра** (INV-14 verdict #2): `boot-smoke.test.ts:317/497` driven из `getTraitAxes()`, не хардкод; модуль с открытой осью в CG-правиле/resistTrait не валит suite.

### Архитектура / INV-14

22. НОВЫЙ guard-тест: engine-source содержит НОЛЬ слов `Negation/trauma/wound/debt` (зеркалит CRIME_PROSE-блок + self-test-fixture). Префиксы `trait:`/`pp:` и `threshold`/`accumulation` — универсальны, allowed.
23. `tsc --noEmit = 0` после каждой фазы (закрытые `BigFive`-типизации компилируются; открытые оси достигаются только string-keyed `trait()`).
24. Open-axis end-to-end: синтетический модуль регистрирует ось `'curiosity'` + CG-правило + scoring-weight `axis:'curiosity'` → computeUtility скорит её, checkTrait гейтит её, getTraitAxes её содержит — С НУЛЁМ engine-правок (доказывает реальную, не косметическую открытость — DD-PP-04).

---

## Phasing (additive before destructive; каждая фаза: tsc 0, bun test green, oracle unchanged)

**PHASE 0 — read-seam, PURE additive, behavior-identical.**
- Добавить `Agent.trait(axis)`-аксессор + `registerTraitAxis`/`getTraitAxes`/`clearTraitAxes` + `TRAIT_NAME_TO_AXIS`/`AXIS_TO_TRAIT_NAME`, OCEAN+H engine-seeded.
- Протянуть открытость через consumer-пути (DD-PP-04): `AffordanceWeight.axis?`, `computeUtility` fallback, `cg-engine.checkTrait` редирект, `resistTraits` escape-hatch.
- Переключить ВСЕ не-mood bigFive-read-сайты на `trait()` (engine + module + server-serialization через адаптер). Mood-термы (DD-PP-12) ОСТАВИТЬ на seed.
- Заменить `boot-smoke.test.ts` `validTraits` хардкод на реестр-driven.
- С незасеянными state-осями `trait()` возвращает profile seed → byte-identical. tsc 0; full suite green; crime+economy oracle UNCHANGED. **Safety-establishing фаза** — доказывает шов до появления state.

**PHASE 1 — state-back осей, ещё без правил.**
- Сеять `attributes['trait:O'..'H']` из `profile.bigFive` на boot (server-сидер, DD-PP-08) для NPC И player; reserved-namespace guard в сидере.
- `loadState` merge-доливает недостающие OCEAN+H оси (DD-PP-08) — каноническое единообразное представление.
- loadState уже round-trip'ит ключи (нет save/load-кода). Поведение всё ещё идентично (base=seed). Расширить round-trip-тест (assert trait-оси персистят; un-seeded агент пуст; старый gold-сейв merge-seed'ится). INV-21: старые сейвы → merge-seed/fallback → нет обнуления.

**PHASE 2 — ЗАКОН: `PlasticityRule` + evaluator + World API.**
- Добавить `PlasticityRule` schema, реестр, единый evaluator (потребляющий `onActionExecuted`), аккумуляторы (`pp:<id>` как затухающие модификаторы — DD-PP-10), `World.applyPlasticShift`/`addTraitModifier`/`getTrait`/`applyPlasticBaseMoodShift`, `onTraitChange`-коллбэк, `onActionExecuted`-хук (эмиссия в NPC-goal-execution).
- Нет зарегистрированных правил → нет сдвигов → поведение неизменно. Engine-тесты регистрируют синтетическое нейтрально-доменное правило (ось `'curiosity'`, eventType `'test_event'`) — доказать threshold + accumulation + anneal + magnitudeScale + accumulator-decay, с `clearPlasticityRules` в `afterAll`.

**PHASE 3 — швы.**
- Провязать `selfBeliefConfidence`/`sentimentTo`-обёртки (с корректной 0-семантикой, аддитивный scale — DD-PP-07) + `emitBelief`-путь. Тесты: magnitude масштабируется от belief-confidence и sentiment; эмитируемый belief использует distinct source. `derivedRecompute` N→baseMood-путь (DD-PP-09).

**PHASE 4 — `SPEC-affordance-modifier` trigger-seam + player-execution.**
- Когда `SPEC-affordance-modifier` поставит свой override-use-эмит через `onActionExecuted`, `when.abilityUse`-матчинг валидируется end-to-end. Player-execution-эмиссия `onActionExecuted` приземляется (общий workstream) → bilateral Seam A активен для player. (Decoupled — PP не блокирует на `SPEC-affordance-modifier`.)

**НЕТ ДЕСТРУКТИВНОГО ШАГА.** `profile.bigFive` НИКОГДА не удаляется — навсегда остаётся immutable seed. `trait-randomizer` продолжает писать его. `BigFive` interface остаётся (закрытые типизации компилируются). «Деструктивное» удаление, подразумеваемое наивным дизайном (убрать bigFive с profile), осознанно отвергнуто — хранение seed — то, что делает миграцию обратимой и INV-21-тривиальной.

---

## Открытые вопросы / Отложено

1. **M8 ordering (Plasticity vs Politics).** `SPEC-economy.md:197` пенсилит политику как M8. Эти двое не могут быть оба M8. **Решение за пользователем.** Рекомендация (non-binding): plasticity — foundational engine-слой, который и Negation, и политика хотят; может идти первой как M8 с политикой → M9. Флаг, не самовольное решение.

2. **`onActionExecuted` гранулярность для player.** Player-action-путь сегодня — IL-pressure-события без affordance-identity, а `validatePlayerAction` — dead code (verified, zero production callers; общий долг с `SPEC-affordance-modifier`). Реальная player-execution-точка эмиссии `onActionExecuted` — named prerequisite Phase 4, общий workstream. До неё player-Seam-A латентен (NPC-сторона полна). **Отложено** до решения player-action-pipeline.

3. **mid-goal trigger (decisive shift во время выполнения).** `SPEC-affordance-modifier` флагует, что committed goals не ре-чекаются на исполнении (`processGoalTick` без requirement-re-check). Для PP это релевантно лишь как точка эмиссии `onActionExecuted` (на consequential-step, не на commit). Уточнить, эмитить ли хук на commit или на исполнении step'а — **выбрано: на исполнении** (рядом с `onGoalAction` `world.ts:1242`), чтобы «использование» совпадало с реальным эффектом. Подтвердить при имплементации Phase 2.

4. **baseMood как полноценный `ScalarAttribute` (отложенный рефактор).** DD-PP-11 даёт `applyPlasticBaseMoodShift` вместо миграции baseMood в `attributes` (отвергнуто DD-PP-02 из-за калибровки). Если позже понадобится drift/анилинг baseMood как у trait-осей — отдельная спека-рефактор (version 1→2 save-migration). **Отложено.**

5. **World-editor «edit live plastic state».** Editor правит `data.personality{O..H}` → mapping на profile SEED только (verified `world-loader.ts`, editor `app.js`/`server.ts` пишут verbatim). Для v1 правок editor'а НЕ нужно (оси деривятся из seed на boot). Документировано как контракт seed≠state; будущая фича «править live пластичное состояние» знает различие. **Отложено.**

6. **«No one does both» enforcement.** Целевой Negation-success-test требует «никто не делает оба» (Type I cost vs Type II scaled). Это **module-bookkeeping-конвенция**, не engine-invariant — ни PP, ни `SPEC-affordance-modifier` не дают registration-time-валидации mutual exclusion. Записать честно: success-test выразим как конвенция модуля (модуль трекает per-agent Type своим состоянием), не как checkable engine-инвариант. Если потребуется enforce — registration-time-hook (отложено).

7. **Save-version gate.** `if (data.version !== 1) return null` (verified `index.ts`) — любой будущий bump версии тихо отбросит весь сейв. Оба слоя ДОЛЖНЫ оставаться additive-optional (нет required-новых-полей, нет type-changes существующих), чтобы version-1-gate грузил старые сейвы. Если когда-либо перестанет — нужна migration-ветка (1→2), не текущий hard reject. **Документировано как контракт.**