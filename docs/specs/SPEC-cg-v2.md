# SPEC: Consequence Graph v2 — NPC-State Conditions, Exclusive Groups, Performance

> Подготовка к Milestone 3+. Расширение CG engine без ломающих изменений.
> Цель: одна доработка сейчас → никаких крупных рефакторингов при добавлении Economy/Politics/Combat модулей.
> Статус: **implemented** (v0.13.0-dev, night/autonomous-20260411)

---

## Проблема

CG v1 работает для Crime & Justice: 13 правил, простые условия на payload события и роль NPC. Но три ограничения блокируют рост:

### 1. Условия не видят состояние NPC

Свидетель убийства — друг преступника? Честный или трусливый? У него есть beliefs о подозреваемом? CG v1 не может это проверить — условия работают только с payload события (`has_witnesses`, `is_public_place`, `has_capability`).

**Конкретный blocked use case (M3 — Living Opposition):**
- `WITNESS_MEMORY + свидетель — друг преступника → COVER_UP` (покрывает)
- `WITNESS_MEMORY + свидетель честный (H > 0.6) → REPORT_IMPULSE` (немедленный донос)
- `WANTED_STATUS + стражник коррумпирован (H < 0.4) → CORRUPTION_COVER` (стражник покрывает)

Сейчас эта логика разбросана по affordance requirements и tick handlers — ad hoc, не системно.

### 2. Конфликтующие правила не разрешаются

Если NPC одновременно друг преступника И честный — два правила матчатся, оба срабатывают. NPC одновременно покрывает И доносит. Нет механизма приоритетов.

### 3. Линейный поиск правил

`for (const rule of this.rules) { if (rule.trigger !== event.type) continue; }` — O(n) на каждое событие. При 100+ правилах (Economy + Politics + Combat) это неоптимально.

---

## Что НЕ входит в CG v2 (и почему)

| Функция | Почему не нужна | Где решается |
|---------|----------------|-------------|
| **Темпоральные условия** ("если арест НЕ произошёл за 3 дня → X") | CG реактивный: "когда X → Y". "Когда X не произошло" = watchdog/timer | Tick phase handlers в модулях |
| **Динамические правила** (add/remove rules в runtime) | Правило может иметь условие проверяющее world state — зарегистрировано всегда, срабатывает по ситуации | Условия на belief/event existence |
| **OR-условия** | Две ветки = два правила с разными условиями. Проще, явнее, легче дебажить | Два правила |
| **Multi-consequence** (одно правило → несколько events) | Уже работает: несколько правил с одним trigger. С trigger index — O(1) lookup | Несколько правил |
| **JSON externalization правил** | Правила = поведение модуля (код), не контент мира (данные). Scenario designer создаёт NPC profiles (JSON), но CG rules — системное поведение | Module code (current) |

---

## Дизайн

### Три изменения в engine

```
┌─────────────────────────────────────────────────────────┐
│ Изменение 1: Target Selection Pipeline                  │
│   evaluateConditions разделён на:                        │
│   resolveTargets() → filter/gate conditions pipeline    │
├─────────────────────────────────────────────────────────┤
│ Изменение 2: NPC-State Condition Ops                    │
│   relationship, trait, belief — новые ops               │
├─────────────────────────────────────────────────────────┤
│ Изменение 3: Exclusive Groups + Trigger Index           │
│   ConsequenceRule.exclusive/priority + Map lookup        │
└─────────────────────────────────────────────────────────┘
```

---

### Изменение 1: Target Selection Pipeline

#### Проблема текущей evaluateConditions

Текущий код (cg-engine.ts:138-185) имеет фундаментальный дефект: условия одновременно **выбирают целей** и **проверяют условия**, и ПЕРВОЕ условие с target selection немедленно return'ит, игнорируя остальные.

```typescript
// ТЕКУЩЕЕ поведение (проблема):
for (const cond of rule.conditions) {
  if (cond.op === 'has_witnesses') return [...filtered agents]; // ← early return!
  if (cond.op === 'has_capability') return [...filtered with cap]; // ← early return!
  if (cond.op === 'eq' && fails) return []; // gate
}
return []; // nothing identified targets
```

**Невозможно:** `[has_witnesses, trait check]` — has_witnesses вернёт targets, trait check никогда не выполнится.

#### Решение: разделить target selection и condition evaluation

**Новое поле на ConsequenceRule:**

```typescript
interface ConsequenceRule {
  // ...existing fields...
  
  /** How to select initial target candidates. Default: 'affected' */
  targetMode?: 'witnesses' | 'location' | 'affected' | 'all';
}
```

| targetMode | Что возвращает | Когда использовать |
|-----------|---------------|-------------------|
| `'witnesses'` | Alive agents at event.location, excluding subject/object/known witnesses | Правила о свидетелях (witness-murder, witness-theft) |
| `'location'` | All alive agents at event.location | Rumor spread в публичных местах |
| `'affected'` | `event.payload.affectedTargets` (default) | Chain rules (guard-heard-rumor) |
| `'all'` | All alive agents (rare) | Global announcements |

**Новый pipeline:**

```typescript
evaluateConditions(rule, event, ctx): string[] {
  // Step 1: Resolve initial candidates
  let candidates = this.resolveTargets(rule, event, ctx);
  if (candidates.length === 0) return [];

  // Step 2: Apply conditions as filters or gates
  for (const cond of rule.conditions) {
    if (candidates.length === 0) return [];
    
    if (isGateCondition(cond)) {
      // Gate: check once, fail entire rule if false
      if (!this.evaluateGate(cond, event, ctx)) return [];
    } else {
      // Filter: reduce candidate list
      candidates = candidates.filter(id => this.evaluateFilter(cond, id, event, ctx));
    }
  }
  
  return candidates;
}
```

**Gate vs Filter determination:**

| Condition op | Type | Логика |
|-------------|------|--------|
| `is_public_place` | Gate | Проверяет event.location, не зависит от target |
| `has_capability` | Filter | Проверяет capability конкретного target |
| `eq` / `gt` / `lt` | Gate | Проверяет event payload field |
| `trait` (of: 'subject') | Gate | Проверяет trait EVENT subject, не target |
| `trait` (of: 'target') | Filter | Проверяет trait каждого target candidate |
| `relationship` | Filter | Проверяет relationship конкретного target |
| `belief` | Filter | Проверяет beliefs конкретного target |

**Правило:** если condition ссылается на `'target'` — это filter. Если на `'subject'`, `'object'`, или event payload — это gate.

#### resolveTargets implementation

```typescript
private resolveTargets(rule: ConsequenceRule, event: WorldEvent, ctx: WorldContext): string[] {
  const mode = rule.targetMode ?? 'affected';
  
  switch (mode) {
    case 'witnesses':
      return Array.from(ctx.agents.entries())
        .filter(([id, agent]) =>
          agent.state.alive &&
          agent.state.location === event.location &&
          id !== event.object &&
          id !== event.subject &&
          !ctx.witnessIds?.has(id))
        .map(([id]) => id);
    
    case 'location':
      return Array.from(ctx.agents.entries())
        .filter(([id, agent]) =>
          agent.state.alive &&
          agent.state.location === event.location &&
          !ctx.witnessIds?.has(id))
        .map(([id]) => id);
    
    case 'affected':
      return (event.payload?.affectedTargets as string[]) ?? [];
    
    case 'all':
      return Array.from(ctx.agents.entries())
        .filter(([, agent]) => agent.state.alive)
        .map(([id]) => id);
  }
}
```

#### Миграция существующих 13 правил

| Текущее правило | Текущий condition op | Новый targetMode | Новые conditions |
|----------------|---------------------|-----------------|-----------------|
| witness-murder | `has_witnesses` | `'witnesses'` | (none — targetMode handles it) |
| body-discovery-to-witness | `has_witnesses` | `'witnesses'` | (none) |
| guard-witnessed-murder | `has_capability: investigator` | `'affected'` | `{ op: 'has_capability', field: 'investigator' }` (filter) |
| rumor-from-witness | `is_public_place` | `'location'` | `{ op: 'is_public_place' }` (gate) |
| guard-heard-rumor | `has_capability: investigator` | `'affected'` | `{ op: 'has_capability', field: 'investigator' }` (filter) |
| witness-theft | `has_witnesses` | `'witnesses'` | (none) |
| theft-discovered-rumor | `is_public_place` | `'location'` | `{ op: 'is_public_place' }` (gate) |
| witness-vigilante | `has_witnesses` | `'witnesses'` | (none) |
| arrest-rumor | `is_public_place` | `'location'` | `{ op: 'is_public_place' }` (gate) |
| sentence-rumor | (none) | `'all'` | (none) |
| fled-rumor | (none) | `'all'` | (none) |
| witness-evidence-destruction | `has_witnesses` | `'witnesses'` | (none) |
| witness-intimidation | `has_witnesses` | `'witnesses'` | (none) |

**Blast radius:** cg-rules.ts (13 правил, механическая миграция) + cg-engine.ts (evaluateConditions rewrite).

---

### Изменение 2: NPC-State Condition Ops

#### Новые ops

**`trait` — проверка OCEAN+H черты NPC**

```typescript
{ 
  op: 'trait',
  of: 'target' | 'subject' | 'object',  // чей trait проверяем
  trait: 'honesty' | 'neuroticism' | 'agreeableness' | 'conscientiousness' | 'openness' | 'extraversion',
  comparator: '>' | '<' | '>=' | '<=',
  value: number   // 0.0-1.0
}
```

- `of: 'target'` → Filter: каждый candidate проверяется, не прошедшие отбрасываются
- `of: 'subject'` → Gate: проверяется event.subject agent. Fail → вся rule отклонена
- `of: 'object'` → Gate: проверяется event.object agent

**Примеры:**
```typescript
// Только свидетели с высокой честностью → немедленный доклад
{ op: 'trait', of: 'target', trait: 'honesty', comparator: '>', value: 0.6 }

// Преступник с низкой честностью → уничтожит улики
{ op: 'trait', of: 'subject', trait: 'honesty', comparator: '<', value: 0.3 }
```

**`relationship` — проверка отношений между двумя NPC**

```typescript
{
  op: 'relationship',
  actor: 'target' | 'subject' | 'object',     // кто "чувствует"
  toward: 'target' | 'subject' | 'object' | string,  // к кому (string = payload field name)
  field: 'sentiment' | 'trust',
  comparator: '>' | '<' | '>=' | '<=',
  value: number
}
```

- Если `actor` = `'target'` → Filter
- Если `actor` = `'subject'` или `'object'` → Gate

**Resolving `toward` references:**
- `'subject'` → event.subject (NPC ID)
- `'object'` → event.object (NPC ID)
- `'target'` → current candidate ID
- Другие строки → `event.payload[toward]` → если это имя → resolve через agents map

**Примеры:**
```typescript
// Свидетель — друг подозреваемого (sentiment > 0.3) → покрывательство
{ op: 'relationship', actor: 'target', toward: 'subject', field: 'sentiment', comparator: '>', value: 0.3 }

// Свидетель ненавидит подозреваемого → с энтузиазмом доносит
{ op: 'relationship', actor: 'target', toward: 'subject', field: 'sentiment', comparator: '<', value: -0.3 }
```

**`belief` — проверка наличия belief у NPC**

```typescript
{
  op: 'belief',
  of: 'target' | 'subject' | 'object',
  eventType?: string,      // фильтр по event type (optional)
  minConfidence?: number,   // минимальная confidence (default 0.1)
  aboutSubject?: boolean,   // belief.subject matches event subject
}
```

**Примеры:**
```typescript
// Target уже знает о преступлении (confidence >= 0.5) → не нужен rumor
{ op: 'belief', of: 'target', minConfidence: 0.5, aboutSubject: true }

// Стражник имеет deduction belief → готов к аресту
{ op: 'belief', of: 'target', eventType: 'WANTED_STATUS', minConfidence: 0.7 }
```

#### Реализация evaluateGate / evaluateFilter

```typescript
private evaluateGate(cond: RuleCondition, event: WorldEvent, ctx: WorldContext): boolean {
  if (cond.op === 'is_public_place') {
    return ctx.publicPlaces?.has(event.location) ?? false;
  }
  if (cond.op === 'eq') return (event as any)[cond.field] === cond.value;
  if (cond.op === 'gt') return (event as any)[cond.field] > (cond.value as number);
  if (cond.op === 'lt') return (event as any)[cond.field] < (cond.value as number);
  
  // NPC-state gates (of !== 'target')
  if (cond.op === 'trait' && cond.of !== 'target') {
    const agent = this.resolveActor(cond.of, event, ctx);
    return agent ? this.checkTrait(agent, cond) : false;
  }
  if (cond.op === 'relationship' && cond.actor !== 'target') {
    const actor = this.resolveActor(cond.actor, event, ctx);
    const towardId = this.resolveToward(cond.toward, event, ctx);
    return actor && towardId ? this.checkRelationship(actor, towardId, cond) : false;
  }
  if (cond.op === 'belief' && cond.of !== 'target') {
    const agent = this.resolveActor(cond.of, event, ctx);
    return agent ? this.checkBelief(agent, event, cond) : false;
  }
  
  return true; // unknown op = pass (forward compat)
}

private evaluateFilter(cond: RuleCondition, targetId: string, event: WorldEvent, ctx: WorldContext): boolean {
  const agent = ctx.agents.get(targetId);
  if (!agent) return false;
  
  if (cond.op === 'has_capability') {
    return !!(agent.profile as Record<string, unknown>)[cond.field ?? cond.value as string];
  }
  if (cond.op === 'trait') {
    return this.checkTrait(agent, cond);
  }
  if (cond.op === 'relationship') {
    const towardId = this.resolveToward(cond.toward, event, ctx, targetId);
    return towardId ? this.checkRelationship(agent, towardId, cond) : false;
  }
  if (cond.op === 'belief') {
    return this.checkBelief(agent, event, cond);
  }
  
  return true; // unknown filter = include (forward compat)
}
```

**Helper functions:**

```typescript
private resolveActor(ref: string, event: WorldEvent, ctx: WorldContext): Agent | null {
  const id = ref === 'subject' ? event.subject
    : ref === 'object' ? event.object
    : null;
  return id ? ctx.agents.get(id) ?? null : null;
}

private resolveToward(ref: string, event: WorldEvent, ctx: WorldContext, targetId?: string): string | null {
  if (ref === 'subject') return event.subject;
  if (ref === 'object') return event.object;
  if (ref === 'target') return targetId ?? null;
  // Payload field → may be NPC name, resolve to ID
  const nameOrId = event.payload?.[ref] as string | undefined;
  if (!nameOrId) return null;
  if (ctx.agents.has(nameOrId)) return nameOrId;
  for (const [id, a] of ctx.agents) {
    if (a.profile.name === nameOrId) return id;
  }
  return null;
}

private checkTrait(agent: Agent, cond: RuleCondition): boolean {
  const traitValue = (agent.profile.bigFive as Record<string, number>)[cond.trait as string]
    ?? (cond.trait === 'honesty' ? agent.profile.bigFive.honesty : undefined);
  if (traitValue == null) return false;
  return this.compare(traitValue, cond.comparator as string, cond.value as number);
}

private checkRelationship(actor: Agent, towardId: string, cond: RuleCondition): boolean {
  const rel = actor.state.relationships?.getRelationship(towardId);
  if (!rel) return false;
  const val = cond.field === 'trust' ? rel.trust : rel.sentiment;
  return this.compare(val, cond.comparator as string, cond.value as number);
}

private checkBelief(agent: Agent, event: WorldEvent, cond: RuleCondition): boolean {
  if (!agent.state.beliefs) return false;
  const beliefs = agent.state.beliefs.getAllBeliefs();
  return beliefs.some(b => {
    if (cond.eventType && b.eventType !== cond.eventType) return false;
    if (cond.minConfidence && b.confidence < cond.minConfidence) return false;
    if (cond.aboutSubject && b.subject !== (event.payload?.suspectName ?? event.subject)) return false;
    return true;
  });
}

private compare(a: number, op: string, b: number): boolean {
  switch (op) {
    case '>': return a > b;
    case '<': return a < b;
    case '>=': return a >= b;
    case '<=': return a <= b;
    default: return a === b;
  }
}
```

#### Расширение RuleCondition

```typescript
// BEFORE (v1):
interface RuleCondition {
  field: string;
  op: string;
  value?: unknown;
}

// AFTER (v2) — backward compatible (all new fields optional):
interface RuleCondition {
  field?: string;           // for eq/gt/lt on event payload
  op: string;               // 'trait', 'relationship', 'belief', 'has_capability', 'is_public_place', 'eq', 'gt', 'lt'
  value?: unknown;          // for eq/gt/lt/has_capability
  // New — NPC-state condition fields:
  of?: 'target' | 'subject' | 'object';         // whose state to check
  trait?: string;                                 // for op='trait': which OCEAN+H trait
  actor?: 'target' | 'subject' | 'object';       // for op='relationship': who feels
  toward?: string;                                // for op='relationship': toward whom
  comparator?: '>' | '<' | '>=' | '<=';          // for trait/relationship numeric comparison
  eventType?: string;                             // for op='belief': filter by event type
  minConfidence?: number;                         // for op='belief': minimum confidence
  aboutSubject?: boolean;                         // for op='belief': belief.subject matches event subject
}
```

---

### Изменение 3: Exclusive Groups + Trigger Index

#### Exclusive Groups

**Новые поля на ConsequenceRule:**

```typescript
interface ConsequenceRule {
  // ...existing...
  /** Exclusive group name. Rules in same group: only highest-priority match fires. */
  exclusive?: string;
  /** Priority within exclusive group. Higher = wins. Default 0. */
  priority?: number;
}
```

**Обработка в process():**

```typescript
// After matching rules by trigger:
const candidates = this.rulesByTrigger.get(event.type) ?? [];

// Separate exclusive vs independent
const independent: ConsequenceRule[] = [];
const exclusiveGroups = new Map<string, ConsequenceRule[]>();

for (const rule of candidates) {
  if (rule.exclusive) {
    const group = exclusiveGroups.get(rule.exclusive) ?? [];
    group.push(rule);
    exclusiveGroups.set(rule.exclusive, group);
  } else {
    independent.push(rule);
  }
}

// For each exclusive group: sort by priority desc, fire first that passes conditions
const toFire: ConsequenceRule[] = [...independent];
for (const [, group] of exclusiveGroups) {
  group.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  for (const rule of group) {
    const targets = this.evaluateConditions(rule, event, ctx);
    if (targets.length > 0) {
      toFire.push(rule); // only the highest-priority match
      break;
    }
  }
}
```

**Пример — M3 witness reaction:**

```typescript
// Друг преступника → покрывательство (priority 2, wins over honesty)
{
  id: 'witness-cover-up',
  trigger: 'WITNESS_MEMORY',
  targetMode: 'witnesses',
  conditions: [
    { op: 'relationship', actor: 'target', toward: 'subject', field: 'sentiment', comparator: '>', value: 0.3 },
  ],
  consequence: { type: 'COVER_UP', importance: 5, delayDays: 0, probability: 0.6 },
  exclusive: 'witness_reaction',
  priority: 2,
  maxChainDepth: 3,
}

// Честный свидетель → немедленный доклад (priority 1, lower than friendship)
{
  id: 'witness-eager-report',
  trigger: 'WITNESS_MEMORY',
  targetMode: 'witnesses',
  conditions: [
    { op: 'trait', of: 'target', trait: 'honesty', comparator: '>', value: 0.6 },
  ],
  consequence: { type: 'REPORT_IMPULSE', importance: 6, delayDays: 0, probability: 0.9 },
  exclusive: 'witness_reaction',
  priority: 1,
  maxChainDepth: 3,
}
```

**Результат:** Если свидетель одновременно друг и честный → дружба побеждает (priority 2 > 1), NPC покрывает. Это дизайнерское решение: лояльность выше принципов. Другой модуль может создать группу с другой логикой.

#### Trigger Index

```typescript
class ConsequenceEngine {
  private rulesByTrigger = new Map<string, ConsequenceRule[]>();
  
  constructor(rules: ConsequenceRule[], options?: EngineOptions) {
    this.onEvent = options?.onEvent;
    // Build trigger index
    for (const rule of rules) {
      const existing = this.rulesByTrigger.get(rule.trigger) ?? [];
      existing.push(rule);
      this.rulesByTrigger.set(rule.trigger, existing);
    }
  }
  
  async process(event: WorldEvent, ctx: WorldContext, depth = 0): Promise<ConsequenceResult[]> {
    const candidates = this.rulesByTrigger.get(event.type) ?? [];
    // ...rest of process logic using candidates instead of this.rules...
  }
}
```

O(1) trigger lookup вместо O(n) linear scan. Внутри группы: 5-15 правил, тривиально.

---

## WorldContext расширение

Для NPC-state conditions engine нужен доступ к agents (уже есть). Relationship/trait data живёт на Agent (engine types). Никакого module content в WorldContext.

```typescript
// BEFORE:
interface WorldContext {
  agents: Map<string, Agent>;
  witnessIds?: Set<string>;
  publicPlaces?: Set<string>;
}

// AFTER (unchanged — agents already provides everything needed):
interface WorldContext {
  agents: Map<string, Agent>;     // ← trait/relationship/belief access через agent state
  witnessIds?: Set<string>;
  publicPlaces?: Set<string>;
}
```

**Никаких изменений.** Agent уже содержит profile.bigFive (traits), state.relationships (RelationshipGraph), state.beliefs (BeliefManager).

---

## Файлы

| Файл | Изменения | Оценка |
|------|-----------|--------|
| `packages/engine/src/cg-types.ts` | RuleCondition расширение (новые optional поля), ConsequenceRule + targetMode/exclusive/priority | ~20 строк |
| `packages/engine/src/cg-engine.ts` | Rewrite evaluateConditions → pipeline (resolveTargets + evaluateGate + evaluateFilter). Trigger index в constructor. Exclusive group processing в process(). Helper functions (checkTrait, checkRelationship, checkBelief, resolveActor, resolveToward, compare) | ~150 строк (rewrite ~80 existing + ~70 new) |
| `packages/modules/src/crime-justice/cg-rules.ts` | Миграция 13 правил: убрать has_witnesses/is_public_place из conditions → targetMode field | Механическая |

**Blast radius:** cg-engine.ts (основной rewrite), cg-types.ts (type extension), cg-rules.ts (data migration). Ноль изменений в world.ts, routes.ts, server.ts, il.ts, modules/index.ts.

---

## Backward Compatibility

| Аспект | Стратегия |
|--------|----------|
| Старые RuleCondition (field/op/value) | Все новые поля optional. eq/gt/lt/has_capability работают как раньше |
| has_witnesses / is_public_place ops | Заменяются на targetMode + gate condition. Старый op code можно сохранить как fallback |
| WorldContext | Не меняется |
| ConsequenceResult | Не меняется |
| process() signature | Не меняется |
| buildCgContext() в world.ts | Не меняется |
| Save/Load | CG rules не персистятся — пересоздаются при регистрации модуля |

---

## Что разблокируется

### Сразу при реализации (M3 — Living Opposition)

```typescript
// Коррумпированный Garrett игнорирует wanted status
{ trigger: 'WANTED_STATUS', targetMode: 'affected',
  conditions: [{ op: 'trait', of: 'target', trait: 'honesty', comparator: '<', value: 0.4 }],
  consequence: { type: 'CORRUPTION_COVER', ... },
  exclusive: 'guard_response', priority: 2 }

// Свидетель-друг покрывает преступника
{ trigger: 'WITNESS_MEMORY', targetMode: 'witnesses',
  conditions: [{ op: 'relationship', actor: 'target', toward: 'subject', field: 'sentiment', comparator: '>', value: 0.3 }],
  consequence: { type: 'COVER_UP', ... },
  exclusive: 'witness_reaction', priority: 2 }

// Месть: друг жертвы + высокая агрессивность → revenge goal
{ trigger: 'NPC_KILLED', targetMode: 'all',
  conditions: [
    { op: 'relationship', actor: 'target', toward: 'object', field: 'sentiment', comparator: '>', value: 0.4 },
    { op: 'trait', of: 'target', trait: 'agreeableness', comparator: '<', value: 0.4 },
  ],
  consequence: { type: 'REVENGE_IMPULSE', ... } }
```

### При добавлении Economy модуля

```typescript
// Торговец с низкой честностью → мошенничество при свидетелях → FRAUD_WITNESS
{ trigger: 'FRAUD_COMMITTED', targetMode: 'witnesses',
  conditions: [],
  consequence: { type: 'FRAUD_WITNESS', ... } }

// Свидетель мошенничества с высоким trust к жертве → донос
{ trigger: 'FRAUD_WITNESS', targetMode: 'witnesses',
  conditions: [{ op: 'relationship', actor: 'target', toward: 'object', field: 'trust', comparator: '>', value: 0.5 }],
  consequence: { type: 'FRAUD_REPORT', ... } }
```

### При добавлении Politics модуля

```typescript
// Коррупция раскрыта + NPC лоялен к коррумпированному → молчит
{ trigger: 'CORRUPTION_EXPOSED', targetMode: 'all',
  conditions: [{ op: 'relationship', actor: 'target', toward: 'subject', field: 'trust', comparator: '>', value: 0.6 }],
  consequence: { type: 'LOYALTY_SILENCE', ... },
  exclusive: 'corruption_response', priority: 2 }
```

---

## Принципы

| Принцип | Соблюдение |
|---------|-----------|
| Engine = universal | Новые ops (trait, relationship, belief) работают с engine types (BigFive, RelationshipGraph, BeliefManager). Ноль module strings. |
| Registry pattern | Условия НЕ знают конкретные trait names или event types. Модуль передаёт строки, engine вычисляет. |
| Structured data | Conditions = typed fields (op, trait, comparator, value). Не text matching. |
| No double standards | trait/relationship/belief ops работают одинаково для любого модуля. Economy Module Test: PASS. |
| Backward compatible | Все новые поля optional. Старые правила работают без изменений (targetMode default = 'affected'). |

---

## Когда реализовать

**Спека сейчас ✅** (этот документ).

**Код при подготовке к M3** — первый момент когда понадобятся NPC-state conditions для:
- Garrett variability (corrupt guard ignores wanted status)
- Criminal escalation (personality-driven response to pressure)
- Wrong accusation consequences (friend loyalty cascades)

**Почему не сейчас:** текущие 13 правил работают. M2 (Detective Toolkit) не требует NPC-state conditions. Реализация без потребителя = спекулятивная абстракция.

**Почему не позже M3:** без CG v2 M3 rules придётся реализовывать через ad-hoc tick handlers и affordance hacks, что создаст tech debt для последующих модулей.

---

## Тест

### Миграция
1. Все 13 существующих правил переведены на targetMode + новые conditions
2. E2E chain работает: kill → witness → rumor → wanted → investigate → arrest → sentence
3. Производительность: trigger index, не linear scan

### Новые conditions
1. `trait` filter: только свидетели с H > 0.6 получают REPORT_IMPULSE
2. `relationship` filter: свидетель-друг преступника (sentiment > 0.3) → COVER_UP
3. `belief` filter: NPC с existing belief (confidence > 0.5) не получает повторный rumor
4. Gate: rule с `trait(of: 'subject', H < 0.3)` → fire only if criminal has low H

### Exclusive groups
1. Два правила в группе `witness_reaction`, разные priorities → только highest fires
2. Правило без exclusive group → fires independently, не блокируется группами
3. Exclusive rule conditions fail → следующий по priority в группе пробуется

### Economy Module Test
1. Добавить FRAUD_COMMITTED event type + 3 CG rules с trait/relationship conditions
2. Ноль engine changes — только module data
