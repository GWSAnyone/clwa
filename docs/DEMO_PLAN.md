# CLWA Demo — план реализации

> Цель: собрать playable демку, демонстрирующую эмерджентный нарратив.
> Сценарий: живая деревня → преступление → расследование → суд.
> Игрок: наблюдатель + исследователь (может помочь расследованию или просто смотреть).

---

## 1. Что уже работает

| Система | Описание | Файл |
|---|---|---|
| NPC daily life | 8 NPC, расписание, движение, разговоры через TopicEngine | engine: world.ts, scheduler.ts |
| AL → LLM volition | NPC сам решает убить через personality weights | engine: volition.ts, modules: affordances.ts |
| Crime scene | Автоматическое создание, 4+ examination points, улики | engine: crime-scene.ts |
| Body discovery | NPC обнаруживает тело → belief → mood shift | engine: world.ts (step 0.6) |
| beliefModifiers | Ситуативная urgency: "видел труп" → compulsion сообщить страже | modules: affordances.ts |
| targetRole | Универсальный proximity-aware finder (guard, priest, etc.) | modules: affordances.ts |
| examine_scene | Guard осматривает crime scene → deduction beliefs (opportunity + motive) | goals.ts |
| Report/Testify | NPC идёт к стражнику, directed interact + beliefTransfer | modules: affordances.ts |
| Interrogate | Guard допрашивает свидетелей, beliefTransfer (target→owner) | modules: affordances.ts, engine: goals.ts |
| Arrest | Guard арестовывает подозреваемого (conf ≥ 0.7 + subject) | modules: affordances.ts, engine: goals.ts |
| Trial | Judge собирает evidence, LLM решает EXILE/RELEASE | engine: goals.ts (sentence_npc) |
| Player crime scene | Игрок осматривает улики → journal entries | server: routes.ts, engine: journal.ts |
| Godot client | Изометрическая деревня, WASD, диалоги, день/ночь | godot/ |
| Persistence | save.json при SIGINT + POST /api/save | engine: world.ts |

## 2. Что нужно реализовать

### 2.1. Suspect Interrogation Outcome

**Проблема**: guard получает deduction belief (conf 0.5) через examine_scene. Для arrest нужно conf ≥ 0.7. beliefTransfer при допросе подозреваемого ничего не даёт (у убийцы нет crime beliefs о себе). Цепочка обрывается.

**Решение**: после interact step в interrogate goal, если guard допрашивает NPC на которого у него есть deduction belief → проверить виновность + personality → обновить confidence.

**Где**: `packages/engine/src/goals.ts`, в обработке `interact` step (case 'interact'), после beliefTransfer.

**Логика**:

```typescript
// После beliefTransfer в interact step:
// Проверить: есть ли у owner (guard) deduction belief о target?
if (step.beliefTransfer && owner.state.beliefs) {
  const deductionBelief = owner.state.beliefs.getAllBeliefs().find(
    b => b.source === 'deduction' && b.subject === target.profile.name
  );

  if (deductionBelief) {
    // Проверить виновность через crime scenes
    const isGuilty = checkGuilt(target.profile.id, crimeScenes);
    const honesty = target.profile.bigFive.honesty;

    if (isGuilty) {
      if (honesty >= 0.6) {
        // Честный человек плохо врёт → quasi-confession
        deductionBelief.confidence = Math.min(1, 0.85);
        deductionBelief.lastUpdated = currentDay;
        console.log(`[Interrogate] ${target.profile.name} (H=${honesty}) shows guilt`);
      } else {
        // Лживый — отрицает, но нервничает
        deductionBelief.confidence = Math.min(1, deductionBelief.confidence + 0.15);
        deductionBelief.lastUpdated = currentDay;
        console.log(`[Interrogate] ${target.profile.name} (H=${honesty}) denies but nervous`);
      }
    } else {
      // Невиновен → алиби → снижение confidence
      deductionBelief.confidence = Math.max(0.1, deductionBelief.confidence - 0.2);
      deductionBelief.lastUpdated = currentDay;
      console.log(`[Interrogate] ${target.profile.name} provides alibi`);
    }
  }
}
```

**Вспомогательная функция**:

```typescript
function checkGuilt(suspectId: string, crimeScenes?: Map<string, CrimeScene[]>): boolean {
  if (!crimeScenes) return false;
  for (const scenes of crimeScenes.values()) {
    for (const scene of scenes) {
      if (scene.active && scene.perpetratorId === suspectId) return true;
    }
  }
  return false;
}
```

**Соответствие принципам**:
- PM = инстинкт: H trait определяет способность лгать (не LLM решает)
- Structured data: проверка через perpetratorId (не text matching по LLM output)
- Declarative: параметры (0.85, 0.15, 0.2) можно вынести в конфиг
- Universal: работает для любого преступления где есть perpetratorId

**Confidence arc**:

```
examine_scene:  Mark (opportunity + motive) → conf 0.5
interrogate Mark (H=0.2, guilty): denial → conf 0.65
interrogate witness: beliefTransfer adds corroboration → conf ~0.7+
→ arrest unlocked

ИЛИ (честный убийца):
interrogate Mark (H=0.7, guilty): quasi-confession → conf 0.85
→ arrest unlocked сразу
```

### 2.2. End-to-End Test

**Сценарий**: Mark убивает Bess, никто не видит. Полная цепочка до суда.

**Шаги теста**:

```bash
# 1. Чистый старт
# Удалить save.json, запустить сервер

# 2. Убийство (через debug endpoint для предсказуемости)
POST /api/npc-kill/mark/bess

# 3. Прогнать тики до body discovery
# Телепортировать Hilda на Market Square: GET /api/debug/move/hilda/Market%20Square
# Тикнуть: POST /api/tick

# 4. Проверить что body discovery сработало
GET /api/beliefs/hilda
# Ожидаем: NPC_KILLED, subject=null, conf=0.7, source=body_discovery

# 5. Проверить AL scores
GET /api/debug/volition/hilda
# Ожидаем: report_crime score ~0.85 (personality 0.35 + beliefModifier 0.5*0.7)

# 6. Тикать пока Hilda не дойдёт до Garrett
# Проверять goals: GET /api/goals (hilda → report_crime)
# Проверять beliefs Garrett: GET /api/beliefs/garrett

# 7. После report → Garrett получает belief → investigate
GET /api/debug/volition/garrett
# Ожидаем: investigate score высокий

# 8. Garrett идёт на crime scene → examine_scene
# Ожидаем: deduction belief {subject: "Mark", conf: 0.5}

# 9. Garrett interrogates Mark → suspect interrogation outcome
# Ожидаем: confidence увеличивается (0.5 → 0.65 если H=0.2)

# 10. Garrett interrogates witness → corroboration
# Ожидаем: confidence ≥ 0.7

# 11. Garrett arrests Mark → detained
# Ожидаем: Mark.status = 'detained'

# 12. Judge (Theron) → evaluate_case → sentence
# Ожидаем: NPC_SENTENCED event, verdict = exile или release
```

**Возможные точки отказа**:
- Hilda уходит по schedule до body discovery → ИСПРАВЛЕНО (step 0.6)
- Garrett уходит до report_crime interact → interact chase/wait нужен тест
- investigate targetFinder не находит crime scene → проверить crimeLocation в extra
- examine_scene: personsPresent пустой → проверить markCrimeScene вызов
- Confidence не достигает 0.7 → нужен suspect interrogation outcome

### 2.3. Godot Client Readiness

**Что уже есть в Godot** (v0.6):
- ✅ Тайловая карта деревни (Kenney isometric → Tiled → YATI) с 8 зонами-полигонами
- ✅ NPC Kenney sprites (Male_0–7), SPRITE_SCALE=1.4, движение между локациями
- ✅ Диалоговая панель (player ↔ NPC разговоры)
- ✅ Crime scene markers на карте (пульсирующий красный)
- ✅ Examination panel с structured evidence (opportunity/motive/trace категории)
- ✅ Journal panel (улики и записи)
- ✅ Day/night overlay + vignette
- ✅ Debug LLM overlay (что NPC думает)
- ✅ Notification system: popup для murder, arrest, sentence, fled, theft, body discovered
- ✅ NPC status indicators: detained (chains + label), exiled/fled (ghost), dead (X marker)
- ✅ HUD event log: все типы событий с цветным BBCode
- ✅ Sprint (Shift), SPEED=600/SPRINT_SPEED=1100

**Что осталось**:
- [ ] Стены/крыши зданий (сейчас только пол)
- [ ] Анимации ходьбы (Run спрайты есть)
- [ ] Investigation timeline UI (прогресс расследования для игрока)

### 2.4. Player Participation

**Минимум для демки (наблюдатель + исследователь)**:
- [x] Ходить по деревне, видеть NPC
- [x] Разговаривать с NPC (диалоги)
- [x] Осматривать crime scene (examine points → journal)
- [ ] Видеть ключевые events (notifications)

**Расширенное (активный участник, можно отложить)**:
- [ ] Сообщить стражнику информацию (player → guard belief transfer)
- [ ] Указать на подозреваемого (player adds belief to guard)
- [ ] Допросить NPC как детектив (player interrogation)

Для первой демки **наблюдатель + исследователь** достаточно. Игрок ходит по миру, видит как NPC живут, происходит убийство, деревня реагирует, можно осмотреть улики, наблюдать за расследованием и судом. Это уже впечатляюще как proof of concept.

## 3. Evidence Layer (EL) — пятая подсистема

### Проблема

Текущие "улики" — текстовые описания в ExaminationPoint. Не structured data, не переиспользуемы, недоступны NPC. `examine_scene` хардкодит логику дедукции вместо работы с данными.

### Архитектура

```
Event → CG (последствия: mood, beliefs, cascade)
      → EL (улики: structured facts на локациях)
              ↓
         Discovery (NPC examine_scene ИЛИ player examine)
              ↓
         Belief (source: 'evidence', confidence по weight)
```

Пять подсистем CLWA:
| Подсистема | Роль |
|---|---|
| **AL** | Что можно (декларативный реестр affordances) |
| **PM** | Кто ты (personality → instinct prose) |
| **CG** | Последствия (event → cascade → state) |
| **EL** | Улики (event → evidence на локациях → discoverable) |
| **LLM** | Сознание (свободное решение в рамках возможного) |

### Модель данных

```typescript
// Единица улики — structured fact привязанный к локации
interface Evidence {
  id: string;
  category: 'opportunity' | 'motive' | 'physical' | 'alibi' | 'witness';
  /** На кого указывает (null = неизвестно) */
  subjectId: string | null;
  subjectName: string | null;
  /** Жертва/объект преступления */
  objectId: string | null;
  /** Локация где улика находится */
  location: string;
  /** Связанный тип события */
  eventType: string;
  /** Вес: насколько двигает confidence при обнаружении (0.1-0.3) */
  weight: number;
  /** Кто уже обнаружил */
  discoveredBy: Set<string>;
  /** Описание для UI/журнала (генерируется при создании) */
  description: string;
  /** Активна (не уничтожена destroy_evidence) */
  active: boolean;
}
```

### Evidence Rules (декларативные, параллель CE rules)

```typescript
interface EvidenceRule {
  /** Какой event триггерит генерацию */
  trigger: EventType;
  /** Какие улики создать */
  generate: EvidenceTemplate[];
}

interface EvidenceTemplate {
  category: Evidence['category'];
  /** Источник данных для генерации */
  source: 'personsPresent' | 'negativeRelationship' | 'perpetratorProfession' | 'stolenGoods';
  /** Порог для relationship-based evidence */
  threshold?: number;
  /** Вес улики */
  weight: number;
  /** Шаблон описания */
  descriptionTemplate: string;
}

// Пример правил:
const EVIDENCE_RULES: EvidenceRule[] = [
  {
    trigger: 'NPC_KILLED',
    generate: [
      {
        category: 'opportunity',
        source: 'personsPresent',
        weight: 0.15,
        descriptionTemplate: '{subjectName} was seen at {location} around the time of the murder',
      },
      {
        category: 'motive',
        source: 'negativeRelationship',
        threshold: -0.3,
        weight: 0.2,
        descriptionTemplate: '{subjectName} had a known grudge against {objectName}',
      },
      {
        category: 'physical',
        source: 'perpetratorProfession',
        weight: 0.15,
        descriptionTemplate: 'Traces of {professionClue} found near the body',
      },
    ],
  },
  {
    trigger: 'GOODS_STOLEN',
    generate: [
      {
        category: 'opportunity',
        source: 'personsPresent',
        weight: 0.15,
        descriptionTemplate: '{subjectName} was near the shop when the theft occurred',
      },
    ],
  },
];
```

### Генерация (при событии)

```
NPC_KILLED: Mark kills Bess at Market Square (Elara present)
→ EL processes EVIDENCE_RULES for 'NPC_KILLED'
→ personsPresent: [mark, elara]
  → Evidence: opportunity, subj=mark, weight=0.15, "Mark was seen at Market Square..."
  → Evidence: opportunity, subj=elara, weight=0.15, "Elara was seen at Market Square..."
→ negativeRelationship (threshold -0.3):
  → Mark sentiment toward Bess = -0.8 → yes
  → Evidence: motive, subj=mark, weight=0.2, "Mark had a known grudge against Old Bess"
  → Elara sentiment toward Bess = 0.1 → no evidence
→ perpetratorProfession: mark = merchant
  → Evidence: physical, subj=mark, weight=0.15, "Traces of merchant goods found near body"

Total at Market Square: 4 evidence objects
Mark implicated by: opportunity(0.15) + motive(0.2) + physical(0.15) = 0.5
Elara implicated by: opportunity(0.15) = 0.15 (below threshold, weak)
```

### Discovery (NPC или player)

**NPC** (examine_scene step, заменяет текущий хардкод):
```typescript
// В goals.ts, case 'examine_scene':
const evidence = evidenceLayer.getUndiscovered(owner.state.location, ownerId);
for (const e of evidence) {
  evidenceLayer.markDiscovered(e.id, ownerId);
  if (e.subjectId && owner.state.beliefs) {
    // Создать/усилить belief
    const existing = owner.state.beliefs.findExisting(e.eventType, e.subjectName);
    if (existing) {
      existing.confidence = Math.min(1, existing.confidence + e.weight);
    } else {
      owner.state.beliefs.addBelief({
        eventType: e.eventType,
        subject: e.subjectName,
        object: e.objectId ? agents.get(e.objectId)?.profile.name : null,
        confidence: e.weight,
        source: 'evidence',
        ...
      });
    }
  }
}
```

**Player** (examine endpoint, расширяет текущий):
```
POST /api/examine/:locationId/:evidenceId
→ Mark evidence as discovered by player
→ Journal entry with evidence description
→ Player UI shows accumulated evidence per suspect
```

### Связь с destroy_evidence affordance

Сейчас `destroy_evidence` affordance существует но непонятно что уничтожает. С EL:
```
Criminal executes destroy_evidence at crime scene
→ EL marks physical evidence as active=false
→ Guard arriving later discovers fewer clues
→ Lower total confidence → harder to arrest
```

### Что заменяет EL

| Было | Стало |
|---|---|
| ExaminationPoint с текстом | Evidence с structured data |
| examine_scene хардкод в goals.ts | EL.discover() + declarative rules |
| Только player examine | NPC + player через единый EL API |
| personsPresent логика в step handler | Evidence rules генерируют при событии |
| Profession clues в templates (text) | EvidenceTemplate с category='physical' |

### Файлы для реализации

- `packages/world/src/evidence.ts` — **НОВЫЙ**: Evidence interface, EvidenceRule[], EvidenceLayer class
- `packages/engine/src/goals.ts` — examine_scene step: заменить хардкод на EL.discover()
- `packages/engine/src/world.ts` — при событиях: вызывать EL.generate()
- `packages/agent/src/beliefs.ts` — добавить BeliefSource: 'evidence'
- `packages/server/src/routes.ts` — обновить examine endpoint

### Соответствие принципам

| Принцип | Как EL соблюдает |
|---|---|
| Декларативно | Evidence rules = данные, не код. Новый crime type = новая rule |
| Нет text matching | Evidence = structured (category, subjectId, weight). Description только для UI |
| Universal | Работает для murder, theft, espionage, любого "кто это сделал?" |
| PM = инстинкт | EL не принимает решений, только предоставляет facts |
| Эмерджентно | Какие улики найдут, в каком порядке, какие выводы сделают — не предопределено |

## 4. Порядок работы

### ~~Сессия N+1: Suspect Interrogation + E2E Test~~ ✅ (v0.5.1, v0.5.2)

### ~~Сессия N+2: Evidence Layer~~ ✅ (v0.5.3)

### ~~Сессия N+3: Godot + Polish~~ ✅ (v0.6)

1. ✅ Проверить Godot клиент с новыми фичами
2. ✅ Добавить notifications для ключевых событий (notification_manager.gd)
3. ✅ Добавить NPC status indicators (detained/exiled/fled visual в npc_marker.gd)
4. ✅ Evidence UI: показать собранные улики (examine_panel.gd — structured evidence с категориями)
5. ✅ Тайловая карта: Kenney isometric dungeon → Tiled → YATI → Godot TileMapLayer
6. ✅ 8 зон с полигонами (Tiled Object Layer → CollisionPolygon2D), центроиды = LOCATION_POSITIONS
7. ✅ Персонажи: Kenney Male sprites, SPRITE_SCALE=1.4, z_index=10
8. ✅ Скорость: SPEED=600, SPRINT_SPEED=1100 (Shift)
9. ✅ HUD: расширен для NPC_ARRESTED, NPC_SENTENCED, NPC_FLED, WITNESS_MEMORY, RUMOR_SPREAD, THEFT_DISCOVERED
10. ✅ Server: status field в /api/agents

**Осталось**:
- [ ] Стены/крыши на тайлмапе (сейчас только пол)
- [ ] Town Square зона в Tiled (единственная локация без полигона)

### ~~Сессия N+4: NPC анимации + карта + визуал~~ ✅

1. ✅ NPC анимация ходьбы (Run0-Run9 спрайты, 12 FPS, flip_h по направлению)
2. ✅ Плавное перемещение NPC между локациями (Tween, NPC_WALK_SPEED=350)
3. ✅ Случайное размещение NPC внутри зон (полигоны из Tiled, triangulation + barycentric sampling)
4. ✅ NPC подходят друг к другу при разговоре (conversation:line → tween к собеседнику)
5. ✅ NPC расходятся после разговора (conversation:complete → scatter)
6. ✅ Карта на M: fog of war, explored/unexplored зоны, NPC last-known positions
7. ✅ Спрайт-оффсеты подогнаны (offset -195, лейблы -62, highlight -2)

### ~~Сессия N+5: 3D персонажи (KayKit)~~ ✅

1. ✅ SubViewport архитектура: каждый персонаж рендерится в изолированном 3D мире (World3D.new())
2. ✅ KayKit модели: 6 моделей (Knight, Barbarian, Mage, Rogue, Rogue_Hooded, Ranger)
3. ✅ Анимации: загрузка из отдельных .glb (MovementBasic + General), 24 анимации на персонажа
4. ✅ Idle/Walk/Run с зацикливанием (LOOP_LINEAR), кросс-фейд 0.3с между анимациями
5. ✅ Изометрическая камера (30° elevation) совпадает с тайлмапом
6. ✅ Shadow catcher plane (шейдер — невидимая плоскость, показывает только тень)
7. ✅ Плавный поворот модели в направлении движения (lerp_angle)
8. ✅ Изометрическая коррекция движения (Y * 0.5) и направления модели
9. ✅ Скорость анимации синхронизирована с движением (Walk 1.4x, Run 1.2x)
10. ✅ Исправлены все GDScript warnings (shadowing, unused vars, integer division, icon.svg)

**Маппинг NPC → модели**:
| NPC | Модель |
|---|---|
| Garrett (guard) | Knight |
| Hilda (blacksmith) | Barbarian |
| Ted (bartender) | Rogue |
| Elara (bard) | Rogue_Hooded |
| Mark (merchant) | Mage |
| Aldric (priest) | Mage |
| Bess (herbalist) | Ranger |
| Theron (judge) | Knight |
| Player | Knight |

**Ключевые параметры**: Viewport 500x666, CAM_ORTHO_SIZE 3.5, sprite_scale 0.72, SPEED 300/SPRINT 550
4. Убрать старый Sprite2D код

### ~~Сессия N+6: E2E Stability + Dialogue Quality~~ ✅ (v0.8.1)

1. ✅ addBelief source-level dedup (evidence coexists with observation/testimony)
2. ✅ minimumScore on AffordanceDefinition (arrest, investigate, evaluate_case → reflex)
3. ✅ Dedicated findInvestigateTarget (crime scene, not witness)
4. ✅ [CRIME] tag parser multi-word fix
5. ✅ Belief zeroing after NPC_SENTENCED for ALL NPCs + goal cleanup (testify/report)
6. ✅ notPerpetrator requirement (blocks perpetrators from testify/report/confront/demand_justice)
7. ✅ Beliefs in interaction prompts (summarizeForPrompt)
8. ✅ Garrett/Ted speechStyle rewritten with diverse examples

### ~~Сессия N+7: Tick System v2~~ ✅ (v0.8.2-dev)

1. ✅ TICKS_PER_DAY: 24 → 96 (1 tick = 15 game minutes)
2. ✅ Auto-tick: tick-when-ready pattern (setTimeout loop)
3. ✅ Configurable cooldowns via WorldConfig (affordance=12, decision=4, conversation=16)
4. ✅ Default interval 8s → 1 day ≈ 13 min real time

### Сессия N+8: Demo Ready
1. Настроить начальные условия + вторичные tension seeds
2. Протестировать auto-tick с Godot клиентом
3. Добавить локационные действия (order drink, browse wares, pray)
4. Написать demo script
5. Финальный тест (2-3 часа gameplay)

## 4. Демо-сценарий (как это выглядит)

```
[Запуск]
Деревня живёт: Ted в таверне, Garrett патрулирует, Hilda куёт,
Father Aldric молится, Mark торгует... Bess собирает травы.

[Утро Day 1-2]
NPC ходят по расписанию, общаются, торгуют.
Игрок гуляет по деревне, разговаривает с NPC, изучает мир.

[Кризис]
Mark (H=0.2, grievance against Bess, mood=-0.7) решает убить.
AL: kill score 0.8 → compulsion. LLM: "DO: kill Bess. WHY: she knows too much"
Mark идёт к Bess → attack_npc(lethal) → Bess мертва.
Crime scene появляется на Market Square.

[Реакция]
Hilda (или другой NPC) приходит на Market Square → обнаруживает тело.
Шок, mood падает. Belief: "кто-то убил Bess".
beliefModifiers: report_crime score = 0.85 → compulsion.
Hilda бежит к Garrett.

[Расследование]
Garrett получает report → belief: NPC_KILLED.
investigate goal → идёт на crime scene → examine_scene.
Deduction: "Mark был на месте + ненавидел Bess" → suspect (conf 0.5).
Garrett допрашивает Mark → Mark нервничает (H=0.2) → conf 0.65.
Garrett допрашивает свидетелей → corroboration → conf 0.7+.

[Арест]
Garrett: arrest goal → идёт к Mark → arrest_npc → Mark detained.
Mark в заключении.

[Суд]
Magistrate Theron: evaluate_case → идёт в Courthouse.
Собирает evidence (beliefs всех NPC). LLM решает: EXILE.
Mark изгнан из деревни.

[Последствия]
NPC обсуждают случившееся, mood постепенно восстанавливается.
Деревня продолжает жить — но без Mark и Bess.
```

## 6. Принципы — чеклист соответствия

| Принцип | Как соблюдён |
|---|---|
| Эмерджентный нарратив | Сюжет не скриптован. Murder, investigation, verdict — всё возникает из данных |
| PM = инстинкт | OCEAN+H → utility scores → instinct descriptions. H trait → confession/denial |
| LLM = сознание | LLM свободно выбирает DO/WHY. Judge LLM решает verdict |
| Декларативно | Affordances, beliefModifiers, targetRole, Evidence Rules — всё данные, не код |
| Нет text matching | Всё через structured: beliefs, events, relationships, evidence |
| Universal | Все системы работают для любого типа события/преступления/квеста |
| Физика поведения | AL (возможно) → EL (факты) → CG (последствия). Между ними — свободный выбор |
| 5 подсистем | AL + PM + CG + EL + LLM — полный цикл от state до narrative |
