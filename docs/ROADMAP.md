# CLWA — Roadmap

> Движок поведенческой физики для эмерджентных миров.
> Сюжет не программируется — он возникает из взаимодействия систем.

| | |
|---|---|
| **Версия** | `v0.18.0-dev` |
| **Майлстоун** | M7 «Economy & Trade» — 🔨 в разработке (`feature/economy`) |
| **Отгружено** | M5 Engine Generalization `v0.16.0` · M6 NPC Brain `v0.17.0` |
| **Качество** | `bun test` 299 / 21 файл · `tsc` 0 · genre-neutrality guard PERFECT |
| **История** | [docs/Changelog.md](Changelog.md) |

> **Легенда статусов**: ✅ готово · 🔨 в разработке · ⏸️ отложено · 🔜 запланировано

---

## Архитектура

```
Platform     Godot / Web UI / Voice / Multiplayer / API
Modules      Crime & Justice | Economy | Politics | Combat | Social
Engine       AL | PM | CG | EL | IL | Beliefs | Goals | Memory
             Relationships | Perception | Schedule | Clock | Journal
```

**Engine** = подсистемы, пустые регистры. **Modules** = данные в регистрах. **Platform** = клиенты.

---

## Текущее состояние: v0.18.0-dev — M7 «Economy & Trade» в разработке (M5 v0.16.0 + M6 v0.17.0 отгружены)

> **M5 «Engine Generalization»** (две фазы, отдельные ветки):
> - **Phase A — genre-нейтрализация**: из `packages/engine` слиты ВСЕ crime-justice утечки (строки, имена типов,
>   проза, dead defaults, `CrimeScene`→`SceneResidue`, PlayerJournal/accusation извлечены в модуль). Semantic
>   INV-14 «zero module-specific strings» теперь **PERFECT** — genre-neutrality guard проходит весь движок (0 исключений).
> - **Phase B — universal capability subsystems**: добавлены три примитива (scalar attributes B1, inventory B2,
>   factions+standing B3) — quantified-state слой, которого не хватало для второго жанра.
> - Демо **Living Millhaven** доказало цель генерализации: экономика + фракции + правосудие добавлены в crime-игру
>   с **нулём правок движка**.
>
> **M6 «NPC Brain»** (v0.17.0, отгружен): слоистый промпт (L1/L2/L3), маршрутизация моделей per-task
> (Sonnet/Haiku/Qwen), русская локализация, real-time chat-staleness TTL — качество отыгрыша NPC выведено на A-.
>
> **M7 «Economy & Trade»** (v0.18.0-dev, текущий фокус): второй жанр доказывает тезис «один движок, контент = данные».
> 3 универсальных примитива (E1 drift / E2 overdraft / E3 INTENT_KIND) + модуль economy (торговля, цены, нужды,
> долг/кредит, кросс-модульный CG долг→преступление). E1/E2/E3 + P2–P5 готовы; осталось P6 + финальный аудит.
>
> M4 «Complete Session»: arrival-event + position-authoritative movement (v0.15.0), удаление gameSpeed (v0.15.1)
> отгружены; win/lose + end-of-run summary **сознательно отложены**.

### Завершено

| Phase | Описание | Версия |
|-------|---------|--------|
| **Phase 1** | Proof of Concept — 8 NPC, E2E chain kill→investigate→arrest→sentence | v0.5-v0.8 |
| **Phase 2** | Player Integration — IL v2, bilateral design, trust evolution, Web UI | v0.9-v0.10 |
| **Milestone 1** | Replayable Crime — trait/mood/relationship randomization, Scenario Manager | v0.11.0 |
| **Milestone 5** | Engine Generalization — genre-neutral engine (Phase A) + scalar attributes / inventory / factions (Phase B) + Living Millhaven demo (zero engine edits) | v0.16.0 |

### В работе

| Milestone | Описание | Версия | Статус |
|-----------|---------|--------|--------|
| **Milestone 2** | Detective Toolkit — accusation, evidence presentation, prevention, journal v2 | v0.12 | Done (backend + Web UI) |
| **Milestone 6** | NPC Brain — layered prompt (L1 scaffold / L2 persona / L3 volatile), context engineering, model routing (Qwen/Haiku/Sonnet), chat-staleness TTL, all data-driven in World Editor | v0.17.0 | Done (tsc 0, 280 tests, final auditor: no MUST-FIX, INV-14 PERFECT) |
| **Milestone 7** | Economy & Trade — второй жанр на универсальном движке: примитивы E1/E2/E3, торговля, динамические цены, нужды, долг/кредит, кросс-модульный CG (долг → преступление) | v0.18.0 | 🔨 В разработке (`feature/economy`): E1/E2/E3 + P2–P5 ✅, осталось P6 + финальный аудит |

### Engine подсистемы (17 реализовано)

| Подсистема | Версия | Назначение |
|-----------|--------|-----------|
| AL (Affordance Layer) | v2 | Пространство возможностей. 20+ affordances, declarative steps, instinct builder |
| PM (Personality Model) | v1 | OCEAN+H + Enneagram → utility scores, instinct prose, stress/growth |
| CG (Consequence Graph) | v2 | Реактивные каскады. targetMode pipeline, trait/relationship/belief conditions, exclusive groups, trigger index. Crime-rules + economy cross-module rule (debt→grudge→crime) |
| EL (Evidence Layer) | v1 | Structured evidence at locations, discovery, weights |
| IL (Intent Layer) | v2 + M7 | Player speech → structured meaning → engine effects. Dynamic JSON schema. **M7 E3: open `INTENT_KIND` registry** — модули регистрируют интенты (trade больше не захардкожен в движке) |
| Beliefs | v1 | Confidence, source dedup, decay, transfer weights |
| Goals | v1 | Multi-step plans, priority preemption, pursuit, module step handlers |
| Memory | v2 | Persistent dual storage (_memoryLog + Qdrant), 3-level fallback, multiplayer-ready |
| Relationships | v2 | Bilateral sentiment/trust + **standing** axis (-1..1, politics/justice). Open RelationType registry (registerRelationshipType), grief/testimony weights from registry |
| Perception | v1 | canSee/canHear/getCoPresent/getWitnesses, location-based |
| Schedule | v1 | 5 periods, per-NPC entries, priority 3 goals |
| Clock | v1 | Master Clock, ProcessingQueue (7 task types), NPC state machine (6 states) |
| Journal | v2 | Structured evidence fields, suspect tracking, case summary scoring |
| Dialogue | v1 | Structured JSON (speech+gesture), TopicEngine v3.1 (16 sources: 13 social + 3 crime) |
| Attributes (Scalar) | v1 + M7 | Universal numeric state: base + clamped [min,max] + decaying modifiers (MoodModifier-модель). Атомарный conserved `transferAttribute` (+ **M7 E2 overdraft**). **M7 E1 drift**: base дрейфует к цели (цены/нужды). CG `attr` op, `registerScoringContributor`. Backs gold/HP/standing/needs |
| Inventory | v1 | Item-инстансы {id, kind, quantity, state?}. Атомарный conserved `transferItem` — реальная кража/торговля/лут двигают state. Per-agent inventory |
| Factions | v1 | Open-key membership на AgentState. CG `faction` op, join/leave/isMember. Per-faction standing через scalar-атрибут |

---

## Milestone Roadmap (Game — GDD_DETECTIVE.md)

> Это майлстоуны **детективной игры** (GDD) — отдельный трек от инженерных майлстоунов выше
> (M5 Engine Generalization `v0.16.0` / M6 NPC Brain `v0.17.0` / M7 Economy `v0.18.0-dev`). Игровые M4/M5
> (win/lose, polish & demo) сознательно отложены в пользу расширения движка под мульти-жанровость.

| # | Milestone | Версия | Описание | Статус |
|---|-----------|--------|----------|--------|
| 1 | Replayable Crime | v0.11 | Randomization + motive pool → каждый рестарт = другой сценарий | Done |
| 2 | Detective Toolkit | v0.12 | Accusation, evidence, prevention, journal | Done |
| 2.5 | **Memory & Infrastructure** | v0.12.x | Persistent NPC memory, TS strict, contract validation, world editor | **Done** |
| 3 | Living Opposition | v0.13 | Garrett variability, escalation, heat, NPC resistance | **Feature-complete** (CG v2, escalation, heat, witness reactions, corruption, trust-gating, alibi system) |
| 4 | Complete Session | v0.14 | Arrival event, win/lose, end-of-run summary | — |
| 5 | Polish & Demo | v0.15 | Case journal UI, day/night, sound, tutorial, balance, arousal dimension, emotional tagging | Design: Mood Review |

### M2.5 — Memory & Infrastructure (DONE)

Инфраструктурный этап между M2 и M3.

**Выполнено (v0.12.0–v0.12.6):**
| Что | Версия | Описание |
|-----|--------|----------|
| Persistent memory | v0.12.0 | Dual storage _memoryLog + Qdrant, 3-level fallback, multiplayer-ready playerId |
| TypeScript strict | v0.12.1 | 156 errors → 0. 4 runtime bugs fixed (lay_low goals, questionTopics ctx, server.ts agents scope) |
| Contract validation | v0.12.2 | Runtime guards (addGoal/addBelief), static lint (as any ban), boot arity checks |
| World editor | v0.12.3–v0.12.6 | 7-section editor, registry-driven dropdowns, world-loader JSON validation |

**Спеки:**
| Spec | Описание | Статус |
|------|----------|--------|
| [SPEC-persistent-memory](specs/SPEC-persistent-memory.md) | Dual storage, async boot, graceful degradation | **Implemented** |
| [SPEC-ts-strict](specs/SPEC-ts-strict.md) | 156 TS errors → 0 | **Done** |
| [SPEC-multiplayer-memory](specs/SPEC-multiplayer-memory.md) | Player isolation, per-player files | Deferred (data model ready) |

**Tooling:**
- claude-observer (Hu Tao statusline, .observer-rules.md, session reset)
- World Editor (`bun run editor`, port 3001, registry-driven)

---

## M5 — Engine Generalization (DONE, v0.16.0)

Движок приведён к genre-нейтральности и расширен universal capability-примитивами. Две фазы, две ветки.

**Phase A — genre-нейтрализация** (`feature/engine-neutralization`, tsc 0, 230/230):
все crime-утечки слиты из `packages/engine`; semantic INV-14 **PERFECT** (genre-neutrality guard проходит весь движок, 0 исключений).

| Шаг | Что слито | Как |
|-----|-----------|-----|
| A1 | hardcoded `'rumor'` | `BELIEF_SOURCE.GOSSIP` |
| A2 | role-directive crime-проза | `registerRoleDirectiveBuilder` hook |
| A3 | belief NL phrasing «committed X against Y» | `registerBeliefPhrasing` (per event-type) + нейтральный fallback |
| A4 | concealment/accusation проза | crime secret-directive builders |
| A5 | AffordanceRequirement crime-поля | generic + `REQUIREMENT_CHECKERS` / `POST_TARGET_REQUIREMENT_CHECKERS` / `registerTargetEnricher` |
| A6 | AgentProfile capability-флаги | open `capabilities: Record<string,boolean>` + `hasCapability()` |
| A7 | EmotionalPressure closed union | `type=string`, registry-backed |
| A8 | pre-seeded crime defaults | event-registry стартует пустым (universal-only) |
| A9 | **CrimeScene → SceneResidue** | genre-neutral rename (crimeType→sceneType, perpetratorId→actorId, victimId→affectedId, processKill→processAgentDeath, …) |
| A10 | PlayerJournal + accusation/evidence | извлечены в `crime-justice/investigation.ts`; движок получил `registerDialogueEffectHandler` + opaque `playerState` + `onPlayerObserve`; engine `journal.ts` удалён |

**Phase B — universal capability subsystems** (`feature/engine-generalization`, tsc 0, 262/262):

| Примитив | Файл | Суть |
|----------|------|------|
| **B1 Scalar Attributes** | `attributes.ts` | `ScalarAttribute {base, [min,max], modifiers[]}` (decay как MoodModifier). World API get/set/adjustBase/addModifier/**transferAttribute** (атомарный conserved). CG `attr` op. `registerScoringContributor` в computeUtility. Save/load. Backs gold/HP/standing/needs |
| **B2 Inventory** | `inventory.ts` | `Item {id, kind, quantity, state?}`. World API get/count/has/give/remove/**transferItem** (атомарный conserved). Реальная кража/торговля двигают state, а не только эмитят событие |
| **B3 Factions + standing** | `relationships.ts` | Open `RelationType` + `registerRelationshipType`/`getRelationshipDefaults` (7 universal-бондов). Ось `Relationship.standing` (-1..1) + `adjustStanding`. `AgentState.factions[]` + join/leave/isMember + CG `faction` op |

**Demo — Living Millhaven** (`feature/living-millhaven-demo`, **zero engine edits** — главный success criterion):
gold/inventory/factions/standing засеяны в world JSON; реальная кража (`transferItem`), вступление в `criminals`
при преступлении, CG-правило `merchant-guild-alarm` (op:`faction`), REST `buy`/`bribe`, WS `economy:update`,
фронт (💰 HUD + ⚖ justice-метр, бэйджи фракций, инвентарь, реальная лавка). Phase 4 (финальный verify/close) — в работе.

**Сопутствующее (LLM / обсервабилити)**: per-route warm/schemaInPrompt config + LLM-routing панель в World Editor;
reflection→sonnet; legacy web UI убран (root = game.html); IL over-extraction fix; диалоги без нарративных
действий + language-lock; auto-tick OFF по умолчанию; `bun` command picker; таймстемпы на логах + логи реплик NPC
(игрок↔NPC и NPC↔NPC) + per-call LLM-мета (модель/токены/стоимость/латентность).

**Открытые follow-up'ы**: полная A7b shop→inventory миграция (нужен economy-модуль; примитив готов),
A5b StepTemplate combat-поля, instinct RESISTANCE/TEXTURE registry-ификация.

---

## M7 — Economy & Trade (🔨 в разработке, v0.18.0-dev)

Второй жанр на универсальном движке — доказательство тезиса «один движок, контент = данные». Почти весь жанр —
контент модуля + 3 универсальных примитива движка. Crime-игра не тронута (регрессионный оракул). Ветка `feature/economy`.

**Универсальные примитивы движка** (genre-neutral, НЕ economy-специфичны):

| Примитив | Где | Суть |
|----------|-----|------|
| **E1 — drift скалярных атрибутов** | `attributes.ts` | `ScalarAttribute.drift {ratePerMinute, toward?}`; `driftAttribute()` двигает `base` к цели (линейно/экспоненциально). Основа цен и нужд |
| **E2 — overdraft transfer** | `world.ts` | `transferAttribute(..., {allowOverdraft})` уводит источник в минус до `min` (долги), сохраняя консервацию |
| **E3 — INTENT_KIND registry** | `il.ts` / `event-registry.ts` | Намерения игрока — данные модуля (`registerIntentKind`); «торговая» утечка снята из IL движка |

**Модуль economy** (`packages/modules/src/economy/`, zero engine imports):
- **8 аффордансов** (category `economic`): buy / sell / haggle / produce / hoard / smuggle / lend / collect_debt.
- Экономические решения: `registerScoringContributor` поднимает полезность экономических действий под давлением нужды/долга.
- Динамические цены (на E1): `price:KIND` дрейфует к supply/demand-цели (дефицит → дороже).
- Нужды: `hunger` растёт (E1), еда сбрасывает; bilateral (игрок тоже голодает).
- Долг/кредит (на E2): заём → запись в реестр → взыскание overdraft-переводом; дефолт уходит в пол.
- Кросс-модуль economy→crime: `DEBT_DEFAULT` → CG `debt-default-grudge` → `PERSONAL_GRUDGE` у кредитора → crime threaten/argue/kill реагируют. Нулевой общий код — только CG-шина.

**Статус**: E1/E2/E3 + P2–P5 ✅ (tsc 0, 299 тестов). Осталось **P6** (полировка фронта, рынки-venues,
контрабанда/мошенничество, эмиссия `SHORTAGE`, доп. кросс-модульный CG) + **финальный аудит** → мерж.

---

## Phase 3: World Expansion

### Новые подсистемы движка

Четыре подсистемы разблокируют модули Economy, Politics, Social, Survival. Каждая = engine-level код (пустые регистры), конкретное содержание = module data.

> **Статус:** Inventory ✅ (B2, M5), Factions ✅ (B3, M5), scalar-attribute слой ✅ (B1, M5 — gold/HP/standing/needs).
> **Needs/Resources** 🔨 частично запущены в M7 (`hunger` drift поверх B1 + eat-loop; полноценный `NEED_DEFINITIONS`-реестр впереди).
> **Trauma Layer** 🔜 ещё впереди.

#### Trauma Layer — необратимые изменения личности (впереди)

**Что:** Экстремальное событие → постоянный сдвиг OCEAN+H. Baseline меняется навсегда.

**Зачем:** Character arcs. NPC, переживший травму, принимает другие решения. Трусливый стражник после 3 столкновений с насилием → хладнокровный (N -0.15). Или ломается (N +0.2).

**Engine model:**
```
TraumaRule { trigger: EventType, condition: (agent, event) => boolean, shift: { trait: string, delta: number } }
Registry: TRAUMA_RULES — modules fill
```

**Принцип:** engine знает Trauma (trigger → personality shift). Crime module: "свидетель убийства → N +0.1". Economy module: "банкротство → C -0.05".

**Dependencies:** None (extends PM which exists).

**Разблокирует:** Horror жанр, глубокий Social, organic character development.

#### Inventory / Ownership — физические предметы ✅ DONE (B2 — `inventory.ts`)

**Что:** Предметы существуют в мире — в инвентаре NPC, на локации, в контейнере. Можно передать, украсть, потерять, найти, уничтожить.

**Зачем:** Реальная экономика. Кража = перемещение предмета (не только событие). Подкинуть нож = улика. Отравить вино = предмет со свойством.

**Engine model:**
```
Item { id, ownerId, locationId, properties: Record<string, unknown>, value: number }
Container { id, locationId, items: Item[] }
Transfer(item, from, to) → CG event
```

**Принцип:** engine знает Item, Container, Transfer. Crime module: нож, яд, улики. Economy: товары, деньги. Survival: еда, вода.

**Dependencies:** None.

**Разблокирует:** Economy module, physical evidence, crafting, trade.

#### Needs / Resources — потребности и давление (🔨 частично в M7, поверх B1)

**Что:** Числовые потребности (0=удовлетворена, 1=критическая). Растут со временем, удовлетворяются через affordances.

**Зачем:** Органическая мотивация. NPC ворует потому что семья голодает. Зима → еды мало → конкуренция → напряжение.

**Engine model:**
```
Need { name: string, value: number, growthRate: number, criticalThreshold: number }
Registry: NEED_DEFINITIONS — modules fill
```

**Affordance integration:** критическая потребность (>0.8) → boost для соответствующего affordance (hunger → eat/steal).

**Принцип:** engine знает Need (name, value, growth, threshold). Survival: hunger, thirst, warmth. Social: companionship. Economy: wealth.

**Dependencies:** Inventory (для physical satisfaction — eat item).

**Разблокирует:** Survival жанр, organic economy pressure, seasonal dynamics.

#### Factions / Groups — коллективные субъекты ✅ DONE (B3 — `relationships.ts`)

**Что:** Группы агентов с общей идентичностью: иерархия, shared beliefs, reputation, territory.

**Зачем:** Политика, организованная преступность, семьи. "Арестовали отца → жена и дети реагируют как группа."

**Engine model:**
```
Faction { id, name, members: Set<string>, hierarchy: Map<string, Role>, 
          sharedBeliefs: BeliefManager, reputation: Map<string, number>,
          territory: Set<string> }
Registry: FACTION_TYPES — modules define roles/structures
```

**Relationship integration:** faction membership → implicit relationship modifiers. Factions can have inter-faction sentiment/trust.

**Принцип:** engine знает Faction (members, hierarchy, beliefs, reputation). Politics: party, council. Crime: gang, cartel. Social: family, guild.

**Dependencies:** Reputation (basic — per-faction aggregate opinion).

**Разблокирует:** Politics module, organized crime, family dynamics, guild systems.

### Новые модули контента

Каждый модуль = набор записей в существующих регистрах + новые event types.

| Module | Affordances | CG Rules | Dependencies |
|--------|------------|----------|-------------|
| **Economy & Trade** 🔨 M7 | buy, sell, haggle, produce, hoard, smuggle, lend, collect_debt | DEBT_DEFAULT→grudge→crime (cross-module) | Attributes (B1), Inventory (B2) |
| **Social & Culture** | befriend, court, mentor, celebrate, mourn | marriage→family_bonds, death→grief_cascade | Factions (family), Trauma |
| **Politics & Governance** | propose_law, vote, rebel, campaign, bribe, ally | law_passed→restrictions, rebellion→faction_war | Factions, Reputation |
| **Combat & Warfare** | attack, defend, ambush, duel, siege, retreat | attack→damage, siege→territory_change | Factions (army units) |

### Registry Extensions (тривиальные, при необходимости)

Не требуют engine changes — просто новые записи в существующих регистрах:

| Registry | Расширение | Когда |
|----------|-----------|-------|
| REQUIREMENT_CHECKERS | location-based (atLocation), time-based (duringPeriod), faction-based (isMemberOf) | При первом модуле, который требует |
| TOPIC_SOURCE_REGISTRY | economyTopics, politicalTopics, familyTopics | При добавлении соответствующего модуля |
| STEP_HANDLERS | trade, craft, recruit, vote, duel | При добавлении модуля |
| EVENT_MOOD_SHIFTS | New event types from new modules | При регистрации event types |
| BELIEF_CREATORS | New belief patterns for new event types | При регистрации events |

### Подсистемы v2 (спеки готовы)

| Подсистема | Спека | Суть | Когда |
|-----------|------|------|-------|
| CG v2 | SPEC-cg-v2.md | NPC-state conditions (trait/relationship/belief), exclusive groups, trigger index | **Implemented** |
| Conversation Session | SPEC-conversation-session.md | Per-chat state for repetition tracking, multi-suspect escalation | **Implemented** |
| Heat System | SPEC-heat-system.md | Criminal danger awareness, belief-derived, secret directive prose | Phase 1 done |
| Criminal Escalation | SPEC-criminal-escalation.md | Motive confidence tiers (argue→steal→threaten→kill), growth over time | Spec ready |

### LoRA Fine-Tuning (DEFERRED)

Custom Qwen3.5-9B-CLWA: abliterated + LoRA. Инфраструктура готова (Unsloth, 740 examples, train.py). Was at step 70/279. Deferred until gameplay loop + Web UI stabilized. Dataset layered: Base (330 universal) + Module (410 crime-justice). Extensible for future modules.

---

## Phase 4: Scale & Multiplayer

### Hot/Warm/Cold NPC Scaling

8 NPC → полная обработка (LLM, memory, goals). 100+ → невозможно.

| Level | Processing | LLM | When |
|-------|-----------|-----|------|
| **Hot** | Full: volition, goals, dialogue, memory | Yes | Near player or active event |
| **Warm** | Numbers: mood, beliefs, movement, schedule | No | Adjacent locations, recently active |
| **Cold** | Minimum: mood += delta | No | Far away, no events |

Transitions: event nearby → hot. Player approaches → hot. Player leaves → warm → cold. At 1000 NPC: hot only 5-15 nearest.

### Combat System — Three-Tier AI

| Tier | AI | Latency | Who |
|------|-----|---------|-----|
| **Mobs** | Behaviour tree / utility AI (same PM weights) | <1ms | Rank-and-file |
| **Elite** | Trained ML model (offline RL) | <5ms | Mini-bosses |
| **Boss** | ML combat (real-time) + LLM reflection (between phases) | combat <5ms, reflection 1-2s | Unique bosses with personality |

PM weights drive all three tiers: aggressive mob (A=0.1) → melee. Cautious (N=0.9) → ranged + flee at 30% HP.

### Other Phase 4 Systems

| System | Description |
|--------|-------------|
| **Reputation** | Aggregate faction/city/region opinion. One number instead of 1000 relationships |
| **Territory** | Locations have controlling faction, influence level, contestability |
| **Multiplayer** | Each player = Agent (isPlayer). NPCs form opinions about each independently |
| **Voice** | Speech-to-text → IL → actions. IL is input-agnostic |
| **SpacetimeDB** | All logic in database, no separate game server. Free tier: 3M reducer calls/month |

---

## Phase 5: Living MMO

1000+ NPC, 100+ players per zone. Dynamic world events from world state. Emergent quests from NPC needs. Economy feedback loops. Player-run factions. History chronicle.

---

## Principles (immutable)

1. **Emergent narrative** — stories from system interactions, not scripts
2. **PM = instinct, LLM = consciousness** — personality drives urge, LLM/Human freely decides
3. **Declarative** — modules = data (affordances, rules, templates), not code
4. **Structured data** — no text matching, everything typed (beliefs, events, evidence)
5. **Bilateral** — every system works identically for NPC and Player
6. **Behavioral physics** — engine defines what's POSSIBLE, not what SHOULD happen
7. **Universal subsystems** — subsystems combine for any behavior
