## Map: Save/load + world-loader + world-editor — what a bigFive profile→state migration touches

**Допущения:** depth = deep (запрошена точная карта самого рискового churn). Memory `clwa/invariants` загружена; INV-21 в коде шире, чем в memory — см. ниже.

**TL;DR:** Сегодня `bigFive` живёт ТОЛЬКО на `AgentProfile` (статичный, immutable, пересобирается из world JSON при каждом boot) и НЕ попадает в `save.json` вообще. Персистятся только производные state-поля: `baseMood`, `attributes`, `factions`, `inventory`, `moodModifiers`. Миграция «personality → state-resident + persisted» затрагивает 4 слоя: (1) save-shape + toJSON/loadState в `world.ts`, (2) два boot-пути fresh-XOR-load в `index.ts`, (3) seeding из world JSON в `world-loader.ts` + `randomizeTraits`, (4) редактор JSON в `tools/world-editor`. Готовый паттерн для копирования — как уже персистятся `attributes`/`factions` (B1/B3).

---

### Где bigFive СЕЙЧАС: загрузка, персист, редактирование

**Загрузка (fresh):**
- `world-loader.ts:16-22` — `NpcJson.personality` = `{O,C,E,A,N,H}` (числа в JSON).
- `world-loader.ts:229-236` — маппинг `personality.O→bigFive.openness` … `personality.H→bigFive.honesty` при сборке `AgentProfile`. Это единственная точка чтения JSON-формы.
- `trait-randomizer.ts:66-91` (`randomizeTraits`) — МУТИРУЕТ `profile.bigFive[prop]` in-place после `loadWorld`, до `makeState`. Ключи через `TRAIT_KEY_MAP` (`trait-randomizer.ts:27-34`). Вызов: `index.ts:375-378`.
- `index.ts:300-308` (`makeState`) — `baseMood = 0.3 - N×0.4 + E×0.2` выводится из `profile.bigFive`. Это единственная state-производная от личности на сегодня.

**Персист:**
- `bigFive` НЕ сериализуется. `WorldSaveAgentData` (`world.ts:89-105`) содержит `baseMood/attributes/factions/inventory/...`, но НЕ personality.
- `World.toJSON()` (`world.ts:1882-1902`) пишет агента; personality отсутствует.
- При load профиль строится заново из world JSON (`createGameContext`→`loadWorld`, `index.ts:365/773`), затем поверх накладывается `loadState` (`index.ts:800`). То есть personality сегодня «восстанавливается» через пересборку профиля, НЕ через save.

**Редактирование:**
- `tools/world-editor/server.ts:143-156` — `GET/PUT /api/npcs/:id` читает/пишет сырой NPC JSON БЕЗ валидации (`writeJSON(body)`).
- `app.js:365-399` — слайдеры HEXACO биндят `data.personality[key]`, key ∈ {O,C,E,A,N,H}; рядом `randomRanges` (383-398).
- `app.js:446-464` — редакторы gold (`data.attributes.gold`) и factions (`data.factions`) — это и есть B1/B3-паттерн редактора.

---

### Что ИМЕННО трогает миграция profile.bigFive → state (точный список)

**A. Save-shape (`world.ts`):**
1. `world.ts:89-105` — добавить поле в `WorldSaveAgentData` (напр. `personality?` как открытый Record осей).
2. `world.ts:1892-1894` — добавить запись в `toJSON()` строго по паттерну `...(state.x ? { x: state.x } : {})` (иначе пустые агенты ломают тест «empty state round-trips cleanly», save-load.test.ts:327).
3. `world.ts:1992-2004` — добавить блок восстановления по образцу `saved.attributes`: re-clamp + `Number.isFinite` фильтр (SL-07).
4. **INV-21:** `world.ts:1988` — образец default-on-load (`saved.baseMood ?? derive`). Personality на старых сейвах будет ОТСУТСТВОВАТЬ → нужен `saved.personality ?? <из profile.bigFive>`.

**B. State-тип (`agent-types.ts`):**
5. `agent-types.ts:141-188` — добавить personality-блок в `AgentState` (рядом с `attributes?`/`factions?`).
6. `agent-types.ts:0-7` — `BigFive` сейчас ЗАКРЫТ (6 ключей). Открытый реестр осей ломает типизацию `Record<keyof BigFive>` в `al.ts:391`, `trait-randomizer.ts:27`, `instinct-builder.ts:199`.

**C. Boot-пути (`index.ts`) — INV-21 XOR:**
7. `index.ts:300-326` (`makeState`) — FRESH: засеять state-personality из profile (после randomizeTraits).
8. `index.ts:728-736` — паттерн засева attributes/factions (`world.setAttribute`/`joinFaction`); personality-seeder должен встроиться сюда тем же образом ЛИБО в makeState.
9. `index.ts:796-832` — LOAD: `loadState` (800) восстановит persisted personality; FRESH-путь (`createGameContext`) засевает. **Оба пути обязательны.**
10. `index.ts:519,544` — player строится вручную с литеральным bigFive; INV-16 bilateral → player тоже должен получить state-personality (у player нет NPC JSON).

**D. Загрузчик/рандомайзер:**
11. `world-loader.ts:229-236` — если JSON-форма personality меняется, маппинг меняется здесь.
12. `trait-randomizer.ts:66-91` — **критичный порядок:** рандомизация мутирует profile до makeState. Если personality персистится, рандомайзер должен писать в persisted-блок при fresh, но НЕ перезаписывать загруженный (иначе пластически сдвинутая личность затирается ре-рандомизацией каждый boot).

**E. Редактор:**
13. `world-editor/server.ts:150-155` — PUT пишет body как есть, без схемы. `app.js:365-399` слайдеры. При смене JSON-формы personality редактор и loader (`world-loader.ts:16-22,229-236`) меняются синхронно.
14. `world-editor/server.ts:98-121` — `/api/registry` собирает union открытых ключей (factions/capabilities) из данных NPC; если оси личности станут открытыми, аналогичный union-механизм уже есть как образец.

**F. Тесты:**
15. `save-load.test.ts:208-264` — round-trip + anti-vacuous setup (`createTestWorld` 120-137 явно засевает attributes/factions, чтобы тест не проходил вхолостую) + SL-07 NaN-defense. Нужен аналог для personality.
16. `save-load.test.ts:378-382` — тест присутствия `baseMood` в snapshot; образец для personality-присутствия.

---

### Паттерн attributes/factions (что копировать дословно)

`ScalarAttribute` (`attributes.ts:25-35`): `{base, min, max, modifiers[], drift?}` — base+clamp+modifiers, `drift?` опционален с INV-21-комментарием прямо в типе. Цикл персиста:
- toJSON: `world.ts:1892-1893` — omit-when-absent.
- loadState: `world.ts:1992-2006` — для каждого ключа `Number.isFinite(a.base)` проверка, `createAttribute` ре-клампит, modifiers финит-фильтруются, drift восстанавливается только если finite.
- seed: `index.ts:728-735` через `world.setAttribute`/`joinFaction` (движок владеет state, сервер только наполняет).
- editor: `app.js:446-464`.

Это и есть эталон для нового персистируемого personality-блока (если он идёт по модели base+modifiers как mood/B1).

---

### Что НЕ исследовано (вне scope)
- ~30 read-сайтов `agent.profile.bigFive` перечислены в integrationPoints/risks, но их редирект на effective-getter — это отдельная карта (al/cg/volition/instinct/il/topic/scheduler/crime-модули). Здесь только отмечено как риск blast-radius.
- Сама механика плотности/пластичности (SPEC 1) и affordance-space (SPEC 2) — не картировались, фокус был на save/load/editor.
- positions/journal/events персист (`index.ts:257-270`) — соседние слои save.json, не связаны с personality напрямую.