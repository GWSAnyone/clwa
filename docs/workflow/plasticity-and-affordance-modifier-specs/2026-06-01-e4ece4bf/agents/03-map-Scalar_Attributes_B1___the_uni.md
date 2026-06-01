## Map: Scalar Attributes B1 — generalized quantified-state primitive

**Допущения:** depth=medium→deep по запросу; прочитан весь `attributes.ts`, World API, tick-loop, save/load, оба модульных потребителя (economy), тесты, и read-sites BigFive. Не разворачивал: CG-движок целиком, beliefs/relationships internals (только seams отмечены).

**TL;DR:** B1 — это string-keyed слой числового состояния на `AgentState`: `ScalarAttribute = {base, min, max, modifiers[], drift?}`. Эффективное значение = `clamp(base + Σ decayed-modifiers)`. ДВЕ ортогональные деформации уже физически разделены: модификаторы затухают (ЭЛАСТИЧНО, как mood), а `base` дрейфует через optional `drift` (ПЛАСТИЧНО — цена/голод/регенерация). Движок не присваивает ключам смысла (INV-14); модули (economy) задают значения. Personality plasticity ложится на ЭТУ модель почти буквально — но главный разрыв в том, что `bigFive` сейчас живёт на `AgentProfile` (статично, immutable) и читается напрямую как `agent.profile.bigFive[...]`, а не через attribute-read.

**Architecture:**
- `attributes.ts:11` `AttributeModifier` — таймед/затухающая дельта (id/source/category/magnitude/remaining/duration/decay). ДУБЛИКАТ `MoodModifier` (`world-types.ts:6`) — идентичные поля + идентичный `modifierEffective`.
- `attributes.ts:26` `ScalarAttribute` — `base + [min,max] + modifiers[] + drift?`. `drift?.{ratePerMinute, toward?}` (`:35`): без `toward` — линейный дрейф base; с `toward` — экспоненциальное приближение `1-e^(-rate·dt)`. Отсутствует = нет дрейфа (INV-21).
- Pure-функции: `createAttribute` (`:49`, клампит base), `attributeEffective` (`:54`), `decayAttribute` (`:61`, тикает только modifiers, дропает истёкшие), `driftAttribute` (`:76`, двигает только base, NaN-защита DD-04), `getAttributeValue` (`:94`).
- Carrier: `AgentState.attributes?: Record<string, ScalarAttribute>` (`agent-types.ts:154`) — **только агенты**, zone-носителя нет.

**Data flow:**
```
boot: worldData.startingAttributes → world.setAttribute(npc,key,base,min,max)  (server/index.ts:728)
        ↳ player gold seeded separately (index.ts:738)
module write: economy pricing sets attr.drift={rate,toward}  (pricing.ts:48,74)  ← задаёт только цель
              economy transfers gold via world.transferAttribute  (step-handlers.ts:36)
per tick (dt=5, real-tick only, bilateral): world.ts:591
        for attr of agent.attributes: decayAttribute(attr,5); driftAttribute(attr,5)
                                       └ elastic (modifiers→0)  └ plastic (base→toward)
read (utility): computeUtility #6 channel → SCORING_CONTRIBUTORS → getAttributeValue  (al.ts:486)
read (gate):    CG `attr` op → getAttributeValue, undefined⇒false  (cg-engine.ts:292-295)
save:  toJSON spreads attributes verbatim  (world.ts:1892)
load:  SL-07 — skip non-finite base, re-clamp via createAttribute, filter NaN modifiers,
       preserve drift only if finite  (world.ts:1992-2005)
```

**Key decisions / patterns:**
1. **Две деформации физически разделены** — `decayAttribute` (модификаторы, эластично) и `driftAttribute` (base, пластично) — отдельные функции, вызываемые подряд (`world.ts:592`). Это и есть искомая «одна физика деформации», но реализована как два code-path, НЕ один `deform()`.
2. **drift = опциональный модульный knob** (`attributes.ts:35`, default absent). Это прямой кандидат для plasticity reversibility/«annealing»: нет drift = необратимый сдвиг (дефолт спеки), есть `toward=baseline` = постепенный откат.
3. **Conservation-семантика** в `transferAttribute` (`world.ts:707`): проверка на `base` не `effective`, атомарность, overdraft-guard (`:712`). Спроектировано под gold/HP — для personality бессмысленно.
4. **Полностью genre-neutral read-каналы**: `SCORING_CONTRIBUTORS` (`al.ts:437`) и CG `attr` op (`cg-engine.ts:292`) читают по строковому ключу. Если traits станут attributes — они мгновенно станут scoring-able и CG-gate-able.
5. **economy = доказательство модели**: цена и голод целиком построены на E1-дрейфе (`pricing.ts:5-8`), модуль задаёт только цель/скорость, движок эволюционирует base. Тот же паттерн = личностный сдвиг через событие.

**Gotchas:**
- **BigFive ≠ attribute сегодня.** `bigFive` на `AgentProfile` (`agent-types.ts:92`), читается как `agent.profile.bigFive[TRAIT_MAP[w.trait]]` (`al.ts:451`) с флипом `1-traitValue` для direction='low'. Attributes — на `AgentState`. Чтобы personality «была» ScalarAttribute, все ~17 readers должны перейти с `profile.bigFive` на state-backed `attributeEffective`-read. Это центральный blast radius.
- **Mood ещё НЕ ScalarAttribute.** Mood = `baseMood + moodModifiers` через `_computeMoodTick` (`world.ts:569`), собственный тип `MoodModifier`, собственный `modifierEffective`. Заявка «personality joins the SAME machinery as mood» требует либо миграции mood на ScalarAttribute, либо принятия ДВУХ параллельных decay-движков (сейчас именно дубликаты).
- **Tick перебирает ВСЕ attributes ключ-агностично** (`world.ts:592`). Traits-as-attributes автоматически получат decay+drift каждый тик — это и есть нужная механика, но без drift-конфига trait не аннилится (= необратим, что совпадает с дефолтом спеки).
- **Нет zone-носителя.** `AgentState.attributes` агент-only. SPEC 2 «zone как активный объект с состоянием» не имеет места хранения — модель ScalarAttribute переиспользуема, но carrier для zone не существует.
- **save/load — explicit whitelist** (`world.ts:1892`/`1992` + тип `WorldSaveAgentData:96`). Новое состояние не персистится, пока не тронуты обе функции + тип; INV-21 требует backward-compat default.
- **`SCORING_CONTRIBUTORS` — process-global mutable** (`al.ts:438`), test-only clear (`:445`); тесты обязаны сбрасывать (`attributes.test.ts:20`).

**Referenced answers:**
- **Q: Может ли personality буквально быть scalar attributes, или общая механика за typed-view?** / **A:** Буквально — частично. *Модель данных* (`base+min+max+modifiers+drift`) и *физика* (`attributeEffective`/`decay`/`drift`, `world.ts:592` tick) подходят 1:1: baseMood-аналог = `base`, mood-modifiers-аналог = `modifiers` (эластично), плотический сдвиг = `adjustAttributeBase`/`drift` (пластично), необратимость = absent-drift (INV-21). НО три причины против «traits = просто ещё одни attributes под тем же API»: (1) ~17 readers читают `agent.profile.bigFive` напрямую (`al.ts:451`, `instinct-builder.ts:205`), а не `attributeEffective` — переезд traits на `AgentState` ломает их всех; (2) generic World API экспонирует `transferAttribute`, бессмысленный/опасный для traits; (3) traits нужен open-axis registry (OCEAN+H seeded + module-extra), а `attributes` — плоский `Record<string,…>` без понятия «axis set». **Вывод-карта (без дизайна):** общий *deformation-механизм* (ScalarAttribute math + tick) переиспользуем напрямую; но нужен **typed view/seam** поверх — он (а) хранит traits на state как ScalarAttribute с `min=0,max=1`, (б) даёт читателям effective-read вместо `profile.bigFive`, (в) НЕ наследует conservation/transfer-API, (г) добавляет axis-registry поверх плоской мапы. `attr` op и scoring-channel переиспользуются без изменений.
- **Q: drift как seam к reversibility?** / **A:** Да, `attributes.ts:35` optional `drift` уже точно моделирует «annealing»: `{toward: baseline, ratePerMinute}` = откат, absent = необратимо. Дефолт спеки (irreversible) = просто не задавать drift.

**Not explored (вне карты):**
- CG-движок целиком (только `attr`-op seam, `cg-engine.ts:292`).
- beliefs/relationships internals — спека хочет magnitude-scaling от self-belief/sentiment; помечены как read-seams, но их API не картирован здесь.
- Enneagram stress/growth (`agent-types.ts:78`) — упомянут как существующий temporary-shift механизм для связи с plasticity, но не картирован.
- AL possible-set / REQUIREMENT_CHECKERS / validatePlayerAction (нужны для SPEC 2) — вне фокуса B1.