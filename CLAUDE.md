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
- Unknown = `null`. Never a placeholder string (`'someone'`, `'unknown'`). Placeholder text is OK only in human-visible prose, never in logic fields.
- Role-based behavior = **capability flags** on profile (`investigator`, `detersCrime`, `canSentence`). The `role` string is for display/LLM prose only — never for `if/switch` logic.
- LLM structured output = first-word extraction from constrained response. Never `response.includes()`.
- **Self-check**: before every string comparison, ask: "Is there a typed field or flag for this?"

### 2. Engine = Universal Laws, Modules = Worlds Built on Those Laws
Engine contains **empty registries**. Modules fill them with **data** at startup via registration functions. Engine never imports from modules.
- New behavior = data record in a module (affordance definition + CG rules + EL rules + step templates). Zero code changes in engine.
- Engine doesn't know about specific roles, crimes, social structures, or economy. It knows about affordances, beliefs, consequences, evidence, and goals — generic primitives.
- This is how the engine scales: Crime & Justice today, Economy & Trade tomorrow, Politics next — same engine, different data modules.

### 3. PM = Instinct, LLM = Consciousness
Personality Model computes utility scores → generates prose descriptions of urges. LLM freely decides — may follow instinct or transcend it (emergent character growth, the moment we didn't script).
- **Reflex** (≥0.7): bypasses LLM, auto-goal. Like yanking hand from fire.
- **Urge** (0.5-0.7): LLM decides but options constrained. Like hunger.
- **Thought** (<0.5): full freedom. Like a fleeting idea.

### 4. Emergent Narrative
We build **capabilities**, not scenarios. Scenarios are configurations of initial conditions + rules on top of the sandbox. Nobody hardcodes "Mark kills Bess" — personality + mood + relationship + opportunity converge organically.

### 5. Bilateral Design (future direction)
Every system should work identically for NPC and Player. NPC: AL generates options → LLM picks. Player: free input → Intent Layer parses → same validation → same CG/EL cascade. Same action pipeline, different input source.

### 6. Trace Dependencies Before Editing
Before modifying any function: read it, find all callers (use `find_referencing_symbols`), understand the full data flow. A change in `addBelief()` affects every subsystem that creates beliefs. A change in event payload semantics cascades through CG rules, belief creation, memory text, and target finders.

## Stack

```bash
docker compose up -d                          # Qdrant (vector memory)
bun install && bun run packages/server/src/index.ts  # → http://localhost:3000
```
- **Runtime**: Bun | **LLM**: LM Studio, `qwen/qwen3.5-9b`, `reasoning: "off"` | **Embeddings**: raw fetch (NOT OpenAI SDK)
- **Godot**: 4.6.1, WS on `127.0.0.1` (NOT localhost) | **Save**: `packages/server/data/save.json`

## Architecture

```
Engine  (packages/engine/)  — universal subsystems (AL, PM, CG, EL, Beliefs, Goals, Memory, Volition, World)
Modules (packages/modules/) — world content (affordances, CG rules, EL rules, target finders)
Server  (packages/server/)  — HTTP/WS, NPC profiles, bootstrap, persistence
```
Dependencies: `modules → engine`, `server → engine + modules`. Engine **never** depends on modules.

**Core loop**: State → AL (what's possible) → PM (who you are) → LLM (free decision) → CG (consequences) + EL (evidence) → new State

## Engine Invariants (things that break if violated)

1. **LLM semaphore**: `acquire()` → call → `release()` in **finally**. Concurrency = 1. Tick mutex.
2. **Null semantics**: `belief.subject = null` means unknown suspect. `addBelief()` merges null → concrete when new info arrives. Never use strings as null-substitutes.
3. **Event.subject ambiguity**: meaning varies by event type. Use typed payload fields (e.g. `killerName`, `discoveredBy`) as authoritative source, not `event.subject`.
4. **Registry pattern**: engine exposes empty Maps/Arrays (`AFFORDANCE_REGISTRY`, `TARGET_FINDERS`, `EVIDENCE_RULES`, etc). Modules call registration functions at startup. Engine code never references module-specific IDs.
5. **Capability flags on AgentProfile**: `investigator`, `detersCrime`, `canSentence`. Engine checks these — never `profile.role === 'guard'`. Role is prose.
6. **Belief name format**: `subject`/`object` = plain `profile.name`. Never `"Name the role"`. Use `matchesNpc()` for fuzzy matching.
7. **Goal lifecycle**: events must trigger goal cleanup (e.g. sentencing clears investigation goals). Without cleanup → infinite behavioral loops.
8. **Reactive evaluation**: `sourceEvent` field in event payload is mandatory for reactive target finders to fire. Missing it = silent skip.
9. **Save/persistence**: `toJSON()`/`loadState()` on World. Sets serialize as arrays. Beliefs, goals, relationships all persist.

## Current Status

Milestone 5: Crime & Justice module (15 layers ✅). Next: demo polish, then Engine Foundation (Intent Layer, bilateral design).
