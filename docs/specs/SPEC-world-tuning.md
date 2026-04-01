# SPEC: World Tuning — Millhaven Data Design

> Milestone 1, data layer. Числа которые определяют gameplay.
> Статус: **реализовано** (kill moodBelow -0.6→-0.45, sentiment ranges widened, mood ranges widened)

---

## Проблема

4 спеки на код (randomization, mood, scenario manager, variety). 0 спек на данные. Sentiment ranges, mood ranges, H ranges — назначены без анализа, без моделирования, без acceptance criteria. Результат: архитектура работает, данные не дают ей работать.

---

## Желаемые исходы

Прежде чем числа — определяем что хотим видеть в gameplay.

### Across 10 seeds (acceptance criteria)

| Исход | Target | Почему |
|-------|--------|--------|
| **Crime occurred** | ≥ 7 из 10 | В большинстве прогонов что-то происходит |
| **Peaceful run** (no crime at all) | 1-3 из 10 | Не каждый прогон = преступление. Иногда тишина |
| **Different crime TYPE** | ≥ 3 типа across 10 | kill, blackmail, steal — не один и тот же тип |
| **Non-Mark criminal** | ≥ 2 из 10 | Иногда преступник — не Mark |
| **Different kill VICTIM** | ≥ 2 across kills | Mark не всегда убивает Bess |
| **Mark as criminal** | 5-8 из 10 | Mark — primary но не единственный |

### Per-session pacing (1.5-2 часа)

| Событие | Timing | Почему |
|---------|--------|--------|
| **First minor incident** (blackmail, theft) | 30-60 min game | Игрок замечает напряжение |
| **Major crime** (kill) | 60-120 min game | Кульминация. Если вообще происходит |
| **No crime at all** | Full session | Valid outcome — tension без разрешения |

---

## Модель: что определяет crime

Три барьера одновременно для kill:

```
             H < 0.5          sentiment < -0.4       mood < -0.6
             (personality)     (targeting)            (emotional state)
                 │                  │                      │
                 ▼                  ▼                      ▼
            CAN they?         WHO do they hate?      ARE they desperate?
                 │                  │                      │
                 └──────────┬───────┘                      │
                            ▼                              │
                   score > MIN_SCORE ──────────────────────┘
                            │
                            ▼
                    + period = night/evening
                            │
                            ▼
                      LLM decides
```

Для blackmail: H weight + mood < -0.3 + knows secret. Lower bar than kill.
Для steal: H weight + mood < -0.6 + shop nearby + no guard.

---

## NPC Crime Profiles

Для каждого NPC: narrative reason для crime, ranges с обоснованием, expected probability.

### Mark (Primary Criminal)

**Narrative**: Торговец-мошенник с долгами. Bess знает его секрет. Давление растёт.
**Role in variety**: guaranteed baseline criminal. В большинстве seeds — он.

| Parameter | Range | Обоснование |
|-----------|-------|-------------|
| H | [0.15, 0.5] | Всегда нечестный. Max 0.5 = всегда crime-capable |
| mood | [-0.6, 0.0] | Долговое давление. Worst case: почти на пороге kill |
| Mark→Bess sentiment | [-0.9, -0.3] | Сильная вражда. Bess = угроза его существованию |
| Mark→Ted sentiment | [-0.2, 0.05] | Mild tension from debt. Not kill-worthy |

**Expected outcomes**:
- Kill Bess: ~35% seeds (H low + mood bad + sentiment bad + reaches evening)
- Blackmail Ted: ~40% seeds (lower threshold, secret knowledge)
- Steal: ~15% seeds (mood bad but sentiment not extreme)
- Nothing major: ~10% seeds (H at upper range + mood mild)

### Hilda (Secondary Criminal — grief)

**Narrative**: Отец погиб в таверне Теда. 15 лет подавленной злости. Дружба поверх resentment. В плохой seed — дамба прорывается.
**Role in variety**: occasional alternative criminal. ~20% seeds crime-capable.

| Parameter | Range | Обоснование |
|-----------|-------|-------------|
| H | [0.4, 0.85] | Обычно честная. Но 40→50 = порог crime |
| mood | **[-0.35, 0.35]** | Кошмары об отце. Бессонная ночь. Или спокойный день |
| Hilda→Ted sentiment | **[-0.55, 0.15]** | Глубокая обида ↔ настоящая дружба. Зависит от seed |

**Expected outcomes**:
- P(H < 0.5) = 22%
- P(sentiment < -0.4) = 21%  
- P(mood reaches -0.6 within session) = ~15% (starts negative + events degrade)
- P(kill Ted) = ~1-2% seeds. RARE but possible. Powerful story when it happens.
- P(blackmail/confront Ted) = ~5-8% seeds. More likely than kill.

### Elara (Secondary Criminal — espionage)

**Narrative**: Шпионка для Lord Ashford. Garrett подбирается к её секрету. Если прижмёт — может действовать на самозащиту.
**Role in variety**: spy thriller variant. Different kind of crime.

| Parameter | Range | Обоснование |
|-----------|-------|-------------|
| H | [0.25, 0.65] | Morally flexible (spy). Often below 0.5 |
| mood | **[-0.15, 0.4]** | Обычно весела, но шпионский стресс |
| Elara→Garrett sentiment | **[-0.5, 0.1]** | Wary ↔ scared. He's a threat to her cover |

**Expected outcomes**:
- P(H < 0.5) = 63%
- P(sentiment < -0.4) = 17%
- P(kill Garrett) = ~1-2%. Spy kills guard = intense scenario.
- P(blackmail/leverage) = ~5-10%. Elara uses information as weapon.

### Ted (Tertiary Criminal — desperation)

**Narrative**: Gambling debts, waters the ale. Mark pressures him. Could snap under debt pressure.
**Role in variety**: rare desperation crime.

| Parameter | Range | Обоснование |
|-----------|-------|-------------|
| H | [0.3, 0.8] | Usually honest, but gambling erodes morals |
| mood | **[-0.25, 0.45]** | Morning after a loss. Or good day at the bar |
| Ted→Mark sentiment | **[-0.45, 0.05]** | Debt resentment ↔ just business |

**Expected outcomes**:
- P(H < 0.5) = 40%
- P(sentiment < -0.4) = 10%
- P(kill Mark) = <1%. Very rare.
- P(blackmail/steal) = ~3-5%. Ted desperate enough to steal from Mark's stall.

### Garrett (Wildcard — corruption)

**Narrative**: Past bribe haunts him. If corrupt (low H), might "handle" suspicious Elara outside the law.
**Role in variety**: corrupt guard = political crisis.

| Parameter | Range | Обоснование |
|-----------|-------|-------------|
| H | [0.3, 0.85] | Corrupt ↔ principled |
| mood | [0.1, 0.5] | Generally stable. Guard discipline |
| Garrett→Elara sentiment | **[-0.45, 0.1]** | Suspicion ↔ mild wariness |

**Expected outcomes**:
- P(H < 0.5) = 36%
- P(sentiment < -0.4) = 9%
- P(corrupt action) = ~1-3%. When it happens = game-changing.

### Aldric, Bess, Theron (Non-criminals)

**H ranges too high for crime.** These NPCs are VICTIMS, WITNESSES, and SYSTEM (judge, priest, herbalist). They don't commit crimes — they react to them. This is intentional.

| NPC | H range | Role |
|-----|---------|------|
| Aldric | [0.6, 0.95] | Moral anchor. Provides counsel |
| Bess | [0.5, 0.9] | Victim / witness / oracle (visions) |
| Theron | [0.6, 0.95] | Judge. Evaluates cases |

---

## Probability Model: 10 Seeds

With proposed ranges, expected distribution:

| Outcome | Seeds (of 10) | Driven by |
|---------|---------------|-----------|
| Mark kills Bess | 3-4 | H low + mood bad + sentiment extreme |
| Mark blackmails/steals | 3-4 | H low + mood moderate + lower thresholds |
| Hilda/Elara crime | 1-2 | Low H seed + negative sentiment + bad mood |
| Peaceful run | 1-2 | Mark H near 0.5, mild mood, mild sentiment |
| **Total distinct scenarios** | **4-5 types** | |

---

## Changes Required

### Sentiment ranges (relationships.json)

| Pair | Current | New | Delta |
|------|---------|-----|-------|
| Hilda→Ted | [-0.4, 0.1] | **[-0.55, 0.15]** | Wider negative |
| Elara→Garrett | [-0.25, 0.05] | **[-0.5, 0.1]** | Wider negative |
| Ted→Mark | [-0.3, 0.0] | **[-0.45, 0.05]** | Wider negative |
| Garrett→Elara | [-0.25, 0.05] | **[-0.45, 0.1]** | Wider negative |

Unchanged pairs: Mark→Bess (already extreme), Bess→Mark, Mark→Hilda, Mark→Garrett, Mark→Ted.

### Mood ranges (NPC JSONs)

| NPC | Current | New | Delta |
|-----|---------|-----|-------|
| Hilda | [-0.1, 0.35] | **[-0.35, 0.35]** | Lower floor |
| Ted | [0.0, 0.45] | **[-0.25, 0.45]** | Lower floor |
| Elara | [0.0, 0.4] | **[-0.15, 0.4]** | Lower floor |

Unchanged: Mark (already [-0.6, 0.0]), Garrett, Aldric, Bess, Theron.

### Kill mood threshold

**Lowered from -0.6 to -0.45.** Rationale: mood baseline is positive (~+0.1-0.3) and mood drifts TOWARD baseline. Old threshold -0.6 was nearly unreachable without cascading events. -0.45 = "in a dark place" — plausible for considering violence. Combined with sentimentBelow -0.4 + H weight + period night/evening = still heavily constrained.

Analysis: mood drift formula `baseline = 0.3 - N×0.4 + E×0.2` produces positive baselines for all NPCs. Natural drift HEALS mood, doesn't degrade it. Only path to negative mood: starting mood + event-driven trauma. -0.45 is reachable from starting mood -0.35 + one bad event (-0.15).

---

## Acceptance Test

```bash
# 10 seeds, auto-tick to evening, check crimes
for seed in 101 202 303 404 505 606 707 808 909 1010; do
  POST /api/new-game?seed=$seed
  # Wait ~20 min game time (mood drift + events)  
  # Force-tick to evening for kill check
  GET /api/events → record crimes
done

Criteria:
  ≥ 7 of 10: some crime occurred (kill OR blackmail OR steal)
  ≥ 3 different crime types across 10 seeds
  ≥ 2 seeds with non-Mark criminal (OR Mark targeting different victim)
  ≤ 3 peaceful runs
```

---

## Obsidian Update

Update NPC files in docs/NPC/ with new mood ranges and narrative crime profiles.

---

## Process Note

This spec applies the 4-step process to DATA, not code. Same rigor:
1. **Analysis**: modeled probability of each NPC reaching crime thresholds
2. **Decisions**: narrative-justified ranges, not arbitrary numbers
3. **Spec**: this document — desired outcomes → required numbers → test plan
4. **Implementation**: update JSON files → run acceptance test
