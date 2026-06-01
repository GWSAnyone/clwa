## Map: AL pipeline + perception + zones (SPEC 2 hooks) + tick lifecycle (SPEC 1)

**TL;DR:** Допущение по глубине: medium+ (трассированы ключевые функции + точки врезки, без построчного чтения всех файлов). Возможное множество действий считается в `al.ts` через две зеркальные функции-гейта (`checkRequirements` проактивно, `checkRequirementsReactive` реактивно), которые итерируют по двум module-наполняемым реестрам чекеров (pre-target + post-target) — это и есть готовая, genre-neutral точка для SPEC 2 «состояние меняет множество возможных действий». Сила/score модификатора отдельно живёт в `computeUtility` через `SCORING_CONTRIBUTORS`. Player идёт через `validatePlayerAction` (билатеральный паритет), но эта функция дублирует логику гейта и НЕ вызывает post-target чекеры — главный риск асимметрии. Тик-жизненный цикл (decay/anneal плюс жизнь модификаторов) врезается через `registerTickPhaseHandler`, который в `world.ts:1382` исполняется над всеми агентами (включая игрока). SPEC 1 переиспользует ровно ту же деформационную машинерию mood (`baseMood + Σ modifierEffective`, INV-06) и B1 `ScalarAttribute` (`base + clamp + modifiers + drift`).

**Architecture (что есть и как связано):**
- `al.ts` — модель аффорданса + 4 реестра (`REQUIREMENT_CHECKERS`:209, `POST_TARGET_REQUIREMENT_CHECKERS`:213, `TARGET_FINDERS`/`REACTIVE_TARGET_FINDERS`:200/203, `SCORING_CONTRIBUTORS`:438). Чистый движок: `AffordanceRequirement` имеет открытый индекс `[key]: unknown` (al.ts:27) — модуль кладёт ЛЮБОЙ ключ требования, движок его не перечисляет (INV-14).
- `volition.ts` — драйвер AL. `evaluateAllVolition`:127 (проактивный per-tick цикл) и `evaluateReactiveVolition`:207 (на CE-событие). Оба пропускают игрока (`isPlayer` :139, :230).
- `perception.ts` — co-presence: `getCoPresent`:55, `getWitnesses`:69 (билатеральны, считают игрока). Это естественное место, чтобы перечислить «кто присутствует, чтобы спроецировать модификатор на T».
- `world-types.ts` — `LocationDef`:24 / `LocationGraph`:34. Единственный пространственный примитив, БЕЗ изменяемого состояния. Для «zone Z как активный объект» (SPEC 2 zone-source) дома сейчас НЕТ.
- `event-registry.ts` — `registerTickPhaseHandler`:696, `TickPhaseContext`:670; `world.ts:1382` крутит все хендлеры за тик.
- `attributes.ts` / `world.ts` — деформационная машинерия (см. ниже).

**Data flow — как считается ВОЗМОЖНОЕ множество (проактивно):**
`evaluateAllVolition` (volition.ts:154) → `for aff of AFFORDANCE_REGISTRY` → `checkRequirements(aff, npcId, agent, ctx)` (al.ts:160→304):
1. Универсальные pre-target гейты: period (al.ts:313), moodBelow (314), suppressNearPlayer (315).
2. `checkRegistryRequirements` (al.ts:318→269): итерация по `REQUIREMENT_CHECKERS`, передаётся ВЕСЬ объект `requires` как `params`. ← **SPEC 2 self-override (per-agent) врезается здесь как module-registered checker.**
3. `findTarget` (al.ts:320→359): `targetRole`→`findByRole`, иначе `TARGET_FINDERS.get(key)`. ← **cross-agent reach (A→T): T-сторонняя осведомлённость о наложенном модификаторе резолвится тут.**
4. `checkPostTargetRequirements` (al.ts:323→280): universal maxWitnesses/sentimentBelow + `POST_TARGET_REQUIREMENT_CHECKERS`. ← **гейты, которым нужен резолвленный target (cross-agent/zone) живут здесь.**
→ если target != null → `computeUtility` (al.ts:162→447) → score → если ≥ MIN_SCORE кладётся в `scored[]` → LLM решает (`llmDecideAndBuild`).

Реактивный путь идентичен, но через `checkRequirementsReactive` (al.ts:333) — mood-гейт намеренно пропущен (события важнее настроения), остальные гейты те же.

`computeUtility` (al.ts:447) — 6 каналов: personality (OCEAN+H через `TRAIT_MAP`:391), mood (`moodCurve`), relationship (`sentimentCurve`), belief modifiers, trust, и `SCORING_CONTRIBUTORS` (al.ts:486). ← **сила модификатора, масштабируемая от belief(self)/sentiment(target), идёт сюда как scoring contributor — НЕ в гейт.** Возможность (бинарно) и сила (непрерывно) — два разных слоя; смешивать опасно (см. risks).

**Bilateral path (игрок):**
`validatePlayerAction` (al.ts:510) — отдельная функция «можно ли». Находит аффорданс (517), проверяет period (524), затем итерирует ТОЛЬКО `REQUIREMENT_CHECKERS` (al.ts:532, тот же реестр что у NPC — паритет INV-17), затем co-location явно переданного targetId (539). **НЕ вызывает `checkPostTargetRequirements`** → post-target чекеры для игрока не применяются. Сейчас функция экспортируется (`index.ts:57`) но к серверному player-action эндпоинту НЕ подключена (в `routes.ts` только debug `force-affordance`:1055 для NPC).

**Tick lifecycle (SPEC 1 decay/anneal):**
`world.ts:561` — главный per-tick цикл над `ctx.agents` (включая игрока — билатерально): `_computeMoodTick` пересчитывает `mood = clamp(baseMood + Σ modifierEffective(m))` (world.ts:549-550, INV-06); сразу после — `decayAttribute` + `driftAttribute` по всем B1-атрибутам (world.ts:592). Затем `_handlePhaseHandlers` (world.ts:1367) крутит `getTickPhaseHandlers()` (1382). ← **plastic decay/anneal + жизнь affordance-модификаторов врезается через `registerTickPhaseHandler` (бесплатно билатерально, т.к. цикл над всеми агентами).**

**Deformation machinery, которую переиспользует SPEC 1:**
- Эластичная (mood): `addModifier`:611 (единственная точка мутации, INV-06), `MoodModifier` decay-модель `exponential|linear|none` (world-types.ts:5), `modifierEffective` пружинит к baseMood.
- Пластичная (B1): `ScalarAttribute` = `base + min/max + modifiers[] + drift?` (attributes.ts:26). `adjustAttributeBase`:674 в world.ts УЖЕ делает перманентный сдвиг базы (= «plastic set»). `driftAttribute`:76 — экспоненциальный/линейный дрейф базы (= «annealing» knob, опциональный).
- `bigFive` живёт на ИММУТАБЕЛЬНОМ `AgentProfile`:92 (29 чтений в движке по 11 файлам + 4 модульных). `TRAIT_MAP`:391 — ЗАКРЫТАЯ типизированная 6-ключевая запись. SPEC 1 «open axes» + «деформируемая personality» требует переноса чтений на effective()-аксессор и снятия типовой замкнутости TRAIT_MAP.

**Key decisions / patterns:**
1. Возможность vs сила разделены: гейты (`checkRequirements`) бинарны, `computeUtility` непрерывен (al.ts:304 vs 447). SPEC 2 self/cross override как module-data: «можно/нельзя» → checker-реестр; «насколько хочется» → scoring contributor.
2. Открытый словарь требований: `AffordanceRequirement[key]:unknown` + generic-итерация (al.ts:27, 269) — ноль движковой лексики (INV-14). Существующие модули (crime/economy) уже регистрируют ~15 чекеров так (crime-justice/index.ts:74-109, economy/index.ts:63-70).
3. Зеркало проактив/реактив через общий `checkRegistryRequirements`/`checkPostTargetRequirements` — одна врезка покрывает оба, КРОМЕ player-пути (отдельный).
4. Существующий transient personality-shift — `getStressGrowthDirective` (personality-prose.ts:46): чисто prompt-текст по live mood, без состояния. Это НЕ деформация — плойность нужно делать state-backed, а не навешивать на неё.

**Gotchas:**
- `validatePlayerAction` не зовёт post-target чекеры (al.ts:510 vs 280) — потенциальная дыра паритета для SPEC 2.
- Зоны (`LocationDef`) не имеют состояния и не итерируются tick-циклом (world.ts:561 = только agents) — «zone Z» как источник модификатора негде хранить и нечем тикать сегодня.
- Реестры process-global mutable; тесты должны их чистить (`clearScoringContributors`:445 есть, для `REQUIREMENT_CHECKERS` — нет).
- `isPlayer`-гайды разнятся по путям: volition исключает игрока, tick/perception — включают. Tick-хендлер плойности билатерален «бесплатно».

**Referenced answers:**
- Q: Где врезается «A/zone Z меняет множество возможных действий T»? / A: возможность — в `REQUIREMENT_CHECKERS` (self, al.ts:269/318) и `POST_TARGET_REQUIREMENT_CHECKERS` (нужен target T, al.ts:280/297); reach к T — в `TARGET_FINDERS`/`findTarget` (al.ts:359) + `getCoPresent` (perception.ts:55); сила (belief/sentiment-scaled) — в `SCORING_CONTRIBUTORS`/`computeUtility` (al.ts:438/447).
- Q: Билатеральный путь? / A: `validatePlayerAction` (al.ts:510), тот же `REQUIREMENT_CHECKERS` (532), НО без post-target — врезку SPEC 2 надо завести в ОБА (или достроить post-target в player-путь).
- Q: Где тикает plastic decay/anneal? / A: `registerTickPhaseHandler` (event-registry.ts:696) → `world.ts:1382`; рядом — деформ-машинерия mood (world.ts:549) и B1 drift (world.ts:592, attributes.ts:76).

**Not explored (вне фокуса):**
- Внутренности `il.ts` (IL claim→addBelief паритет) — упомянут как seam, не трассирован.
- `instinct-builder.ts` / `buildDecisionPrompt` prose-генерация (читает bigFive, но это рендер, не гейт).
- CG-движок (`cg-engine.ts`) и belief/relationship внутренности (seam'ы SPEC 1 magnitude-scaling) — не входили в фокус AL/perception/zones.
- Сохранение/загрузка (INV-21 defaults) новых плойность/модификатор-полей — не проверял.