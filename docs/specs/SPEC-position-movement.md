# SPEC: Position-Authoritative Movement System

> Движение NPC: от таймера к физике. NPC идёт с фиксированной скоростью, прибывает когда дошёл.
> Статус: **спека** (не реализовано, текущий workaround — distance-based timer в Path B)

---

## Цель

Заменить таймерную систему transit (фиксированное время per hop) на position-authoritative: сервер двигает NPC по пути с постоянной скоростью, прибытие определяется физической позицией (вход в зону назначения), не таймером.

## Почему это нужно

### Текущая архитектура (таймерная)

```
Engine: transitDuration = hops * minutesPerHop (30min)
Engine: _advanceTransits() — elapsed / duration → progress → arrival
Server: PositionManager хранит start + target, НЕ двигает
Client: анимирует NPC по A* waypoints, подгоняя скорость под transit time
```

**Проблемы:**
1. ~~Фиксированное время → переменная скорость~~ → **workaround в Path B** (distance-based duration)
2. Позиция НЕ авторитетна на сервере — сервер не знает где NPC **сейчас** в пикселях
3. Клиент-сервер рассинхрон: клиент анимирует своим темпом, сервер "прибывает" по таймеру
4. Невозможен стелс/perception на основе точной позиции — engine знает только location slug
5. При лаге/рассинхроне — рывки и телепортации

### Целевая архитектура (position-authoritative)

```
Engine: "NPC, иди в town-square" (intent — только inTransit + transitTo)
Server: PositionManager вычисляет A* путь, шлёт waypoints клиенту
Server: каждый game tick — advancePositions() двигает авторитетные позиции
Server: NPC вошёл в зону назначения → world.handleArrivals()
Engine: agent.location = 'town-square', transit cleared
Client: dead reckoning по серверным waypoints + lerp correction при расхождении
```

---

## Дизайн

### Двухуровневая позиция

| Уровень | Где | Что |
|---------|-----|-----|
| **Логический** | Engine (`agent.state.location`) | Location slug. Gameplay: beliefs, perception, conversation pairing |
| **Физический** | Server (`PositionManager`) | Pixel (x, y). Рендер, pathfinding, distance checks |

Логический меняется при **пересечении границы зоны** (pointInPolygon). До этого NPC "в пути" — engine знает `transitTo`, но `location` не обновляется до прибытия.

### Pathfinding: единый источник правды — сервер

**Проблема дублирования:** если сервер и клиент оба считают A*, пути могут разойтись (floating point, разный grid state).

**Решение:** A* только на сервере. Сервер вычисляет путь и шлёт waypoints клиенту вместе с movement event. Клиент убирает свой `astarPath()` для NPC — использует серверные waypoints. Свой A* клиент сохраняет **только для player movement** (мгновенный отклик на клик).

```typescript
// Movement event от сервера теперь включает waypoints
broadcast({ type: 'movement', data: [{
  ...m,
  waypoints: path,  // [{x, y}, ...] — серверный A* путь
  speed: transitSpeed,
  arrived: false,
}]});
```

```javascript
// Client: получает waypoints от сервера, не считает свои
case 'movement': {
  for (const m of data) {
    const npc = state.agents[m.agentName];
    if (m.arrived) { /* snap */ }
    else {
      npc.waypoints = m.waypoints; // серверные, не astarPath()
      npc.walkSpeed = m.speed;
      npc.wpIdx = 0;
      npc.moving = true;
    }
  }
}
```

### Server-Side A* Pathfinding

Переиспользовать `walkableGrid` из `map-data.json`. Тот же grid-based 8-directional A* что в клиенте, но на сервере.

```typescript
// PositionManager additions
private walkableGrid: boolean[][] = [];
private tileSize: number = 64;

loadWalkableGrid(mapData: { walkable: boolean[][]; tileSize: number }): void;

computePath(fromX: number, fromY: number, toX: number, toY: number): { x: number; y: number }[];
```

При `startMovement()` — вычислить путь, сохранить в EntityPosition:

```typescript
interface EntityPosition {
  x: number; y: number;
  inTransit: boolean;
  transitTo?: string;
  path?: { x: number; y: number }[]; // A* waypoints
  pathIdx: number;
}
```

### Tick Rate vs Visual Smoothness

**Проблема:** server tick = 1 game minute = 1 real second at 1x. При 80 px/min NPC прыгает на 80px каждую секунду — не плавно.

**Решение: клиент анимирует, сервер проверяет.**

Роли чётко разделены:
- **Сервер**: авторитетная позиция. `advancePositions()` каждый game tick — дискретные шаги по 80px. Проверяет arrival (pointInPolygon). Хранит "правильную" позицию.
- **Клиент**: визуальная анимация. Dead reckoning по серверным waypoints с `speed * frameDt` — плавно 60fps. Коррекция при расхождении.

Клиент уже сейчас так работает — двигает NPC кадр за кадром по waypoints. Разница: waypoints теперь от сервера, а не свой A*. Плавность обеспечена клиентом, авторитетность — сервером.

```
Server tick (1/sec): advancePositions() → check arrival → broadcast если прибыл
Client frame (60/sec): dead reckoning по waypoints → smooth visual
Position sync (event-based): при movement start + при arrival + при reconnect
```

**Не нужен** высокочастотный серверный loop — клиент и так анимирует плавно. Сервер только авторитетно фиксирует прибытие.

### Server Movement Loop

```typescript
// PositionManager
advancePositions(dtMinutes: number): ArrivalEvent[] {
  const arrivals: ArrivalEvent[] = [];
  
  for (const [entityId, pos] of this.positions) {
    if (!pos.inTransit || !pos.path || pos.path.length === 0) continue;
    
    let remaining = this.transitSpeed * dtMinutes; // px to move this tick
    
    while (remaining > 0 && pos.pathIdx < pos.path.length) {
      const wp = pos.path[pos.pathIdx];
      const dx = wp.x - pos.x, dy = wp.y - pos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      
      if (dist <= remaining) {
        pos.x = wp.x; pos.y = wp.y;
        remaining -= dist;
        pos.pathIdx++;
      } else {
        const ratio = remaining / dist;
        pos.x += dx * ratio;
        pos.y += dy * ratio;
        remaining = 0;
      }
    }
    
    // Check arrival: entered destination zone?
    if (pos.transitTo) {
      const zone = this.zones.get(pos.transitTo);
      if (zone && this.pointInPolygon(pos.x, pos.y, zone.polygon)) {
        pos.inTransit = false;
        pos.path = undefined;
        pos.pathIdx = 0;
        arrivals.push({ entityId, location: pos.transitTo });
      }
    }
    
    // Fallback: path exhausted but not in zone → snap to zone center
    if (pos.pathIdx >= (pos.path?.length ?? 0) && pos.inTransit) {
      const zone = this.zones.get(pos.transitTo!);
      if (zone) {
        pos.x = zone.center[0]; pos.y = zone.center[1];
        pos.inTransit = false;
        pos.path = undefined;
        arrivals.push({ entityId, location: pos.transitTo! });
      }
    }
  }
  
  return arrivals;
}
```

### Engine API: handleArrivals()

Engine предоставляет метод. Server вызывает. Engine мутирует **свой** state через свой API — чистота соблюдена.

```typescript
// World — публичный метод, часть engine API
handleArrivals(arrivals: ArrivalEvent[]): void {
  for (const { entityId, location } of arrivals) {
    const agent = this.agents.get(entityId);
    if (!agent || !agent.state.inTransit) continue;
    
    const from = agent.state.location;
    agent.state.location = location;
    this._clearTransit(agent);
    agent.state.processingState = this.goalManager.hasActiveGoal(entityId) 
      ? 'executing_goal' : 'idle';
    
    // Broadcast arrival (same as current _advanceTransits)
    this.callbacks.onMovement?.([{
      agentId: entityId,
      agentName: agent.profile.name,
      from,
      to: location,
      arrived: true,
    }]);
  }
}
```

**Контракт:** server НИКОГДА не пишет в `agent.state` напрямую. Только через engine API (`world.handleArrivals()`, `world.startTransit()`). Engine — единственный мутатор своего state.

### Transit Time Estimation для Goals

**Проблема:** goals.ts использует оценку времени в пути для maxChase logic. Убрать transitDuration = потерять оценку.

**Решение:** `estimateTransitTime(from: string, to: string): number` — на основе precomputed zone-center distances.

```typescript
// PositionManager — precomputed at init
private zoneDistances: Map<string, Map<string, number>> = new Map();

precomputeZoneDistances(): void {
  for (const [idA, zA] of this.zones) {
    const distMap = new Map<string, number>();
    for (const [idB, zB] of this.zones) {
      if (idA === idB) { distMap.set(idB, 0); continue; }
      const dx = zA.center[0] - zB.center[0];
      const dy = zA.center[1] - zB.center[1];
      distMap.set(idB, Math.sqrt(dx * dx + dy * dy));
    }
    this.zoneDistances.set(idA, distMap);
  }
}

/** Estimate transit time in game minutes between two zones */
estimateTransitMinutes(from: string, to: string): number {
  const dist = this.zoneDistances.get(from)?.get(to) ?? 1000;
  return Math.max(3, Math.ceil(dist / this.transitSpeed));
}
```

**Для engine:** server передаёт estimation function (или lookup table) при создании World. Engine использует для goal logic, не для arrival.

```typescript
// WorldConfig addition
transitTimeEstimator?: (from: string, to: string) => number;
```

goals.ts вызывает `config.transitTimeEstimator?.(from, to) ?? 30` вместо `hops * minutesPerHop`.

### Multi-hop Transit: сквозной путь

**Не серия 1-hop с остановками.** Один A* путь до конечной точки через все зоны.

```
Blacksmith → Temple of Dawn (через Town Square):
  A* от позиции NPC до random point в Temple zone
  = один непрерывный пиксельный путь через всю карту
```

**Промежуточные зоны:** при пересечении границы промежуточной зоны — engine обновляет `agent.state.location` (для perception/gameplay). Но NPC не останавливается — продолжает движение.

```typescript
// В advancePositions() — дополнительная проверка промежуточных зон
// Только для multi-hop: transitPath = ['town-square', 'temple-of-dawn']
if (pos.transitPath && pos.transitPath.length > 1) {
  const nextHop = pos.transitPath[0];
  if (nextHop !== pos.transitTo) { // промежуточная зона
    const zone = this.zones.get(nextHop);
    if (zone && this.pointInPolygon(pos.x, pos.y, zone.polygon)) {
      // Уведомить engine: location update, но НЕ arrival
      intermediateArrivals.push({ entityId, location: nextHop });
      pos.transitPath.shift(); // убрать пройденный hop
    }
  }
}
```

Engine получает intermediate location updates через отдельный метод:

```typescript
// World
handleIntermediateLocationUpdate(entityId: string, location: string): void {
  const agent = this.agents.get(entityId);
  if (agent) agent.state.location = location;
  // НЕ clear transit, НЕ reset processingState — NPC продолжает идти
}
```

### Position Sync

**Event-based, не периодический:**

| Событие | Что шлёт | Зачем |
|---------|----------|-------|
| Movement start | waypoints + speed + current pos | Клиент начинает dead reckoning |
| Arrival | final pos + arrived=true | Клиент snap'ает (уже рядом, lerp minimal) |
| Client reconnect | all positions + active paths | Восстановление state |
| Intermediate zone | entityId + новый location | Клиент обновляет NPC location label |

**Нет периодического sync по таймеру.** Клиент точно знает path и speed — dead reckoning идентичен серверу. Расхождение возможно только при reconnect → полный sync.

### Конфигурация

```typescript
// WorldConfig additions
/** NPC walk speed in pixels per game minute (default: 80). At 1x: 80 px/s */
transitSpeed?: number;
```

`minutesPerHop` **сохраняется** как fallback для engine-internal estimates (если transitTimeEstimator не задан). Но не используется для arrival.

### Persistence (Save/Load)

**Сохранение:**
```json
{
  "positions": {
    "garrett": { "x": 450, "y": 200, "inTransit": true, "transitTo": "town-square" },
    "ted": { "x": -486, "y": 422, "inTransit": false }
  }
}
```

Waypoints **не сохраняются** — recalculate при загрузке.

**Загрузка:**
1. Восстановить позицию (x, y) из save
2. Если `inTransit && transitTo`: вычислить новый A* path от текущей (x, y) до transitTo zone
3. Если grid карты изменился и путь невозможен — snap к ближайшей зоне, clear transit

```typescript
// PositionManager.restoreTransit(entityId, transitTo)
restoreTransit(entityId: string, transitTo: string): boolean {
  const pos = this.positions.get(entityId);
  if (!pos) return false;
  
  const zone = this.zones.get(transitTo);
  if (!zone) return false;
  
  const target = this.seededPointInZone(entityId, zone);
  const path = this.computePath(pos.x, pos.y, target.x, target.y);
  
  if (path.length === 0) {
    // Путь невозможен — snap к zone center
    pos.x = zone.center[0]; pos.y = zone.center[1];
    pos.inTransit = false;
    return false; // сообщить engine: arrival
  }
  
  pos.path = path;
  pos.pathIdx = 0;
  pos.inTransit = true;
  pos.transitTo = transitTo;
  return true;
}
```

---

## Удаляемое из Engine

| Поле/Метод | Причина удаления |
|------------|-----------------|
| `_advanceTransits()` | Заменён `advancePositions()` в PositionManager |
| `transitProgress` | Позиция определяется физически |
| `transitStartMinute` | Время не используется для arrival |
| `transitDuration` | Arrival = zone boundary check, не таймер |

**Остаётся:**
| Поле | Назначение |
|------|------------|
| `inTransit` | NPC в пути (skip volition, conversations, schedule) |
| `transitTo` | Destination slug (goal step checks) |
| `transitPath` | Logical path slugs (multi-hop intermediate updates) |

---

## Файлы

| Файл | Изменения |
|------|-----------|
| `server/src/position-manager.ts` | A* pathfinding, `advancePositions()`, `computePath()`, `loadWalkableGrid()`, `estimateTransitMinutes()`, `restoreTransit()`, path+pathIdx per entity |
| `engine/src/world.ts` | `handleArrivals()`, `handleIntermediateLocationUpdate()`. Удалить `_advanceTransits()` |
| `engine/src/agent-types.ts` | Убрать `transitProgress`, `transitStartMinute`, `transitDuration` |
| `engine/src/world-types.ts` | `transitTimeEstimator` в WorldConfig. Удалить `arrived` из MovementResult (внутренний routing) |
| `engine/src/movement.ts` | Только intent: inTransit + transitTo. Без timing |
| `engine/src/goals.ts` | `config.transitTimeEstimator()` для maxChase. Убрать transitProgress checks |
| `server/src/index.ts` | `advancePositions()` в clock tick. Route arrivals/intermediates. Передать waypoints в broadcast |
| `server/public/game.js` | NPC movement по серверным waypoints. Dead reckoning. Убрать `astarPath()` для NPC (оставить для player) |

---

## Миграция

1. Перенести A* из `game.js` в `position-manager.ts` (TypeScript)
2. `loadWalkableGrid()` при инициализации из `map-data.json`
3. `advancePositions()` вызывать в server Master Clock handler
4. `world.handleArrivals()` + `handleIntermediateLocationUpdate()` — engine API
5. Movement broadcast включает waypoints + speed
6. Client использует серверные waypoints для NPC dead reckoning
7. Убрать timer transit из engine
8. Save/load: `restoreTransit()` для inTransit NPC
9. Удалить Path B workaround (distance-based timer override)

---

## Тест

1. NPC идёт из Temple → Town Square. Скорость визуально постоянная (~80 px/s at 1x)
2. NPC прибывает в Town Square когда визуально входит в зону (pointInPolygon)
3. Два NPC идут к Town Square из разных зон — одинаковая скорость, разное время прибытия
4. Multi-hop: Blacksmith → Temple — NPC проходит через Town Square без остановки, location обновляется при пересечении
5. gameSpeed 2x/3x — NPC визуально быстрее, arrival соответствует
6. Save во время transit → load → NPC продолжает путь от сохранённой позиции
7. Client reconnect → полный position sync → NPC позиции корректны
8. `estimateTransitMinutes('blacksmith', 'temple-of-dawn')` ≈ 25min (через Town Square)
