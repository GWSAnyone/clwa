# SPEC: Trait Randomization

> Milestone 1, задача 1. Каждый запуск — другие личности NPC.
> Статус: **реализовано ✅** (проаудировано CLWA auditor — 0 violations, 4 minor)

---

## Цель

При старте сервера (new game) рандомизировать OCEAN+H трейты всех NPC в заданных диапазонах. Разный seed → разные личности → разные преступления → разные истории.

## Решения (зафиксированы)

| Вопрос | Решение | Почему |
|--------|---------|--------|
| Где хранить диапазоны | В NPC JSON (`randomRanges`) | Данные рядом с данными, сценарист видит всё |
| Какие трейты | Все 6 (O, C, E, A, N, H) | Движок обрабатывает 0-1 корректно |
| Seed | Показывать игроку + CLI `--seed=N` | Воспроизводимость, как Minecraft |
| Валидация | Clamp (не retry) | Детерминированно, быстро |
| Enneagram | НЕ рандомизировать | Определяет "почему", не "как". Рандомизация = другой человек |
| Capabilities | НЕ рандомизировать | investigator/canSentence — структурные роли |
| Mood | НЕ рандомизировать (отдельная задача) | Mood — state, не trait |
| Relationships | НЕ рандомизировать (отдельная задача) | Нужен свой анализ blast radius |

---

## Формат данных

### NPC JSON (добавляется поле `randomRanges`)

```json
{
  "id": "garrett",
  "personality": { "O": 0.3, "C": 0.9, "E": 0.5, "A": 0.4, "N": 0.2, "H": 0.7 },
  "randomRanges": {
    "O": [0.2, 0.5],
    "C": [0.5, 0.95],
    "E": [0.3, 0.7],
    "A": [0.2, 0.6],
    "N": [0.1, 0.4],
    "H": [0.3, 0.85]
  }
}
```

- `personality` — базовые значения (используются если `randomRanges` отсутствует, или в будущем persistent mode)
- `randomRanges` — опциональное поле. Если есть → трейт рандомизируется в `[min, max]`. Если нет → используется base value
- Формат: `{ "TRAIT": [min, max] }` где TRAIT = O|C|E|A|N|H, min/max ∈ [0, 1]

### Диапазоны per-NPC

| NPC | O | C | E | A | N | H | Обоснование |
|-----|---|---|---|---|---|---|-------------|
| **Garrett** (guard) | [0.2, 0.5] | [0.5, 0.95] | [0.3, 0.7] | [0.2, 0.6] | [0.1, 0.4] | **[0.3, 0.85]** | H: corrupt↔principled. C min 0.5: может расследовать |
| **Mark** (merchant) | [0.3, 0.7] | [0.15, 0.5] | [0.4, 0.85] | [0.15, 0.5] | [0.3, 0.8] | **[0.15, 0.5]** | H max 0.5: всегда crime-capable. Primary criminal |
| **Ted** (bartender) | [0.3, 0.7] | [0.4, 0.8] | [0.5, 0.9] | [0.3, 0.85] | [0.15, 0.5] | [0.3, 0.8] | E min 0.5: социален (бармен). A широкий range |
| **Hilda** (blacksmith) | [0.15, 0.5] | [0.5, 0.9] | [0.2, 0.6] | [0.15, 0.5] | [0.1, 0.4] | [0.4, 0.85] | A low range: грубая. C min 0.5: дисциплинирована |
| **Elara** (bard) | [0.6, 0.95] | [0.15, 0.5] | [0.6, 0.95] | [0.3, 0.8] | [0.3, 0.7] | **[0.25, 0.65]** | O/E min high: бард. H: может предать или быть верной |
| **Aldric** (priest) | [0.5, 0.85] | [0.5, 0.9] | [0.3, 0.7] | [0.5, 0.95] | [0.2, 0.6] | [0.6, 0.95] | A min 0.5: заботится о людях. H min 0.6: честный |
| **Bess** (herbalist) | [0.6, 0.9] | [0.2, 0.6] | [0.15, 0.5] | [0.5, 0.85] | [0.3, 0.8] | [0.5, 0.9] | E max 0.5: замкнутая. O min high: мистик |
| **Theron** (judge) | [0.4, 0.8] | [0.7, 0.98] | [0.2, 0.6] | [0.2, 0.6] | [0.1, 0.4] | **[0.6, 0.95]** | C min 0.7 + H min 0.6: справедливый судья. A varies: милосердный↔суровый |

**Ключевые constraints встроены в ranges:**
- Mark H max 0.5 → всегда crime-capable (population constraint #1)
- Elara H max 0.65 → second crime-capable NPC (population constraint #2)
- Garrett C min 0.5 → может расследовать
- Theron C min 0.7 + H min 0.6 → может судить справедливо
- Ted/Elara E min 0.5/0.6 → social NPCs exist (population constraint #3)

---

## Seed система

### Генерация
```
new game:     seed = Date.now()
resume:       seed = save.json.seed (воспроизводит те же трейты)
CLI override: --seed=847291 (для тестирования/шаринга)
```

### Per-NPC sub-seed
```
npcSeed = hash(globalSeed + npcId)
```

Каждый NPC получает свой sub-seed. Добавление 9-го NPC НЕ меняет трейты остальных 8. Порядок итерации неважен.

### PRNG
Детерминированный mulberry32 (или аналог). 6 вызовов на NPC × 8 NPC = 48 чисел. Качества любого seeded PRNG достаточно.

### Хранение
```json
// save.json (добавляется поле)
{
  "seed": 1711700000000,
  "agents": { ... },
  "positions": { ... }
}
```

При resume: seed из save → те же трейты → консистентность с сохранённым состоянием.

---

## Валидация (двухфазный clamp)

### Фаза 1: Per-NPC ranges
Ranges в JSON уже гарантируют per-NPC constraints. Garrett C ∈ [0.5, 0.95] → невозможно получить C < 0.5.

### Фаза 2: Population constraints
После рандомизации всех NPC — проверяем глобальные условия:

| Constraint | Порог | Если нарушен → clamp |
|-----------|-------|---------------------|
| Crime-capable (H < 0.5) | ≥ 2 NPC | Нарушение невозможно: Mark max 0.5, Elara max 0.65 гарантируют |
| Social NPCs (E > 0.5) | ≥ 2 NPC | Нарушение невозможно: Ted min 0.5, Elara min 0.6 |
| Mood variety (N stdDev) | > 0.1 | Если нарушен: сдвинуть NPC с самым средним N к его range boundary |

**Фактически: ranges спроектированы так, что population constraints удовлетворяются by construction.** Фаза 2 — safety net, не основная логика. В 99% случаев clamp не сработает.

---

## Архитектура реализации

### Новый файл: `packages/server/src/trait-randomizer.ts`

```
Exports:
  randomizeTraits(profiles: AgentProfile[], seed: number): AgentProfile[]

Internal:
  mulberry32(seed: number): () => number     — seeded PRNG
  hashString(str: string): number             — string → number hash
  validatePopulation(profiles: AgentProfile[]): void  — population clamp
```

**Логика randomizeTraits:**
1. Для каждого profile с `randomRanges`:
   - Вычислить `npcSeed = hash(seed.toString() + profile.id)`
   - Создать PRNG instance из npcSeed
   - Для каждого трейта в randomRanges: `value = min + prng() * (max - min)`
   - Записать в profile.bigFive
2. Вызвать validatePopulation()
3. Вернуть модифицированные profiles

**Файл НЕ импортирует** ничего из engine или modules. Только типы (AgentProfile).

### Изменение: `packages/server/src/index.ts`

В функции `main()`, после `loadWorld()`, перед созданием World:

```
const seed = parseSeedFromArgs() ?? loadSeedFromSave() ?? Date.now();
randomizeTraits(worldData.profiles, seed);
console.log(`[Trait Randomization] Seed: ${seed}`);
// ... log per-NPC traits
```

При save: включить seed в JSON.

### Изменение: `packages/server/src/world-loader.ts`

Прокинуть `randomRanges` из NPC JSON в AgentProfile. Одно поле, ~5 строк.

### Изменение: `worlds/millhaven/npcs/*.json`

Добавить `randomRanges` field в каждый из 8 файлов.

---

## Логирование

```
[Randomization] Seed: 847291
[Randomization] Garrett: O=0.35 C=0.82 E=0.51 A=0.33 N=0.22 H=0.71
[Randomization] Mark:    O=0.52 C=0.28 E=0.63 A=0.22 N=0.65 H=0.28
[Randomization] Ted:     O=0.45 C=0.62 E=0.78 A=0.71 N=0.28 H=0.55
[Randomization] Hilda:   O=0.28 C=0.75 E=0.35 A=0.28 N=0.18 H=0.62
[Randomization] Elara:   O=0.82 C=0.32 E=0.85 A=0.55 N=0.48 H=0.38
[Randomization] Aldric:  O=0.72 C=0.68 E=0.45 A=0.82 N=0.35 H=0.88
[Randomization] Bess:    O=0.78 C=0.35 E=0.28 A=0.72 N=0.55 H=0.72
[Randomization] Theron:  O=0.55 C=0.88 E=0.35 A=0.38 N=0.22 H=0.82
[Randomization] Population: crime-capable=2 social=3 ✓
```

---

## API

### `GET /api/seed`
Возвращает `{ seed: number }`. Для UI — показать игроку.

### `GET /api/agents` (существующий)
Уже возвращает `bigFive` — будет отражать рандомизированные значения без изменений.

---

## Что НЕ входит в эту задачу (отложено и почему)

| Что | Почему отложено | Когда |
|-----|----------------|-------|
| **Relationship randomization** | Отдельный blast radius: мотивы зависят от sentiment. Нужен свой анализ | Milestone 1, задача 2 |
| **Starting mood randomization** | Mood — state, не trait. Влияет на первые решения. Нужен баланс с trait randomization | Milestone 1, задача 3 |
| **Corrupt Garrett mechanics** | Trait randomization даёт low H. Но механики (принять взятку, подставить невиновного) — это новые affordances | Milestone 3 |
| **Enneagram randomization** | Меняет narrative identity NPC. Несовместимо с innerConflict/secret/speechStyle | Не планируется |
| **speechStyle adaptation** | LLM адаптирует тон к personality description. Если станет проблемой — задача для LoRA | По необходимости |
| **UI seed display** | Нужен UI элемент (seed на экране). Пока: только API + console log | Milestone 4-5 |

---

## Находки из анализа

### Что вскрылось при повторном анализе

1. **Mood baseline зависит от N и E** (`world.ts:1166`): `baseline = 0.3 - N*0.4 + E*0.2`. Высокий N + низкий E → вечно плохое настроение → больше преступлений. Ranges учитывают это: N и E имеют достаточный spread.

2. **investigate НЕ зависит от H** — weights только C↑ и O↑. Corrupt Garrett (low H) всё равно расследует (high C). Коррупция проявляется через IL (реакция на bribe) и instinct builder (resistance voice), не через investigation eagerness.

3. **socialize зависит от E** — E < 0.3 → NPC почти не социализируется. `scorePair` в scheduler даёт negative score при E < 0.3 у обоих. Ted/Elara min E гарантируют social activity.

4. **Population constraints удовлетворяются by construction** — ranges спроектированы так, что Mark всегда crime-capable, Ted/Elara всегда social, Garrett всегда investigator-worthy. Runtime clamp — safety net.

5. **Per-NPC sub-seed** решает проблему forward compatibility: добавление NPC не меняет трейты существующих.

---

## Тестирование

### Автоматическое
```bash
# 5 запусков с разными seeds — проверить variety
for seed in 1 2 3 4 5; do
  bun run packages/server/src/index.ts --seed=$seed --dry-run 2>&1 | grep "\[Randomization\]"
done
# Ожидание: разные H для каждого NPC, constraints пройдены
```

### Ручное
1. Запустить с seed=1. Записать трейты Mark.
2. Запустить с seed=2. Убедиться что трейты Mark другие.
3. Запустить с seed=1 снова. Убедиться что трейты идентичны первому запуску.
4. Прогнать 20 тиков. Проверить что Mark с H=0.2 склонен к преступлению, а Mark с H=0.5 — нет.

### Acceptance criteria (из GDD)
> 5 рестартов (разные seeds) производят минимум 3 различных сценария (разный преступник, разный тип преступления, разная жертва).

---

## Чеклист перед реализацией

- [ ] Спека утверждена (этот документ)
- [ ] Ranges per-NPC согласованы
- [ ] Population constraints проверены на бумаге
- [ ] Файлы для изменения перечислены
- [ ] Edge cases покрыты
- [ ] Тесты определены
