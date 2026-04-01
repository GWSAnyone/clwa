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
| **EL (Evidence Layer)** | Обнаруживаемые факты. Event → structured evidence → discoverable | ✅ v1 |
| **Spatial System** | Топология. Locations, adjacency, pathfinding | ✅ basic |

### Необходимые (🔮)

| Подсистема | Назначение | Зачем |
|---|---|---|
| **IL (Intent Layer)** | Извлечение structured meaning из речи игрока к NPC | Игрок влияет на мир через диалог |
| **Perception System** | Что сущности могут видеть/слышать/знать | Стелс, подслушивание, awareness |
| **Economy System** | Ценность, обмен, производство, спрос/предложение | Торговля, ремесло, деньги |

---

## Intent Layer (IL) — слой речи

### Проблема

Сейчас, когда игрок говорит NPC — речь **не существует** для движка:
- `classifyIntent` → broad category (`accuse`, `threaten`...), без КТО/ЧТО/ГДЕ/КОГДА
- `applyIntentEffects` → хардкод mood shifts + текстовые observe-строки
- NPC получает `"A stranger accused Mark"` как **текст**, а не belief
- Движок не создаёт beliefs, не триггерит goals, не запускает CG

Сравни с NPC→NPC: `beliefTransfer` копирует structured beliefs с source weight → Garrett получает `addBelief({eventType, subject, source: 'testimony', confidence})` → может расследовать → CG каскад.

**Речь игрока имеет НОЛЬ механического эффекта.** Игрок — призрак в мире.

### Что такое IL

IL — это **dialogue meaning extractor**. Не command parser, не intent classifier. Полноценный извлечитель structured meaning из natural language.

```
NPC→NPC: runInteraction → beliefTransfer → structured beliefs
Player→NPC: speech → IL → DialogueMeaning → те же engine primitives
```

IL — инверсия chatStream:
- chatStream: structured NPC state → LLM → natural text ДЛЯ игрока
- IL: natural player text → LLM → structured meaning ДЛЯ движка

### DialogueMeaning — что извлекает IL

```typescript
interface DialogueMeaning {
  speechAct: SpeechAct;           // inform, question, request, accuse, threaten, trade...
  claims?: Claim[];               // утверждения о мире (кто, что, где, когда)
  questions?: Question[];         // вопросы (о ком, о чём)
  requestedAction?: RequestedAction; // просьба к NPC (расследуй, арестуй)
  emotionalPressure?: EmotionalPressure; // давление (угроза, лесть, шантаж)
  tradeIntent?: TradeIntent;      // торговля
  extractionConfidence: number;   // уверенность LLM в извлечении
}

interface Claim {
  eventType?: string;     // из registry (NPC_KILLED, GOODS_STOLEN...)
  subject?: string;       // КТО (NPC name → resolved to ID)
  object?: string;        // КОГО/ЧТО
  location?: string;      // ГДЕ (location name → resolved to ID)
  timePeriod?: string;    // КОГДА (period name)
  source: 'witnessed' | 'heard' | 'suspects' | 'deduced';
  confidence: number;     // 0-1
}

interface RequestedAction {
  action: string;         // affordance name (investigate, arrest, examine)
  target?: string;        // NPC или location
  urgency: number;        // 0-1
}
```

### Как IL кормит движок

```
┌──────────────────────────────────┬───────────────────────────────────────────────┐
│         DialogueMeaning          │            Engine Effect                       │
├──────────────────────────────────┼───────────────────────────────────────────────┤
│ claims[]                         │ addBelief(source:'testimony', conf*trust)     │
│ questions[]                      │ gather NPC beliefs → chatStream context       │
│ requestedAction                  │ evaluate affordance → create NPC goal         │
│ emotionalPressure                │ mood shift + relationship + event store       │
│ tradeIntent                     │ shop system                                    │
└──────────────────────────────────┴───────────────────────────────────────────────┘
```

**Ключевое**: все эффекты идут через те же engine механизмы что и NPC→NPC:
- Claims → `addBelief()` (тот же что в beliefTransfer)
- Goals → `NpcGoal` (тот же что создаёт volition)
- Events → `CG cascade` (тот же граф последствий)

### Примеры

```
Игрок → Garrett: "Я видел как Mark убил Bess прошлой ночью"
  ↓
IL: { claims: [{ eventType: 'NPC_KILLED', subject: 'mark', object: 'bess',
       source: 'witnessed', confidence: 0.9 }] }
  ↓
Engine: Garrett.beliefs.addBelief({
  eventType: 'NPC_KILLED', subject: 'Mark', object: 'Old Bess',
  source: 'testimony', sourceNpcId: 'player',
  confidence: 0.9 * trust(Garrett→Player)  // тот же trust scaling
})
  ↓
CG: belief triggers investigate affordance → Garrett creates goal
  ↓
Garrett расследует. Тот же E2E chain.
```

```
Игрок → Garrett: "Ты должен расследовать Market Square"
  ↓
IL: { requestedAction: { action: 'investigate', target: 'market', urgency: 0.7 } }
  ↓
Engine: has affordance 'investigate'? requirements met? trusts player?
  → yes: create investigate goal for Garrett
  → no: NPC explains why not (нет доказательств, не доверяет)
```

```
Игрок → Ted: "Твой эль на вкус как вода"
  ↓
IL: { claims: [{ subject: 'ted', topic: 'ale_quality' }],
      emotionalPressure: { type: 'guilt', intensity: 0.5 } }
  ↓
Engine: touches Ted's secret → secret directive activates → defensive response
```

```
Игрок → Hilda: "Что ты знаешь о Mark?"
  ↓
IL: { questions: [{ about: 'mark', topic: 'knowledge' }] }
  ↓
Engine: gather Hilda.beliefs where subject='mark' → inject into chatStream
  ↓
Hilda отвечает из СВОИХ structured beliefs, не галлюцинирует
```

### Confidence через trust

Confidence claim'а игрока масштабируется доверием NPC к игроку:

```
effectiveConfidence = claim.confidence × trust(NPC → Player)
```

- Новый знакомый: trust 0.3 → "Mark убил Bess" → conf 0.27 (слабый belief)
- Доверенный друг: trust 0.8 → "Mark убил Bess" → conf 0.72 (достаточно для расследования)
- Ловили на лжи: trust 0.1 → "Mark убил Bess" → conf 0.09 (игнорирует)

Trust эволюционирует:
- Claim подтверждён позже → trust растёт
- Claim опровергнут → trust падает
- Repeated positive interaction → trust растёт

### Симметрия

```
NPC→NPC: interaction → beliefTransfer → beliefs, conf * sourceWeight
Player→NPC: speech → IL → DialogueMeaning → beliefs, conf * trust
                                                        ↓
                                              Same: addBelief → CG → EL
```

**beliefTransfer** (goals.ts) и **IL** — две стороны одной монеты. Оба преобразуют коммуникацию → structured beliefs. Различие: источник (NPC knowledge vs player speech).

### Voice Integration (будущее)

```
Microphone → Speech-to-text → IL → DialogueMeaning pipeline
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
- [x] Evidence Layer (v0.5.3)
- [x] Suspect interrogation (v0.5.1)
- [x] End-to-end judicial chain test (v0.5.2)
- [x] Godot demo (3D KayKit characters, navigation, map, notifications)
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
