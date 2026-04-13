# SPEC: Detective Toolkit — Alibi Verification, Passive Clue Discovery, Trust-Gated Information

> **Milestone**: M2 (Detective Toolkit)
> **Status**: **implemented** (branch `night/autonomous-20260411`)
> **Depends on**: CG v2 (done), Journal v2 (done), IL (done), motive system (done)
> **Engine changes**: WorldCallbacks.onJournalEntry (callback). Остальное — server + module data.

---

## Problem

Игрок имел базовые инструменты расследования (журнал, разговоры, предъявление улик), но не мог:

1. **Проверить алиби** — NPC утверждает, что был на Рынке утром, но нет способа это верифицировать. Расследование сводится к "поверь на слово".
2. **Получать улики пассивно** — если игрок находится рядом с разговором о преступлении, он ничего не узнаёт. Активное расспрашивание каждого NPC — единственный путь.
3. **Столкнуться с информационным барьером** — все NPC отвечают одинаково открыто, независимо от уровня доверия. Нет ощущения "этот NPC что-то скрывает, нужно заслужить доверие".
4. **Получить зацепку от жертвы** — NPC, которому угрожают, не ищет помощи у игрока. Игрок узнаёт об угрозах только если случайно спросит.

**GDD target**: Детективный геймплей как цикл — подслушал → записал → спросил → заслужил доверие → получил расписание → проверил алиби → предъявил.

---

## Design: 6 подсистем, работающих вместе

### 1. Location History (серверный ring buffer)

Per-NPC кольцевой буфер перемещений, записывающий позицию каждую игровую минуту.

```typescript
// game-context.ts
interface LocationSnapshot {
  minute: number;   // absolute game minute
  location: string; // location slug
}

class LocationHistory {
  private history = new Map<string, LocationSnapshot[]>();
  private maxEntries = 200;

  record(npcId: string, minute: number, location: string): void;
  getLocationAt(npcId: string, minute: number): string | null; // binary search
  getHistory(npcId: string): LocationSnapshot[];
  clear(): void;
}
```

**Ключевые решения:**
- Запись при каждом `onTimeUpdate` callback (каждую игровую минуту)
- Дедупликация: skip если локация не изменилась с прошлой записи
- Ring buffer (200 записей) — достаточно для ~3 игровых дней при частых перемещениях
- Server-level, не engine — позиции не нужны для AI-решений, только для верификации

### 2. Alibi API (debug endpoint)

REST-эндпоинт для проверки алиби NPC по конкретной игровой минуте.

```
GET /api/debug/alibi/:id?minute=N

// С параметром minute — точечный запрос:
{ npcId, name, queriedMinute, location, locationDisplay }

// Без minute — полная история (last 50):
{ npcId, name, currentLocation, entries, history: LocationSnapshot[] }
```

**Использование**: игрок спрашивает NPC "Где ты был утром?" → NPC отвечает → игрок проверяет через API → совпадение/расхождение формирует улику.

### 3. Schedule Knowledge (knownFacts от друзей/коллег)

NPC, связанные отношениями `friend` или `colleague`, знают распорядок дня друг друга. Информация инжектится в `knownFacts` при создании мира.

```typescript
// index.ts — при создании GameContext
for (const [npcId, agent] of agents) {
  const rels = agent.state.relationships?.getAllRelationships() ?? [];
  for (const rel of rels) {
    if (rel.type !== 'friend' && rel.type !== 'colleague') continue;
    const otherSchedule = worldData.schedules.filter(s => s.npcId === rel.targetId);
    // max 3 schedule entries per NPC
    agent.state.knownFacts.push(
      `${otherProfile.name} the ${otherProfile.role}'s routine: morning: Market, ...`
    );
  }
}
```

**Эффект для геймплея**: NPC может сказать "Mark usually works at the Market in the morning" — и это не галлюцинация LLM, а факт из knownFacts. Игрок получает расписание подозреваемого через его коллег/друзей.

### 4. Auto-Journal from Overhear (пассивные улики)

Когда игрок (Player Agent) находится на одной локации с разговором NPC-NPC, содержащим crime-related beliefTransfer — автоматически создаётся запись в журнале.

```typescript
// world.ts — processOverhear()
if (agent.profile.isPlayer && overheardClaim && this.journal) {
  const entry = this.journal.addObservation(
    `Overheard ${initiatorName} and ${responderName} discussing ${topic.subject}.${overheardClaim}`,
    location, conversation.gameDay, this.gameMinute,
  );
  this.callbacks.onJournalEntry?.(entry);
}
```

**Условия срабатывания:**
- Игрок на той же локации, что и беседующие NPC
- ~60% вероятность (общая для всех bystanders)
- Тема разговора содержит beliefTransfer с crime-related eventType
- Не просто "услышал разговор" — нужна конкретная claim-информация (`overheardClaim !== ''`)

**WorldCallbacks.onJournalEntry**: callback на WorldCallbacks, вызываемый engine при создании journal entry. Сервер подписывается и отправляет `journal:entry` через WebSocket → клиент видит новую запись в журнале в реальном времени.

### 5. Trust-Gated Responses (информационный барьер)

NPC-ответы в чате модулируются директивой, зависящей от trust/sentiment к игроку.

```typescript
// server.ts — chat handler
const trust = rel?.trust ?? 0.3;
const sentiment = rel?.sentiment ?? 0;

if (trust < 0.2) {
  // Evasive: short answers, deflects, says "don't know"
  trustDirective = `## HOW YOU FEEL ABOUT THIS STRANGER\n...`;
} else if (trust < 0.35 && sentiment < 0) {
  // Guarded: polite but vague, doesn't volunteer info
  trustDirective = `## HOW YOU FEEL ABOUT THIS PERSON\n...`;
} else if (trust > 0.7) {
  // Open: speaks honestly, shares sensitive information
  trustDirective = `## HOW YOU FEEL ABOUT THIS PERSON\n...`;
}
```

**Пороги:**

| Trust | Sentiment | Поведение |
|-------|-----------|-----------|
| < 0.2 | любой | **Evasive** — короткие ответы, уход от темы, "не знаю" |
| < 0.35 | < 0 | **Guarded** — вежливо, но размыто, не делится деталями |
| 0.35–0.7 | любой | **Neutral** — нет специальной директивы, LLM решает |
| > 0.7 | любой | **Open** — честно, делится чувствительной информацией |

**Механизм**: директива инжектится в system prompt NPC через `fullContext` при chatStream. LLM интерпретирует — не жёсткий блок, а поведенческое давление (соответствует принципу PM=Instinct).

### 6. Victim Approach (жертва ищет помощи)

NPC с belief `THREAT_PERCEIVED` (confidence >= 0.5), не являющийся investigator, подходит к игроку для обращения за помощью.

```typescript
// crime-justice/index.ts — tick phase handler
const threatBeliefs = npc.state.beliefs?.getAllBeliefs().filter(
  (b) => b.eventType === 'THREAT_PERCEIVED'
    && b.object === npcId
    && b.confidence >= 0.5,
) ?? [];

if (threatBeliefs.length > 0 && !npc.profile.investigator) {
  ctx.approaches.push({
    npcId, npcName: npc.profile.name,
    promptContext: `You were recently threatened by ${threatenerName}...`,
    displayText: `${npc.profile.name} approaches you, looking frightened`,
    urgency: 0.7,
  });
}
```

**Триггер**: affordance `threaten` создаёт belief `THREAT_PERCEIVED` у жертвы (source: `personal_motive`, confidence: 0.7). Tick phase handler проверяет co-location с игроком + cooldown (32 тика). NPC approach → promptContext инжектится при следующем открытии чата.

---

## Как подсистемы соединяются: детективный цикл

```
Игрок на локации ──→ NPC-NPC разговор о преступлении
                           │
                    [4. Auto-Journal]
                           │
                    Journal entry ──→ Игрок открывает чат с NPC
                                          │
                                   [5. Trust Gate]
                                     trust < 0.2?
                                    /           \
                                  да            нет
                              evasive        informative
                                |                |
                        Строим доверие    Получаем info
                     (compliments, help)     │
                           │          [3. Schedule Knowledge]
                           │           "Mark works at Market
                           │            in the morning"
                           │                │
                           └──→ Проверяем алиби
                                     │
                              [1. Location History]
                              [2. Alibi API]
                                     │
                              Совпадение / Расхождение
                                     │
                              Предъявляем улики (Evidence Presentation)
```

**Отдельная ветка — жертва инициирует контакт:**
```
NPC получает THREAT_PERCEIVED ──→ [6. Victim Approach]
                                         │
                              NPC подходит к игроку
                              "I was threatened by Mark..."
                                         │
                              Новая зацепка для расследования
```

---

## Pulse API (бонус)

Помимо alibi, добавлен town-wide emotional summary endpoint:

```
GET /api/debug/pulse

{
  alive: number, dead: number,
  avgMood: number,
  crimesCommitted: number,
  activeCrimeScenes: number,
  npcsWithMotives: number,
  deadNpcs: string[],
  npcs: [{ id, name, mood, location, status?, motive? }]
}
```

Позволяет быстро оценить состояние города: кто жив, средний mood, активные crime scenes, NPC с мотивами. Dev tool для отладки, но также основа для будущего town overview UI.

---

## Files

| File | Changes |
|------|---------|
| `server/src/game-context.ts` | `LocationSnapshot` interface, `LocationHistory` class (ring buffer, getLocationAt, getHistory, clear), `locationHistory` field on GameContext |
| `server/src/routes.ts` | `GET /api/debug/alibi/:id?minute=N` (point query + full history), `GET /api/debug/pulse` (town summary) |
| `server/src/index.ts` | `onTimeUpdate` callback records `locationHistory.record()` every game minute; schedule knowledge injection (knownFacts from friend/colleague schedules); `onJournalEntry` callback → WS broadcast |
| `engine/src/world.ts` | `processOverhear()` — player overhear → `journal.addObservation()` + `onJournalEntry` callback; `WorldCallbacks.onJournalEntry` type declaration |
| `server/src/server.ts` | Trust-gated NPC responses: trust < 0.2 evasive, trust < 0.35 + negative sentiment guarded, trust > 0.7 open. Directive injected into `fullContext` for chatStream |
| `modules/src/crime-justice/index.ts` | Tick phase handler: `THREAT_PERCEIVED` belief → NPC approach player for help (urgency 0.7, cooldown 32 ticks) |
| `modules/src/crime-justice/step-handlers.ts` | `threaten` step handler creates `THREAT_PERCEIVED` belief on target (source: personal_motive, confidence: 0.7) |

**Blast radius**: Одно добавление в engine (onJournalEntry callback type + вызов в processOverhear). Остальное — server bootstrap, routes, chat handler, module tick handler. Нет изменений в core engine logic.

---

## Invariant Audit

- [x] **A1**: No module strings in engine — onJournalEntry callback не знает о crime types; processOverhear проверяет `overheardClaim` (string presence), не event types
- [x] **A2**: All state typed — LocationSnapshot = {minute: number, location: string}. Нет placeholder strings
- [x] **A3**: New behavior = registry entries — victim approach через registerTickPhaseHandler; trust gate — server-level directive injection
- [x] **A4**: Bilateral — player overhear использует isPlayer guard (inv 21). LocationHistory записывает только NPC (!isPlayer). Trust gate работает для player↔NPC чата
- [x] **A5**: No reflex bypass — trust directive = prose давление на LLM, не жёсткий блок. NPC может нарушить directive если personality этого требует
- [x] **A6**: No shared functions modified — processOverhear расширен, не заменён
- [x] **A7**: Minimal engine change — только WorldCallbacks.onJournalEntry type + один вызов
- [x] **A8**: Economy test — schedule knowledge, location history, trust gates, overhear journal — всё generic. Если добавить FRAUD module, те же механизмы работают без изменений
- [x] **A9**: Simplest solution — ring buffer вместо DB, knownFacts вместо нового schedule query API, existing approach system для victim contact
- [x] **Inv 17**: Player = Agent — overhear/journal работает через isPlayer flag, не специальный код
- [x] **Inv 26**: Co-location validation — trust gate проверяется только в chat handler, где co-location уже validated

---

## Test Criteria

1. **Location History recording**: NPC перемещается → locationHistory содержит записи с правильными minute/location. Дедупликация: если NPC стоит на месте, новых записей нет
2. **Alibi API point query**: `GET /api/debug/alibi/mark?minute=450` → возвращает локацию, где Mark был на 450-й минуте
3. **Alibi API full history**: `GET /api/debug/alibi/mark` (без minute) → возвращает последние 50 записей перемещений
4. **Schedule knowledge injection**: NPC-друг знает расписание друга (knownFacts содержит routine string). NPC-stranger не знает
5. **Auto-journal from overhear**: Player на одной локации с NPC-NPC разговором о преступлении → journal entry создаётся автоматически → WS `journal:entry` broadcast
6. **Auto-journal negative**: Player на другой локации → journal entry НЕ создаётся. Разговор без beliefTransfer → НЕ создаётся
7. **Trust evasive**: trust < 0.2 → NPC даёт короткие, уклончивые ответы. Не делится деталями о преступлениях
8. **Trust open**: trust > 0.7 → NPC делится чувствительной информацией при прямом вопросе
9. **Victim approach**: NPC получает THREAT_PERCEIVED (conf 0.7) → при co-location с player → approach event с promptContext о угрозе
10. **Victim approach cooldown**: повторный approach от того же NPC блокируется на 32 тика
11. **Pulse endpoint**: `GET /api/debug/pulse` → корректный summary: alive/dead count, avgMood, crime scenes, motives
12. **Ring buffer overflow**: после 200+ записей, старые записи удаляются (shift), getLocationAt всё ещё корректен
