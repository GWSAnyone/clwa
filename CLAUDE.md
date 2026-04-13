# CLWA — Behavioral Physics Engine

> A physics engine doesn't know what a "car" is — it knows rigid bodies and forces.
> CLWA doesn't know what a "murder" is — it knows affordances, beliefs, and consequences.
> Murder = data in a module. Trade = data in a module. Same engine, different data.
> Stories are not scripted — they emerge from system interactions.
>
> **Every subsystem, every interface, every design decision targets a universal MMO world** — crime, economy, politics, social, combat are all just data modules on the same behavioral physics engine. Current milestone (Crime & Justice) is proof of concept, not the scope.

## On Session Start

1. Read Serena memories: `clwa/overview` (codebase navigation), `clwa/engine-invariants` (81 rules — **mandatory**, things break if forgotten)
2. Read `clwa/bilateral-design` when touching player/NPC parity
3. Read `clwa/dev-tools` when using debug API
4. Read `clwa/godot-client` when working on Godot

## Design Philosophy (ALWAYS FOLLOW)

### 1. Structured Data — Never Text Matching
Every piece of state is a typed field: `null`, enum literal, number, boolean.
- Unknown = `null`. Never a placeholder string.
- Role-based behavior = **capability flags** (`investigator`, `detersCrime`, `canSentence`). The `role` string is for display only.
- **Self-check**: before every string comparison, ask: "Is there a registry, flag, or typed field for this?"

### 2. Engine = Universal Laws, Modules = Worlds Built on Those Laws
Engine contains **empty registries** (40+ in event-registry.ts). Modules fill them at startup. Engine never imports from modules.
- **Test**: "If I add an Economy module with FRAUD/SMUGGLING events — does engine handle them without any engine code changes?" If no → violation.

### 3. PM = Instinct, LLM = Consciousness
Personality Model computes utility scores → instinct-builder generates vivid prose (7 tiers × 3 textures × Enneagram × resistance). LLM freely decides — may follow instinct or transcend it. **No reflex bypass** — LLM always has final say.

### 4. Emergent Narrative
We build **capabilities**, not scenarios. Nobody hardcodes "Mark kills Bess" — personality + mood + relationship + opportunity converge organically.

### 5. Bilateral Design
Every system works identically for NPC and Player. Player = Agent with `isPlayer` flag. Same beliefs, relationships, perception. `isPlayer` guards in all NPC-only loops.

### 6. Trace Dependencies Before Editing
Before modifying any function: find all callers (`find_referencing_symbols`), understand the full data flow. Never edit blind.

### 7. No Double Standards
Do NOT rationalize keeping module knowledge in engine. Every violation sets a precedent. Fix it or document as explicit debt.

## Stack

```bash
bun clwa    # Game server → http://localhost:3000
bun world   # World editor → http://localhost:3001
bun docs    # Docs reader + intelligence dashboard → http://localhost:3002
bun test    # 151 tests (8 files)
```
- **Runtime**: Bun | **LLM**: LM Studio, `qwen3.5-9b-abliterated` | **Embeddings**: raw fetch
- **Web UI**: `http://localhost:3000/game.html` — Canvas2D, Tiny Swords sprites, A* pathfinding
- **Save**: `packages/server/data/save.json` (includes positions + memories, compact JSON)
- **Prerequisites**: `docker compose up -d` (Qdrant), LM Studio running

## Architecture

```
Engine  (packages/engine/)  — universal subsystems, 40+ empty registries, ZERO module-specific content
Modules (packages/modules/) — world content via registration functions
  ├── social/              — 13 topic sources + socialize affordance
  └── crime-justice/       — 23 affordances, 20 CG rules, step handlers
Server  (packages/server/)  — HTTP/WS, world-loader, bootstrap
Worlds  (worlds/millhaven/) — JSON world data (NPC profiles, locations, relationships)
Tools   (tools/)           — docs-reader, world-editor, kill-port
```
Dependencies: `modules → engine`, `server → engine + modules`. Engine **never** depends on modules.

## Critical Rules (will crash / corrupt / fail audit)

> Full list of 81 invariants → Serena memory `clwa/engine-invariants`. Below = top 15 that MUST be in your head always.

1. **LLM semaphore**: acquire() → call → release() in **finally**. Forgetting finally = deadlock.
2. **Null semantics**: null = unknown. Never empty string as null substitute. addBelief merges null→concrete.
3. **Registry pattern**: engine has empty registries. Modules fill them. Engine never references module-specific values. Zero hardcoded strings.
4. **Capability flags**: investigator/detersCrime/canSentence on profile. Never role strings for logic.
5. **No fallback strings**: registry returns null → skip, throw, or generic behavior. Never `?? 'HARDCODED'`.
6. **handleEventForGoals is async**: all callers MUST await. Missing await = beliefs created after response sent.
7. **No reflex bypass**: LLM always decides. Instinct builder provides pressure through vivid descriptions.
8. **Belief dedup by source**: key = (eventType, object, source). Different sources coexist. Same source overwrites.
9. **Player = Agent**: isPlayer flag. Same beliefs, relationships, mood, CG, perception. tick() skips volition/schedule/movement.
10. **isPlayer guards**: every `for (agent of agents)` loop — decide include player or not.
11. **IL bilateral parity**: Player claims → same `addBelief()` as NPC beliefTransfer. Change one = change both.
12. **Mood via addModifier**: never `agent.state.mood +=`. mood = baseMood + Σ(modifiers). All changes structured.
13. **Source/event flags**: engine checks `isTransferable()`/`isPerpetrator()` boolean flags, NOT string names. New type without flags = invisible.
14. **Module boundary**: engine NEVER imports from modules. Zero module-specific string literals.
15. **inPlayerChat cleanup**: MUST be in finally block. Exception during chat = NPC frozen forever.

## Tests

- `bun test` — 151 tests (8 files): architecture, boot-smoke, save-load, cg-v2, heat, m3-systems, cg-integration, regression, world-data
- `bun x tsc --noEmit` — 0 errors target
- Run before commits.

## Current Status

v0.13.2 (M3 complete). M1 done. M2 done. M2.5 done. **M3 (Living Opposition) done**. Next: M4 (Complete Session).

14 engine subsystems, 40+ registries, 23 affordances, 29 specs. 151 tests, 0 TS errors. Engine/module boundary clean.

See `docs/ROADMAP.md` for milestone details, `docs/specs/AUDIT-npc-systems-v0.13.md` for system quality audit.
