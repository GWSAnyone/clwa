# SPEC: Ambient Mood Pressure — Loneliness Decay

> **Milestone**: M3 (Living Opposition)
> **Status**: Implemented
> **Depends on**: SPEC-mood-modifiers (done)
> **Engine changes**: None. Mood tick handler additions.
> **Created**: 2026-04-03
> **Completed**: 2026-04-03
> Micro-spec. Mood давление без conversations — personality-driven loneliness.

---

## Проблема

Mood decay привязан исключительно к conversation impact + moodBias. NPC без social interactions (стоящий один на локации) не получает mood pressure. Mark (mood -0.40) участвует в ~3 conversations за 4 game hours → -0.06 mood. Crime threshold (-0.45) достигается за ~8 game hours. GDD target: crime within 1 day (~12-14 game hours). Текущий темп на грани — и зависит от удачного co-location.

## Решение

Ambient loneliness decay: если NPC не взаимодействовал ни с кем > N минут → mood падает. Rate зависит от Extraversion (E) — extraverts страдают от изоляции сильнее.

## Дизайн

### Loneliness Decay

```typescript
// Constants (WorldConfig candidates)
const LONELINESS_THRESHOLD = 30;     // game minutes without interaction before decay starts
const LONELINESS_BASE_RATE = 0.001;  // mood decay per 5 game minutes (base)
const LONELINESS_CHECK_INTERVAL = 5; // apply every N game minutes
```

**Rate formula:**
```
decayRate = LONELINESS_BASE_RATE * (agent.bigFive.E * 1.5 + 0.5)
```

| Extraversion | Multiplier | Decay per 5 min | Decay per hour |
|-------------|-----------|-----------------|----------------|
| 0.26 (Bess) | 0.89 | -0.00089 | -0.0107 |
| 0.44 (Mark baseline) | 1.16 | -0.00116 | -0.0139 |
| 0.56 (Mark randomized) | 1.34 | -0.00134 | -0.0161 |
| 0.89 (Elara) | 1.84 | -0.00184 | -0.0220 |

**Mark (E=0.56, mood=-0.40) → -0.45:**
- Need: -0.05 over ~0.0134/hour = **3.7 hours** after threshold
- With 30min threshold: **4.2 game hours** to crime
- Target 4-6 hours: **on target**

### What counts as "interaction"

**Resets loneliness timer (any engaged activity):**
- Scheduler conversation (NPC-NPC)
- Goal interact step (including hostile: blackmail, interrogate)
- Player chat (WS 'chat' message)

**Does NOT reset:**
- Being at same location without talking (passive co-location)
- Movement / transit
- Announce step (one-way broadcast, not dialogue)
- Being a bystander to others' conversation

### AgentState addition

```typescript
// Transient — not persisted in save.json
lastInteractionMinute?: number;  // game minute of last interaction
```

Set by:
- `scheduler.ts` after conversation completes → both participants
- `goals.ts` after interact step completes → owner + target
- `server.ts` WS chat handler → target NPC

### Application in Master Clock

```typescript
// In _onClockTick(), every 5 game minutes
if (this._gameMinute % 5 === 0) {
  this._applyLonelinessDecay();
}
```

```typescript
private _applyLonelinessDecay(): void {
  for (const [id, agent] of this.agents) {
    if (agent.profile.isPlayer) continue;
    if (!agent.state.alive) continue;
    if (isStatusAbsent(agent.state.status)) continue;

    const lastInteraction = agent.state.lastInteractionMinute ?? 0;
    const minutesSince = this._gameMinute - lastInteraction;
    if (minutesSince < 30) continue; // threshold: 30 min

    const E = agent.profile.bigFive.E;
    const rate = 0.001 * (E * 1.5 + 0.5);
    agent.state.mood = Math.max(-1, agent.state.mood - rate);
  }
}
```

### moodBias adjustment

With ambient decay active, **reduce moodBias from -0.02 to 0**. Ambient replaces moodBias as primary pressure source. moodBias was a blunt flat modifier; ambient is personality-driven and distance-from-social-dependent.

```json
// worlds/millhaven/world.json
"moodBias": 0
```

### Interaction tracking callsites

| File | Where | What |
|------|-------|------|
| `world.ts` | `_handleConversation()` after conversation completes | Set `lastInteractionMinute` for both participants |
| `goals.ts` | `executeStep()` case 'interact' after `runInteraction()` | Set for owner + target |
| `server.ts` | WS 'chat' handler after `applyDialogueMeaning()` | Set for target NPC |

---

## Files

| File | Changes |
|------|---------|
| `engine/src/agent-types.ts` | `lastInteractionMinute?: number` on AgentState |
| `engine/src/world.ts` | `_applyLonelinessDecay()`, call in `_onClockTick` |
| `engine/src/world.ts` | Set `lastInteractionMinute` in `_handleConversation` |
| `engine/src/goals.ts` | Set `lastInteractionMinute` in interact step |
| `server/src/server.ts` | Set `lastInteractionMinute` in WS chat handler |
| `worlds/millhaven/world.json` | `moodBias: 0` |

---

## Test

1. Mark (E=0.56, mood=-0.40) with zero conversations → mood -0.45 in 4-6 game hours
2. Elara (E=0.89) decays faster than Bess (E=0.26) — personality-driven
3. After conversation → timer resets → no decay for 30 min
4. Blackmail interaction resets timer (hostile counts as social engagement)
5. Player chat resets timer for target NPC
6. `test-ticks.sh 500` → crime happens within 8-12 game hours
