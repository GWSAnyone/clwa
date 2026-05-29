# SPEC: Living Millhaven — demonstrate B1/B2/B3 in the crime game

> **Milestone**: M5 follow-on (capability demonstration, not engine work)
> **Status**: 🟡 IN PROGRESS — Phase 0
> **Branch**: `feature/living-millhaven-demo` (off `feature/engine-generalization`)
> **Depends on**: B1 scalar attributes, B2 inventory, B3 factions+standing (all DONE, engine-side)
> **Created**: 2026-05-29
> **Source maps**: 3 senior-reviewer reports (frontend / server channel / crime-module+world) — 2026-05-29 session.

## Цель

Сделать новые универсальные примитивы (gold/attributes, inventory, factions, standing) **видимыми и
играбельными** в текущей crime-демке Millhaven — одной связной петлёй «живой экономики + правосудия».

## Главный инвариант этой работы (success criterion)

**НОЛЬ правок `packages/engine`.** Вся работа — в `packages/modules/crime-justice`, `packages/server`,
`worlds/millhaven`, `packages/server/public`. Если потребовалась правка движка — значит примитив недоделан;
остановиться и пересмотреть. Это доказательство, что генерализация M5 достигла цели («добавь экономику без
правок движка»). `clwa-auditor` в конце подтверждает, что engine-диф пуст.

## Текущее состояние (из карт)

- Движок: World API (`setAttribute/transferAttribute/giveItem/transferItem/joinFaction/adjustStanding`),
  persistence (`toJSON`/`loadState` с SL-07), per-tick decay — **готовы, но 0 вызовов** в server/module.
- `world-loader` НЕ читает attributes/inventory/factions/standing из JSON; boot их не сидит.
- `steal_from` (step-handlers.ts) эмитит `GOODS_STOLEN`, но **не двигает inventory** → B2-точка.
- `shop`/`ShopItem` — витрина для LLM-промпта, **покупка не работает** → B1+B2-точка.
- Естественные фракции: `town_guard`=garrett,magistrate · `merchants_guild`=mark,hilda,bess · criminals=эмерджентно.
- `Relationship.standing` к магистрату = «ось правосудия» (помечено в коде).

## Контент-дизайн (в world JSON)

**Gold** (`attributes.gold`, min 0): mark 200, magistrate 150, hilda 120, player 100, bess 90, garrett 60,
elara 50, aldric 40, ted 15 (в долгу у Марка — уже в lore).
**Factions**: `town_guard`={garrett,magistrate}, `merchants_guild`={mark,hilda,bess}. `criminals` — добавляется
динамически при совершении преступления (step-hook).
**Inventory**: лавки торговцев → реальный сток (mark: bread/cloth/trinket; hilda: dagger/horseshoe/nails;
bess: herbs/poultice/tonic) + цены. Орудие убийства → item на сцене как улика.
**Standing** (к magistrate): стартово 0 у ключевых NPC; правосудные действия двигают (см. ниже).

## Фазы (каждая оставляет игру запускаемой; tsc 0 + тесты после каждой)

### Phase 0 — Data foundation (loader + seed) ✅ DONE (269/269, tsc 0, engine untouched)
- Расширить `NpcJson` (`world-loader.ts`): `attributes?`, `inventory?`, `factions?`. `RelationshipJson`: `standing?`.
- Прокинуть через `loadWorld` → засеять в `createGameContext` через World API (clamps/conservation), по образцу
  seeding beliefs/secrets. `buildRelationshipsFromData` читает `standing`. Player gold+inventory в его state.
- Наполнить 8 NPC + player Millhaven-контентом выше.
- **Verify**: debug API (`/api/debug/attr/...`) показывает gold; save/load round-trip сохраняет (engine SL-07 уже есть).

### Phase 1 — Make it real (module, zero engine edits) ✅ DONE (272/272, tsc 0, engine diff empty)
Сделано: real theft (`steal_from`→engine `removeItems`/`addItem`, conserved перенос + stolenKind в payload),
вступление в `criminals` при краже/убийстве (`markCriminal`), CG-правило `merchant-guild-alarm` (op:`faction`
→ гильдия торговцев на локации реагирует) с полной обвязкой (label+belief-creator+memory-builder — поймано
contract-тестом). Тесты: `tests/living-millhaven.test.ts` (3). **standing-on-justice перенесён в Phase 2**
(player-driven: обвинение/приговор живут в server/IL-потоке). Bribe/trade-транзакция — тоже Phase 2 (player action).
- **Real theft (B2)**: `steal_from` → `world.transferItem(owner, thief, kind, 1)` из реального стока владельца;
  discovery через реальную нехватку.
- **Real trade (B1+B2)**: транзакция `world.transferAttribute(player→merchant, 'gold', price)` +
  `world.transferItem(merchant→player, kind, 1)` (server-action в Phase 2; логика цен — здесь).
- **Bribe (B1)**: действие подкупа стражника золотом → corruption (sentiment/standing вниз, сброс pursuit).
- **Factions (B3)**: join `criminals` при преступлении; CG-правило с `op:'faction'` — кража у торговца →
  тревога-belief всей гильдии на локации; арест → солидарность town_guard.
- **Standing (B3)**: успешный report/testify/верный sentence → `adjustStanding(magistrate,+)`; ложное обвинение /
  arrest-backlash → `−`.
- **Verify**: новые module-тесты (theft двигает сток, bribe, faction-CG, standing). tsc 0.

### Phase 2 — Server surface (4 seams) ✅ DONE (tsc 0, 272/272, live-verified)
- REST: `/api/agents` + `/api/agent/:id` отдают gold+factions(+inventory); `/api/player` — gold+inventory+standing;
  `/api/inventory/:id`. **`POST /api/shop/:merchant/buy/:kind`** (реальная транзакция gold↔товар, conserved) и
  **`POST /api/bribe/:id/:amount`** (золото→коррупция: sentiment/trust + justice-standing вниз для town_guard).
- WS: `economy:update` (gold/factions/inventoryCount дельты) из onTick-диффа → живые изменения в UI.
- Standing-on-justice: подкуп стражника −0.08 к standing с магистратом; осмотр новой улики +0.05; player→magistrate
  ось засеяна 0 на чистом старте. **Live-verified**: buy (Марк 200→215, игрок 100→85, сток 8→7), bribe (justice→−0.08).
- LLM-промпт-обогащение — отложено (на видимость не влияет; follow-up).
> Нюанс: загрузка устаревшего save.json (до фичи) перезаписывает связи без standing → метр «—» до первого действия.
> Чистый старт / New Game показывает standing 0. Документировано (CLAUDE.md clean-start).

### Phase 3 — Frontend (Canvas2D + DOM) ✅ DONE (game.js strict node --check clean; fixed a pre-existing dup)
- HUD: 💰 золото игрока + ⚖ justice-метр (standing с магистратом).
- NPC-инспектор: бэйджи фракций в подзаголовке + строка 💰gold/🎒inventory; standing-бар (St) в Relationships.
- Player-footer: 💰gold + 🎒inventory.
- Спрайты: цветные точки фракций над именем (страж=син, торговец=зол, преступник=красн).
- Лавка: реальная кнопка «Buy» (POST buy, живое обновление золота/стока/инвентаря).
- Кнопка «Bribe 10g» в чате. Тосты на дельты (новый преступник, покупка, подкуп).
- WS `economy:update` → живое обновление gold/факций/бэйджей. `refreshPlayerEconomy()` после действий.
- Попутно убран pre-existing дубль `closeExaminePanel` (теперь strict-clean).

### Phase 2 — Server surface (4 seams) [superseded by the ✅ block above]
- **WS**: новые сообщения `attr:update`/`inventory:update`/`faction:update`/`standing:update`; пуш из per-agent
  цикла в `onTimeUpdate` (диф) + точечно на транзакциях.
- **REST**: gold/factions в `/api/agents` + `/api/agent/:id`; `/api/inventory/:id`; gold+inventory в `/api/player`;
  debug-роуты по образцу.
- **Player actions**: `shop:buy` (реальная транзакция), `bribe`. LLM-промпт: gold/standing/гильдия в system prompt.
- **Verify**: live debug — транзакция меняет обе стороны, дельты прилетают по WS.

### Phase 3 — Frontend (Canvas2D + DOM)
- NPC-инспектор: gold + faction-бэйдж + standing-бар (standing уже приходит, просто рендерим в `renderRelItem`).
- Player HUD: счётчик золота + панель инвентаря (выезжающая, по образцу journal).
- Faction-бэйдж на спрайте (`drawNPCs`).
- Реальная лавка: кнопка «Купить» → `shop:buy`, живое обновление золота.
- Justice-метр: standing игрока с магистратом в HUD + тосты на дельты («−1 хлеб украден», «+5 к магистрату»).
- **Verify**: ручной прогон в браузере — торговля/кража/тревога гильдии/метр правосудия видны.

### Phase 4 — Verify & close
- Полный `bun test` (новые тесты Phase 0/1) + tsc 0.
- **`clwa-auditor`**: подтвердить пустой engine-диф (главный success criterion) + INV-14.
- Live-walkthrough (сервер + браузер + LM Studio).
- Закрыть спеку, коммиты по фазам.

## Риски
- Цены/баланс: держать в данных мира, не в коде. Транзакции атомарны (B1/B2 гарантируют conservation).
- LLM-стоимость live-прогона — gated на доступность LM Studio; механики проверяются debug-API без LLM.
- Фронт — vanilla Canvas2D, без сборки; следовать существующему конвейеру (server-поле → WS → handleWS → state → draw).
