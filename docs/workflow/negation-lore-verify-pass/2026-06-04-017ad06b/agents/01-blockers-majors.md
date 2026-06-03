# Verify task: blockers-majors

## Verify-пасс: 13 файлов мира «Отрицание / Relict»

Короткий контроль факта применения 7 правок (2 blocker + 5 major) после diamond-пасса. Прочитаны все 13 файлов целиком + точечные grep-проверки. **Все 7 — PASS. Новых противоречий не найдено.**

### B1 — Modules.md §M-B: directed-разметка вызовов
**PASS.** §M-B (строки 25–31): «вызов Mara к раненому = подвес; вызов Orin = вскрыть правду; вызов Wren = заглушить (зона немоты)». Строка 28–29: «**Halden** directed-инструментом быть **не может** (Recluse-self, не наводится) — только пассивный «несокрушимый» расходник». Grep по «заглушить» в Modules.md даёт ровно одно вхождение — Wren; «Halden = заглушить» отсутствует. Согласовано с досье Halden §3 «Operational value: почти нулевая… изредка как «несокрушимый»».

### B2 — поле `negationType` убрано, класс деривируется, `form` = Set
**PASS.** Grep `negationType` по всему `docs/world` — **0 вхождений** (убрано везде). Класс деривируется из locus во всех точках:
- Terminology §7 (стр. 115): `effectLocus: "self"|"other"  // НЕСУЩЕЕ: класс ДЕРИВИРУЕТСЯ отсюда, не хранится строкой`; (стр. 116) `effectForm: Set<"ambient"|"directed">  // НАБОР (не enum): Orin = {ambient, directed}`.
- Modules «Что НЕ хардкодим» (стр. 42–43): «класс Recluse/Vector деривируется из locus, не хранится строкой».
- CONCEPT §6.4 (стр. 568–569): `locus … класс деривируется отсюда`; `form: Set<"ambient"|"directed"> … Orin = {ambient,directed}`.
- 5 досье ENGINE PROFILE: каждое несёт `effectLocus … класс ДЕРИВИРУЕТСЯ из locus` (Mara 144, Orin 154, Wren 134, Halden 144, Senna 158). Гибрид Orin выражен через `DIRECTED + AMBIENT` (стр. 159), в тексте «несёт обе формы».

### M3 — Wren §4: уличный ярлык в Vector-регистре
**PASS.** Wren §4 (стр. 113): «улица звала бы «**порченая**»/«**течь**» (Vector-регистр)». Grep «стоячая/стоячий» по файлу Wren — **0 вхождений**. Согласовано с Terminology §4 (Vector: «течь»/«порченые»; Recluse: «тихие»/«стоячие»). Контрольно: «стоячий» корректно остался у Halden §4 (стр. 123, Recluse) — то есть метки не перепутаны между классами.

### M4 — отстройка от Arknights
**PASS.** Блок в CONCEPT §5 «Отстройка от Arknights» (стр. 498–513) покрывает все 5 осей: Operations-контракт ≠ оператор RI; Quies ≠ Originium; фарма-фронт ≠ Rhodes Island; Contagion ≠ Oripathy; камерно ≠ гача-масштаб. Пункт в _Canon-Core «Чем НЕ являемся» расширен (стр. 50–53): перечислены Operations/Quies/фарма-фронт/«зараза»-метафора + «без расы-зверолюдей, континента наций, мировых войн. Камерно, не гача-масштаб». Термины Originium/Oripathy/Rhodes встречаются только в этих отстроечных блоках, в лор-текст не протекли.

### M5 — end-state «Удержание» привязан к глаголам
**PASS.** CONCEPT §4.5 (стр. 371–373): «**Механически** опирается на активные глаголы заботы/вовлечения (из 2.2: `sit_vigil` / `share_dose` / `use_name`; из петель: вмешаться, объяснить, разделить ношу) — каждый тянет дрейф OCEAN+H к центру, но платит». Design/Core Loop §4 (стр. 49–51): «Удержание — активный баланс по лезвию… Механически — на глаголах заботы/вовлечения (`sit_vigil` / `share_dose` / вмешаться / объяснить)». Оба места согласованы.

### Сводный контроль на новые противоречия
- Lore-файлы (_History, _The-Authority, _Relict-Culture) сверены: терминология Quies/DEROGAT единая, никаких остаточных `negationType`/`effectForm`-полей; Originium/Oripathy/Rhodes в лор-тексте нет.
- `_Relict-Culture` §71: «Quies не берёт DEFINIS-носителей (Mara/Halden)» согласовано с _Setting стр. 96 — конфликта нет.
- Гибрид формы Orin (Set) и гибрид класса игрока (§4.5) разведены явным NB (CONCEPT стр. 139–143) — модель не трещит.

Новых проблем не выявлено.

## Checks
- [pass] B1 — Modules §M-B: «вызов Wren = заглушить» есть; «Halden = заглушить» НЕТ; Halden помечен как не-directed (пассивный расходник) — Modules.md стр. 27 «вызов Wren = заглушить (зона немоты)»; стр. 28-29 «Halden directed-инструментом быть не может (Recluse-self, не наводится) — только пассивный «несокрушимый» расходник». Grep «заглушить» → 1 вхождение (Wren), «Halden=заглушить» отсутствует.
- [pass] B2 — поле negationType убрано везде; класс деривируется из effectLocus; form = Set (вмещает Orin-гибрид) в CONCEPT §6.4 и Terminology §7 — Grep negationType по docs/world → 0 вхождений. Terminology §7 стр.115-116: effectLocus «класс ДЕРИВИРУЕТСЯ», effectForm: Set<…> Orin={ambient,directed}. CONCEPT §6.4 стр.568-569 идентично. Modules стр.42-43 «класс деривируется из locus». Все 5 досье ENGINE PROFILE несут effectLocus с деривацией (Mara144/Orin154/Wren134/Halden144/Senna158).
- [pass] M3 — Wren §4: уличный ярлык в Vector-регистре («порченая»/«течь»), НЕ «стоячая» — Wren §4 стр.113 «улица звала бы «порченая»/«течь» (Vector-регистр)». Grep «стоячая/стоячий» по файлу Wren → 0. «Стоячий» корректно остался у Halden §4 стр.123 (Recluse).
- [pass] M4 — отстройка от Arknights: блок в CONCEPT §5 (Operations/Quies/фарма-фронт/contagion/масштаб) + расширенный пункт в _Canon-Core «Чем НЕ являемся» — CONCEPT §5 стр.498-513 «Отстройка от Arknights» — все 5 осей (Operations≠RI, Quies≠Originium, фарма-фронт≠Rhodes, Contagion≠Oripathy, камерно≠гача). _Canon-Core стр.50-53 пункт расширен теми же осями + «без расы-зверолюдей, континента наций, мировых войн. Камерно, не гача-масштаб».
- [pass] M5 — end-state «Удержание» привязан к конкретным глаголам (sit_vigil/share_dose/use_name/вмешаться) в CONCEPT §4.5 И Design/Core Loop — CONCEPT §4.5 стр.371-373: «Механически опирается на активные глаголы… (sit_vigil / share_dose / use_name; … вмешаться, объяснить, разделить ношу)». Core Loop §4 стр.49-51: «на глаголах заботы/вовлечения (sit_vigil / share_dose / вмешаться / объяснить)». Оба согласованы.

## New issues
(нет)

