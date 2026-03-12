# CLWA — Roadmap

> **CLWA — движок поведенческой физики для эмерджентных миров.**
>
> Как физический движок определяет как объекты падают и сталкиваются,
> CLWA определяет как сущности решают, действуют и переживают последствия.
> Сюжет не программируется — он возникает из взаимодействия систем.

---

## Архитектура: три слоя

```
┌─────────────────────────────────────────────────────┐
│                   Platform Layer                     │
│  Godot Client · Web UI · Voice · Multiplayer · API  │
├─────────────────────────────────────────────────────┤
│                World Modules (DATA)                  │
│  Crime & Justice · Economy · Politics · Combat · ... │
├─────────────────────────────────────────────────────┤
│                 Engine Core (CODE)                   │
│  AL · PM · CG · EL · IL · Beliefs · Goals · Memory  │
│  Relationships · Perception · Spatial · Schedule     │
└─────────────────────────────────────────────────────┘
```

**Engine Core** — подсистемы. "Законы поведенческой физики". Код.
**World Modules** — контент. "Мир, построенный на этой физике". Данные.
**Platform** — интерфейс. "Как ты взаимодействуешь с миром". Клиенты.

---

## Engine Core — подсистемы

Каждая подсистема — независимый модуль с чётким API. Подсистемы комбинируются для создания поведения. Новые подсистемы расширяют движок, не ломая существующие.

### Существующие (✅)

| Подсистема | Назначение | Статус |
|---|---|---|
| **AL (Affordance Layer)** | Пространство возможностей. Что ФИЗИЧЕСКИ ВОЗМОЖНО в данном контексте | ✅ v1 |
| **PM (Personality Model)** | Идентичность. OCEAN+H → instincts, prose context | ✅ v1 |
| **CG (Consequence Graph)** | Каузальность. Event → cascade → state change | ✅ v1 |
| **Goal System** | Преследование. Multi-step plans, execution, chase | ✅ v1 |
| **Belief System** | Знание. Structured facts, confidence, decay, sources | ✅ v1 |
| **Relationship System** | Социальные связи. Sentiment, trust, type, grief | ✅ v1 |
| **Memory System** | Опыт. Vector memory (Qdrant), semantic recall | ✅ v1 |
| **Schedule System** | Рутина. Time-based routines, daily life patterns | ✅ v1 |
| **Spatial System** | Топология. Locations, adjacency, pathfinding | ✅ basic |

### Спроектированные (📋)

| Подсистема | Назначение | Документация |
|---|---|---|
| **EL (Evidence Layer)** | Обнаруживаемые факты. Event → structured evidence на локациях | DEMO_PLAN.md §3 |

### Необходимые (🔮)

| Подсистема | Назначение | Зачем |
|---|---|---|
| **IL (Intent Layer)** | Мост между свободным вводом и structured actions | Player freedom, voice, bilateral |
| **Perception System** | Что сущности могут видеть/слышать/знать | Стелс, подслушивание, информация |
| **Economy System** | Ценность, обмен, производство, спрос/предложение | Торговля, ремесло, деньги |

---

## Intent Layer (IL) — ключевая подсистема

### Проблема

Для NPC: AL генерирует варианты → LLM выбирает один → structured action.
Для игрока: ???

Игрок НЕ ДОЛЖЕН выбирать из меню. Игрок должен мочь сказать/написать **что угодно**, а движок должен это понять, проверить и выполнить.

### Принцип

```
NPC:    AL → PM → LLM → Action    (генерация решения)
Player: Free input → IL → Action   (интерпретация решения)
                          ↓
                    Одинаковый путь:
                    Action → Validation → Goal → CG/EL → State
```

AL для NPC = **генератор** вариантов (что можно предложить LLM).
AL для Player = **валидатор** намерений (можно ли то, что игрок хочет).

Игрок не видит affordance list. Игрок видит мир и действует свободно. Движок проверяет: возможно ли это физически?

### Как работает IL

```
Player: "Эй, Гаррет, я видел Марка у тела Бесс прошлой ночью"
  ↓
IL (LLM parse): {
  action: 'inform',
  target: 'garrett',
  content: { suspect: 'mark', event: 'NPC_KILLED', victim: 'bess', evidence: 'witness' }
}
  ↓
Validation: player at same location as Garrett? Garrett alive? → yes
  ↓
Execute: create belief in Garrett {subject: 'mark', eventType: 'NPC_KILLED', source: 'testimony'}
  ↓
CG/EL cascade → Garrett now investigates Mark
```

```
Player: "Хочу отравить колодец"
  ↓
IL (LLM parse): { action: 'sabotage', target: 'well', method: 'poison' }
  ↓
Validation: does player have poison? Is player at well? → no poison
  ↓
Response: "У тебя нет яда. Bess's herb shop might have something..."
  (движок объясняет ПОЧЕМУ нельзя — constraint, не menu)
```

```
Player (future voice): "Я тихо следую за Марком"
  ↓
Speech-to-text → text → IL → { action: 'follow', target: 'mark', mode: 'stealth' }
  ↓
Same pipeline
```

### Симметрия

```
NPC "решает":  Engine → LLM → "DO: kill Bess" → parseDoWhy → structured action
Player "хочет": Human → voice/text → "убить Бесс" → IL parse → structured action
                                                                      ↓
                                                               Same: validate → execute → CG → EL
```

**parseDoWhy** (volition.ts) и **IL parse** — это две стороны одной монеты. Обе преобразуют natural language → structured action. Различие: источник текста (LLM vs человек).

### Voice Integration (будущее)

```
Microphone → Speech-to-text → IL → Action pipeline
```

Voice — просто ещё один input method. IL не зависит от источника текста.

---

## World Modules — контент на движке

Каждый модуль = **DATA**, не код:
- Affordances (что можно делать)
- CG rules (что происходит после)
- EL rules (какие улики создаются)
- Belief modifiers (какие знания влияют на urgency)
- Step templates (как выполняется)
- Target finders / target roles

### Crime & Justice (Milestone 5) ← ТЕКУЩАЯ

```
Affordances: steal, kill, report_crime, testify, interrogate, arrest, evaluate_case...
CG rules:    NPC_KILLED → WITNESS_MEMORY → RUMOR_SPREAD → WANTED_STATUS
EL rules:    NPC_KILLED → opportunity + motive + physical evidence
Belief mods: NPC_KILLED → testify +0.5, report_crime +0.5
```

### Economy & Trade (будущее)

```
Affordances: buy, sell, craft, hire, invest, barter, smuggle
CG rules:    TRADE → price_change, CRAFT → item_created, SMUGGLE → if_caught → WANTED
EL rules:    TRADE → transaction_record, SMUGGLE → suspicious_goods
Belief mods: price_surge → buy/sell urgency, scarcity → hoard
```

### Politics & Governance (будущее)

```
Affordances: propose_law, vote, rebel, campaign, bribe, ally, betray
CG rules:    LAW_PASSED → new_restrictions, REBELLION → faction_war
EL rules:    SECRET_MEETING → who_attended evidence, BRIBE → financial_trail
Belief mods: injustice → rebel urgency, loyalty → support urgency
```

### Combat & Warfare (будущее)

```
Affordances: attack, defend, ambush, duel, siege, retreat, surrender
CG rules:    ATTACK → damage/death cascade, SIEGE → territory_change
EL rules:    BATTLE → witness_accounts, weapon_evidence
Belief mods: threat → fight/flee urgency, ally_attacked → defend urgency
```

### Social & Culture (будущее)

```
Affordances: befriend, court, mentor, celebrate, mourn, gossip, teach
CG rules:    MARRIAGE → family_bonds, FESTIVAL → mood_boost, DEATH → grief_cascade
EL rules:    CEREMONY → attendance_record, SECRET_AFFAIR → rumor_seeds
Belief mods: loneliness → social urgency, grief → comfort urgency
```

---

## Фазы развития

### Phase 1: Proof of Concept ← СЕЙЧАС
> Доказать что эмерджентный нарратив работает.

- [x] Engine Core v1 (AL, PM, CG, Goals, Beliefs, Relationships, Memory)
- [x] Crime & Justice module (partial)
- [ ] Evidence Layer
- [ ] Suspect interrogation
- [ ] End-to-end judicial chain test
- [ ] Godot demo (watch + examine crime scenes)
- **Результат**: демка "живая деревня с преступлением и расследованием"

### Phase 2: Engine Foundation
> Формализовать движок. Bilateral design. Player = Agent.

- [ ] **Intent Layer (IL)** — free-form input → structured action
- [ ] **Unified Actor Model** — Player = Agent (beliefs, relationships, mood, status)
- [ ] **AL as validator** — player actions validated, not menu-driven
- [ ] **Perception System** — what entities can sense (visibility, hearing range)
- [ ] **Engine API formalization** — clear interfaces between subsystems
- [ ] Все action paths bilateral (player action = NPC action = same CG/EL)
- **Результат**: игрок может делать ВСЁ что может NPC, теми же системами

### Phase 3: World Expansion
> Наполнить мир контентом через движок.

- [ ] **Economy & Trade** module (affordances + CG rules + EL rules)
- [ ] **Social & Culture** module
- [ ] **Politics & Governance** module (basic)
- [ ] Multiple NPC archetypes (merchant, noble, thief guild, etc.)
- [ ] Larger world (20+ locations, 30+ NPCs)
- **Результат**: разнообразный мир с экономикой, политикой, социальными связями

### Phase 4: Scale & Multiplayer
> От одного игрока в деревне к MMO.

- [ ] **Multi-player** — несколько human actors в одном мире
- [ ] **NPC scaling** — tiered simulation (full AI for nearby, simplified for distant)
- [ ] **World zones** — seamless areas, load balancing
- [ ] **Voice integration** — speech-to-text → IL → action
- [ ] **Persistent economy** — supply/demand across sessions
- **Результат**: прототип MMO-мира с сотнями NPC и десятками игроков

### Phase 5: MMO
> Полноценный persistent мир.

- [ ] 1000+ NPC, 100+ players per zone
- [ ] Dynamic world events (wars, plagues, migrations)
- [ ] Emergent quests (not scripted, arise from NPC needs)
- [ ] Reputation & fame (your actions define how world sees you)
- [ ] Player-run factions, guilds, governments
- [ ] Economy feedback loops (inflation, scarcity, trade routes)
- **Результат**: MMORPG нового поколения с truly living world

---

## Принципы (неизменные)

1. **Эмерджентный нарратив**: сюжет возникает из взаимодействия систем, не программируется
2. **PM = инстинкт, LLM = сознание**: personality определяет тягу, LLM/Human свободно решает
3. **Декларативно**: world modules = данные (affordances, rules, templates), не код
4. **Нет text matching**: всё через structured data (beliefs, events, evidence)
5. **Bilateral**: каждая система работает одинаково для NPC и player
6. **Player freedom**: никаких меню. Свободный ввод → IL → validation → execution
7. **Физика поведения**: движок определяет что ВОЗМОЖНО, не что НУЖНО делать
8. **Universal subsystems**: подсистемы комбинируются для любого поведения

---

## Ключевое определение

**CLWA Engine** — движок поведенческой физики.

Физический движок: масса + сила → ускорение → позиция.
CLWA: personality + situation → decision → action → consequences → new situation.

Физический движок не знает что такое "машина" — он знает rigid bodies и joints.
CLWA не знает что такое "убийство" — он знает affordances, beliefs и consequences.

"Убийство" = affordance (AL) + personality weights (PM) + kill goal steps + CG rules + evidence rules (EL).
"Торговля" = affordance (AL) + personality weights (PM) + trade goal steps + CG rules + evidence rules (EL).
Тот же движок. Разные данные.
