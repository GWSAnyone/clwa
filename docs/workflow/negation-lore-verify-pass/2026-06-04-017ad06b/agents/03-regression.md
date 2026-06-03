# Verify task: regression

## Verify-пасс: 13 правок diamond-пасса (мир «Отрицание / Relict»)

**Вердикт: ЧИСТО.** Адверсариальная сверка не выявила НОВЫХ противоречий. Все 13 файлов прочитаны полностью; кросс-чек подтверждён двумя грепами (negationType, глаголы удержания) и тремя целевыми (Orin-гибрид, locus/form, AK-блок, масштаб/вики-ссылки). Один nit (не блокер).

### (1) Удаление `negationType` — ПОЛНОЕ
Греп `negationType|negationDirection|negation_type` по всему `docs/world` → **0 совпадений**. Везде locus-производный класс: все 5 досье несут `effectLocus: "self"|"other"` с комментарием «класс ДЕРИВИРУЕТСЯ из locus, не хранится строкой (INV-14)» (Mara/Orin/Wren=other→Vector; Halden/Senna=self→Recluse). Form-набор согласован: Terminology §7 и CONCEPT §6.4 оба несут `Set<"ambient"|"directed">` (НАБОР, не enum). Осиротевших ссылок нет.

### (2) AK-блок (§5) vs UU-блок и канон — СОГЛАСОВАН
- **Quies**: §5 «не источник и не лекарство, belief-заглушка-поводок» = _Canon-Core «глушит belief-компоненту, не рану» = _Setting «дельта-блокатор». DEFINIS-исключение (Quies не берёт Mara/Halden) согласовано _Relict-Culture §2 ↔ _Setting.
- **Operations**: §5 «охота на своих за условия, никогда не свободу» = _Canon-Core = _Setting.
- **Contagion**: §5 «метафора, ничего не передаётся, не Oripathy» = Terminology §2 NB = _Canon-Core. Спойлерная «заразность сомнения» (_Metaplot, writer-only) — иной метафизический слой, не противоречит player-facing «contagion ≠ буквальная болезнь-вещество».

### (3) Orin-гибрид формы — СОГЛАСОВАН ВЕЗДЕ (8 точек)
CONCEPT §2 (стр.100-101, NB 139-142), §6.2 (542), §6.4 (569,574), §9 (765); Terminology §2 (51), §7 (116); досье Orin (TL;DR, NB 41-45, ENGINE PROFILE 158-163: DIRECTED+AMBIENT, controlCost=гибрид). Нигде нет «Orin=directed» без оговорки гибрида. Гибрид формы корректно отделён от гибрида класса (игрок-апекс §4.5).

### (4) Глаголы удержания — РЕАЛЬНО СУЩЕСТВУЮТ в Hooks 2.2
`_Relict-Culture` `social_affordances` (стр.250-256) определяет: `show_wrist`, `read_wrist`, `use_name`, `use_designation`, `offer_dose / share_dose / refuse_dose`, `sit_vigil`, `close_number`. Ссылки из CONCEPT §4.5 (`sit_vigil`/`share_dose`/`use_name`) и Core Loop §4 (`sit_vigil`/`share_dose`) указывают на существующие глаголы. Досье Senna ссылается на `sit_vigil` корректно. Висячих глаголов нет.

### (5) Масштаб-оговорки и вики-ссылки — ЦЕЛЫ
«Один Объект, ~8 агентов» (5 Relict + 2 staff + игрок) идентичен в CONCEPT §1/§4/§5/§9 и _Canon-Core. «Сеть Объектов» всегда с оговоркой «намёк-горизонт, не атлас» (_The-Authority, _History, _Relict-Culture). Регистр-правки не сломали `[[...]]`-ссылки. Расширения в Терру-масштаб нет.

### Nit (не блокер)
Досье Mara, ENGINE PROFILE стр.158: NB «Directed-Vector — см. R-V-02 (Orin)». Orin — гибрид (ambient+directed), реально несёт directed-компонент, поэтому ссылка как «пример directed-формы» фактически верна, но формулировка «Directed-Vector» чуть упрощает (Orin — не чистый directed, а гибрид). Смысла/канона не ломает; точнее было бы «directed-несущий — см. Orin (гибрид формы)». Старая refuted-проблема НЕ переоткрывается — это микро-формулировка в перекрёстной ссылке.

## Checks
- [pass] (1) negationType удалён, досье/Terminology §7/§6.4 на locus-деривации + form-набор, нет осиротевших ссылок — Греп negationType|negationDirection → 0 совпадений во всём docs/world. Все 5 досье: effectLocus self/other + 'класс ДЕРИВИРУЕТСЯ из locus'. Terminology §7 (стр.115-116) и CONCEPT §6.4 (стр.568-569) оба: effectLocus self|other, effectForm Set<ambient|directed>.
- [pass] (2) AK-блок §5 не противоречит UU-блоку и канону (Quies/Operations/contagion) — §5 стр.501-512 ↔ _Canon-Core стр.49-52 ↔ _Setting/Terminology §2 NB: Quies=belief-поводок-не-Originium, Operations=охота-на-своих, contagion=метафора-не-Oripathy — формулировки совпадают. Спойлерная 'заразность сомнения' — иной writer-only слой, не конфликт.
- [pass] (3) Orin-гибрид согласован везде (CONCEPT §2/§6.2/§6.4/§9, Terminology, досье Orin) — 8 точек: CONCEPT стр.100-101/139-142/542/569/574/765, Terminology стр.51/116, досье Orin TL;DR+NB(41-45)+ENGINE PROFILE(158-163, DIRECTED+AMBIENT). Нет 'Orin=directed' без оговорки гибрида. Гибрид формы ≠ гибрид класса явно разделены.
- [pass] (4) Глаголы удержания sit_vigil/share_dose/use_name существуют в Hooks 2.2 (_Relict-Culture) — _Relict-Culture social_affordances стр.250-256: show_wrist, read_wrist, use_name, offer_dose/share_dose/refuse_dose, sit_vigil, close_number. Ссылки CONCEPT §4.5 (стр.371) и Core Loop §4 (стр.50) указывают на реально определённые глаголы.
- [pass] (5) Масштаб-оговорки и регистр-правки не сломали смысл/вики-ссылки — 'Один Объект ~8 агентов' идентичен в CONCEPT §1/§4/§5/§9 + _Canon-Core. 'Сеть Объектов' всегда с 'намёк-горизонт, не атлас' (_The-Authority стр.32, _History стр.65, _Relict-Culture стр.34). [[...]]-ссылки в _Relict-Culture (frontmatter+Related) целы.

## New issues
(нет)

