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
Personality Model computes utility scores → generates prose descriptions of urges. LLM freely decides — may follow instinct or transcend it.
- **Reflex** (≥0.7): bypasses LLM, auto-goal.
- **Urge** (0.5-0.7): LLM decides but constrained.
- **Thought** (<0.5): full freedom.

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
- **Runtime**: Bun | **LLM**: LM Studio, `qwen/qwen3.5-9b`, `reasoning: "off"` | **Embeddings**: raw fetch (NOT OpenAI SDK)
- **Godot**: 4.6.1, WS on `127.0.0.1` (NOT localhost) | **Save**: `packages/server/data/save.json`

## Architecture

```
Engine  (packages/engine/)  — universal subsystems, 30+ empty registries
Modules (packages/modules/) — world content via registration functions
Server  (packages/server/)  — HTTP/WS, NPC profiles, bootstrap
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
13. **minimumScore on affordances**: critical duties (arrest, investigate, evaluate_case) guarantee reflex tier (≥0.7) when conditions met. Bypasses LLM gambling.
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

## Tick System

- **TICKS_PER_DAY = 96** (1 tick = 15 game minutes). Periods: dawn(20-28), morning(28-48), afternoon(48-68), evening(68-84), night(84-96+0-20).
- **Auto-tick**: tick-when-ready pattern (setTimeout loop, not setInterval). Default interval 8s → 1 day ≈ 13 min.
- **Speed control**: `POST /api/auto { seconds: N }` to start, same endpoint to stop (toggle).
- **Cooldowns**: affordance=12 ticks (3h game), decision=4 ticks (1h game), conversation pair=16 ticks (4h game). All configurable via WorldConfig.

## Current Status

v0.9.1-dev. Player = Agent with full bilateral design. IL dialogue meaning extraction. Perception system. AL validator. Event type/source flags (no category string matching in engine). Crime scene callbacks. Full E2E chain: player claim → investigate → arrest → trial(wait 4 ticks) → exile. Post-resolution cleanup prevents re-investigation.
