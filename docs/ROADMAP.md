# CLWA — Roadmap

> Движок поведенческой физики для эмерджентных миров.
> Сюжет не программируется — он возникает из взаимодействия систем.

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

## Текущее состояние: v0.11.1

### Завершено

| Phase | Описание | Версия |
|-------|---------|--------|
| **Phase 1** | Proof of Concept — 8 NPC, E2E chain kill→investigate→arrest→sentence | v0.5-v0.8 |
| **Phase 2** | Player Integration — IL v2, bilateral design, trust evolution, Web UI | v0.9-v0.10 |
| **Milestone 1** | Replayable Crime — trait/mood/relationship randomization, Scenario Manager | v0.11.0 |

### В работе

| Milestone | Описание | Версия | Статус |
|-----------|---------|--------|--------|
| **Milestone 2** | Detective Toolkit — accusation, evidence presentation, prevention, journal v2 | v0.12 | Done (backend + Web UI) |

### Engine подсистемы (14 реализовано)

| Подсистема | Версия | Назначение |
|-----------|--------|-----------|
| AL (Affordance Layer) | v2 | Пространство возможностей. 20+ affordances, declarative steps, instinct builder |
| PM (Personality Model) | v1 | OCEAN+H + Enneagram → utility scores, instinct prose, stress/growth |
| CG (Consequence Graph) | v1 (v2 spec ready) | Реактивные каскады. 13 rules. v2: NPC-state conditions + exclusive groups |
| EL (Evidence Layer) | v1 | Structured evidence at locations, discovery, weights |
| IL (Intent Layer) | v2 | Player speech → structured meaning → engine effects. Dynamic JSON schema |
| Beliefs | v1 | Confidence, source dedup, decay, transfer weights |
| Goals | v1 | Multi-step plans, priority preemption, pursuit, module step handlers |
| Memory | v1 | Qdrant vector memory, semantic recall, reflection |
| Relationships | v1 | Bilateral sentiment/trust, typed, grief/testimony weights |
| Perception | v1 | canSee/canHear/getCoPresent/getWitnesses, location-based |
| Schedule | v1 | 5 periods, per-NPC entries, priority 3 goals |
| Clock | v1 | Master Clock, ProcessingQueue (7 task types), NPC state machine (6 states) |
| Journal | v2 | Structured evidence fields, suspect tracking, case summary scoring |
| Dialogue | v1 | Structured JSON (speech+gesture), TopicEngine v3.1 (13 sources) |

---

## Milestone Roadmap (Game — GDD_DETECTIVE.md)

| # | Milestone | Версия | Описание | Статус |
|---|-----------|--------|----------|--------|
| 1 | Replayable Crime | v0.11 | Randomization + motive pool → каждый рестарт = другой сценарий | Done |
| 2 | Detective Toolkit | v0.12 | Accusation, evidence, prevention, journal | Done |
| 3 | Living Opposition | v0.13 | Garrett variability, escalation, heat, NPC resistance, dual-layer mood, criminal confidence | Spec: CG v2, Design: Mood Review |
| 4 | Complete Session | v0.14 | Arrival event, win/lose, end-of-run summary | — |
| 5 | Polish & Demo | v0.15 | Case journal UI, day/night, sound, tutorial, balance, arousal dimension, emotional tagging | Design: Mood Review |

---

## Phase 3: World Expansion

### Новые подсистемы движка

Четыре подсистемы разблокируют модули Economy, Politics, Social, Survival. Каждая = engine-level код (пустые регистры), конкретное содержание = module data.

#### Trauma Layer — необратимые изменения личности

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

#### Inventory / Ownership — физические предметы

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

#### Needs / Resources — потребности и давление

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

#### Factions / Groups — коллективные субъекты

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
| **Economy & Trade** | buy, sell, craft, smuggle, invest, barter | trade→price_change, smuggle→if_caught→wanted | Inventory, Needs |
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
| CG v2 | SPEC-cg-v2.md | NPC-state conditions (trait/relationship/belief), exclusive groups, trigger index | M3 prep |
| Conversation Session | SPEC-conversation-session.md | Per-chat state for repetition tracking, multi-suspect escalation | With M2 UI |

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
