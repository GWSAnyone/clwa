# SPEC: Engine Max Generalization (universal capability subsystems)

> **Milestone**: M5 (Engine Generalization) — Phase B (растим движок на нейтрализованной базе)
> **Status**: **✅ B1+B2+B3 DONE** (scalar attributes, inventory, faction+relationship richness — all as clean tested
>   engine primitives). Branch `feature/engine-generalization`. tsc 0, **249/249** tests. Один follow-up: полная A7b
>   shop→inventory миграция требует economy-модуля (примитив готов). Отложенные enhancement'ы — ниже.
> **Depends on**: SPEC-engine-neutralization (Phase A) — чистая genre-нейтральная база
> **Source of truth**: `docs/workflow/engine-generalization-survey/2026-05-29-3d7ddc1c/report.md` (ranked
>   investments) + per-agent maps; gap-анализ в `engine-self-sufficiency` (LEGIT GAPS секция).
> **Created**: 2026-05-29

---

## Цель

Расширить **пространство создания игр**: добавить универсальные capability-субсистемы, которых движку не хватает
для второго жанра иного фокуса. Обе survey сошлись: **#1 пробел — отсутствие quantified-state примитива.** Сегодня
вся `AgentState` символьно-социальна (alive/location/mood/status/beliefs/relationships); единственный
named-decaying-clamped-scalar — это `MoodModifier`. Economy (gold), Combat (HP), Politics (standing), Survival
(needs) — все упираются в одну и ту же недостающую форму.

## Решение по методологии (важно)

Survey рекомендовал «сначала throwaway Economy spike». **Отклонено** (план + решение пользователя): scaffold
противоречит правилу «build complete systems, no scaffolds», а аналитические genre-probes self-sufficiency уже дали
точный список блокеров. Scalar-субсистему проектируем **против задокументированных блокеров напрямую**, без fake-модуля.

## Последовательность (каждый — свой 4-step спек)

### B1 — Generic scalar-attribute subsystem (the universal numeric layer) [size L] — ✅ DONE
**Реализовано** (`packages/engine/src/attributes.ts` + World API + tsc 0, 239/239, `tests/attributes.test.ts` 9 тестов):
- `ScalarAttribute` {base, min, max, modifiers[]} + `AttributeModifier` (та же decay-модель, что MoodModifier) +
  `attributeEffective`/`decayAttribute`/`createAttribute`/`getAttributeValue`. `AgentState.attributes?: Record<string,ScalarAttribute>`.
- World API: `getAttribute`/`setAttribute`/`adjustAttributeBase`(clamped)/`addAttributeModifier`/**`transferAttribute`** (атомарный conserved-перенос — основа экономики/кражи). Decay в `_computeMoodTick` (та же cadence, что mood).
- CG `RuleCondition` op **`attr`** (`field`+`comparator`+`value`) — гейт на количественном состоянии (`gold < 10`).
- Pluggable **`registerScoringContributor`** channel в `computeUtility` — affordance scored на resource-драйверах (debt→smuggle).
- Save/load: `attributes` сериализуются в `WorldSaveAgentData`. Один примитив backs Economy gold / Combat HP / Politics standing / Survival needs.

Генерализует паттерн `MoodModifier` (base + clamped range + timed/decaying modifiers) в
string-keyed слой числовых атрибутов на `AgentState`:
- `attributes: Map<string, ScalarAttribute>` — base value, clamped [min,max], modifiers[] (как mood), computed effective.
- `RuleCondition` op `attr` (`attr gt/lt/eq <key>`) — чтобы CG-правила гейтили на количественном состоянии (`target.gold < 10`).
- Pluggable `SCORING_CONTRIBUTORS` channel в `computeUtility` (`al.ts`) — чтобы affordance scored на resource-драйверах.
- Save-schema slot (AgentState shape change; старых сейвов нет → миграция не нужна).
- Атрибут-ключи — чистый string-keyed registry (как events/sources): НИ crime, НИ economy имён в движке.
**Один примитив сразу под**: Combat HP / Economy gold / Politics standing / Survival needs.

### B2 — Inventory / item-instance / atomic transfer [size L] — ✅ DONE (primitive)
**Реализовано** (`packages/engine/src/inventory.ts` + World API + tsc 0, 249/249, `tests/inventory.test.ts` 4 теста):
- `Item` {id, kind (free string), quantity, state?} + pure `addItem`(stack fungible / push unique-state)/`removeItems`(conserved)/`countItems`.
- `AgentState.inventory?: Item[]` + save/load. World API: `getInventory`/`countItem`/`hasItem`/`giveItem`/`removeItem`/
  **`transferItem`** (атомарный conserved-перенос — реальная торговля/кража/лут двигают state, а не только эмитят событие).
- **A7b остаётся частично**: примитив готов, но shop/ShopItem/TradeIntent в движке **НЕ** удалены — их замена требует
  economy-МОДУЛЯ (мигрировать shop→inventory + server/client/IL trade-flow). Сделано на уровне engine-capability; module-миграция — follow-up под реальный economy-модуль (per survey: строить против реального спроса).

### B2 (original outline) — Inventory / item-instance / atomic transfer
Engine-level Item/Container: item-инстансы (owner+location+state refs, quantities) + атомарный transfer-of-value
step-примитив (move N of X from A to B с conservation). Заменяет dead-end `AgentProfile.shop` (убран в Phase A/здесь).
Делает кражу/торговлю **реальным** перемещением состояния (сегодня `steal_from` эмитит событие, но не двигает state).
`item.kind` — free string (не реинтродуцировать crime/trade вокабуляр в движок).
**Дренирует A7b**: убирает из движка `AgentProfile.shop`/`ShopItem` (`agent-types.ts`) и `il.ts TradeIntent`/`tradeIntent`/trade-detection — это economy half-primitive, который B2 заменяет реальной inventory + переносит trade-intent в economy-модуль (IL-schema-extension hook). Затрагивает server (world-loader/routes/ws) + client shop-panel.

### B3 — Faction / group + relationship richness [size L] — ✅ DONE
**Реализовано** (tsc 0, 245/245, `tests/relationships-factions.test.ts` 6 тестов):
- **B3a relationship richness**: `RelationType` → OPEN string; `registerRelationshipType(type, {trust,sentiment,grief})` +
  `getRelationshipDefaults(type)` (seeded с 7 universal-бондами, neutral fallback) — модуль добавляет `alliance/betrothed/vassal`
  без правок движка; `getGriefPenalty` читает реестр; `DEFAULT_TRUST/DEFAULT_SENTIMENT` удалены (заменены реестром, server мигрирован).
  Добавлена ось **`Relationship.standing`** + `adjustStanding` (clamped -1..1) — court/politics win-condition.
- **B3b faction membership**: `AgentState.factions?: string[]` (open keys) + World `joinFaction`/`leaveFaction`/`isFactionMember`/
  `getFactions` + CG условие-op **`faction`** (гейт по членству) + save/load. Per-faction standing — через B1-атрибут (key per faction).
  Минимальный collective-actor примитив (без over-engineered faction-faction таблиц — те строятся, когда politics-модуль их требует, per survey).

## Отложенные enhancement'ы (из maps, не в B1–B3)
- Instinct TEXTURE/RESISTANCE registry (модули поставляют свой affect-вокабуляр вместо crime/violence-прозы).
- Generic affected-party typing (beneficiary/harmed/rival) вместо victim-centric reactive volition.
- Trauma layer (перманентные OCEAN+H сдвиги) — дешёвый PM-only deepener.
- Declarative module manifest (модуль как валидируемые данные) — ПОСЛЕ hardening registry-поверхности.
- Richer perception (range/senses/detectability) поверх co-location.

## Verification (на каждый B-шаг)
- tsc 0 + тесты зелёные; `clwa-auditor` (INV-14 + новые инварианты субсистемы); module-sufficiency re-probe
  (оценка должна расти к 9-10); по возможности — тонкий live-прогон новой механики.
