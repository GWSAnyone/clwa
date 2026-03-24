# CLWA — Behavioral Physics Engine

> A physics engine doesn't know what a "car" is — it knows rigid bodies and forces.
> CLWA doesn't know what a "murder" is — it knows affordances, beliefs, and consequences.
> Murder = data in a module. Trade = data in a module. Same engine, different data.
> Stories are not scripted — they emerge from system interactions.
>
> **Every subsystem, every interface, every design decision targets a universal MMO world** — crime, economy, politics, social, combat are all just data modules on the same behavioral physics engine. Current milestone (Crime & Justice) is proof of concept, not the scope.

**On session start**: read Serena memories `clwa/overview` and `clwa/engine-invariants` for full project context. Read `clwa/godot-client` when working on Godot. Full specs: @ARCHITECTURE.md | @ROADMAP.md | @DEMO_PLAN.md

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
Engine contains **empty registries** (30+ in event-registry.ts). Modules fill them at startup. Engine never imports from modules.
- New behavior = data record in a module. Zero code changes in engine.
- Engine doesn't know specific roles, crimes, event types, verdict strings, status values, or scene types. All via registries.
- **Test**: "If I add an Economy module with FRAUD/SMUGGLING events — does engine handle them without any engine code changes?" If no → violation.

### 3. PM = Instinct, LLM = Consciousness
Personality Model computes utility scores → instinct-builder generates vivid prose (7 tiers × 3 textures × Enneagram × resistance). LLM freely decides — may follow instinct or transcend it. **No reflex bypass** — LLM always has final say. Stronger instincts = more vivid descriptions = harder to resist naturally.
- **Volition prompt**: NO RP framing ("you are a character in simulation" triggers safety alignment). Just character identity + instincts.
- **Scoring v2**: non-linear moodCurve (sliding/desperation/numbness zones), bidirectional (positive mood inhibits crime), trust as 5th input, DEBT_PRESSURE beliefModifiers.

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
- **GGUF Patch**: thinking отключён патчем в GGUF binary. В chat template заменено `enable_thinking is defined and` → `if true` (same-length binary replace). Backup: `.bak`. Если нужно перепатчить новый GGUF — см. `training/patch-gguf-thinking.py`
- **Godot**: 4.6.1, WS on `127.0.0.1` (NOT localhost) | **Save**: `packages/server/data/save.json`

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
3. **Registry pattern**: engine has empty registries. Modules fill them. Engine never references module-specific IDs, event types, status strings, or verdict values.
4. **Capability flags**: investigator/detersCrime/canSentence on profile. Never role strings for logic.
5. **All types = string**: EventType, NpcStatus, BeliefSource — no unions. Modules define values via registries.
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
40. **TopicEngine v3**: 13 sources (11 social + 2 crime). Bidirectional beliefs, recency weighting, location context, cross-source dedup (topicKey), death-aware opinions. Location hooks via `registerLocationHook` registry.
41. **Location hooks**: `conversationHook` field in world.json locations → `registerLocationHook` registry → `getLocationHook` in topic sources. No hardcoded location names in modules.
42. **Location IDs**: internal state uses slug IDs (`market-square`). LLM prompts use display names (`Market Square`) via `locationResolver` on Agent and `locName()` helpers. world-loader.ts maps JSON names → slugs. pathfinding/movement/perception all work with IDs.
43. **Discovery handlers**: engine detects discovery condition (dead+alive co-location), creates event. Module owns the response (memory, mood, belief, grief) via DISCOVERY_HANDLERS registry. Engine has zero hardcoded discovery behavior.
44. **Socialize affordance**: social module registers `socialize` with `socialOnly: true` on AffordanceDefinition — triggers LLM volition for extraverted NPCs (E>0.7) without crime events. No actionVerb (invisible to LLM). Engine checks `definition.socialOnly` flag (not affordance ID) in volition: "talk" becomes move-only → TopicEngine handles conversation.
45. **Conversation prompts**: `YOUR TOPIC:` prefix in initiator/responder prompts. Topic hook first, then context. Gesture schema constrained to one word. knownFacts removed from buildSystemPrompt. Memory format: `(today, vivid)` not numeric scores. Mood calibration in impact analysis.

## Tick System

- **TICKS_PER_DAY = 96** (1 tick = 15 game minutes). Periods: dawn(20-28), morning(28-48), afternoon(48-68), evening(68-84), night(84-96+0-20).
- **Auto-tick**: tick-when-ready pattern (setTimeout loop, not setInterval). Default interval 8s → 1 day ≈ 13 min.
- **Speed control**: `POST /api/auto { seconds: N }` to start, same endpoint to stop (toggle).
- **Cooldowns**: affordance=12 ticks (3h game), decision=4 ticks (1h game), conversation pair=16 ticks (4h game). All configurable via WorldConfig.
- **Conversation flow**: runConversation → analyzeConversationImpact → processOverhear (overhear happens AFTER impact analysis).

## Current Status

v0.9.7+. **Affordance testing**: 15/18 affordances verified in E2E tests (full chain kill→discover→report→investigate→arrest→sentence). 3 remaining (confront, vigilante, intimidate) mechanically ready — need longer WANTED→arrest windows. **Audit fixes**: all action verbs registered with runtime validation at startup; location IDs enforced everywhere (affordance templates, target-finders, crime scene beliefs); `socialOnly` flag on AffordanceDefinition replaces hardcoded 'socialize' string in engine — Economy Module Test fully passes. **Dialogue quality overhaul**: parseDialogue speech-only with robust fallback parser; speechReminder L0+random example; minLength:20 on schema; YOUR TOPIC prefix; knownFacts removed; memory format vivid/clear/fading. Socialize affordance (E-trait, socialOnly flag → TopicEngine). DISCOVERY_HANDLERS registry. TopicEngine v3.1. Engine purity: ZERO module-specific content confirmed. LoRA dataset v1 (740 examples). World data externalized to JSON. Anti-repetition (1.1/0.3/0.2).
