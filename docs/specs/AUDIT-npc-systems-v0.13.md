# AUDIT: NPC Systems Quality — v0.13.0

> **Milestone**: Audit
> **Status**: Active
> **Depends on**: All M3 systems (done)
> **Engine changes**: None. Analysis document.
> **Created**: 2026-04-13
> **Commit**: f94aa79 (v0.13.0, M3 complete). **Date**: 2026-04-13.
> **Method**: Символьный анализ (Serena), sequential thinking, сравнение с индустрией (Dwarf Fortress, Rimworld, LLM-agent research 2025-2026).
> **Limitation**: Qualitative. Эмпирическая верификация не проводилась.

---

## Strengths — что объективно отлично

| Аспект | Почему это хорошо | Индустрийный контекст |
|--------|-------------------|----------------------|
| **Engine/Module separation** | 40+ реестров, ноль хардкода модульных значений в engine | Ни Dwarf Fortress, ни Rimworld не имеют такой чистой границы. Добавление Economy модуля = ноль изменений engine. |
| **Bilateral design** | Player = Agent с isPlayer flag. Одна система beliefs, mood, relationships | Большинство игр имеют раздельные системы для player и NPC. Здесь — genuine information asymmetry |
| **Belief-driven behavior** | NPC действуют по знаниям, не по глобальной истине. Ложный свидетель → guard действует по ложной информации | Уникально для LLM-game систем. Research 2025 указывает на "lack of long-range belief tracking" как открытую проблему — CLWA это решает |
| **CG v2 exclusive groups** | Personality-driven branching на уровне последствий. Одно событие → разные NPC-реакции по traits/relationships | Не найдено аналогов в опубликованных системах game AI |
| **Instinct Builder** | 7 tiers × 3 textures × Enneagram × resistance. Каждый NPC получает уникальную prose-описание instinct | Ни один LLM-game framework (Inworld, NVIDIA ACE) не генерирует instinct-prose такой глубины |
| **Structured mood modifiers** | Typed modifiers с decay curves, categories, personality-shifted zones | Сложнее Rimworld mood system (flat stacking buffs). Personality-shifted moodCurve — оригинальный дизайн |

---

## Findings — проблемы и области для улучшения

### F1. Mood Feedback Loop — HYPOTHESIS, требует верификации

**Статус**: UNVERIFIED — теоретический анализ, не эмпирический

**Теоретический цикл**:
```
bad mood → crime → witness shock (-0.3) → gossip → more shock
→ damaged relationships → social stress drift → worse mood
→ conversation with rival WORSENS sentiment (sent × 0.02)
→ more crime → repeat
```

**Существующие демпферы (которые МОГУТ предотвращать spiral)**:
- baseMood фиксирован и положителен для большинства NPC (0.3 - N×0.4 + E×0.2). Только N>0.75 имеют отрицательный baseline
- Trauma modifiers имеют exponential decay — magnitude уменьшается со временем
- Numbness zone (mood < -0.8): crime utility ПАДАЕТ (×0.6 multiplier), что естественно тормозит спираль
- Cooldowns (180 min на affordance, 60 min на decision) создают паузы между преступлениями
- NPC могут быть arrested/exiled/killed — преступник выбывает, цикл прерывается

**Что неизвестно без эмпирической проверки**:
- Достаточен ли exponential decay для компенсации -0.3 шока?
- Как быстро social stress drift достигает ceiling?
- Сколько тиков до первого убийства при разных personality sets?
- Какой средний mood города через 500 тиков?

**TODO — верификация**:
```
1. Запустить сервер, прогнать 200+ тиков на 3x speed
2. GET /api/debug/snapshot каждые 50 тиков
3. GET /api/debug/mood-history/:id для всех NPC
4. Зафиксировать: время до первого crime, mood trajectory, количество living NPCs
5. Повторить 3 раза с разными seeds
6. Если средний mood < -0.5 к тику 200 — spiral подтверждён
7. Если mood колеблется в [-0.3, 0.1] — демпферы работают
```

**Если spiral подтвердится — предлагаемые решения**:
- `community_recovery` day advance handler — малый позитивный drift при отсутствии преступлений за день
- Trauma floor — модификатор от шока не ниже -0.15 после 1 game day
- Social resilience — разговоры с нейтральными+ NPC дают усиленный mood boost когда средний mood < -0.3

---

### F2. Conversation Pair Starvation — VERIFIED architecturally

**Статус**: CONFIRMED — follows from code analysis

**Проблема**: 8 NPC в 8 локациях. `ConversationScheduler.findPair()` ищет двух NPC на одной локации. Если NPC разбросаны (каждый на своей локации), пары не формируются. NPC часами не разговаривают.

**Усугубляющие факторы**:
- Schedule system фиксирует NPC на их постах (guard → gate, blacksmith → forge, priest → temple)
- Pair cooldown 240 min (4 hours) блокирует повторные пары
- При 8 NPC в 8 локациях: C(1,2)=0 пар на каждой локации

**Когда работает**: NPC перемещаются по целям (gossip, report_crime, grieve → сходятся в локациях). Socialize affordance (E > 0.7) создаёт movement к другим NPC. Таверна как hub собирает несколько NPC вечером.

**Когда ломается**: Тихие периоды (нет преступлений, нет movement goals) → NPC сидят на постах → zero conversations → zero belief transfer → game stagnates.

**Предлагаемые решения**:
- "Social gravity" — NPC без goals drift к ближайшему NPС с вероятностью ∝ E
- Schedule breaks — NPC покидают пост на 30-60 min в обед/вечер → hub locations
- Lower socialize threshold: E > 0.5 вместо E > 0.7 (охватит больше NPC)

---

### F3. Goal Preemption — Guard Robot Problem — VERIFIED architecturally

**Статус**: CONFIRMED

**Проблема**: Guard (Garrett) получает arrest goal (priority 9). Пока goal активен, ВСЁ остальное поведение блокировано — нет conversations, нет patrol, нет social. Guard становится роботом, идущим к цели.

Это корректно для arrest, но:
- Investigate (priority 9) может длиться долго (move → examine → interrogate → announce → home)
- Во время investigate guard не реагирует на НОВЫЕ преступления
- Guard не разговаривает с player (не в player chat, но goal step блокирует volition)
- Если investigate target далеко — guard ходит 10+ тиков, фактически offline

**Когда это проблема**: Player пытается поговорить с guard → guard идёт к crime scene → недоступен. Player вынужден ждать или бежать за ним.

**Контраргумент**: Это может быть **intentional** — guard занят расследованием, player должен тоже работать. "Busy guard" = narrative tension.

**Предлагаемые решения (если считаем проблемой)**:
- Interruptible goals: player chat → pause current goal, resume after
- Priority layering: player interaction = priority 10 (overrides all)
- Goal timeout: если goal не продвигается 30+ min → abort + log

---

### F4. Memory Eviction — Important Memories Lost — VERIFIED architecturally

**Статус**: CONFIRMED — follows from memory system design

**Проблема**: VectorMemory capacity = 200 per NPC. Eviction removes lowest-importance non-protected memories. В длинной сессии:
- Conversation memories (importance 3-5) накапливаются быстро
- Crime witness memories (importance 7-8) protected, но ограниченно
- Ранние conversation memories о подозрениях, намёках, personality traits → вытесняются свежими
- NPC "забывает" что обсуждал с player на Day 1, если играть до Day 5+

**Масштаб**: При 4 conversations/day × 2 memories each = 8 memories/day → capacity 200 → overflow на Day 25. При 3x speed это ~8 часов реального времени.

**Контраргумент**: 25 game days — длиннее типичной сессии (1-3 часа). На практике overflow маловероятен.

**Предлагаемые решения (для длинных сессий)**:
- Importance-based consolidation: merge старые low-importance memories в summary
- Player interaction memories = protected (player-sourced memories важны для narrative)
- Adaptive capacity: scale с gameDay (200 base + 10/day)

---

### F5. Information Spread — Design Choice, Not Bug

**Статус**: DESIGN REVIEW — не баг, а дизайн-решение для обсуждения

**Наблюдение**: За ~2 game дня все NPC узнают о преступлении. Rumor confidence 0.4 на любом уровне цепочки.

**Контекст**: 8 NPC в маленькой деревне. В реальной деревне на 8 жителей ВСЕ действительно знают всё за день. Текущее поведение **реалистично для масштаба**.

**Когда станет проблемой**: При масштабировании до 20-50 NPC. В городе на 50 человек flat rumor spread = нереалистичная телепатия.

**Предлагаемые решения (для масштабирования, не для текущего M3)**:
- Chain-based confidence decay: rumor-from-rumor = conf × 0.6-0.7
- Location-based spread: rumors travel через location adjacency, не instant
- Topic staleness: weight убывает с game days since event

---

### F6. Escalation Predictability — Intentional Design With Tradeoffs

**Статус**: DESIGN REVIEW — сознательное решение с обсуждаемыми tradeoffs

**Наблюдение**: Мотив растёт линейно +0.03-0.06/час. Если знать personality → можно вычислить точное время убийства.

**Design intent**: Предсказуемый timeline = player МОЖЕТ вмешаться. Если знает паттерн — может предотвратить. Random walk = player не знает когда действовать → frustration.

**Tradeoffs**:
| Аспект | Linear (текущий) | Random walk | Event-triggered |
|--------|------------------|-------------|-----------------|
| Player agency | Высокая (предсказуемо) | Низкая (непредсказуемо) | Средняя (зависит от контекста) |
| Narrative texture | Низкая (mechanical) | Высокая (surprise) | Высокая (contextual) |
| Replayability | Низкая (same timeline) | Высокая | Средняя |
| Debug/tune | Легко | Сложно | Средне |

**Отсутствующие элементы (не зависят от linear vs random)**:
- Нет de-escalation: reconciliation, apology, motive cooling от позитивных interactions
- Blackmail step handler: missing rung в escalation staircase (M3 known debt)
- Argue outcome: нет шанса на разрядку после конфронтации

**Рекомендация**: Оставить linear growth как base, добавить event-triggered spikes и de-escalation. Не переходить на random walk — это ухудшит player agency.

---

### F7. LLM Calibration — Needs Measurement, Not Assumptions

**Статус**: NEEDS DATA — generic concerns, не CLWA-specific баги

**Наблюдения** (generic для любой LLM-game системы):
- Utility score ≠ guaranteed choice. LLM has final say (by design — invariant #13)
- 9B model less reliable than 70B+ at nuanced extraction
- Conversation semantic drift possible over 4 exchanges

**Что CLWA уже делает для mitigation**:
- Constrained decoding via JSON schema (гарантирует valid output structure)
- Temperature 0.35 (low randomness)
- Instinct builder 7 tiers (higher score = more vivid prose = stronger pressure)
- Anti-repetition penalties (repeat_penalty, frequency_penalty, presence_penalty)

**Что НЕ ИЗВЕСТНО без метрик**:
- Какой % decisions расходится со top-scoring affordance?
- Какой % IL extractions имеет confidence < 0.3?
- Как часто conversation drifts off-topic к exchange 4?

**TODO — measurement**:
```
1. Добавить decision audit log: {npcId, topAffordance, topScore, actualChoice, actualScore}
2. Прогнать 100+ volition decisions
3. Подсчитать concordance rate (actual == top scored %)
4. Если < 60% — calibration problem. Если > 80% — system works as designed.
5. Для IL: log extractionConfidence distribution, count < 0.3 cases
```

---

### F8. Trait Asymmetry — O/E Underused

**Статус**: CONFIRMED — verified via affordance weight analysis

| Trait | Механическое влияние | Impact |
|-------|---------------------|--------|
| **Honesty (H)** | moodCurve zone shift, вес на ВСЕ crime affordances (0.2-0.4), corruption threshold | **Critical** — главный trait в системе |
| **Neuroticism (N)** | baseMood (-0.4), motive growth rate, moodWeight на crime | **High** — определяет mood trajectory |
| **Agreeableness (A)** | Resist violence (kill/threaten), grief-revenge condition (A < 0.4) | **Medium** — gatekeeper на тяжёлые преступления |
| **Conscientiousness (C)** | Вес на duty affordances (investigate 0.3, arrest 0.3) | **Medium** — role-specific для guard/judge |
| **Extraversion (E)** | baseMood (+0.2), socialize trigger (E > 0.7) | **Low-Medium** — только mood и social |
| **Openness (O)** | +0.1 на investigate (guard-only) | **Negligible** — фактически placebo |

**Контекст**: В Crime & Justice модуле H и N доминируют по design — это модуль о преступлениях. O мог бы быть critical в Economy модуле (curious → explore markets, discover opportunities). Текущая ситуация — не баг, а следствие единственного модуля.

**Рекомендация (low priority)**:
- O: curious NPCs чаще исследуют слухи, ищут crime scenes → вес на gossip, report_crime
- E: extraverts быстрее распространяют слухи (transfer weight × (1 + E×0.3))
- Enneagram: механические хуки, не только prose (Type 6 → trust +0.1 к authority, Type 8 → resist intimidation bonus)

---

### F9. Binary Guard Corruption — Simple But Readable

**Статус**: DESIGN REVIEW — simplicity vs. depth tradeoff

**Текущее**: Honesty < 0.4 = corrupt (CORRUPTION_COVER), >= 0.4 = honest (WANTED_STATUS). Бинарно, навсегда.

**Аргументы ЗА текущий дизайн**:
- Читаемость: player быстро понимает "Garrett коррумпирован" и ищет обходной путь
- Determinism: player может планировать стратегию зная поведение guard
- Simplicity: одно правило, ноль edge cases

**Аргументы ПРОТИВ**:
- Player не может влиять на corruption (trust, evidence presentation — ничего не меняет)
- Нет драматического момента "guard converts" (corruption is static data, not dynamic state)
- Другие NPC не замечают бездействие guard → no suspicion cascade

**Рекомендация**: Оставить binary для M3/M4. Revisit при добавлении "corruption arc" narrative. Quick win: добавить alternative justice path (player → judge напрямую если guard не действует).

---

## Priority Matrix

| # | Finding | Severity | Confidence | Effort | Action |
|---|---------|----------|------------|--------|--------|
| F1 | Mood feedback loop | HYPOTHESIS | Low (unverified) | Medium | **Verify first** — run empirical test before any code changes |
| F2 | Conversation starvation | CONFIRMED | High | Low | Add social gravity / schedule breaks |
| F3 | Goal preemption (guard robot) | CONFIRMED | High | Low | Player chat interrupts active goal |
| F4 | Memory eviction | CONFIRMED | Medium | Low | Protect player-interaction memories |
| F5 | Information spread | DESIGN | High | Medium | Revisit at scale (20+ NPC), OK for 8 |
| F6 | Escalation linearity | DESIGN | High | Medium | Add de-escalation + event spikes, keep linear base |
| F7 | LLM calibration | NEEDS DATA | Low | Medium | Add audit logging, measure before fixing |
| F8 | Trait asymmetry O/E | CONFIRMED | High | Low | Add O/E weights to existing affordances |
| F9 | Binary corruption | DESIGN | High | Low | OK for now, add alt justice path |

### Recommended Next Steps

**Immediate (before M4)**:
1. **Empirical verification** of F1 (mood spiral) — server run, snapshot analysis
2. **F2 fix** — social gravity or schedule breaks (prevents stagnation)
3. **F3 fix** — player chat interrupts guard goals (QoL)
4. **F7 measurement** — decision audit logging

**M4 scope**:
5. F6 — de-escalation + event-triggered motive spikes
6. F9 — alternative justice path (player → judge)
7. F4 — protect player-interaction memories

**Deferred (scale or new modules)**:
8. F5 — information chain decay (when 20+ NPC)
9. F8 — O/E trait enrichment (when Economy module)

---

## References

- [ML for Game Development: Creating Adaptive and Intelligent NPCs](https://codedrivenlabs.com/ml-for-game-development-creating-adaptive-and-intelligent-npcs/)
- [Game Role-Playing AI Agent: Transform RPGs](https://www.jenova.ai/en/resources/game-role-playing-ai-agent)
- [AI-Powered NPCs in 2025: Hype Check](https://finalboss.io/ai-powered-npcs-in-2025-hype-check-standout)
- [LLM Reasoner and Automated Planner: A new NPC approach](https://arxiv.org/html/2501.10106v1)
- [A Survey on LLM-Based Game Agents (GitHub)](https://github.com/git-disl/awesome-LLM-game-agent-papers)
- [Rimworld, Dwarf Fortress, and procedurally generated storytelling](https://www.gamedeveloper.com/design/rimworld-dwarf-fortress-and-procedurally-generated-story-telling)
- [NPC Reputation System Based on Belief Formation](https://www.sciencedirect.com/science/article/abs/pii/S1875952123000204)
- [Realistic Gossip in Trust Game on Networks](https://arxiv.org/html/2511.20248v1)
- [Dwarf Fortress Personality Facets Wiki](https://dwarffortresswiki.org/index.php/v0.34:Personality_facet)
