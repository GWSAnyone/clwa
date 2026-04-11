# SPEC-art-pipeline: Painterly Art Pipeline (Blender → ComfyUI → Web UI)

> **Milestone**: Visual Overhaul
> **Status**: PoC VALIDATED (v2.1, 2026-04-11)
> **Depends on**: Web UI (exists), WebSocket API (exists)
> **Engine changes**: Нет. Визуальный клиент — чистый frontend.
>
> Пайплайн генерации игровой графики для CLWA в стиле Disco Elysium.
> Blender (3D-болванки) → ComfyUI (AI-стилизация с SDXL) → Web UI (чанковая слоёвая система).
> Цель: painterly oil painting, isometric view, полноценные локации с интерьерами.
>
> **PoC результат (2026-04-11):** Silver Flagon Tavern — первая успешная генерация.
> Pipeline работает end-to-end. Regional conditioning через маски валидирован.

---

## Проблема

CLWA имеет 14 engine-подсистем, 40+ регистров, 81 инвариант — но визуально это Canvas2D с Tiny Swords sprite pack. Глубина симуляции невидима игроку. Текущий визуал говорит "прототип", а не "игра".

80%+ геймплея — текстовая социальная дедукция (диалоги, IL-эффекты, journal). Визуал нужен для **атмосферы и контекста** (кто где), не для action-геймплея. Значит: art direction > polygon count.

---

## Решение

Адаптированный Disco Elysium pipeline: 3D block-in → multi-pass render → **AI-стилизация** (замена ручной живописи) → слоёвая интеграция в Web UI.

```
BLENDER (3D-болванка)                    COMFYUI (AI-стилизация, SDXL FP8)
─────────────────────                    ────────────────────────────────
Город low-poly, EEVEE                   
  ├─ Combined render ─────────────────→ img2img (denoise 0.55)
  ├─ Depth pass ──────────────────────→ ControlNet Depth (0.7)
  ├─ Emission color masks ────────────→ Regional Conditioning по цветам
  └─ Visibility layers ──────────────→ Inpaint для слоёв
                                         + LoRA ClassiPeintXL (0.8)
                                         + IPAdapter (style reference)
                                         + DPM++ 2M Karras, CFG 7, 30 steps
                                                │
                                         Стилизованный результат ~1MP
                                                │
                                         AI Upscale (4x-UltraSharp)
                                         + Tiled img2img (ControlNet Tile)
                                                │
                                         Финальный результат 4-8K
                                                │
                                         Нарезка на чанки с overlap
                                                │
                                         Web UI: динамическая подгрузка
```

### Ключевые решения

| Решение | Почему |
|---------|--------|
| **SDXL FP8** (не SD 1.5, не FLUX) | SD 1.5 = 512px натив (слишком мелко). FLUX + ControlNet = 11-12 GB (не влезает в 10 GB). SDXL FP8 + ControlNet = ~7.5-8 GB — работает. |
| **Regional Conditioning** через emission-маски | Разные типы объектов (камень, дерево, дорога) получают разные промпты. SD знает что рисовать, а не угадывает. |
| **Слоёвая система** (БАЗА → inpaint производные) | Решает проблему cutaway-стен. БАЗА = город с крышами. Интерьер = inpaint-слой под БАЗОЙ. Fade крыши = видно интерьер. Стиль консистентен т.к. всё рождается из одной БАЗЫ. |
| **IPAdapter** для стилевой consistency | Первая утверждённая зона = эталон. IPAdapter подаёт её во все последующие. Единый "почерк художника". |
| **Web UI** (не Godot) | Уже есть, проще, один клиент. Чанковая подгрузка по DTF-методу. |

---

## Scope

### Включено
- Полный pipeline Blender → ComfyUI → Web UI
- 8 локаций Millhaven (экстерьеры + интерьеры)
- Слоёвая система (БАЗА, интерьеры, за зданиями)
- Динамическое освещение (время суток)
- Чанковая подгрузка фонов
- Y-сортировка объектов

### Отложено
- Персонажи (отдельная спека, после pipeline proof-of-concept)
- Портреты NPC (отдельная спека)
- Звук и музыка
- Анимации (листья, вода, огонь)
- Второй этаж зданий (вертикальность)
- Параллакс-эффекты (деревья из DTF-статьи)

---

## Референс: Disco Elysium Art Pipeline

### Как ZA/UM делали графику

- **Lead artist:** Aleksander Rostov — живописец маслом, не геймдев-художник
- **Вдохновение:** Jenny Saville, Alex Kanevsky, Iliya Repin, Mikhail Vrubel
- **Фоны:** 3D block-in в Blender → isometric render (color + depth + normal + shadow) → **hand-painted paintover маслом** → UV-проекция на геометрию → Unity с dynamic lighting
- **Масштаб:** 193 квадрата текстур в 4K + heightmaps + normal maps + shadow maps
- **Персонажи:** 3D модели с hand-painted normal maps (позже — sculpted)
- **Интерактивные элементы:** всё анимированное — realtime поверх рисованного фона
- **Слои:** Multiply для освещения, Additive для источников света, маски для depth-сортировки
- **Команда:** 5 человек на арт-pipeline 4 года

### Наш подход

Заменяем hand-painting на **AI-стилизацию через ComfyUI**. 3D-болванка из Blender → ControlNet держит геометрию → LoRA + промпт дают painterly стиль → IPAdapter обеспечивает consistency. Результат — тот же "animated oil painting", но без художника-маслописца.

**Дополнительные референсы:**
- [DTF: "How to: DE в Construct 3"](https://dtf.ru/id30289/2299375) — чанковая система, слои, Y-сортировка, маски
- [Mickmumpitz AI Renderer](https://mickmumpitz.ai/) — Blender emission masks → ComfyUI regional conditioning
- [Pillars of Eternity — Graphics and Rendering](https://eternity.obsidian.net/eternity/news/update--79-graphics-and-rendering-)

---

## Модели и инструменты

### Checkpoint

| Модель | Файл | Размер | Формат | Источник |
|--------|------|--------|--------|----------|
| **DreamShaper XL** | `DreamShaperXL.safetensors` | ~6.5 GB (FP16) / ~3.3 GB (FP8) | **FP8 обязателен** для 10 GB VRAM | [CivitAI #112902](https://civitai.com/models/112902/dreamshaper-xl) |

> **ВАЖНО:** Скачивать **non-distilled** версию (alpha2 или v2.1 base). **НЕ скачивать Lightning / Turbo / Hyper** — Fooocus Inpaint с ними несовместим. Если FP8 версия недоступна на CivitAI — конвертировать в ComfyUI: Load Checkpoint → weight_dtype = fp8_e4m3fn → Save.

### ControlNet

| Модель | Файл | Размер | Режимы | Источник |
|--------|------|--------|--------|----------|
| **xinsir Union SDXL ProMax** | `diffusion_pytorch_model_promax.safetensors` + `config_promax.json` | ~2.5 GB | Depth, Canny, Tile, Normal, Inpaint, Segment и др. | [HuggingFace xinsir](https://huggingface.co/xinsir/controlnet-union-sdxl-1.0) |

> **ВАЖНО:** Скачивать **ProMax** версию. Базовая НЕ поддерживает Tile и Inpainting — они нужны для upscale и слоёв. Известные проблемы с inpainting через Union — если артефакты, fallback на отдельную ControlNet Depth модель.

### LoRA

| Модель | Файл | Размер | Trigger | Сила | Источник |
|--------|------|--------|---------|------|----------|
| **ClassiPeintXL v2.1** | `ClassipeintXL2.1.safetensors` | 127 MB | `oil painting` | 0.8-1.0 | [CivitAI #127139](https://civitai.com/models/127139/classipeintxl-oil-paint-oil-painting-style) |

> Без `oil painting` в промпте → фотореализм с неестественным боке. DPM-семплеры дают лучшие результаты. Не использовать с Refiner.

### IPAdapter (стилевая consistency)

| Модель | Файл | Размер | Путь |
|--------|------|--------|------|
| **IP-Adapter Plus SDXL** | `ip-adapter-plus_sdxl_vit-h.safetensors` | 848 MB | `models/ipadapter/` |
| **CLIP Vision** | `CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors` | ~2.5 GB | `models/clip_vision/` |

**Custom node:** [ComfyUI_IPAdapter_plus](https://github.com/cubiq/ComfyUI_IPAdapter_plus)

**Workflow consistency:**
1. Сгенерировать первую зону → выбрать лучший вариант → утвердить как эталон
2. Сохранить IPAdapter embed (IPAdapter Save Embeds) — **экономит ~1.2-1.4 GB VRAM** (CLIP Vision не грузится повторно)
3. Подавать saved embed во все последующие зоны через IPAdapter → strength 0.3-0.5

### Inpaint

| Модель | Файл | Размер | Путь | Источник |
|--------|------|--------|------|----------|
| **Fooocus Inpaint v2.6** | `inpaint_v26.fooocus.patch` | 1.32 GB | `models/inpaint/` | [HuggingFace lllyasviel](https://huggingface.co/lllyasviel/fooocus_inpaint) |
| **Fooocus Inpaint Head** | `fooocus_inpaint_head.pth` | 53 KB | `models/inpaint/` | Тот же репозиторий |

**Custom node:** [comfyui-inpaint-nodes](https://github.com/Acly/comfyui-inpaint-nodes) (Acly)

> **ВАЖНО:** Fooocus Inpaint **несовместим** с distilled checkpoints (Lightning, Turbo, Hyper). Только non-distilled SDXL.

### Upscale

| Модель | Файл | Размер | Путь | Источник |
|--------|------|--------|------|----------|
| **4x-UltraSharp** | `4x-UltraSharp.pth` | 67 MB | `models/upscale_models/` | [HuggingFace Kim2091](https://huggingface.co/Kim2091/UltraSharp/blob/main/4x-UltraSharp.pth) |

### VAE

| Модель | Файл | Размер | Путь | Источник |
|--------|------|--------|------|----------|
| **sdxl-vae-fp16-fix** | `sdxl.vae.safetensors` | 335 MB | `models/vae/` | [HuggingFace madebyollin](https://huggingface.co/madebyollin/sdxl-vae-fp16-fix) |

> Стандартный SDXL VAE генерирует NaN в FP16 → чёрные изображения. Этот VAE дофайнтюнен для стабильной работы в FP16.

### Custom Nodes (через ComfyUI Manager)

| Пакет | Репозиторий | Назначение |
|-------|------------|------------|
| **ComfyUI Manager** | [Comfy-Org/ComfyUI-Manager](https://github.com/Comfy-Org/ComfyUI-Manager) | Управление нодами |
| **ComfyUI-Inspire-Pack** | [ltdrdata/ComfyUI-Inspire-Pack](https://github.com/ltdrdata/ComfyUI-Inspire-Pack) | `RegionalConditioningColorMask` для regional conditioning по цветным маскам |
| **ComfyUI Impact Pack** | [ltdrdata/ComfyUI-Impact-Pack](https://github.com/ltdrdata/ComfyUI-Impact-Pack) | Зависимость Inspire Pack |
| **ComfyUI-Inpaint-Nodes** | [Acly/comfyui-inpaint-nodes](https://github.com/Acly/comfyui-inpaint-nodes) | Fooocus inpaint интеграция |
| **ComfyUI_IPAdapter_plus** | [cubiq/ComfyUI_IPAdapter_plus](https://github.com/cubiq/ComfyUI_IPAdapter_plus) | IPAdapter для стилевой consistency |
| **Ultimate SD Upscale** | [ssitu/ComfyUI_UltimateSDUpscale](https://github.com/ssitu/ComfyUI_UltimateSDUpscale) | Тайловый апскейл |
| **ControlNet Preprocessors** | [Fannovel16/comfyui_controlnet_aux](https://github.com/Fannovel16/comfyui_controlnet_aux) | Препроцессоры Depth/Canny |
| **ComfyUI-GGUF** | [city96/ComfyUI-GGUF](https://github.com/city96/ComfyUI-GGUF) | Опционально, если нужна квантизация |

**Установка Manager:**
```bash
cd ComfyUI/custom_nodes
git clone https://github.com/Comfy-Org/ComfyUI-Manager
# Перезапустить ComfyUI → остальные ноды ставятся через UI Manager
```

### Итого на диске

~11.2 GB: checkpoint FP8 (~3.3) + ControlNet ProMax (~2.5) + IPAdapter (~0.85) + CLIP Vision (~2.5) + LoRA (~0.13) + Inpaint (~1.37) + VAE (~0.34) + Upscaler (~0.07) + запас.

---

## VRAM-бюджет (RTX 3080 10 GB)

| Компонент | FP16 | FP8 |
|-----------|------|-----|
| SDXL UNet | ~6.5 GB | **~3.3 GB** |
| CLIP Text Encoders (x2) | ~1.5 GB | ~1.5 GB |
| VAE (fp16-fix) | ~0.1 GB | ~0.1 GB |
| ControlNet Union ProMax | ~2.5 GB | ~2.5 GB |
| LoRA (ClassiPeintXL) | ~0.2 GB | ~0.2 GB |
| IPAdapter + CLIP Vision | ~2-3 GB | ~2-3 GB |

### Сценарии

| Сценарий | VRAM | Статус |
|----------|------|--------|
| SDXL FP16 + ControlNet + LoRA | ~10.5-11 GB | **Не влезает** |
| **SDXL FP8 + ControlNet + LoRA** | **~7.5-8 GB** | **Основной рабочий конфиг** |
| SDXL FP8 + IPAdapter (pre-encoded) + ControlNet + LoRA | ~9-10 GB | Влезает с pre-encoded embeds |
| SDXL FP8 + IPAdapter (live) + ControlNet + LoRA | ~10-11 GB | Тесно, требует offloading |
| Tiled Upscale (512px tiles) + SDXL FP8 | ~6-7 GB | Комфортно |
| Inpainting (Fooocus + SDXL FP8 + ControlNet) | ~8-9 GB | Влезает |

**Правила:**
1. **FP8 checkpoint — обязателен.** FP16 не оставляет места для ControlNet.
2. **IPAdapter:** pre-encode embeds (Save Embeds) → экономия ~1.2-1.4 GB.
3. **Tiled VAE** при upscale — обязательно (512px тайлы).
4. **Закрывать LM Studio и Blender** перед генерацией — освобождает 1-2 GB VRAM.
5. Запуск ComfyUI с `--lowvram` если пиковое потребление на пределе.

### Альтернатива: FLUX GGUF

FLUX.1-dev в формате GGUF Q4_K_S (~6.8 GB файл, ~7-8 GB VRAM) даёт лучшее качество чем SDXL при базовой генерации. **Но:** ControlNet для FLUX добавляет ~2-4 GB → суммарно ~11-12 GB → **не влезает на 10 GB**. 

**Вывод:** FLUX GGUF жизнеспособен для финального апскейла или генерации без ControlNet, но **не заменяет SDXL** как основу pipeline с ControlNet. Протестировать в Этапе 3 как опцию.

---

## Blender — подготовка сцены

### Камера

- **Тип:** Orthographic
- **Rotation:** X=60°, Y=0°, Z=45° (стандартная игровая изометрия, 2:1)
- **Orthographic Scale:** подбирается под зону рендера
- **Film → Transparent:** включить для рендеров отдельных элементов

### Render Engine

**EEVEE** — быстро, достаточно для болванок. Cycles не нужен — детализацию добавит ComfyUI.

### Разрешение рендера

SDXL нативно работает на **~1 мегапиксель**. Рендер из Blender должен совпадать:

| Разрешение | Соотношение | Применение |
|------------|-------------|------------|
| **1344 × 768** | 7:4 | Широкие зоны (площадь, улица) |
| **1152 × 896** | 9:7 | Квадратные зоны |
| **1024 × 1024** | 1:1 | Универсальное |

> Рендер в произвольном разрешении (1920×1080, 4096×3072) → артефакты SDXL (дублирование, искажение). Всегда ~1 MP.

### Render Passes (View Layer Properties)

| Pass | Формат | Использование |
|------|--------|---------------|
| **Combined** | PNG | img2img — основной рендер для стилизации |
| **Depth (Z)** | EXR → нормализованный PNG | ControlNet Depth |
| **Emission** | PNG | Цветовые маски для Regional Conditioning |

**Depth нормализация** (Blender Compositor):
```
Render Layers [Mist] → Invert → File Output (PNG 16-bit)
```
Или: `Render Layers [Depth] → Normalize → Invert → File Output`

Mist pass предпочтительнее — уже нормализован 0-1, управляется Camera Clip. Invert нужен т.к. Blender: close=black, ControlNet: close=white.

> **AO, Shadow, Normal** — опциональны. Для MVP не требуются. Могут использоваться как дополнительные Multiply/Additive слои в Web UI позже.

### Структура коллекций

```
Millhaven_Scene
├── Ground (дороги, площади, земля)
├── Buildings
│   ├── Tavern
│   │   ├── Exterior (стены, фасад)
│   │   ├── Roof
│   │   └── Interior
│   ├── Blacksmith
│   │   ├── Exterior / Roof / Interior
│   └── ... (8 локаций)
├── Vegetation (деревья, кусты)
├── Props (бочки, ящики, вывески)
└── Lights (источники для теней/emission)
```

### Visibility Layers

| Рендер | Что видно | Для чего |
|--------|-----------|----------|
| **A: Full City** | Всё (крыши, фасады) | БАЗА — дефолтный вид |
| **B: No Roofs** | Крыши скрыты | Интерьеры сверху |
| **C: No Facades** | Передние стены скрыты | За зданиями |
| **D: Roofs Only** | Только крыши, transparent | Маска для inpaint |
| **E: Facades Only** | Только фасады, transparent | Маска для inpaint |

### Emission-маски по типам объектов

6-8 emission-материалов с уникальными HEX-цветами:

| Тип объекта | HEX | Regional Prompt |
|-------------|-----|----------------|
| Здания | `#FF0000` | "medieval stone and timber buildings, weathered walls, cracked plaster, mossy corners, old wooden shutters, oil painting style" |
| Дороги | `#00FF00` | "wet cobblestone street, puddles, worn edges, scattered leaves, oil painting" |
| Растительность | `#0000FF` | "old gnarled trees, overgrown ivy, wild grass patches, painterly brushstrokes" |
| Крыши | `#FFFF00` | "tiled rooftops, weathered shingles, chimney smoke stains, oil painting" |
| Вода | `#00FFFF` | "murky canal, dark reflections, floating debris, painterly" |
| Земля | `#FF00FF` | "muddy ground, trampled grass, cart wheel tracks, oil painting" |
| Двери/окна | `#FF8000` | "dark aged wood, iron fittings, candlelight glow, painterly" |
| Металл | `#808080` | "wrought iron, rusty hinges, old lanterns, oil painting texture" |

Назначение в Blender: Select All by Material → Assign.

---

## Workflow: генерация БАЗЫ

### Ноды (порядок подключения)

1. **Load Checkpoint** → DreamShaper XL (FP8)
2. **Load LoRA** → ClassiPeintXL v2.1 (strength 0.8)
3. **Load Image** → Blender combined render
4. **Load Image** → Depth pass → **ControlNet Apply** (Union ProMax, mode=Depth, strength 0.7, end 0.8)
5. **Load Image** → Emission маски → **RegionalConditioningColorMask** (Inspire Pack) × N (по одной ноде на цвет)
6. **ConditioningCombine** → объединить все regional conditioning
7. **CLIP Text Encode** (negative) → "photographic, 3D render, blurry, flat colors, digital art, smooth, plastic"
8. **VAE Encode** → latent из combined render
9. **KSampler:**
   - Steps: **30**
   - CFG: **7**
   - Sampler: **dpmpp_2m**
   - Scheduler: **karras**
   - Denoise: **0.55**
10. **VAE Decode** → **Save Image**

### IPAdapter (после утверждения первой зоны)

Вставляется перед KSampler:
1. **IPAdapter Load** → ip-adapter-plus_sdxl_vit-h
2. **Load CLIP Vision** → CLIP-ViT-H-14
3. **Load Image** → утверждённая первая зона (reference)
4. **IPAdapter Apply** → model, strength 0.3-0.5, weight_type = style transfer

Или: **IPAdapter Save Embeds** после первого encode → **IPAdapter Load Embeds** для последующих зон (экономия VRAM).

### Параметры (справка)

| Параметр | Значение | Почему |
|----------|----------|--------|
| Denoise | 0.55 | Баланс: painterly текстуры + сохранение Blender-структуры |
| ControlNet strength | 0.7 | Держит пространство, не пережимает |
| ControlNet end | 0.8 | Последние 20% шагов — свободная детализация |
| LoRA strength | 0.8 | Выраженный painterly без артефактов |
| CFG | 7 | Стандарт SDXL |
| Steps | 30 | Оптимум качество/скорость |
| IPAdapter strength | 0.3-0.5 | Стиль без подавления промпта |

### Seed-стратегия

- **Подбор параметров:** фиксированный seed (для A/B сравнения)
- **Финальная генерация:** random seed → 3-4 варианта → выбор лучшего
- **Документирование:** записать seed утверждённого варианта для каждой зоны в `renders/zone_seeds.json`

---

## Наращивание слоёв (consistency)

### Принцип: всё рождается из одной БАЗЫ

Каждый дополнительный слой — **inpaint поверх БАЗЫ** с ControlNet от соответствующего Blender-рендера.

```
БАЗА (полный город, Рендер A) ← ComfyUI генерация
  │
  ├─ Маска крыш (Рендер D) + ControlNet Depth от Рендера B (No Roofs)
  │   → Inpaint → слой ИНТЕРЬЕРЫ
  │
  ├─ Маска фасадов (Рендер E) + ControlNet Depth от Рендера C (No Facades)
  │   → Inpaint → слой ЗА_ЗДАНИЯМИ
  │
  └─ Для 2-го этажа (отложено):
      Маска 1-го этажа + ControlNet от "2-й этаж без крыши"
      → Inpaint → слой ЭТАЖ_2
```

### Inpaint параметры

| Параметр | Значение |
|----------|----------|
| Denoise | 0.6-0.7 (выше БАЗЫ — нужна свобода для новых деталей) |
| Mask blur | 12-16px |
| Fooocus Inpaint | Использовать как inpaint model |
| ControlNet | Depth от Blender-рендера соответствующего слоя |

> **Fallback:** Если ControlNet Union ProMax даёт артефакты при inpainting — использовать отдельную ControlNet Depth модель (от diffusers) для inpaint-шагов.

---

## Апскейл

### Двухэтапный пайплайн

```
Картинка ~1MP (1024-1344px)
  → AI Upscale (4x-UltraSharp) → 4-5K
  → Ultimate SD Upscale (Tiled img2img)
      + ControlNet Tile (denoise 0.2-0.35)
      + Tile size 512px
      + Mode: Chess (лучше скрывает швы)
      + Seam fix: Half Tile
      + tiled_decode: True
      → Финальный 4-8K с деталями
```

Каждый тайл обрабатывается отдельно → ~6-7 GB VRAM → комфортно на 10 GB.

---

## Автоматизация

### Blender Python

Скрипт: определить зоны как прямоугольники → перемещать камеру → переключать visibility → рендерить все passes → сохранять. Руками ничего не двигать.

### ComfyUI API (batch processing)

ComfyUI поддерживает HTTP API. Для 8 зон × 5 рендеров × 3 слоя = ~120 прогонов — автоматизация обязательна.

**Workflow:**
1. В ComfyUI: настроить workflow на одной зоне, утвердить параметры
2. File → Export (API) → получить JSON
3. Python-скрипт подставляет пути к файлам + seed → POST `http://127.0.0.1:8188/prompt`

```python
import json, urllib.request

def queue_prompt(workflow, file_path, seed):
    workflow["load_image_node"]["inputs"]["image"] = file_path
    workflow["ksampler_node"]["inputs"]["seed"] = seed
    data = json.dumps({"prompt": workflow}).encode('utf-8')
    req = urllib.request.Request("http://127.0.0.1:8188/prompt", data=data)
    urllib.request.urlopen(req)

# Batch all zones
for zone in zones:
    queue_prompt(workflow, zone["combined"], zone["seed"])
```

WebSocket (`ws://127.0.0.1:8188/ws?clientId=UUID`) для отслеживания прогресса и получения результатов.

---

## Интеграция в Web UI

### Слоёвая система

```
Слои (снизу вверх):
1. ЗА_ЗДАНИЯМИ — проходы за высокими зданиями
2. ИНТЕРЬЕРЫ — интерьеры всех зданий
3. ОБЪЕКТЫ — интерактивные элементы (Y-сортировка)
4. БАЗА — полный город (крыши + фасады)
5. ОСВЕЩЕНИЕ — Multiply-слой (время суток)
6. ADDITIVE — светящиеся источники (Additive blend)
```

### Переходы

| Действие | Визуальный эффект |
|----------|-------------------|
| Игрок зашёл в дверь | Fade крыши здания → виден слой ИНТЕРЬЕРЫ |
| Игрок за высоким зданием | Fade фасада → виден слой ЗА_ЗДАНИЯМИ |
| Игрок вышел | Fade обратно → видна БАЗА |

Триггеры: позиция игрока + зоны у дверей. Opacity transition через Canvas/CSS.

### Чанковая подгрузка (по DTF-методу)

- Чанки: прямоугольные с **overlap 128-256px**
- Подгрузка по позиции камеры/персонажа
- Unload при удалении от чанка → экономия RAM
- Metadata: `tilemap_meta.json` (grid, tile_size, source dimensions)

### Стыковка между зонами

**Стратегия:** Overlap + Inpaint. Полоса перекрытия между чанками → inpaint стыка (soft, mask blur 16px). Depth map из единой Blender-сцены гарантирует геометрическую стыковку.

### Освещение (время суток)

Multiply-слой поверх БАЗЫ. Меньшее разрешение допустимо (diffuse blend скрывает). Варианты: день, вечер, ночь. PointLight2D / Additive sprites для свечей, окон, фонарей. Server gameMinute → Web UI выбирает вариант.

---

## Процесс контроля качества

### Итерация на зону

1. Сгенерировать **4 варианта** (разные seed, одинаковые параметры)
2. Выбрать лучший по: стилю мазков, цветовой палитре, читаемости объектов
3. Проблемные зоны → локальный **inpaint** (маска на проблему, denoise 0.3-0.4)
4. **Утвердить** → записать seed в `zone_seeds.json`
5. Первая утверждённая зона → **IPAdapter reference** для всех последующих

### Критерии приёмки

- [ ] Стиль — painterly oil painting, не фотореализм и не cartoon
- [ ] Читаемость — видно что это здание/дорога/дерево с первого взгляда
- [ ] Consistency — соседние зоны выглядят как работа одного художника
- [ ] Depth — стены "дальше" чем объекты "ближе" (пространственное ощущение)
- [ ] Детали — текстуры не мыльные, видны мазки кисти

---

## Риски

| Риск | Вероятность | Влияние | Митигация |
|------|-------------|---------|-----------|
| VRAM overflow при сложных workflow | **Подтверждён** | Crash | FP8 + --disable-cuda-malloc + --lowvram **обязательны**. Закрывать LM Studio. |
| Access violation на VAE Decode (Windows) | **Подтверждён** | Crash | --disable-cuda-malloc решает. PyTorch 2.6 + cudaMallocAsync на Windows — баг. |
| Объекты неверно интерпретируются (табуретки→фонари) | **Подтверждён** | Визуальные ошибки | Regional conditioning per объект. Уточнение промпта. Negative prompt. |
| Style drift между зонами | Средняя | Видимая несогласованность | IPAdapter с reference image. Locked LoRA + prompt template |
| ControlNet Union + Inpaint артефакты | Средняя | Чёрные области, цветовые искажения | Fallback на отдельную ControlNet Depth для inpaint-шагов |
| Fooocus + distilled checkpoint | Высокая (при ошибке) | Inpainting полностью нерабочий | Чёткое предупреждение: ТОЛЬКО non-distilled DreamShaper XL |
| 120+ ручных прогонов ComfyUI | Высокая | Burnout | API-автоматизация (batch скрипт) |
| Blender-моделирование города дольше ожиданий | Средняя | Задержка на недели | Начать с одной зоны (Market Square). Минимальная детализация — beauty = paint. |
| SD генерирует артефакты на границах emission-масок | Средняя | Видимые швы | mask dilation в RegionalConditioningColorMask. Общий prompt как fallback |
| Upscale теряет painterly текстуру | Низкая | Пластиковый вид | ControlNet Tile + ClassiPeintXL LoRA при upscale. Painter's Checkpoint как альтернатива |

---

## Таск-лист

### Этап 1: Установка и настройка — DONE (2026-04-11)
- [x] Скачать все модели (checkpoint, ControlNet, LoRA, Inpaint, VAE, Upscaler)
- [x] Установить ComfyUI Manager + все custom nodes (Impact Pack, Inspire Pack, ControlNet Aux, IPAdapter Plus, Ultimate SD Upscale, Inpaint Nodes)
- [x] Установить все Python-зависимости (cv2, scikit-image, piexif, webcolors, matplotlib, segment-anything)
- [x] Тестовый прогон: Blender render → img2img + ControlNet + LoRA — **работает**
- [ ] Скачать IPAdapter + CLIP Vision (для Этапа 3)

**Критические флаги запуска (обязательны для RTX 3080 10GB):**
```
--fp8_e4m3fn-unet --disable-cuda-malloc --lowvram
```
Без них: OOM (fp16), access violation (cuda-malloc), crash на VAE Decode (без lowvram).

### Этап 2: Blender — болванка Millhaven (~2-4 недели)
- [x] Блок-ин таверны (Silver Flagon) — стены, бар, лестница, столы, табуретки, окна
- [ ] Создать остальные 7 локаций
- [ ] Настроить камеру (Orthographic, isometric)
- [ ] Создать emission-материалы (6-8 цветов по типам)
- [ ] Настроить коллекции visibility (Full, NoRoofs, NoFacades, RoofsOnly, FacadesOnly)
- [ ] Включить render passes (Combined, Depth/Mist, Emission)
- [ ] Определить зоны рендера (прямоугольники с overlap)

### Этап 3: Pipeline tuning — IN PROGRESS
- [x] Рендер таверны — EEVEE, 1152×896, no shadows, ambient
- [x] ComfyUI: img2img + ControlNet Depth + LoRA → painterly результат
- [x] VAEEncodeForInpainting с маской (белый=интерьер, чёрный=фон) — работает
- [x] Regional conditioning через ConditioningSetMask + ConditioningCombine — валидирован
- [ ] Промпт-тюнинг (убрать фонари/огонь, уточнить мебель)
- [ ] Сгенерировать 4 варианта, выбрать лучший, утвердить как IPAdapter reference
- [ ] Протестировать upscale pipeline (4x-UltraSharp → Tiled img2img)
- [ ] Опционально: протестировать FLUX GGUF Q4 как альтернативу

**Проверенные параметры (PoC):**

| Параметр | Значение | Примечание |
|----------|----------|------------|
| Checkpoint | DreamShaper XL alpha2 | non-distilled, FP8 через флаг |
| LoRA | ClassiPeintXL v2.1, strength 0.8 | Trigger: "oil painting" |
| ControlNet | Union ProMax, depth mode | strength 0.7, end 0.8 |
| Sampler | dpmpp_2m, karras | |
| Steps | 30 | |
| CFG | 7 | |
| Denoise | 0.85 | С ControlNet можно высокий |
| VAE | sdxl-vae-fp16-fix | Обязателен для FP16 decode |
| Inpaint | VAEEncodeForInpainting | grow_mask_by 6-12 |
| Разрешение | 1152×896 | SDXL native ~1MP. 2048×1536 OOM на save. |

**Подводные камни (из PoC):**
- "candlelight", "glow" в промпте → SD превращает цилиндры в фонари
- Фон снаружи здания **обязательно** маскировать чёрным
- Маски отделять от картинки через **LoadImageMask** ноду (менять рендер без перерисовки масок)
- Маска и картинка должны совпадать по разрешению
- Negative prompt: добавить "fire, flames, candles on tables, lanterns"

### Этап 4: Полная генерация (~1-2 недели)
- [ ] Автоматизация Blender (Python скрипт для всех зон)
- [ ] Автоматизация ComfyUI (batch скрипт через API)
- [ ] БАЗА для каждой зоны (с IPAdapter reference)
- [ ] Слои интерьеров (inpaint от БАЗЫ)
- [ ] Слои за зданиями (inpaint от БАЗЫ)
- [ ] Апскейл всех слоёв
- [ ] Стыковка и проверка швов (inpaint overlap)

### Этап 5: Интеграция в Web UI (~1-2 недели)
- [ ] Нарезка на чанки (прямоугольные, overlap 128-256px)
- [ ] Система подгрузки чанков по позиции
- [ ] Слоёвая система (БАЗА + интерьеры + за зданиями)
- [ ] Триггеры входа/выхода → fade крыш и фасадов
- [ ] Освещение (Multiply-слой, варианты времени суток)
- [ ] Y-сортировка объектов
- [ ] Маски для character occlusion

### Общая оценка: ~2-3 месяца

| Этап | Длительность |
|------|-------------|
| 1: Установка | 1-2 дня |
| 2: Blender | 2-4 недели |
| 3: Pipeline test | 1-2 недели |
| 4: Генерация | 1-2 недели |
| 5: Web UI | 1-2 недели |

---

## Ресурсы

### Модели (ссылки для скачивания)

- DreamShaper XL: [CivitAI #112902](https://civitai.com/models/112902/dreamshaper-xl) → `models/checkpoints/`
- ClassiPeintXL v2.1: [CivitAI #127139](https://civitai.com/models/127139/classipeintxl-oil-paint-oil-painting-style) → `models/loras/`
- xinsir ControlNet Union ProMax: [HuggingFace](https://huggingface.co/xinsir/controlnet-union-sdxl-1.0) → `models/controlnet/`
- IP-Adapter Plus SDXL: [HuggingFace h94](https://huggingface.co/h94/IP-Adapter/tree/main/sdxl_models) → `models/ipadapter/`
- CLIP Vision ViT-H-14: [HuggingFace laion](https://huggingface.co/laion/CLIP-ViT-H-14-laion2B-s32B-b79K) → `models/clip_vision/`
- Fooocus Inpaint v2.6: [HuggingFace lllyasviel](https://huggingface.co/lllyasviel/fooocus_inpaint) → `models/inpaint/`
- sdxl-vae-fp16-fix: [HuggingFace madebyollin](https://huggingface.co/madebyollin/sdxl-vae-fp16-fix) → `models/vae/`
- 4x-UltraSharp: [HuggingFace Kim2091](https://huggingface.co/Kim2091/UltraSharp) → `models/upscale_models/`
- FLUX GGUF (опционально): [HuggingFace city96](https://huggingface.co/city96/FLUX.1-dev-gguf) → `models/checkpoints/`

### Blender тулкиты

- [Screaming Brain Studios — Isometric Tile Toolkit](https://screamingbrainstudios.itch.io/isometric-tile-toolkit) (CC0)
- [Clint Bellanger — Isometric Tiles in Blender](https://clintbellanger.net/articles/isometric_tiles/)

### ComfyUI workflow / туториалы

- [Mickmumpitz — Blender → ComfyUI](https://mickmumpitz.ai/) (emission masks → regional conditioning)
- [RunComfy — AI Rendering 3D Animations](https://www.runcomfy.com/comfyui-workflows/ai-rendering-3d-animations-with-blender-and-comfyui)
- [ComfyUI Official Tutorials](https://docs.comfy.org/tutorials)
- [ComfyUI API Examples](https://github.com/comfyanonymous/ComfyUI/tree/master/script_examples)

### Статьи-референсы

- [DTF: "How to: DE в Construct 3" (iBarin)](https://dtf.ru/id30289/2299375) — чанковая система, слои, Y-сортировка
- [Disco Elysium Dev Blog — Tiling of the World](https://discoelysium.com/devblog/2016/08/18/tiling-of-the-world)
- [Pillars of Eternity — Rendering](https://eternity.obsidian.net/eternity/news/update--79-graphics-and-rendering-)
- [GDC: "Turpentine Fumes and Shaders" (Siim Raidma)](https://www.gamedeveloper.com/art/come-to-gdc-and-see-how-i-disco-elysium-i-s-unique-style-was-achieved-)

---

*Спецификация v2.0: апрель 2026*
*Пересмотрена: исправлены VRAM-оценки (FP8 обязателен), добавлен IPAdapter, исправлена атрибуция custom nodes (Inspire Pack), добавлена FLUX оценка, seed-стратегия, автоматизация ComfyUI, процесс QA, временные оценки.*
*Hardware: RTX 3080 10GB. Все инструменты бесплатные/локальные.*
