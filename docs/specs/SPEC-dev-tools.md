# SPEC-dev-tools: Universal Developer Tools

> **Milestone**: M2.5 (Memory & Infrastructure)
> **Status**: Implemented (v0.12.3)
> **Depends on**: All existing engine subsystems (save/load, CG, goals, mood modifiers, AL)
> **Engine changes**: Server routes — 6 debug endpoints + observation + quick mutation.
> **Created**: 2026-04-06
> **Completed**: 2026-04-06
> Principle: State manipulation, not scenario scripts. Engine-level operations, not module-specific.

---

## Problem

Current dev tools are **observation-only** (snapshot, mood-history). Testing specific behaviors (verdicts, investigation, crime prevention) requires waiting 20+ real minutes for organic simulation to reach the right state. No way to:
- Save and restore mid-session state
- Inject events without waiting for organic crime
- Force NPCs into specific states for testing
- See mood curves without running full LLM simulation

## Design Principles

1. **Real state, not fake state.** Named saves restore genuine memories, beliefs, relationships from organic simulation. No silent-tick shortcuts that produce hollow NPC state.
2. **Composable primitives, not scenario scripts.** Five independent tools that combine to create any test scenario. No hardcoded "test verdict" endpoint.
3. **Engine-level, module-agnostic.** Tools work with strings from registries (event types, statuses, affordance IDs). New modules work automatically.
4. **Transparent.** Every tool returns what it did (cascade results, created goals, mood changes). No silent failures.

---

## Tool 1: Named Saves

Save/restore world state at any point. Foundation for repeatable testing.

### Endpoints

```
POST /api/debug/save/:name     — save current state
POST /api/debug/load/:name     — restore saved state
GET  /api/debug/saves          — list available saves
DELETE /api/debug/save/:name   — delete a save
```

### Implementation

**Save:** `World.toJSON()` → `data/saves/{name}.json`. Name sanitized: `[a-zA-Z0-9_-]` only.

**Load:**
1. Stop Master Clock
2. `World.loadState()` from saved JSON
3. Reset transient state for all agents: `processingState → 'idle'`, `inTransit → false`, `inPlayerChat → false`
4. Clear Qdrant collections, re-seed from saved `knownFacts` per agent
5. Restart Master Clock

**Why clear Qdrant:** Vector memories are NOT saved in JSON. If we don't clear, NPCs retain memories from AFTER the checkpoint — "ghost memories from the future." Clearing + re-seeding from knownFacts gives clean baseline. Mechanical decisions (volition, goals, verdicts) use beliefs/relationships (saved), not vector memories.

**List response** includes metadata per save:
```json
{
  "saves": [
    { "name": "pre-crime", "gameMinute": 720, "day": 1, "agents": 9, "size": "48KB", "created": "2026-04-06T22:30:00Z" }
  ]
}
```

**Limitation (documented):** Post-load NPC conversations may be slightly generic (no conversation history in vector memory). Mechanical behavior is fully accurate. For conversation quality testing, let NPCs talk organically for a few minutes post-load.

### Response

```json
{
  "ok": true,
  "action": "save",
  "name": "pre-crime",
  "agents": 9,
  "gameMinute": 720,
  "path": "data/saves/pre-crime.json"
}
```

---

## Tool 2: Event Injection

Inject a world event through the real CG cascade. Creates genuine beliefs, mood modifiers, reactive goals — all through registered rules and creators.

### Endpoint

```
POST /api/debug/event
Body: {
  type: "GOODS_STOLEN",
  subject: "mark",
  object: "hilda",
  location: "silver-flagon-tavern",
  importance?: 6,
  payload?: { ... }
}
```

### Implementation

1. Validate `type` against registered event categories. Return 400 if unknown.
2. Build `WorldEvent` with provided fields + auto-generated id + current gameDay.
3. Append to EventStore.
4. Process through CG cascade (`engine.process(event, ctx)`) — real rules, real belief creators, real mood modifiers.
5. Run `handleEventForGoals(event)` + cascade events → creates reactive goals (investigate, report_crime, flee, etc.).
6. Return cascade results for transparency.

### What it does / doesn't do

| Does | Doesn't |
|------|---------|
| CG cascade (beliefs, mood modifiers, witness memories) | Execute step handlers (no actual kill/steal) |
| Reactive goal creation (investigate, report_crime) | Move NPCs physically |
| EventStore recording | Trigger LLM decisions |
| Mood modifiers via addMoodModifier | Mutate physical state (alive, inventory, location) |

**Important:** Event injection does NOT change physical state. If a CG rule depends on `target.alive === false` (e.g., body discovery), chain with Status Set: inject event first, then set status manually. The injection gives you information spreading; manual status gives you physical reality.

### Response

```json
{
  "ok": true,
  "action": "event",
  "event": { "id": "...", "type": "GOODS_STOLEN", "subject": "mark", ... },
  "cascadeResults": [
    { "rule": "witness_nearby", "targets": ["hilda", "elara"], "consequenceType": "WITNESS_MEMORY" },
    { "rule": "wanted_check", "targets": ["garrett"], "consequenceType": "WANTED_STATUS" }
  ],
  "reactiveGoals": ["garrett:investigate", "mark:lay_low"]
}
```

---

## Tool 3: Status Set

Set NPC status directly. For quickly arranging post-arrest/post-sentence states.

### Endpoint

```
POST /api/debug/status/:id
Body: { "status": "detained" | "imprisoned" | "exiled" | "fled" | null }
```

`null` or `"free"` → clears status (= free). `"imprisoned"` optionally accepts `"releaseDays": N` to set imprisonment timer.

### Validation

- NPC must exist (404 if not)
- Dead NPC → warning in response, status still set (user decides)
- No event fired — this is a debug bypass

### Response

```json
{
  "ok": true,
  "action": "status",
  "npcId": "mark",
  "oldStatus": null,
  "newStatus": "detained"
}
```

---

## Tool 4: Force Affordance

Make an NPC execute a specific affordance immediately. Uses real step templates from the affordance definition — proper goal with resolved locations and targets.

### Endpoint

```
POST /api/debug/force-affordance/:npcId
Body: { "affordanceId": "evaluate_case", "targetId": "mark", "priority"?: 10 }
```

### Implementation

1. Look up affordance in `AFFORDANCE_REGISTRY`. Return 404 if not found.
2. Resolve target: get target NPC from agents map.
3. Build goal via affordance's `stepTemplates` + `resolveTemplates()`:
   - `$target` → target NPC's current location
   - `$home` → owner NPC's home location
   - `$targetName` → target NPC's name
4. Create `NpcGoal` with high priority (default 10, overridable).
5. Add to GoalManager. NPC executes on next tick.
6. **Requirements bypassed** — this is force-create. Mood threshold, period, beliefs — all skipped.

### Response

```json
{
  "ok": true,
  "action": "force-affordance",
  "npcId": "magistrate",
  "affordanceId": "evaluate_case",
  "targetId": "mark",
  "goal": {
    "type": "evaluate_case",
    "steps": ["move_to:courthouse", "sentence_npc:mark"],
    "priority": 10
  }
}
```

---

## Tool 5: Mood Advance (Math Only)

Advance mood modifier math without running full simulation. For calibrating mood curves, social stress drift, modifier decay.

### Endpoint

```
POST /api/debug/advance-mood
Body: { "minutes": 480, "npcId"?: "mark" }
```

### Implementation

For each 5-minute tick within `minutes`:
1. Tick modifier durations (remaining -= 5, remove expired)
2. Social stress drift toward target
3. Compute effectiveMood = baseMood + Σ modifiers
4. Record mood snapshot in history

**NOT included:** loneliness (depends on gameMinute), conversations (needs LLM), goal processing, movement, events. gameMinute NOT advanced.

### Clearly Labeled

Response includes warning:
```json
{
  "ok": true,
  "action": "advance-mood",
  "warning": "Mood math only. No LLM, conversations, or events processed. Use for calibration, not behavior testing.",
  "minutes": 480,
  "ticks": 96,
  "results": [
    { "id": "mark", "name": "Mark", "before": -0.32, "after": -0.71, "delta": -0.39,
      "curve": [-0.32, -0.34, -0.37, -0.40, "...96 entries..."] }
  ]
}
```

---

## Tool 6: Tick Step

Run exactly N full simulation ticks (with LLM). Unlike auto-tick, returns control after N ticks with a summary of what happened. Unlike mood advance, this is FULL simulation.

### Endpoint

```
POST /api/debug/tick
Body: { "count": 5 }
```

### Implementation

1. Pause Master Clock (if running)
2. Call `world.tick()` exactly N times, collecting results
3. Resume Master Clock (if was running)
4. Return summary: events, goal actions, mood changes, conversations

### Response

```json
{
  "ok": true,
  "action": "tick",
  "count": 5,
  "elapsed": 3200,
  "events": 2,
  "goalActions": ["Mark: move_to silver-flagon-tavern", "Garrett: investigate"],
  "moodChanges": [{ "id": "mark", "before": -0.45, "after": -0.48 }],
  "conversations": 1
}
```

**Note:** Each tick may involve LLM calls (~500ms-2s). 5 ticks ≈ 3-10 seconds. Not instant, but controlled.

---

## Workflows

### Test different verdicts (3 min instead of 20)

```bash
# 1. Fresh game, let NPCs live organically
curl -X POST localhost:3000/api/new-game?seed=42
# wait ~5 min for organic state...

# 2. Save checkpoint
curl -X POST localhost:3000/api/debug/save/organic-5min

# 3. Inject crime → CG cascade → beliefs + wanted + reactive goals
curl -X POST localhost:3000/api/debug/event \
  -d '{"type":"GOODS_STOLEN","subject":"mark","object":"hilda","location":"silver-flagon-tavern","importance":6}'

# 4. Detain suspect
curl -X POST localhost:3000/api/debug/status/mark -d '{"status":"detained"}'

# 5. Force verdict
curl -X POST localhost:3000/api/debug/force-affordance/magistrate \
  -d '{"affordanceId":"evaluate_case","targetId":"mark"}'

# 6. Wait ~30 sec for LLM verdict
curl localhost:3000/api/debug/snapshot | jq '.npcs[] | select(.id=="mark") | {mood, status}'

# 7. Try again with different conditions
curl -X POST localhost:3000/api/debug/load/organic-5min
# ... modify Theron's personality, inject different evidence, repeat
```

### Calibrate mood across seeds (instant)

```bash
for seed in 100 200 300 400 500; do
  curl -X POST "localhost:3000/api/new-game?seed=$seed"
  sleep 2  # wait for init
  curl -X POST localhost:3000/api/debug/advance-mood -d '{"minutes":480}'
  curl localhost:3000/api/debug/snapshot | jq '[.npcs[] | {name, mood, inSlidingZone, socialStress}]'
done
```

### Test investigation chain

```bash
curl -X POST localhost:3000/api/debug/save/pre-investigation
curl -X POST localhost:3000/api/debug/event \
  -d '{"type":"NPC_KILLED","subject":"mark","object":"bess","location":"market-square","importance":10}'
# CG cascade: witnesses get beliefs, WANTED_STATUS, reactive goals
# Wait for Garrett to investigate organically...
curl localhost:3000/api/debug/snapshot | jq '.npcs[] | select(.id=="garrett") | {goals: .goalCount, top: .topAffordance}'
```

---

## Engine Boundary

| Tool | Engine concepts used | Module-specific? |
|------|---------------------|-----------------|
| Named saves | World.toJSON/loadState | No |
| Event injection | EventStore, CG cascade, handleEventForGoals | Event type = registry string |
| Status set | AgentState.status | Status = registry string |
| Force affordance | AFFORDANCE_REGISTRY, GoalManager | Affordance ID = registry string |
| Mood advance | _tickMoodSystem internals | No |
| Tick step | World.tick() | No |

All tools use existing engine API. Server layer only adds HTTP exposure. New modules register new event types, statuses, affordances → tools work automatically.

---

## Files Changed

| File | Change |
|------|--------|
| `server/src/routes.ts` | 6 new endpoint handlers |
| `engine/src/world.ts` | `advanceMoodMath(minutes)` method (extracted from _tickMoodSystem) |
| `server/data/saves/` | Directory for named save files |

No engine interface changes. No module changes. Pure additive.

---

## Test Metric

1. Save → load → snapshot produces identical NPC state (mood, beliefs, goals, relationships)
2. Event injection for GOODS_STOLEN creates ≥1 WITNESS_MEMORY belief and WANTED_STATUS event
3. Force affordance creates executable goal (NPC acts on next tick)
4. Mood advance 480min produces same social stress drift as 480min of real auto-tick (±0.01 tolerance, excluding conversation effects)
5. Full verdict test workflow (save → event → status → force → wait → check) completes in <2 min
6. Tick step with count=1 returns within 5 seconds (LLM bound)

---

## Phase 2 (Deferred)

Tools that are useful but not blocking current milestone:

| Tool | Purpose | When |
|------|---------|------|
| **Relationship manipulation** | `POST /api/debug/relationship/:id/:targetId` — set trust/sentiment | When testing trust gates, IL confidence, cooperation |
| **Belief injection** | `POST /api/debug/belief/:npcId` — addBelief with arbitrary params | When testing "what if Garrett already knows?" |
| **State diff** | `GET /api/debug/diff?from=SAVE_A&to=SAVE_B` — what changed | When debugging emergent behavior |
| **Qdrant snapshots** | Native Qdrant snapshot per save | Phase 4+ when vector count justifies complexity |
