# SPEC-visual-briefs: Millhaven Location Visual Briefs

> **Purpose**: What to model in Blender for each location. Physical descriptions, key objects, materials, atmosphere, regional prompts.
> **Depends on**: SPEC-art-pipeline.md (pipeline params), world.json (coordinates), Location docs (narrative)
> **Style target**: Disco Elysium — painterly oil painting, melancholic, lived-in, weathered. NOT clean fantasy, NOT cartoon, NOT photorealistic.
> **Created**: 2026-04-14

---

## Millhaven — общая характеристика

**Frontier village**, 200+ лет. Основана поселенцами из восточных королевств. Суровые зимы, самообеспечение, ближайший город Valdris — неделя пути через горы с бандитами. 8 жителей, все знают всех.

**Визуальный язык:**
- **Камень + дерево** — фахверк (timber-frame), булыжник, штукатурка с трещинами
- **Потрёпанность** — всё старое, чиненное, заросшее мхом. Ничего нового или блестящего
- **Тёплые тона** — охра, умбра, приглушённый зелёный, тёмное дерево. Холодные — только камень и вода
- **Масштаб** — маленький. Здания 1-2 этажа. Улицы узкие. Ощущение тесноты и уюта
- **Время** — базовый рендер = поздний день (warm golden light). Варианты освещения позже

### Spatial Layout (из world.json)

```
                    NORTH
                      │
          Town Gate (320,-384)
          ┌─────────┐
          │  ворота  │
          └────┬─────┘
               │
   Market Sq ──┼── Town Square ────── Temple of Dawn
  (-352,-208)  │    (316,188)           (1141,128)
       │       │      │    \
       │   Blacksmith  │     Courthouse
       │  (-896,21)    │      (896,768)
       │               │
  Silver Flagon ───── Residential Lane
   (-486,422)          (192,800)

                    SOUTH
```

**Общая площадь**: ~2500×1400 game units. В изометрии это один большой Blender scene.

---

## Emission Mask Color Legend (из SPEC-art-pipeline)

| HEX | Тип | Базовый промпт |
|-----|-----|----------------|
| `#FF0000` | Здания | medieval stone and timber buildings, weathered walls, cracked plaster |
| `#00FF00` | Дороги/мостовые | wet cobblestone street, puddles, worn edges, scattered leaves |
| `#0000FF` | Растительность | old gnarled trees, overgrown ivy, wild grass patches |
| `#FFFF00` | Крыши | tiled rooftops, weathered shingles, chimney smoke |
| `#00FFFF` | Вода | murky water, dark reflections, floating debris |
| `#FF00FF` | Земля/грунт | muddy ground, trampled grass, cart wheel tracks |
| `#FF8000` | Двери/окна | dark aged wood, iron fittings, candlelight glow |
| `#808080` | Металл | wrought iron, rusty hinges, old lanterns |

**Per-location промпты** ниже дополняют базовые — добавляются через regional conditioning.

---

## 1. Town Square (hub)

### Роль
Центральный перекрёсток. 6 из 8 связей. Все проходят через. Максимальное количество свидетелей.

### Физическое описание
Неровная булыжная площадь, вытянутая с запада на восток. По периметру — фасады зданий (таверна, торговые ряды, начало улиц). В центре — **каменный колодец** с деревянной крышкой и верёвкой (колодец, не фонтан — это деревня, не город). Рядом — **доска объявлений** (столб с навесом, прибитые бумажки). Пара деревянных скамеек. Одно большое **старое дерево** (дуб или вяз) с узловатыми корнями, выпирающими из булыжника.

Площадь не плоская — лёгкий уклон к востоку, лужи скапливаются у колодца. Булыжник местами просел, из щелей растёт трава.

### Ключевые объекты для моделирования

| Объект | Blender-сложность | Заметки |
|--------|-------------------|---------|
| Булыжная мостовая | Plane + texture later | Неровная поверхность, не идеальная плитка |
| Каменный колодец | Medium | Круглый каменный, деревянная крышка, столб с верёвкой |
| Доска объявлений | Low | Столб + навес + плоскость для бумажек |
| Старое дерево | Medium | Толстый ствол, видимые корни, раскидистая крона |
| Скамейки (×2) | Low | Грубо сколоченные доски |
| Фонарный столб (×2-3) | Low | Кованый, с крючком для масляного фонаря |
| Бочка с дождевой водой | Low | У стены здания |
| Фасады зданий (по краям) | High | Видны только фронтальные стены — дают ощущение "площади" |
| Дороги/выходы (×5-6) | Low | Просветы между зданиями — проходы к другим локациям |

### Материалы
- **Мостовая**: серый камень, неровный
- **Колодец**: тёмный камень, мокрый
- **Дерево (постройки)**: тёмная древесина, потемневшая от времени
- **Дерево (живое)**: кора — тёмно-коричневый, крона — приглушённый зелёный
- **Металл**: ржавое железо (фонари, петли)

### Атмосфера
Сердце деревни, но не праздничное. Обжитая площадь, где камень отшлифован сотнями ног. Ощущение: "этому месту 200 лет и оно помнит каждый день". Тихий, мирный вид днём — но вечером тени от фонарей делают его тревожным.

### Regional Conditioning Prompts

| Зона | Positive | Negative |
|------|----------|----------|
| Мостовая | worn cobblestone square, uneven surface, grass in cracks, shallow puddles, oil painting, painterly brushstrokes | modern, clean, smooth, new, photographic |
| Здания (фасады) | medieval half-timbered facades, cracked plaster, timber beams, dark wood shutters, mossy corners, oil painting | modern, plastic, smooth walls, digital art |
| Дерево | ancient gnarled oak tree, thick trunk, exposed roots pushing through cobblestone, dark green canopy, oil painting | palm tree, birch, thin trunk, cherry blossom |
| Колодец | old stone well, dark wet stone, wooden cover, rope and bucket, moss on edges, painterly | fountain, marble, ornate, clean |
| Небо/фон | overcast sky, warm golden hour light, soft clouds, oil painting atmosphere | blue sky, clear, sunset, dramatic |

### Сложность: **HIGH** (много объектов, формирует визуальное ядро)
### Приоритет: **#1** — моделить первым

---

## 2. Silver Flagon Tavern (social)

### Роль
Социальное сердце. Все приходят вечером. Ted знает всё. Hilda's father died here.

### Физическое описание — экстерьер
Двухэтажное фахверковое здание. Первый этаж — каменный (булыжные стены), второй — дерево и штукатурка. Покатая **черепичная крыша** с дымовой трубой. Над входом — деревянная вывеска "Silver Flagon" (кружка эля, вырезанная из дерева). Дверь — толстое тёмное дерево, всегда приоткрыта. Два **окна** на первом этаже (тёплый свет изнутри), три на втором. Рядом — **коновязь** и пара бочек.

### Физическое описание — интерьер (PoC уже есть)
Барная стойка вдоль дальней стены. 4-5 круглых столов с табуретками. Лестница на второй этаж (жильё Ted). Полки с бутылками за баром. Деревянный пол, балки на потолке. Камин в углу (но **не зажжённый** — помним проблему с candles/fire в SD).

### Ключевые объекты

| Объект | Blender-сложность | Заметки |
|--------|-------------------|---------|
| Здание (2 этажа) | High | Фахверк, каменный низ, деревянный верх |
| Вывеска | Low | Доска на кронштейне, плоская |
| Дверь входная | Low | Толстые доски, железные петли |
| Окна (×5) | Low | Деревянные рамы, ставни |
| Коновязь | Low | Столб + перекладина |
| Бочки (×3-4) | Low | У стен снаружи |
| Бар (interior) | Medium | Уже есть в PoC |
| Столы + табуретки | Medium | Уже есть в PoC |
| Лестница | Medium | Уже есть в PoC |
| Камин | Low | Каменный, без огня |
| Полки с бутылками | Low | За баром |

### Атмосфера
Снаружи — крепкое, приземистое здание. Тёплый свет из окон. Чувство: "тут можно укрыться от мира". Внутри — тесно, но уютно. Дерево везде, запах эля впитался в стены. Ted разбавляет эль водой, но атмосфера настоящая.

### Regional Conditioning Prompts

| Зона | Positive |
|------|----------|
| Здание (экстерьер) | medieval tavern, half-timbered two-story building, stone ground floor, wooden upper floor, dark timber beams, cracked plaster, hanging wooden sign, warm light from windows, oil painting |
| Интерьер (стены) | dark wooden interior, timber ceiling beams, aged plaster walls, warm amber tone, oil painting, tavern atmosphere |
| Бар | wooden bar counter, bottles on shelves behind, worn surface, ale stains, oil painting |
| Мебель | rough wooden tables, three-legged stools, scratched surfaces, old wood, oil painting |
| Пол | dark wooden floorboards, worn and uneven, gaps between boards, old planks, oil painting |

### Сложность: **MEDIUM** (экстерьер + интерьер, но интерьер уже начат)
### Приоритет: **#2** — доработать экстерьер к существующему интерьеру

---

## 3. Market Square (commerce)

### Роль
Торговля. Mark и Bess тут днём. Основная сцена преступлений. Mark продаёт фальшивые специи.

### Физическое описание
Открытая площадка, меньше Town Square. Вымощена грубым булыжником, но часть — утоптанная земля. **Прилавки** — деревянные столы под навесами из парусины/холста на столбах. Навесы выцветшие, подлатанные. Ящики, мешки, корзины с товарами. У Mark — стол с мешочками специй и сушёными травами. У Bess — стол с пузырьками, пучками трав, карты таро (плоскость с текстурой).

По краю — **тележка** (деревянная, с одним колесом выше другого — покосилась). Пара деревянных ящиков штабелем. **Весы** на прилавке (простые рычажные).

### Ключевые объекты

| Объект | Blender-сложность | Заметки |
|--------|-------------------|---------|
| Прилавки (×3-4) | Medium | Столы + столбы + навесы из ткани |
| Навесы (ткань) | Medium | Planes с провисанием (cloth sim или manual) |
| Мешки, корзины | Low | Scatter props |
| Тележка | Medium | Деревянная, два колеса, покосившаяся |
| Весы | Low | На прилавке |
| Ящики штабелем | Low | 3-4 ящика, сложенные криво |
| Бочки | Low | 2-3 штуки |
| Фасады прилегающих зданий | Medium | Фон |

### Атмосфера
Суета (даже если пустая — видно что тут торгуют). Пыльно, разноцветно (ткани, специи). Но при этом скромно — это не восточный базар, а деревенский рынок. 3-4 прилавка максимум. Ощущение: "тут пахнет сухими травами и старым деревом".

### Regional Conditioning Prompts

| Зона | Positive |
|------|----------|
| Прилавки + навесы | medieval market stalls, faded canvas awnings on wooden poles, rough wooden tables, bags of spices and herbs, oil painting, painterly |
| Земля | packed dirt and cobblestone, muddy patches, cart tracks, scattered straw, oil painting |
| Товары | burlap sacks, wicker baskets, dried herbs, small glass bottles, medieval trading goods, oil painting |
| Фасады | weathered stone and timber buildings behind market, old shop fronts, wooden shutters, oil painting |

### Сложность: **MEDIUM**
### Приоритет: **#3** — после Town Square и Tavern (экстерьер)

---

## 4. Blacksmith (workshop)

### Роль
Кузница Hilda. Оружие и инструменты. Тупик (1 связь). Приватное место.

### Физическое описание
Приземистое одноэтажное каменное здание с широким **открытым проёмом** (ворота кузни — днём всегда открыты). Внутри видны: **горн** (каменный, с мехами), **наковальня** на толстом пне, **бочка с водой** для закалки, стойка с инструментами (молотки, щипцы, клещи на стене). **Каменная труба** — мощная, широкая, выше крыши.

Снаружи — деревянный навес сбоку (работа в хорошую погоду). Под навесом — **точильный камень** (ножной привод), заготовки железа, подковы на гвоздях. Земля вокруг — утоптанная, обожжённая в местах, куда падают искры.

Второй этаж — надстройка из дерева (жильё Hilda). Маленькое окно, ставни.

### Ключевые объекты

| Объект | Blender-сложность | Заметки |
|--------|-------------------|---------|
| Здание (камень, 1.5 этажа) | Medium | Каменный низ, деревянная надстройка |
| Горн | Medium | Каменная печь с отверстием, мехи |
| Наковальня на пне | Low | Культовый объект |
| Бочка с водой | Low | Открытая, тёмная вода |
| Инструменты на стене | Low | Плоскости/цилиндры на hooks |
| Навес (снаружи) | Low | Столбы + крыша |
| Точильный камень | Low | Каменный диск на раме |
| Каменная труба | Low | Часть здания |
| Подковы/заготовки | Low | Мелкие props |

### Атмосфера
Жар, тяжёлый труд, функциональность. Никаких украшений — всё для дела. Почерневший камень от дыма. Металл и камень доминируют. Чувство: "тут создают вещи, которые служат поколениями". Hilda не терпит бардак — инструменты на своих местах.

### Regional Conditioning Prompts

| Зона | Positive |
|------|----------|
| Здание | medieval blacksmith forge, heavy stone walls, soot-darkened, wide open doorway, thick stone chimney, oil painting |
| Горн + наковальня | stone forge hearth, iron anvil on a wooden stump, bellows, glowing embers (subtle), dark metal tools, oil painting |
| Навес | wooden lean-to shelter, grinding wheel, iron horseshoes hanging on nails, iron bar stock, oil painting |
| Земля | scorched packed earth, dark ash patches, trampled ground near forge, oil painting |

**Negative (critical):** fire, flames, bright orange glow, burning, inferno, lava — SD превратит всё в ад. Горн должен быть subtle embers, not blazing fire.

### Сложность: **MEDIUM**
### Приоритет: **#4**

---

## 5. Town Gate (security)

### Роль
Единственный вход/выход. Garrett патрулирует. Bottleneck. Точка побега преступников.

### Физическое описание
**Каменная арка** между двумя толстыми стенами — не замковые ворота, а деревенские. Стены ~3м высотой, из грубого камня, с деревянным навесом-козырьком сверху. **Деревянные ворота** (двустворчатые, толстые доски, железные полосы) — днём открыты. Рядом — **будка стражника** (деревянная, с крышей, одно окно, внутри стол и кровать — каморка Garrett).

За воротами — **грунтовая дорога**, уходящая вдаль к холмам. Пара **указателей** (деревянные столбы с вырезанными названиями: "Valdris →", "← Millhaven"). По бокам от дороги — дикая трава и кусты.

Внутри стен — пустое пространство перед воротами. Бочки, мешки с песком (примитивная баррикада). Фонарь на крюке у арки.

### Ключевые объекты

| Объект | Blender-сложность | Заметки |
|--------|-------------------|---------|
| Каменная арка + стены | Medium | Основная структура |
| Деревянные ворота | Medium | Двустворчатые, массивные |
| Будка стражника | Low | Маленький домик, 1 комната |
| Указатели | Low | Столбы с табличками |
| Дорога (грунтовая) | Low | Plane, уходит за край кадра |
| Бочки + мешки | Low | Пара props |
| Холмы/ландшафт за воротами | Low | Фон, низкая детализация |

### Атмосфера
Граница. За воротами — дикий мир (бандиты, недельный путь). Внутри — безопасность. Garrett здесь потому что кто-то должен быть. Чувство: "последний рубеж перед пустотой". Тихо, одиноко, только ветер.

### Regional Conditioning Prompts

| Зона | Positive |
|------|----------|
| Арка + стены | medieval village stone gate, rough stone walls, wooden archway, iron-bound wooden doors, old fortification, oil painting |
| Будка | small wooden guard shack, single window, slanted roof, weathered wood, simple and functional, oil painting |
| Дорога за воротами | dirt road leading into distant hills, wild grass on sides, wooden signpost, overcast sky, lonely frontier, oil painting |
| Земля (внутри) | packed dirt courtyard, barrels, sandbags, guard post area, oil painting |

### Сложность: **LOW-MEDIUM**
### Приоритет: **#5**

---

## 6. Temple of Dawn (religious)

### Роль
Святилище. Aldric 30 лет служит. Потерял веру (секрет). Bess приходит вечером. Тихое, приватное место.

### Физическое описание
**Каменное здание** — самое старое в деревне (построено Brother Celwyn 2 поколения назад). Тёмный серый камень, массивные стены. **Узкие стрельчатые окна** (не витражи — просто узкие проёмы). Крыша — тёмный шифер/сланец, **крыша протекает когда идёт дождь** (упомянуто в лоре).

Перед входом — небольшая **каменная площадка** со ступенями. **Дверь** — тяжёлая, дубовая, с железным кольцом. Над дверью — вырезанный в камне символ восходящего солнца (Dawn).

Интерьер: **простой** — каменный пол, деревянные скамьи (4-5 рядов). В дальнем конце — **алтарь** (каменная плита с подсвечниками). Стены — голый камень с парой потускневших гобеленов. Рядом с алтарём — дверь в **комнату Aldric** (келья — кровать, стол, книги, свечи).

### Ключевые объекты

| Объект | Blender-сложность | Заметки |
|--------|-------------------|---------|
| Каменное здание | Medium | Массивные стены, самое архитектурное |
| Стрельчатые окна | Low | Узкие проёмы в стене |
| Крыша (сланец) | Low | Тёмная, местами просевшая |
| Ступени + площадка | Low | Каменные |
| Символ солнца над дверью | Low | Барельеф, плоский |
| Скамьи (interior) | Low | 4-5 рядов, простые |
| Алтарь | Low | Каменная плита |
| Гобелены | Low | Planes на стенах |
| Келья Aldric | Low | Маленькая комната за дверью |

### Атмосфера
Покой и печаль. Камень поглощает звук. Холодно внутри даже летом. Свет падает через узкие окна полосами. Чувство: "здесь молились сотни людей, и камень пропитан их шёпотом". Aldric потерял веру, но место хранит свою.

### Regional Conditioning Prompts

| Зона | Positive |
|------|----------|
| Здание (экстерьер) | medieval stone temple, dark grey stone walls, narrow pointed windows, slate roof, weathered ancient stone, carved sun symbol above door, oil painting |
| Интерьер | austere stone chapel interior, wooden pews, stone altar, dim light through narrow windows, cold grey stone, faded tapestries, oil painting |
| Алтарь | simple stone altar, tarnished brass candlesticks, worn stone surface, solemn and bare, oil painting |
| Площадка перед входом | stone steps leading to heavy oak door, iron ring handle, weathered threshold, oil painting |

**Negative:** cathedral, grand, ornate, stained glass, gothic, gold — это скромная деревенская часовня, не собор.

### Сложность: **MEDIUM**
### Приоритет: **#6**

---

## 7. Residential Lane (residential)

### Роль
Жильё Mark, Elara, Bess. Ночные события (кражи, убийства). Не соединена с Town Square напрямую — 2 хопа.

### Физическое описание
**Узкая улица** между 4-5 домами. Мостовая — частично булыжник, частично утоптанная земля. Дома — **маленькие, одноэтажные**, фахверк (дерево + штукатурка). У каждого — маленький палисадник за **низким забором** (штакетник, покосившийся). Bess выращивает травы — у её дома грядки.

Между домами — **узкие проходы** (щели шириной в человека). На верёвках между домами — **бельё** (planes). Пара кошек на крышах (опционально, если хватит полигонов).

В конце улицы — **тупик** (стена или ограда). Фонарь на столбе — один на всю улицу.

### Ключевые объекты

| Объект | Blender-сложность | Заметки |
|--------|-------------------|---------|
| Дома (×4-5) | High (суммарно) | Маленькие, но каждый немного уникален |
| Палисадники + заборы | Medium | Штакетник, грядки |
| Бельё на верёвках | Low | Planes между домами |
| Грядки Bess | Low | Прямоугольники с "растениями" |
| Фонарный столб | Low | Один на улицу |
| Дорога (узкая) | Low | Булыжник + земля |
| Ящик/бочка у дверей | Low | Per house |

### Атмосфера
Тихо, приватно, уязвимо ночью. Днём — мирная улочка, бельё сохнет на ветру. Ночью — тёмная, один фонарь, тени. Ощущение: "здесь люди спят, и кто-то мог прийти". Между домами — жизнь: цветы в горшках, метла у двери, кошка.

### Regional Conditioning Prompts

| Зона | Positive |
|------|----------|
| Дома | small medieval cottages, half-timbered walls, thatched or tiled roofs, tiny windows, flower pots, humble homes, oil painting |
| Улица | narrow cobblestone lane, packed dirt edges, clotheslines between houses, intimate village street, oil painting |
| Палисадники | small cottage gardens, wooden picket fences, herb patches, overgrown edges, oil painting |
| Земля | worn path between houses, grass growing through cobblestones, a single lamp post, oil painting |

### Сложность: **HIGH** (много маленьких уникальных зданий)
### Приоритет: **#7** (можно упростить — 3 дома вместо 5)

---

## 8. Courthouse (judicial)

### Роль
Суд и правосудие. Theron — бывший столичный учёный, сослан сюда. Камера содержания. Тупик (1 связь). Формальная атмосфера.

### Физическое описание
**Самое официальное здание** в деревне. Двухэтажное, **каменное** (целиком — не фахверк). Прямые линии, симметричный фасад. Крыша — черепица, тёмная. Над входом — **каменный козырёк** на двух колоннах (не дорических — простых квадратных столбах). Дверь — двустворчатая, тёмное дерево, начищенные (единственная начищенная вещь в деревне) **бронзовые ручки**.

Внутри: **зал суда** — каменный пол, скамьи для зрителей, **кафедра судьи** (возвышение с деревянным столом), место для обвиняемого (деревянная загородка). **Камера** — маленькая комната с решёткой вместо двери (используется раз в год). Наверху — кабинет/жильё Theron (книги, стол, кресло, бумаги).

### Ключевые объекты

| Объект | Blender-сложность | Заметки |
|--------|-------------------|---------|
| Здание (2 этажа, камень) | Medium | Самое "строгое" здание |
| Колонны входа (×2) | Low | Квадратные каменные столбы |
| Двустворчатая дверь | Low | Тёмное дерево, бронза |
| Кафедра судьи (interior) | Medium | Возвышение + стол |
| Скамьи (interior) | Low | 2-3 ряда |
| Камера с решёткой | Low | Маленькая комната |
| Кабинет Theron (interior) | Medium | Книги, стол — единственная "учёная" комната |

### Атмосфера
Формально, тяжеловесно, чужеродно. Это здание не выросло из деревни — его построили "по указу". Theron принёс сюда столичный порядок, и здание это отражает. Чувство: "здесь решают судьбы, и стены это помнят". Единственное место с прямыми углами и симметрией.

### Regional Conditioning Prompts

| Зона | Positive |
|------|----------|
| Здание (экстерьер) | formal medieval courthouse, symmetrical stone facade, two square columns, dark wooden double doors, bronze handles, stern official building, oil painting |
| Зал суда | austere stone courtroom, wooden judge's bench on raised platform, wooden railing for the accused, stone floor, dim formal lighting, oil painting |
| Камера | small stone cell, iron bar door, dark and bare, a single cot, oil painting |
| Кабинет Theron | scholar's study, bookshelves, papers on desk, quill and ink, leather chair, the only learned room in the village, oil painting |

**Negative:** grand palace, marble columns, ornate carvings — это деревенский суд, не парламент. Строгий, но скромный.

### Сложность: **MEDIUM**
### Приоритет: **#8**

---

## Порядок моделирования (рекомендация)

| # | Локация | Тип | Почему в таком порядке |
|---|---------|-----|------------------------|
| 1 | **Town Square** | Экстерьер | Центр мира. Валидирует экстерьерный pipeline. 6 связей = всё от него расходится. |
| 2 | **Silver Flagon** (экстерьер) | Экстерьер + готовый интерьер | Ближайший сосед, интерьер уже в PoC. Экстерьер = фасад видимый с площади. |
| 3 | **Market Square** | Экстерьер | Рядом, другой тип (торговля). Props-heavy — тестирует scatter. |
| 4 | **Blacksmith** | Экстерьер + полуоткрытый интерьер | Уникальный (кузня). Тестирует "горячие" промпты без пожаров. |
| 5 | **Town Gate** | Экстерьер | Простой. Передышка после сложных локаций. |
| 6 | **Temple of Dawn** | Экстерьер + интерьер | Камень, торжественность. Другая палитра. |
| 7 | **Residential Lane** | Экстерьер + микроинтерьеры | Много мелких зданий — самое трудоёмкое по количеству. |
| 8 | **Courthouse** | Экстерьер + интерьер | Последнее — на тот момент pipeline уже отточен. |

### Milestone checkpoints
- **После #1 (Town Square)**: pipeline валидирован для экстерьеров? IPAdapter reference готов? → Если нет — тюнить, не двигаться дальше.
- **После #3 (Market)**: 3 локации в стиле? Consistency между ними? → Если drift — пересмотреть IPAdapter strength.
- **После #5 (Gate)**: половина мира. Можно собрать первый walkable prototype в Web UI.
- **После #8**: полный Millhaven. Переход к Этапу 4 (автоматизация и batch).

---

## Общий Negative Prompt (для всех локаций)

```
photographic, 3D render, blurry, flat colors, digital art, smooth, plastic, cartoon, anime,
modern, contemporary, clean, new, pristine, polished,
fire, flames, candles on tables, lanterns glowing bright, inferno, lava,
text, watermark, signature, UI elements
```

Добавлять per-location negatives поверх.

---

## Глобальный промпт-шаблон (база для всех)

```
Positive (global):
medieval frontier village, oil painting style, painterly brushstrokes, thick impasto texture,
warm muted colors, ochre and umber palette, overcast golden hour light,
aged and weathered, 200 year old village, moss and cracks,
isometric view, Disco Elysium inspired, melancholic atmosphere
```

Regional prompts добавляются поверх через emission-маски.

---

*Visual Briefs v1.0 — 2026-04-14*
*Источники: world.json (coordinates), Location docs (narrative), NPC profiles (atmosphere), SPEC-art-pipeline.md (technical params)*
