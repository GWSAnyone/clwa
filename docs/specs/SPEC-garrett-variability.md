# SPEC: Garrett Variability — Коррумпированный, ленивый или честный страж

> **Milestone**: M3 (Living Opposition)
> **Status**: Implemented (v0.13.0)
> **Depends on**: CG v2 (done), trait randomization (done), secret directives, beliefTransfer suppression
> **Engine changes**: None. Pure module data — CG rules, belief creators, secret directive builders, source flags.
> **Created**: 2026-04-12
> **Completed**: 2026-04-12

---

## Problem

Гарретт — единственный страж в Millhaven. До этой фичи его поведение было бинарным:
- Свидетельствовал преступление → WANTED_STATUS → расследование → арест
- Слышал слух → WANTED_STATUS → расследование → арест

Каждый прогон: один и тот же честный страж. Нет причин обходить его, нет причин строить кейс без него. Расследование = поговори с Гарреттом, дай ему улику, жди арест.

**GDD цель**: Гарретт — pivot character. Его тип определяет прогон:
- Principled → честно расследует, сотрудничает при доказательствах
- Lazy → делает минимум, нужна помощь игрока
- Corrupt → можно подкупить, может защитить преступника, может подставить невиновных

Игрок не знает, какой Гарретт ему достался. Должен выяснять через взаимодействие.

---

## Design: CG v2 Exclusive Groups для Guard Response

Решение использует механизм exclusive groups из CG v2 — правила в одной группе конкурируют, срабатывает только правило с наивысшим приоритетом, чьи conditions выполнились.

### Threshold

Трейт `H` (honesty) рандомизируется в диапазоне `[0.3, 0.85]` (из `garrett.json` → `randomRanges.H`).

Порог коррупции: **H < 0.4**.

| Поведение | H Range | CG Result |
|-----------|---------|-----------|
| **Corrupt** | 0.3–0.39 | `CORRUPTION_COVER` — игнорирует преступление |
| **Honest** | 0.4–0.85 | `WANTED_STATUS` — стандартное расследование |

> **Отличие от GDD**: дизайн-документ описывает три типа (principled 0.7-0.9, lazy 0.5-0.7, corrupt 0.3-0.5). Текущая реализация использует бинарный порог H < 0.4. "Lazy" поведение (0.4-0.7) эмергентно — честный Гарретт с низким C или низким E просто менее активен, но всё равно расследует. Три архетипа GDD — спектр, не дискретные состояния.

### Exclusive Group: `guard_witness_response`

Когда страж получает WITNESS_MEMORY (видит преступление лично):

```typescript
// Priority 2 (fires first if conditions match): corrupt guard covers up
{
  id: 'corrupt-guard-witness',
  trigger: 'WITNESS_MEMORY',
  targetMode: 'affected',
  conditions: [
    { op: 'has_capability', value: 'investigator' },
    { op: 'trait', of: 'target', trait: 'honesty', comparator: '<', value: 0.4 },
  ],
  consequence: {
    type: 'CORRUPTION_COVER',
    importance: 5, delayDays: 0, probability: 0.8,
  },
  exclusive: 'guard_witness_response',
  priority: 2,
  maxChainDepth: 2,
}

// Priority 1 (fallback): honest guard investigates
{
  id: 'guard-witnessed-murder',
  trigger: 'WITNESS_MEMORY',
  targetMode: 'affected',
  conditions: [
    { op: 'has_capability', value: 'investigator' },
  ],
  consequence: {
    type: 'WANTED_STATUS',
    importance: 7, delayDays: 0, probability: 1.0,
  },
  exclusive: 'guard_witness_response',
  priority: 1,
  maxChainDepth: 3,
}
```

Механика: CG v2 сортирует правила в группе по priority desc. `corrupt-guard-witness` (priority 2) проверяется первым. Если H < 0.4 → fires, `guard-witnessed-murder` пропускается. Если H >= 0.4 → conditions fail, fallback на `guard-witnessed-murder`.

### Exclusive Group: `guard_rumor_response`

Когда страж слышит RUMOR_SPREAD (кто-то обсуждал преступление в его присутствии):

```typescript
// Priority 2: corrupt guard ignores rumor
{
  id: 'corrupt-guard-rumor',
  trigger: 'RUMOR_SPREAD',
  targetMode: 'affected',
  conditions: [
    { op: 'has_capability', value: 'investigator' },
    { op: 'trait', of: 'target', trait: 'honesty', comparator: '<', value: 0.4 },
  ],
  consequence: {
    type: 'CORRUPTION_COVER',
    importance: 4, delayDays: 0, probability: 0.7,
  },
  exclusive: 'guard_rumor_response',
  priority: 2,
  maxChainDepth: 1,
}

// Priority 1: honest guard starts investigation
{
  id: 'guard-heard-rumor',
  trigger: 'RUMOR_SPREAD',
  targetMode: 'affected',
  conditions: [
    { op: 'has_capability', value: 'investigator' },
  ],
  consequence: {
    type: 'WANTED_STATUS',
    importance: 7, delayDays: 0, probability: 1.0,
  },
  exclusive: 'guard_rumor_response',
  priority: 1,
  maxChainDepth: 3,
}
```

---

## CORRUPTION_COVER Event

### Регистрация

```typescript
registerEventCategory('corruption', ['CORRUPTION_COVER']);
```

### Mood Shift

```typescript
CORRUPTION_COVER: -0.05  // unease from deliberately ignoring duty
```

Минимальный негатив — коррумпированный страж не рефлексирует. Для сравнения: COVER_UP (свидетель-друг покрывающий преступника) даёт -0.10.

### Belief Creator

```typescript
registerBeliefCreator('CORRUPTION_COVER', (agent, event, _rule, crimeEventType, killer, victimName) => {
  agent.state.beliefs?.addBelief({
    id: crypto.randomUUID(),
    eventType: crimeEventType,
    subject: killer,
    object: victimName,
    location: event.location,
    confidence: 0.5,
    source: 'cover_up',
    sourceNpcId: null,
    gameDay: event.gameDay,
    lastUpdated: event.gameDay,
  });
});
```

Ключевые детали:
- **source: `'cover_up'`** — не `'witness'` и не `'perpetrator'`. Это отдельный тип знания.
- **confidence: 0.5** — знает, но не на 100% уверен (видел или слышал, но решил не вникать)
- **sourceNpcId: null** — информация не привязана к конкретному информатору

### Memory Text

```typescript
registerMemoryTextBuilder('CORRUPTION_COVER', (_event, killer, victimName) => {
  return `I know about what ${killer} did to ${victimName}. But getting involved would only bring trouble. Best to look the other way.`;
});
```

### Source Flags

```typescript
registerSourceFlags('cover_up', { concealment: true });
```

Флаг `concealment: true` — критическая связка с системой подавления beliefTransfer (см. ниже).

### Event Label

```typescript
CORRUPTION_COVER: 'corruption'
```

---

## Corrupt Guard Secret Directive

Отдельный secret directive builder создаёт LLM-инструкции для коррумпированного стража:

```typescript
registerSecretDirectiveBuilder(({ agent }) => {
  if (!agent.profile.investigator) return [];
  const concealBeliefs = agent.state.beliefs?.getAllBeliefs().filter(
    b => b.source === 'cover_up',
  ) ?? [];
  if (concealBeliefs.length === 0) return [];

  const suspectNames = concealBeliefs.map(b => b.subject).filter(Boolean);
  const names = suspectNames.length > 0 ? suspectNames.join(' and ') : 'someone';
  return [
    `## HIDDEN: You are looking the other way\n` +
    `You know about crimes committed by ${names}, but you've chosen not to act.\n` +
    `- If asked about the crime: downplay it, say you're "still looking into it", stall.\n` +
    `- If pressed for action: make excuses — not enough evidence, too busy, someone else's jurisdiction.\n` +
    `- If the player brings solid evidence: you become uncomfortable, may eventually act if cornered.\n` +
    `- You are NOT loyal to the criminal — just lazy and self-serving. Enough pressure breaks you.`,
  ];
});
```

Четыре поведенческие инструкции:
1. **Stall** — "still looking into it"
2. **Excuses** — "not enough evidence", "too busy"
3. **Breakable** — solid evidence = uncomfortable → eventually acts
4. **NOT loyal** — не защищает преступника, а защищает себя. Достаточно давления — ломается

Это PM=instinct модель: LLM получает vivid prose и сам решает, как это выразить в диалоге. Нет reflex bypass — Гарретт может передумать, если давление достаточно сильное.

---

## Взаимодействие с Cover-Up Suppression

Ключевой механизм: belief с source `'cover_up'` имеет флаг `concealment: true`. Движок проверяет этот флаг при beliefTransfer в NPC-NPC разговорах:

```typescript
// world.ts — belief transfer suppression
const initSuppressed = initiator.state.beliefs?.getAllBeliefs().some(
  b => (isConcealment(b.source) || isPerpetrator(b.source))
    && b.eventType === bt.eventType
) ?? false;
```

**Результат**: коррумпированный Гарретт НЕ может передать информацию о преступлении другим NPC через разговор. Он знает — но молчит. Это блокирует информационный каскад через стража.

Для честного Гарретта: WANTED_STATUS → beliefTransfer работает нормально → информация распространяется → больше NPC узнают о преступлении.

---

## Gameplay Impact

### Corrupt Garrett Run (H < 0.4)

1. Преступление происходит → Гарретт получает CORRUPTION_COVER вместо WANTED_STATUS
2. Нет WANTED_STATUS → нет автоматического расследования, нет ареста
3. Гарретт молчит в разговорах (concealment suppression) → информация не распространяется через него
4. Heat system: преступник получает меньше heat (нет "authority is involved" сигнала)
5. Игрок должен:
   - Собрать доказательства самостоятельно
   - Давить на Гарретта достаточно сильно, чтобы он сломался
   - Или обойти Гарретта полностью (через Терона или общественное давление)
   - Или раскрыть коррупцию ("Expose" path из GDD)

### Honest Garrett Run (H >= 0.4)

Стандартное поведение: WITNESS_MEMORY → WANTED_STATUS → investigate → arrest chain.
Сложность определяется другими факторами (преступник прячется, свидетели запуганы, улики уничтожены).

### GDD Reference: Player Agency Branches

| Path | Corrupt Garrett | Honest Garrett |
|------|----------------|----------------|
| **Solve** | Тяжелее — нужно самому строить кейс | Легче — можно делегировать |
| **Expose** | Уникальный путь — раскрыть коррупцию | N/A |
| **Complicit** | Легче — страж не мешает | Тяжелее — страж активно расследует |

---

## Trait Randomization (garrett.json)

```json
"personality": {
  "H": 0.7
},
"randomRanges": {
  "H": [0.3, 0.85]
}
```

- **Default H: 0.7** — честный (для нерандомизированных запусков)
- **Range: 0.3–0.85** — покрывает все три архетипа GDD
- Вероятность corrupt (H < 0.4): примерно 18% uniform = `(0.4 - 0.3) / (0.85 - 0.3)` ≈ 0.18
- Вероятность principled (H > 0.7): примерно 27%
- Вероятность lazy/moderate (0.4-0.7): примерно 55%

---

## Files

| Файл | Изменения |
|------|-----------|
| `packages/modules/src/crime-justice/cg-rules.ts` | 4 новых CG правила: `corrupt-guard-witness`, `guard-witnessed-murder` (exclusive group `guard_witness_response`), `corrupt-guard-rumor`, `guard-heard-rumor` (exclusive group `guard_rumor_response`) |
| `packages/modules/src/crime-justice/index.ts` | `registerEventCategory('corruption', ['CORRUPTION_COVER'])`. Source flags: `cover_up` → `{ concealment: true }`. Belief creator, memory text builder, mood shift (-0.05), event label. Secret directive builder для corrupt guard |
| `worlds/millhaven/npcs/garrett.json` | `randomRanges.H: [0.3, 0.85]` — обеспечивает вариативность |
| `packages/engine/src/world.ts` | Нет изменений — cover-up suppression уже работала через `isConcealment()` check в beliefTransfer |
| `packages/engine/src/event-registry.ts` | Нет изменений — `isConcealment()`, `SourceFlags.concealment` уже существовали |

**Blast radius**: Zero engine changes. Вся логика — module data (CG rules, belief creators, directive builders, source flags).

---

## Invariant Audit

- [x] **A1**: No module strings in engine — `CORRUPTION_COVER`, `cover_up` определены в модуле. Engine проверяет `isConcealment()` boolean flag.
- [x] **A2**: All state typed — concealment belief = standard Belief с typed source. Нет новых полей.
- [x] **A3**: New behavior = registry entries — CG rules, belief creator, memory builder, directive builder, source flags, event category.
- [x] **A4**: Bilateral — N/A (guard-only behavior; player не имеет investigator capability).
- [x] **A5**: No reflex bypass — directive даёт LLM инструкции ("looking the other way"), но LLM сам решает. "Enough pressure breaks you" = LLM может преодолеть directive.
- [x] **A6**: No shared functions modified.
- [x] **A7**: No engine changes.
- [x] **A8**: Economy test — `has_capability: 'investigator'` condition означает, что любой NPC с investigator flag в другом модуле получит ту же вариативность.
- [x] **A9**: Simplest solution — 4 CG правила + 1 belief creator + 1 directive builder. Использует существующие exclusive groups, concealment flags, beliefTransfer suppression.
- [x] **Inv 3**: capability flags, не role strings — conditions используют `{ op: 'has_capability', value: 'investigator' }`, не `role === 'guard'`.
- [x] **Inv 10**: source flags — `cover_up` зарегистрирован через `registerSourceFlags()` с `{ concealment: true }`. Engine проверяет `isConcealment()`.

---

## Test

1. **Corrupt run**: H рандомизирован < 0.4 → WITNESS_MEMORY на страже → CORRUPTION_COVER fires, NOT WANTED_STATUS → нет расследования
2. **Honest run**: H рандомизирован >= 0.4 → WITNESS_MEMORY на страже → WANTED_STATUS fires → стандартная цепочка
3. **Rumor corrupt**: страж с H < 0.4 слышит RUMOR_SPREAD → CORRUPTION_COVER (importance 4, prob 0.7) → молчит
4. **Rumor honest**: страж с H >= 0.4 слышит RUMOR_SPREAD → WANTED_STATUS → расследование
5. **Concealment suppression**: corrupt Garrett в разговоре → belief с `cover_up` source → `isConcealment()` = true → beliefTransfer blocked
6. **Secret directive**: corrupt Garrett в чате с игроком → "still looking into it", stall, excuses. При сильном давлении — ломается
7. **Probability**: corrupt witness (0.8 prob) < honest witness (1.0 prob) — коррумпированный может "случайно" не покрыть (20% шанс нормальной реакции)
8. **Exclusive correctness**: в каждой группе ровно одно правило fires на NPC — проверить через CG cascade WS overlay

---

*Retrospective spec — документирует реализацию из branch night/autonomous-20260411*
