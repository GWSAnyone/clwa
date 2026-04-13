# SPEC: World Editor

> **Milestone**: M2.5 (Memory & Infrastructure)
> **Status**: Implemented (v0.12.3)
> **Depends on**: Engine registries (for typed dropdowns)
> **Engine changes**: None. Standalone tool — tools/world-editor/.
> **Created**: 2026-04-10
> **Completed**: 2026-04-10

## Что это

Локальный сайт для просмотра и редактирования данных мира CLWA.
Открываешь в браузере `http://localhost:3001` — видишь все данные из `worlds/millhaven/` в удобном виде.
Можно смотреть, менять, сохранять — всё пишется обратно в те же JSON файлы.

## Зачем

Сейчас для просмотра/правки данных нужно открывать JSON файлы руками.
NPC профили — это 100+ строк JSON каждый, отношения — массив из 28 объектов.
Неудобно, легко ошибиться, нет наглядности.

World Editor показывает всё визуально: карточки NPC, слайдеры для personality, цветную матрицу отношений и т.д.

## Где живёт

```
CLWA/tools/world-editor/
  server.ts        — Bun-сервер на порту 3001, читает/пишет JSON
  public/
    index.html     — страница с интерфейсом
    app.js         — логика UI
    style.css      — стили (минимальные, основное — Tailwind CDN)
```

Запуск: `cd CLWA && bun run tools/world-editor/server.ts`

## Что показывает

### 1. Боковое меню (навигация)

Слева — список разделов:
- NPCs (8 персонажей)
- Relationships (кто к кому как относится)
- Motives (скрытые мотивы — кто хочет кому навредить)
- Secrets (кто что знает)
- Locations (места в городе)
- Topics (темы разговоров по ролям)
- World Config (общие настройки мира)

### 2. NPCs

**Список** — карточки с аватаркой-заглушкой, имя, роль, mood bar.

**Карточка NPC** (клик по персонажу):
- **Основное**: id, name, role, background (textarea), speechStyle (textarea)
- **Personality**: 6 слайдеров HEXACO (O, C, E, A, N, H) от 0 до 1 с числовым значением
- **Random Ranges**: min-max слайдеры для рандомизации каждой черты
- **Enneagram**: type (1-9), wing, stressType, growthType, coreFear, coreDesire
- **Secret & Inner Conflict**: два textarea
- **Capabilities**: 3 чекбокса (investigator, detersCrime, canSentence)
- **LLM**: temperature слайдер, maxTokens число
- **Location**: home, startingLocation (dropdown из списка локаций), mobile (чекбокс)
- **Mood**: startingMood слайдер (-1..1), moodRange (min-max)
- **Schedule**: таблица period → location → activity (5 строк: dawn/morning/afternoon/evening/night)
- **Memories**: список строк с кнопками добавить/удалить
- **Shop**: таблица товаров (id, name, price, description) — если есть
- **Motive**: targetId (dropdown NPC), reason (textarea) — если есть

Кнопка **Save** — пишет обратно в `npcs/{id}.json`.

### 3. Relationships

**Матрица 8x8**: строки = from, столбцы = to.
- Ячейка: цвет по sentiment (красный негатив, зелёный позитив, серый нейтрал)
- При наведении: tooltip с type, note, trust, ranges
- Клик: inline popup для редактирования всех полей
- Пустые ячейки (нет связи): бледные, клик = добавить новую связь

Кнопка **Save** — пишет в `relationships.json`.

### 4. Motives

**Таблица**: from → to, type, reason, confidence, probability, requires.
- type: dropdown (THREAT_PERCEIVED, REVENGE_DESIRE, PERSONAL_GRUDGE)
- confidence/probability: слайдеры 0..1
- requires: JSON-поля (fromHBelow, sentimentBelow и т.д.)
- Кнопки: добавить/удалить мотив

Кнопка **Save** — пишет в `motives.json`.

### 5. Secrets

**Таблица**: npcId, eventType, subject, object, confidence, source.
- Простые поля с dropdowns для npcId и eventType
- Кнопки: добавить/удалить

Кнопка **Save** — пишет в `secrets.json`.

### 6. Locations

**Список карточек**: name, description, connections (теги), conversationHook.
- Все поля редактируемые
- Connections: multiselect из списка локаций
- Zone: read-only (полигоны для карты, менять не нужно)

Кнопка **Save** — пишет в `world.json` (секция locations).

### 7. Topics

**Аккордеон по ролям**: bartender, merchant, guard, priest, bard, blacksmith, judge, herbalist.
- Каждый топик: subject, tone, moodValence, weight, initiatorHook
- Кнопки: добавить/удалить топик в роли

Кнопка **Save** — пишет в `topics.json`.

### 8. World Config

- name, description (textarea)
- config: startMinute, exchangeCount, moodBias
- lore: список строк с add/remove

Кнопка **Save** — пишет в `world.json`.

## API сервера (server.ts)

```
GET  /api/world              — world.json целиком
PUT  /api/world              — перезаписать world.json

GET  /api/npcs               — список всех NPC (читает все файлы из npcs/)
GET  /api/npcs/:id           — один NPC
PUT  /api/npcs/:id           — перезаписать файл NPC

GET  /api/relationships      — relationships.json
PUT  /api/relationships      — перезаписать

GET  /api/motives            — motives.json
PUT  /api/motives            — перезаписать

GET  /api/secrets            — secrets.json
PUT  /api/secrets            — перезаписать

GET  /api/topics             — topics.json
PUT  /api/topics             — перезаписать
```

Все PUT принимают JSON body и пишут с pretty-print (2 spaces indent).

## Дизайн

- Тёмная тема (тёмный фон, светлый текст)
- Tailwind CSS через CDN (без сборки)
- Sidebar слева, контент справа
- Без фреймворков — vanilla HTML/JS
- Адаптивно не обязательно (это dev tool, открывается на десктопе)

## Чего НЕ делает

- Не подключается к запущенному серверу CLWA (порт 3000)
- Не показывает runtime state (mood history, goals, events)
- Не запускает симуляцию
- Это чисто редактор статических данных мира
