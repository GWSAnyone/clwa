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

### Phase 1: Proof of Concept ✅
> Доказать что эмерджентный нарратив работает.

- [x] Engine Core v1 (AL, PM, CG, Goals, Beliefs, Relationships, Memory)
- [x] Crime & Justice module (partial)
- [x] Evidence Layer (v0.5.3)
- [x] Suspect interrogation (v0.5.1)
- [x] End-to-end judicial chain test (v0.5.2)
- [x] Godot demo (3D KayKit characters, navigation, map, notifications)
- **Результат**: демка "живая деревня с преступлением и расследованием"

### Phase 2: Player Integration ← СЕЙЧАС
> Игрок становится реальной сущностью в мире. Речь игрока создаёт structured effects.

**Проблема**: игрок — призрак. NPC обмениваются beliefs через beliefTransfer, создают goals, запускают CG каскады. Когда игрок говорит — это шум: broad categories + текстовые строки, которые движок игнорирует. Игрок не может влиять на мир через диалог.

**Решение**: IL извлекает structured meaning из речи → те же engine механизмы что NPC→NPC.

- [x] **Unified Actor Model** — Player = Agent (isPlayer, beliefs, relationships, mood, location)
- [x] **IL (Intent Layer)** — dialogue meaning extraction (claims, questions, requests, pressure)
- [x] **IL Effects** — claims → addBelief, requests → goals, pressure → mood/relationships
- [x] **Trust-based confidence** — player claims scaled by NPC trust. Trust shifts via interactions
- [x] **Trust evolution** — confirmed claims → trust up, refuted → trust down
- [x] **Perception System** — canSee/canHear/getCoPresent/getWitnesses/isPlayerAt
- [x] **AL as validator** — validatePlayerAction + createGoalFromRequest
- [x] **Event type/source flags** — isTransferable/isInformationOnly/isPerpetrator/isFirsthand/isConcealment
- [x] **isPlayer guards** — all NPC-only loops exclude player (volition, schedule, goals, targets, conversations)
- [x] **Co-location validation** — server authoritative, polygon-based location detection in Godot
- [x] **inPlayerChat freeze** — NPC frozen during player conversation
- [x] **Case resolution** — crime scene deactivation + belief zeroing on NPC_SENTENCED
- [x] **NPC awareness** — NPCs approach player (tick phase handler + WS), spread rumors about player (TopicSource)
- **Результат**: игрок влияет на мир через речь, NPC реагируют структурно

```
Player speech → IL → DialogueMeaning → Engine effects → CG/EL cascade
Player action → AL validate → Goal → Steps → CG/EL cascade
NPC decision  → Volition → Goal → Steps → CG/EL cascade
                                                  ↓
                                            Same pipeline
```

### Phase 2.9: Polish & Balance — ближайшие задачи
> Стабилизировать систему, расширить контент, подготовить демку.

#### E2E тест с prompt fix
- [x] Прогнать 3+ чистых запуска по 100+ тиков — steal выбирается LLM ✅
- [x] Проверить что murder chain работает без reflex — полная chain steal→investigate→arrest→sentence ✅
- [x] Проверить разнообразие affordances — полный аудит (v0.9.7+):
  - [x] `leverage` (blackmail) — verb fixed→'leverage', registered. Score 0.70, LLM picks correctly. Mark→Ted: subtle hint, natural dialogue ✅
  - [x] `steal` — Score 0.73 (Hilda target). LLM selects, goal executes (wait→steal_from). Target left = natural failure ✅
  - [x] `kill` — Score 0.78 (Bess target). LLM selects over steal. Full E2E: kill→body discovery→report→investigate→examine→interrogate→arrest→sentence ✅
  - [x] `lay_low` — Organic: Mark WANTED, mood -0.78. Chose lay_low (wait at home). Completed before arrest ✅
  - [x] `seek_forgiveness` — Organic: Mark WANTED, move_to priest. Personality-driven (3w2 stress→9: passive acceptance) ✅
  - [x] `flee_town` — Score 0.62 available but Mark prefers seek_forgiveness/blackmail (personality-correct). Flee = last resort for high-N NPCs ✅
  - [x] `report_crime` — Organic: Elara→Garrett after body discovery. beliefTransfer works ✅
  - [x] `testify` — Organic: Elara testifies to Garrett during investigation ✅
  - [x] `investigate` — Organic: Garrett full chain (move→examine_scene→interrogate→announce→arrest) ✅
  - [x] `evaluate_case` — Organic: Theron sentence_npc after arrest. Full judicial chain ✅
  - [x] `gossip` — Organic: Elara gossips, Magistrate gossips post-arrest ✅
  - [x] `grieve` — Score 0.64 for Mark (Bess victim). Available but personality chose other actions ✅
  - [x] `blackmail` — Organic: Mark blackmails Ted 4 times across test runs. Elara blackmails 2 times(!). Dominant crime affordance ✅
  - [x] `confront` — Hilda→Mark: "Old Bess is dead because of you." Full chain (move→interact→complete). Score 0.542 ✅
  - [x] `vigilante` — Requirements pass, score 0.712. PM correctly prefers duty actions for Millhaven NPCs (all high C/H). Not a bug — need low A+C NPC for natural trigger ✅
  - [x] `intimidate_witness` — Requirements pass, score 0.744. Mark prefers subtler crimes (steal 0.836, blackmail 0.794). suppressNearPlayer blocks when player co-located. PM-correct ✅
  - [x] `destroy_evidence` — Score 0.72 when Mark WANTED. Available, observed in previous test sessions. Outscored by blackmail in most runs ✅
- [x] Проверить что instinct builder descriptions корректно генерируются для всех tiers ✅

#### TopicEngine — критические фиксы + расширение
Аудит выявил 8 проблем. 3 критические, 3 высокие, 2 средние. Сначала фиксы, потом новый контент.

**Критические фиксы (v0.9.5):**
- [x] **Scheduler rebalance** — social scoring (relationship, extraversion, social hunger), crime bonus 5/2→3/1
- [x] **Belief transfer в разговорах** — TopicProposal.beliefTransfer, bidirectional, overhear ×0.3
- [x] **PM-influenced topic selection** — OCEAN обоих участников, range 0.6-1.4

**Высокие фиксы (v0.9.5):**
- [x] **Weighted random selection** — пропорциональный выбор вместо sort-and-pick
- [x] **Topic diversity tracking** — target ratios (35/25/15/10/10/5%), diversity bonus
- [x] **Content-aware importance** — observe() после analyzeConversationImpact, LLM-assessed importance

**Средние фиксы (v0.9.5):**
- [x] **Типизация** — ROLE_TOPIC_POOLS `any[]` → `RoleTopicDef[]`
- [x] **Убрать dual registration** — registerSource() удалён, TopicEngine читает TOPIC_SOURCE_REGISTRY напрямую

**Новые topic sources:**
- [x] **seasonalTopics** — period-based (dawn/morning/evening/night) + weekly milestones ✅ (v0.9.6)
- [x] **memoryTopics** — NPC recalls old beliefs (2+ days, conf≥0.4), bidirectional, beliefTransfer ✅ (v0.9.6)
- [x] **opinionTopics** — мнение о третьем NPC, death-aware, 3 sentiment паттерна (shared complaint/warm concern/disagreement) ✅ (v0.9.6)
- [x] **questionTopics** — low-conf beliefs → seeking confirmation + knowledge asymmetry → beliefTransfer ✅ (v0.9.6)

#### Conversation quality
- [x] **Structured dialogue** — JSON schema (speech + gesture), anti-narration, anti-echo. Research-backed "at most" phrasing
- [x] **Anti-repetition** — repeat_penalty 1.1 / frequency_penalty 0.3 / presence_penalty 0.2 (A/B tested, confirmed optimal)
- [x] **Anti-hallucination** — CRITICAL rule first in system prompt, beliefs in user prompt (not lost middle), gossip grounded with crime details
- [x] **Responder echo fix** — "React with YOUR OWN words — do NOT repeat"
- [x] **False testimony fix** — scene_notice source (not firsthand), only real witnesses can testify
- [x] **Conversation impact calibration** — mood calibration instruction added ("casual friendly = near zero") ✅ (v0.9.7)
- [x] **NPC speech consistency** — speechReminder = L0 description (style guidance), not L1 example (prevents verbatim copying) ✅ (v0.9.7)
- [x] **Dialogue quality overhaul** (v0.9.7):
  - parseDialogue returns speech only (gesture stripped from display)
  - Gesture schema constrained to one word (nods/shrugs/smiles)
  - YOUR TOPIC: prefix in initiator/responder prompts (topic hook first)
  - Topic subject added to responder prompt
  - knownFacts removed from buildSystemPrompt (-200 tokens lore noise)
  - Memory format: (today, vivid) instead of significance scores
  - Anti-parentheses in speech schema
- [x] **Socialize affordance** — social module, E-trait driven, socialOnly→visit goals, TopicEngine handles conversations ✅ (v0.9.7)
- [x] **TopicEngine v3.1** — worldFactTopics (1 proposal, w=0.5, 40% chance, shared category), innerConflict trust>=0.3 ✅ (v0.9.7)

#### Web UI клиент ← ОСНОВНАЯ ДЕМО-ПЛАТФОРМА (v0.9.8)

**Решение**: Canvas2D в браузере вместо Godot. Причина: полный контроль из кода, мгновенная итерация, не нужен editor. Godot клиент сохранён но отложен.

**Ассеты**: Tiny Swords (здания, юниты, terrain) из `godot/assets/tinyswords/`. Отдаются сервером через `/assets/`.

**Что работает (✅):**
- [x] Canvas2D карта с Tiny Swords tileset (тайлмап из Godot data) ✅
- [x] Animated NPC спрайты (Warrior/Pawn/Monk по роли, 5 фракций по цвету) ✅
- [x] A* pathfinding по tile grid (NPC и игрок не ходят по воде) ✅
- [x] WASD + клик-движение игрока (рыцарь Blue) ✅
- [x] Zoom колёсиком, плавная камера ✅
- [x] Speech bubbles с typewriter эффектом (NPC-NPC разговоры) ✅
- [x] Thought bubbles для volition decisions (crime/duty, не talk) ✅
- [x] Event feed (движения, разговоры, mood, thoughts, cascades) ✅
- [x] Auto-tick с localStorage persistence ✅
- [x] 5 WS типов: npc_thought, mood_update, goal_update, event_cascade, relationship_change ✅
- [x] Server-authoritative positions (PositionManager, NOT in engine) ✅
- [x] Seeded random для детерминированных NPC позиций ✅
- [x] Zone polygons в world.json ✅
- [x] Player position WS sync (5/sec throttle + validation) ✅
- [x] Conversation approach points от сервера ✅
- [x] save.json включает positions ✅
- [x] inTransit flag в engine (scheduler пропускает, clear at tick start) ✅

**Chat panel + IL (v0.9.9):**
- [x] Chat panel: стриминг, Escape close, avatar, mood/trust bars, status badge ✅
- [x] Persistent chat history per-NPC (localStorage, 50 cap, session separators) ✅
- [x] IL effects as collapsible badges on NPC responses (ILEffect[] → WS il_result) ✅
- [x] NPC Mind panel: Beliefs, Relationships, Goals, Personality (lazy-loaded accordion) ✅
- [x] Player position persistence (GET /api/player with x,y, restored on page refresh) ✅
- [x] XSS-safe rendering (escapeHTML + appendChild), auto-growing message area ✅

**Что нужно доделать:**
- [ ] Декор: камни, кусты из Tiny Swords на карте
- [ ] Day/night overlay (время суток влияет на визуал)
- [ ] Minimap
- [ ] Relationship graph overlay (линии между NPC)
- [ ] Crime scene маркеры на карте
- [ ] TileMap доработка: edge-тайлы, клифы

#### Godot клиент (ОТЛОЖЕН)

Сохранён в `godot/scenes/main_topdown.tscn` + `npc.tscn`. Старые 3D ассеты архивированы в `_archive/clwa-godot-3d/`. Может вернуться когда Web UI дойдёт до production quality и нужен будет нативный клиент.

#### Demo readiness
- [ ] Настроить начальные условия (tension seeds)
- [ ] Demo script — что показывать, в каком порядке
- [ ] 2-3 полных прогона с Web UI клиентом

#### NPC config externalization
- [x] World data externalized to `worlds/millhaven/` JSON files ✅ (v0.9.6)
  - world.json (locations, lore, config), npcs/*.json (8 NPC files), relationships.json, topics.json, secrets.json
  - World loader (`server/world-loader.ts`) reads JSON → creates engine structures
  - `--world=path` CLI argument, default `worlds/millhaven`
  - Zero TypeScript constants needed for world data. Scenario designer edits JSON only.
- [ ] Сценарист редактирует JSON без программиста → ноль code changes для нового мира

#### World Content Architecture (будущее — после externalization)
Цель: весь мировой контент живёт в папке мира (`modules/millhaven/`), а не размазан по коду. Три уровня:
- **Engine** — чистый механизм (TopicEngine, AL, PM, CG). Ноль контента.
- **Modules** (TypeScript) — поведенческая логика (social: beliefTopics/grief, crime-justice: justiceTopics). Код, не данные.
- **World data** (JSON) — всё что редактирует сценарист. Один мир = одна папка.

Что переносится в JSON (мировые данные):
- [ ] NPC профили, personality, relationships, schedules, starting moods
- [ ] Декларативные topic definitions (casual, mood, tension, comfort, inner conflict, role pools) — условия + текст
- [ ] World lore + background memories
- [ ] **LLM prompt templates** — system prompts, instinct description шаблоны, conversation hooks. Сценарист подстраивает тон/стиль мира без кода
- [ ] **World history** — события до начала игры, historical facts. Каждый модуль дополняет историю (crime module: "три года назад был последний суд", economy: "торговый путь закрылся зимой")

Что остаётся кодом (поведенческая логика в modules):
- Complex topic sources (итерация beliefs, cross-reference, dynamic generation)
- Affordance definitions с target finders
- CG rules, EL rules, step handlers

#### Architectural debt — module logic в engine
- [x] **Crime scene awareness** — moved to module tick phase handler ✅ (v0.9.5)
- [x] **Belief zeroing** — moved to module NPC_SENTENCED handler, verdict-conditional ✅ (v0.9.5)
- [x] **SOURCE_DECAY** — moved from engine hardcode to registry pattern ✅ (v0.9.5)
- [x] **Module step types** — generic ModuleStep, engine no longer knows steal/arrest/etc ✅ (v0.9.5)
- [x] **TopicEngine built-in sources** — 7→11 topic sources migrated to `modules/social/`, 4 new added ✅ (v0.9.6)
- [x] **Location hooks** — casualTopics hardcoded strings → `registerLocationHook` registry + world.json `conversationHook` ✅ (v0.9.6)
- [x] **Body discovery** — hardcoded memory/mood/belief in checkBodyDiscovery → DISCOVERY_HANDLERS registry. Module owns response ✅ (v0.9.7)
- [x] **Dead code** — checkMurderMotivation, askMurderDecision, spreadRumorsOnDayAdvance removed (~130 lines) ✅ (v0.9.7)
- [x] **Engine purity audit** — exhaustive check of all 18 World methods + 6 CG methods. ZERO module-specific content confirmed ✅ (v0.9.7)
- [x] **Action verb registration** — missing verbs (intimidate, confront) registered + runtime validation at startup ✅ (v0.9.7+)
- [x] **Location IDs in affordances** — evaluate_case, flee_town, demand_justice used display names instead of slugs ✅ (v0.9.7+)
- [x] **Location IDs in target-finders** — findGossipTarget returned display name, crime scene awareness belief.location used display name ✅ (v0.9.7+)
- [x] **socialOnly flag** — engine volition.ts had hardcoded `'socialize'` string. Replaced with `socialOnly` flag on AffordanceDefinition. Economy Module Test passes ✅ (v0.9.7+)
- [x] **PERSONAL_SECRET** — hardcoded in world.ts analyzeConversationImpact → registerSecretEventType/getSecretEventType registry ✅ (v0.9.9)
- [x] **IL behavioral constants** — all hardcoded multipliers/thresholds → ILConfig + ConversationConfig in WorldConfig ✅ (v0.9.9)
- [x] **IL bilateral parity** — isTransferable, confidence floor, adjustSentiment/adjustTrust (was direct mutation), location slug consistency ✅ (v0.9.9)
- [x] **IL dynamic schema** — static IL_EXTRACTION_SCHEMA → buildILSchema(ctx) with enum constraints from registries ✅ (v0.9.9)

Результат: `modules/millhaven/` → полный мир. `modules/pirate-cove/` → другой мир. Ноль изменений в engine/modules. Графический редактор читает/пишет JSON.

### Phase 2.5: Custom LLM — Qwen3.5-9B-CLWA (ОТЛОЖЕН)
> Своя модель, заточенная под движок. Uncensored + наш формат. Отложено до стабилизации gameplay loop и Web UI.

Текущая Qwen3.5-9B-abliterated избегает тёмных action verbs (steal, kill, leverage) в ~60% случаев из-за prompt dilution + остаточного safety alignment. LoRA fine-tuning научит модель **связи между параметрами личности и поведением**, а не запомненным ответам.

**Цель**: Qwen3.5-9B-CLWA — abliterated + LoRA fine-tuned. Модель понимает: Big Five → behavioral threshold, mood → amplifier, instinct tier → action urgency.

**Готовая инфраструктура** (сохранена, можно возобновить):
- [x] Unsloth 2026.3.8 + conda env `unsloth` (Python 3.12)
- [x] Модель: `C:\Ledevia\Projects\Models\Qwen3.5-9B-abliterated\` (17GB safetensors)
- [x] QLoRA 4-bit loading verified: 7.1 GB VRAM на RTX 3080, 2.9 GB свободно для адаптеров
- [x] GGUF thinking patch: `training/patch-gguf-thinking.py`
- [x] Датасет — 740 hand-crafted примеров в ChatML формате, контрастивные пары, per-NPC voice
- [x] train.py — Unsloth QLoRA, 4-bit, RTX 3080 10GB. VRAM optimizations

<details>
<summary>Датасет: слоёная архитектура (~740 примеров)</summary>

Зеркалит архитектуру CLWA: **Base (engine)** — фундаментальное понимание, не меняется при добавлении модулей. **Module** — поведение конкретного модуля, расширяется независимо.

**Ключевые принципы** (на основе research: BIG5-CHAT ACL 2025, OpenCharacter, 500+ LoRA experience):
- **Контрастивные пары** — одна ситуация + разная личность = разное решение. Учит СВЯЗЬ параметров и поведения, не {имя}→{действие}
- **Качество > количество** — каждый пример вручную с полным психологическим обоснованием
- **LoRA учит паттерны** — стиль, формат, behavioral reasoning. Не инъекция знаний
- **70% наших NPC + 30% вымышленных** — для генерализации personality→behavior mapping

**Base Layer (~330 примеров)** — универсальные, работают для ЛЮБОГО модуля:

| Тема | Кол-во | Что учит |
|---|---|---|
| **B1: Big Five → решения** | 120 | Контрастивные пары: H(16), C(16), A(16), N(16), E(16), O(12), multi-trait(28) |
| **B2: Enneagram → мотивация** | 30 | coreFear/coreDesire формируют reason в решениях |
| **B3: Mood → амплификатор** | 40 | Positive mood ингибирует crime, negative → enables |
| **B4: Tier → порог действия** | 40 | whisper=ignore, torrent=hard to resist |
| **B5: Dialogue quality** | 60 | ≤12/20 слов, без нарратива, per-personality voice |
| **B6: Impact analysis** | 40 | importance calibration 1-8, secret detection |

**Module: Crime & Justice (~410 примеров)** — специфичны для этого модуля:

| Тема | Кол-во | Содержание |
|---|---|---|
| **C1: Criminal actions** | 95 | steal(25), attack(25), leverage(20), intimidate(15), destroy_evidence(10) |
| **C2: Duty actions** | 50 | investigate(15), arrest(15), evaluate(10), interrogate(10) |
| **C3: Social actions** | 90 | confront, flee, vigilante, seek_forgiveness, testify, report, gossip, demand_justice |
| **C4: Crime dialogue** | 60 | murder/theft/suspicion/grief/cover-up темы |
| **C5: Crime interactions** | 55 | report/interrogate/confront/intimidate/leverage |
| **C6: Verdicts** | 60 | 5 типов × 12, varying evidence/severity/judge PM |

**Расширяемость**: добавить Economy = создать `modules/economy/` → combine с base → retrain. Base и Crime не трогаем.

```
training/dataset/
├── base/                          ← Universal, module-independent
│   ├── b1-personality/            ← Big Five → behavioral mapping
│   │   ├── honesty.jsonl
│   │   ├── conscientiousness.jsonl
│   │   ├── agreeableness.jsonl
│   │   ├── neuroticism.jsonl
│   │   ├── extraversion.jsonl
│   │   ├── openness.jsonl
│   │   └── multi-trait.jsonl
│   ├── b2-enneagram.jsonl
│   ├── b3-mood.jsonl
│   ├── b4-tier-threshold.jsonl
│   ├── b5-dialogue.jsonl
│   └── b6-impact.jsonl
├── modules/
│   └── crime-justice/
│       ├── c1-criminal.jsonl
│       ├── c2-duty.jsonl
│       ├── c3-social.jsonl
│       ├── c4-dialogue.jsonl
│       ├── c5-interactions.jsonl
│       └── c6-verdicts.jsonl
├── combine.ts                     ← base + modules → output JSONL
└── output/
    └── clwa-v1.jsonl
```

</details>

#### Оставшиеся шаги (при возобновлении)

- [ ] **QLoRA fine-tune** — was at step 70/279 (3 epochs). ~35 hours on RTX 3080 (shared memory). Resume from checkpoint supported.
- [ ] **Export GGUF** — Q4_K_M (~5GB) + thinking patch для LM Studio
- [ ] **Тестирование** — E2E: steal/leverage выбираются при high tier, JSON парсится, dialogue ≤12w, per-NPC voice

**Результат**: модель понимает personality→behavior mapping. Тёмные глаголы выбираются когда PM + mood + tier указывают. Dialogue quality. Расширяемый датасет для будущих модулей.

### Phase 3: World Expansion
> Новые подсистемы движка + модули контента. 4 engine-подсистемы разблокируют десятки модулей.

#### Streaming Tick — живой мир вместо слайд-шоу (RimWorld-inspired)

> **Референс**: [RimWorld Wiki — Time](https://rimworldwiki.com/wiki/Time), [How Pawns Think](https://github.com/roxxploxx/RimWorldModGuide/wiki/SHORTTUTORIAL:-How-Pawns-Think), [Custom Tick Scheduling (HugsLib)](https://github.com/UnlimitedHugs/RimworldHugsLib/wiki/Custom-Tick-Scheduling)
>
> **RimWorld**: 60 ticks/sec, 60,000 ticks/day, ThinkTree ~100-400 ticks, Toils per-tick, HashOffset распределяет нагрузку. Tick стоит микросекунды (детерминистика).
> **CLWA**: 96 ticks/day, 1 tick = 15 game minutes, tick стоит 10-15 секунд (LLM). Мир дёргается.
>
> **Корневая проблема**: `tickCount` = и game time, и processing trigger. Tick дорогой → game time течёт рывками по 15 минут.
> **Решение**: два тактовых генератора — Game Clock (быстрый, дешёвый) + Processing Loop (медленный, LLM-paced).

##### Что уже сделано (Streaming Tick Level 1-2)

- [x] **Level 1**: Server auto-tick с 0 delay (tick-when-ready), убрана 8с client пауза ✅ (v0.9.9)
- [x] **Level 2**: Per-NPC movement broadcast (не batch), async conversation impact (_pendingImpact pattern) ✅ (v0.9.9)

##### Phase 3.1: Game Clock — непрерывное время (Medium)

**Цель**: время течёт плавно (07:00 → 07:01 → 07:02), не прыжками по 15 минут.

**Архитектура**:
```
Game Clock (100ms timer, ~0 cost)     Processing Loop (LLM-paced)
├── gameMinute counter                ├── Volition: когда NPC без goal + cooldown
├── Day/night transitions             ├── Conversations: co-location + cooldown
├── Schedule checks                   ├── IL extraction: player speech
├── HUD time display                  ├── CG cascades: event reactions
├── Cooldown expiry checks            └── Impact analysis: deferred
└── Speed control (1x/2x/3x)
```

**Задачи**:
- [ ] `gameMinute` property на World (0-1439), advance timer (setInterval)
- [ ] Speed control: `gameSpeed` в WorldConfig (1x = 1 game min/real sec, 2x = 2/sec, 3x = 3/sec)
- [ ] Cooldowns: ticks → game minutes (affordance: 180min, decision: 60min, pair: 240min)
- [ ] Schedule: period boundaries в minutes (dawn: 300-420, morning: 420-720, etc.)
- [ ] `tickToHour` → `minuteToHour`, `getTimePeriod` по minutes
- [ ] Day advance: gameMinute >= 1440 → new day
- [ ] WS: broadcast time update per game minute → client HUD
- [ ] Speed buttons в HUD (1x/2x/3x/pause)
- [ ] Save/restore: gameMinute + gameSpeed в save.json

**Edge cases**:
- LLM call blocks Processing Loop на 3-5с — Game Clock продолжает. NPC "думает" пока время идёт → "thinking" indicator (пульсирующий "..." над головой)
- Настройки конфигурируемы через WorldConfig (gameSpeed, minutesPerRealSecond)

##### Phase 3.2: Continuous Movement (Medium-Large)

**Цель**: NPC ходит между локациями плавно, не телепортируется.

**Задачи**:
- [ ] move_to step: `startTime` + `duration` (game minutes) вместо 1-hop-per-tick
- [ ] Duration = distance / speed. Distance: BFS hops × hop_minutes (configurable, default 30 min/hop)
- [ ] NPC state: `inTransit` + `transitFrom` + `transitTo` + `transitProgress` (0-1)
- [ ] Game Clock advances transitProgress каждый game minute
- [ ] Arrival: transitProgress >= 1 → location update → trigger next goal step
- [ ] Co-location: NPC считается at location только при arrival (transitProgress === 0 или >= 1), не during transit
- [ ] PositionManager: interpolate pixel position during transit
- [ ] WS: broadcast transit progress updates (client animates smoothly)

**Edge cases**:
- NPC in transit когда conversation trigger → skip (not co-located)
- NPC in transit когда body discovered at destination → discover on arrival
- Save/restore: transit state persisted

##### Phase 3.3: On-Demand Processing (Large)

**Цель**: Processing Loop не "тикает" всех NPC пачкой, а обрабатывает по запросу.

**Задачи**:
- [ ] Refactor `_tick()` → `_processLoop()` — continuous loop, not batch
- [ ] Per-NPC state machine: `idle` / `executing_goal` / `awaiting_decision` / `in_conversation` / `in_transit`
- [ ] Processing queue: NPC добавляется когда нужно решение (goal complete, event, cooldown expired)
- [ ] Priority queue: urgent events (body discovery, arrest) → обрабатываются первыми
- [ ] LLM calls: one at a time (semaphore=1), queue manages order
- [ ] Conversation: triggered когда 2 NPC co-located + pair cooldown expired (Game Clock checks)
- [ ] Body discovery: Game Clock checks co-location dead+alive, triggers processing
- [ ] HashOffset (future, >20 NPC): `(gameMinute + npcId.hashOffset()) % interval` для распределения

**Edge cases**:
- Semaphore conflict: Game Clock и Processing Loop обе modify state → single-threaded JS event loop natural mutex (Bun is single-threaded for user code)
- Processing starvation: если LLM queue полна → NPC ждут. Visual: "thinking" indicator
- Multiple conversations: с on-demand, можно запускать 2-3 параллельно когда LLM свободен

##### Phase 3.4: Hot/Warm/Cold Agents (Medium, >20 NPC)

**Цель**: NPCs далеко от игрока обрабатываются реже.

**Задачи**:
- [ ] Proximity detection: player location → NPC distance в hops
- [ ] Hot (0-1 hop): full processing — volition, conversations, goal LLM steps
- [ ] Warm (2 hops): goals execute (non-LLM steps), mood/beliefs update, no volition LLM
- [ ] Cold (3+ hops): mood decay only, movement по schedule, no LLM
- [ ] Promotion: event near Cold NPC → promote to Warm/Hot
- [ ] Demotion: no events + player moved away → Hot → Warm → Cold (gradual)

**Визуальный эффект после всех фаз**:
```
07:00 — Garrett starts patrol (walks toward gate, visible on map)
07:01 — Ted opens tavern doors
07:02 — Elara walks toward market (she'll arrive ~07:15)
07:03 — Mark sets up his stall — [LLM: Mark evaluates, decides to trade]
07:05 — Hilda starts hammering — speech bubble appears
07:08 — Elara arrives at market — [LLM: conversation with Mark]
07:09 — "Good morning Mark" ... "The spices arrived late" (streaming speech bubbles)
07:12 — Mood shift visible on Elara (+0.03)
...continuous flow, no batch "ticks"
```

#### Новые подсистемы движка

**Trauma Layer — необратимые изменения личности**

Сейчас характер NPC статичен: Big Five + Enneagram заданы при создании и не меняются. В реальности экстремальные события меняют людей необратимо.

Как работает: событие (увидел убийство, потерял близкого, был предан) → постоянный сдвиг одной из шкал личности. Свидетель убийства → Neuroticism +0.1 навсегда. Предательство друга → Trust к людям -0.15.

Что даёт: character arcs. NPC, переживший травму, будет принимать другие решения год спустя. Не потому что скрипт — а потому что его личность сдвинулась. Трусливый стражник, трижды столкнувшийся с насилием, может стать хладнокровным. Или сломаться.

Принцип движка: engine знает Trauma (trigger, personality shift, permanent). Modules определяют какие события какие травмы вызывают. Crime module: «свидетель убийства → N +0.1». Economy module: «банкротство → mood -0.5 + C -0.05». Один механизм, разные данные.

**Inventory / Ownership — кто чем владеет**

Сейчас предметы — текст в магазинах. Кража создаёт событие, но предметы не перемещаются физически.

Как работает: предметы существуют в мире — в инвентаре NPC, на локации, в контейнере. Могут быть переданы, украдены, потеряны, найдены, уничтожены. У каждого предмета — владелец, ценность, свойства.

Что даёт: реальная экономика. Кража — перемещение предмета. Торговля — обмен на деньги. Крафт — превращение одних предметов в другие. Подкинуть нож в чужой дом — улика. Отравить бутылку вина — предмет со свойством.

Принцип движка: engine знает Item (id, owner, location, properties), Container, Transfer. Modules определяют конкретные предметы: Crime → нож, яд, улики. Economy → товары, деньги, ресурсы. Survival → еда, вода, инструменты.

**Need / Resource — потребности и давление**

Сейчас NPC действуют из-за mood и PM. Но нет потребностей: голод, усталость, жадность, одиночество — внутренние силы, создающие давление.

Как работает: каждая потребность — число 0 (удовлетворена) до 1 (критическая). Растут со временем, удовлетворяются через affordances: голод → eat, жадность → trade/steal, одиночество → seek_company. Критическая потребность (> 0.8) — NPC бросает всё и ищет удовлетворение.

Что даёт: органическая мотивация. NPC ворует потому что его семья голодает. Торгует потому что нужны деньги на еду. Зима → еды мало → NPC конкурируют за ресурсы → напряжение растёт естественно.

Принцип движка: engine знает Need (name, value, growth rate, critical threshold). Modules определяют потребности: Survival → hunger, thirst, warmth. Social → companionship, respect. Economy → wealth, security.

**Faction / Group — коллективные субъекты**

Сейчас каждый NPC — отдельная сущность. Нет групп: «стража города», «гильдия торговцев», «семья».

Как работает: группы — коллекции агентов с общей идентичностью: иерархия (лидер, советники, рядовые), общие beliefs (группа «знает»), репутация (город доверяет страже на 0.7). Агент может состоять в нескольких группах. Группы враждуют, союзничают, поглощают друг друга.

Что даёт: политика — мэр предлагает закон → советники голосуют → фракция замышляет переворот. Организованная преступность — гильдия воров с иерархией и территорией. Семья — арестовали отца → жена и дети реагируют как группа.

Принцип движка: engine знает Group (members, hierarchy, shared beliefs, reputation, territory). Modules определяют типы: Politics → party, council, kingdom. Crime → gang, cartel. Social → family, guild, religion.

#### Новые модули контента

- [ ] **Economy & Trade** — affordances: buy, sell, craft, smuggle, invest. CG: trade → price change, smuggle → if caught → wanted. EL: transaction records, suspicious goods. Requires: Inventory, Needs
- [ ] **Social & Culture** — affordances: befriend, court, mentor, celebrate, mourn. CG: marriage → family bonds, death → grief cascade. Requires: Factions (family), Trauma
- [ ] **Politics & Governance** — affordances: propose law, vote, rebel, campaign, bribe. CG: law passed → new restrictions, rebellion → faction war. Requires: Factions, Reputation (basic)
- [ ] Multiple NPC archetypes (noble, thief, merchant guild, priest order)
- [ ] Larger world (20+ locations, 30+ NPCs)
- [ ] **Skills / Knowledge** (basic) — что агент умеет (не personality = склонность, а competence = способность). Кузнец умеет ковать. Навыки можно получить, передать, потерять.

**Результат**: разнообразный мир с экономикой, политикой, социальными связями. Модули комбинируются: торговец-контрабандист арестован → политический кризис, потому что он советник мэра.

#### Streaming Tick System — от пакетов к потоку (вдохновлено RimWorld)

Сейчас World.tick() обрабатывает всех NPC пакетно: 7 NPC → TickResult → WS broadcast. Мир "мигает" раз в 8 секунд. RimWorld решает эту проблему distributed tick scheduling + multi-frequency updates + Job system. Наш контекст другой (LLM = 99.97% времени тика, 7 NPC не 200 пешек), но три идеи переносимы напрямую.

**Уровень 1: Streaming WS per-NPC** (низкая сложность, огромный визуальный эффект)

Внутри `World.tick()` NPC уже обрабатываются последовательно (LLM semaphore=1). Mark думает 4с, потом Aldric 3с. Но Godot получает обновления только после завершения ВСЕГО тика. Изменение: эмитить WS-события per-NPC по мере обработки (movement, goal progress, conversation). Ноль изменений в игровой логике — чисто presentation layer.

Результат: вместо "8с тишины → все дёрнулись" → "каждую секунду кто-то движется". Мир "течёт".

**Уровень 2: Hot/Warm/Cold variable frequency** (средняя сложность, реальная экономия LLM)

Агенты далеко от игрока обновляются реже:
- **Hot** (co-located с игроком): полная обработка каждый тик, включая volition
- **Warm** (1-2 локации): movement/mood каждый тик, volition каждый 2-й тик
- **Cold** (далеко, без событий): mood каждый тик, movement каждый 2-й, volition каждый 4-й

С 7 NPC: ~2-3 hot + 2-3 warm + 1-2 cold → в среднем ~4 NPC на volition вместо 7. Экономия 30-40% LLM-вызовов. При масштабировании до 50+ NPC — критически необходимо.

**Уровень 3: Hash-offset distributed scheduling** (средняя сложность, нужен при >20 NPC)

RimWorld trick: `(ticksGame + thingID.HashOffset()) % interval == 0`. Каждый NPC обрабатывается в свой момент, нагрузка размазана равномерно. С 7 NPC выигрыш минимален — все и так обрабатываются за один цикл. При 50+ — предотвращает spike'и. Реализация: NPC ID → hash → slot в round-robin цикле.

**НЕ переносимо из RimWorld** (и почему):
- Sub-second micro-ticks (60/сек) — бессмысленно. RimWorld tick стоит наносекунды (ThinkTree детерминистический). Наш tick стоит секунды (LLM). Уменьшение гранулярности не ускорит LLM.
- Async LLM pipeline — с 1 GPU (concurrency=1) параллелизм LLM-вызовов невозможен. Выигрыш от async cheap ops между LLM-вызовами — 10мс из 4000мс. Станет актуально при нескольких inference endpoints.
- Camera-based LOD (RimWorld 1.6) — для MMO не применимо (у каждого игрока своя "камера"). Заменяется proximity-based hot/warm/cold.

**Job System — уже реализован.** Goal System с шагами (move_to → interact → announce) = RimWorld Job. NPC получает Goal → исполняет шаги тик за тиком без повторного LLM-вызова. Volition запускается только при завершении/провале цели или реактивном событии. Это ключевая оптимизация RimWorld, и она у нас с v0.5.

Порядок: Level 1 → Level 2 → Level 3 (по мере роста числа NPC).

### Phase 4: Scale & Multiplayer
> От деревни к живому миру. Сотни NPC, десятки игроков, настоящая война.

#### NPC Scaling — трёхуровневая симуляция

8 NPC обрабатываются полностью (LLM, память, цели). 100+ — невозможно гонять LLM для каждого.

| Уровень | Что делает NPC | LLM | Когда |
|---|---|---|---|
| **Hot** | Полная обработка: LLM, память, цели, диалог | Да | Рядом с игроком или в активном событии |
| **Warm** | Числа: mood, beliefs, movement, schedule | Нет | Соседние локации, недавно активен |
| **Cold** | Минимум: mood += delta, fatigue += 0.1 | Нет | Далеко, давно без событий |

Переходы автоматические: событие рядом → warm→hot. Игрок подошёл → hot. Ушёл → hot→warm→cold. На 1000 NPC — hot только 5-15 ближайших.

#### Combat System — трёхуровневый боевой ИИ

LLM для real-time боёвки не подходит — даже 50ms latency убивает action combat. Решение — три уровня:

**Mechanical AI (мобы, рядовые)** — чистые числа, < 1ms.

Behaviour tree или utility AI на тех же OCEAN+H весах из PM. Агрессивный моб (A=0.1, N=0.2) → ближний бой, не отступает. Трусливый (N=0.9) → атакует издалека, убегает при 30% HP. Стайный (E=0.8) → координируется с группой, фланкирует. PM уже даёт веса — Combat System читает их для тактики вместо LLM.

**Trained AI (элитные, мини-боссы)** — ML модель, < 5ms.

Reinforcement Learning агент, обученный offline. Модель маленькая (~1-5MB), inference мгновенный. Обучена на комбинациях: «против танка → фланг», «против мага → сокращай дистанцию». PM шкалы = параметры reward function при обучении: агрессивный босс обучался с наградой за атаку, осторожный — за выживание.

**Personality Bosses (уникальные боссы-личности)** — ML combat + LLM рефлексия.

Два слоя работают одновременно:
- Быстрый (combat): ML модель → удар, блок, уклонение, способность. Миллисекунды.
- Медленный (личность): LLM вызывается **между фазами боя**, не каждый кадр:
  - Босс на 50% HP → пауза → LLM: «Ты ранен. Твой страх — показать слабость. Что скажешь?» → уникальная фраза + стратегическое решение (агрессия / подмога / сделка)
  - Phase transitions, триггеры (игрок нашёл слабость)
  - PM → боевой стиль (preference weights для ML). LLM → стратегия + dialogue + character moments

```
Мобы:     PM weights → Behaviour Tree        [< 1ms, детерминированно]
Элитные:  PM weights → Trained ML model       [< 5ms, адаптивно]
Боссы:    PM → ML (real-time) + LLM (паузы)   [combat < 5ms, рефлексия 1-2s]
```

**Со стороны игрока**: combat = чистый action input. Но CLWA добавляет слой:
- Beliefs NPC о игроке влияют на бой: босс, уважающий игрока → честный дуэль. Ненавидящий → удар в спину.
- Репутация: известный убийца → мобы сдаются или убегают. Слабак → нападают агрессивнее.
- IL в бою: игрок кричит «Сдавайся!» → IL → boss evaluates (trust, HP, mood) → может сдаться.
- CG после боя: убийство босса → его фракция объявляет войну. Пощада → босс может вернуться союзником.

#### Другие подсистемы Phase 4

- [ ] **Reputation** — агрегированное мнение фракций/города/региона. «Город знает тебя как вора» — одно число вместо 1000 отношений. Репутация влияет на цены, доступ, NPC реакции.
- [ ] **Territory / Control** — у каждой локации контролирующая фракция, уровень влияния, оспариваемость. Захват меняет правила: новые законы, новые affordances.
- [ ] **Multi-player** — каждый игрок = Agent с isPlayer. Те же beliefs, relationships, perception. NPC формируют мнение о каждом отдельно.
- [ ] **Voice integration** — speech-to-text → IL → action. Голос = ещё один input method, IL не зависит от источника текста.
- [ ] **Persistent economy** — supply/demand across sessions, trade routes, inflation

**Результат**: прототип MMO-мира с сотнями NPC и десятками игроков.

### Phase 5: Living MMO
> Полноценный persistent мир, где каждое действие необратимо меняет историю.

- [ ] 1000+ NPC, 100+ players per zone
- [ ] Dynamic world events (wars, plagues, migrations) — возникают из состояния мира, не из скриптов
- [ ] Emergent quests — не «убей 10 волков», а «кузнец потерял поставки из-за бандитов — помоги или нет»
- [ ] Economy feedback loops — инфляция, дефицит, торговые маршруты
- [ ] Player-run factions, guilds, governments — управляемые людьми, по правилам мира
- [ ] History chronicle — каждый день записывается, через год — летопись из тысяч реальных событий
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
