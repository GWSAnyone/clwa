# CLWA Mood & Emotional Escalation System — Deep Review

> Анализ текущей системы настроения CLWA, сравнение с индустрией и академической психологией,
> конкретные рекомендации по архитектуре.
>
> Подготовлено: Siesta (Game Systems Architecture & Affective Computing)
> Дата: April 2026

---

## 1. Текущее состояние CLWA

### Что есть сейчас

```
computeUtility = personality + moodCurve(mood) + sentimentCurve(sentiment)
                 + beliefModifiers + trust
```

**Mood** — одно число, предположительно в диапазоне -1..1 или 0..1.

**Non-linear moodCurve** — три зоны:
- Sliding zone: -0.3 to -0.6 (mood начинает влиять на crime utility)
- Desperation: -0.6 to -0.8 (сильное влияние)
- Numbness: -0.8+ (насыщение — NPC "отключается")

**Bidirectional**: позитивный mood ингибирует crime. Негативные события роняют mood, позитивные поднимают.

**Personality влияет через множители**: OCEAN+H скалы 0-1 модулируют utility score. H (Honesty-Humility) — главный ингибитор преступных affordances.

**Instinct Builder v2**: score → vivid prose (7 tiers × 3 textures × Enneagram × resistance). LLM получает эмоциональное описание и решает.

### Проблема

NPC с "тёмными" параметрами (Mark: H=0.2, sentiment к Bess -0.7) тратит несколько игровых дней чтобы достичь crime threshold. Для сессии 1.5-2 часа (≈2-3 game days при 1x) это слишком медленно. Нужен баланс: crime должен быть органичным, но укладываться в arc сессии.

---

## 2. Индустрия: как другие решают mood → action

### 2.1 RimWorld — Threshold Model

**Модель:** 0-100% mood bar. Три порога: minor (35%), major (20%), extreme (5%). Ниже порога — вероятность mental break нарастает со временем.

**Сильные стороны:**
- Просто. Один взгляд на бар и ты знаешь ситуацию.
- "Thoughts" (мысли) — каждый модификатор виден отдельно (-8 за боль, +5 за хорошую комнату). Transparent и debuggable.
- Catharsis: после mental break +40 mood на 2.5 дня. Предотвращает спирали.

**Проблемы (обратная связь от игроков):**
- Mood реагирует "в моменте". Колонист может сломаться вечером, хотя весь день был счастлив, потому что к вечеру накопились мелкие debuffs (голод, усталость, дискомфорт). Игроки описывают это как "пилу" — резкие колебания вместо плавного тренда.
- Нет разницы между "плохой день" и "плохая жизнь". Одно большое событие и два часа мелких раздражителей дают одинаковый break.
- Трейты работают через threshold offset, не через response curve. "Nervous" просто сдвигает порог вверх.

**Урок для CLWA:** Прозрачность — хорошо. Однослойность — проблема для narrative depth.

### 2.2 Dwarf Fortress — Dual-Layer Stress

**Модель:** Два независимых трека:
- **Short-term stress** (-100K to +100K): реактивный, отражает текущий момент.
- **Long-term stress** (-50K to +120K): медленная аккумуляция. Дрейфует к short-term, но с огромной инерцией.

Mental breakdown возможен **только когда оба трека высоки**. Это означает: одно плохое событие (high short-term) при нормальном long-term → NPC грустит, но не ломается. Нужна **устойчивая** нагрузка.

**Три personality traits определяют динамику:**
- **Bravery** → скорость накопления стресса (как быстро events конвертируются в stress points)
- **Stress vulnerability** → порог слома (сколько stress нужно для breakdown)
- **Anxiety** → скорость рассеивания (как быстро стресс уходит)

**Ключевая асимметрия:** Recovery в ~2× быстрее accumulation (43K/year recovery vs 20K/year max accumulation при идеальных условиях). Это означает: позитивная среда быстро лечит, но глубокая травма требует **лет** для полного восстановления.

**Память:** Дварфы **пересматривают** старые воспоминания и получают повторный стресс от них. Но сила повторного стресса убывает. Это создаёт "длинный хвост" — травматическое событие продолжает влиять месяцами, но с убывающей силой.

**Проблемы:** Система настолько инерционна что игроки жалуются на невозможность повлиять на happy dwarves — они практически не ломаются даже в плохих условиях. А те кто уже stressed — почти нечинимы.

**Урок для CLWA:** Dual-layer = идея мощная, но инерция должна быть настроена под длину сессии. DF рассчитан на десятки часов, CLWA — на 1.5-2 часа.

### 2.3 The Sims — Need Decay + Mood Buffs

**Модель:** Отдельные потребности (hunger, fun, social, hygiene, bladder, energy) деградируют независимо. Mood = агрегат всех потребностей + temporary buffs от событий.

**Сильные стороны:**
- Очень понятная причинность: mood плох **потому что** hungry. Не абстрактный "стресс".
- Decay rates — настраиваемые. Hunger: 0 → max за ~16 часов. Social: за ~38 часов. Разные потребности создают разный "ритм".
- Мудлеты (buffs/debuffs) от событий имеют duration и intensity. "Смерть друга" = -8 на 48 часов. "Хороший обед" = +2 на 3 часа.

**Проблемы:** Слишком гранулярно для CLWA (NPC не ходят в туалет). Но принцип "конкретные причины с конкретной длительностью" — золото.

**Урок для CLWA:** Mood modifiers должны иметь magnitude + duration + source. Не просто "mood -0.1" а "mood -0.15 because betrayal, duration 480 game minutes, decay exponential".

### 2.4 IAUS (Infinite Axis Utility System) — Response Curves

**Модель:** Каждый input (mood, hunger, threat) нормализуется в [0,1]. Каждый NPC имеет свою **response curve** для каждого input. Один и тот же mood level даёт разный utility для разных NPC.

**Типы кривых:**
- **Logistic** (S-curve): порог + резкий скачок. "До -0.4 — ничего, потом резко нарастает".
- **Quadratic** (late surge): медленный рост, потом ускорение. "Терпеливый NPC".
- **Linear**: равномерный рост. "Стоик — рациональный, без эмоциональных скачков".
- **Exponential** (early surge): быстрый рост с начала. "Impulsive NPC".

**Мультипликативное объединение:** `crime utility = mood_curve(mood) × personality_curve(H) × opportunity_curve(target_present)`. Если любой множитель = 0, итог = 0. "Если нет причины — действие невозможно".

**Урок для CLWA:** Ты уже используешь non-linear curves, но фиксированные зоны. Сдвиг к per-personality curves — мощная и архитектурно чистая оптимизация.

### 2.5 GAMYGDALA — OCC-Based Emotion Engine

**Модель:** Академический emotion engine на основе OCC (Ortony, Clore, Collins) appraisal theory. Разработчик определяет **goals** для NPC и аннотирует **events** их влиянием на goals.

**Ключевые механизмы:**
- **Goal-based appraisal:** "событие X приближает/отдаляет goal Y NPC Z" → emotion type + intensity.
- **Logarithmic combination:** Множественные эмоции комбинируются не аддитивно, а логарифмически (Reilly's function). Первое сильное событие — огромный вклад. Последующие — убывающий. Это предотвращает эмоциональный "overflow".
- **Exponential decay:** Каждый тик эмоции теряют intensity × decay_factor. Default: 0.8/sec.
- **Social emotions:** Anger, pity, gloating — направлены на конкретного NPC, не абстрактные.

**Двухступенчатые эмоции:** Fear → Relief (когда угроза исчезает, relief пропорционален intensity of fear). Это создаёт эмоциональные "волны".

**Урок для CLWA:** Идея goal-based appraisal мощная, но для CLWA overkill на текущем этапе. Однако logarithmic combination и exponential decay — конкретные механики которые решают проблему "overflow" и "mood стагнация".

---

## 3. Психология: что наука говорит о человеческих эмоциях

### 3.1 OCC Model (Ortony, Clore, Collins) — Appraisal Theory

OCC — самая цитируемая модель эмоций в computational affective computing. 22 типа эмоций, все определяемые через **оценку ситуации** (appraisal), а не через симптомы.

Три ветви оценки:
1. **Events → desirability** (для моих целей): joy/distress, hope/fear, relief/disappointment
2. **Actions → praiseworthiness** (моральная оценка): pride/shame, admiration/reproach
3. **Objects → appealingness** (привлекательность): love/hate

**Почему это релевантно для CLWA:** Твой NPC Mark (H=0.2, sentiment к Bess -0.7) не просто "в плохом mood". Он переживает **конкретные эмоции**: resentment (reproach toward Bess's knowledge of his fraud), fear (that his secret will be exposed), anger (at his financial situation). Каждая эмоция имеет **разную динамику** — fear нарастает от каждого напоминания, resentment тлеет стабильно, anger вспыхивает и гаснет.

**Текущий CLWA** сжимает всё это в одно число "mood". Это работает для utility scoring, но теряет narrative richness.

### 3.2 PAD Model (Pleasure-Arousal-Dominance)

Все эмоции можно описать тремя измерениями:
- **Pleasure** (-1..1): приятно/неприятно (= твой mood)
- **Arousal** (0..1): активация/апатия
- **Dominance** (0..1): контроль/беспомощность

**Критически важно для CLWA:** Anger = {P: -0.51, A: 0.59, D: 0.25}. Fear = {P: -0.64, A: 0.60, D: -0.43}. Оба негативны по Pleasure, но **Dominance** противоположна. Angry NPC чувствует контроль → агрессия. Fearful NPC чувствует беспомощность → бегство/подчинение.

**Связь с Big Five (Mehrabian, 1996):**
- **Extraversion** = primarily Dominant + Pleasant
- **Agreeableness** = Pleasant + Arousable + Submissive
- **Neuroticism** = inverse of Pleasant + Arousable (= easily distressed + high reactivity)
- **Conscientiousness** = Pleasant + Dominant

Это означает: твои OCEAN значения **уже содержат** PAD-предрасположенность! NPC с высоким N (neuroticism) = high arousability + low pleasure baseline. NPC с низким A (agreeableness) = low dominance tolerance → быстрее переходит к hostility.

### 3.3 Emotion Dynamics — Temporal Patterns

Психологические исследования показывают что эмоции НЕ работают как "плюс/минус к числу":

**Adaptation (hedonic treadmill):** Люди возвращаются к baseline happiness после позитивных/негативных событий. Скорость возврата зависит от personality. Это = exponential decay к baseline.

**Asymmetry of affect:** Негативные события вызывают более сильную и длительную реакцию чем позитивные той же magnitude. Ratio ≈ 2:1 (Baumeister et al., "Bad is Stronger than Good").

**Emotional inertia:** Люди с высоким neuroticism демонстрируют бо́льшую "эмоциональную инерцию" — их mood менее реактивен на позитивные события но более sticky к негативным. Это не просто "более грустные" — это "медленнее восстанавливаются".

**Rumination:** Пересматривание негативных событий усиливает их эмоциональный вклад. Люди с высоким N склонны к rumination. В DF это реализовано через "revisiting long-term memories".

### 3.4 Appraisal → Action Tendency

Ключевой мост от эмоции к поведению:

| Emotion | Action Tendency | CLWA Mapping |
|---------|----------------|--------------|
| Anger | Attack, confront | steal, kill, intimidate |
| Fear | Flee, freeze | lay_low, flee, destroy_evidence |
| Contempt | Dismiss, exploit | blackmail, sell_fake_goods |
| Disgust | Reject, distance | avoid, refuse cooperation |
| Desperation | Any extreme action | murder (when nothing else works) |
| Resentment | Slow-burn sabotage | long-term planning, escalation |

**Для CLWA:** Разные emotions → разные affordance boosts. Anger boosts aggressive affordances. Fear boosts defensive/evasion. Desperation (= low mood + low dominance + high arousal) boosts **extreme** affordances. Это создаёт personality-driven crime variety: angry Mark confronts, fearful Mark poisons.

---

## 4. Диагностика: точечные проблемы CLWA

### Проблема 1: Однослойный mood = no momentum

**Симптом:** NPC получает негативное событие → mood падает → mood восстанавливается → падает → восстанавливается. "Пила" вместо нарастающего давления.

**Причина:** Mood одномерный и мгновенный. Нет разницы между "плохой момент" и "плохая тенденция".

**Решение:** Dual-layer (surface + deep). Deep mood дрейфует к surface, crime utility считается от deep.

### Проблема 2: Фиксированные зоны = одинаковые для всех

**Симптом:** Mark (H=0.2) и Aldric (H=0.9) входят в sliding zone при одном и том же mood level. Разница только в множителе utility, но **порог** одинаков.

**Причина:** moodCurve зоны (-0.3/-0.6/-0.8) — глобальные константы.

**Решение:** Personality-shifted zones. Порог entry = f(personality). Или: per-personality response curves (IAUS style).

### Проблема 3: Нет asymmetry

**Симптом:** Mood падает и восстанавливается с одинаковой скоростью. Одно позитивное событие полностью компенсирует негативное той же величины.

**Причина:** Mood modifiers симметричны.

**Решение:** Asymmetric rates: negative events → fast impact, slow recovery. Positive events → moderate impact, moderate recovery. Ratio 2:1 (как в психологии и DF).

### Проблема 4: Нет escalation memory

**Симптом:** NPC совершил мелкое преступление (petty theft). Mood recovery → через некоторое время он опять на baseline, как будто ничего не было. Нет "I got away with it, I can do more".

**Причина:** Нет механизма для "crossed threshold = permanent state change" на уровне mood system. (Trauma Layer запланирован, но это не то — trauma = rare events. Нужен механизм для escalation.)

**Решение:** Criminal confidence / heat as separate state variable. Успешное crime → confidence += 0.1. Confidence снижает effective crime threshold. Неудачное crime (caught) → confidence = 0. Это отдельно от mood.

### Проблема 5: Нет emotional variety в instinct builder

**Симптом:** Instinct builder генерирует "you feel an urge to steal" — одна эмоция. Но реальная мотивация может быть fear-based ("if they find out about the fake spices, you're finished") или anger-based ("she has no right to threaten you") или desperation-based ("there's no other way").

**Причина:** Instinct builder получает один utility score. Не знает **почему** score высокий.

**Решение:** Emotional tagging на affordance level. Каждый affordance имеет dominant_emotion field (anger, fear, contempt, desperation). Instinct builder использует это для текстуры описания. Уже частично есть через instinctContext, но emotion-aware framing сделает prose qualitatively richer.

---

## 5. Предлагаемая архитектура: Emotional Dynamics v1

### 5.1 Dual-Layer Mood

```
surfaceMood: number  // -1..1, реагирует мгновенно на события
deepMood: number     // -1..1, дрейфует к surfaceMood медленно
```

**Tick update:**
```
delta = surfaceMood - deepMood
driftRate = baseDriftRate × (1 + N × 0.5)  // Neurotic = faster accumulation
deepMood += delta × driftRate × tickDuration

// Asymmetry: negative drift faster than positive recovery
if (delta < 0) driftRate *= negativeBias  // negativeBias = 1.5-2.0
```

**Utility scoring:** `moodCurve(deepMood)` вместо `moodCurve(surfaceMood)`.

**Зачем:** Mark получает плохое событие → surfaceMood падает → deepMood медленно ползёт вниз → за 30-60 game minutes достигает sliding zone → crime becomes viable. Одно позитивное событие поднимает surfaceMood, но deepMood recovery медленнее → NPC остаётся "на грани" дольше.

**Настройка под сессию 1.5-2h:**
- baseDriftRate: ~0.003/game minute (deepMood сдвигается на 0.18 за 60 game min)
- С negativeBias 1.8: падение на 0.324 за 60 min, recovery 0.18 за 60 min
- NPC со starting mood -0.1 и одним big negative event (-0.3 surface): deep достигает -0.3 за ~45 min
- Это укладывается в Phase 2 (Escalation) GDD

### 5.2 Personality-Shifted Zones

```
slidingEntry = -0.3 + (H - 0.5) × 0.3
// H=0.2: slidingEntry = -0.3 + (-0.3 × 0.3) = -0.39  → easier entry
// H=0.9: slidingEntry = -0.3 + (0.4 × 0.3) = -0.18   → harder entry
// Wait: this is backwards. Low H = crime easier = LOWER threshold (enters sooner)

// Corrected:
slidingEntry = -0.15 - (1 - H) × 0.3
// H=0.2: -0.15 - 0.24 = -0.39  → needs mood -0.39 to enter sliding
// Hmm still wrong direction. Let me think clearly.

// The HIGHER slidingEntry is (closer to 0), the EASIER it is to enter sliding zone
// Low H NPC should enter sliding zone at LESS negative mood
slidingEntry = -0.3 + (1 - H) × 0.2
// H=0.2: -0.3 + 0.16 = -0.14  → enters sliding at mood -0.14 (very easy)
// H=0.5: -0.3 + 0.10 = -0.20  → enters sliding at mood -0.20
// H=0.9: -0.3 + 0.02 = -0.28  → enters sliding at mood -0.28 (hard)
```

Аналогично для desperation и numbness зон. Результат: Mark (H=0.2) попадает в sliding zone при mood -0.14, а Aldric (H=0.9) — только при -0.28. При одинаковом deepMood -0.2, Mark уже в sliding а Aldric ещё нет.

### 5.3 Mood Modifiers with Duration

Вместо прямого `mood += delta`:

```typescript
interface MoodModifier {
  source: string          // 'betrayal', 'good_conversation', 'witnessed_crime'
  magnitude: number       // -0.3 to +0.3
  duration: number        // game minutes, 0 = permanent until cleared
  decay: 'exponential' | 'linear' | 'step'
  elapsed: number         // game minutes since applied
  category: string        // for stacking rules
}
```

**surfaceMood = baseMood + Σ(active modifiers with decay applied)**

**Стacking rules:** Max 1 per category (strongest wins). Prevents: 5 мелких разговоров = одно большое событие.

**Примеры:**
| Event | Magnitude | Duration | Decay |
|-------|-----------|----------|-------|
| Betrayal by trusted NPC | -0.35 | 720 min (12h) | exponential |
| Good conversation | +0.05 | 120 min (2h) | linear |
| Witness murder | -0.25 | 1440 min (24h) | exponential |
| Successful theft | +0.10 | 180 min (3h) | linear |
| Insult from stranger | -0.05 | 60 min (1h) | linear |
| Praised by respected NPC | +0.08 | 180 min (3h) | linear |

**Зачем:** Debuggable. Видно почему NPC в таком mood. Прозрачно для overlay (UI может показывать active modifiers). Автоматический decay — не нужен ручной cleanup.

### 5.4 Arousal как второе измерение

Простая добавка:

```
arousal: number  // 0..1
// Растёт от: негативных событий, конфликтов, присутствия угрозы, crime nearby
// Падает: со временем (decay), позитивные социальные взаимодействия, schedule routine
```

**Зачем:** Mood = -0.3 + Arousal = 0.2 → NPC грустит, но пассивен (resentment, withdrawal). Mood = -0.3 + Arousal = 0.8 → NPC грустит И возбуждён → агрессия, импульсивные решения.

**Для utility:** `criminalUtility *= arousalMultiplier(arousal)`. Где arousal > 0.5 → multiplier > 1.0.

**Для instinct builder:** High arousal + negative mood = "your blood boils" vs low arousal + negative mood = "cold contempt settles in your chest".

### 5.5 Criminal Confidence (Escalation State)

```
criminalConfidence: number  // 0..1, per NPC
// += 0.15 on successful crime (not caught)
// += 0.05 on successful cover-up
// = 0 on caught/arrested
// decay: very slow (0.01/game day)
```

**Effect:** Reduces effective crime threshold. `effectiveThreshold = threshold × (1 - confidence × 0.3)`.

**Narrative:** "He got away with watering down the ale for months. Then the fake spices. Each time easier. By the time he considered the knife, it felt almost logical."

**Зачем решает проблему:** Без confidence, NPC после crime возвращается к baseline mood → нет escalation. С confidence, даже при neutral mood, прошлые успехи снижают порог → organic escalation pyramid (minor → moderate → severe) из GDD.

---

## 6. Интеграция с существующей архитектурой

### Что меняется в engine

| Компонент | Изменение | Complexity |
|-----------|-----------|------------|
| AgentState | +`deepMood`, +`arousal`, +`moodModifiers[]`, +`criminalConfidence` | Low |
| Clock tick | +deepMood drift, +modifier decay, +arousal decay | Low |
| computeUtility (AL) | `moodCurve(deepMood)` вместо `moodCurve(mood)`, +arousal multiplier | Low |
| Instinct Builder | +emotion tag awareness, +arousal-driven texture | Medium |
| moodCurve zones | Personality-shifted thresholds | Low |
| Save/Load | Serialize new fields | Low |

### Что НЕ меняется

- LLM volition pipeline
- Affordance definitions (они получают уже готовый utility score)
- CG rules
- Beliefs, Goals, Perception, IL
- TopicEngine (moodValence → surfaceMood modifier)
- Registry pattern

### Engine vs Module boundary

Все новые поля (deepMood, arousal, moodModifiers) — **engine level**. Они universal: Economy module будет использовать arousal (рыночная паника), Social module будет использовать deepMood (долгосрочное счастье). Criminal confidence — **module level** (crime-justice specific). Регистрируется через existing registry pattern.

---

## 7. Калибровка под GDD Detective Session

### Целевой arc (из GDD)

```
Phase 1: Arrival (~15-20 min)     — NPC moods neutral, tensions simmering
Phase 2: Escalation (~20-30 min)  — minor incidents, mood deterioration, arousal rises
Phase 3: Crime (~30-40 min)       — criminal crosses threshold, major event
Phase 4: Resolution (~20-30 min)  — investigation, consequences
```

### Числа для Mark (H=0.2, starting deepMood -0.1)

```
Game minute 0:   surfaceMood = -0.1, deepMood = -0.1, arousal = 0.1
                 slidingEntry = -0.14 (his personal threshold)
                 deepMood > slidingEntry → not yet in sliding zone

Game minute 30:  Argument with Bess (modifier: -0.15, 360min)
                 surfaceMood = -0.25, deepMood drifting toward -0.25
                 arousal += 0.15 → 0.25

Game minute 60:  deepMood ≈ -0.18 (drifted with negativeBias 1.8)
                 Crosses slidingEntry (-0.14)! Crime utility starts rising.
                 But utility still moderate. Minor crime possible.

Game minute 90:  Another tension event (debt pressure modifier: -0.1)
                 surfaceMood = -0.30, deepMood ≈ -0.24
                 arousal maintained at ~0.3 (conflict nearby)
                 Instinct builder: "The walls are closing in. Bess could ruin everything."

Game minute 120: deepMood ≈ -0.28, arousal spike from confrontation: 0.6
                 Crime utility = high. LLM receives intense instinct prose.
                 If no intervention → crime occurs here.

Game minute 150+: If player warned victim / confronted Mark → mood modifier positive,
                  arousal drops, crime delayed or prevented.
                  If crime occurred → criminalConfidence += 0.15, escalation possible.
```

### Контроль: Aldric (H=0.9, starting deepMood 0.1)

```
Same events:     slidingEntry = -0.28
                 deepMood after 120 min ≈ -0.12 (same events affect him less)
                 Still above his sliding entry → crime utility negligible
                 Even at deepMood -0.28, his H=0.9 multiplier suppresses crime affordances
                 Result: Aldric never commits crime unless extreme circumstances
```

---

## 8. Приоритизация имплементации

| # | Feature | Impact | Effort | Рекомендация |
|---|---------|--------|--------|-------------|
| 1 | Mood Modifiers with Duration | Highest | Low | **Первым.** Решает debuggability + основа для всего остального |
| 2 | Dual-Layer (surface + deep) | High | Low | **Вторым.** Решает главную проблему — mood momentum |
| 3 | Personality-shifted zones | High | Low | **Третьим.** Дифференцирует NPC по склонности к crime |
| 4 | Criminal Confidence | Medium | Low | **Четвёртым.** Решает escalation (minor → major crime) |
| 5 | Arousal dimension | Medium | Medium | **Пятым.** Enriches instinct variety, но не блокер для pacing |
| 6 | Emotional tagging | Low-Med | Medium | **Позже.** Quality of life for instinct prose, не для mechanics |

Общий estimate: пункты 1-4 = несколько дней работы. Максимальный ROI на pacing.

---

## 9. Риски

**Overengineering:** 6 новых переменных на NPC — это уже complexity. Для 8 NPC нормально, для 1000 — каждая переменная стоит RAM и tick processing. Но всё числовое (не LLM), так что O(n) с малым коэффициентом.

**Balance hell:** Больше переменных = больше knobs to tune. Митигация: все константы через WorldConfig (уже паттерн в CLWA). Один JSON для всех rates/thresholds.

**Dual-layer opacity:** Deep mood invisible для игрока. Игрок видит NPC "выглядит нормально" а через минуту он совершает crime. Митигация: overlay показывает deepMood trend (стрелка вверх/вниз), не точное число. Или: NPC body language hints (fidgeting, avoiding eye contact) привязанные к deepMood range.

**Psychology accuracy vs gameplay:** Реальная психология — медленная. CLWA сжимает месяцы в минуты. Это нормально. Sims делает так же. Важно сохранить **каузальную логику** (sequence of events makes narrative sense), не **временную точность**.

---

## 10. References & Further Reading

**Игровой дизайн:**
- RimWorld Wiki: Mood, Mental Break, Mental Break Threshold
- Dwarf Fortress Wiki: Stress, Emotion, Keeping your dwarves unstressed
- IAUS Framework: Response curves, multiplicative scoring (tonogameconsultants.com)
- GAMYGDALA: OCC-based emotion engine for games (Popescu, Broekens, van Someren, 2014)

**Психология:**
- OCC Model: Ortony, Clore, Collins — "The Cognitive Structure of Emotions" (1988, revised 2022)
- PAD Model: Mehrabian & Russell (1974), Mehrabian (1996) — Big Five ↔ PAD mapping
- FAtiMA: Dias et al. (2014) — continuous-time OCC + Scherer appraisal
- "Bad is Stronger than Good": Baumeister et al. (2001) — negativity bias 2:1

**Computational models:**
- Emotion Modeling in Social Simulation survey (JASSS, 2018)
- Computational Approaches to Modeling Artificial Emotion (Frontiers in Robotics, 2016)
- AppraisalCloudPCT: Computational model for socially interactive robots (PMC, 2023)

---

*Prepared for CLWA v0.11.0-dev. Targeted at GDD Detective Mode session pacing.*
*Архитектурная совместимость: все предложения respecting engine/module boundary, registry pattern, WorldConfig centralization.*
