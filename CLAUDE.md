# CLWA — Behavioral Physics Engine

> A physics engine doesn't know what a "car" is — it knows rigid bodies and forces.
> CLWA doesn't know what a "murder" is — it knows affordances, beliefs, and consequences.
> Murder = data in a module. Trade = data in a module. Same engine, different data.
> Stories are not scripted — they emerge from system interactions.
>
> **Every subsystem, every interface, every design decision targets a universal MMO world** — crime, economy, politics, social, combat are all just data modules on the same behavioral physics engine. Current milestone (Crime & Justice) is proof of concept, not the scope.

**On session start**: read Serena memories `clwa/overview` and `clwa/engine-invariants` for full project context. Read `clwa/godot-client` when working on Godot.

### Documentation (`docs/`)

| Document | Purpose |
|----------|---------|
| `docs/GDD_DETECTIVE.md` | **Game design** — core loop, milestones, what to build next |
| `docs/VISION.md` | **Long-term vision** — Shangri-La world, multiplayer roadmap |
| `docs/ARCHITECTURE.md` | **Engine spec** — subsystems, data models |
| `docs/ROADMAP.md` | **Development roadmap** — phases, subsystems, milestones |
| `docs/MOOD_REVIEW.md` | **Mood system analysis** — industry/academic research, deferred features |
| `docs/specs/` | **Task specs** — detailed design for each feature (14 specs) |
| `docs/` (Obsidian vault) | **World design** — NPC profiles, locations, tensions, lore |

## Design Philosophy (ALWAYS FOLLOW)

### 1. Structured Data — Never Text Matching
Every piece of state is a typed field: `null`, enum literal, number, boolean.
- Unknown = `null`. Never a placeholder string. Placeholder text OK only in human-visible prose.
- Role-based behavior = **capability flags** (`investigator`, `detersCrime`, `canSentence`). The `role` string is for display only.
- LLM structured output = first-word extraction. Never `response.includes()`.
- **Self-check**: before every string comparison, ask: "Is there a registry, flag, or typed field for this?" If the answer involves writing a specific string value from a module — it's a violation.

**Anti-patterns I must NOT repeat:**
- `?? 'BODY_DISCOVERED'` — fallback on hardcoded string. Correct: registry or throw.
- `=== 'NPC_KILLED' || === 'GOODS_STOLEN'` — enumerating module event types. Correct: `isTransferable(type)` or other boolean flag.
- `role === 'guard'` — role string for logic. Correct: `profile.investigator`.
- Classifying a violation as "acceptable" or "borderline" because it's a union type or "engine-level concept". **Default is VIOLATION** — only goal state machine, LLM API protocol, and template DSL ($target, $home) are truly engine-level string checks.

### 2. Engine = Universal Laws, Modules = Worlds Built on Those Laws
Engine contains **empty registries** (40+ in event-registry.ts). Modules fill them at startup. Engine never imports from modules.
- New behavior = data record in a module. Zero code changes in engine.
- Engine doesn't know specific roles, crimes, event types, verdict strings, status values, scene types, speech acts, claim sources, pressure types, or trade verbs. All via registries.
- **Test**: "If I add an Economy module with FRAUD/SMUGGLING events — does engine handle them without any engine code changes?" If no → violation.

### 3. PM = Instinct, LLM = Consciousness
Personality Model computes utility scores → instinct-builder generates vivid prose (7 tiers × 3 textures × Enneagram × resistance). LLM freely decides — may follow instinct or transcend it. **No reflex bypass** — LLM always has final say. Stronger instincts = more vivid descriptions = harder to resist naturally.
- **Volition prompt**: NO RP framing ("you are a character in simulation" triggers safety alignment). Just character identity + instincts.
- **Scoring v2**: non-linear moodCurve with personality-shifted zones (`moodCurve(mood, H)` — low H enters sliding earlier), bidirectional (positive mood inhibits crime), trust as 5th input, DEBT_PRESSURE beliefModifiers.
- **Mood Modifiers (SPEC-mood-modifiers)**: all mood changes via structured MoodModifier objects {source, category, magnitude, duration, decay}. `effectiveMood = baseMood + Σ(decayed modifiers)`. baseMood = 0.3 - N×0.4 + E×0.2. Social stress = drift-based permanent modifier. No direct `mood +=` anywhere.

### 4. Emergent Narrative
We build **capabilities**, not scenarios. Nobody hardcodes "Mark kills Bess" — personality + mood + relationship + opportunity converge organically.

### 5. Bilateral Design
Every system works identically for NPC and Player. Player = Agent with `isPlayer` flag. Same beliefs, relationships, perception. `isPlayer` guards in all NPC-only loops (volition, schedule, movement, goal processing, conversation pairs, target finders).

### 6. Trace Dependencies Before Editing
Before modifying any function: find all callers (`find_referencing_symbols`), understand the full data flow. Never edit blind.

### 7. No Double Standards
Do NOT rationalize keeping module knowledge in engine because "it's easier" or "it's just one string". Every violation sets a precedent. If it looks like a pattern you'd apply inconsistently — it IS a violation. Fix it or document it as explicit architectural debt with a concrete plan.

## Stack

```bash
docker compose up -d                          # Qdrant (vector memory)
bun install && bun run packages/server/src/index.ts  # → http://localhost:3000
```
- **Runtime**: Bun | **LLM**: LM Studio, `qwen3.5-9b-abliterated` (lukey03, patched GGUF) | **Embeddings**: raw fetch (NOT OpenAI SDK)
- **LLM API**: OpenAI-compatible `/v1/chat/completions` с `response_format: json_schema` для structured output
- **GGUF Patch**: thinking отключён патчем в GGUF binary. В chat template заменено `enable_thinking is defined and` → `if true` (same-length binary replace). Backup: `.bak`.
- **Web UI**: `http://localhost:3000/game.html` — Canvas2D, Tiny Swords sprites, A* pathfinding. Primary demo client
- **Godot**: 4.6.1, deferred. Top-down 2D scenes preserved in `godot/`. Old 3D archived to `_archive/clwa-godot-3d/`
- **Save**: `packages/server/data/save.json` (includes positions + memories, compact JSON)
- **World Editor**: `bun run editor` → http://localhost:3001 (reads/writes `worlds/` JSON)

## Architecture

```
Engine  (packages/engine/)  — universal subsystems, 30+ empty registries, ZERO module-specific content
Modules (packages/modules/) — world content via registration functions
  ├── social/              — universal social topic sources (11 sources) + socialize affordance
  └── crime-justice/       — crime affordances, CG rules, step handlers, discovery handler
Server  (packages/server/)  — HTTP/WS, world-loader, bootstrap
Worlds  (worlds/millhaven/) — JSON world data (NPC profiles, locations, relationships)
```
Dependencies: `modules → engine`, `server → engine + modules`. Engine **never** depends on modules.

## Engine Invariants

1. **LLM semaphore**: acquire() → call → release() in **finally**. Concurrency = 1. Tick mutex.
2. **Null semantics**: null = unknown. addBelief() merges null → concrete. Never strings as null-substitutes.
3. **Registry pattern**: engine has empty registries. Modules fill them. Engine never references module-specific IDs, event types, status strings, verdict values, speech acts, claim sources, pressure types, or trade verbs.
4. **Capability flags**: investigator/detersCrime/canSentence on profile. Never role strings for logic.
5. **All types = string**: EventType, NpcStatus, BeliefSource, SpeechAct, Claim.source, lastInteractionOutcome.type — no unions. Modules define values via registries.
6. **Step handlers**: engine handles move_to/interact/announce/wait. All other step types via STEP_HANDLERS registry.
7. **handleEventForGoals**: async. All callers must await.
8. **No fallback strings**: if registry returns null/undefined — skip, throw, or use generic behavior. Never `?? 'HARDCODED_STRING'`.
9. **Status = null is free**: null/undefined status = default active. `isStatusAbsent()` checks registry. No `'free'` string in engine.
10. **Source/event flags**: engine checks boolean flags — `isTransferable()`, `isInformationOnly()`, `isPerpetrator()`, `isFirsthand()`, `isConcealment()`. Modules register via `registerEventTypeFlags()` / `registerSourceFlags()`. Engine never checks category name strings.
11. **Day advance/tick handlers**: module logic (rumor spread, theft discovery) via DAY_ADVANCE_HANDLERS and TICK_PHASE_HANDLERS registries.
12. **Secret directive builders**: behavioral prompts (threats, bribes) via SECRET_DIRECTIVE_BUILDERS registry. Server registers builders.
13. **No reflex bypass**: LLM always decides. Instinct builder provides pressure through vivid descriptions. minimumScore still ensures duty affordances score high enough to appear as strong instincts.
14. **Belief dedup by source**: addBelief key = (eventType, object, source). Different sources coexist. getMaxConfidenceFor() aggregates.
15. **notPerpetrator requirement**: perpetrators blocked from testify, report_crime, demand_justice, confront via `isPerpetrator(source)` flag. API kills also get perpetrator belief via NPC_KILLED event handler.
16. **Configurable cooldowns**: affordanceCooldownTicks, decisionCooldownTicks, pairCooldownTicks in WorldConfig. Not hardcoded.
17. **Player = Agent**: Player is a full Agent with `isPlayer` flag. Has beliefs, relationships, mood, location. World.tick() skips volition/schedule/movement for isPlayer. All other systems (beliefs, CG, EL, perception) treat player identically to NPC.
18. **IL (Intent Layer)**: Player speech → `extractDialogueMeaning()` → `DialogueMeaning` → `applyDialogueMeaning()` → engine effects. Claims create beliefs via same `addBelief()` as NPC beliefTransfer. Confidence = claim.confidence * trust(NPC→Player).
19. **Perception system**: `canSee()`, `canInteract()`, `canHear()`, `getCoPresent()`, `getWitnesses()` in perception.ts. Centralizes all visibility/awareness checks.
20. **AL as validator**: `validatePlayerAction()` checks affordance requirements for player gameplay actions. AL for NPC = generator, AL for Player = validator.
21. **isPlayer guards**: every `for (agent of agents)` loop must decide: include player or not. NPC-only: volition, schedule, night walks, goal processing, conversation pairs, target finders, LLM name lists. Bilateral (include player): body discovery, crime scene notice, overhear, perception, mood shifts.
22. **inPlayerChat freeze**: NPC in active chat with player → `inPlayerChat=true` → tick skips movement/goals. Cleared in finally block. Transient — not persisted.
23. **detained = absent**: `registerAbsentStatuses(['detained', 'exiled', 'fled'])`. Detained NPCs frozen — no goals, no movement, no conversations. Still targetable by evaluate_case (direct status check).
24. **Case resolution**: NPC_SENTENCED → deactivate crime scenes (perpetratorId match) + mark bodies discovered + zero transferable beliefs (by suspect AND victim name). Prevents post-resolution investigate cycle.
25. **Crime scene callbacks**: `personalizePoints()` and `additionalPoints()` on CrimeSceneTemplate — module callbacks, engine has zero domain-specific point logic.
26. **Co-location validation**: server chat handler checks `playerAgent.location === npc.location` before IL. Server authoritative.
27. **Trust evolution**: NPC_ARRESTED → NPCs who received player claims about suspect get trust +0.08. NPC_SENTENCED exile → trust +0.12, release → trust -0.15. Only NPCs with `sourceNpcId === playerId` beliefs affected. Module code in event-handlers.ts.
28. **NPC approach**: Tick phase handler checks co-located NPCs for urgent firsthand beliefs. Pushes to `TickPhaseContext.approaches[]`. Max 1 per tick. Cooldown 32 ticks per NPC. Server stores `promptContext`, injects into NPC system prompt when player opens chat.
29. **Player rumor topics**: TopicSource in TOPIC_SOURCE_REGISTRY. NPC-NPC conversations can include topics about player (claims shared, negative sentiment, positive trust). TopicContext extended with `playerAgent`.
30. **Structured dialogue**: NPC-NPC conversations use JSON schema (speech + gesture). parseDialogue returns speech only — gesture is metadata for future animation, not display text.
31. **getEventLabel returns null**: not raw eventType. All callers handle null with `?? 'crime'` or skip.
32. **Belief zeroing is module responsibility**: verdict-conditional in NPC_SENTENCED handler, not engine.
33. **Generic ModuleStep**: engine knows only move_to/interact/announce/wait. All others via STEP_HANDLERS + generic buildSteps default.
34. **Anti-repetition**: repeat_penalty, frequency_penalty, presence_penalty in DEFAULT_WORLD_CONFIG, passed to every llmCall.
35. **instinctContext**: AffordanceDefinition field, interpolated with target.extra vars. Grounds emotional instinct in concrete situation (e.g. "You know Garrett accepted a bribe"). Module data, engine mechanism.
36. **hasCrimeBelief**: checked via REQUIREMENT_CHECKERS registry with per-affordance beliefConfidence params.
37. **triggerReactiveEvaluation**: callback in EventHandlerContext. Module handler triggers AL reactive evaluation for specific NPC. Engine provides mechanics.
38. **Information spread**: sentiment cascade for RUMOR_SPREAD/WITNESS_MEMORY/THEFT_DISCOVERED handled by module event handlers, not engine.
39. **World data = JSON**: all NPC profiles, locations, relationships, schedules, memories, lore, secrets in `worlds/millhaven/`. Server reads via `world-loader.ts`. Zero TypeScript constants for world content.
40. **TopicEngine v3**: 16 sources (13 social + 3 crime). Bidirectional beliefs, recency weighting, location context, cross-source dedup (topicKey), death-aware opinions. Location hooks via `registerLocationHook` registry.
41. **Location hooks**: `conversationHook` field in world.json locations → `registerLocationHook` registry → `getLocationHook` in topic sources. No hardcoded location names in modules.
42. **Location IDs**: internal state uses slug IDs (`market-square`). LLM prompts use display names (`Market Square`) via `locationResolver` on Agent and `locName()` helpers. world-loader.ts maps JSON names → slugs. pathfinding/movement/perception all work with IDs.
43. **Discovery handlers**: engine detects discovery condition (dead+alive co-location), creates event. Module owns the response (memory, mood, belief, grief) via DISCOVERY_HANDLERS registry. Engine has zero hardcoded discovery behavior.
44. **Socialize affordance**: social module registers `socialize` with `socialOnly: true` on AffordanceDefinition — triggers LLM volition for extraverted NPCs (E>0.7) without crime events. No actionVerb (invisible to LLM). Engine checks `definition.socialOnly` flag (not affordance ID) in volition: "talk" becomes move-only → TopicEngine handles conversation.
45. **Conversation prompts**: `YOUR TOPIC:` prefix in initiator/responder prompts. Topic hook first, then context. Gesture schema constrained to one word. knownFacts removed from buildSystemPrompt. Memory format: `(today, vivid)` not numeric scores. Mood calibration in impact analysis.
46. **PositionManager**: server-level (NOT engine). Stores pixel positions per entity. Engine never knows about pixels — only location slugs. Zone polygons in world.json. Seeded random for deterministic NPC placement. save.json includes positions section.
47. **inTransit flag**: boolean on AgentState (like inPlayerChat). Set by movement.ts and goals.ts on move_to. Cleared for ALL agents at start of each `_tick()`. Scheduler skips inTransit NPCs from conversation pairing. Transient — not persisted.
48. **WS overlay types**: 5 callbacks on WorldCallbacks (onDecision, onMoodChange, onGoalChange, onCascade, onRelationshipChange). Mood via Object.defineProperty interceptor (zero callsite changes). Relationship via RelationshipGraph.onChange. CG cascade via processCascade() helper.
49. **IL bilateral parity**: Player claims go through same `isTransferable()` filter as NPC-NPC beliefTransfer (goals.ts). Confidence = claim.confidence × trust, with configurable floor (`ILConfig.beliefConfidenceFloor`). Relationship changes via `adjustSentiment()`/`adjustTrust()` (not direct mutation) — triggers onChange → WS broadcast.
50. **IL dynamic schema**: `buildILSchema(ctx)` generates JSON schema with enum constraints from registries (`getRegisteredSpeechActs()`, `getRegisteredClaimSources()`, `getRegisteredPressureTypes()`, `getILTradeVerbs()`, eventTypes, locations, actionVerbs). All sets dynamic — zero hardcoded enums. Speech acts have flags (`isBenign`, `isTrade`, `isAccusation`) via `registerSpeechActs()`. Constrained decoding on 9B model guarantees valid output. Schema rebuilt per-call.
51. **ILConfig + ConversationConfig**: all IL behavioral constants (trust threshold, confidence floor, pressure multipliers, speechAct effects, bilateral factor) and conversation constants (sentiment boost, mood/valence clamps, secret confidence) in WorldConfig. Resolved once at World construction via `resolveILConfig()`/`resolveConversationConfig()`.
52. **ILEffect tracking**: `ILEffectContext.effects: ILEffect[]` — mutable array populated by `applyDialogueMeaning`. Discriminated union with 8 types (belief_created, belief_rejected, mood_change, relationship_change, goal_created, goal_rejected, event_stored, memory_stored). Broadcast via WS `il_result` for client rendering.
53. **Secret event type registry**: `registerSecretEventType()`/`getSecretEventType()` — module defines what event type represents discovered secrets. Engine uses registered type in conversation impact analysis. No hardcoded `'PERSONAL_SECRET'` in engine.
54. **IL action resolution**: Player `requestedAction.action` (free text from LLM) resolved to affordance IDs via `getAffordanceIdsForVerb()` from existing ACTION_VERB_MAP. Falls back to direct match. Same registry used by volition DO/WHY parser.
55. **ProcessingQueue**: 7 task types, priority sort, dedup (per-NPC + conversation pair + global), async consumer with setTimeout(0) yield between tasks. No batch `_tick()` — all processing through queue.
56. **NpcProcessingState**: explicit 6-state machine on AgentState. `_handleConversation` uses try/finally to guarantee state reset on exception. processingState is transient (not persisted).
57. **Cooldown persistence**: affordanceCooldowns (Map<string, Map<string, number>>) and decisionCooldowns (Map<string, number>) serialized in toJSON/loadState. Old saves without cooldowns = natural reset.
58. **CONVERSATION_IMPACT**: deterministic (no LLM). Reads moodValence/sentimentValence/mentionedNpcId from TopicProposal. _pendingImpactQueue (array, not single field) + composite npcId on task prevents dedup collision. Mood changes via addModifier: participants get full magnitude (rival 6h exponential / friend 2h linear), bystanders get ×0.5 magnitude 1h linear. Sentiment unchanged. NPCs in wait steps remain eligible for conversation pairing.
59. **Structured conversation memories**: raw LLM dialogue → UI only. Memories store belief summaries (3rd person via `summarizeForMemory`), topic tone, mood. Self-reference cascade impossible by construction.
60. **Belief relevance filter**: `summarizeForMemory(name, max, eventTypeFilter?)` — only topic-relevant beliefs in memory. Prevents unrelated beliefs polluting conversation recall.
61. **Interrogation structured outcome**: `lastInteractionOutcome` on AgentState (confession/denial/alibi). Set by post-hook from checkGuilt + honesty. Unified with belief summary in single observe.
62. **deductionBelowThreshold**: investigate requirement blocks when guard has deduction belief conf ≥ 0.7. Structured state check — only arrest remains. Not cooldown-based.
63. **Interact pursuit**: when target not co-located, NPC chases to target's current location (up to maxChase attempts based on goal priority). Not passive wait.
64. **TopicProposal moodValence**: numeric field set by module topic sources. Engine reads number for mood computation. `tone` string = display only (like `role` on profile). Economy module adds `moodValence: -0.01` for "haggling" → engine works without code changes.
65. **TopicProposal sentimentValence + mentionedNpcId**: numeric sentiment toward discussed NPC. `mentionedNpcId` from module (e.g. opinionTopics has targetId from relationships). Fallback: engine resolves beliefTransfer.subject name→ID. Disagreement topics: sentimentValence=0 (asymmetric, can't express with one number).
66. **Schedule post guard**: mobile NPCs at their schedule location excluded from random processMovement. Prevents back-and-forth bouncing between schedule post and random adjacent locations.
67. **Visit inTransit**: intentionToGoal checks targetAgent.state.inTransit. If target in transit → move_to transitTo (destination). Prevents silent null when target appears co-located but is actually walking away.
68. **Co-located social wait**: socialOnly + co-located → wait(2) goal instead of null. Blocks schedule check for 2 game minutes → scheduler pairs NPCs for conversation. NPCs in wait steps NOT excluded from conversation pairing (currentStep.action === 'wait' → eligible).
69. **Per-NPC conversation cooldown**: scheduler.findPair skips NPCs who talked within 30 game minutes. Prevents one NPC dominating consecutive conversations at crowded locations.
70. **Pair cooldown in volition**: isPairOnCooldown on AffordanceContext. socialOnly visit → pair on cooldown → return null. Prevents NPC walking to target only for scheduler to reject the pair.
71. **ConversationConfig.relationshipMoodModifier**: rivalMoodScale, friendMoodScale (proportional to sentiment, no threshold). Conversation mood impact creates structured modifiers via World.addModifier(). All constants from resolved config.
72. **File logger**: `initFileLogger()` in server — intercepts console.log/warn/error, appends to `logs/clwa-YYYY-MM-DD_HH-MM-SS.log` with timestamps. One file per server session.
73. **Mood modifiers (SPEC-mood-modifiers)**: all mood changes via `World.addModifier()`. Never `agent.state.mood +=` directly. mood field is computed: `effectiveMood = baseMood + Σ modifierEffective(m)`. baseMood + moodModifiers[] on AgentState. Serialized in save.json.
74. **Social stress drift**: permanent modifier with exponential approach to target. Target = -stress × personalityScale × weight. Drift rate 0.02/tick. Responsive to relationship changes — if rels improve, modifier drifts back toward 0.
75. **Personality-shifted moodCurve**: `moodCurve(mood, H)`. slidingEntry = -0.30 + (1-H)×0.20. Low H NPCs enter crime zone at higher (less negative) mood.
76. **addMoodModifier callback**: CG and IL access mood modifiers via callback on WorldContext/ILEffectContext. Engine provides mechanism, callsite provides modifier data.
77. **Dev tools**: `GET /api/debug/snapshot` (all NPCs: mood, baseMood, modifiers, personality, relationships, top affordance). `GET /api/debug/mood-history/:id?last=N` (time-series sampled every 5 game min, ring buffer 500). Server starts with auto-tick ON.
78. **Motives = beliefs (SPEC-motive-pool)**: motives are beliefs with category 'motive' (PERSONAL_GRUDGE, REVENGE_DESIRE, THREAT_PERCEIVED). Object field = target NPC ID (dedup key). Source 'personal_motive' with transfer weight 0 — grudges don't gossip. `profile.motive` deprecated; pool entries in `motives.json` override.
79. **EventTypeFlags.decayRate**: multiplier for belief decay. `effectiveRate = sourceRate × getEventTypeDecayRate(eventType)`. Default 1.0. Motive types: REVENGE_DESIRE 0.05 (semi-permanent), PERSONAL_GRUDGE 0.1, THREAT_PERCEIVED 0.2. Universal engine mechanism — not motive-specific.
80. **Motive target finder**: kill affordance uses `targetFinder: 'motive_target'` — finds NPC with highest-confidence motive-category belief (conf ≥ 0.3). No motive belief = no premeditated murder. Vigilante keeps `targetFinder: 'crime_belief'` (reactive). beliefModifiers on kill/steal/blackmail boost utility from motive beliefs.
81. **Emergent motives**: THEFT_DISCOVERED → victim gets REVENGE_DESIRE (conf 0.8). NPC_KILLED → friends (sentiment > 0.3) get REVENGE_DESIRE (conf = sentiment × 0.8). Sentiment < -0.5 without existing motive → PERSONAL_GRUDGE via tick phase handler (every 30 game min).

## Clock-Driven Architecture

- **Master Clock**: единственный `setInterval` (`1000/gameSpeed` ms). Drives time + processing.
- **MINUTES_PER_DAY = 1440**. Periods: dawn(300-420), morning(420-720), afternoon(720-1020), evening(1020-1260), night(1260-1440+0-300).
- **`gameMinute`**: абсолютный (растёт бесконечно, не оборачивается). `minuteOfDay = gameMinute % 1440`.
- **Speed**: 0=pause, 1x=1min/sec, 2x=2min/sec, 3x=3min/sec. `POST /api/speed`, `POST /api/auto` toggle.
- **ProcessingQueue**: 7 task types (DAY_ADVANCE P0, BODY_DISCOVERY P1, VOLITION/GOAL_STEP P2, CONVERSATION/CONVERSATION_IMPACT/PHASE_HANDLERS P3). Dedup per NPC. Async consumer with setTimeout(0) yield. No batch `_tick()`.
- **NPC State Machine**: `processingState` on AgentState: idle → awaiting_decision → executing_goal → in_transit → in_conversation → in_player_chat.
- **Goal Step Chaining**: non-LLM steps (announce, examine_scene) chain instantly. Loop until transit/LLM/wait/MAX_CHAIN=10.
- **Cooldowns** (game minutes): affordance=180 (3h), decision=60 (1h), pair=240 (4h). Configurable via WorldConfig. Persisted in save.json.
- **Transit**: NPC перемещаются с `duration = hops × minutesPerHop` (default 30). Master Clock advances `transitProgress`. Arrival triggers co-location checks.
- **Mood system tick** (`_tickMoodSystem`): every 5 game min. Ticks modifier durations, recalculates social stress (drift to target), loneliness, computes effectiveMood = baseMood + Σ modifiers, records mood snapshot for history.
- **Conversation flow**: CONVERSATION task → findPair (NPCs in wait steps eligible) → runConversation → beliefTransfer → _pendingImpactQueue.push → CONVERSATION_IMPACT task (deterministic, no LLM) → mood modifiers to participants+bystanders → memories → overhear. try/finally on processingState.
- **Interact pursuit**: target not at location → chase to current location (up to 3 attempts for priority ≥ 7). Not passive timeout.
- **Belief-gated affordances**: investigate blocked by `deductionBelowThreshold` (conf ≥ 0.7 → arrest only). Structured check, not cooldown.
- **Persistent Memory (SPEC-persistent-memory)**: `_memoryLog` on VectorMemory = primary storage. Qdrant = search index (best-effort). `store()` → dual write. `recall()` → 3-level fallback (Qdrant → cosine brute-force → keyword). `getAllMemories()` is sync. `toJSON()`/`loadState()` for save/restore. Eviction at capacity (200/NPC), protected memories immune. `playerId` field on every MemoryEntry (default `WORLD_MEMORY_OWNER = "__world__"`). Compact save.json. Boot: conditional Qdrant init, parallel memory restore, no double seeding of knownFacts.
- **Contract validation**: Runtime guards at engine entry points — `addGoal()` asserts id/ownerId/createdAtMinute/steps, `addBelief()` asserts id/eventType/source/confidence range, `registerStepHandler`/`registerEventHandler` assert non-empty action + function, `registerTopicSource` asserts arity === 3. Static lint: `as any` banned in modules/server (architecture.test.ts). Boot contracts: topic source arity, step handler registration, stepTemplate action field.
- **World data validation**: `world-loader.ts` validates all JSON against engine registries at load time — secrets (eventType registered, npcId/subject valid), motives (from/to valid), relationships (from/to valid). Warnings logged.

## Tests

- **Run all**: `bun run test` (151 tests: boot-smoke 37, save-load 18, architecture 20, cg-v2 17, heat 5, m3-systems 15, cg-integration 17, regression 7, world-data 12)
- **architecture.test.ts** — static lint: engine boundary, hardcoded module strings, direct mood mutation, text matching, `as any` ban
- **boot-smoke.test.ts** — registry validation: affordance consistency, targetFinder/stepHandler/requirement integrity, topic source arity, step handler registration
- **save-load.test.ts** — round-trip serialization: beliefs, relationships, mood modifiers, dead agents, memories, edge cases
- **TypeScript strict**: `bun x tsc --noEmit` — target 0 errors. All 156 historical errors resolved.
- Run `bun run test` before commits.

## World Editor

- **Run**: `bun run editor` (port 3001). `--world=path` for custom world directory.
- 7 sections: NPCs, Relationships, Motives, Secrets, Locations, Topics, Config
- All typed fields (eventType, source, subject, motive type, relationship type) use dropdowns from engine registries via `/api/registry`
- Reads/writes JSON files in `worlds/` directly. Standalone — no dependency on running CLWA server.

## Current Status

v0.13.1 (M3 complete). M1 (Replayable Crime) done. M2 (Detective Toolkit) done — backend + Web UI. M2.5 (Memory & Infrastructure) done — persistent memory, TS strict, contract validation. **M3 (Living Opposition) done** — CG v2, heat, criminal escalation, Garrett variability, NPC resistance, witness reactions.

Key systems: persistent NPC memory (dual storage _memoryLog + Qdrant, 3-level fallback, multiplayer-ready playerId), contract validation (runtime guards on addGoal/addBelief/registerStepHandler/registerTopicSource + `as any` lint + boot arity checks), world-loader JSON validation against engine registries.

14 engine subsystems, 40+ registries, 23 affordances, 29 specs. Engine/module boundary fully clean — zero hardcoded module vocabulary in engine. 151 tests (8 test files), 0 TS errors.

Tools: `bun clwa` (game server :3000), `bun world` (world editor :3001), `bun docs` (docs reader + intelligence dashboard :3002).

M3 (Living Opposition) feature-complete: CG v2, heat system, criminal escalation, Garrett variability, NPC resistance, witness reactions, cover-up suppression, detective toolkit. Next: M4 (Complete Session). See docs/ROADMAP.md.
