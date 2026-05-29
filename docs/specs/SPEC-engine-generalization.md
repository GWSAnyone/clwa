# SPEC: Engine Max Generalization (universal capability subsystems)

> **Milestone**: M5 (Engine Generalization) — Phase B (растим движок на нейтрализованной базе)
> **Status**: **📋 PLANNED** (стартует после merge `SPEC-engine-neutralization` — Phase A)
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

### B1 — Generic scalar-attribute subsystem (the universal numeric layer) [size L, leverage high]
Генерализовать паттерн `MoodModifier` (base + clamped range + timed/decaying modifiers + onChange-broadcast) в
string-keyed слой числовых атрибутов на `AgentState`:
- `attributes: Map<string, ScalarAttribute>` — base value, clamped [min,max], modifiers[] (как mood), computed effective.
- `RuleCondition` op `attr` (`attr gt/lt/eq <key>`) — чтобы CG-правила гейтили на количественном состоянии (`target.gold < 10`).
- Pluggable `SCORING_CONTRIBUTORS` channel в `computeUtility` (`al.ts`) — чтобы affordance scored на resource-драйверах.
- Save-schema slot (AgentState shape change; старых сейвов нет → миграция не нужна).
- Атрибут-ключи — чистый string-keyed registry (как events/sources): НИ crime, НИ economy имён в движке.
**Один примитив сразу под**: Combat HP / Economy gold / Politics standing / Survival needs.

### B2 — Inventory / item-instance / atomic transfer [size L, leverage high]
Engine-level Item/Container: item-инстансы (owner+location+state refs, quantities) + атомарный transfer-of-value
step-примитив (move N of X from A to B с conservation). Заменяет dead-end `AgentProfile.shop` (убран в Phase A/здесь).
Делает кражу/торговлю **реальным** перемещением состояния (сегодня `steal_from` эмитит событие, но не двигает state).
`item.kind` — free string (не реинтродуцировать crime/trade вокабуляр в движок).
**Дренирует A7b**: убирает из движка `AgentProfile.shop`/`ShopItem` (`agent-types.ts`) и `il.ts TradeIntent`/`tradeIntent`/trade-detection — это economy half-primitive, который B2 заменяет реальной inventory + переносит trade-intent в economy-модуль (IL-schema-extension hook). Затрагивает server (world-loader/routes/ws) + client shop-panel.

### B3 — Faction / group + relationship richness [size L, leverage medium]
- Faction/group entity + membership на `AgentState` + `FACTION_TYPES` registry; group-scoped standing-скаляр (через B1).
- `RelationType` (закрытый union friend|rival|family|…) → registry-backed bond-types + optional `standing/favor` на
  `Relationship` (это win-condition court-romance, сегодня нет engine-native state). Затрагивает
  `DEFAULT_TRUST/DEFAULT_SENTIMENT/getGriefPenalty` — мигрировать в lockstep.

## Отложенные enhancement'ы (из maps, не в B1–B3)
- Instinct TEXTURE/RESISTANCE registry (модули поставляют свой affect-вокабуляр вместо crime/violence-прозы).
- Generic affected-party typing (beneficiary/harmed/rival) вместо victim-centric reactive volition.
- Trauma layer (перманентные OCEAN+H сдвиги) — дешёвый PM-only deepener.
- Declarative module manifest (модуль как валидируемые данные) — ПОСЛЕ hardening registry-поверхности.
- Richer perception (range/senses/detectability) поверх co-location.

## Verification (на каждый B-шаг)
- tsc 0 + тесты зелёные; `clwa-auditor` (INV-14 + новые инварианты субсистемы); module-sufficiency re-probe
  (оценка должна расти к 9-10); по возможности — тонкий live-прогон новой механики.
