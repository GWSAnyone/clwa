# SPEC: Mood & Relationship Randomization

> Milestone 1, задачи 2-3. Дополнение к trait randomization.
> Статус: **реализовано ✅** (smoke test passed — determinism verified)

---

## Цель

Рандомизировать startingMood и relationship sentiment/trust при каждом запуске. Вместе с trait randomization это завершает «числовую» часть Milestone 1 — все параметры, влияющие на поведение NPC, варьируются между прогонами.

---

## A. Starting Mood Randomization

### Что меняем
Поле `startingMood` в NPC JSON — число, определяющее начальное настроение. Влияет на первые решения NPC: mood -0.6 → Mark может убить в первый день. Mood 0.0 → спокоен, преступление позже.

### Формат данных
```json
{
  "startingMood": -0.2,
  "moodRange": [-0.5, 0.1]
}
```
- `startingMood` — base value (для non-roguelike или если moodRange отсутствует)
- `moodRange` — `[min, max]` для рандомизации. Опциональное.

### Диапазоны per-NPC

| NPC | Base | Range | Обоснование |
|-----|------|-------|-------------|
| Garrett | 0.45 | [0.1, 0.5] | Стабильный, но может быть напряжён |
| Mark | -0.2 | [-0.6, 0.0] | Всегда в минусе — давление долгов |
| Ted | 0.35 | [0.0, 0.45] | Обычно позитивен, но может быть подавлен |
| Hilda | 0.2 | [-0.1, 0.35] | Стоик, но отцовская боль может проявиться |
| Elara | 0.25 | [0.0, 0.4] | Обычно весела, но шпионаж давит |
| Aldric | 0.1 | [-0.3, 0.2] | Близок к кризису веры. Может быть совсем плох |
| Bess | 0.3 | [0.0, 0.4] | Спокойна, но видения тревожат |
| Theron | 0.4 | [0.1, 0.5] | Стабилен, судья держит себя в руках |

### Реализация
Добавить в `randomizeTraits()` (или новую функцию `randomizeMoods()`):
- Парсить `moodRange` из NPC JSON
- Рандомизировать через тот же PRNG (per-NPC sub-seed)
- Записать в `worldData.startingMoods[npcId]`

### Population constraint
- Минимум 1 NPC с mood < -0.3 (криминальное давление)
- Ranges спроектированы так что Mark всегда negative → constraint by construction

---

## B. Relationship Randomization

### Что меняем
`relationships.json` содержит 29 пар с sentiment и trust. Рандомизируем числа в пределах, сохраняя тип и направленность.

### Формат данных
```json
{
  "from": "mark",
  "to": "bess",
  "type": "acquaintance",
  "note": "she knows too much about herbs",
  "sentiment": -0.7,
  "trust": 0.0,
  "sentimentRange": [-0.9, -0.3],
  "trustRange": [0.0, 0.15]
}
```
- `sentiment/trust` — base values (defaults)
- `sentimentRange/trustRange` — рандомизация. Опциональные. Если нет → base value.

### Ключевые пары с ranges

**Hostile (мотивные):**
| Pair | Base sentiment | Range | Обоснование |
|------|---------------|-------|-------------|
| Mark→Bess | -0.7 | [-0.9, -0.3] | Всегда negative, но интенсивность варьируется |
| Hilda→Ted | -0.2 | [-0.4, 0.1] | Может быть дружба без обиды, или скрытая злость |
| Bess→Mark | -0.3 | [-0.5, -0.1] | Знает про фейк, но может не злиться |

**Neutral/positive (без range — фиксированные):**
Большинство пар без explicit sentiment/trust используют defaults по type. Для них добавлять ranges не нужно — variety достаточно от trait randomization.

**С explicit values (добавим ranges):**
| Pair | Field | Base | Range |
|------|-------|------|-------|
| Ted→Mark | sentiment | -0.15 | [-0.3, 0.0] |
| Ted→Mark | trust | 0.3 | [0.15, 0.45] |
| Mark→Hilda | sentiment | -0.15 | [-0.3, 0.0] |
| Mark→Garrett | sentiment | -0.1 | [-0.25, 0.05] |
| Elara→Garrett | sentiment | -0.1 | [-0.25, 0.05] |
| Elara→Garrett | trust | 0.3 | [0.15, 0.45] |
| Garrett→Elara | sentiment | -0.1 | [-0.25, 0.05] |
| Garrett→Elara | trust | 0.3 | [0.15, 0.45] |
| Hilda→Ted | trust | 0.4 | [0.2, 0.55] |
| Mark→Hilda | trust | 0.3 | [0.15, 0.45] |

### Реализация
- Добавить `sentimentRange/trustRange` в RelationshipJson interface (world-loader.ts)
- Прокинуть ranges в LoadedWorld
- В trait-randomizer.ts добавить `randomizeRelationships()`:
  - Для каждой пары с range: рандомизировать через PRNG
  - Sub-seed: `hash(globalSeed + fromId + toId)`
- Вызвать из index.ts после randomizeTraits, до makeState

### Population constraint
- Mark→Bess sentiment range [-0.9, -0.3] гарантирует negative → мотив сохраняется
- Нет risk потери всех мотивов

---

## Файлы

| Файл | Изменение |
|------|-----------|
| `server/src/trait-randomizer.ts` | +randomizeMoods(), +randomizeRelationships(), расширить логирование |
| `server/src/world-loader.ts` | Парсить moodRange, sentimentRange, trustRange |
| `server/src/index.ts` | Вызвать новые функции |
| `worlds/millhaven/npcs/*.json` | Добавить moodRange (8 файлов) |
| `worlds/millhaven/relationships.json` | Добавить sentimentRange/trustRange (~10 пар) |

---

## Что НЕ рандомизируем

- relationship type (friend/colleague/acquaintance) — нарративная идентичность
- relationship note — текст
- пары без explicit sentiment/trust — defaults по type достаточно
- motive (targetId/reason) — нарративная связка

---

## Тест

Запустить с seed 1 и seed 2, проверить:
- Mark mood разный
- Mark→Bess sentiment разный (но всегда negative)
- Ted→Mark sentiment разный
