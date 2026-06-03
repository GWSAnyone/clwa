# SPEC: Affordance-Space Modifier (универсальный override множества возможных действий)

> **Milestone**: M9 (Affordance-Space Modifier) — *proposed*. Sequenced ПОСЛЕ M8 Personality Plasticity (locked-scope: Тип I зависит от plasticity-seam «применение силы стоит куска себя»; реализация — после M8).
> **Status**: ✅ SPEC ГОТОВА к реализации (proposed v0.20.0) — clwa-auditor: **READY-AFTER-FIXES** (2 MUST + SHOULD внесены) + **cold-start fidelity 84/100 → доострено** (consequential-step предикат, worked-example player-gate, типизация zoneOverridesFor, permit-scope, греп-тест). 43/43 код-якорей верифицированы, чисто по всем 9 архитектурным проверкам. 2026-06-01.
> **Depends on**: M8 Personality Plasticity (seam «ability-use → plasticity cost»); AL pipeline (`al.ts`: `checkRequirements` / `checkRequirementsReactive` / `validatePlayerAction` / `computeUtility` / `registerScoringContributor`); perception (`getCoPresent`); locations/zones (`world-types.LocationDef`); ScalarAttribute (B1, `attributes.ts`); beliefs (`getMaxConfidenceFor`) + relationships (`getRelationship().sentiment`) — для strength-scaling.
> **Created**: 2026-06-01
> **Source of truth**: this design workflow (canonical design + 5 adversarial lenses) + `docs/CONCEPT_Negation.md` §6.4/7.3 as the *breadth compass* (a brainstorm that bounds the design space — **NOT a build target**; the engine must never contain the words Negation/trauma/wound/debt). Line-anchors verified against `packages/engine/src`.

---

## Цель

Дать движку **genre-neutral примитив**, которого сейчас нет: **состояние агента или зоны может переопределять
МНОЖЕСТВО ВОЗМОЖНЫХ ДЕЙСТВИЙ для цели** — для себя (per-agent self-override, дёшево), для другого агента
(cross-agent), или для всех агентов в зоне (zone — «активный не-агентный объект реальности»). Это «третий
столп» модели состояния (AFFORDANCES = что ВОЗМОЖНО), параллельный двум уже существующим (PERSONALITY = кто ты;
BELIEFS = что ты считаешь истиной).

Сила override может **масштабироваться от убеждений** носителя (self-belief) и от **сентимента** к цели —
переиспользуя существующие beliefs/relationships. Использование override — это **триггер personality plasticity**
(seam к M8: «использовать силу = заплатить куском себя»).

Движок владеет **законом** (как override-записи матчатся, комбинируются, затухают, сохраняются, гейтят
bilateral); модули владеют **всем вокабуляром** (что override значит, что его триггерит, чего он стоит). Движок
НИКОГДА не содержит слов Negation / trauma / wound / debt / curfew — это данные модулей.

Success-test (НЕ строим его, проверяем выразимость): мир «Отрицание» (Тип I = self-override + plasticity-cost;
Тип II = cross-agent/zone override, масштабируемый от belief/sentiment; «никто не делает оба» как module-правило)
должен быть выразим **как чистые данные модуля** поверх двух engine-слоёв (M8 + M9), без единой engine-правки и без
engine-знания о «Отрицании».

---

## Анализ

### Третий столп: «что ВОЗМОЖНО» как изменяемое состояние

Сегодня множество возможных действий агента вычисляется **только** из статичных `AffordanceRequirement` через
gate (`checkRequirements`, `al.ts:304`). Возможность бинарна и **одинакова для всех** агентов в одинаковом
контексте — нет механизма «у ЭТОГО агента/в ЭТОЙ зоне набор возможного иной». CONCEPT_Negation §6.4/7.3 называет
ровно этот недостающий кусок «главным новым куском»: «агент A меняет множество возможных действий агента B / в
зоне Z». Мы строим именно его — широко и genre-neutral.

Физическая аналогия (как и в M8 plasticity): requirement — это **постоянная форма** объекта; affordance-override —
**внешнее поле**, которое временно (или постоянно) деформирует, что объект может делать, не меняя сам объект.
Поле может ЗАПРЕТИТЬ действие (`forbid` — убрать из множества) или РАЗРЕШИТЬ обычно-закрытое (`permit` — вернуть в
множество). `permit` — несущий: без него «affordance-space modifier» вырождается в «ещё один блокатор»; именно
`permit` делает это настоящим override **пространства** возможного (сила, которая ВКЛЮЧАЕТ обычно-невозможное).

### Почему это genre-neutral

Override несёт только **структуру**: `match`-предикат над полями affordance (id / category / tags / severity),
`mode: forbid|permit`, lifecycle (remaining/duration как у `MoodModifier`/`AttributeModifier`), опциональная
`strength` для scoring. Движок матчит структурно (членство в множестве, числовое сравнение) и НИКОГДА не сравнивает
`source`/`category` с литералом. «Дверь заперта, пока не держишь ключ» (puzzle), «комендантский час в районе»
(survival), «силовое подавление» (Negation Тип II) — все это ОДНА `forbid`/`permit`-запись с разными module-данными,
без правки движка. Этот опаковый-строковый дисциплинированный матчинг — **инвариант** (см. DD-AM-09).

### Трихотомия: per-agent / cross-agent / zone

| Тип проекции | `sourceKind` | Кто хранит | Кого гейтит | CONCEPT-привязка |
|---|---|---|---|---|
| **Self-override** (per-agent) | `'agent'`, `sourceId===self` | сам агент | себя | Тип I (внутреннее, дёшево — расширение requirement-checkers) |
| **Cross-agent** | `'agent'`, `match.targetId===T` | source-агент | агента T (если co-present) | Тип II (внешнее, на другого) |
| **Zone** | `'zone'`, `sourceId===locId` | `ZoneState` локации | всех агентов в локации | Тип II (на среду) + «активный объект реальности» |

Хранение **на источнике** (DD-AM-03) даёт проектору чистое владение lifecycle/удалением (как агент владеет своими
mood-модификаторами); **оценка target-центрична** — gate выполняется ВНУТРИ `checkRequirements`/`validatePlayerAction`
самой цели T, собирая override'ы, спроецированные на T. Cross-agent ограничен **co-presence** (`getCoPresent`,
`perception.ts:55`) — проекция пространственно обоснована и дёшева.

### Отношение к существующим примитивам (REUSE, не изобретать)

- **Lifecycle/decay** override'а **байт-в-байт** как `AttributeModifier`/`MoodModifier`: `remaining`/`duration` +
  splice-on-expiry (`attributes.ts:61` `decayAttribute`, `world.ts:592`). Новой машинерии lifecycle нет.
- **Зона как объект реальности** переиспользует `ScalarAttribute` (B1) для своих атрибутов — та же
  base+modifiers+drift деформация, что у агентов (`attributes.ts`). Ноль новой математики; strength override'а
  зоны может масштабироваться от её атрибута.
- **Gate-vs-score разделение**: возможность бинарна (gate `checkRequirements`); привлекательность непрерывна
  (`registerScoringContributor`, `al.ts:439`). `computeUtility` (`al.ts:447`) gate-независим — запрещённое действие
  возвращает `null` в `checkRequirements` (`al.ts:321`) ДО scoring. Смешивать их — центральная ошибка (DD-AM-01).
- **Strength-scaling reads существуют**: `beliefs.getMaxConfidenceFor` (`beliefs.ts:82`), сырой
  `relationships.getRelationship().sentiment`, `getAttributeValue` (`attributes.ts:94`). Модуль даёт ключи; движок
  нейтрален (INV-14).
- **Enneagram stress/growth** (`personality-prose.ts`) уже даёт ВРЕМЕННЫЕ поведенческие сдвиги (elastic, prose-only,
  через mood-band). Affordance-override — **ортогональный** механизм (меняет ВОЗМОЖНОЕ, не настроение); они
  композируются без double-count: zone-override может изменить, что возможно, но не пишет в mood/Enneagram.

### Критические находки против реального кода (сверено)

Пять adversarial-линз нашли несколько **load-bearing ошибок** в исходном canonical-дизайне, которые ОБЯЗАНЫ быть
учтены в этой спеке (а не повторены):

1. **`validatePlayerAction` — мёртвый код**: определена `al.ts:510`, реэкспортируется `index.ts:57`, и **ноль
   production-вызовов** во всём репозитории (сверено grep'ом). Живой player-path — IL speech-acts через pressure-
   handlers (`server/src/index.ts:161-202`, через `server.ts:246` `applyDialogueMeaning`) — БЕЗ affordance-gate.
   `docs/_archive/clwa-buddy.md:63` уже фиксирует это как известный дефект. → bilateral-паритет НЕ достигается
   одной вставкой в `validatePlayerAction`; player-gate нужно **оживить** (DD-AM-06).
2. **0.1-floor confidence НЕ существует на read-path**: `getMaxConfidenceFor` (`beliefs.ts:82-90`) возвращает
   `0` при отсутствии совпадающего belief'а (`let max = 0`); floor `Math.max(0.1, …)` живёт ТОЛЬКО в `decayBeliefs`
   (`beliefs.ts:115`) и срабатывает лишь для УЖЕ существующего belief'а при дневном decay. → чисто мультипликативный
   belief-scale с нулём убеждений = мёртвая запись. Strength-scaling ОБЯЗАН быть **additive** (`base + weight·conf`),
   не мультипликативным (DD-AM-08).
3. **`ScoringContributorFn` не имеет target**: сигнатура `(aff, agent) => number` (`al.ts:437`), вызывается
   `c(aff, agent)` (`al.ts:486`) без цели — `fromSentimentToTarget` неразрешим в scoring как задумано. →
   расширяем контракт до `(aff, agent, target?) => number` (additive, backward-совместимо) (DD-AM-07).
4. **Нет zone-carrier**: `LocationDef` (`world-types.ts`) — статический config (id/name/connections/isPublic),
   не итерируется tick-loop'ом. → новый `World.zoneStates: Map<locId, ZoneState>` (DD-AM-05).
5. **`AffordanceContext` не имеет доступа к zone-state**: единственный production-чокпойнт построения —
   `buildAffordanceContext` (`world.ts:1772`). → добавляем **обязательную** (не optional) engine-populated closure
   туда (DD-AM-05, hot-path §«Lifecycle + tick»).
6. **Gate только decision-time**: закоммиченные goals исполняются через `processGoalTick` (`world.ts:1236`) БЕЗ
   повторной проверки requirements. → нужен **execution-time re-gate** в момент исполнения шага (DD-AM-10).
7. **Нет per-tick event-stream** для plasticity-триггера: `TickPhaseContext` не несёт «события этого тика»;
   `eventStore` — вся история. → seam M8↔M9 строится на ОДНОМ shared execution-hook'е, не на tick-сканировании
   `eventStore` (DD-AM-11).

---

## Проектные решения

### DD-AM-01 — Gate (возможность) и scoring (привлекательность) — физически РАЗНЫЕ пути

`forbid`/`permit` едут на **бинарном** requirement-gate (`checkRequirements` + `checkRequirementsReactive` +
`validatePlayerAction`); `strength` едет на **непрерывном** scoring-канале (`registerScoringContributor`). Они
делят одну `AffordanceOverride`-запись, но это два разных кода-пути.

- **Rationale**: `computeUtility` (`al.ts:447`) gate-независим — непрерывный score не может сделать действие
  невозможным, бинарный gate не может выразить «привлекательнее». Запрещённое действие возвращает `null` в
  `checkRequirements` (`al.ts:321`) ДО того, как scoring вообще запускается (`volition.ts:160-163`) — два пути не
  могут разойтись («scored but impossible» / «possible but never chosen» — failure-режим, который code-map
  предупреждает).
- **Rejected**: единое значение `[-1,1]`, свёрнутое в `computeUtility` (сильный отрицательный score
  маскируется под gate, но не убирает действие из множества — ломает `validatePlayerAction`, у которого нет
  scoring вообще).

### DD-AM-02 — Gate — УНИВЕРСАЛЬНАЯ engine-owned pre-target функция, не module-checker и не post-target

Override-gate — одна shared функция `isAffordanceForbidden(aff, agent, ctx)`, вызываемая из `checkRequirements`,
`checkRequirementsReactive` И `validatePlayerAction`. НЕ запись в `REQUIREMENT_CHECKERS` (модули её не регистрируют),
НЕ `POST_TARGET_REQUIREMENT_CHECKERS`.

- **Rationale**: INV-16/17 bilateral. `validatePlayerAction` (`al.ts:510-559`) переитерирует requirements
  самостоятельно и НЕ вызывает `checkPostTargetRequirements` (`al.ts:323` — только NPC) — любой post-target
  override молча пропустил бы игрока. Pre-target общая функция держит **закон в движке**, а вокабуляр в модулях
  (INV-14): модули поставляют только данные на carrier'ах, не логику gate.
- **Rejected**: обычный module `REQUIREMENT_CHECKER` (bilateral, но толкает закон override-оценки в module-space
  + риск, что модуль забудет зарегистрировать); `POST_TARGET_REQUIREMENT_CHECKER` (ломает player-паритет).

### DD-AM-03 — Хранение на источнике, оценка на цели

Override хранится на источнике (`AgentState.affordanceOverrides` или `ZoneState.affordanceOverrides`), но
оценивается target-центрично: при проверке, может ли агент T сделать A, движок собирает override'ы, спроецированные
на T, из: (a) собственных T-self override'ов (`sourceId===T`), (b) `ZoneState` локации T, (c) co-present
проекторов S с `match.targetId===T`.

- **Rationale**: storage-on-source даёт проектору чистое владение lifecycle/удалением (как mood-модификаторы).
  Evaluation-on-target обязательна — gate бежит внутри `checkRequirements`/`validatePlayerAction` самой T.
  Co-presence (`getCoPresent`) ограничивает cross-agent-скан текущей локацией — дёшево и пространственно обосновано.
- **Rejected**: глобальный реестр override'ов, сканируемый для каждой пары (agent, affordance) (O(overrides) на
  проверку, без пространственного bound'а); хранение на TARGET (проектор теряет владение, удаление = cross-agent
  reach-in).

### DD-AM-04 — Precedence: forbid побеждает, кроме строго-более-специфичного permit; ничья → forbid (fail-closed)

При нескольких применимых override'ах: любой совпавший `forbid` побеждает, ЕСЛИ нет `permit` со **строго более
специфичным** `match`, нацеленным на то же действие. Специфичность: `affordanceIds` > `categories` > `tags` >
`minSeverity` > пустой. Равная специфичность → `forbid` (fail-safe-closed). Результат — **множество-операция**
(fold), а НЕ зависящая от порядка последовательность (DD-AM-12).

- **Rationale**: zone-комендантский (forbid all by category), который личная сила (permit this exact id)
  пробивает — канонический Тип-II-vs-Тип-I сценарий. Специфичность делает «таргетированное исключение бьёт бланковый
  бан» детерминированным. Fail-closed на ничьей не даёт случайному permit разблокировать base-game requirement.
- **Rejected**: permit всегда побеждает (god-mode); strength-weighted resolution (strength — scoring-концепт по
  DD-AM-01, не должен течь в бинарный gate); last-registered-wins (недетерминирован через save/load).

### DD-AM-05 — Zone — НОВЫЙ параллельный mutable store (`World.zoneStates`), reuse `ScalarAttribute`

`World.zoneStates: Map<locationId, ZoneState>` (lazy `getOrCreateZoneState`), отдельно от статического
`LocationDef`. `ZoneState = { attributes?: Record<string, ScalarAttribute>; affordanceOverrides?: AffordanceOverride[] }`.
Доступ gate к зоне идёт через **обязательную** engine-populated closure `ctx.zoneOverridesFor: (locId: string) => AffordanceOverride[]` (audit MUST — типизирована явно; `buildAffordanceContext` собирает per-pass индекс `location → AffordanceOverride[]` ОДИН раз на decision, gate лишь match-тестит против него → это и держит O(1) early-out) в
`buildAffordanceContext` (`world.ts:1772`).

- **Rationale**: `LocationDef` (`world-types.ts`) — неизменяемый world-config без mutable-поля, не в tick-loop'е.
  «Зона как активный объект реальности» сегодня не имеет дома. Параллельная state-карта по locId, lazy, даёт зоне
  first-class состояние без загрязнения config'а и переиспользует ровно ту же деформацию, что у агентов. Closure в
  единственном production-чокпойнте (`buildAffordanceContext` — проходят оба пути: proactive `world.ts:1174`,
  reactive `world.ts:258`, и player-path после DD-AM-06) гарантирует, что zone-overrides не «молча no-op» на
  какой-то ветке.
- **Rejected**: mutable-поля на `LocationDef` (мешает config и runtime, ломает world-editor, пишущий LocationDef
  дословно); моделировать зону скрытым Agent'ом (зоны не агенты — попали бы в volition/perception/movement loops и
  isPlayer-guarded пути). Optional `ctx.zoneOverridesFor?` (молчаливый no-op на забытой ветке — корректностная дыра,
  не ловится tsc).

### DD-AM-06 — Bilateral-паритет требует ОЖИВИТЬ player-gate (validatePlayerAction сегодня мёртв)

`validatePlayerAction` имеет **ноль live-вызовов**. Поэтому одной вставки `isAffordanceForbidden` недостаточно для
паритета. M9 ОБЯЗАН провести реальный player-action-путь через gate. Решение: добавить `isAffordanceForbidden`-
проверку **в точке, где живой player-path исполняет действие** (IL pressure/speech-act handler в
`server/src/index.ts`, и любой будущий explicit player-action endpoint), И сделать `validatePlayerAction` реальным
gate'ом — она вызывает `checkPostTargetRequirements` после разрешения цели (выравнивая requirement-поверхность с NPC,
DD-AM-13), затем `isAffordanceForbidden`. Player-gate — **hard precondition** фаз cross-agent/zone (P3/P4), а не
one-line вставка.

  **Worked example (audit MUST — конкретизирует «оживление»):** живой player-path сегодня — IL/pressure-handler
  `applyDialogueMeaning` в `server/src/index.ts:161-202`. Проводка: player speech-act `threaten` → модуль мапит на
  `affordanceId: 'threaten'` (уже зарегистрированный verb) → перед эмитом действия server зовёт
  `isAffordanceForbidden('threaten', targetAgent, ctx)`; если zone-/cross-agent-`forbid` накрывает игрока → действие
  отклоняется с `'Action not currently possible'`. Маппинг speech-act→affordanceId — **module-данные** (INV-14):
  движок получает готовый `affordanceId`. Без этого worked-path gate уедет в мёртвый `validatePlayerAction` = театр.

- **Rationale**: INV-16/17 — единственный честный путь к «игрок гейтится как TARGET override'а» (zone-комендантский
  бьёт игрока; cross-agent forbid NPC бьёт игрока). Без живого вызова player-as-target — недостижим.
- **Rejected**: утверждать паритет «бесплатно» вставкой в мёртвую функцию (паритет остаётся теоретическим);
  оставить player вне gate (прямое INV-16-расхождение: каждый NPC гейтится, игрок — нет).

### DD-AM-07 — `ScoringContributorFn` расширяется target-аргументом (additive)

`ScoringContributorFn = (aff: AffordanceDefinition, agent: Agent, target?: AffordanceTarget) => number`. Существующие
contributor'ы (economy gold/HP) игнорируют 3-й аргумент — backward-совместимо. `computeUtility` уже имеет `target`
(`al.ts:447`, читает `rel` через него на `al.ts:461`) — просто прокидывает его в `c(aff, agent, target)`.

- **Rationale**: `fromSentimentToTarget` масштабирует strength по сентименту к ЦЕЛИ; без target в contributor'е
  неразрешим. Расширение сигнатуры — маленькая additive-правка, не ломает ни один существующий contributor.
- **Rejected**: складывать permit-strength прямо в relationship-блок `computeUtility` (зашивает override-знание в
  ядро scoring, минуя registry-канал — нарушает разделение «модуль регистрирует канал»).

### DD-AM-08 — Strength-scaling — ADDITIVE поверх базы, не мультипликативный (0-floor-defence)

`resolveOverrideStrength` стартует с `ov.strength ?? 1` и **прибавляет** взвешенные вклады каждой scale-клаузы:
`base + Σ weight·signal`, затем clamp в `[0,1]`. НЕ `base · Π(weight·signal)`.

- **Rationale**: `getMaxConfidenceFor` (`beliefs.ts:82`) возвращает **0** при отсутствии belief'а (floor 0.1 —
  только в `decayBeliefs`, на read-path не применяется). Мультипликативный belief-scale с нулём убеждений = мёртвая
  запись (strength=0). Additive: «нет belief'а ⇒ strength = base», belief даёт бонус. Null-relationship даёт 0
  вклад в свою клаузу (совпадает с `al.ts:461` семантикой), но не зануляет всю strength.
- **Rejected**: чисто-мультипликативный scale (footgun: модуль-автор думает «belief усиливает», получает «нет
  belief'а ⇒ ничего не работает»).

### DD-AM-09 — Опаковый-строковый дисциплинарный инвариант (INV-14 hard gate)

`isAffordanceForbidden`, `resolveOverrideStrength` и встроенный scoring-contributor ОБЯЗАНЫ трактовать
`source`/`category`/`match.*` как **опаковые строки** — НОЛЬ `=== <литерал>` сравнений. Матчинг только структурный:
членство в `match.affordanceIds`/`categories`/`tags`, числовое `minSeverity`, `match.targetId===gatedAgent`.

- **Rationale**: INV-14. Движок никогда не должен знать, что override «значит». Architecture-тест получает (a)
  grep на `Negation|trauma|wound|debt|curfew` по `engine/src` и (b) synthetic-module-probe: модуль регистрирует
  forbid новой category, `isAffordanceForbidden` чтит его с НУЛЁМ engine-правок.
- **Rejected**: ветвление на `ov.category === 'power'` и т.п. (утечка module-вокабуляра в движок).

### DD-AM-10 — Execution-time re-gate: forbid останавливает действие в полёте

Override проецируется и снимается в любой момент. `forbid`, наложенный ПОСЛЕ коммита goal'а, обязан остановить
исполнение. Движок повторно вызывает `isAffordanceForbidden` для actor+affordance в момент исполнения
консеквентного шага в `processGoalTick` (goal уже хранит `data.affordanceId`, `volition.ts:185`) и
abort'ит/replan'ит goal, если действие стало forbidden.

- **Rationale**: канонический Тип-II сценарий («A подавляет силу T прямо сейчас») — именно поздняя реактивная
  проекция. Gate только на decision-time промахивается по мульти-тиковому goal'у (travel → act). Без execution-re-gate
  override молча неэффективен против закоммиченного goal'а.
- **Rejected**: gate только decision-time (корректностная дыра — forbidden действие выстреливает из
  закоммиченного goal'а).

### DD-AM-11 — Plasticity-seam — ОДИН shared execution-hook, опаковый blob, одно-направленно

Seam M8↔M9 («использование override = plasticity-триггер») едет на ОДНОМ engine-hook'е
`onActionExecuted(actorId, affordanceId, target?, usedOverrideId?)`, эмитируемом в **точке исполнения** действия
(NPC goal-path И player-path), а НЕ на воображаемом per-tick event-stream'е. M8 plasticity-evaluator подписывается
на тот же hook; override несёт опаковый `plasticityTrigger`-blob, который движок форвардит, никогда не читая поля.

- **Rationale**: `TickPhaseContext` не несёт событий этого тика; `eventStore` — вся история (скан per-tick =
  O(events·agents), неограничен). `onMoodChange` bilateral, потому что едет на all-agent tick'е — `onAffordanceOverrideUsed`
  на одном NPC-only action-path НЕ был бы bilateral; поэтому seam привязан к `onActionExecuted`, эмитируемому ОБОИМИ
  путями. INV-14: движок не знает, что override «стоит куска себя» (это Negation/trauma-концепт модуля). Optional
  trigger ⇒ бесплатная сила. Это Тип-I как чистые данные.
- **Rejected**: движок прямо зовёт plasticity-функцию (couples M9 к M8 в движке, зашивает «cost»-семантику);
  привязка к tick-сканированию `eventStore` (нереализуемо + неограниченный hot-path).

### DD-AM-12 — Equal-specificity — порядко-независимый fold (save/load-стабильность)

При равной специфичности бинарный исход порядко-независим: gate спрашивает «есть ли ХОТЬ ОДИН побеждающий forbid,
который не перебит строго-более-специфичным permit'ом» — это множество/fold-операция, не последовательность.
`isAffordanceForbidden` вычисляет max-специфичность-forbid vs max-специфичность-permit как fold, поэтому порядок
массивов (и save/load-порядок) не влияет.

- **Rationale**: override'ы живут в трёх местах (self, co-present-проекторы, zone), сериализуются массивами;
  merged evaluation-порядок при равной специфичности иначе не определён. Strength не может быть tie-breaker'ом
  (DD-AM-01).
- **Rejected**: array-order-dependent application (недетерминирован через save/load); strength-weighted tie-break
  (утечка scoring в gate).

### DD-AM-13 — `validatePlayerAction` выравнивается с NPC requirement-поверхностью

При оживлении player-gate (DD-AM-06) `validatePlayerAction` после разрешения target вызывает
`checkPostTargetRequirements` (как `checkRequirements`, `al.ts:323`), затем `isAffordanceForbidden`. Так player и
NPC получают идентичный allow/deny для одного affordance+target+override-состояния, включая post-target gates
(maxWitnesses/sentimentBelow/noGuardNearby).

- **Rationale**: иначе `permit`/`forbid` взаимодействуют с РАЗНОЙ requirement-поверхностью на двух сторонах
  (player сегодня пропускает post-target целиком). Bilateral-паритет требует одинаковую поверхность.
- **Rejected**: оставить player без post-target (structural bilateral-асимметрия, скрытая дыра).

### DD-AM-14 — Override'ы НЕ консервируются, нет transfer-API

В отличие от `transferAttribute` (`world.ts:707`), override'ы проецируются/снимаются, не перемещаются. API:
`addAffordanceOverride`/`removeAffordanceOverride`/`getAffordanceOverrides` (+ zone-аналоги).

- **Rationale**: «перенос» override возможности между агентами бессмыслен и был бы footgun. Проектор ДОБАВЛЯЕТ
  override, нацеленный на другого; он не отдаёт свой.
- **Rejected**: `transferOverride` (нет когерентной семантики).

### DD-AM-15 — `minSeverity` — чистое числовое упорядочивание без семантического притязания

`AffordanceDefinition.severity` (`al.ts:97`) документирован как «1-10, for witness reactions» (perception-tuned).
`match.minSeverity` переиспользует его как чистый числовой ordering-key БЕЗ притязания «severity == restrictability».
Жанры, не наполняющие severity осмысленно, просто опускают `minSeverity`-клаузы и матчат по `tags`/`categories`
(основной genre-neutral селектор).

- **Rationale**: убирает скрытое предположение «выше severity == более ограничиваемо». Документированная оговорка
  дешевле, чем новый параллельный scale.
- **Rejected**: молча трактовать severity как restrictability-scale (импортирует perception-предположение в
  universal-слой).

### DD-AM-16 — Lifecycle override'а на смерть/отсутствие источника

Cross-agent override с `remaining>0`, чей source умер/отсутствует (или после load), не должен продолжать гейтить
цель. `isAffordanceForbidden` для cross-agent-проекции требует source быть **alive + co-present** (что `getCoPresent`
уже даёт для «врозь»-случая; для detained-yet-present source — явная проверка `alive`). На load цель-центричный скан
естественно отбрасывает мёртвых проекторов (их нет в co-present-наборе).

- **Rationale**: иначе post-load reconstruction «воскрешает» эффект удалённого актора. Self/zone override'ы не
  зависят от живого внешнего источника.
- **Rejected**: гейтить от мёртвого/отсутствующего source (ghost-эффект через save/load).

---

## Спецификация реализации

### 1. Data model

#### 1.1 `affordance-modifier.ts` (НОВЫЙ, genre-neutral, zero module-strings)

```ts
// engine/src/affordance-modifier.ts
import type { AffordanceDefinition, AffordanceContext, AffordanceTarget } from './al';
import type { Agent } from './agent';
import type { ScalarAttribute } from './attributes';

export type OverrideMode = 'forbid' | 'permit';
// 'forbid' = remove from possible set; 'permit' = restore an otherwise-gated action.

export interface AffordanceMatch {
  /** Exact affordance-id allow/deny list (most specific). */
  affordanceIds?: string[];
  /** Match aff.category. */
  categories?: string[];
  /** Match aff.tags (open field, see 1.4). */
  tags?: string[];
  /** Match aff.severity >= n. Pure numeric ordering, NO semantic claim (DD-AM-15). */
  minSeverity?: number;
  /** Cross-agent: override applies only when the GATED agent === targetId. Co-presence required (DD-AM-03). */
  targetId?: string;
}

export interface AffordanceStrengthScale {
  /** ADD weight·confidence of the bearer's beliefs whose SUBJECT the module designates as self.
   *  Engine calls getMaxConfidenceFor(selfId, eventTypeMatcher); module supplies selfId-as-subject + matcher.
   *  NOTE: getMaxConfidenceFor returns 0 (NOT 0.1) when no matching belief exists — additive base defends this. */
  fromSelfBelief?: { eventType: string; weight: number };
  /** ADD weight·sentiment toward TARGET (cross-agent). RAW rel.sentiment (-1..1), NOT the crime-tuned
   *  sentimentCurve. Null relationship contributes 0. abs → use |sentiment|. */
  fromSentimentToTarget?: { weight: number; abs?: boolean };
  /** ADD weight·effectiveValue of a zone/agent attribute (open key). */
  fromAttribute?: { key: string; weight: number };
}

export interface AffordanceOverride {
  id: string;                          // uuid — dedup/removal key
  source: string;                      // human-readable origin (module string, NEVER engine vocab; OPAQUE)
  category: string;                    // stacking/removal group (module-defined; OPAQUE)
  sourceKind: 'agent' | 'zone';        // who projects: agent id | location id
  sourceId: string;
  match: AffordanceMatch;              // AND over present clauses; empty match = matches every action
  mode: OverrideMode;
  remaining: number;                   // game minutes left; 0 = permanent until removed
  duration: number;                    // original duration (parity with modifier model; informational)
  strength?: number;                   // SCORING only (never possibility). Undefined ⇒ base 1 for scaling.
  strengthScale?: AffordanceStrengthScale;
  /** SEAM to M8: opaque trigger the plasticity layer consumes when this override is USED.
   *  Engine NEVER reads its fields (INV-14, DD-AM-11). */
  plasticityTrigger?: unknown;
}

export interface ZoneState {
  /** Open scalar attributes for the zone — SAME ScalarAttribute primitive as agents (reuse, no new math). */
  attributes?: Record<string, ScalarAttribute>;
  /** Affordance overrides this zone projects onto agents within it. */
  affordanceOverrides?: AffordanceOverride[];
}
```

#### 1.2 Carriers (все optional → INV-21 default-on-load)

- **Agent-borne** — `AgentState.affordanceOverrides?: AffordanceOverride[]` (`agent-types.ts:142`, рядом с
  `attributes`/`factions`/`inventory`). Хранит override'ы, которые этот агент **проецирует** (self:
  `sourceId===self`; cross-agent: `sourceId===self` + `match.targetId` цели). Optional ⇒ старые saves без него.
- **Zone-borne** — `World.zoneStates: Map<string, ZoneState>` (новое private-поле `world.ts`, lazy
  `getOrCreateZoneState`, чтобы локации без override'ов стоили ноль).
- **`AffordanceDefinition.tags?: string[]`** (НОВОЕ optional-поле, **добавляется в P1** — сейчас его НЕТ; `AffordanceDefinition` начинается на `al.ts:93`) — для `match.tags`; движок не присваивает
  смысла. Backward-compat: optional, отсутствует = нет тегов.

#### 1.3 Strength resolution

```ts
export function resolveOverrideStrength(
  ov: AffordanceOverride,
  bearer: { beliefs?: BeliefManager; relationships?: RelationshipGraph; attributes?: Record<string, ScalarAttribute> },
  targetId: string | undefined,
): number {
  let s = ov.strength ?? 1;                              // ADDITIVE base (DD-AM-08)
  const sc = ov.strengthScale;
  if (sc?.fromSelfBelief && bearer.beliefs) {
    const conf = bearer.beliefs.getMaxConfidenceFor(bearer.profile.id, // selfId-as-subject (audit SF1: NOT '')
      (et) => et === sc.fromSelfBelief!.eventType);     // engine-neutral matcher; module supplies the eventType
    s += sc.fromSelfBelief.weight * conf;               // conf=0 when no belief ⇒ adds nothing (not zeroes)
  }
  if (sc?.fromSentimentToTarget && targetId && bearer.relationships) {
    const rel = bearer.relationships.getRelationship(targetId);
    const raw = rel ? rel.sentiment : 0;                // RAW, null ⇒ 0 (matches al.ts:461)
    s += sc.fromSentimentToTarget.weight * (sc.fromSentimentToTarget.abs ? Math.abs(raw) : raw);
  }
  if (sc?.fromAttribute && bearer.attributes) {
    s += sc.fromAttribute.weight * (getAttributeValue(bearer.attributes, sc.fromAttribute.key) ?? 0);
  }
  return Math.max(0, Math.min(1, s));
}
```

> **Self-belief caveat** (документ для модуль-авторов): `getMaxConfidenceFor(subject, matcher)` фильтрует по
> `belief.subject` (КОГО belief касается — «кто сделал»), не по держателю. «Self-belief» здесь = belief'ы держателя,
> чей SUBJECT модуль назначает как self (selfId передаётся как subject-аргумент через matcher-конвенцию модуля).
> Движок не имеет engine-level self-belief-концепта (INV-14).

#### 1.4 `AffordanceDefinition.tags`

`tags?: string[]` на `AffordanceDefinition` (**НОВОЕ поле, добавляется в P1**; интерфейс начинается на `al.ts:93`). Чисто для override-матчинга (и будущего module-use). Open
string-set, движок не присваивает смысла. Позволяет модулю «forbid all violent actions» без перечисления id.

### 2. AL integration — bilateral, единый путь

#### 2.1 Gate: общая pre-target функция

```ts
// affordance-modifier.ts
/** Collect overrides projected ONTO `agent` (self + zone-of-agent-location + co-present projectors w/
 *  match.targetId===agent), apply forbid/permit with DEC-AM-04 precedence as an order-independent fold
 *  (DD-AM-12). Returns true if the action is removed from the possible set for THIS agent right now.
 *  FAST PATH: if no zone overrides and no co-present agent carries any override and agent has no self
 *  overrides → return false in O(1). This early-out is what keeps crime/economy oracle provably unchanged. */
export function isAffordanceForbidden(aff: AffordanceDefinition, agent: Agent, ctx: AffordanceContext): boolean;
```

Сбор применимых override'ов **хойстится один раз на (agent, decision)** — НЕ пересканируется на каждый affordance.
`buildAffordanceContext` строит per-pass индекс `location → projectedOverrides`; `isAffordanceForbidden(aff, …)`
лишь match-тестит против предсобранного небольшого списка. Это роняет inner-стоимость с O(affordances·agents) до
O(agents + affordances·overrides) и даёт O(1) early-out для universal-случая без override-данных.

Wiring (один shared чокпойнт — ноль split-brain):
- `checkRequirements` (`al.ts:304`): `if (isAffordanceForbidden(aff, agent, ctx)) return null;` сразу после
  universal pre-target gates (после `suppressNearPlayer`, `al.ts:315`, ДО `checkRegistryRequirements` `al.ts:318`),
  то есть **до** `findTarget`.
- `checkRequirementsReactive` (`al.ts:333`): та же строка после `al.ts:344`, **до** `findReactiveTarget`
  (`al.ts:349`) — чтобы forbidden-действие не достигло `eventBoost` (`volition.ts:267`). Reactive-путь намеренно
  релаксирует mood (`al.ts:342`), но override — **жёсткий** possibility-gate, не mood-relaxable (DD-AM-02): urgency
  не может сделать невозможное возможным.
- `validatePlayerAction` (`al.ts:510`): после period-gate (`al.ts:524`), и (DD-AM-13) после разрешения цели —
  `checkPostTargetRequirements` + `isAffordanceForbidden`. **Живой** player-path (DD-AM-06) проходит ту же
  проверку перед эмитом действия. Новая reason-строка: `'Action not currently possible'` (generic, без вокабуляра).

**Scope of `permit` (audit MF2):** на текущей wire-позиции `isAffordanceForbidden` стоит ПОСЛЕ engine-universal
pre-target gates (`period`/`moodBelow`/`suppressNearPlayer` уже вернули `null` до gate) и ДО `checkRegistryRequirements`
(они бегут после). Поэтому `permit` поднимает **ТОЛЬКО** override-`forbid` — он НЕ снимает period/mood/suppress и НЕ
снимает module `REQUIREMENT_CHECKERS`. Чтобы `permit` мог снять engine-universal gate, gate пришлось бы переместить
в САМЫЙ ПЕРВЫЙ check `checkRequirements` (меняет семантику) — **отложено** (Открытые вопросы); escape-hatch
`permit.liftCheckers?: string[]` для registry-requirements — тоже отложен. Тест-план не утверждает «permit снимает period».

#### 2.2 Scoring-канал: strength через расширенный contributor

`ScoringContributorFn = (aff, agent, target?) => number` (DD-AM-07). Движок поставляет ОДИН опциональный встроенный
contributor `affordanceOverrideScoringContributor`, **регистрируемый сервером на boot** (не auto-global — уважает
SCORING_CONTRIBUTORS test-isolation, `al.ts:445`). Он читает применимые к агенту `permit`-override'ы и прибавляет
`resolveOverrideStrength(ov, bearer, target?.targetId)` к `computeUtility`. Разделение чистое: gate решает ВОЗМОЖНО;
scoring решает ПРИВЛЕКАТЕЛЬНО (DD-AM-01). Нет «scored but impossible» (forbidden не скорится — `checkRequirements`
вернул `null` до scoring) и нет «possible but never chosen» сверх нормальной utility-динамики.

#### 2.3 Target-finders нетронуты

`findTarget`/`findReactiveTarget` (`al.ts:359`/`374`) НЕ модифицируются. Cross-agent override'ы оцениваются
target-центрично в `isAffordanceForbidden`, когда вычисляется возможное-множество самой цели T (A меняет набор T ⇒
`checkRequirements` T видит forbid). «Кого может A нацелить» не меняется.

#### 2.4 Execution-time re-gate (DD-AM-10)

В `processGoalTick`-цикле (`world.ts:1236`) перед исполнением консеквентного шага goal'а (у которого есть
`data.affordanceId`): повторно вызвать `isAffordanceForbidden(aff, actor, ctx)`; если forbidden — abort/replan goal
(не исполнять шаг). Affordance-id и override-контекст прокидываются в исполнение через уже хранимый
`goal.data.affordanceId`.

### 3. Belief/sentiment strength scaling

См. `resolveOverrideStrength` (§1.3). Ключевые genre-neutral-решения:
- **Belief**: `getMaxConfidenceFor(selfId, matcher)` (`beliefs.ts:82`); ADDITIVE (DD-AM-08); `conf=0` при
  отсутствии ⇒ нулевой вклад, не зануление; selfId/matcher — module-конвенция (INV-14).
- **Sentiment**: СЫРОЙ `getRelationship(targetId).sentiment` (НЕ `sentimentCurve` — та импортирует crime-tuned
  пороги, `al.ts:426`); null ⇒ 0 (DD-AM-07, совпадает с `al.ts:461`). Self-directed override'ы не имеют relationship-
  источника (`getRelationship(self)===null`) ⇒ падают на belief/attribute.
- **Attribute**: `getAttributeValue` (`attributes.ts:94`) — open-ключ; для zone-source читает `ZoneState.attributes`.

### 4. Lifecycle + tick

Переиспользуем tick `world.ts:556` `_tickMoodSystem` (bilateral — итерирует всех агентов incl. player):
- В per-agent-теле (рядом с decay атрибутов `world.ts:592`): `decayOverrides(agent.state.affordanceOverrides, 5)`
  (тот же dt=5, тот же `remaining-- / splice-on-expiry`, что `decayAttribute`).
- **Отдельный** малый цикл ПОСЛЕ agent-loop'а: decay override'ов каждого `ZoneState` (зоны не агенты, не в
  agent-loop'е). Атрибуты зоны (если есть) decay+drift через те же `decayAttribute`/`driftAttribute` на
  `ZoneState.attributes`.
- Permanent override'ы (`remaining=0`) не истекают — снимаются только через `removeAffordanceOverride(category)`
  (зеркало `removeModifiers`, `world.ts:651`).
- Никакой новой tick-фазы; module-lifecycle («override до X») едет на `registerTickPhaseHandler` как сегодня.

**Hot-path**: per-tick `Object.values(attributes)`-decay уже идёт (`world.ts:592`); override-decay добавляет O(1)
на агента, у которого `affordanceOverrides` отсутствует (early-out на `undefined`). Сбор проекций для gate'а
хойстится per-pass (§2.1) с location-индексом, так что co-present-скан НЕ повторяется per-affordance.

```ts
// affordance-modifier.ts — mirrors decayAttribute splice idiom
export function decayOverrides(list: AffordanceOverride[] | undefined, dtMinutes: number): void {
  if (!list) return;
  for (let i = list.length - 1; i >= 0; i--) {
    const o = list[i];
    if (o.duration > 0) { o.remaining -= dtMinutes; if (o.remaining <= 0) list.splice(i, 1); }
  }
}
```

### 5. Plasticity-cost seam (M8 ↔ M9)

ОДИН shared engine-hook (DD-AM-11), параллель `onMoodChange`:

```ts
// World callbacks
// CANONICAL signature shared verbatim with SPEC-personality-plasticity (audit MF1). `usedOverrideId` is a plain
// STRING (the override's id) — NOT the AffordanceOverride object: this hook is defined by the M8 engine, which ships
// BEFORE M9 and must carry ZERO dependency on M9's `AffordanceOverride` type. `target` is the existing engine type.
onActionExecuted?: (actorId: string, affordanceId: string, target?: AffordanceTarget,
                    usedOverrideId?: string) => void;
```

- Эмитится в **точке исполнения действия ТОЛЬКО на consequential action-step** (audit MUST — ТОТ ЖЕ предикат, что в
  `SPEC-personality-plasticity`: `GoalActionResult` с `emittedEvent != null` ЛИБО финальный action-шаг цели; НЕ
  `move_to`/movement и НЕ dialogue-шаг). **Один и тот же предикат governs ОБА пути** — NPC goal-path в `processGoalTick`
  (рядом с `onGoalAction`, `world.ts:1242`) И живой player-path (DD-AM-06) — иначе NPC и игрок эмитили бы на разных
  классах шагов (нарушение INV-16). Когда действие было разрешено `permit`-override'ом агента (`mode:'permit'`,
  `sourceId===actor`) ИЛИ агент спроецировал cross-agent/zone-override, hook несёт **`override.id`** как
  `usedOverrideId` (строка, не объект — M8-safe).
- M8 plasticity-layer регистрируется потребителем хука и матчит своё правило по **`when.abilityUse === usedOverrideId`**
  (поле уже есть: `SPEC-personality-plasticity` → `PlasticityRule.when.abilityUse`), применяя СВОЙ сконфигурированный
  cost (axis/step). **Цена живёт в PP-правиле, не в override'е** — ни движок, ни M9-слой не знают, что это «cost», и
  M8 не зависит от типа `AffordanceOverride`. Опциональный `AffordanceOverride.plasticityTrigger` остаётся
  module-маркером-подсказкой, но движковый seam несёт ТОЛЬКО id.
- Seam одно-направленный и optional: если ни одно PP-правило не матчит этот `usedOverrideId` — стоимость ноль (бесплатная сила). «Никто не делает
  оба» (Negation-правило) — module-ограничение, выраженное тем, какие override'ы несут trigger vs scale; **движок
  агностичен и НЕ может это enforce'ить** (см. Открытые вопросы — конвенция, не инвариант).

### 6. World API (genre-neutral, зеркало attribute-API, finite-guarded)

```ts
// Agent-sourced (sourceKind='agent', sourceId=npcId set by engine)
addAffordanceOverride(npcId: string, ov: Omit<AffordanceOverride,'id'|'sourceKind'|'sourceId'>): string; // returns id
removeAffordanceOverride(npcId: string, category: string): void;
getAffordanceOverrides(npcId: string): readonly AffordanceOverride[];
// Zone-sourced (NEW; sourceKind='zone', sourceId=locationId)
getOrCreateZoneState(locationId: string): ZoneState;        // lazy
getZoneState(locationId: string): ZoneState | undefined;    // pure read — NEVER creates (save-cleanliness)
addZoneAffordanceOverride(locationId: string, ov: Omit<AffordanceOverride,'id'|'sourceKind'|'sourceId'>): string;
removeZoneAffordanceOverride(locationId: string, category: string): void;
setZoneAttribute(locationId, key, base, min, max): void;     // reuse ScalarAttribute, mirror agent API
adjustZoneAttributeBase(locationId, key, delta): number;
addZoneAttributeModifier(locationId, key, mod: Omit<AttributeModifier,'id'>): void;
```

Все finite-guarded (reject NaN `strength`/`remaining` как `addModifier`, `world.ts:615`). Нет transfer-API
(DD-AM-14). `getZoneState`/чтения НЕ создают `ZoneState` (иначе пустые зоны протекают в save и ломают
byte-identical round-trip — только `getOrCreate*`/`add*` создают).

### 7. Save/load (INV-21, SL-07)

- `WorldSaveAgentData += affordanceOverrides?: AffordanceOverride[]` (`world.ts:89`). В `toJSON` (`world.ts:1892`)
  **omit-when-empty**: `...(agent.state.affordanceOverrides ? { affordanceOverrides: … } : {})`.
- `WorldSaveData += zoneStates?: Record<string, ZoneState>` (`world.ts:107`). В `toJSON` (`world.ts:1913`)
  **omit-when-empty для всей карты**: сериализовать `zoneStates` только если карта непуста (иначе round-trip
  byte-identical ломается для миров без зон).
- `loadState` (`world.ts:1974` блок): override'ы агента восстановить с SL-07 finite-фильтром (отбросить
  non-finite `remaining`/`strength`). Для zone-states — **сначала `this.zoneStates.clear()`** (как
  `sceneResidues.clear()` `world.ts:1954` / `affordanceCooldowns.clear()` `world.ts:1938`) во избежание ghost-зон,
  затем перестроить из record'а с тем же finite-фильтром на `attributes` (reuse `createAttribute`-re-clamp
  `world.ts:1996`) и `affordanceOverrides`. Старые saves без обоих ⇒ undefined/empty ⇒ ноль изменений поведения.

### 8. Инварианты — доказательство

- **INV-06** (mood single-writer): нетронут — override'ы отдельный carrier; ноль прямых mood-мутаций. Scoring-канал
  читает strength, не пишет mood.
- **INV-14** (engine/module boundary): override-записи несут только module-строки (`source`/`category`/`match`);
  движок оценивает структуру, никогда вокабуляр (DD-AM-09); `plasticityTrigger` опаков. Architecture-тест: grep
  `engine/src` на `Negation|trauma|wound|debt|curfew` + synthetic-module-probe. Новые engine-литералы
  (`forbid`/`permit`/`'agent'|'zone'`/`threshold`/`accumulation`) НЕ триггерят существующие guards (`CRIME_PROSE`
  `architecture.test.ts:123`, `STRONG` `:206`) — сверено. **NB**: новый файл `affordance-modifier.ts` в комментариях
  ОБЯЗАН использовать абстрактные примеры («a zone restriction», «a projected restriction»), НЕ «curfew»/«power» —
  иначе провалит собственный grep-тест спеки.
- **INV-16/17** (bilateral): ОДНА `isAffordanceForbidden`, потребляемая NPC + reactive + (оживлённым, DD-AM-06)
  player-путём ⇒ ноль split-brain; player полностью гейтится как target override'а; post-target-поверхность
  выровнена (DD-AM-13). `onActionExecuted` эмитится обоими путями ⇒ plasticity-cost работает и для игрока.
- **INV-21** (default-on-load): все новые поля optional; старые saves load'ятся в empty ⇒ ноль изменений;
  omit-when-empty держит identical-output round-trip зелёным (агенты/зоны без override'ов сериализуются как раньше).

---

## План тестов

### Gate / possible-set (P1)
- forbid убирает действие из NPC-множества: register affordance, add forbid-override matching it, assert
  `checkRequirements` → `null`; remove → снова возвращает target.
- permit восстанавливает действие, закрытое override-`forbid` (НЕ engine-universal pre-target gate типа period — см. «Scope of permit» ниже): `null` без permit, non-null с permit
  (scope DD-AM-05 / §2.1 «Scope of permit»: lifts **override-`forbid` ONLY** — НЕ engine-universal gates period/mood/suppress).
- **BILATERAL parity (INV-16/17)**: `validatePlayerAction` → `{allowed:false, reason:'Action not currently
  possible'}` при forbid-override на игрока (self/zone/cross-agent) и `{allowed:true}` иначе — ТОТ ЖЕ исход, что NPC
  даёт для идентичного состояния. Явный тест, что **живой** player-path (DD-AM-06; post threaten через WS/IL под zone-
  forbid) гейтится, а не только direct unit-call мёртвой функции.
- reactive parity (DD-AM-02): `checkRequirementsReactive` → `null` под forbid даже с высоким `eventBoost`
  (urgency НЕ пробивает possibility-gate; assert boost не достигает scoring).
- expiry: timed override (`remaining>0`) decay'ится через `decayOverrides` dt=5 и исчезает после duration; permanent
  (`remaining=0`) выживает до `removeAffordanceOverride`.
- precedence (DD-AM-04): zone-forbid by category + agent-permit by exact id → permitted (специфичнее побеждает);
  равная специфичность forbid+permit → forbidden (fail-closed). Shuffle override-массивов ⇒ идентичный исход
  (DD-AM-12).
- scope-edge (DD-AM-05): permit НЕ удовлетворяет module `REQUIREMENT_CHECKER` (e.g. `isInvestigator`) — assert
  permit не пробивает зарегистрированный module-gate.

### Execution re-gate (P1/P4)
- forbid mid-goal (DD-AM-10): спроецировать forbid на actor'а с закоммиченным мульти-шаговым goal'ом; assert
  gated-шаг НЕ исполняется (goal abort/replan).

### Scoring (P2)
- permit-override со strength поднимает `computeUtility` для enabled-действия, но FORBIDDEN никогда не скорится
  (возвращает `null` до scoring) — доказывает DD-AM-01.
- `resolveOverrideStrength`: `fromSelfBelief` ADDITIVE (нет belief'а ⇒ вклад 0, strength=base, НЕ ноль — DD-AM-08);
  `fromSentimentToTarget` СЫРОЙ sentiment, null-rel ⇒ 0 вклад (DD-AM-07); `fromAttribute` по `getAttributeValue`.
- SCORING_CONTRIBUTORS test-isolation: register built-in в `beforeAll`, `clearScoringContributors` в `afterAll`
  (`al.ts:445`) — assert ноль cross-file-загрязнения. ScoringContributorFn-target (DD-AM-07): contributor получает
  target и читает sentiment-к-цели.

### Zone (P3)
- zone-forbid применяется ко ВСЕМ co-present incl. player (комендантский тест); НЕ применяется к агентам в другой
  локации.
- `ZoneState.attributes` drift/decay через reused `ScalarAttribute`-путь; zone-state round-trips через save/load с
  SL-07 finite-фильтром (corrupt zone-attribute base отброшен, не NaN-propagated).
- ghost-zone (SL-07/DD-AM-05): zone-override на boot, отсутствующий в loaded save → НЕ выживает после
  `loadState` (`zoneStates.clear()` сработал).

### Cross-agent + plasticity (P4)
- cross-agent forbid (`match.targetId=T`) убирает действие T ТОЛЬКО когда A и T co-present; ноль эффекта врозь
  (DD-AM-03 + `getCoPresent`-bound).
- source-death (DD-AM-16): source умирает → его cross-agent forbid перестаёт гейтить цель (после load тоже).
- `onActionExecuted` файрит с ТОЧНЫМ опаковым `plasticityTrigger`-blob'ом, когда агент исполняет permit-enabled
  действие; НЕ файрит для override'ов без trigger'а. **Player as source**: игрок исполняет permit-enabled действие →
  callback файрит (bilateral plasticity-cost).
- player as cross-agent target: forbid NPC, нацеленный на игрока, гейтит живой player-path.

### Save/load (каждая фаза, добавляющая state)
- round-trip identical-output: агенты/зоны без override'ов сериализуются байт-идентично pre-spec (расширяет
  `save-load.test.ts` «empty state round-trips cleanly»).
- INV-21: save.json без `affordanceOverrides`/`zoneStates` load'ится в empty, ноль изменений.
- SL-07: non-finite `remaining`/`strength` отфильтрованы на load.

### Architecture / INV-14 (P4 + ongoing)
- grep-тест: `engine/src` НЕ содержит `Negation|trauma|wound|debt|curfew` (живут только в tests/modules) — НОВЫЙ. **Audit MUST: pre-existing комментарий со словом «traumatic» в `world-types.ts` матчит `trauma` → тест RED on arrival; перед добавлением теста ЛИБО переименовать тот комментарий, ЛИБО скоупить grep на code-литералы (не комментарии).**
  тест (зеркало `CRIME_PROSE`-блока с self-test-фикстурой), плюс self-test, что regex реально файрит.
- synthetic-module-probe (hard gate, не just testPlan): модуль регистрирует forbid-override НОВОЙ category;
  `isAffordanceForbidden` чтит его с НУЛЁМ engine-правок (FRAUD-эквивалентная INV-14-проба). Опаковый-строковый
  инвариант DD-AM-09: ноль `=== <литерал>` против `source`/`category`.

### Oracle unchanged
- полный существующий suite (regression, cg-v2, heat, m3-systems, cg-integration, world-data) зелёный без
  override-данных — crime/economy поведение доказуемо нетронуто (early-out §2.1 — явный, не emergent).
- `bun x tsc --noEmit` → 0 после каждой фазы.

---

## Phasing (additive-before-destructive; каждая фаза tsc-0, bun-test-green, независимо shippable)

> Порядок по зависимостям. Crime/economy oracle нетронут на каждой фазе, потому что override-данных нет, пока модуль
> их не добавит ⇒ `isAffordanceForbidden` early-out'ит в `false`. M9 sequenced ПОСЛЕ M8 — P4 plasticity-seam требует
> M8 `onActionExecuted`-consumer.

**P0 — caveat-pin (документ-only, ноль кода)**: зафиксировать в спеке (уже сделано) corrected-факты: belief-floor=0
на read-path (DD-AM-08), `validatePlayerAction` мёртв (DD-AM-06), `ScoringContributorFn` без target (DD-AM-07), нет
zone-carrier (DD-AM-05), gate decision-time-only (DD-AM-10), нет per-tick event-stream (DD-AM-11). Это основание P1+.

**P1 — GATE + AGENT SELF-OVERRIDE** (наименьший shippable; реализует Тип-I self-override):
`affordance-modifier.ts` (`AffordanceOverride`, `AffordanceMatch`, `isAffordanceForbidden` для self + forbid/permit +
fold-precedence DD-AM-04/12 + O(1) early-out, `decayOverrides`); `AffordanceDefinition.tags`;
`AgentState.affordanceOverrides`; wire `isAffordanceForbidden` в `checkRequirements` + `checkRequirementsReactive` +
`validatePlayerAction` (+ оживить player-path, DD-AM-06, + post-target выравнивание DD-AM-13); execution-re-gate
(DD-AM-10); World add/remove/get (agent); decay в `_tickMoodSystem` agent-loop; save/load override'ов агента;
per-pass projected-override hoist в `buildAffordanceContext`. **Тесты**: forbid/permit/expiry/precedence/reactive +
player parity (живой путь) + mid-goal re-gate.

**P2 — STRENGTH SCALING + SCORING**:
`AffordanceStrengthScale`, `resolveOverrideStrength` (ADDITIVE, belief/sentiment/attribute), расширение
`ScoringContributorFn` target-аргументом (DD-AM-07), server-registered built-in `affordanceOverrideScoringContributor`
для permit-strength. **Тесты**: scored-but-gated, нет-belief'а→base (не 0), null-rel→0-вклад, contributor-target,
test-isolation.

**P3 — ZONE CARRIER**:
`ZoneState`, `World.zoneStates` + lazy `getOrCreate`, zone World-API (override'ы + атрибуты reuse `ScalarAttribute`),
**обязательная** `ctx.zoneOverridesFor`-closure в `buildAffordanceContext`, zone-ветка в `isAffordanceForbidden`,
zone-decay-loop, zone save/load (`WorldSaveData.zoneStates`, omit-when-empty + `clear()`-before-load). **Тесты**:
zone-комендантский гейтит всех co-present incl. player; zone-attribute drift; ghost-zone не выживает; permit-vs-zone-
forbid precedence (DD-AM-04). *Hard precondition*: оживлённый player-gate из P1 (zone-forbid должен бить игрока).

**P4 — CROSS-AGENT + PLASTICITY SEAM** (реализует Тип-II + мост к M8):
`match.targetId`, co-present projector-скан (`getCoPresent`), source-alive/co-present-фильтр (DD-AM-16),
`onActionExecuted`-hook + `plasticityTrigger`-passthrough (DD-AM-11), server wires M8-consumer. **Тесты**: A
forbids T co-present / не врозь; permit-use файрит callback с опаковым trigger'ом; player as source (callback)
и player as cross-agent target; INV-14 architecture-тест (grep + synthetic-probe).

После P4 мир «Отрицание» полностью выразим как чистые данные модуля с нулём engine-вокабуляра.

---

## Module-realizability — «Отрицание» как чистые данные модуля

> Доказательство: оба типа Отрицания выразимы поверх M8 (Personality Plasticity) + M9 (этот слой) БЕЗ единой
> engine-правки и без engine-знания о «Отрицании». Движок видит только структуру.

**Тип I — Внутреннее Отрицание (self-override + plasticity-cost)** — реализуется на M9-P1 + M9-P4 + M8:
- Модуль регистрирует affordance «использовать дар» (base-requirements открыты или закрыты как нужно).
- Модуль добавляет агенту `AffordanceOverride { sourceKind:'agent', sourceId:self, match:{affordanceIds:['use_power']},
  mode:'permit', plasticityTrigger:<module-blob: какая ось, сколько> }`. `permit` возвращает обычно-закрытое действие
  в множество носителя (Тип I — на себя).
- `onActionExecuted` при исполнении файрит → M8-consumer применяет permanent base-shift к module-оси («рана»/
  «стабильность») по опаковому `plasticityTrigger`. «Бередить рану» = цена применения. Сила может масштабироваться от
  self-belief (`strengthScale.fromSelfBelief`) — «сила зависит от веры» (Undead Unluck).
- Движок не знает слов «рана»/«травма»/«Отрицание» — только `permit`-запись + опаковый blob.

**Тип II — Внешнее Отрицание (cross-agent / zone forbid, масштабируемый belief/sentiment)** — реализуется на M9-P3 + P4:
- Cross-agent: модуль добавляет носителю `AffordanceOverride { sourceKind:'agent', sourceId:self,
  match:{targetId:victim, categories:['…']}, mode:'forbid', strengthScale:{ fromSentimentToTarget:{weight,abs} } }`.
  Override гейтит ВОЗМОЖНОЕ цели, когда они co-present; «чем ближе цель — тем сильнее» (Fuuko) выражается raw-sentiment-
  scale'ом (для scoring-эффекта на permit-варианте) — relationship-механика управляет относительной опасностью дара.
- Zone: модуль добавляет `addZoneAffordanceOverride(locId, { mode:'forbid', match:{tags:['…']} })` — «среда прогнута»
  вокруг носителя/места. Гейтит всех co-present incl. игрока (bilateral).
- Сила масштабируется от self-belief носителя (`fromSelfBelief`) — та же belief-driven-ability-strength роль.

**«Никто не делает оба одновременно»** — module-правило (НЕ engine-инвариант, см. Открытые вопросы): модуль
отслеживает per-agent тип своей state'ой и отказывается проецировать «не тот» вид override'а. Движок агностичен —
`AffordanceOverride` легально может нести и `plasticityTrigger`, и `strengthScale`; их взаимное исключение —
бухгалтерия модуля. Success-test честно: это **конвенция**, выразимая как данные, а не enforced-инвариант движка.

**Глобальное давление** (CONCEPT §6.5, опционально) — уже есть в движке: глобальный `ScalarAttribute` с E1-drift
(или `ZoneState.attributes` глобальной зоны), порог меняет условия. Ноль M9-работы.

---

## Открытые вопросы / Отложено

1. **`permit` vs module `REQUIREMENT_CHECKERS` (DD-AM-05)**: текущий scope — `permit` поднимает engine-universal
   gates + override-forbid, но НЕ module-checkers (`isInvestigator` и т.п.). Если будущий Negation-power должен
   разблокировать module-gated действие — нужен opt-in `permit.liftCheckers?: string[]` (явно именует ключи, которые
   nullify'ит). Отложено: текущий module-realizability-таргет покрывается тем, что Negation-affordances имеют
   открытые base-requirements; широкий permit-nullification — отдельная фаза (риск god-mode blast radius).
2. **«Никто не делает оба» — конвенция, не инвариант**: движок не enforce'ит взаимное исключение Тип-I/Тип-II на
   одном агенте (DD-AM-11, Module-realizability). Если потребуется engine-checkable — добавить registration-time
   validation-hook. Сейчас оставлено module-бухгалтерией (честная конвенция).
3. **Self-belief subject-семантика**: `getMaxConfidenceFor` subject-keyed; «self-belief» = belief'ы, чей SUBJECT
   модуль назначает self. Это документировано (§1.3 caveat), но требует дисциплины модуль-автора; engine-level
   self-belief-примитив сознательно НЕ вводится (INV-14).
4. **Optional debug-surface** (server-слой, НЕ engine-spec): `GET /api/debug/affordances/:id` мог бы возвращать
   per-применимый-override `{mode, source, match, remaining, resolvedStrength}` для intelligence-dashboard'а («почему
   действие forbidden/permitted»). Не в engine-spec и не в success-критериях; `routes.ts` уже сериализует agent-state.
5. **Authored zone-overrides / world-editor**: override'ы — runtime-state, не authored world-JSON. Если модуль
   захочет authored zone-override'ы — это module-data + editor-правка, вне engine-scope.
6. **Версионирование saves**: оба слоя (M8 + M9) ОБЯЗАНЫ оставаться additive-optional (без required-полей, без
   смены типов существующих) — тогда version-1 gate (`index.ts`) продолжает грузить старые saves. Если когда-либо
   перестанет — нужна migration-ветка (1→2), а не текущий hard-reject.