# CLWA — Architecture

> Движок поведенческой физики: affordances, beliefs, consequences.
> Убийство = данные в модуле. Торговля = данные в модуле. Один движок, разные данные.
> Видение: [VISION.md](VISION.md) | Roadmap: [ROADMAP.md](../ROADMAP.md) | Инварианты: [CLAUDE.md](../CLAUDE.md)

| | |
|---|---|
| **Версия** | `v0.18.0-dev` |
| **Майлстоун** | M7 «Economy & Trade» — 🔨 в разработке (`feature/economy`) |
| **Отгружено** | M5 Engine Generalization `v0.16.0` · M6 NPC Brain `v0.17.0` |
| **Качество** | `bun test` 299 / 21 файл · `tsc` 0 · genre-neutrality guard PERFECT |
| **История** | [docs/Changelog.md](Changelog.md) |

> **Легенда статусов**: ✅ готово · 🔨 в разработке · ⏸️ отложено · 🔜 запланировано

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

**computeUtility:** `personality + moodCurve(mood, H) + sentimentCurve(sentiment) + beliefModifiers + trust`. Non-linear curves with personality-shifted zones: slidingEntry = -0.30 + (1-H)×0.20, desperation +0.30, numbness +0.50. Low H NPCs enter crime zone at higher mood. Bidirectional: positive mood inhibits crime.

**Mood Modifiers (SPEC-mood-modifiers):** All mood changes via structured MoodModifier objects {source, category, magnitude, duration, decay}. `effectiveMood = baseMood + Σ(decayed modifiers)`. baseMood = personality-derived (0.3 - N×0.4 + E×0.2). Social stress = drift-based permanent modifier (exponential approach to target from relationships). Conversation impact = temporary modifiers (rival 6h exponential, friend 2h linear, bystander ×0.5 1h). No direct `mood +=` mutations.

**Instinct Builder v2:** score → vivid prose. 7 intensity tiers × 3 texture classes × Enneagram drive × resistance (opposing traits) × escalation. No reflex bypass — LLM always decides.

**Volition:** structured output (DO/WHY). Dynamic action enum from registries. Beliefs in user prompt (not system — avoids "lost middle"). "talk" → TopicEngine handles conversation.

**22 affordances** in the crime-justice module (steal, kill, investigate, arrest, evaluate_case, surveillance, …) + **8** in the economy module (M7: buy/sell/haggle/produce/hoard/smuggle/lend/collect_debt). Each is a declarative record — step templates, target finder, requirement checkers — all via registries.

**Pluggable scoring (`registerScoringContributor`):** modules add scoring channels to `computeUtility` keyed by affordance category — e.g. economy raises `economic`-category utility under debt/hunger pressure (`debt×0.5 + hunger×0.4`), without the engine knowing any economy vocabulary.

### PM — Personality Model (v1)

**OCEAN+H** (Big Five + Honesty-Humility) — 6 continuous scales 0.0–1.0. Determine HOW NPC acts. Used as multipliers in utility scoring.

**Enneagram** (type + wing) — determines WHY. Core fear/desire enrich LLM prompt. Stress/growth directions create temporary behavioral shifts.

| Level | What | When | Reversible |
|-------|------|------|-----------|
| Baseline | OCEAN+H values | At creation | No (until Trauma Layer) |
| Temporary shift | Behavior → stress/growth type | mood threshold | Fully |
| Permanent (future) | Baseline shift | Traumatic event | No |

### CG — Consequence Graph (v2)

Reactive cascade: event → conditions → consequence event → recurse (maxChainDepth 3).

**v2 architecture:** Target selection pipeline (resolveTargets → gate/filter conditions), NPC-state condition ops (trait, relationship, belief), exclusive groups with priority (friendship > honesty), O(1) trigger index Map.

**16 rules** in crime-justice module: 6 witness rules, 2 guard cascades, 3 gossip spread, 2 escalation precursors (argument/threat witnessed), 2 emergent personality-driven (grief-revenge, guard-warning), + `merchant-guild-alarm` (op:`faction` — Living Millhaven demo). Plus `witness_reaction` exclusive group (cover-up vs eager-report). The **economy module (M7)** registers its own `ECONOMY_CG_RULES` (`debt-default-grudge`: `DEBT_DEFAULT` → `DEBT_GRUDGE` → a `PERSONAL_GRUDGE` motive), merged into the same CG bus by the server — economy spills into crime with zero shared code.

### EL — Evidence Layer (v1)

Event → structured evidence at location (category, subjectId, weight, description). Discoverable by NPC (examine_scene) or player (examine endpoint). Source for beliefs with `source: 'evidence'`.

### IL — Intent Layer (v2)

Player speech → `extractDialogueMeaning()` (LLM, dynamic JSON schema) → `applyDialogueMeaning()` → engine effects.

**Speech acts + intent kinds (open, M7 E3):** the base speech acts (inform, question, request, accuse, threaten, compliment, insult, bribe, confide, smalltalk) are no longer a closed list — modules register richer player intents via **`registerIntentKind`** (`{key, speechActs, verbs, schemaProperties, promptLines}`). The IL schema + prompt are assembled from `INTENT_KINDS` at runtime, so e.g. the economy module owns the `trade` intent (buy/sell/browse) as data. `DialogueMeaning.intents: Record<string, …>` replaced the old typed `tradeIntent` — the engine is no longer coupled to any genre's vocabulary.

**Effects (bilateral with NPC-NPC):** claims → addBelief (conf × trust), questions → NPC beliefs context, requests → createGoalFromRequest (trust gate), pressure → mood/relationship shifts.

**M2 extensions (extracted to the crime-justice module in M5 Phase A):** Evidence Presentation, Player Accusation (`buildAccusationContext`) and PlayerJournal now live in `crime-justice/investigation.ts`. The engine stays accusation-agnostic — it exposes a generic `registerDialogueEffectHandler` hook + opaque `playerState` + `onPlayerObserve`; the server owns journal save/load.

**ILConfig:** all behavioral constants configurable via WorldConfig (trust threshold, confidence floor, pressure multipliers, speechAct effects, bilateral factor).

### Beliefs (v1)

Structured facts with confidence and source. Dedup key: (eventType, object, source). Different sources coexist. Decay per source type × eventType decayRate. `getMaxConfidenceFor()` aggregates.

Sources — engine keeps only **universal** ones (M5 Phase A): testimony (trust-scaled), observation (0.8), **gossip** (0.4, conversation-transfer — was hardcoded `'rumor'`). Crime-justice **registers** the rest at startup: witness (0.95), body_discovery (0.7), deduction (0.3-0.5), evidence (weight-based), personal_motive (pool-assigned, weight 0), secret (firsthand, weight 0 — NPC's prior knowledge from world JSON).

**Motive beliefs (SPEC-motive-pool):** category 'motive' with types PERSONAL_GRUDGE, REVENGE_DESIRE, THREAT_PERCEIVED. Object = target NPC ID. Assigned from pool at game start (conditional on traits + sentiment) or emergent during gameplay (victimization, deep hatred). EventTypeFlags.decayRate (0.05–0.2) makes motives decay 5–20x slower than facts.

### Goals (v1)

Multi-step plans. **5 engine step types:** move_to, interact, interact_present, announce, wait. **Module steps** via STEP_HANDLERS registry (steal_from, attack_npc, arrest_npc, examine_scene, sentence_npc, etc.).

Priority preemption. Interact pursuit (chase target up to maxChase attempts). Belief-gated affordances (deductionBelowThreshold blocks investigate when conf ≥ 0.7 → only arrest remains).

### Memory (v2 — Persistent, SPEC-persistent-memory)

Dual storage: `_memoryLog` array (primary) + Qdrant (search index, best-effort). Memories survive server restarts.

**MemoryEntry**: id, text, importance, gameDay, timestamp, vector (768-dim cached), embeddingModel (drift detection), protected? (never evicted), playerId (multiplayer-ready, default `__world__`).

**store()**: embed → push to _memoryLog → upsert to Qdrant (best-effort). **recall()**: 3-level fallback — Qdrant search → cosine brute-force on _memoryLog → keyword match. **getAllMemories()**: sync from _memoryLog. **Eviction**: at capacity (200/NPC), lowest decayedImportance, protected immune.

**Scoring**: `decayed_importance = importance × e^(-days / (importance × 5))`. Composite: `relevance 0.4 + decayed_importance 0.4 + freshness 0.2`. ReflectionTracker: cumulative importance threshold 30 → LLM insight.

**Persistence**: toJSON() → save.json (compact, ~800KB for 9 NPC × 5 memories). loadState() → re-embed if model changed → batch upsert to Qdrant. Boot: conditional init, parallel restore, no double knownFacts seeding.

### Relationships (v2)

Bilateral: sentiment (-1..1), trust (0..1), **standing (-1..1)** — third axis for politics/justice (standing with the magistrate = «ось правосудия»), adjusted via `adjustStanding` (clamped). **Open `RelationType`**: `registerRelationshipType(type, {trust, sentiment, grief})` + `getRelationshipDefaults` (7 universal bonds seeded — friend/rival/family/colleague/acquaintance/…; modules add alliance/betrothed/vassal без правок движка). Grief penalty + testimony weight read from the registry (DEFAULT_TRUST/SENTIMENT removed). Sentiment cascade from CG events.

### Perception (v1)

Location-based. `canSee()`, `canHear()`, `canInteract()`, `getCoPresent()`, `getWitnesses()`. Co-location = same location ID. `suppressNearPlayer` / `detersCrime` flags on investigator NPCs.

### Clock-Driven Architecture (v1)

**Master Clock:** single `setInterval` at a **fixed cadence — 1 game-minute / real second** (the `gameSpeed` multiplier was removed in v0.15.1; run/stop only via autoTick `start/stopMasterClock`). `gameMinute` = absolute, grows infinitely. `minuteOfDay = gameMinute % 1440`.

**ProcessingQueue:** 7 task types (DAY_ADVANCE P0 → PHASE_HANDLERS P3). Dedup per-NPC. Async consumer with `setTimeout(0)` yield. Clock never blocked.

**NPC State Machine:** idle → awaiting_decision → executing_goal → in_transit → in_conversation → in_player_chat.

**Cooldowns (game minutes):** decision=60, affordance=180, pair=240. Configurable via WorldConfig. Persisted in save.

**Movement (position-authoritative, v0.15.0):** the server walks each NPC along A* waypoints (~80 px/game-min); arrival = physical entry into the zone polygon (`pointInPolygon`), not a timer — `advancePositions` → `handleArrivals` runs each game-minute, with intermediate-zone location updates en route. The old timer-transit (`transitProgress`/`transitDuration`) is gone. NPC in transit is excluded from conversations/discovery; save/load mid-transit resumes to arrival without freezing.

### TopicEngine (v3.1)

Plugin architecture. 16 sources (13 social + 3 crime). Weighted random selection with PM influence (OCEAN). Diversity tracking.

**TopicProposal:** moodValence (numeric, engine reads), sentimentValence, mentionedNpcId, beliefTransfer. Tone string = display only.

**Conversation impact:** deterministic from TopicProposal fields (no LLM). _pendingImpactQueue (array). Applies to participants + bystanders.

### Journal (v2)

Player investigation journal. 3 entry types: clue, testimony, observation.

**Structured evidence fields:** evidenceCategory, evidenceWeight, suspectId, victimId, eventType, presentedTo[].

**Suspect tracking:** markSuspect(), getCaseSummary(). Evidence scoring: totalScore from weights, quality thresholds (strong ≥0.7, moderate ≥0.4, weak ≥0.2).

### Secret Directives

Module-registered builders inject behavioral prompts into NPC system prompt. Checks: own crimes, cover-up, witness state, player threats/bribes. Via SECRET_DIRECTIVE_BUILDERS registry.

### Scalar Attributes (v1 — M5 B1)

Universal numeric-state primitive. `ScalarAttribute {base, min, max, modifiers[]}` + `AttributeModifier` reuse the MoodModifier decay model (timed, decaying, clamped). `effectiveValue = clamp(base + Σ decayed modifiers, min, max)`. `AgentState.attributes?: Record<string, ScalarAttribute>` — keys are free strings (no crime/economy vocabulary in the engine).

**World API:** `getAttribute` / `setAttribute` / `adjustAttributeBase` (clamped) / `addAttributeModifier` / **`transferAttribute`** (atomic conserved move — the basis for economy/theft). Decay ticks on the same cadence as mood. **CG `RuleCondition` op `attr`** (`field` + comparator + `value`) gates rules on quantified state (`gold < 10`). Pluggable **`registerScoringContributor`** channel in `computeUtility` — affordances can be scored on resource drivers (debt → smuggle). Serialized to `WorldSaveAgentData`. **One primitive backs Economy gold / Combat HP / Politics standing / Survival needs.**

**M7 E1 — drift:** an attribute may carry `drift {ratePerMinute, toward?}`; the engine's per-tick `driftAttribute()` moves `base` toward the target — linear when `toward` is unset, else an exponential approach (`1−e^(−rate·dt)`), clamped, NaN-guarded. Powers price evolution + need growth: the module sets the target/rate, the engine moves the value. **M7 E2 — overdraft:** `transferAttribute(from, to, key, amount, {allowOverdraft})` lets the source go negative down to its `min` (loans/debt) while staying conserved — it refuses if the debit would clamp at `min`. **Tick-phase registry:** modules hook the master-clock tick via `registerTickPhaseHandler` (economy uses it for price/needs drift).

### Inventory (v1 — M5 B2)

Item-instance layer. `Item {id, kind (free string), quantity, state?}` + pure `addItem` (stack fungible / push unique-state) / `removeItems` (conserved) / `countItems`. `AgentState.inventory?: Item[]`, saved/loaded.

**World API:** `getInventory` / `countItem` / `hasItem` / `giveItem` / `removeItem` / **`transferItem`** (atomic conserved move). Makes theft/trade/loot move **real state** (previously `steal_from` only emitted an event). The economy module (M7) now drives trade through the `trade` intent + economic affordances + step handlers that move conserved gold (`transferAttribute`) and items. Remaining legacy: the static `AgentProfile.shop` price on the **player** shop route — P6 switches it to the module's dynamic `getPrice(merchant, kind)`.

### Factions (v1 — M5 B3)

Collective-membership primitive. `AgentState.factions?: string[]` (open keys). **World API:** `joinFaction` / `leaveFaction` / `isFactionMember` / `getFactions`. **CG `RuleCondition` op `faction`** gates rules on membership (merchant-guild reacts to theft of a member). Per-faction standing rides on a B1 attribute (key per faction). Saved/loaded.

### Genre-Neutral Hooks (M5 Phase A)

The engine's own prose/typed-content is sourced from modules via registries (semantic INV-14 «zero module-specific strings» now PERFECT). Beyond `SECRET_DIRECTIVE_BUILDERS`: **`registerRoleDirectiveBuilder`** (role-section prose), **`registerBeliefPhrasing`** (per-event-type NL phrasing; neutral fallback in engine), **`registerDialogueEffectHandler`** + opaque `playerState` + `onPlayerObserve` (player-journal/accusation moved to the crime module), **`REQUIREMENT_CHECKERS` / `POST_TARGET_REQUIREMENT_CHECKERS` / `registerTargetEnricher`** (affordance requirements), open `capabilities: Record<string,boolean>` + `hasCapability()` (was typed crime flags), `BELIEF_SOURCE.GOSSIP` (was hardcoded `'rumor'`). `CrimeScene` → genre-neutral **`SceneResidue`** (crimeType→sceneType, perpetratorId→actorId, victimId→affectedId, processKill→processAgentDeath) + `registerSceneResidueTemplate`. Beyond these, the engine exposes ~46 registration functions in `event-registry.ts` — among them `registerDayAdvanceHandler`, `registerPressureHandler`, `registerConsequencePostHandler`, `registerDiscoveryHandler`, `registerMemoryTextBuilder`, `registerRoleTopicPool`, `registerClaimSources`, `registerQuestionTopics`, `registerSpeechActs`, plus the M7 additions `registerIntentKind` / `registerScoringContributor` / `registerTickPhaseHandler` — every one an empty hook the engine ships with and modules fill.

### Layered Prompt & Model Routing (M6 — NPC Brain)

NPC roleplay quality is engineered through a **3-layer prompt** + **context engineering** + **conscious model routing**, all data-driven (editable in the World Editor, INV-14/INV-21 clean).

**Prompt layers** (`agent.ts`):
- **L1 scaffold** — universal, genre-neutral guardrails (speak-aloud-only, language lock, knowledge-boundary, in-character, first-person, brevity). Localized en/ru. Engine default `defaultScaffold(lang)`; a world may override via `WorldConfig.scaffold` (genre-neutral by contract). Goes in the **system** prompt.
- **L2 persona** — background / personality prose / motivation / speech-style description / secret / inner-conflict. Byte-stable per NPC. Also **system**. (L1+L2 = byte-stable prefix → claude-code warm-session + LM-Studio KV-cache both reuse it; volatile state must never leak here.)
- **L3 volatile state** — current location/mood, "What you know" (top beliefs), role directives, relevant memories, rotated voice example, then the **critical rule restated LAST** (`finalReminder`, beats small-model instruction-attenuation). Goes in the **user** turn only.

**Context engineering:** unified belief ranking (`getTopBeliefs`, confidence×recency) feeds both prompt + memory; memory recall via `compositeScore` with a degenerate-query guard; reflection output sanitized; few-shot voice examples (`AgentProfile.fewShotExamples`, authored per-world-language) sampled one-per-turn into L3 so the prefix stays stable and lines can't be copied verbatim.

**Model routing** (`WorldConfig.llm`, fully replaces the default router): per-task provider/model/maxTokens/sampling + `warm` (reuse claude session, skips cold-spawn) + `schemaInPrompt` (inject schema vs native `--json-schema`) + `fallback`. Millhaven live: player dialogue + verdict → **Claude Sonnet**; volition / il / npc-dialogue / reflection / embeddings → local **Qwen**. **No paid Anthropic API** — claude-code subscription CLI + local LM Studio only.

**Chat-staleness TTL:** player short-term chat (`_chatHistory` + rolling summary + warm claude session) resets only after a real-time gap > `WorldConfig.chatStaleMs` (default 5 min) since the last turn with that NPC — a brief glance away keeps continuity, a real absence starts fresh. Long-term vector memory is untouched. Engine + provider session reset together (`clearChatHistory` → `resetAgentSessions`) or they desync.

**Harness** (`tools/npc-brain/`): same fixtures × 3 models (Qwen / Haiku / Sonnet), LLM-as-judge scoring + objective tokens/latency/cost/schema-pass → routing decisions made on data, not by eye.

### Economy & Trade Module (M7 — second genre, 🔨 in progress)

Proof of the «one engine, content = data» thesis: a full economic genre built as **module content + 3 universal engine primitives** (E1 attribute drift, E2 overdraft transfer, E3 INTENT_KIND — all genre-neutral, described above), with the crime game untouched as the regression oracle.

**Module content** (`packages/modules/src/economy/`, zero engine imports — INV-14):
- **8 affordances** (category `economic`): buy / sell / haggle / produce / hoard / smuggle / lend / collect_debt — with target finders (co-located merchant/buyer/debtor + self) and 7 requirement checkers (notGuard / isMerchant / canProduce / atMarket / hasGoodsToSell / hasCapital / isCreditorOf).
- **Economic decision-making:** a `registerScoringContributor` raises `economic`-category utility under need/debt pressure (debt → sell/smuggle, hunger → buy).
- **Dynamic pricing** (`pricing.ts`, rides E1 drift via `registerTickPhaseHandler`): each merchant's `price:KIND` attribute drifts toward a supply/demand target (scarcer → pricier); `getPrice` / `computePriceTarget` / `BASE_PRICE`.
- **Needs:** `hunger` drifts up over time (E1) and is reset by eating food — bilateral, the player gets hungry too.
- **Debt / credit** (`debt.ts` ledger + E2 overdraft): a loan records a debt; collection settles via an overdraft transfer (the debtor's gold may go negative to `DEBT_FLOOR` before defaulting). `recordDebt` / `getDebt` / `clearDebt` / `isCreditor` / `findDebtorOf`.
- **Step handlers** move conserved gold (`transferAttribute`) + items (`add/removeItems`); the World is late-bound via `setEconomyWorld` (handlers register before World exists).
- **Cross-module CG (economy → crime):** `DEBT_DEFAULT` → CG rule `debt-default-grudge` → a `PERSONAL_GRUDGE` motive in the creditor (via `registerBeliefCreator('DEBT_GRUDGE')`) → crime's threaten/argue/kill react. Zero shared code between modules — only the CG bus.

**Status:** E1/E2/E3 + P2–P5 ✅ (tsc 0, 299 tests). Remaining (P6): frontend polish (hide merchant gold, player inventory panel, stop NPC↔NPC chat leak, player shop → dynamic price), markets-as-venues, smuggling/fraud rings, `SHORTAGE` emission, more cross-module CG → final audit → merge.

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
| Theron | 0.6 | 0.95| 0.4 | 0.4 | 0.2 | 0.9 | 1w9 Perfectionist | Judge (canSentence) |

*Note: these are BASE values. Each run randomizes within ranges defined per archetype (see GDD_DETECTIVE.md).*

### Secrets & Motives

| NPC | Secret | Possible Motives (from pool) |
|-----|--------|------------------------------|
| Ted | Waters down ale (debts) | gambling_debt → Mark, political_threat → Bess |
| Hilda | Father died in Ted's tavern | fathers_death → Ted (REVENGE_DESIRE) |
| Elara | Spying for noble house | too_many_questions → Garrett (THREAT_PERCEIVED) |
| Garrett | Took a bribe once | corrupt_suspicion → Elara (PERSONAL_GRUDGE) |
| Aldric | Lost his faith | moral_disgust → Ted (PERSONAL_GRUDGE) |
| Mark | Sells common spices as exotic | secret_exposed → Bess, trade_rivalry → Hilda |
| Bess | Foresaw a murder, didn't warn | herbal_knowledge → Mark (PERSONAL_GRUDGE) |
| Theron | Convicted an innocent once | — |

*Motives assigned from `motives.json` pool at game start, conditional on randomized traits + sentiment. Not all motives activate every run. See SPEC-motive-pool.*

### Locations (8)

Silver Flagon Tavern, Town Square (hub), Town Gate, Market Square, Blacksmith, Temple of Dawn, Residential Lane, Courthouse.

---

## Project Structure

```
packages/
  engine/src/     — subsystems, ~46 empty registries, ZERO module content (genre-neutral, INV-14 PERFECT)
                    + attributes.ts (B1 + M7 E1 drift / E2 overdraft transfer), inventory.ts (B2),
                    scene-residue.ts (was crime-scene.ts), INTENT_KIND registry (M7 E3)
                    journal.ts REMOVED — player-journal/accusation extracted to the crime module
  modules/src/
    social/       — 13 topic sources + socialize affordance
    crime-justice/ — 22 affordances, CG rules, step handlers, target finders,
                     investigation.ts (PlayerJournal + accusation + evidence-presentation)
    economy/      — 8 affordances (M7), pricing.ts (dynamic prices + needs on E1 drift),
                     debt.ts (loan/debt ledger on E2 overdraft), trade INTENT_KIND (E3),
                     cg-rules.ts (cross-module debt → crime grudge)
  server/
    src/          — HTTP/WS, world-loader (JSON validation + attributes/inventory/factions/standing seed),
                    bootstrap, position manager, llm-usage-tracker, logger (timestamped)
    public/       — game.html Web UI (Canvas2D; legacy index.html dropped — root serves the game)
worlds/millhaven/ — JSON world data (NPC profiles + gold/inventory/factions, locations, relationships+standing, motives, secrets, topics)
tools/world-editor/ — standalone world JSON editor (port 3001, registry-driven; edits attributes/inventory/factions/standing + LLM routing + L1 scaffold/language/chat-TTL + per-NPC few-shot)
tests/            — 21 test files, 299 tests (architecture, boot-smoke, save-load, cg-v2, heat, m3-systems, cg-integration, regression, world-data, attributes, inventory, relationships-factions, living-millhaven, genre-neutrality guard, economy)
```

Dependencies: `modules → engine`, `server → engine + modules`. Engine **never** imports modules.

---

## Design Decisions

### LLM Usage

| Call | Uses LLM | Why |
|------|----------|-----|
| Volition (DO/WHY) | Yes | NPC decision-making, structured output |
| NPC-NPC dialogue | Yes | Conversation exchanges, structured JSON (speech + gesture) |
| Player chat (chatStream) | Yes | Free-form NPC responses |
| IL extraction | Yes | Player speech → DialogueMeaning, json_schema constrained |
| Reflection | Yes | LLM insight from accumulated memories |
| Accusation evaluation | No | Deterministic from structured evidence data |
| Conversation impact | No | Deterministic from TopicProposal fields |
| Goal step execution | No | Mechanical state changes (move, announce, wait) |

**Routing** (server-domain control panel — `server/src/llm-defaults.ts`, per-world override via `world.json` → `config.llm`): each task maps to a provider+model+sampling route. Hot/high-volume (volition, il, embeddings) → local **Qwen** (LM Studio, ~$0). Interactive (player dialogue, verdict) → **Claude Code** Sonnet (subscription CLI; warm persistent session skips cold-spawn; `schemaInPrompt` injects the JSON schema as free text for structured calls); reflection runs on local Qwen. Every route is editable in the World Editor (provider/model/maxTokens/temp/warm/schema/fallback), registry-driven.

**Observability:** every call → `LlmUsageEvent` (task, provider, model, tokens, cost, latency) persisted to `data/llm-usage.jsonl` + a per-call console line; NPC reply text (player↔NPC and NPC↔NPC) is logged; all logs carry an `[HH:MM:SS]` timestamp.

### Dialogue Quality

- **Voice via examples** (speechStyle), not descriptions
- **Memory first-person** ("I saw it happen", not "witnessed murder, importance: 8")
- **State via behavior** ("keeps glancing at the spot", not "traumatized")
- **Structured output:** JSON schema (speech max 12w + gesture 1w). Anti-repetition: repeat_penalty 1.1, frequency_penalty 0.3, presence_penalty 0.2

### Player Interaction

Two pipelines: **structural** (IL → beliefs/goals/mood) and **free-form** (NPC chatStream with IL context injection). Same mechanical effects for both.

---

*Last updated: June 2026 — M7 (Economy & Trade): E1 drift / E2 overdraft / E3 INTENT_KIND engine primitives + economy module (trade, dynamic pricing, needs, debt/credit, cross-module CG). Built on M5 (genre-neutral engine + B1/B2/B3) and M6 (NPC Brain).*
