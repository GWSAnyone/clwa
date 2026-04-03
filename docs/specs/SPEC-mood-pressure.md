# SPEC-mood-pressure: Social Stress & Conversation Impact

> **Status:** Draft
> **Blocks:** M2 gameplay testing (crime never triggers organically)
> **Replaces:** moodBias (removed), ambient loneliness (kept as sub-mechanism)

---

## Problem

Crime requires `mood < -0.45`. Mark starts at -0.20 to -0.55 (seed-dependent). No sustained downward pressure exists:

| Current Force | Value | Effect over 8h |
|---|---|---|
| Loneliness decay | -0.00155/5min | ~0 (Mark talks every 30-60min, threshold never fires) |
| rivalPenalty (Bess) | -0.01/conversation | -0.02 (pair cooldown 240min → 2 conversations) |
| Neutral conversations | ~+0.01 | +0.05 to +0.15 |
| Goal completion boost | +0.05 to +0.10 | +0.10 to +0.25 |
| **Net** | | **+0.13 to +0.38 (mood RISES)** |

Mark's mood oscillates around starting value. Crime never triggers.

## Solution: Two Mechanisms

### Mechanism 1 — Social Stress (ambient, every 5 game minutes)

Negative relationships create constant background mood pressure. More enemies → more stress. Positive relationships partially buffer.

**Formula:**
```
negativePressure = Σ |sentiment_i|      for all relationships where sentiment < 0
positiveBuffer   = Σ  sentiment_i       for all relationships where sentiment > 0
socialStress     = max(0, negativePressure − positiveBuffer × bufferFactor)
personalityScale = N × 1.5 + (1 − A) × 0.5 + (1 − H) × 0.3
moodDelta        = −socialStress × personalityScale × baseRate
```

**Why absolute sentiment (not squared):** Linear `|sent|` reduces variance between seeds. With randomized relationships (sentimentRange), `sent²` creates 5x variance between mild/extreme seeds — too much for a single baseRate. Linear gives 2-3x variance, which the maxRate clamp handles gracefully. Extreme enemies still dominate (0.70 vs 0.10), just not as dramatically.

**Why this personalityScale:**
- **N (Neuroticism)** × 1.5: neurotic people ruminate more on social friction
- **(1−A) (Disagreeableness)** × 0.5: disagreeable people escalate conflict internally
- **(1−H) (Dishonesty)** × 0.3: dishonest people carry paranoia about being exposed

**Clamp:** `moodDelta = max(moodDelta, -maxRate)` — prevents instant crash for NPCs with many enemies. Default maxRate = 0.005/tick.

**Config** (`WorldConfig`):
```typescript
socialStress?: {
  baseRate?: number;      // default 0.003 — mood loss per 5min per unit of stress×personality
  bufferFactor?: number;  // default 0.5 — how much positive relationships offset negative
  maxRate?: number;        // default 0.003 — floor clamp per tick (prevents >0.036/hour)
}
```

**Callsite:** `World._applySocialStress()` — replaces `_applyLonelinessDecay()`. Loneliness check preserved inside the same method as additive secondary factor.

### Mechanism 2 — Sentiment-Proportional Conversation Impact

Talking to someone you hate should hurt proportionally to hatred, not a flat -0.01.

**Current code** (world.ts `_handleConversationImpact`):
```typescript
if (rel.sentiment > rm.friendThreshold) moodDelta += rm.friendBonus;      // +0.01
else if (rel.sentiment < rm.rivalThreshold) moodDelta += rm.rivalPenalty;  // -0.01
```

**New code:**
```typescript
if (rel.sentiment < rm.rivalThreshold) {
  moodDelta += rel.sentiment * rm.rivalMoodScale;
} else if (rel.sentiment > rm.friendThreshold) {
  moodDelta += rel.sentiment * rm.friendMoodScale;
}
```

**Config** (`ConversationConfig.relationshipMoodModifier`):
```typescript
// REPLACE friendBonus/rivalPenalty with:
rivalMoodScale: number;   // default 0.04 — rival mood impact per sentiment unit
friendMoodScale: number;  // default 0.02 — friend mood boost per sentiment unit
```

**Example:** Mark↔Bess (`sent=-0.70`): `-0.70 × 0.04 = -0.028` per conversation (was -0.01).

---

## Calibration

### Mark (criminal NPC)

| Parameter | Value |
|---|---|
| Relationships | Bess: -0.70, Hilda: -0.15, Ted: -0.10, Garrett: -0.10, Elara: ~0 |
| negativePressure | 0.49 + 0.0225 + 0.01 + 0.01 = **0.5325** |
| positiveBuffer | **0** |
| socialStress | **0.5325** |
| N=0.6, A=0.3, H=0.2 | personalityScale = 0.9 + 0.35 + 0.24 = **1.49** |
| moodDelta/5min | -0.5325 × 1.49 × 0.003 = **-0.00238** |
| **Over 8h (96 ticks)** | **-0.228** |

Conversation extra (2 Bess conversations): -0.056
**Total mood shift over 8h: -0.284**

| Starting Mood | After 8h | After 10h | After 12h | Crime? |
|---|---|---|---|---|
| -0.15 (best) | -0.43 | -0.49 | -0.55 | ✅ ~10h |
| -0.20 | -0.48 | -0.55 | -0.62 | ✅ ~8h |
| -0.35 | -0.63 | -0.70 | — | ✅ ~5h |
| -0.55 (worst) | — | — | — | ✅ immediate |

### Aldric (peaceful NPC — must NOT be affected)

| Parameter | Value |
|---|---|
| negativePressure | **0** (no negative relationships) |
| positiveBuffer | ~0.09 (Bess: friend, sent ~0.3) |
| socialStress | **0** |
| **moodDelta** | **0** ✅ |

### Hilda (moderate tensions — should NOT reach crime)

| Parameter | Value |
|---|---|
| negativePressure | 0.04 + 0.01 = **0.05** |
| personalityScale (N=0.2, A=0.3, H=0.7) | **0.74** |
| moodDelta/5min | **-0.000111** |
| **Over 8h** | **-0.011** (negligible) ✅ |

---

## Engine Boundary Compliance

- ✅ No module-specific strings in engine
- ✅ Only reads sentiment (RelationshipGraph) and OCEAN traits (AgentProfile) — both engine concepts
- ✅ All constants configurable in WorldConfig/ConversationConfig
- ✅ Universal: Economy NPCs with bad trade relationships would also experience social stress
- ✅ Loneliness preserved as additive sub-mechanism (hermit NPCs still decay when isolated)

## Files Changed

| File | Change |
|---|---|
| `engine/src/world-types.ts` | Add `SocialStressConfig` to `WorldConfig`. Replace `friendBonus`/`rivalPenalty` with `sentimentMoodScale`/`friendMoodScale` in `ConversationConfig` |
| `engine/src/world.ts` | Rename `_applyLonelinessDecay()` → `_applySocialStress()`. Add social stress formula. Loneliness stays inside. Update `_handleConversationImpact()` to use proportional sentiment |
| No module changes | — |
| No world data changes | Defaults cover Millhaven calibration |

## Design Decisions

**No upward counterforce (intentional).** Social stress only pushes mood down. Positive relationships reduce the pressure, but don't actively restore mood. The only upward force is goal completion boost (+0.05 to +0.10). This creates a **criminal spiral**: after committing a crime, Mark gets temporary relief (+0.10), but social stress resumes immediately → mood drops back → next crime. This matches the GDD's "escalation as organic clock" design: the criminal doesn't stop, each crime is temporary relief from mounting pressure. If testing shows the spiral is too aggressive, add a `recoveryRate` that ticks mood toward 0 when socialStress = 0. But default: no recovery.

**personalityScale range [0, 2.3] (unbound, intentional).** Extreme NPC traits (N=0.8, A=0.15, H=0.15) would produce personalityScale=1.88 — 26% higher than Mark's 1.49. Combined with the -0.005 maxRate clamp, even extreme NPCs can't crash faster than -0.06/hour. The moodCurve numbness plateau (mood < -0.8) also dampens runaway at the AL scoring level. No normalization needed.

## What This Does NOT Change

- **Goal completion mood boost** — kept. Completing crimes gives short-term relief (+0.08 to +0.10), but social stress resumes immediately. This creates realistic "temporary relief, long-term spiral" pattern.
- **Loneliness decay** — kept as sub-mechanism inside `_applySocialStress()`. Still fires for isolated NPCs.
- **CG event mood shifts** — kept unchanged. Major events (WITNESS_MEMORY, etc.) still apply their fixed shifts.
- **Enneagram core desire** — deferred. Current mechanisms sufficient for target metric.
- **Goal failure penalty** — deferred. Requires goal outcome tracking (separate design).

## Test Metric

**Mark must reach `mood < -0.45` within 8–12 game hours without player intervention.**

Verification:
1. Clean start (delete save.json)
2. `bash test-ticks.sh 800` (800 ticks ≈ 13+ game hours at 1min/tick)
3. Grep logs for `[SocialStress]` and `[Impact:debug]` entries
4. Plot Mark's mood curve from `test-run.jsonl`
5. Confirm crime event appears between tick ~480 and ~720
