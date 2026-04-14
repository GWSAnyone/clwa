# SPEC: Witness Behavior — Personality-Driven Reactions to Crime

> **Milestone**: M3 (Living Opposition)
> **Status**: Implemented (v0.13.0)
> **Depends on**: CG v2 (done), motive pool (done), belief system (done)
> **Engine changes**: cover-up suppression в beliefTransfer (world.ts). Остальное — module data.
> **Created**: 2026-04-12
> **Completed**: 2026-04-12

---

## Проблема

CG v1 трактовал всех свидетелей одинаково: увидел преступление → WITNESS_MEMORY → слух → стража. Один pipeline на всех. Это создавало три проблемы:

### 1. Все свидетели реагируют одинаково

Друг убийцы и незнакомец получают идентичный belief с одинаковой confidence. В реальном мире друг покроет, честный незнакомец побежит к страже. Без дифференциации — плоская детективная механика: любой свидетель = одинаковая улика.

### 2. Нет механизма сокрытия

Свидетель-друг получает belief и на следующем разговоре передаёт его через beliefTransfer. Даже если NPC "покрывает" через directive — belief всё равно распространяется. Cover-up на уровне промпта, но не на уровне системы.

### 3. Запугивание не подавляет свидетельство

Affordance `intimidate` создаёт WITNESS_INTIMIDATED event, но это никак не влияет на готовность свидетеля делиться информацией. Directive говорит "молчи", а belief всё равно передаётся при beliefTransfer.

**GDD target**: "Witnesses react based on personality and relationships. Friends cover up. Honest witnesses report eagerly. Intimidated witnesses stay silent."

---

## Дизайн

### Exclusive Group `witness_reaction`

Используется CG v2 exclusive group (SPEC-cg-v2) для разрешения конфликтов между реакциями. Trigger: `WITNESS_MEMORY`. Per-target resolution — каждый свидетель получает свою реакцию на основе personality и relationships.

| Правило | Priority | Условие | Последствие | Probability |
|---------|----------|---------|-------------|-------------|
| `witness-cover-up` | 2 (высший) | `relationship.sentiment > 0.3` (друг подозреваемого) | `COVER_UP` (importance 5) | 0.6 |
| `witness-eager-report` | 1 | `trait.honesty > 0.6` | `REPORT_IMPULSE` (importance 6) | 0.9 |

**Ключевое решение**: дружба побеждает честность (priority 2 > 1). Если свидетель одновременно друг преступника И честный — дружба выигрывает. Это дизайнерский выбор: лояльность сильнее принципов. Создаёт интересную детективную динамику — игрок не может полагаться на "честных" NPC если они дружат с подозреваемым.

**Per-target resolution (CG v2)**: exclusive group резолвит PER TARGET, не per rule. Ted (друг) получает cover-up, Hilda (честная, не дружит) получает eager-report — из одного события. Реализовано в `cg-engine.ts`:

```typescript
// Exclusive groups: per-target priority resolution.
for (const [, group] of exclusiveGroups) {
  group.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  const claimed = new Set<string>();
  for (const rule of group) {
    const targets = this.evaluateConditions(rule, event, ctx);
    const unclaimed = targets.filter(t => !claimed.has(t));
    if (unclaimed.length > 0) {
      toFire.push({ rule, targets: unclaimed });
      for (const t of unclaimed) claimed.add(t);
    }
  }
}
```

### Escalation Precursors

Два дополнительных CG-правила для minor incidents (часть criminal escalation pipeline):

| Правило | Trigger | Последствие | maxChainDepth |
|---------|---------|-------------|---------------|
| `witness-argument` | `ARGUMENT_WITNESSED` | `MINOR_INCIDENT_MEMORY` (importance 3, p=0.7) | 1 |
| `witness-threat` | `THREAT_WITNESSED` | `WITNESS_MEMORY` (importance 5, p=0.9) | 3 |

**Разделение по серьёзности**: аргументы → `MINOR_INCIDENT_MEMORY` (не каскадирует к guard investigation, maxChainDepth=1). Угрозы → полноценный `WITNESS_MEMORY` (каскадирует как обычное преступление). Аргументы — подсказки для наблюдательного игрока, но не повод для стражи.

---

## Cover-Up Suppression

### Belief source `cover_up`

Регистрация в module:

```typescript
registerSourceFlags('cover_up', { concealment: true });
```

`isConcealment('cover_up')` возвращает `true`. Belief creator для `COVER_UP` создаёт belief с `source: 'cover_up'`, confidence: 0.3.

### Блокировка beliefTransfer

В `world.ts`, секция beliefTransfer (NPC-NPC разговоры), добавлена проверка: если у NPC есть belief с `isConcealment(source)` для данного eventType — передача блокируется:

```typescript
// Check if initiator is suppressed (concealment = covering up, perpetrator = committed the crime)
const initSuppressed = initiator.state.beliefs?.getAllBeliefs().some(
  b => (isConcealment(b.source) || isPerpetrator(b.source)) && b.eventType === bt.eventType
) ?? false;
```

Аналогичная проверка для responder. Результат: NPC с cover-up belief **знает** о преступлении (belief существует), но **не делится** этим знанием в разговорах.

### Perpetrator Leakage Fix

Та же проверка включает `isPerpetrator(b.source)`. Без неё преступник мог бы случайно передать свой perpetrator belief через beliefTransfer при разговоре — "утечка" информации о собственном преступлении. `isPerpetrator` source зарегистрирован с transfer weight 0, но beliefTransfer — отдельный механизм. Двойная защита: transfer weight 0 (source registry) + explicit suppression check (beliefTransfer code).

---

## Intimidated Witness Directive

Secret directive builder подавляет свидетельство через LLM-уровень (instinct, не reflex — NPC решает сам, но давление сильное):

```typescript
registerSecretDirectiveBuilder(({ agent, eventStore }) => {
  const agentId = agent.profile.id;
  const intimidationEvents = eventStore.getAll()
    .filter((e: WorldEvent) => e.type === 'WITNESS_INTIMIDATED' && e.object === agentId);
  if (intimidationEvents.length === 0) return [];

  const intimidator = intimidationEvents[...].payload?.suspectName ?? 'someone';
  return [
    `## HIDDEN: You have been intimidated\n` +
    `${intimidator} threatened you to keep quiet about what you know. You are afraid.\n` +
    `- If asked about the crime: be evasive, claim you didn't see much, look away nervously.\n` +
    `- If pressed hard: you might crack — the truth wants to come out, but fear holds you back.\n` +
    `- If the person asking seems trustworthy and powerful enough to protect you: you might open up, haltingly.\n` +
    `- You flinch at the mention of ${intimidator}'s name.`,
  ];
});
```

**Gradual breakdown**: директива не запрещает говорить — она создаёт шкалу сопротивления. Мягкий вопрос → уклончивый ответ. Сильное давление → может сломаться. Trustworthy + powerful собеседник → может открыться. Это сохраняет принцип "LLM = consciousness" (philosophy #3: PM = Instinct, LLM = Consciousness): directive = instinct, LLM решает.

---

## Зарегистрированные события

### Event Types

| Event Type | Категория | Label | Mood Shift |
|-----------|-----------|-------|------------|
| `COVER_UP` | `witness_reaction` | cover-up | -0.10 (guilt/anxiety) |
| `REPORT_IMPULSE` | `witness_reaction` | report impulse | -0.05 (righteous urgency) |
| `MINOR_INCIDENT_MEMORY` | `minor_incident` | incident | -0.02 (mild unease) |

### Belief Creators

| Event Type | Source | Confidence | Семантика |
|-----------|--------|------------|----------|
| `COVER_UP` | `cover_up` (concealment) | 0.3 | Знает, но скрывает. Низкая confidence = не уверен в своём решении |
| `REPORT_IMPULSE` | `witness` (firsthand) | 0.95 | Честный свидетель — высокая уверенность, готов делиться |

### Memory Text

| Event Type | Пример |
|-----------|--------|
| `COVER_UP` | "I saw what happened to {victim}... but {killer} is someone I care about. I'll keep what I know to myself." |
| `REPORT_IMPULSE` | "I witnessed the crime against {victim} at {location}. {killer} must be held accountable. I need to find the guard immediately." |
| `MINOR_INCIDENT_MEMORY` | "I saw {killer} and {victim} having a heated exchange. Tempers were running high — something to keep an eye on." |

### Source Registration

```typescript
registerSourceFlags('cover_up', { concealment: true });
registerSourceDecayRates({ cover_up: 0.01 });         // slow decay — loyalty persists
registerSourceTransferWeights({ cover_up: 0.0 });      // never shared through normal transfer
registerBeliefSourceLabels({ cover_up: 'covering up' });
registerSourceCategory('concealment', ['cover_up']);
```

---

## Файлы

| Файл | Изменения |
|------|-----------|
| `packages/modules/src/crime-justice/cg-rules.ts` | 5 новых CG правил: witness-cover-up, witness-eager-report (exclusive group `witness_reaction`), witness-argument, witness-threat, witness-intimidation. Escalation precursors: MINOR_INCIDENT_MEMORY, THREAT_WITNESSED chain rules. |
| `packages/modules/src/crime-justice/index.ts` | Event categories (`witness_reaction`, `minor_incident`). Source flags для `cover_up` (concealment: true). Belief creators для COVER_UP (source cover_up, conf 0.3) и REPORT_IMPULSE (source witness, conf 0.95). Memory text builders. Mood shifts. Intimidated witness secret directive builder. |
| `packages/engine/src/cg-engine.ts` | Per-target exclusive group resolution (claimed set prevents double-assignment). |
| `packages/engine/src/world.ts` | Cover-up suppression: `isConcealment()` и `isPerpetrator()` checks в beliefTransfer блокируют передачу crime beliefs от покрывающих/преступников. |

---

## Invariant Audit

- [x] **A1**: No module strings in engine — `isConcealment()` и `isPerpetrator()` = boolean flag checks из registries. Engine не знает строку `'cover_up'`.
- [x] **A2**: All state typed — cover-up belief uses existing Belief interface (source: string, confidence: number). Никаких новых типов состояния.
- [x] **A3**: New behavior = registry entries — belief creators, memory builders, mood shifts, source flags, directive builders. Всё через registries.
- [x] **A4**: Bilateral — witness reactions apply to any agent at crime location. Player agent (isPlayer) excluded from CG target resolution по existing bilateral guards, но belief suppression в beliefTransfer работает одинаково для всех agents.
- [x] **A5**: No reflex bypass — intimidated witness directive = LLM decides. Может сломаться под давлением. Cover-up suppression = системный блок beliefTransfer (не LLM), но это не reflex bypass: NPC всё ещё может ГОВОРИТЬ о преступлении (LLM decides speech), просто belief не передаётся через structured transfer.
- [x] **A6**: No shared functions modified beyond beliefTransfer suppression check — minimal engine touch.
- [x] **A7**: Engine changes minimal — only boolean flag checks added to existing beliefTransfer flow. CG engine per-target resolution is a CG v2 feature, not witness-specific.
- [x] **A8**: Economy test — FRAUD module would register `registerSourceFlags('fraud_concealment', { concealment: true })` → same beliefTransfer suppression works. Exclusive groups work for any trigger event. PASS.
- [x] **A9**: Simplest solution — CG exclusive groups (existing CG v2 mechanism) + source flags (existing registry) + beliefTransfer boolean check. No new subsystems.

---

## Тест

### Witness Differentiation
1. Преступление при двух свидетелях: друг (sentiment > 0.3) и честный незнакомец (H > 0.6) → друг получает COVER_UP, незнакомец получает REPORT_IMPULSE
2. Свидетель одновременно друг И честный → COVER_UP (priority 2 > 1, дружба побеждает)
3. Свидетель ни друг, ни особо честный → ни cover-up, ни eager-report → стандартный WITNESS_MEMORY pipeline

### Cover-Up Suppression
4. NPC с cover_up belief разговаривает с другим NPC → crime belief НЕ передаётся через beliefTransfer
5. NPC с perpetrator belief разговаривает с другим NPC → crime belief НЕ передаётся (perpetrator leakage fix)
6. NPC с обычным witness belief разговаривает → belief передаётся нормально (suppression не затрагивает)

### Intimidated Witness
7. WITNESS_INTIMIDATED event → NPC получает secret directive о запугивании
8. Запуганный NPC при мягком вопросе → уклончивый ответ (LLM follows directive)
9. Запуганный NPC при сильном давлении от trustworthy собеседника → может открыться

### Escalation Precursors
10. ARGUMENT_WITNESSED → свидетели получают MINOR_INCIDENT_MEMORY (importance 3, не каскадирует к guard)
11. THREAT_WITNESSED → свидетели получают WITNESS_MEMORY (importance 5, каскадирует нормально)

### Mood Effects
12. COVER_UP → witness mood -0.10 (guilt/anxiety)
13. REPORT_IMPULSE → witness mood -0.05 (mild stress from urgency)
14. MINOR_INCIDENT_MEMORY → witness mood -0.02 (minimal)
