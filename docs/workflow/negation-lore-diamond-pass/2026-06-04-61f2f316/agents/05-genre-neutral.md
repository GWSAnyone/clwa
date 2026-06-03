# Линза: genre-neutral

## Ревью: линза INV-14 / genre-neutral (движок не знает мира)

**Вердикт: near-diamond подтверждается.** Слой имплементационной готовности проработан дисциплинированно — в подавляющем большинстве мест граница «диегетический лор ↔ genre-neutral движок» держится строго и осознанно. Нашёл **одну реальную сквозную несостыковку (major)**, **один пробел широты примитива (minor)** и **один косметический nit вне ядра линзы**. Ни одного blocker.

### Что проверено и ЧИСТО (эталонные места)

- **Hooks-ключи нового слоя 2.2 `_Relict-Culture` (строки 243–281)** — образцово. `social_affordances` (`show_wrist` / `read_wrist` / `use_name` / `use_designation` / `offer_dose` / `sit_vigil` / `close_number`), `belief_tags` (`subject_known_by` / `subject_state` / `subject_is_walker` / `subject_in_window`), `relationship_modifiers`, `triggers` (IF…THEN на английском) — все ключи английские и genre-neutral. Лор заходит **только как значения/комментарии** («ровный», Quies, Senna, DESEPARE). Это ровно та слоистость, что требует GUIDE §8 («ключи английские, без лор-строк»). Самый тяжёлый по весу файл — и он держит линзу лучше всех.
- **Staff `Agent data` (Brevik §5, Illa §5)** — `negation: none // NO negation fields`, `role:"instructor" // display only; behavior via capability flags`, `vocabulary:"system" // content`. Прямое и корректное применение INV-14 + принципа «role = display only» из CLAUDE.md. Staff не вводят ни одного negation-поля.
- **DEROGAT-движок (CONCEPT §6.6)** — `deviationDepth: scalar`, `watchedLaw: string`, `readout`, `reliabilityFalloff`; явная оговорка «Прибор / имена / „палки“ / эталон — контент. Движок знает скаляр + watchedLaw + readout». Чисто.
- **`_Object-Layout`** — «зоны с полигонами + connections + co-location (`getCoPresent`) — тот же примитив, что у Millhaven-локаций. Designation/имена — контент (INV-14)». Переиспользование существующего примитива, без утечки.
- **designation / каталог-номер (DEFINIS, R-V-01)** — везде помечены как контент-строка, не идентификатор движка. В `aliases` фронтматтера это Obsidian-метаданные (контент), не движок.
- **Широта примитива (CONCEPT §6.4)** спроектирована хорошо: `blockedOutcomeClass: string` открыт; «агент A меняет множество возможных исходов у X (self/other/zone)»; ось `scaling` отделена от `form`; зарезервирован «зазор» формы под гибрид. Это правильный genre-neutral каркас.

### Где линза проседает

**1. (major) `negationType: "recluse" | "vector"` — лор-класс протёк в схему движка как enum-литерал.**
Это сквозная несостыковка между двумя версиями движковой схемы, живущими в волте:
- **CONCEPT §6.4** (эталон) даёт `NegationEffect` БЕЗ поля `negationType`: `locus: "self" | "other"`. Класс **выводится** из locus — слова recluse/vector в струкуре нет.
- **CONCEPT_Negation_Terminology §7** и **все 5 досье** (блоки «Negation as data») вводят `negationType: "recluse" | "vector"` как самостоятельное движковое поле — **рядом** с `effectLocus:"self"|"other"`.

Противоречие буквальное: тот же §7 двумя строками ниже пишет «движок не знает слов «Recluse»/«Relict»/«DEFINIS»», а enum-литерал `"recluse"` — это и есть слово «recluse» внутри движка. Поле вдобавок избыточно: его собственный комментарий гласит `// класс = порванная связь → locus`, т.е. класс *тождествен* locus'у (CONCEPT §2 «связь → locus»), а значит полностью деривируется из `effectLocus`. Genre-neutral форма уже существует в §6.4 — её и надо канонизировать; «recluse»/«vector» — контент-ярлык над `self`/`other`, не enum движка. Echo той же ошибки — в `Design/Modules.md` («Движок видит только negationType/negatedLaw из реестров»).
Почему не blocker: фаза brainstorm, корректная форма (§6.4) уже сосуществует — нужно сверить канон схемы до кода, не переписывать движок.

**2. (minor) Примитив `form` как одиночный enum не вмещает документированный гибрид.**
§6.4: `form: "ambient" | "directed"`; §7: `effectForm: "ambient" | "directed"` — оба single-value. Но канон вводит **гибрид формы** как реальное (редкое) явление, и витринный персонаж Orin (R-V-02, «самый играбельный в Containment») в досье несёт `effect: … DIRECTED + AMBIENT` и `control_cost: гибрид — ambient baseline + directed-наводка`. Одиночный enum физически не может представить Orin'а → инстанцирование требует патча схемы (то самое «переписывание», которого GUIDE §8 / CONCEPT обещают избежать). Лечится тривиально: `form` как набор/флаги (ambient И directed) или третий литерал `hybrid`.

**3. (nit, вне ядра линзы) Расхождение контент-строки уличного ярлыка.**
Orin §4 (стр. 130): `"Vector R-V-02 / porohenniy"`; Brevik §4 (стр. 96): `"porchenniy"`. Это транслитерация русского «порченый» в худтексте — контент-строка, не движковый идентификатор, поэтому строго вне линзы genre-neutrality. Помечаю только потому, что это per-NPC vocabulary-значение, которое могло бы стать ключом словаря NPC; пока — просто несогласованная орфография локализации.

### Итог по линзе
Лор-термины (Recluse/Vector/Relict/DEESSE/designation/номер) как **контент-строки** разведены с движком практически везде и с явными INV-14-пометками. Единственная настоящая утечка идентификатора — поле `negationType` с лор-литералами, противоречащее собственному genre-neutral эталону §6.4. Примитивы спроектированы достаточно широко, кроме `form` (не покрывает канонический гибрид). Hooks-ключи 2.2 — английские и genre-neutral.

---
## Findings + вердикты верификации

### [major] genre-neutral-1
- file: docs/world/CONCEPT_Negation_Terminology.md (+ все 5 досье RELICT_R-*, + docs/world/Design/Modules.md)
- rubric: INV-14 / genre-neutral: лор-термин не должен течь в движок как идентификатор (должен быть контент-строкой)
- claim: Поле движковой схемы `negationType: "recluse" | "vector"` использует лор-классы Recluse/Vector как enum-литералы движка — это утечка лор-слова в идентификатор, прямо противоречащая эталонной genre-neutral форме CONCEPT §6.4 (где класс не поле, а деривация из locus) и INV-14-оговорке, которую тот же файл несёт двумя строками ниже.
- evidence: CONCEPT_Negation_Terminology.md §7 «Схема данных (для движка, genre-neutral)», стр. 113: `negationType: "recluse" | "vector"  // класс = порванная связь → locus`; стр. 117-119: «движок не знает слов «Recluse»/«Relict»/«DEFINIS»». Ср. эталон CONCEPT_Negation.md §6.4, стр. 546: `locus: "self" | "other"` (поля negationType НЕТ). Повтор в каждом досье, напр. RELICT_R-V-01_Mara.md §5 стр. 144 `negationType:  "vector"`; echo в Design/Modules.md стр. 39 «Движок видит только negationType/negatedLaw из реестров».
- suggestedFix: Канонизировать genre-neutral форму §6.4: движок несёт `locus: "self"|"other"` (+ form/scaling/blockedOutcomeClass); убрать `negationType` как движковое поле. «Recluse»/«Vector» — деривированный контент-ярлык над self/other (локализация/словари NPC), не enum движка. Поправить §7, 5 досье и строку Modules.md, чтобы schema-канон был единым.
- **verdict: confirmed (high)** — Попытка опровергнуть провалилась — самопротиворечие реально и дословно. В CONCEPT_Negation_Terminology.md §7 (стр. 110) движковое поле объявлено как `negationType: "recluse" | "vector"`, причём значения-литералы `recluse`/`vector` дословно совпадают с лор-классами из §2 («Recluse / Vector») и глоссария §8. Двумя-тремя строками ниже та же секция (стр. 117-119) декларирует обратное: «Лор-термины (Recluse / Vector / Relict / designation …) — контент-данные … INV-14: движок не знает слов «Recluse»/«Relict»/«DEFINIS»». Это прямое внутрисекционное противоречие.

Главный контр-аргумент защиты — оговорка стр. 107 «Технические имена в коде произвольны и не равны лор-терминам» — НЕ спасает: она про имена ПОЛЕЙ/ключей, а нарушены и имя (`negationType` отсылает к Negation), и ЗНАЧЕНИЯ-enum (`recluse`/`vector` — дословные лор-слова). Более того, в той же §7 уже есть отдельное поле `effectLocus: "self" | "other"` (стр. 112), которое по управляющему правилу §2 («Class — порванная связь → locus (self → Recluse / other → Vector)», Negation.md стр. 104-106) полностью несёт информацию о классе. Значит `negationType` ИЗБЫТОЧЕН — его единственная добавочная нагрузка это лор-слова, то есть чистая утечка.

Эталон подтверждён: Negation.md §6.4 (стр. 538-554) — самопомеченный «чистая спека из трёх осей» — несёт `NegationEffect { locus: "self"|"other"; form; scaling; control_cost; blockedOutcomeClass }`; поля `negationType` там НЕТ, класс деривируется из locus.

Тиражирование подтверждено в досье: RELICT_R-V-01_Mara.md §5 стр. 144 `negationType: "vector"` (при том что секция §5 стр. 127-128 сама объявляет «Vector/Relict/DEFINIS — контент-строки, НЕ идентификаторы движка (INV-14)» — то же противоречие). Эхо в Design/Modules.md стр. 38-40: «‘Recluse’, ‘Relict’ … — контент-строки (INV-14). Движок видит только negationType/negatedLaw из реестров» — строка кодифицирует проблемный термин `negationType` как движковый прямо рядом с декларацией INV-14.

Все три цитаты находки точны, severity major обоснован (внутренне противоречив центральный genre-neutral канон, размноженный по 7 местам). Опровергнуть не удалось.
- revisedFix: Канонизировать эталонную форму §6.4 (Negation.md) как единственную genre-neutral схему и убрать `negationType` как движковое поле везде:

1. CONCEPT_Negation_Terminology.md §7 (стр. 110): удалить строку `negationType: "recluse" | "vector"`. Класс не хранится — он ДЕРИВИРУЕТСЯ из `effectLocus` (которое уже есть в §7 стр. 112) по правилу §2 (self→Recluse / other→Vector). Привести набор полей в соответствие с §6.4: `locus`/`effectLocus: "self"|"other"`, `effectForm: "ambient"|"directed"`, `scaling`, `controlCost`, `blockedOutcomeClass`, `negatedLaw`. «Recluse»/«Vector» — деривированный контент-ярлык над self/other (локализация, словари NPC), не enum движка.

2. Все 5 досье RELICT_R-* (напр. Mara §5 стр. 144 `negationType: "vector"`): заменить блок «Negation as data» на форму §6.4 — вместо `negationType: "vector"` оставить `effectLocus: "other"` (+ form/scaling/control_cost/blockedOutcomeClass). Класс «Vector» оставить только в лорных секциях/шапке как контент.

3. Design/Modules.md стр. 38-40: переписать «Движок видит только negationType/negatedLaw из реестров» → «Движок видит только locus/negatedLaw (+ form/scaling/blockedOutcomeClass) из реестров» — убрать `negationType` из перечня движковых полей.

Итог: один schema-канон (§6.4) во всех 7 местах; ось «класс» нигде не несёт лор-слов как enum-литералы движка, INV-14 соблюдён без самопротиворечия.

### [minor] primitive-breadth-1
- file: docs/world/CONCEPT_Negation.md §6.4 (+ CONCEPT_Negation_Terminology.md §7; проявляется на RELICT_R-V-02_Orin.md)
- rubric: INV-14 / genre-neutral: примитивы (locus/form/scaling/outcome-space modifier) спроектированы достаточно широко, чтобы инстанцироваться без переписывания
- claim: Примитив `form` задан как одиночный enum `"ambient" | "directed"`, но канон вводит гибрид формы как реальное явление, и витринный Orin документирован как несущий ОБЕ формы — single-value enum физически не может его представить, что вынудит патчить схему (то самое «переписывание», которого слой обещает избежать).
- evidence: CONCEPT_Negation.md §6.4 стр. 547: `form: "ambient" | "directed"`; CONCEPT_Negation_Terminology.md §7 стр. 113-114 `effectForm: "ambient" | "directed"`. Против этого RELICT_R-V-02_Orin.md §5 стр. 158-162: `effect: outcome-space modifier — DIRECTED + AMBIENT (zone)` и `control_cost: гибрид — ambient baseline … + directed-наводка волевая`; CONCEPT §2 «Гибрид формы (… несёт обе): ambient-фон + волевую наводку — это Orin».
- suggestedFix: Расширить `form` до набора/флагов (можно ambient И directed одновременно) либо добавить третий литерал `hybrid`. Иначе единственный канонический гибрид-формы (Orin, «самый играбельный в Containment») не инстанцируется без правки ядра — нарушение цели «без переписывания» (GUIDE §8 / CONCEPT §6).
- **verdict: confirmed (high)** — Попытка опровергнуть провалилась — расхождение дословное и реальное, не перечитывание.

1) Формальная запись примитива — действительно single-value enum. CONCEPT_Negation.md §6.4 (стр. 546): `form: "ambient" | "directed"`; CONCEPT_Negation_Terminology.md §7 (стр. 113): `effectForm: "ambient" | "directed"`. Оба места хранят ровно ОДНО значение.

2) Канон вводит гибрид как РЕАЛЬНОЕ одновременное наличие обеих форм, а не выбор дефолта. CONCEPT §2 «Гибрид формы» (стр. 132-137): «Редко Отрицание выбивается из дефолта и несёт ОБЕ: ambient-фон + волевую наводку — это Orin (скрытое всплывает само рядом с ним И он может навестись на цель)». §2 (стр. 138-142) прямо: «гибрид формы (ambient+directed) ≠ гибрид класса … выход за чистую сетку = реально».

3) Витрина Orin инстанцирует обе формы одновременно. RELICT_R-V-02_Orin.md §5 (стр. 157): `effect: outcome-space modifier — DIRECTED + AMBIENT (zone)`; стр. 161-162: `control_cost: гибрид — ambient baseline … + directed-наводка волевая`; NB стр. 165: «Orin — редкий гибрид формы … ambient-фон … + directed-наводка». Single-value enum это представить физически не может → потребуется патч схемы.

Контраргументы отклонены: (а) «form — лишь дефолт-эвристика, гибрид = контент-слой» — нет, §2 трактует гибрид как механическое свойство примитива (двойная опасность поле+прицел), а контент-слоем в §7 явно названы только лор-термины (Recluse/designation/каталог-номер), не form; (б) «модель не трещит» (§2 стр. 129-130) относится к ортогональности form↔scaling, а не к мощности самого enum form; (в) то, что ось названа «зазором, оставленным сознательно» (§2 стр. 110, 132), работает ПРОТИВ формальной записи: концепт требует от оси выразить гибрид, а двухлитеральный enum его не кодирует.

Это и есть «переписывание», которого слой обещал избежать: CONCEPT §0 (стр. 6-7) «проектироваться достаточно широко, чтобы … без переписывания ядра»; §6.4 (стр. 561) «Проектировать широко». INV-14 (genre-neutral): примитив должен инстанцироваться без правки. Единственный канонический гибрид-формы (Orin, помеченный «самый играбельный в Containment») не инстанцируется без расширения ядра — заявленная цель нарушена. severity=minor корректен: документ брейншторм/«направление, не финал API», но внутреннее противоречие записи примитива самой цели слоя реально и его стоит зафиксировать сейчас, пока примитив не застыл.
- revisedFix: В обоих местах формальной записи примитива сделать `form` неупорядоченным набором (флагами), допускающим одновременно ambient И directed, а не одиночным enum. Конкретно: CONCEPT_Negation.md §6.4 (стр. 546) — заменить `form: "ambient" | "directed"` на `form: Set<"ambient" | "directed">` (или `{ ambient: bool, directed: bool }`), чистые случаи = одноэлементный набор, Orin = оба; CONCEPT_Negation_Terminology.md §7 (стр. 113) — то же для `effectForm`. Третий литерал `"hybrid"` НЕ предпочтителен: он скрывает, что гибрид = композиция тех же двух примитивных форм (control_cost тогда должен раскладываться на ambient-baseline + directed-наводку, как у Orin §5 стр. 161-162), и не масштабируется на возможные будущие выбивания оси. Набор/флаги сохраняют ортогональность осей и прямо отражают канонную формулу «несёт ОБЕ». Заодно дописать в §6.4 одной строкой, что `controlCost` для гибрида = объединение профилей (хронический ambient-вес + acute-Trauma за directed-применение), иначе сцепка-ограничение §2 для Orin не выводится из схемы.

### [nit] content-string-1
- file: docs/world/Relicts/RELICT_R-V-02_Orin.md (vs docs/world/Staff/STAFF_S-01_Instructor.md)
- rubric: INV-14 / genre-neutral: согласованность контент-строк (вне ядра линзы — это орфография локализации, не движковый идентификатор)
- claim: Уличный ярлык «порченый» транслитерирован по-разному в двух файлах; пока это худтекст, но как per-NPC vocabulary-значение несогласованная форма могла бы навредить, если строка станет ключом словаря NPC.
- evidence: RELICT_R-V-02_Orin.md §4 стр. 130: `staff log him "Vector R-V-02 / porohenniy"`; STAFF_S-01_Instructor.md §4 стр. 96: `a frightened resident says "porchenniy"`.
- suggestedFix: Привести к единой форме (напр. `porchenniy`) во всех файлах. Строго вне линзы genre-neutrality (контент-строка, не идентификатор движка) — фиксирую как nit для гигиены словарей NPC.
- **verdict: unverified (low)** — severity nit — не верифицировалось индивидуально
- revisedFix: 

