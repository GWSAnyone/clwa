# CLWA — Behavioral Physics Engine

> A physics engine doesn't know what a "car" is — it knows rigid bodies and forces.
> CLWA doesn't know what a "murder" is — it knows affordances, beliefs, and consequences.
> Murder = data in a module. Trade = data in a module. Same engine, different data.
> Stories are not scripted — they emerge from system interactions.
>
> **Every subsystem, every interface, every design decision targets a universal MMO world** — crime, economy, politics, social, combat are all just data modules on the same behavioral physics engine. Current milestone (Crime & Justice) is proof of concept, not the scope.

## On Session Start

1. **Always**: `clwa/overview` (codebase navigation) + `clwa/invariants` (21 hard rules — violate = crash/corrupt/deadlock)
2. **On demand**: `clwa/design-decisions` (16 anti-reversion docs) — when modifying behavior logic
3. **On demand**: `clwa/subsystem-reference` (20 implementation details) — when touching specific subsystem
4. **On demand**: `clwa/bilateral-design` | `clwa/dev-tools` | `clwa/godot-client` — when relevant

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
bun test    # run test suite
```
- **Runtime**: Bun | **LLM**: LM Studio, `qwen3.5-9b-abliterated` | **Embeddings**: raw fetch
- **Web UI**: `http://localhost:3000/game.html` — Canvas2D, Tiny Swords sprites, A* pathfinding
- **Save**: `packages/server/data/save.json` (includes positions + memories, compact JSON)
- **Prerequisites**: `docker compose up -d` (Qdrant), LM Studio running

## Architecture

```
Engine  (packages/engine/)  — universal subsystems, 40+ empty registries, ZERO module-specific content
Modules (packages/modules/) — world content via registration functions
  ├── social/              — topic sources + socialize affordance
  └── crime-justice/       — affordances, CG rules, step handlers
Server  (packages/server/)  — HTTP/WS, world-loader, bootstrap
Worlds  (worlds/millhaven/) — JSON world data (NPC profiles, locations, relationships)
Tools   (tools/)           — docs-reader, world-editor, kill-port
```
Dependencies: `modules → engine`, `server → engine + modules`. Engine **never** depends on modules.

## Critical Rules

> **Hard invariants** (stable IDs INV-NN) → Serena memory `clwa/invariants`. Violate any = crash, deadlock, corrupt state.
> **Design decisions** (stable IDs DD-NN) → Serena memory `clwa/design-decisions`. Don't revert without discussion.
> **Subsystem reference details** → Serena memory `clwa/subsystem-reference`. Consult when touching specific subsystem.
>
> IDs are stable — use them in specs and audits (e.g. "see INV-13", "per DD-01").

**Top 5 (always in your head):**
1. **INV-01 LLM semaphore**: acquire() → call → release() in **finally**. Deadlock if forgotten.
2. **INV-06 Mood via addModifier**: never direct mutation. mood = baseMood + Σ(modifiers).
3. **INV-14 Module boundary**: engine NEVER imports modules. Zero module-specific strings.
4. **INV-16 isPlayer guards**: every agent loop — decide include player or not.
5. **INV-07 Null semantics**: null = unknown. Never empty string substitute.

## Tests

- `bun test` — full test suite (architecture, boot-smoke, save-load, cg-v2, heat, m3-systems, cg-integration, regression, world-data)
- `bun x tsc --noEmit` — 0 errors target
- Run before commits.

## Current Status

Live status (version, milestone, drift) — invoke `/start-ledevia CLWA`. Do not duplicate facts here that the skill regenerates from code.

See `docs/ROADMAP.md` for milestone details and current cursor, `docs/specs/AUDIT-npc-systems-v0.13.md` for the latest system-quality audit.
