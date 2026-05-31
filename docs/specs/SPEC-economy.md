# SPEC: Economy / Trade — the second genre module (validates the universal-engine thesis)

> **Milestone**: M7 (Economy & Trade). Follows M6 (NPC Brain). Second content module on the genre-neutral engine.
> **Status**: ✅ **READY FOR MERGE (v0.18.0)** on `feature/economy` (NOT yet merged/pushed) — **E1·E2·E3 + P2–P6 все ✅, финальный аудит пройден** (0 MUST-FIX, INV-14 PERFECT, 1 SHOULD-FIX применён).
>   tsc 0, **bun test 303**, crime oracle green. Живой прогон подтвердил: новые системы активны/выбираются/исполняются (см. P6c ниже). Live-verified: trade (buy/sell/haggle→merchant + produce/hoard) moves conserved
>   gold (E2) + inventory; need/debt scoring drives decisions; dynamic price:KIND + hunger drift (E1); lend→collect debt (E2)
>   with debt→crime grudge wiring; emergent NPC reflection on a debt observed.
>   **P6 progress (v0.18.0):**
>   - **P6a ✅** — все 4 фронтовых UX-бага исправлены (детали ниже, секция «Известные UX-баги фронта»).
>   - **P6b ✅** — SHORTAGE эмитится из тика цен через `TickPhaseContext.processEvent` (заметка про «нет onEmitEvent»
>     была неверной — `processEvent` уже есть и кормит CG-шину); кросс-модульное CG-правило `shortage-debt-pressure`
>     (SHORTAGE → DEBT_PRESSURE → +hunger у broke+hungry → economy scoring → больше торговли/контрабанды); fraud-аффорданс
>     `defraud` (торговец обманывает покупателя, событие FRAUD — gossipable); кольцо контрабандистов (smuggle → фракция
>     `smugglers`, B3); markets-as-venues = `atMarket`-гейтинг buy/sell/haggle/defraud. tsc 0, **bun test 303**.
>   - **P6c ✅** — tsc 0 + 303 теста + crime-оракул зелёные. **Живой прогон (auto-tick + LM Studio) — доказано, что новые
>     системы АКТИВНЫ/выбираются/исполняются (не фон):** в volition всплывали defraud×5, hoard×11, smuggle×3, produce×4, haggle×5;
>     LLM сам выбрал `hoard` («goods are getting scarce; let the price rise before I sell»); форс+исполнение `defraud` (Mark→Elara,
>     14 коин, событие FRAUD, консервация Elara −14 / Mark +14) и `smuggle` (Bess +10 чёрный рынок, событие SMUGGLING, **вступление
>     в кольцо `smugglers` — factions=[merchants_guild,smugglers]**); SHORTAGE эмитится из тика; CG-шина = 23 правила (crime+economy);
>     покупка игрока заряжает динамическую цену (6, не статичные 5) с консервацией золота+инвентаря. Фронт-фиксы — подтвердить в браузере.
>   **REMAINING:**
>   - **FINAL (#92)** — clwa-auditor over the whole M7 diff → fix MUST/SHOULD → update ROADMAP/ARCHITECTURE → close spec → (user merges).
>   - **P5 simplifications to revisit** (acceptable v1, noted so they aren't forgotten): debt has no time-based interest/deadline
>     (collection happens when the creditor acts; a `registerDayAdvanceHandler` for interest+overdue→DEBT_DEFAULT is deferred);
>     `FOOD_KINDS` in pricing.ts is a hardcoded set (a proper `edible` item property is deferred); DEBT_DEFAULT→grudge is wired +
>     unit-proven but not yet live-observed (needs a debtor too broke to repay even via overdraft).
> **Goal**: prove "same engine, different data" by building a full economic genre as **module content + registry data**,
>   with the crime-justice game untouched as the regression oracle.
> **Depends on**: M5 (scalar attributes B1 / inventory B2 / factions B3 / open capabilities / CG attr·faction·has_capability ops /
>   `registerScoringContributor` channel) — all shipped and tested.
> **Source of truth**: `docs/workflow/economy-design/2026-05-30-9f1a7253/` (6-agent design workflow: substrate audit,
>   crime-module pattern, genre requirements + prior gaps → primitive-gap classification, content plan, composition + phasing).
> **Created**: 2026-05-30

---

## Цель

Доказать тезис CLWA — «один движок поведенческой физики, контент = модули данных» — построив **второй жанр** (экономика/торговля)
почти без правок движка. Crime-justice остаётся оракулом регрессии: экономика только ДОБАВЛЯет записи в регистры, ничего в crime не
меняет. Параллельно — обогатить сам crime: кража/контрабанда/мошенничество начинают двигать реальную ценность (золото + товары), долг и
дефицит толкают NPC к отчаянию и преступлению через кросс-модульные CG-каскады.

## Ключевой вывод дизайна (измерено по исходникам)

**~75–85 % экономики ложится на СУЩЕСТВУЮЩИЕ примитивы M5 с нулём правок движка.** Богатство = `ScalarAttribute` (gold), товары =
`Inventory` (`transferItem` атомарный), гильдии = факции, профессии = `capabilities`, экономические решения = `registerScoringContributor`
в `computeUtility`, причинно-следственные каскады = CG-операции `attr`/`faction`/`has_capability`. Это уже доказано вживую в
`tests/genre-neutrality.test.ts`, который регистрирует не-crime «economy» жанр (TRADE/FRAUD, `isMerchant`, `eco_defraud`, `minCapital`/`atMarket`)
через те же функции регистрации, что и crime.

Следствие: **экономика — это в основном модульный контент.** Оставшиеся ~15–25 % сводятся к **трём универсальным примитивам движка**
(E1 дрейф base / E2 overdraft-transfer / E3 INTENT_KIND), и по diamond-решению мы строим их СЕЙЧАС — это genre-neutral способности
(у каждой есть не-экономический use-case), а не обходные пути. Так движок становится богаче для всех будущих жанров, а не только экономики.

## Существующий субстрат движка (переиспользуем как есть)

| Концепт экономики | Примитив движка | API / ссылка |
|---|---|---|
| Богатство / цена / нужда / долг | `ScalarAttribute` + `AttributeModifier` | `attributes.ts`; World `get/set/adjustAttributeBase/addAttributeModifier` |
| Перенос денег (атомарный, сохраняющий) | `transferAttribute` | `world.ts:699-708` — дебетует BASE, отказ при base<amount, защита от «печати» единиц |
| Товары + перенос | `Item` + `transferItem` | `inventory.ts`; `world.ts:739-777` (атомарный, conserved) |
| Гильдии/картели + standing | `factions` + `RelationshipGraph.adjustStanding` | `world.ts:712-734`; `relationships.ts:104-109` |
| Профессии | open `capabilities` + `hasCapability` | `agent-types.ts:118` |
| Экономические решения NPC | `registerScoringContributor` → `computeUtility` | `al.ts:438/486` (debt 0.8×0.5 = 0.40, tested) |
| Гейтинг правил по деньгам/гильдии/роли | CG ops `attr`/`faction`/`has_capability` | `cg-engine.ts:284-303` |
| Требования affordance (minCapital, atMarket…) | open-bag + `REQUIREMENT_CHECKERS` | `al.ts`; threading proven `genre-neutrality.test.ts:95-112` |
| Декей по тику | `decayAttribute` каждые 5 game-min | `world.ts:589-591` (только модификаторы, не base — см. P3) |
| Персистенс | `toJSON`/`loadState` для attributes/factions/inventory | sanitization included |

## Изменения движка

**Решение (diamond):** строим ВСЕ три универсальных примитива в движке СЕЙЧАС, а не обходим module-side. Они генеричны (не
экономическая лексика, INV-14/15), каждый имеет не-экономический use-case, и так мы навсегда закрываем вопрос вместо обходных путей.
Каждый — additive (старые миры/сейвы работают без изменений, INV-21), tested в изоляции, crime-флоу остаётся зелёным оракулом.

#### E1 — `ScalarAttribute.drift` + `driftAttribute()` (универсальный дрейф base по тику)
Сейчас `decayAttribute` (`attributes.ts:55`) двигает только модификаторы, не base — у эволюции величины во времени нет дома.
- Добавить `drift?: { ratePerMinute: number; toward?: number }` в `ScalarAttribute`.
- Добавить `driftAttribute(attr, dtMinutes)`, вызываемый РЯДОМ с `decayAttribute` в tick-цикле (`world.ts:~589`). `toward` не задан = линейный
  unbounded дрейф; задан = экспоненциальное приближение к `toward`. Clamp в `[min,max]`. NaN/Infinity-guard (паттерн DD-04). `dt` прокидывается → INV-19.
- INV-16: tick-цикл уже bilateral-осознан; player-атрибуты дрейфуют так же (универсально). INV-21: поле опционально, старые сейвы без `drift` не дрейфуют.
- Не-экономический proof: HP-реген, радиационный распад, остывание. Экономика ставит `drift` на `price:KIND`/`hunger`. **Цена/потребность — module content; дрейф — движок.**

#### E2 — Signed / overdraft transfer + `min<0` (универсальный, разблокирует долг)
`transferAttribute` (`world.ts:700-708`) отказывает при `base<amount` → нельзя уйти в минус (займы/кредит/перерасход).
- Разрешить `min<0` атрибуты (проверить, что `createAttribute`/`setAttribute` не форсят `min=0`).
- Добавить `transferAttribute(..., { allowOverdraft?: boolean })`: при `allowOverdraft` source может уйти ниже нуля вплоть до объявленного `min`,
  СОХРАНЯЯ conservation (сумма не меняется, единицы не «печатаются» — защита `world.ts:704` остаётся для обычного пути).
- INV-15: движок только ослабляет clamp, не узнаёт слова «долг». Долговой ИНСТРУМЕНТ (кредитор/должник/срок/дефолт→consequence) = 100% module content.
- Не-экономический proof: «уйти в минус» по любому ресурсу (репутация ниже нуля, отрицательная стамина).

#### E3 — `INTENT_KIND` registry (универсальный — чинит crime-assumption-leak в IL) + P0-чистка
Сейчас движок НЕ нейтрален по торговле: `TradeIntent` захардкожен в `il.ts:73,141-154,202,276`, плюс `AgentProfile.shop`/`ShopItem`
живут в `agent-types.ts:113,123`. Speech-acts/pressure-types/claim-sources УЖЕ module-registered — `trade` единственное исключение (INV-15 smell).
- Обобщить в `registerIntentKind({ key, schemaFragment, promptHint, correctionFn? })`; динамическая IL-схема + семантическая коррекция итерируют
  зарегистрированные kinds вместо запечённой `trade`-ветки (удалить trade-специфику из `il.ts`).
- Вынести `shop`/`ShopItem` → модульные данные (`Map<merchantId,{kind,name,price,desc}[]>`), сидящие реальный inventory + `price:KIND` атрибуты при world-load.
- Добавить симметричный `TRADE_PROSE` guard в `architecture.test.ts` (зеркало crime-prose guard) — движок «никогда не знает слова trade».
- Экономика регистрирует `trade` (позже `negotiate`); политика — `endorse`, бой — `challenge`. Crime-тесты зелёные.

**Итог по движку: 3 universal-примитива (E1/E2/E3), все additive + tested + genre-neutral. Crime — оракул на каждом шаге.**

## Контент модуля (всё — регистрации, зеркало crime-justice)

Папка `packages/modules/src/economy/`: `index.ts` (хаб `registerEconomyModule(world)` + ре-экспорт `ECONOMY_CG_RULES`), `affordances.ts`,
`target-finders.ts`, `cg-rules.ts`, `step-handlers.ts` (+ module-scope `debtLedger` Map, прецедент crime `imprisonmentTimers`),
`event-handlers.ts`, `topic-sources.ts`, `pricing.ts` (аналог `heat.ts`), `shop.ts` (каталог + buy/bribe + IL trade verbs).
`registerEconomyModule(world)` вызывается рядом с `registerCrimeJusticeModule()` (`server/index.ts:43`); принимает `World`, чтобы хендлеры
замкнулись на `transferAttribute`/`transferItem` (их контексты не несут ссылку на World).

- **Affordances** (`AFFORDANCE_REGISTRY.push`, category `economic`, OCEAN+H веса для эмерджентности): `buy`, `sell`, `haggle`, `produce`,
  `hoard`, `lend`, `collect_debt`, `smuggle`. Жадность = low-H/low-A; отчаяние = scorer на debt/hunger. `registerActionVerbs` для всех 8 (INV-10).
- **События** (категории + флаги INV-08 + labels): economy[`TRADE_COMPLETED`,`FRAUD`,`PRICE_GOUGING`], market[`PRICE_SPIKE`,`SHORTAGE`,
  `SURPLUS`,`PRICE_FAVORABLE`], credit[`DEBT_OWED`,`DEBT_DEFAULT`,`LOAN_GRANTED`]. transferable: FRAUD/PRICE_GOUGING/DEBT_DEFAULT.
  (Crime сейчас владеет `DEBT_PRESSURE` — экономика забирает владение.)
- **Beliefs/источники** (INV-09): источники `transaction_record`/`ledger`/`market_observation`/`merchant_gossip` + decay/transfer-weights/labels;
  `registerBeliefPhrasing` FRAUD/PRICE_GOUGING → cheated/overcharged/gouged; пары `registerBeliefCreator`+`registerMemoryTextBuilder`.
- **Scoring contributor** (центральная проводка): `registerScoringContributor((aff,agent)=> aff.category==='economic' ? f(attrs):0)`:
  smuggle/buy = debt×0.5 + hunger×0.4; hoard = debt×0.3 (точная механика `attributes.test.ts:218-235`).
- **Ценообразование (на E1-drift):** `price:KIND` `ScalarAttribute` на синтетическом market-агенте; движок дрейфует base через `driftAttribute`
  (E1), модуль задаёт ЗАКОН в `pricing.ts` (`heat.ts`-аналог): `registerTickPhaseHandler` (`gameMinute%60`, INV-19) пересчитывает `drift.toward`/`rate`
  из supply(`Σ countItem`)+demand(buy-goals/hunger); supply<порога → `SHORTAGE`. Clamp/демпфирование против расхождения.
- **Потребности (на E1-drift):** `hunger` `ScalarAttribute` с `drift` (растёт сам, движок применяет); еда = `removeItems(food,1)`+
  `adjustAttributeBase(hunger,-1)`; scorer вплетает hunger в утилиту buy. INV-16 bilateral. Полноценный Need-registry отложен.
- **Долг (на E2-overdraft):** `offer_loan` = `transferAttribute(gold, {allowOverdraft})` — золото должника уходит в минус (или отдельный
  `debt`-скаляр); проценты/дедлайны через `registerDayAdvanceHandler` + module-scope `debtLedger` (reconstructed-from-events, прецедент crime
  `imprisonmentTimers`); процент = `addAttributeModifier` category `interest`; пропуск дедлайна → `DEBT_DEFAULT`. First-class contract отложен.
- **Step handlers**: `buy_goods`/`sell_goods`/`haggle_with`/`craft_goods`/`offer_loan`/`demand_payment`/`collect_payment`. NPC↔NPC перенос
  товара через engine inventory API (прецедент crime `steal_from`); золото через замкнутый `world.transferAttribute`/`transferItem`. `haggle_with`
  опц. `classify('price_negotiation')` (façade оборачивает acquire/release, INV-01).
- **Mood/goals/topics/ticks/handlers**: `registerEventMoodShifts`/`registerGoalMoodBoost`; топики trade/price/debt-gossip; tick-фазы price-drift/
  need-decay/interest/restock; event-handlers TRADE_COMPLETED→trust+, FRAUD→sentiment−+spread, DEBT_DEFAULT→grudge (INV-18 `adjust*`, не прямая мутация).

## Композиция с crime (три genre-нейтральных шва, без import между модулями)
1. **Общие World-примитивы ценности** — кража/контрабанда двигают РЕАЛЬНЫЙ inventory+gold.
2. **Общая шина beliefs/gossip** — FRAUD расходится как crime-слух.
3. **Общая шина CG-каскадов** — кросс-модульные правила, чей триггер = экономическое событие, а следствие = crime-мотив. Сервер мёржит
   массивы: `[...CRIME_CG_RULES, ...ECONOMY_CG_RULES]`. Примеры: `SHORTAGE`+hunger>0.6 → `DEBT_PRESSURE`; `GOODS_STOLEN`+faction `merchant-guild`+
   `isMerchant` → `GUILD_ALARM` (экономика реагирует на crime-событие, ноль общего кода); `DEBT_DEFAULT` → `PERSONAL_GRUDGE`.

## Эмерджентные сценарии + метрики успеха
**Сценарии:** ценовые войны (демпинг → resentment), хординг перед дефицитом, долговые спирали (заём → процент → дефолт → grudge/преступление),
контрабандные кольца при дефиците, мошенничество с расходящимся слухом, «голод → кража еды».
**Метрики «экономика работает»:** (1) цены реально двигаются от supply/demand; (2) NPC принимают экономические решения (buy/sell/hoard/lend
видны в логах volition, не скриптованы); (3) дефицит возникает органически; (4) долг/процент/дефолт проходят полный цикл; (5) crime-флоу не
деградировал (оракул зелёный); (6) `architecture.test.ts` TRADE_PROSE guard зелёный (движок не знает «trade»).

## Фазовый план (regression-safe: универсальные примитивы — первыми, контент — вторым)
- **P0 (E3)** — `INTENT_KIND` registry + чистка `trade`-утечки: обобщить `TradeIntent` в `registerIntentKind`, вынести `shop`/`ShopItem` в
  модульные данные, добавить `TRADE_PROSE` guard в `architecture.test.ts`. Engine genre-neutral по торговле. Crime-тесты зелёные.
- **P1 (E1+E2)** — движковые примитивы: `ScalarAttribute.drift` + `driftAttribute()` в tick-цикле; signed/overdraft transfer + `min<0`.
  Additive, tested в `attributes.test.ts` в изоляции (drift линейный/экспоненциальный/clamp/NaN; overdraft conservation/min-bound). Crime зелёный.
- **P2** — минимальный скелет модуля: `registerEconomyModule` + `ECONOMY_CG_RULES`, мёрж на сервере; тест boot + neutrality.
- **P3** — торговые affordances (buy/sell/haggle/…) + scoring contributor → NPC принимают экономические решения. **Чекпоинт: экономика «оживает».**
- **P4** — динамическое ценообразование + потребности (на **E1 drift**: `price:KIND`/`hunger` дрейфуют движком, module задаёт закон в `pricing.ts`).
- **P5** — долг/кредит (на **E2 overdraft**: отрицательное золото ИЛИ contract-инструмент) + кросс-модульный CG (debt → crime).
- **P6** — рынки-как-venues + контрабанда/мошеннические кольца + verify & close (аудитор, ROADMAP/ARCHITECTURE, закрыть спеку).

## Инварианты под особым вниманием
INV-14 (движок genre-neutral — после P0 + TRADE_PROSE guard), INV-08 (event flags обязательны), INV-09 (belief sources), INV-10 (action verbs),
INV-01 (LLM-семафор через façade при `classify` в haggle), INV-06 (mood только через addModifier), INV-16 (isPlayer-aware tick), INV-18
(adjust* не прямая мутация), INV-19 (абсолютный gameMinute в тиках).

## Риски
- **Border-первым:** добавить экономический контент ДО P0-чистки = усугубить утечку. Строго P0 первым.
- **Crime — оракул:** экономика только добавляет регистрации; никаких правок crime-данных. Прогонять crime-флоу после каждой фазы.
- **Ценовая стабильность:** дрейф цены может расходиться (осцилляции/уход в 0/∞) — нужны clamp (min/max атрибута) + демпфирование в `computePrice`.
- **debtLedger:** module-scope Map должна переживать перезапуск (reconstructed-from-events, как crime `imprisonmentTimers`), иначе долги теряются.

## Известные UX-баги фронта (найдены в живом тесте P3) — ✅ ВСЕ ИСПРАВЛЕНЫ в P6a (tsc 0, 299 тестов)
> 1 → `renderNpcEcon` скрывает золото/инвентарь NPC (`game.js`); 2 → постоянный `hud-inventory` в HUD (`game.html`/`game.js`);
> 3 → убрана инжекция `conversation:line` в чат игрока (`game.js`) + guard `inPlayerChat` в `scheduler.findPair` (`scheduler.ts`);
> 4 → маршруты `/api/shop/:id` и `/buy` используют динамический `getPrice(merchant, kind)` (`routes.ts`).

Бэкенд сделки корректен (проверено: золото игрока 100→77 на 2 покупки, перевод atomic+conserved). Проблемы — в
игровом клиенте `game.js`/`game.html` (наследие M5, не регрессии P3):
1. **Магазин показывает игроку баланс торговца** — убрать (это не инфа игрока; баланс торговца меняется на бэке, но
   показывать его игроку не нужно). `game.js`/`game.html` shop-панель.
2. **Нет панели инвентаря игрока** — данные есть (`/api/player.inventory` + ответ покупки `playerInventory`), но в UI
   не отображаются. Добавить HUD-панель инвентаря. `game.js`/`game.html`.
3. **Реплики NPC↔NPC протекают в чат игрока** — когда игрок говорит с NPC, а тот в этот момент автономно ведёт
   NPC↔NPC разговор (напр. Mark пошёл `argue` с Бесс), чужие реплики появляются в окне чата игрока. Фикс: фильтровать
   `conversation:line` по текущему собеседнику в `game.js`; + не вовлекать `in_player_chat` NPC в авто-разговоры (бэк).
4. **Магазин игрока использует статичные цены** (P4) — маршрут `/api/shop/:m/buy/:item` (`routes.ts`) берёт цену из
   статичного `profile.shop`, а не из динамического `price:KIND` (E1). Поэтому динамика цен сейчас видна только в
   NPC↔NPC-сделках. Фикс в P6: маршрут покупки игрока должен читать `getPrice(merchant, kind)` (модульная функция).

## Финальный аудит (clwa-auditor, P6)
**Verdict: READY FOR MERGE — 0 MUST-FIX, INV-14 PERFECT** (0 economy-строк в движке). Качество B+.
- **SHOULD-FIX #1 ✅ исправлено**: добавлен `registerBeliefPhrasing` для FRAUD/SMUGGLING/DEBT_PRESSURE (gossipable события рендерились generic-фоллбэком crime-модуля).
- **SHOULD-FIX #2 → осознанный uniform-deferral**: trade step-handlers (buy/sell/defraud) делают `transferAttribute` до `removeItems` — теоретический «оплачено без товара» при гонке. В single-threaded async между check и transfer нет yield-points, поэтому гонка не возникает; паттерн единообразен для всех трёх (без двойных стандартов). Полноценный транзакционный trade-step (remove+transfer+add с откатом) отложен.
- NICE (отложено): `atMarket` substring-match (ок для одной market-локации); `inShortage` Set не переживает save/load (безвредный дубль-SHORTAGE, +0.2 hunger с клампом).

## Отложено (deferred)
First-class Need registry (v1 = `hunger` скаляр поверх E1-drift — отдельный реестр Need вводим при втором потребителе); first-class
debt/contract object (v1 = E2-overdraft + module `debtLedger`); политика/интриги = M8 (садится на рыночный субстрат + E1/E2/E3).
**Три универсальных примитива E1/E2/E3 — НЕ отложены, строятся в P0–P1 (diamond-решение).**
