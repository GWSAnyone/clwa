# CLWA — Architecture

> Движок поведенческой физики: affordances, beliefs, consequences.
> Убийство = данные в модуле. Торговля = данные в модуле. Один движок, разные данные.
> Видение: [VISION.md](VISION.md) | Roadmap: [ROADMAP.md](../ROADMAP.md) | Инварианты: [CLAUDE.md](../CLAUDE.md)

---

## Core Loop

```
State (mood, beliefs, relationships, location)
  → AL: что ФИЗИЧЕСКИ ВОЗМОЖНО (declarative requirements)
  → PM: КТО ТЫ (personality → instinct prose, utility scores)
  → LLM: свободное решение (DO/WHY)
  → Goals: multi-step execution (move, interact, announce, wait)
  → CG: каскад последствий (event → cascade → state change)
  → EL: structured evidence at location
  → New State → next cycle
```

---

## Subsystems

### AL — Affordance Layer (v2)

Пространство возможностей. Что NPC **может** сделать прямо сейчас.

**AffordanceDefinition:** declarative record — requirements, PM weights, step templates, target finder. Новое поведение = новая запись, ноль кода.

**computeUtility:** `personality + moodCurve(mood) + sentimentCurve(sentiment) + beliefModifiers + trust`. Non-linear curves: sliding zone (-0.3 to -0.6), desperation (-0.6 to -0.8), numbness (-0.8+). Bidirectional: positive mood inhibits crime.

**Instinct Builder v2:** score → vivid prose. 7 intensity tiers × 3 texture classes × Enneagram drive × resistance (opposing traits) × escalation. No reflex bypass — LLM always decides.

**Volition:** structured output (DO/WHY). Dynamic action enum from registries. Beliefs in user prompt (not system — avoids "lost middle"). "talk" → TopicEngine handles conversation.

**20+ affordances** in crime-justice module (steal, kill, investigate, arrest, evaluate_case, surveillance, etc.). Each with declarative step templates, target finders, requirement checkers. All via registries.

### PM — Personality Model (v1)

**OCEAN+H** (Big Five + Honesty-Humility) — 6 continuous scales 0.0–1.0. Determine HOW NPC acts. Used as multipliers in utility scoring.

**Enneagram** (type + wing) — determines WHY. Core fear/desire enrich LLM prompt. Stress/growth directions create temporary behavioral shifts.

| Level | What | When | Reversible |
|-------|------|------|-----------|
| Baseline | OCEAN+H values | At creation | No (until Trauma Layer) |
| Temporary shift | Behavior → stress/growth type | mood threshold | Fully |
| Permanent (future) | Baseline shift | Traumatic event | No |

### CG — Consequence Graph (v1, v2 spec ready)

Reactive cascade: event → conditions → consequence event → recurse (maxChainDepth 3).

**v1:** 13 rules, conditions on event payload (has_witnesses, is_public_place, has_capability).

**v2 (SPEC-cg-v2.md):** NPC-state conditions (trait, relationship, belief), exclusive groups with priority, trigger index Map. Enables cover-up, corruption chains, revenge cascades. Implementation: M3 prep.

### EL — Evidence Layer (v1)

Event → structured evidence at location (category, subjectId, weight, description). Discoverable by NPC (examine_scene) or player (examine endpoint). Source for beliefs with `source: 'evidence'`.

### IL — Intent Layer (v2)

Player speech → `extractDialogueMeaning()` (LLM, dynamic JSON schema) → `applyDialogueMeaning()` → engine effects.

**11 speechActs:** inform, question, request, accuse, threaten, compliment, insult, bribe, confide, trade, smalltalk.

**Effects (bilateral with NPC-NPC):** claims → addBelief (conf × trust), questions → NPC beliefs context, requests → createGoalFromRequest (trust gate), pressure → mood/relationship shifts.

**M2 extensions:** Evidence Presentation (processEvidencePresentation — NOT trust-scaled), Player Accusation (buildAccusationContext — deterministic evidence quality → structured prompt injection).

**ILConfig:** all behavioral constants configurable via WorldConfig (trust threshold, confidence floor, pressure multipliers, speechAct effects, bilateral factor).

### Beliefs (v1)

Structured facts with confidence and source. Dedup key: (eventType, object, source). Different sources coexist. Decay per source type. `getMaxConfidenceFor()` aggregates.

Sources: witness (0.95), body_discovery (0.7), testimony (trust-scaled), rumor (0.4), observation (0.8), deduction (0.3-0.5), evidence (weight-based).

### Goals (v1)

Multi-step plans. **5 engine step types:** move_to, interact, interact_present, announce, wait. **Module steps** via STEP_HANDLERS registry (steal_from, attack_npc, arrest_npc, examine_scene, sentence_npc, etc.).

Priority preemption. Interact pursuit (chase target up to maxChase attempts). Belief-gated affordances (deductionBelowThreshold blocks investigate when conf ≥ 0.7 → only arrest remains).

### Memory (v1)

Qdrant vector memory. `decayed_importance = importance × e^(-days / (importance × 5))`. Composite recall: `relevance 0.4 + decayed_importance 0.4 + freshness 0.2`. ReflectionTracker: cumulative importance threshold 30 → LLM insight.

### Relationships (v1)

Bilateral: sentiment (-1..1), trust (0..1), type (friend/rival/family/colleague/acquaintance). Grief penalty on death. Testimony weight from trust. Sentiment cascade from CG events.

### Perception (v1)

Location-based. `canSee()`, `canHear()`, `canInteract()`, `getCoPresent()`, `getWitnesses()`. Co-location = same location ID. `suppressNearPlayer` / `detersCrime` flags on investigator NPCs.

### Clock-Driven Architecture (v1)

**Master Clock:** single `setInterval(1000/gameSpeed)`. `gameMinute` = absolute, grows infinitely. `minuteOfDay = gameMinute % 1440`.

**ProcessingQueue:** 7 task types (DAY_ADVANCE P0 → PHASE_HANDLERS P3). Dedup per-NPC. Async consumer with `setTimeout(0)` yield. Clock never blocked.

**NPC State Machine:** idle → awaiting_decision → executing_goal → in_transit → in_conversation → in_player_chat.

**Cooldowns (game minutes):** decision=60, affordance=180, pair=240. Configurable via WorldConfig. Persisted in save.

**Transit:** `duration = hops × minutesPerHop` (default 30). Master Clock advances progress. NPC in transit excluded from conversations/discovery.

### TopicEngine (v3.1)

Plugin architecture. 13 sources (11 social + 2 crime). Weighted random selection with PM influence (OCEAN). Diversity tracking.

**TopicProposal:** moodValence (numeric, engine reads), sentimentValence, mentionedNpcId, beliefTransfer. Tone string = display only.

**Conversation impact:** deterministic from TopicProposal fields (no LLM). _pendingImpactQueue (array). Applies to participants + bystanders.

### Journal (v2)

Player investigation journal. 3 entry types: clue, testimony, observation.

**Structured evidence fields:** evidenceCategory, evidenceWeight, suspectId, victimId, eventType, presentedTo[].

**Suspect tracking:** markSuspect(), getCaseSummary(). Evidence scoring: totalScore from weights, quality thresholds (strong ≥0.7, moderate ≥0.4, weak ≥0.2).

### Secret Directives

Module-registered builders inject behavioral prompts into NPC system prompt. Checks: own crimes, cover-up, witness state, player threats/bribes. Via SECRET_DIRECTIVE_BUILDERS registry.

---

## Crime Prevention (M2)

**Warn victim:** player claim → danger belief in NPC → personality-driven defensive goal (N>0.6 → lay_low, C>0.6 → report to guard).

**Alert guard:** player requestedAction 'watch' → surveillance affordance → guard co-locates with suspect → detersCrime blocks crime.

**Confront suspect:** existing IL pressure → mood/trust shifts → criminal lay_low or escalation (personality-driven).

---

## NPC Reference

### Profiles (Millhaven)

| NPC | O | C | E | A | N | H | Enneagram | Role |
|-----|---|---|---|---|---|---|-----------|------|
| Garrett | 0.3 | 0.9 | 0.5 | 0.4 | 0.2 | 0.7 | 6w5 Loyalist | Guard (investigator) |
| Ted | 0.5 | 0.6 | 0.8 | 0.7 | 0.3 | 0.6 | 9w8 Peacemaker | Bartender |
| Elara | 0.9 | 0.3 | 0.9 | 0.6 | 0.5 | 0.5 | 3w4 Achiever | Bard |
| Aldric | 0.7 | 0.8 | 0.5 | 0.9 | 0.4 | 0.9 | 1w9 Perfectionist | Priest |
| Hilda | 0.3 | 0.8 | 0.4 | 0.3 | 0.2 | 0.7 | 8w9 Challenger | Blacksmith |
| Mark | 0.5 | 0.3 | 0.7 | 0.3 | 0.6 | 0.2 | 3w2 Achiever | Merchant |
| Bess | 0.8 | 0.4 | 0.3 | 0.7 | 0.6 | 0.8 | 5w4 Investigator | Herbalist |
| Theron | 0.4 | 0.95| 0.3 | 0.5 | 0.3 | 0.9 | 1w9 Perfectionist | Judge (canSentence) |

*Note: these are BASE values. Each run randomizes within ranges defined per archetype (see GDD_DETECTIVE.md).*

### Secrets & Motives

| NPC | Secret | Motive |
|-----|--------|--------|
| Ted | Waters down ale (debts) | — |
| Hilda | Father died in Ted's tavern | vs Ted |
| Elara | Spying for noble house | — |
| Garrett | Took a bribe once | — |
| Aldric | Lost his faith | — |
| Mark | Sells common spices as exotic | vs Bess (she knows) |
| Bess | Foresaw a murder, didn't warn | — |
| Theron | Convicted an innocent once | — |

### Locations (8)

Silver Flagon Tavern, Town Square (hub), Town Gate, Market Square, Blacksmith, Temple of Dawn, Residential Lane, Courthouse.

---

## Project Structure

```
packages/
  engine/src/     — subsystems, 30+ empty registries, ZERO module content
  modules/src/
    social/       — 11 topic sources + socialize affordance
    crime-justice/ — 20+ affordances, CG rules, step handlers, target finders
  server/
    src/          — HTTP/WS, world-loader, bootstrap, position manager
    public/       — Web UI (Canvas2D game client)
  worlds/millhaven/ — JSON world data (NPC profiles, locations, relationships)
```

Dependencies: `modules → engine`, `server → engine + modules`. Engine **never** imports modules.

---

## Design Decisions

### LLM Usage

| Call | Reasoning | Why |
|------|-----------|-----|
| NPC dialogue | OFF | Latency-critical |
| IL extraction | OFF | Structured output with json_schema constraints |
| Reflection | ON (experiment) | Complex, not time-critical |
| Accusation evaluation | None | Deterministic from structured data |
| Conversation impact | None | Deterministic from TopicProposal |

### Dialogue Quality

- **Voice via examples** (speechStyle), not descriptions
- **Memory first-person** ("I saw it happen", not "witnessed murder, importance: 8")
- **State via behavior** ("keeps glancing at the spot", not "traumatized")
- **Structured output:** JSON schema (speech max 12w + gesture 1w). Anti-repetition: repeat_penalty 1.1, frequency_penalty 0.3, presence_penalty 0.2

### Player Interaction

Two pipelines: **structural** (IL → beliefs/goals/mood) and **free-form** (NPC chatStream with IL context injection). Same mechanical effects for both.

---

*Last updated: April 2026*
