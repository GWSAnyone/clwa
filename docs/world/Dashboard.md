# The Object — World Dashboard

> Индекс мира **Отрицание / Relict** (рабочее имя). Старый мир Millhaven →
> `docs/_archive/millhaven-world/`. Фаза брейншторма.

## Старт здесь
- [[_Canon-Core]] — **стартовые данные + страж масштаба** (тонкая макро-рамка; сверять новое)

## Концепт (основа)
- [[CONCEPT_Negation]] — ядро: классы, чувство закона, лестница модулей, луп, кристаллизация, каст, DEROGAT
- [[CONCEPT_Negation_Terminology]] — Recluse / Vector / Relict, три словаря, designation

## Мир
- [[Lore/_World]] — in-fiction праймер: Правила, Отрицание, Объекты, что снаружи
- [[Lore/_Setting]] — сеттинг: регистр, фарма-фронт, общество, контракты, **DEROGAT**
- [[Lore/_History]] — глубокое время: 3 эпохи, прибор как артефакт, потолок понимания
- [[Lore/_The-Authority]] — безликая инстанция: фарма-фасад + невидимая верхушка
- [[Lore/_Discovery-Capture]] — обнаружение→захват: дорога в Объект, протоколы, Quies, Relict-охотники
- [[Lore/_Relict-Culture]] — культура крыла: ровность, имя↔номер, этикет ладони, сленг, вживание новичка
- [[Locations/_Object-Layout]] — планировка Объекта (протокол = геометрия)
- [[Tensions/_Tensions]] — pressure points (T-01…T-08)
- *измерение интенсивности → CONCEPT §6.6 (DEROGAT); метасюжет → spoiler-файл*

## Дизайн (под Объект)
- [[Design/Core Loop]] — induction → trigger → 3 петли → кристаллизация
- [[Design/Modules]] — лестница M-A Containment / M-B Operations / M-C Research
- [[Design/Randomization]] — реролл каста + кристаллизация игрока (не seed)

## Каст

> Класс = порванная связь → locus (self→Recluse / other→Vector). Форма (ambient/directed)
> ортогональна. Каталог `R-[R|V]-NN`; первое (до классов) = R-0 (DEESSE, спойлер).

| Файл | Класс | Designation | Закон (locus) | Роль |
|------|-------|-------------|---------------|------|
| [[Relicts/RELICT_R-V-01_Mara]] | Vector | DEFINIS | завершение — чужое | подвешивает чужой исход |
| [[Relicts/RELICT_R-V-02_Orin]] | Vector | DELATERE | сокрытие — чужое | вскрывает чужие секреты |
| [[Relicts/RELICT_R-V-03_Wren]] | Vector | DESONUS | звук — чужое | зона немоты |
| [[Relicts/RELICT_R-R-01_Halden]] | Recluse | DEFINIS | завершение — своё | сам не может завершиться |
| [[Relicts/RELICT_R-R-02_Senna]] | Recluse | DESEPARE | отдельность — своя | растворяется в других |

### Staff (обслуга — без Отрицаний)
| Файл | Роль | Стойка |
|------|------|--------|
| [[Staff/STAFF_S-01_Instructor]] | инструктор-надзиратель (Brevik) | «содержание = милосердие» |
| [[Staff/STAFF_S-02_Dispatcher]] | диспетчер операций (Illa) | «активы, тратить с умом» |

### Игрок
Работник → Relict, кристаллизуется по ходу (CONCEPT §4.5). Среди готовых — единственный
в активной фазе.

## Открытые вопросы (актуальные)
- Имя мира (рабочее «Отрицание» / «Relict»).
- Расширить пулы триггер-template «Первой смены» (CONCEPT §4.7).
- Полигоны зон Объекта под изометрию; нужны ли per-room файлы.
- Перенос на движок (world-данные `worlds/<object>/`, модули) — отдельный майлстоун, вне `docs/world`.
- Старьё вне `docs/world` под старый мир: `docs/GDD_DETECTIVE.md`, `docs/VISION.md` — обновить/заархивировать отдельно.

## Структура папки
```
docs/world/
  CONCEPT_Negation.md            — несущий концепт
  CONCEPT_Negation_Terminology.md
  Dashboard.md                   — этот файл
  Lore/_World.md                 — in-fiction праймер
  Locations/_Object-Layout.md    — планировка
  Tensions/_Tensions.md          — pressure points
  Relicts/RELICT_R-00X_*.md      — досье обитателей
  Staff/STAFF_S-0X_*.md          — досье обслуги
```
