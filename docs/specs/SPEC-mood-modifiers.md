# SPEC-mood-modifiers: Structured Mood System

> **Status:** Draft
> **Replaces:** Direct mood mutations, social stress hack, SPEC-mood-pressure (partial)
> **Reference:** docs/MOOD_REVIEW.md (industry/academic analysis)
> **Deferred to M3:** Dual-layer (surface/deep), criminal confidence
> **Deferred to M5:** Arousal dimension, emotional tagging

---

## Problem

Mood as a single directly-mutated number creates a **seesaw**: positive events instantly cancel negative ones. No momentum, no narrative arc. Social stress (SPEC-mood-pressure) tried to add ambient downward force but couldn't outpace ambient positive forces from conversations.

**Root cause:** `mood += delta` is structureless. The system doesn't know why mood changed, how long the effect should last, or whether positive and negative should cancel symmetrically.

**Symptoms:**
- Mark's mood oscillates around starting value instead of trending down
- Conversations give +0.01–0.02 to all bystanders (ambient upward drift)
- One blackmail completion (+0.08) erases 2 hours of social stress
- All NPCs enter crime zone at the same mood level regardless of personality

## Solution: Two Mechanisms

### Mechanism 1 — Mood Modifiers

All mood changes become **structured objects** with source, magnitude, duration, and decay.

```typescript
interface MoodModifier {
  id: string;              // unique ID for removal/stacking
  source: string;          // human-readable: 'argument_with_bess', 'social_stress', 'witnessed_crime'
  category: string;        // stacking group: 'social_stress', 'conversation', 'event', 'pressure', 'routine'
  magnitude: number;       // -0.35 to +0.35
  remaining: number;       // game minutes left (0 = permanent until removed)
  duration: number;        // original duration (for decay calculation)
  decay: 'exponential' | 'linear' | 'none';
  negative: boolean;       // cached: magnitude < 0
}
```

**Effective mood** = `baseMood + Σ(decayed modifier magnitudes)`

Where `baseMood` = personality-derived baseline:
```
baseMood = 0.3 - N × 0.4 + E × 0.2
// Mark (N=0.6, E=0.7): 0.3 - 0.24 + 0.14 = 0.20
// Aldric (N=0.4, E=0.5): 0.3 - 0.16 + 0.10 = 0.24
```

**Decayed magnitude** per tick:
```
if decay === 'exponential':
  effectiveMag = magnitude × (remaining / duration)²
if decay === 'linear':
  effectiveMag = magnitude × (remaining / duration)
if decay === 'none':
  effectiveMag = magnitude
```

**Stacking:** Max 3 modifiers per category. If a 4th arrives, weakest (by current effectiveMag) is removed. This prevents 20 micro-conversations from stacking to a huge mood shift.

**Asymmetry — built into modifier definitions, not global multiplier:**

| Source | Magnitude | Duration | Decay | Category |
|--------|-----------|----------|-------|----------|
| Social stress (recalculated) | varies | permanent | none | social_stress |
| Conversation with rival | sent × 0.06 | 360 min (6h) | exponential | conversation |
| Conversation with friend | sent × 0.03 | 120 min (2h) | linear | conversation |
| Conversation bystander | moodValence × 0.5 | 60 min (1h) | linear | conversation |
| Witness traumatic event | -0.20 to -0.30 | 1440 min (24h) | exponential | event |
| Goal completion (duty) | +0.05 to +0.10 | 180 min (3h) | linear | routine |
| IL pressure (threat) | pe.mood × intensity | 240 min (4h) | exponential | pressure |
| IL speechAct (insult) | sae.mood | 120 min (2h) | linear | pressure |
| Grief (relationship) | griefPenalty | 720 min (12h) | exponential | event |
| Day advance baseline drift | toward 0 | 1440 min | linear | routine |

**Key asymmetry:** Rival conversations last 6h exponential (slow decay), friend conversations last 2h linear (fast decay). Negative event modifiers last 24h, positive routine 3h. Over time, **negative accumulates naturally** without any global asymmetry knob.

### Mechanism 2 — Personality-Shifted Zones

`moodCurve()` thresholds shift based on Honesty-Humility (H):

```
slidingEntry   = -0.30 + (1 - H) × 0.20
desperationEntry = slidingEntry - 0.30
numbnessEntry    = slidingEntry - 0.50
```

| NPC | H | slidingEntry | desperationEntry | numbnessEntry |
|-----|---|-------------|-----------------|---------------|
| Mark | 0.2 | **-0.14** | -0.44 | -0.64 |
| Ted | 0.6 | **-0.22** | -0.52 | -0.72 |
| Aldric | 0.9 | **-0.28** | -0.58 | -0.78 |

**Effect:** Mark enters crime-viable zone at mood -0.14 (much earlier). Aldric needs mood -0.28. At the same mood -0.20, Mark is already in sliding zone with rising crime utility, while Aldric is still below threshold.

**New moodCurve signature:**
```typescript
function moodCurve(mood: number, H: number): number
```

---

## Tick Processing

Every 5 game minutes (in `_tickMoodSystem`, renamed from `_applySocialStress`):

```
for each NPC:
  1. Tick all modifiers: remaining -= 5. Remove expired (remaining ≤ 0).
  2. Recalculate social stress modifier from current relationships:
     negPressure = Σ|sent_i| for negative rels
     posPressure = Σ sent_i for positive rels
     stress = max(0, negPressure - posPressure × 0.5)
     personalityScale = N × 1.5 + (1-A) × 0.5 + (1-H) × 0.3
     magnitude = -stress × personalityScale × baseRate(0.006)
     clamped to [-maxRate(0.006), 0]
     → find existing modifier with category='social_stress', update magnitude IN-PLACE.
       If not found, create. Never delete+recreate (avoids churn).
  3. Loneliness check (kept as sub-mechanism):
     → add/update 'loneliness' modifier if threshold exceeded
  4. Compute effectiveMood = baseMood + Σ decayed magnitudes
  5. Clamp to [-1, 1]
  6. Set agent.state.mood = effectiveMood
  7. Record mood snapshot for history
```

---

## addModifier Access Pattern

CG and IL don't have access to World directly. Use **callback pattern** (consistent with existing ctx.onCrimeEvent):

- `WorldContext` (passed to CG): add `addMoodModifier(npcId, modifier)` callback
- `EventHandlerContext` (passed to module event handlers): same callback
- IL `applyDialogueMeaning`: receives World reference already — call `world.addModifier()` directly

## Design Decision: Permanent Social Stress

Social stress modifier is **permanent and recalculated** every 5min. If Mark's relationships don't improve, stress never goes away. This is **intentional**: ongoing source of stress reflects ongoing reality. If relationships improve → magnitude decreases automatically. No artificial cap needed.

---

## Callsite Migration

Every direct `mood +=` becomes `addModifier()`:

| Callsite | File | Current | New |
|----------|------|---------|-----|
| Social stress | world.ts:529 | `mood = newMood` | permanent modifier (recalculated) |
| Loneliness | world.ts:523 | `mood -= rate` | permanent modifier |
| Conversation impact | world.ts:792 | `mood += moodDelta` | addModifier('conversation', delta, duration, decay) |
| Goal completion | world.ts:940 | `mood += boost` | addModifier('routine', boost, 180, 'linear') |
| CG grief | cg-engine.ts:94 | `mood += griefPenalty` | addModifier('event', grief, 720, 'exponential') |
| CG event mood shift | cg-engine.ts:119 | `mood += moodShift` | addModifier('event', shift, 1440, 'exponential') |
| IL pressure | il.ts:912 | `mood += moodDelta` | addModifier('pressure', delta, 240, 'exponential') |
| IL speechAct | il.ts:967 | `mood += sae.mood` | addModifier('pressure', mood, 120, 'linear') |
| Day advance drift | world.ts:1294 | `mood += (baseline - mood) × 0.2` | Removed — baseMood + modifier decay handles this |
| Victim death | world.ts:1375 | `mood = -1` | addModifier('event', -1.0, 0, 'none') — permanent |
| Load saved | world.ts:1660 | `mood = saved.mood` | Load modifiers from save |

---

## AgentState Changes

```typescript
// ADD to AgentState:
moodModifiers: MoodModifier[];    // active modifiers
baseMood: number;                 // personality-derived, set at creation

// KEEP:
mood: number;                     // NOW = computed effectiveMood (read-only externally)
lastInteractionMinute?: number;   // for loneliness

// REMOVE (replaced by modifiers):
// nothing removed from interface — mood field stays but becomes computed
```

---

## Serialization

`toJSON()`: serialize `moodModifiers[]` and `baseMood`.
`loadState()`: restore modifiers. Recompute effectiveMood on load.

Backwards compatibility: old saves without `moodModifiers` → initialize empty array, set `baseMood` from personality formula, keep existing `mood` as starting point.

---

## Calibration

### Mark (H=0.2, N=0.6, E=0.7, Bess sent=-0.70)

```
baseMood = 0.3 - 0.24 + 0.14 = 0.20
slidingEntry = -0.14

Starting state: effectiveMood = baseMood + no modifiers = 0.20
Above slidingEntry → no crime utility from mood.

After 30 min:
  Social stress modifier: -0.006/5min × 6 ticks = magnitude -0.036 (permanent, no decay)
  effectiveMood = 0.20 - 0.036 = 0.164 → still above sliding

After 60 min (1 game hour):
  Social stress: -0.072
  1 rival conversation with Bess: magnitude -0.042, duration 360min, exponential
  effectiveMood = 0.20 - 0.072 - 0.042 = 0.086 → above sliding

After 180 min (3 game hours):
  Social stress: -0.216
  Rival convos accumulated (3 modifiers, stacking limit): ~-0.08 effective
  Some positive convos: +0.02 effective (decayed fast)
  effectiveMood = 0.20 - 0.216 - 0.08 + 0.02 = -0.076 → still above -0.14

After 300 min (5 game hours):
  Social stress: -0.360
  Rival modifiers: ~-0.06 effective (older ones decaying)
  Positive: +0.01 effective
  effectiveMood = 0.20 - 0.360 - 0.06 + 0.01 = -0.210 → BELOW -0.14!
  Mark in sliding zone. Crime utility rising.

After 420 min (7 game hours):
  Social stress: -0.504 → clamped by maxRate sum: ~-0.43
  effectiveMood ≈ -0.30 → deep in sliding zone
  Crime likely within next 1-2 hours → total ~8-9 game hours ✓
```

### Aldric (H=0.9, N=0.4, E=0.5, mostly positive rels)

```
baseMood = 0.3 - 0.16 + 0.10 = 0.24
slidingEntry = -0.28

Social stress ≈ 0 (no negative relationships)
Positive conversation modifiers: ~+0.01-0.02 effective
effectiveMood stays ~0.24-0.26
Never approaches -0.28 → no crime ✓
```

### Mild seed Mark (N=0.31, Bess sent=-0.39)

```
baseMood = 0.3 - 0.124 + 0.14 = 0.316 (higher baseline)
slidingEntry = -0.14 (same — depends only on H)

Social stress rate: much lower (weak rels + low personalityScale)
~-0.0012/5min → -0.144 over 10h
effectiveMood after 10h ≈ 0.316 - 0.144 - 0.03 + 0.02 = 0.162
Still above -0.14 → no crime on mild seed

But H might also be randomized. If H=0.15: slidingEntry = -0.13
If H=0.45: slidingEntry = -0.19
```

**Insight:** On truly mild seeds (low N, high baseMood, weak relationships), Mark may not reach crime. This is BY DESIGN — "each restart shuffles the deck." The randomization system already has `crime-capable` validation that ensures at least one NPC has the potential for crime.

---

## Config

All constants in `WorldConfig.moodSystem`:

```typescript
moodSystem?: {
  /** Social stress base rate per 5min per unit of stress×personality (default: 0.006) */
  socialStressRate?: number;
  /** Max social stress magnitude per tick (default: 0.006) */
  socialStressMax?: number;
  /** Positive relationship buffer factor (default: 0.5) */
  socialStressBuffer?: number;
  /** Max modifiers per category (default: 3) */
  maxPerCategory?: number;
  /** Modifier duration defaults (game minutes) — overridable per modifier */
  durations?: {
    conversation?: number;         // default: 120 (positive), 360 (negative)
    event?: number;                // default: 1440
    pressure?: number;             // default: 240
    routine?: number;              // default: 180
  };
};
```

---

## Engine Boundary

- ✅ MoodModifier interface — engine concept (any module adds modifiers)
- ✅ baseMood — computed from OCEAN (engine)
- ✅ Shifted zones — computed from H (engine)
- ✅ Tick processing — engine (_tickMoodSystem)
- ✅ Categories — generic strings, not module-specific
- ✅ Social stress formula — uses sentiment (engine) and OCEAN (engine)
- ✅ addModifier() — public method on World, callable from any module

---

## Files Changed

| File | Change |
|------|--------|
| `engine/src/agent-types.ts` | Add `moodModifiers: MoodModifier[]`, `baseMood: number` to AgentState |
| `engine/src/world-types.ts` | Add MoodModifier interface, MoodSystemConfig to WorldConfig. Remove old socialStress config |
| `engine/src/world.ts` | Rename `_applySocialStress` → `_tickMoodSystem`. Add `addModifier()`, `removeModifiers()`. Migrate all mood mutations. Mood interceptor captures computed mood |
| `engine/src/al.ts` | `moodCurve(mood)` → `moodCurve(mood, H)` with shifted zones |
| `engine/src/cg-engine.ts` | Grief/event mood → addModifier() calls via callback |
| `engine/src/il.ts` | Pressure/speechAct mood → addModifier() calls via callback |
| `engine/src/index.ts` | Export MoodModifier type |
| Save/Load | Serialize/restore moodModifiers[], baseMood |

---

## What Does NOT Change

- LLM volition pipeline (receives same utility scores)
- AffordanceDefinition format (weights, beliefModifiers unchanged)
- CG rules (trigger same events, mood change is downstream)
- Beliefs, Goals, Perception, IL extraction
- TopicEngine (produces same moodValence, consumed differently)
- Registry pattern
- Module boundary

---

## Test Metric

Using dev tools (GET /api/debug/snapshot, GET /api/debug/mood-history/:id):

1. **Mark crosses slidingEntry (-0.14) within 5-8 game hours** on a median seed
2. **Crime event occurs within 8-12 game hours** without player intervention
3. **Aldric never crosses his slidingEntry (-0.28)** in 24 game hours
4. **Mood modifiers visible in snapshot** — debuggable, transparent
5. **Reproducible with same seed** — POST /api/new-game?seed=N gives identical mood curves
