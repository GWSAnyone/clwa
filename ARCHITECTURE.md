# Causal Living World Architecture (CLWA)

> **Цель:** Архитектура симуляции живого игрового мира с причинно-следственной историей, многоуровневыми агентами и LLM-диалогом
> **Вдохновение:** Disco Elysium (процесс расследования важнее результата), Dwarf Fortress (глубина симуляции), Stanford Generative Agents (архитектура памяти), Shangri-La Frontier (необратимые события)
> **Принцип вех:** Каждая веха — демонстрация возможностей технологии CLWA. Мы строим **возможности**, не сценарии — сценарии это конфигурации начальных условий + правил поверх песочницы
> **Дата начала:** Март 2026 | **Последнее обновление:** 19 марта 2026

---

## 1. Видение

Жанр MMORPG 20 лет клонирует формулу WoW. Фундаментальная проблема — философская: студии боятся **необратимых событий**. Результат: NPC без памяти, мир без истории, игрок как турист.

CLWA объединяет три подхода:

| Источник | Что взяли |
|---|---|
| **Dwarf Fortress** | Тысячи агентов, глубина симуляции, история до начала игры. Нет LLM — чистые числа |
| **Stanford Generative Agents** | Memory Stream + Reflection + Planning. Нет масштабирования до MMO |
| **Inworld AI / Convai** | Живой диалог. Нет симуляции последствий — NPC "забывают" через 5 минут |

CLWA объединяет все три подхода: глубокая симуляция + LLM-диалог + причинно-следственный граф.

**Ключевое дизайнерское решение:** никакого load/save. Умер NPC — умер. Философия проекта. В мультиплеере — тоже необратимо.

---

## 2. Архитектура ядра — подсистемы

> Пять подсистем: **AL** (что можно), **PM** (кто ты), **CG** (последствия), **EL** (улики), **LLM** (сознание).
> Все пять подсистем реализованы. EL добавлена в v0.5.3.

### 2.1 CG (Consequence Graph) — Граф последствий

> Существующая, работающая подсистема. Отвечает за **последствия**: что будет после действия.

Причинно-следственные правила. Событие не просто записывается — оно **порождает каскадную цепочку реакций**. Слух распространяется постепенно. NPC в дальней локации узнают позже.

**Структура правила:**

```typescript
interface ConsequenceRule {
  id: string;
  trigger: EventType;
  conditions: RuleCondition[];
  consequence: {
    type: EventType;
    importance: number;
    delayDays: number;
    probability: number;    // 0-1
  };
  maxChainDepth: number;    // защита от комбинаторного взрыва (default: 3)
}
```

**Реализованные правила:**

```
1. NPC_KILLED + has_witnesses → WITNESS_MEMORY (importance: 8, мгновенно) + mood -0.4
2. WITNESS_MEMORY + is_guard → WANTED_STATUS (importance: 7, мгновенно)
3. WITNESS_MEMORY + is_public_place → RUMOR_SPREAD (importance: 6, prob: 0.8)
4. RUMOR_SPREAD + is_guard → WANTED_STATUS (importance: 7)
5. При /day: свидетели из публичных мест → слухи в соседние локации
```

Движок обрабатывает правила рекурсивно: последствие одного правила может стать триггером другого. Также автоматически создаёт beliefs (WITNESS_MEMORY → confidence 0.95, RUMOR_SPREAD → 0.4, testimony → f(trust)).

### 2.2 PM (Personality Model) — Модель личности

> Реализована. Определяет **кто NPC есть** — характер, мотивации, страхи. Используется в AL (utility scoring), LLM decision prompt (personality context, instincts), stress/growth shifts.

Гибридная модель из двух психологических систем:
- **OCEAN+H** (Big Five + Honesty-Humility из HEXACO) — 6 непрерывных шкал 0.0–1.0. Определяют **КАК** NPC поступает. Используются как числовые множители в utility scoring.
- **Enneagram** (тип + крыло) — определяет **ПОЧЕМУ** NPC поступает. Core fear/desire обогащают LLM промпт; стресс/рост направления создают динамические сдвиги.

#### OCEAN+H — поведенческие черты

| Ось | Что измеряет | Высокая (→1.0) | Низкая (→0.0) |
|---|---|---|---|
| **O** (Openness) | Любопытство, креативность | Замечает подтекст, нестандартные решения | Практичный, "факты и только факты" |
| **C** (Conscientiousness) | Дисциплина, долг | Следует расписанию, закон важнее | Импульсивный, хаотичный |
| **E** (Extraversion) | Социальная энергия | Инициирует разговоры, многословен | Тихий, лаконичный |
| **A** (Agreeableness) | Эмпатия, доверие | Добрый, прощает, избегает конфронтации | Подозрительный, конкурентный |
| **N** (Neuroticism) | Стресс-реактивность | Тревожный, паника при трупе | Хладнокровный |
| **H** (Honesty-Humility) | Честность, бескорыстие | Честен даже в ущерб себе | Обманет, украдёт, возьмёт взятку |

**H — главный предиктор преступного поведения.** NPC с низким H — основные кандидаты на кражу, обман, шантаж.

**Комбинации создают характеры:**
- A=0.8, H=0.3 — добр к друзьям, но обманет чужака ради выгоды
- C=0.9, A=0.3 — строго следует закону без сострадания
- E=0.9, H=0.5 — болтун, знает все слухи, может приукрасить

#### Enneagram — мотивационное ядро

| Тип | Название | Core Fear | Core Desire |
|---|---|---|---|
| 1 | Perfectionist | Быть неправым, порочным | Целостность, добро |
| 2 | Helper | Быть нелюбимым | Быть нужным |
| 3 | Achiever | Быть никчёмным | Успех, признание |
| 4 | Individualist | Не иметь идентичности | Уникальность |
| 5 | Investigator | Быть некомпетентным | Понимание мира |
| 6 | Loyalist | Остаться без опоры | Безопасность, поддержка |
| 7 | Enthusiast | Быть обделённым | Свобода, удовлетворение |
| 8 | Challenger | Быть контролируемым | Автономия, сила |
| 9 | Peacemaker | Конфликт, разрыв связей | Мир, гармония |

Каждый тип имеет **стресс** и **рост** направления:
- Стресс (mood < -0.5): поведение временно сдвигается к стресс-типу
- Рост (mood > 0.3, стабильные отношения): сдвиг к росту
- **Baseline OCEAN+H не меняется** — это временная реакция, не изменение личности

#### Уровни изменений личности

| Уровень | Что | Когда | Обратимость | Система |
|---|---|---|---|---|
| **Baseline** | OCEAN+H значения, Enneagram тип | Задаётся при создании NPC | Неизменный* | PM |
| **Временный сдвиг** | Поведение смещается к стресс/рост паттерну | mood пересекает порог | Полностью обратимый | PM |
| **Постоянное изменение** | OCEAN+H baseline сдвигается | Травматическое событие | Необратимый | Trauma Layer (будущее) |

*Baseline неизменен в рамках PM. Trauma Layer сможет навсегда сдвигать OCEAN+H: свидетель убийства → N +0.1 навсегда. Это character arc.

#### Модель данных

```typescript
interface NpcPersonality {
  // OCEAN+H — behavioral traits (0.0 - 1.0)
  openness: number;
  conscientiousness: number;
  extraversion: number;
  agreeableness: number;
  neuroticism: number;
  honesty: number;

  // Enneagram — motivational core
  enneagramType: number;     // 1-9
  enneagramWing: number;     // adjacent type
  coreFear: string;
  coreDesire: string;
}
```

#### Использование в системах CLWA

| Потребитель | Что берёт из PM | Как использует |
|---|---|---|
| **Affordance Layer** | OCEAN+H значения | Множители в utility scoring (H×0.4 → penalty для кражи) |
| **LLM Prompt** | coreFear, coreDesire, OCEAN+H → стиль | System prompt: "Your deepest fear is..." |
| **Stress response** | Enneagram стресс/рост + mood | Сдвиг поведения при mood < -0.5 / > 0.3 |
| **Trauma Layer** (будущее) | Baseline OCEAN+H | Постоянные сдвиги от травматических событий |

#### Статус реализации

- [x] `BigFive` + `Enneagram` interfaces в `agent/src/types.ts`
- [x] Профили 7 NPC с OCEAN+H + Enneagram
- [x] Интеграция в `buildSystemPrompt()` (coreFear/coreDesire + стиль из OCEAN+H)
- [x] Временные сдвиги (`buildStressGrowthDirective()` — mood < -0.5 стресс, > 0.3 рост)
- [x] Интеграция с AL (weights × OCEAN+H → utility scores → instinct descriptions)

### 2.3 AL (Affordance Layer) — Слой возможностей

> **Слой возможностей определяет что NPC МОЖЕТ сделать. LLM определяет что NPC ДЕЛАЕТ.**

Аффорданс (affordance, термин Дж. Гибсона) — возможность действия, возникающая на стыке агента и среды. Нож "аффордит" нарезку кому угодно, но убийство — только тому у кого есть мотив. Добавить новое поведение = добавить запись данных (Affordance), а не писать код.

#### Архитектурная петля CLWA

```
State (mood, beliefs, relationships)
  ↓
AL фильтрует: что ФИЗИЧЕСКИ ВОЗМОЖНО (декларативные requirements)
  ↓
PM строит контекст: КТО ТЫ (personality → prose, instinct descriptions)
  ↓
LLM свободно решает: намерение в 1-2 предложениях
  ↓
Classifier маппит намерение → executable goal steps
  ↓
CG каскадирует последствия → обновляет State → цикл
```

**Ключевой принцип: constrained creativity.** LLM свободен внутри пространства возможного. Не хаос (Smallville), не детерминизм (Utility AI). Импровизация актёра на сцене с конкретными декорациями.

#### Affordance — модель данных

```typescript
interface Affordance {
  id: string;                    // 'steal', 'report_crime', 'blackmail'
  label: string;                 // "Steal from a nearby shop"
  category: 'crime' | 'social' | 'duty';
  severity: number;              // 1-10, для реакций свидетелей
  requires: AffordanceRequirements;  // Жёсткий фильтр: МОЖНО ли (location, role, mood, time)
  weights: AffordanceWeight[];       // PM scores → сила инстинкта (prose в промпте)
  goalType: string;
  goalPriority: number;
  eventBoost?: EventBoost;           // Reactive: boost при CE event
}
```

#### Роли трёх слоёв в принятии решений

| Слой | Роль | НЕ роль |
|---|---|---|
| **AL** (affordances) | Фильтр: что физически возможно прямо сейчас | ~~Выбор действия~~ |
| **PM** (personality) | Контекст: кто ты, что чувствуешь, куда тянет (prose) | ~~Score для автовыбора~~ |
| **PM scores** | Описание инстинкта ("сильно тянет", "на краю сознания") | ~~Fallback / числовой выбор~~ |
| **LLM** | Свободное решение: намерение персонажа | ~~Озвучка чужого выбора~~ |
| **Classifier** | Маппинг свободного намерения → goal steps | — |
| **CG** | Последствия → state update → новый цикл | — |

#### PM как инстинкт, LLM как сознание

PM scores не выбирают действие — они формируют **ощущение тяги** в промпте:

```
Ты — Elara, бард. Ты в отчаянии (mood -0.7).
Ты украла у Old Bess и теперь в розыске. Garrett ищет тебя.
Ты сейчас на Market Square. Рядом: Mark, Hilda.

Твой страх: потерять свою уникальность и быть никем.
Твоё желание: чтобы тебя ценили и восхищались тобой.
Под стрессом ты становишься отстранённой и замкнутой.

Тебя сильно тянет уйти домой и затаиться — страх и тревога захлёстывают.
Где-то глубоко скребёт совесть — мысль о покаянии мелькает на краю сознания.

Что ты делаешь? Опиши своё намерение одним предложением.
```

LLM отвечает свободно. Может последовать инстинкту, а может создать **moment of character growth** — перешагнуть через страх и пойти к Hilda объясниться. Оба варианта in character. Второй — emergent, его мы не программировали.

**Без PM** у LLM нет характера → все NPC одинаковы.
**С PM** каждый NPC реагирует по-своему → Hilda (8w9, low A) при розыске → "конфронтировать в ответ". Elara (3w4, high N) → "затаиться".

#### Каталог аффордансов

| Affordance | Cat | Sev | Requires | PM Weights | Reactive |
|---|---|---|---|---|---|
| `steal` | crime | 4 | noGuard, shop nearby, mood<-0.6 | H↓, N↑ inhibit, C↓ | — |
| `kill` | crime | 10 | motive, night/evening, mood<-0.3, sentiment<-0.3 | A↓, H↑ inhibit, C↓, N↑ | — |
| `vigilante` | crime | 8 | crimeBelief≥0.6, mood<-0.4, sentiment<-0.4 | A↓, H↓, E↑ | — |
| `blackmail` | crime | 5 | mood<-0.3 | H↓, E↑, N↑ inhibit | — |
| `confront` | social | 3 | crimeBelief≥0.5, sentiment<-0.2 | E↑, A↓, N↓, H↑ | — |
| `report_crime` | duty | 2 | notGuard, witnessBelief | C↑, H↑, N↑ inhibit | WITNESS_MEMORY, THEFT_DISCOVERED (+0.4) |
| `investigate` | duty | 2 | isInvestigator | C↑, O↑ | WANTED_STATUS (+0.5) |
| `gossip` | social | 1 | notGuard | E↑, N↑ | RUMOR_SPREAD (+0.2) |
| `grieve` | social | 1 | notGuard | N↑, A↑ | WITNESS_MEMORY, RUMOR_SPREAD (+0.3, relation) |
| `lay_low` | social | 1 | notGuard | N↑, E↓ | WANTED_STATUS (+0.3, criminal only) |
| `seek_forgiveness` | social | 1 | notGuard | A↑, H↑, N↑ | WANTED_STATUS (+0.3, criminal only) |
| `interrogate` | duty | 2 | isInvestigator, crimeBelief≥0.3 | C↑, H↑, O↑ | WANTED_STATUS, TESTIMONY (+0.4) |
| `arrest` | duty | 6 | isInvestigator, crimeBelief≥0.7 | C↑, A↓ | WANTED_STATUS (+0.6) |
| `testify` | duty | 1 | notGuard, witnessBelief | H↑, C↑, A↑ | WITNESS_MEMORY, BODY_DISCOVERED (+0.3) |
| `demand_justice` | social | 2 | notGuard, crimeBelief≥0.3 | E↑, A↓, C↑ | RUMOR_SPREAD (+0.2, relation) |
| `destroy_evidence` | crime | 4 | isCriminal, noGuard, noWitness, night/evening | H↓, N↑, C↓ | WANTED_STATUS (+0.4) |
| `intimidate_witness` | crime | 5 | isCriminal, noGuard, night/evening | H↓, A↓, E↑ | WANTED_STATUS (+0.3) |
| `flee_town` | crime | 3 | isCriminal, isWanted, mood<-0.5 | N↑, C↓ | NPC_ARRESTED (+0.5) |
| `evaluate_case` | duty | 3 | canSentence, hasDetainedNpc | C↑, H↑ | NPC_ARRESTED (+0.5) |

#### Механизмы стабильности

| Механизм | Назначение |
|---|---|
| **Mood decay** | Настроение дрейфует к базелайну личности (f(N,E)) каждый день. Предотвращает doom spiral |
| **Affordance cooldown** | 12 тиков (3h game) между повторами одного affordance (configurable via WorldConfig) |
| **Decision cooldown** | 4 тика (1h game) между LLM-решениями одного NPC (configurable) |
| **Conversation cooldown** | 16 тиков (4h game) между разговорами одной пары (configurable) |
| **Goal completion → mood** | Завершение цели даёт mood boost (catharsis) |
| **Belief decay по source** | witness/body: 1%/день, testimony: 2%/день, rumor: 4%/день |
| **Sentiment cascade** | RUMOR_SPREAD → -0.15 к преступнику. WANTED_STATUS → guard -0.4 |
| **Belief zeroing** | NPC_SENTENCED: investigators→0, others→0.2. Stops post-resolution loops |
| **minimumScore** | Critical affordances (arrest, investigate, evaluate_case) guarantee high score when conditions met |
| **notPerpetrator** | Perpetrators blocked from testify, report_crime, demand_justice, confront |

#### Declarative Step Templates

Шаги goal описываются прямо в affordance definition — **данные, не код**. Resolver разрешает ссылки и интерполяцию автоматически.

```typescript
// Пример: добавить новый affordance = только данные
{
  id: 'bribe',
  label: 'Offer a bribe to avoid trouble',
  category: 'crime', severity: 3,
  requires: { moodBelow: -0.2, notGuard: true },
  weights: [{ trait: 'H', direction: 'low', multiplier: 0.4 }],
  moodWeight: 0.2, relationshipWeight: 0.1,
  baseProbability: 0.3, goalType: 'bribe', goalPriority: 4,
  stepTemplates: [
    { action: 'move_to', location: '$target', skipIfAt: true },
    { action: 'interact', targetId: '$target',
      purpose: 'subtly offer {targetName} a bribe. Be discreet.',
      importance: 5 },
    { action: 'move_to', location: '$home', skipIfAt: true },
  ],
}
```

**Ссылки в location:** `$target` → targetLocation, `$home` → npcHome, `$extra.KEY` → target.extra[KEY], или литерал.
**Ссылки в targetId:** `$target` → target.targetId, или литерал.
**Интерполяция строк:** `{var:fallback}` → target.extra[var] ?? fallback. Переменные: targetName, reason, killerName, victimName, crimeLocation, crimeType, relationshipDesc + все ключи из target.extra.
**skipIfAt:** step добавляется только если NPC не уже на этой локации.

Масштабирование: новый affordance = одна запись в AFFORDANCE_REGISTRY. Ноль кода в switch/case.

#### computeUtility — формула

Четыре входа, raw score clamped [0, 1]:

```
personalityScore = SUM(weight.multiplier * effective(trait, direction))
  где effective = direction=='high' ? traitValue : (1-traitValue)

moodContribution = moodWeight * max(0, -agent.mood)
relContribution  = relationshipWeight * max(0, -sentiment)

situationalContribution = SUM(
  для каждого beliefModifier:
    modifier.weight * max(confidence среди beliefs с совпадающим eventType)
)

utility = clamp(0, 1, personality + mood + relationship + situation)
```

**Четыре входа**: личность (OCEAN+H), настроение, отношение к цели, **ситуация** (beliefs NPC). Ситуативный вход делает urgency контекстно-зависимой: NPC, нашедший труп, получает compulsion-level score для testify/report_crime, даже если его personality traits умеренные.

**beliefModifiers** — декларативные связки "какие beliefs усиливают какой affordance":

| Affordance | NPC_KILLED | GOODS_STOLEN | Эффект |
|---|---|---|---|
| testify | +0.5 | +0.4 | Видел труп → compulsion идти к стражнику |
| report_crime | +0.5 | +0.4 | Аналогично |
| investigate | +0.4 | +0.3 | Стражник с beliefs → расследовать |
| interrogate | +0.3 | +0.2 | Стражник допрашивает |
| arrest | +0.3 | +0.2 | Стражник арестует |
| gossip | +0.15 | +0.1 | Слабый бонус (не конкурирует с testify) |
| grieve | +0.3 | — | Скорбь по жертве |

**MIN_SCORE = 0.3** — affordance появляется в промпте только если utility >= 0.3.

#### targetRole — универсальный role-based finder

Вместо отдельных finder-функций для каждой роли (findGuardTarget, findPriestTarget...) affordance объявляет `targetRole: 'guard'`. Универсальная функция `findByRole`:

1. Фильтрует NPC по `role === targetRole`
2. Приоритизирует по proximity (та же локация → соседняя → дальняя)
3. Обогащает `extra` из crime beliefs NPC (killerName, victimName, crimeType)

```
targetRole: 'guard'   → ближайший стражник
targetRole: 'priest'  → ближайший жрец
targetRole: 'healer'  → ближайший лекарь (будущее)
```

Масштабирование: новая социальная роль = `targetRole: 'role'` в affordance data. Ноль новых функций.

`targetFinder` (custom) остаётся для сложной логики: interrogation (свидетели на crime scene), arrest (suspect по belief subject), steal (hasShop), kill (motive target).

Приоритет: `targetRole` > `targetFinder` > `aff.id` (fallback).

#### Instinct Builder v2 — procedural instinct descriptions

Score → vivid prose через 5 компонентов:

| Компонент | Источник | Что даёт |
|---|---|---|
| **Intensity** (7 tiers) | score 0.3-1.0 | whisper → echo → temptation → grip → flood → torrent → abyss |
| **Texture** (3 classes) | affordance.severity | emotional (grief) / calculating (theft) / primal (violence) |
| **Enneagram drive** | agent.enneagram.type | WHY this NPC feels this pull (core fear/desire) |
| **Resistance** | opposing PM traits + resistTraits | Counter-voice (high H → guilt, high A → empathy) |
| **Escalation + Mood** | considerationCount + mood | Repeated consideration + physical stress symptoms |

**No reflex bypass** — LLM always decides. No "MUST act" directives. Vivid descriptions naturally guide decisions.

**No RP framing** — volition prompt starts with character identity, not "You are a character in a simulation" (triggers safety alignment even on abliterated models).

#### Scoring v2

```
score = personality (OCEAN+H weights)
      + moodWeight × moodCurve(mood)        — non-linear, bidirectional
      + relWeight × sentimentCurve(sentiment) — non-linear, bidirectional
      + situation (beliefModifiers × confidence)
      + trustWeight × trust                   — inhibits harm, boosts cooperation
```

**moodCurve**: positive mood inhibits crime. Sliding zone (-0.3 to -0.6) = ×1.5. Numbness (-0.8+) = ×0.6.
**sentimentCurve**: mirrors mood zones. Positive sentiment inhibits harm.
**trustWeight**: per-affordance. steal: -0.1 (trust inhibits). report: +0.05 (trust boosts).

#### Belief Transfer Direction

Interact step поддерживает `beliefTransferDirection`:
- `'target-to-owner'` (default) — guard interrogates witness, gets their beliefs
- `'owner-to-target'` — witness testifies to guard, gives them beliefs

#### Evidence Synthesis (`examine_scene` step)

Когда guard приходит на crime scene и выполняет `examine_scene`, система синтезирует suspicion beliefs из structured data:

1. **Opportunity**: `personsPresent` из CrimeScene — кто был на месте преступления
2. **Motive**: relationship sentiment < -0.3 к жертве → boost confidence

| Факт | Confidence | BeliefSource |
|---|---|---|
| Был на месте (opportunity) | 0.3 | `deduction` |
| Был на месте + мотив (sentiment < -0.3) | 0.5 | `deduction` |

Это позволяет расследование **без прямых свидетелей**: guard осматривает сцену → выводит подозреваемых → допрашивает → при достаточных доказательствах (conf ≥ 0.7) арестовывает.

**Универсальность**: работает для любого "кто это сделал?" — murder, theft, sabotage, espionage.

**Порядок тика** (обновлённый):
```
0.   Day advance
0.5  Schedule goals (priority 3)
0.6  Body discovery → beliefs + reactive goals
0.7  Night walks (priority 2)
0.85 AL proactive evaluation (beliefModifiers → situational urgency)
1.   Goal execution (movement, interactions, examine_scene, sentence)
2.   Random movement
2.5  Crime scene awareness
2.7  Theft discoveries
3.   Conversations
```

#### Debug Endpoints

| Endpoint | Действие |
|---|---|
| `GET /api/debug/mood/:id/:value` | Установить mood NPC |
| `GET /api/debug/move/:id/:location` | Телепортировать NPC |
| `GET /api/debug/sentiment/:id/:targetId/:value` | Установить sentiment |
| `GET /api/debug/volition/:id` | Показать все affordances/scores без вызова LLM |
| `POST /api/npc-kill/:killerId/:victimId` | NPC-on-NPC murder (для тестирования) |

#### Статус реализации

- [x] `affordances.ts` — реестр 19 аффордансов с declarative step templates
- [x] `volition.ts` — LLM-driven proactive decisions (DO/WHY) + reactive evaluation + cooldowns
- [x] PM integration (OCEAN+H weights → utility scores → instinct descriptions в промпте)
- [x] Template resolver (resolveTemplates, interpolation, location/targetId refs)
- [x] Reactive chain: GOODS_STOLEN → WITNESS → RUMOR → WANTED → investigate
- [x] WANTED_STATUS feedback: sentiment cascade, criminal awareness, lay_low/seek_forgiveness
- [x] Механизмы стабильности (mood decay, cooldowns, belief decay, goal feedback)
- [x] Text matching → structured beliefs (spreadRumorsOnDayAdvance, buildRoleDirective, scheduler)
- [x] **LLM-driven volition** — DO/WHY формат, instinct descriptions, deterministic parser
- [x] **Decision cooldown** — 3 тика между LLM решениями одного NPC
- [x] **beliefModifiers** — ситуативная urgency: beliefs NPC влияют на affordance scores (4-й вход computeUtility)
- [x] **targetRole** — универсальный proximity-aware finder: `targetRole: 'guard'` вместо отдельных функций
- [x] **examine_scene** — evidence synthesis: opportunity + motive → suspicion beliefs (source: 'deduction')
- [x] **Body discovery at 0.6** — до goals/movement, NPC обнаруживают тела на своих позициях
- [x] **Suspect interrogation** (v0.5.1) — допрос подозреваемого (H trait → confession/denial → confidence change)
- [x] **Full judicial chain test** (v0.5.2) — murder → report → investigate → interrogate → arrest → trial → sentence
- [x] **Punishment system v2** (v0.9.5) — graduated verdicts (release/warning/fine/imprisonment/exile), crime severity mapping, evidence quality grouping, judge PM, suspect defense, imprisonment timer. Belief zeroing verdict-conditional (module-owned).

#### LLM Decision — structured output (v0.9.5)

Один LLM call на решение. JSON schema с dynamic action enum. Beliefs + relationships в **user prompt** (не system — avoids "lost middle"). Volition "talk" использует WHY reason как purpose (не "general conversation").

```
You are [name], a [role]. [PM context: mood, fears, desires, stress/growth]
[Situation: beliefs, relationships, recent events]

Your instincts:
- [Strong/Moderate/Faint] pull to [описание] — [почему, из PM scores]

What do you do? Answer in EXACTLY this format:
DO: <action>
WHY: <one sentence as your character>

Actions (use EXACT names):
- go <LOCATION>
- talk <NPC> <topic>
- steal <NPC>
- attack <NPC>
- wait
- announce <message>

LOCATIONS: [список доступных]
NPCs: [список известных]
```

**Парсинг** — детерминированный, без text matching:
- `DO: go X` → проверить X в списке локаций → `move_to(X)`
- `DO: talk X Y` → проверить X в списке NPC → `move_to(location of X) + interact(X, purpose=Y)`
- `DO: steal X` → `steal_from(X)`
- `DO: attack X` → `attack_npc(X)`
- `DO: wait` → `wait`
- `DO: announce X` → `announce(X)`
- WHY → сохраняется как purpose в goal и как vector memory (narrative trace)
- Невалидный ответ → NPC "задумался" (wait 1 tick), не fallback на числа

#### Context Scaling — Hot/Warm/Cold

Промпт содержит только релевантный контекст, не весь мир. Масштабируется на любой размер:

| Уровень | Что входит | Пример |
|---|---|---|
| **Hot** | Текущая локация + NPC здесь | "You are at Market Square. Nearby: Mark, Hilda" |
| **Warm** | Соседние локации (1-2 хопа) + NPC из beliefs/relationships | "Connected: Town Square, Blacksmith. Garrett is at Town Gate" |
| **Cold** | Всё остальное | Не в промпте. NPC не думает об этом |
| **Always** | Дом | "Your home: Residential Lane" |

На 200 локаций и 100 NPC промпт всё равно содержит ~5-10 мест и ~5-15 имён. AL фильтрация определяет что релевантно. Реалистично: NPC знает своё окружение, не карту мира.

---

## 3. Системы (текущие, работающие)

### 3.1 Event Store

Иммутабельный поток событий. Текущее состояние = проекция всей истории (аналог git).

```typescript
interface WorldEvent {
  id: string;              // UUID
  type: EventType;         // NPC_KILLED, WITNESS_MEMORY, RUMOR_SPREAD, WANTED_STATUS, ...
  subject: string;         // кто совершил действие
  object?: string;         // на кого направлено
  location: string;
  gameDay: number;
  importance: number;      // 1-10
  payload: Record<string, unknown>;
}
```

**Типы событий:**

| EventType | Описание |
|---|---|
| `NPC_KILLED` | Убийство NPC |
| `GOODS_STOLEN` | Кража товаров |
| `SELF_JUSTICE` | Самосуд над подозреваемым |
| `THEFT_DISCOVERED` | Владелец обнаружил кражу |
| `WITNESS_MEMORY` | Свидетель получил воспоминание |
| `RUMOR_SPREAD` | Слух распространился |
| `WANTED_STATUS` | Стражник начал розыск |
| `BODY_DISCOVERED` | Обнаружение тела |
| `NPC_CONVERSATION` | NPC разговаривает с NPC |
| `NPC_INTERROGATED` | Допрос свидетеля/подозреваемого |
| `NPC_ARRESTED` | Арест подозреваемого |
| `NPC_SENTENCED` | Вынесение приговора (exile/release) |
| `NPC_FLED` | NPC сбежал из города |
| `EVIDENCE_DESTROYED` | Уничтожение улик на месте преступления |
| `WITNESS_INTIMIDATED` | Запугивание свидетеля |
| `TESTIMONY_GIVEN` | Свидетель дал показания добровольно |
| `JUSTICE_DEMANDED` | NPC публично потребовал правосудия |

**Шкала важности:**

| Важность | Примеры |
|---|---|
| 9-10 | Убийство ключевого NPC, уничтожение города |
| 7-8 | Кража артефакта, предательство, WANTED_STATUS |
| 5-6 | Крупная сделка, RUMOR_SPREAD |
| 3-4 | Обычная торговля, небольшая драка |
| 1-2 | Разговор, проход мимо, заказ в таверне |

**Реализация:** `@clwa/engine` — `InMemoryEventStore`, `IEventStore` интерфейс (готов для SpacetimeDB). `buildWorldState()` проекция: deadNpcs, wantedSubjects, locationFacts, npcMoodShifts, currentDay. `getStateAtDay(day)` — replay.

### 3.2 Agent (Память, Beliefs, Relationships, Промпты)

#### Векторная память

| Компонент | Инструмент | Заметки |
|---|---|---|
| Векторы | Qdrant (Docker) | Одна коллекция на агента, 768d Cosine |
| Embeddings | LM Studio `/v1/embeddings` (raw fetch) | nomic-embed-text-v1.5 Q8_0 |
| Payload | text, importance, gameDay, timestamp | В Qdrant |

**Формула затухания:** `decayed_importance = importance × e^(-days / (importance × 5))`

**Composite score при recall:**
```
score = (relevance × 0.4) + (decayed_importance/10 × 0.4) + (freshness × 0.2)
```

Процесс: embed запрос → Qdrant search topK×3 → re-rank по composite → вернуть topK (default 5) в system prompt.

**Drift detection:** meta-точка в каждой Qdrant коллекции хранит embeddingModel + vectorSize. При init() — совпадает → данные сохраняются, нет → пересоздание.

#### Рефлексия

`ReflectionTracker`: кумулятивная сумма importance, порог 30. При достижении → LLM генерирует инсайт → сохраняется как `[Reflection] <text>` с importance 9. Интегрирована в `observe()`, `chat()`, `chatStream()`.

#### Beliefs (BeliefManager)

Структурированные убеждения NPC о событиях:
- `Belief`: eventType, subject (кто, null если неизвестно), object (жертва), confidence (0-1), source (witness/body_discovery/rumor/testimony/interrogation/observation/cover_up/deduction/evidence/perpetrator)
- Дедупликация: повторный belief усиливает confidence
- Decay: confidence -0.02/день
- Confidence по источнику: witness=0.95, body_discovery=0.7, testimony=0.6, rumor=0.4

#### Relationships (RelationshipGraph)

Отношения NPC к другим NPC:
- `Relationship`: targetId, targetName, type (friend/rival/family/colleague/acquaintance/romantic/mentor), sentiment (-1..1), trust (0..1)
- 21 начальное отношение
- `getGriefPenalty()` — mood штраф при гибели близкого (friend: -0.3, family: -0.4, romantic: -0.5)
- `getTestimonyWeight()` — trust влияет на confidence beliefs из показаний
- Sentiment: +0.05 за casual conversation, -0.3...-0.8 к убийце друга

#### Система промптов

System prompt агента собирается динамически:
1. **Профиль**: background, personality (Big Five → текст), speechStyle (примеры, не описания)
2. **Состояние**: location, mood (поведенческое описание), currentActivity из schedule
3. **Secret + innerConflict**: тайна и внутренний конфликт из AgentProfile
4. **buildRoleDirective()**: на основе beliefs + relationships (guard с murder beliefs → "ACTIVE DUTY", witness → "You witnessed a murder", и т.д.)
5. **Secret Directives**: скрытые поведенческие директивы (покрывательство, отрицание, и т.д.)
6. **Топ-5 воспоминаний**: с давностью и decayed importance
7. **Relationships**: summarizeForPrompt() — meaningful отношения

**Mood** влияет на тон через system prompt: >0.5 cheerful, >0.0 content, >-0.5 uneasy, ≤-0.5 distressed.

**Per-NPC LLM настройки** (`LlmPersonality`): temperature и maxTokens per-NPC. Garrett: 0.5/150, Elara: 0.9/350, Hilda: 0.55/120.

**LLM Semaphore**: глобальный maxConcurrent=1 (GPU context switching), все LLM-вызовы через acquire()/release() в finally.

### 3.3 World (Тик, Цели, Расписание, Движение)

#### Tick Flow

```
goals (advance active goals) → schedule goals → random movement →
body discovery check → AL proactive volition (LLM DO/WHY) → casual conversations
```

**Proactive volition**: для каждого NPC без активной цели → AL фильтрует affordances → PM scores → instinct descriptions → LLM решает (DO/WHY) → parser → goal steps. Decision cooldown 3 тика.

**Tick mutex**: World.tick() защищён от параллельного вызова.

#### Goal System (GoalManager)

Связующий механизм между тремя слоями архитектуры:

```
WANTED_STATUS (событие) → investigationTrigger (правило) →
Guard получает цель: move → interact → announce → return (агент) →
Каждый шаг порождает новые события (назад в Event Store)
```

**5 engine step types** (универсальные примитивы):
- `move_to` — перемещение по графу (1 шаг/тик, BFS pathfinding)
- `interact` — LLM-диалог с конкретным NPC (structured output)
- `interact_present` — LLM-диалог со ВСЕМИ NPC на локации (1/тик)
- `announce` — объявление всем на локации (без LLM, через observe)
- `wait` — ожидание N тиков

**Module step types** (через `registerStepHandler` + generic `ModuleStep`):
- `steal_from`, `attack_npc`, `arrest_npc`, `destroy_evidence`, `flee`, `examine_scene`, `sentence_npc`
- `StepTemplate.action: string` — engine не знает конкретных типов. buildSteps() generic handler resolves $target, interpolates strings.
- Новый модуль добавляет step type = `registerStepHandler('trade', ...)` + affordance template. Ноль engine changes.

**Priority preemption**: высокоприоритетная цель переводит текущую active → pending.

**Триггеры целей (реализованы через AL):**
- **Proactive**: AL фильтрует affordances → PM scores → LLM DO/WHY → goal steps (steal, kill, vigilante, blackmail, confront)
- **Reactive** (на CE event): investigate (guard, WANTED_STATUS), report_crime (WITNESS_MEMORY), gossip (RUMOR_SPREAD), grieve (relation to victim), lay_low / seek_forgiveness (criminal on WANTED_STATUS)
- Legacy triggers удалены (goal-triggers.ts, crime-triggers.ts) — полностью заменены AL reactive system

#### Schedule (ScheduleManager)

- **TICKS_PER_DAY = 96** — 1 тик = 15 game minutes, 5 периодов: dawn (ticks 20-28), morning (28-48), afternoon (48-68), evening (68-84), night (84-96+0-20)
- **Auto-tick**: tick-when-ready pattern (setTimeout loop), default interval 8s → 1 day ≈ 13 min real time
- 34 записи расписания для 7 NPC
- Schedule goals имеют priority 3 — уступают событийным
- Автоматический advanceDay при обороте 96 тиков
- **Configurable cooldowns** via WorldConfig: affordance (12 ticks/3h), decision (4 ticks/1h), conversation pair (16 ticks/4h)
- **Ночные прогулки**: mood < -0.3 → NPC бродит ночью (priority 2)

#### Движение

- `LocationGraph` — граф с adjacency, BFS pathfinding
- Мобильные NPC (Elara, Mark) — 30% шанс/тик случайное перемещение
- `nextHop()` — пошаговое движение к цели

#### Body Discovery

- После каждого перемещения — проверка: мёртвый NPC + живой NPC на одной локации
- BODY_DISCOVERED → discoverer получает memory + belief **напрямую** (не через cascade)
- Информационная асимметрия: обнаруживший **не знает** убийцу ("unknown killer")
- Прямые свидетели — знают
- Дедупликация через `bodyDiscoveries` Set

#### Conversations

##### Topic Engine (`engine/topic-engine.ts`)

Plugin-архитектура выбора тем. Перед каждым NPC-NPC разговором TopicEngine выбирает **о чём** говорить на основе реального состояния мира (ноль LLM вызовов). Engine содержит только механику выбора — все topic sources живут в модулях.

**Архитектура:**
```typescript
type TopicSource = (initiator, responder, context) => TopicProposal[];

interface TopicProposal {
  subject: string;        // "the death of Ted", "a missing shipment"
  tone: string;           // "hushed urgency", "casual warmth"
  weight: number;         // приоритет (выше = вероятнее)
  initiatorHook: string;  // направление для промпта инициатора
  responderHook?: string; // направление для респондера
  category: string;       // для трекинга повторов
  topicKey?: string;      // dedup между sources (одно событие из разных sources → один proposal)
  beliefTransfer?: { ... } // передача beliefs после разговора
}

interface TopicContext {
  recentTopics: string[];  // anti-repeat per pair
  gameDay: number;
  period: string;          // dawn/morning/afternoon/evening/night
  location: string;        // where conversation happens
  playerAgent?: Agent;
}
```

**13 topic sources в двух модулях:**

| Module | Source | Данные | Weight | Пример |
|---|---|---|---|---|
| **social** | **beliefTopics** | beliefs обоих NPC (bidirectional) | 6-12 | *"murder of Bess → break the news"* |
| **social** | **relationshipTopics** | sentiment, grief | 4-6 | *"tension → barely civil"* |
| **social** | **innerConflictTopics** | innerConflict + trust | 4 | *"guilt leaks through in hints"* |
| **social** | **moodTopics** | mood обоих NPC (bidirectional) | 2-4 | *"you both feel the weight"* |
| **social** | **roleTopics** | role → declarative pool | 2 | *"bartender: missing regular"* |
| **social** | **worldFactTopics** | knownFacts | 2 | *"common knowledge"* |
| **social** | **casualTopics** | relationships + location | 1-3 | *"comment on the ale" (location-aware)* |
| **social** | **seasonalTopics** | period + gameDay | 1-2 | *"night makes people honest"* |
| **social** | **memoryTopics** | old beliefs (2+ days) | 2 | *"remember what happened to Bess..."* |
| **social** | **opinionTopics** | shared relationships (death-aware) | 2-4 | *"what do you think about Mark?"* |
| **social** | **questionTopics** | low-conf beliefs, info gaps | 2 | *"heard rumors about... true?"* |
| **crime** | **justiceTopics** | arrest/sentence/fled beliefs (bidirectional) | 5-11 | *"Mark was arrested!"* |
| **crime** | **playerRumorTopics** | player claims + sentiment (bidirectional) | 3-6 | *"what did the stranger tell you?"* |

**Расширяемость**: `TOPIC_SOURCE_REGISTRY.push(myTopics)` — новый модуль = новые темы, ноль изменений engine. Аналогично AFFORDANCE_REGISTRY.

**Key design decisions (v0.9.6):**
- **Bidirectional** — и initiator, и responder's beliefs/mood генерируют proposals. Три ветки hooks: initiator knows / responder knows / both know.
- **Recency weighting** — beliefs от сегодня +4, от вчера +2, старые +0
- **Location context** — belief связан с текущей локацией → +2 weight. Location-specific casual hooks.
- **Cross-source dedup** — `topicKey` на TopicProposal. Одно событие из beliefTopics + memoryTopics → один proposal (highest weight wins).
- **Death-aware opinions** — opinionTopics не предлагает "как дела у X" если X мёртв.
- **Category→Group mapping** — все categories маппятся в groups для PM influence и diversity: `memory→event, opinion→relationship, question→knowledge, conflict→conflict, inner→inner`.

**Anti-repeat**: трекинг последних 6 тем на пару, пенализация повторных категорий.

**Selection pipeline (v0.9.6):**
1. Collect all proposals from TOPIC_SOURCE_REGISTRY
2. **Dedup by topicKey** — keep highest weight per key
3. Penalize recently discussed categories (per pair)
4. **PM influence** — OCEAN traits обоих участников: E→casual, N→mood/inner, O→knowledge, A→relationship, low A→conflict
5. **Diversity tracking** — target ratios: 35% casual, 25% event, 15% relationship, 10% mood, 10% knowledge, 5% conflict
6. **Weighted random selection** (proportional, not winner-take-all)
7. Track history (per pair + day distribution)

##### Conversation Flow

- `ConversationScheduler`: social scoring (relationship, extraversion, social hunger, crime beliefs). **Cooldown 16 тиков**
- `TopicEngine.selectTopic()`: weighted random с PM influence и diversity tracking
- `runConversation()`: structured dialogue JSON schema, **maxTokens: 80**
- Belief transfer (bidirectional initiator↔responder + overhear conf × 0.3)
- `analyzeConversationImpact()`: sentiment + mood + **importance** (content-aware)
- `observe()` **после** impact analysis (LLM-assessed importance)
- `processOverhear()` **после** impact (finalized importance + belief transfer)

##### Structured Dialogue (v0.9.5)

JSON schema: `{ "speech": "...", "gesture": "..." }`. Casual: max 12w speech. Goal interactions: max 20w speech.
Anti-repetition: `repeat_penalty: 1.1`, `frequency_penalty: 0.3`, `presence_penalty: 0.2`.
Robust fallback parser для malformed JSON. Player chat — свободный формат.

##### Conversation Prompts — принципы

**Structural constraint**: "IMPORTANT: speech must be at most 12 words. Only spoken words — no narration."
**Anti-hallucination**: "CRITICAL: Do NOT invent names, locations, or details" — первое правило system prompt
**Topic-directed**: конкретная тема + hook
**Grounded memory**: mood-based format, key quote truncated to 80 chars

### 3.4 Intent Detection

Классификатор намерений игрока. LLM анализирует сообщение **до** ответа NPC.

```
Player message → classifyIntent() → { intent, targetNpc?, detail? }
    ↓                                       ↓
applyIntentEffects()                 intent WS → Godot
(mood/sentiment/memory)                      ↓
    ↓                               action button в диалоге
agent.chatStream()                  (Browse Wares, Press Further)
```

| Intent | Эффект | Пример |
|---|---|---|
| `smalltalk` | Нет | "Hello", "How are you?" |
| `ask_about_npc` | Нет (LLM из памяти) | "What do you know about Hilda?" |
| `accuse` | EventStore, memory imp 6 | "I think Ted is a liar" |
| `threaten` | mood -0.15, memory imp 5 | "Tell me or else" |
| `insult` | mood -0.08, memory imp 3 | "You're a fraud" |
| `compliment` | mood +0.08, memory imp 2 | "You do great work" |
| `bribe` | EventStore, memory imp 5 | "I'll pay you for information" |
| `confide` | memory imp 4 | "I saw something strange" |
| `trade` | action button (если NPC имеет shop) | "I need a weapon" |

Классификация через LLM (temperature: 0.2, не keyword matching).

### 3.5 Shop System

NPC с `profile.shop: ShopItem[]` — торговля через intent detection → action button.

| NPC | Товары | Специализация |
|---|---|---|
| Mark | Valdris Fire Spice, Regional Map, Silk Rope, Minor Healing Tonic, Brass Lantern | Общие товары |
| Hilda | Iron Shortsword, Hand Axe, Wooden Shield, Steel Dagger, Horseshoes | Оружие |
| Bess | Calming Herbs, Healing Poultice, Fortune Tea Leaves, Antidote Vial | Зелья |

Пока display only (нет инвентаря игрока / экономики).

### 3.6 Crime Scene System

Место преступления с точками осмотра. Игрок приходит → осматривает → улики в журнал.

### 3.7 Journal System

Журнал игрока: улики, показания, наблюдения. Бэкенд + Godot UI.

### 3.8 Secret Directives

Универсальная система скрытых поведенческих директив (`world/src/secret-directives.ts`). Инжектится в LLM промпт без доп. вызовов.

```
buildSecretDirectives(agent, agents, eventStore) → prompt text
    ↓
Проверяет: свои преступления, покрывательство, свидетельства, угрозы, взятки, чужие секреты
    ↓
Генерирует директивы на основе relationships
```

| NPC знает | Relationship | Поведение |
|---|---|---|
| Совершил преступление | — | Отрицает, при давлении — трещит |
| Видел преступление | Друг убийцы | Покрывает (cover-up belief) |
| Видел преступление | Враг убийцы | Охотно выдаёт |
| Видел преступление | Нейтральный | Докладывает (90% chance) |
| Ему угрожали | — | Боится, может подчиниться |
| Его подкупили | — | Конфликт, уклоняется |
| Знает чужой секрет | Друг | Хранит |
| Знает чужой секрет | Враг | Может использовать |

**Cover-up механика**: свидетель + друг/семья убийцы + sentiment > 0.2 → НЕ report_crime, вместо этого memory + cover-up belief.

### 3.9 Murder Motivation (replaced by AL)

Legacy: ранее отдельная проверка evening/night тиков. Теперь реализовано через AL affordance `kill` с requirements (period, motive, mood, sentiment) и LLM-driven volition. NPC сам решает через DO/WHY формат.

---

## 4. NPC Reference

### Профили

| NPC | O | C | E | A | N | H | Enneagram | Стресс → | Рост → |
|---|---|---|---|---|---|---|---|---|---|
| Garrett | 0.3 | 0.9 | 0.5 | 0.4 | 0.2 | 0.7 | 6w5 Loyalist | → 3: контролирующий | → 9: справедливый |
| Ted | 0.5 | 0.6 | 0.8 | 0.7 | 0.3 | 0.6 | 9w8 Peacemaker | → 6: тревожный | → 3: инициативный |
| Elara | 0.9 | 0.3 | 0.9 | 0.6 | 0.5 | 0.5 | 3w4 Achiever | → 9: пассивная | → 6: преданная |
| Aldric | 0.7 | 0.8 | 0.5 | 0.9 | 0.4 | 0.9 | 1w9 Perfectionist | → 4: мрачный* | → 7: радостный |
| Hilda | 0.3 | 0.8 | 0.4 | 0.3 | 0.2 | 0.7 | 8w9 Challenger | → 5: замкнутая | → 2: заботливая |
| Mark | 0.5 | 0.3 | 0.7 | 0.3 | 0.6 | 0.2 | 3w2 Achiever | → 9: безразличный | → 6: верный |
| Bess | 0.8 | 0.4 | 0.3 | 0.7 | 0.6 | 0.8 | 5w4 Investigator | → 7: рассеянная | → 8: решительная |
| Theron | 0.4 | 0.95 | 0.3 | 0.5 | 0.3 | 0.9 | 1w9 Perfectionist | → 4: мрачный | → 7: великодушный |

*Aldric "потерял веру" = Type 1 под стрессом → 4 (мрачность, потеря идентичности). Его innerConflict — буквально эта механика.

### Секреты и мотивы

| NPC | Секрет | innerConflict | Motive |
|---|---|---|---|
| Ted | Разбавляет эль из-за долгов | Хочет быть честным, но не может | — |
| Hilda | Отец погиб в таверне Теда | Друг, но помнит кровь на полу | vs Ted (sentiment -0.1) |
| Elara | Шпионит для знатного дома | Привязалась к людям, предательство | — |
| Garrett | Пропустил беглеца за взятку | Гордится честью, но один раз предал | — |
| Aldric | Потерял веру | Люди нуждаются, он притворяется | — |
| Mark | Продаёт обычное как экзотику | Old Bess знает, намекает, однажды расскажет | vs Bess (sentiment -0.8) |
| Bess | Видит будущее, видела убийство | Могла предупредить, но не стала | — |
| Theron | Однажды осудил невиновного | Правосудие несовершенно, но необходимо | — |

### Локации (8)

Silver Flagon Tavern, Town Square (хаб), Town Gate, Market Square, Blacksmith, Temple of Dawn, Residential Lane, Courthouse.

**Дома:** Ted @ Tavern, Garrett @ Gate, Aldric @ Temple, Hilda @ Blacksmith, Theron @ Courthouse, Mark/Elara/Bess @ Residential Lane.

---

## 5. Веха 5: Преступление и наказание

**Цель:** Полноценная система преступлений — разнообразные типы, место преступления как интерактивная точка, расследование игроком, реакции мира. Демка технологии CLWA "по мотивам Disco Elysium".

**Игровой цикл расследования:**

```
Мир живёт → Преступление (эмерджентно) → Crime Scene на локации
    ↓
Игрок приходит → Осматривает (точки осмотра) → Улики в журнал
    ↓
Расспрашивает NPC → Показания в журнал → Сопоставляет
    ↓
Обвиняет кого-то → Может угадать, может нет → Мир реагирует
```

### Слои реализации

| # | Слой | Размер | Статус | Описание |
|---|---|---|---|---|
| 1 | Intent detection, shop | Medium | ✅ | Классификатор намерений + торговля |
| 2 | Crime Scene System | Medium | ✅ | Место преступления с точками осмотра |
| 3 | Журнал игрока | Medium | ✅ | Бэк + Godot UI. Улики, показания, наблюдения |
| 4 | Осмотр места (Godot) | Medium | ✅ | Визуальный маркер, UI осмотра, examine → journal |
| 5 | Secret Directives + Cover-up | Medium | ✅ | Универсальные скрытые директивы, покрывательство |
| 6 | **Personality Model (PM)** | Medium | ✅ | OCEAN+H + Enneagram → utility scores + instinct descriptions |
| 7 | **Affordance Layer (AL)** | Large | ✅ | 19 affordances, declarative step templates, target finder registry |
| 8 | **Crime & Punishment** | Large | ✅ | Расследование, арест, суд, приговор (exile/release), побег, NPC status machine |
| 9 | **Topic Engine + Dialogue** | Medium | ✅ | 7 plugin topic sources (вкл. justice), grounded memory, structured importance |
| 10 | **Архитектурный аудит** | Medium | ✅ | Устранение text matching, semaphore safety, target finder registry |
| 11 | Legacy cleanup + Package restructure | Medium | ✅ | engine/modules/server трёхуровневая архитектура |
| 12 | LLM-driven decisions + instinct builder | Medium | ✅ | Scoring v2 + instinct builder v2, no reflex (volition.ts) |
| 13 | Reactive eval fix + name consistency | Medium | ✅ | v0.5.2 — E2E цикл протестирован |
| 14 | Evidence Layer | Large | ✅ | v0.5.3 — пятая подсистема, 4 source strategies |
| 15 | Bugfixes + capability flags | Medium | ✅ | role→capabilities, self-targeting, arrest cycle, perpetrator source |
| 16 | Engine decoupling v1 | Large | ✅ | Event registry system, step handlers → module, all types → string |
| 17 | Engine decoupling v2 | Large | ✅ | Belief creators, memory text, mood shifts, goal mood, topic pools, action verbs, volition generic |
| 18 | Engine decoupling v3 | Medium | ✅ | spreadRumors, crime-scene, interaction hooks, tick handlers, secret directive builders |
| 19 | E2E stability + dialogue quality | Medium | ✅ | minimumScore, belief source dedup, notPerpetrator, beliefs in prompts, speechStyle |
| 20 | Tick system v2 | Small | ✅ | TICKS_PER_DAY=96, auto-tick, configurable cooldowns |
| 21 | Trauma layer | Medium | ⏳ | Постоянные сдвиги OCEAN+H от травм |
| 22 | Consequence Graph v2 | Large | ⏳ | Полные цепочки для всех типов преступлений |

### Каталог преступлений и возможностей NPC

Принцип: не "какие преступления бывают", а **что NPC способен сделать исходя из роли и состояния**. Система не оценивает мораль — фиксирует событие и распространяет последствия.

**По роли:**

| Роль | Возможности | EventType |
|---|---|---|
| **Торговец** | Обвес, скупка краденого, шантаж должника, контрабанда | `FRAUD`, `FENCE_STOLEN`, `BLACKMAIL`, `CONTRABAND_SOLD` |
| **Стражник** | Взятка, превышение полномочий, слив информации, подброс улик | `BRIBE_ACCEPTED`, `ABUSE_OF_POWER`, `INFO_LEAKED`, `EVIDENCE_PLANTED` |
| **Бармен** | Подмешать в питьё, укрывательство, продажа информации | `DRINK_POISONED`, `HARBORING_FUGITIVE`, `INFO_SOLD` |
| **Священник** | Мошенничество с пожертвованиями, укрывательство, шантаж через исповедь | `DONATION_FRAUD`, `HARBORING_FUGITIVE`, `CONFESSION_BLACKMAIL` |
| **Кузнец** | Продажа оружия запрещённым, поддельные ключи/взломные инструменты | `ILLEGAL_ARMS_SALE`, `LOCKPICK_CRAFTED` |

**По состоянию (любой NPC):**

| Условие | Действие | EventType |
|---|---|---|
| grief + relationship к жертве | Убийство из мести | `NPC_KILLED` (motive: revenge) |
| mood < -0.8 + нужда | Кража от отчаяния | `GOODS_STOLEN` |
| страх или подкуп | Ложные показания | `WITNESS_LIED` |
| гнев + подозрение | Самосуд над подозреваемым | `SELF_JUSTICE` |

**Цепочки CG v2:**

```
WITNESS_LIED → раскрыто → REPUTATION_DAMAGE + расследование лжеца
BRIBE_ACCEPTED → видел другой NPC → CORRUPTION_RUMOR → недоверие к страже
SELF_JUSTICE → у жертвы есть друзья → REVENGE_GOAL
HARBORING_FUGITIVE → стража обыскивает → DISCOVERED → арест обоих
CONFESSION_BLACKMAIL → жертва отчаялась → DESPERATE_ACTION
GOODS_STOLEN → владелец обнаружил → ACCUSATION_SPREAD → подозрения
```

**Моральная неоднозначность:**
- Священник скрывает беглеца → преступление или милосердие?
- Стражник бьёт подозреваемого → превышение или справедливость?
- Кузнец куёт клинок для мстителя → пособничество или невинная сделка?

Система **не оценивает** — фиксирует EventType, каскадирует через CE, NPC и игрок реагируют через свои beliefs и relationships.

### Типы преступлений (система универсальная)

| Тип | Кто может | Триггер | Улики на месте |
|---|---|---|---|
| Murder | NPC (motive), Player | Мотив + условия + LLM | Тело, кровь, следы борьбы, профессиональная улика |
| Theft/Robbery | NPC, Player | Нужда + возможность (жертва одна, ночь) | Взломанный замок, пропавшие вещи |
| Assault | NPC, Player | Конфликт (sentiment < порог) | Следы драки, крики (свидетели слышали) |
| Blackmail | NPC, Player | Знает секрет + низкий trust | Нет физических улик, только показания |
| Bribe | Player (уже есть) | Intent detection | Нет физических улик, NPC помнит |
| Trespassing | Player | Заходит в чужой дом ночью | Свидетели видели |

---

## 6. Дорожная карта

| Веха | Описание | Статус |
|---|---|---|
| **Веха 2** | Деревня, движение, Goal System | ✅ |
| **Веха 3** | Beliefs, Relationships, buildRoleDirective, LLM Semaphore | ✅ |
| **Веха 4** | Godot 2D клиент (изометрическая деревня, WASD, диалоги, день/ночь) | ✅ |
| **Веха 4.5** | Персистентность (save.json при SIGINT + POST /api/save) | ✅ |
| **Веха 5** | **Преступление и наказание** — crime scene, journal, PM, AL (19 affordances), investigation, arrest, trial, sentence, NPC status, target finder registry, architectural audit | 🔨 СЕЙЧАС |
| **Веха 6+** | Trauma layer, CG v2, сторителлинг/квесты, фракции, Reputation, Hot/Warm/Cold | ⏳ |

### Hot/Warm/Cold агенты (будущая оптимизация)

Работает для 7 NPC. При 50+ — потребуется:

| Уровень | Что делает | LLM |
|---|---|---|
| **Горячий** | Полная обработка: LLM, память, цели | Да |
| **Тёплый** | Обновление состояния без диалога | Нет |
| **Холодный** | Только числа: mood += delta, fatigue += 0.1 | Нет |

Переходы: событие → warm, игрок рядом → hot, игрок ушёл → warm, N тиков без событий → cold.

---

## 7. Архитектурные решения

### LLM Reasoning Mode

| Вызов | Reasoning | Почему |
|---|---|---|
| **Диалог NPC** | OFF | Время-критично |
| **Intent Detection** | OFF + few-shot | Достаточно few-shot, reasoning только задержка |
| **Рефлексия** | ON (эксперимент) | Задача сложная, не время-критичная |

Qwen3.5-9B с reasoning ON зацикливается — застревает в `<think>` блоке. Известная проблема Qwen3.5 и DeepSeek R1.

### Качество диалогов

**Голос через примеры, не описания:**
```
❌ speechStyle: "Speaks gruffly, few words"
✅ speechStyle: `Ted rarely finishes sentences when nervous.
   Example: "Aye, the usual? ...Listen. You didn't— no, nevermind."`
```

**Память от первого лица:**
```
❌ "2 days ago: witnessed murder of Mark the merchant (importance: 8.2)"
✅ "I saw it happen. Right there by the bar." (2 days ago, still vivid)
```

**Состояние через поведение:**
```
❌ "Emotional state: traumatized"
✅ "You keep glancing at the spot where it happened.
    If someone asks directly — you deflect first, then crack."
```

**Тайна и внутренний конфликт** — `secret` и `innerConflict` в AgentProfile. LLM держит тайну если явно указать как вести себя при приближении к ней.

### Взаимодействие игрока

**Два пайплайна:**
- **Структурный** — купить, скрафтить, взять задание. Транзакции с данными. Intent detection через LLM.
- **Свободный** — оскорбить, флиртовать. Нарратив через `chat()`. Последствия фиксируются после ответа.

**Приоритеты в промпте NPC:**
1. Belief что игрок — убийца → отказ говорить / зов стражи
2. mood < -0.5 → не в настроении торговать
3. Игрок груб → эмоциональная реакция, отказ в услуге
4. Спрашивает о товарах → ответ как торговец

### Эмерджентные квесты

Квесты — не "возьми → убей → сдай". Это **emergent discovery**: мир реагирует через CG + Beliefs. Пример: условия появления редкого существа через правила CE → необратимое событие → каскад на NPC через CG → beliefs обновляются → NPC меняют поведение.

---

## 8. Приложение

### Стек технологий

| Компонент | Инструмент | Версия / Заметки |
|---|---|---|
| Runtime | Bun | 1.3.9, монорепо с workspaces |
| LLM инференс | LM Studio | localhost:1234, OpenAI-compatible `/v1/chat/completions` с `response_format: json_schema` |
| Чат-модель | Qwen3.5-9B-abliterated (lukey03) | Q4_K_M (5.2 ГБ), GGUF patched (thinking off), RTX 3080 10GB |
| Embedding-модель | nomic-embed-text-v1.5 | Q8_0 (140 МБ), 768d через raw fetch |
| Векторная память | Qdrant | Docker, localhost:6333, Cosine distance |
| Игровой движок | Godot 4.6.1 | Steam, `godot/` |

### Структура проекта

```
CLWA/
├── package.json                    # Bun workspaces: ["packages/*"]
├── tsconfig.json                   # ESNext, bundler moduleResolution
├── docker-compose.yml              # Qdrant
├── ARCHITECTURE.md                 # Этот документ
├── godot/                          # Godot 2D клиент
└── packages/
    ├── engine/                     # @clwa/engine — подсистемы движка (код)
    │   └── src/
    │       ├── index.ts            # Barrel re-exports
    │       ├── agent-types.ts      # BigFive, AgentProfile, AgentState, Memory, NpcStatus
    │       ├── agent.ts            # Agent: chat(), chatStream(), observe(), LLM Semaphore
    │       ├── beliefs.ts          # BeliefManager: confidence/source/decay/dedup
    │       ├── relationships.ts    # RelationshipGraph: sentiment/trust/grief
    │       ├── memory.ts           # VectorMemory: Qdrant + raw fetch embeddings
    │       ├── reflection.ts       # ReflectionTracker: threshold, LLM insight
    │       ├── decay.ts            # decayedImportance(), compositeScore()
    │       ├── cg-types.ts         # WorldEvent, ConsequenceRule, EventType
    │       ├── cg-engine.ts        # ConsequenceEngine: process(), spreadRumors(), createBelief()
    │       ├── event-types.ts      # IEventStore, EventQuery, WorldState
    │       ├── event-store.ts      # InMemoryEventStore
    │       ├── event-projection.ts # buildWorldState()
    │       ├── al.ts               # Пустые реестры (AFFORDANCE_REGISTRY, TARGET_FINDERS, REQUIREMENT_CHECKERS), computeUtility(), checkRequirements()
    │       ├── volition.ts         # LLM-driven decisions, instinct builder, structured output (JSON schema)
    │       ├── instinct-builder.ts # Procedural instinct descriptions (7 tiers × 3 textures × Enneagram)
    │       ├── llm-client.ts       # Centralized LLM client (OpenAI /v1/chat/completions, structured output)
    │       ├── goals.ts            # GoalManager, NpcGoal, 12 step types
    │       ├── world.ts            # World.tick(), processKill(), isActive/isPresent
    │       ├── world-types.ts      # LocationDef, WorldConfig, TickResult, CrimeScene
    │       ├── interaction.ts      # InteractionRunner — LLM-driven goal conversations
    │       ├── schedule.ts         # ScheduleManager, TICKS_PER_DAY=96, auto-tick
    │       ├── secret-directives.ts # buildSecretDirectives()
    │       ├── intent.ts           # classifyIntent()
    │       ├── conversation.ts     # runConversation(), structured importance
    │       ├── topic-engine.ts     # TopicEngine — selection engine only, 0 sources (modules fill registry)
    │       ├── scheduler.ts        # ConversationScheduler — pair selection
    │       ├── crime-scene.ts      # createCrimeScene(), templates
    │       ├── journal.ts          # PlayerJournal
    │       ├── pathfinding.ts      # findPath(), nextHop() — BFS
    │       └── movement.ts         # processMovement() — status-aware NPC movement
    ├── modules/                    # @clwa/modules — мировой контент (данные)
    │   └── src/
    │       ├── index.ts            # Re-exports
    │       ├── social/             # Universal social behavior
    │       │   ├── index.ts        # registerSocialModule() — 11 topic sources
    │       │   └── topic-sources.ts # belief, relationship, mood, casual, seasonal, memory, opinion, question topics
    │       └── crime-justice/
    │           ├── index.ts        # registerCrimeJusticeModule() — заполняет реестры engine
    │           ├── affordances.ts  # CRIME_AFFORDANCES (19 определений)
    │           ├── target-finders.ts # 14 finder-функций + REQUIREMENT_CHECKERS
    │           ├── topic-sources.ts # justiceTopics + playerRumorTopics (bidirectional, recency, topicKey)
    │           └── cg-rules.ts     # CRIME_CG_RULES (14 правил)
    ├── server/                     # @clwa/server — платформа
    │   ├── public/                 # Web UI (vanilla JS)
    │   └── src/
    │       ├── index.ts            # Bootstrap: loads world JSON, creates agents, starts server
    │       ├── world-loader.ts     # Reads worlds/*/JSON → engine-compatible structures
    │       ├── server.ts           # Bun.serve: HTTP + WebSocket + static + player chat
    │       ├── routes.ts           # REST API handlers
    │       └── ws.ts               # WebSocket: broadcast, sendTo
    └── worlds/                     # World data (JSON, editable by scenario designer)
        └── millhaven/
            ├── world.json          # 8 locations + lore + config + conversationHooks
            ├── npcs/*.json         # 8 NPC files (profile, schedule, memories, mood, shop)
            ├── relationships.json  # 29 initial relationships
            ├── topics.json         # 8 role topic pools
            └── secrets.json        # 5 starting beliefs (secrets + debt pressure)
```

> **Принцип разделения**: Engine содержит пустые реестры. Modules заполняет их при регистрации (`registerSocialModule()`, `registerCrimeJusticeModule()`). World data — JSON файлы, не код. Server загружает через `world-loader.ts`. Зависимость: modules → engine, server → engine + modules + world data. Engine НЕ зависит от modules.

### Открытые вопросы

**Технические:**
1. **Комбинаторный взрыв** — текущее решение: maxChainDepth: 3. Нужно тестировать при большем количестве правил
2. **Консистентность памяти** — два NPC помнят одно событие по-разному. Как разрешать при NPC-to-NPC общении?
3. **LLM галлюцинации** — ✅ Решено: убран хардкод фактов (festival/caravan) из buildDynamicFacts, TopicEngine даёт grounded темы из реального state
4. **Масштаб** — 10,000+ NPC потребует иерархической агрегации

**Дизайновые:**
1. **Игрок vs симуляция** — баланс между реактивностью мира и agency игрока
2. **Временны́е масштабы** — симуляция истории до прихода игрока (DF подход) без LLM

### Технологии на рассмотрении

| Компонент | Инструмент | Заметки |
|---|---|---|
| Event Store / сервер | SpacetimeDB | Вся логика в WebAssembly |
| Граф последствий (продакшн) | Neo4j | Cypher-запросы для сложных цепочек |
| Голоса NPC | F5-TTS (SWivid/F5-TTS) | Zero-shot voice cloning, ~2-3GB VRAM |

### Глоссарий

| Термин | Определение |
|---|---|
| **Event Store** | Иммутабельный журнал событий. Текущее состояние = проекция истории |
| **Consequence Graph (CG)** | Граф причинно-следственных правил. Событие → каскад последствий |
| **Personality Model (PM)** | OCEAN+H + Enneagram. Определяет характер, мотивации, страхи NPC |
| **Affordance Layer (AL)** | Реестр возможностей + utility scoring. NPC решает что делать |
| **Hot/Warm/Cold agents** | Три уровня активности NPC: LLM / обновление состояния / только числа |
| **Importance decay** | Затухание значимости: `imp × e^(-days / (imp × 5))` |
| **Composite score** | Итоговый балл recall: relevance × 0.4 + decay × 0.4 + freshness × 0.2 |
| **Reflection** | Обобщение воспоминаний в инсайт (порог 30, importance 9) |
| **World Tick** | Единица времени. Каждый тик: цели → движение → разговоры |
| **NpcGoal** | Цель NPC: последовательность шагов (move, interact, announce, wait) |
| **InteractionRunner** | LLM-runner для целенаправленных диалогов |
| **LocationGraph** | Граф локаций с adjacency, BFS pathfinding |
| **Priority Preemption** | Высокоприоритетная цель переводит текущую active → pending |
| **[CRIME] маркер** | Структурный тег в purpose, стрипается перед LLM |
| **Drift Detection** | Meta-точка в Qdrant — пересоздание при несовпадении модели/размерности |
| **Secret Directives** | Скрытые поведенческие директивы в промпте (покрывательство, отрицание) |
| **Intent Detection** | LLM-классификация намерения игрока перед ответом NPC |
| **Emergent Quest** | Квест без выдачи — мир реагирует через CG + Beliefs |

### Академические источники

1. **"Generative Agents: Interactive Simulacra of Human Behavior"** — Park et al., Stanford, 2023. [arxiv.org/abs/2304.03442](https://arxiv.org/abs/2304.03442)
2. **"Language Models as Agent Models"** — Andreas, 2022. [arxiv.org/abs/2212.01681](https://arxiv.org/abs/2212.01681)
3. **"Voyager: An Open-Ended Embodied Agent with LLM"** — Wang et al., 2023. [arxiv.org/abs/2305.16291](https://arxiv.org/abs/2305.16291)
4. **"MemGPT: Towards LLMs as Operating Systems"** — Packer et al., 2023. [arxiv.org/abs/2310.08560](https://arxiv.org/abs/2310.08560)
5. **"ReAct: Synergizing Reasoning and Acting in Language Models"** — Yao et al., 2022. [arxiv.org/abs/2210.03629](https://arxiv.org/abs/2210.03629)

### Запуск

```bash
# 1. Поднять Qdrant
docker compose up -d

# 2. Запустить LM Studio, загрузить модели (Qwen3.5-9B Q6_K + nomic-embed-text-v1.5 Q8_0), запустить сервер

# 3. Установить зависимости
bun install

# 4. Запустить сервер
bun run packages/server/src/index.ts
# → http://localhost:3000 (REST + WebSocket + Web UI)
```

---

*Документ создан в разговоре с Claude (Siesta), март 2026*
*Прототип: Claude Code + Bun + LM Studio + Qdrant*
