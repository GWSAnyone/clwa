# AUDIT: Volition + Affordance Layer (AL) — Ultra-Deep Review

> Date: 2026-04-07 | Version: v0.11.0-dev | Grade: **B**

---

## Summary

Scoring math is flawless. Instinct builder is one of the best procedural NPC motivation systems seen. LLM discipline is clean. **1 critical problem dominates**: `checkRequirements` uses a hardcoded if-chain instead of generic iteration over `REQUIREMENT_CHECKERS` — this breaks Economy Module Test, caused 2 real bugs, and creates 70 lines of duplication. Fix is already proven in `validatePlayerAction` (line 573).

---

## MUST FIX (Critical)

### 1. checkRequirements — hardcoded if-chain, not extensible
- **File**: `packages/engine/src/al.ts:268-336` and `343-410`
- **Invariant**: #3 (Registry pattern), #6 (Step handlers via registry)
- Functions use explicit `if (req.isCriminal) { checker = REQUIREMENT_CHECKERS.get('isCriminal') }` for each requirement type
- Only 7 of 9 registered checkers are called. **2 silently ignored:**
  - `hasSuspicionBelief` (registered in crime-justice/index.ts:48-70) — surveillance affordance requirement unchecked
  - `deductionBelowThreshold` (registered) — investigate should be BLOCKED when conf >= 0.7, but isn't
- Economy Module Test FAILS: new module registers `REQUIREMENT_CHECKERS.set('hasTradePermit', ...)` — engine ignores it
- **Fix already proven**: `validatePlayerAction` (al.ts:573) uses generic iteration:
  ```typescript
  for (const [key, checker] of REQUIREMENT_CHECKERS) {
      if ((req as Record<string, unknown>)[key] && !checker(playerAgent, ctx)) { ... }
  ```
- **Fix**: Replace if-chain in both checkRequirements/checkRequirementsReactive with this generic pattern. Keeps inline fast-path checks (notGuard, period, mood) but adds catch-all loop for registry checkers.
- **Impact**: Automatically fixes bugs #2 and #3 below.

### 2. deductionBelowThreshold not checked (consequence of #1)
- **File**: `al.ts:268-336`
- **Invariant**: #62
- Affordance: `investigate` requires `deductionBelowThreshold: true`
- Effect: Garrett continues investigating forever even when confidence >= 0.7 and should switch to arrest
- Mitigated by: both investigate and arrest have `minimumScore: 0.7` and `goalPriority: 9` — LLM picks. But architect intent is investigate should be BLOCKED.

### 3. hasSuspicionBelief not checked (consequence of #1)
- **File**: `al.ts:268-336`
- Affordance: `surveillance` requires `hasSuspicionBelief: true`
- Mitigated by: target finder `findSurveillanceTarget` already checks belief. But dual-layer defense broken.

---

## SHOULD FIX

### 4. checkRequirements/checkRequirementsReactive — 70 lines duplication
- **File**: `al.ts:268-336` vs `343-410`
- Near-identical methods. Difference: skip mood for reactive, different target finder call.
- Risk: updating one without the other (already happened — both miss same checkers).
- **Fix**: Extract common logic with params `skipMood: boolean`, `targetFinder: fn`.

### 5. canSentence missing from AffordanceRequirement interface
- **File**: `al.ts:11-46` (interface), `al.ts:568` (validatePlayerAction)
- `req.canSentence` is always `undefined` — dead check in validatePlayerAction.
- **Fix**: Add `canSentence?: boolean` to AffordanceRequirement.

### 6. targetHasShop — dead requirement field
- **File**: `al.ts:19`
- Defined on interface but `checkRequirements` has no `if (req.targetHasShop)` block.
- Steal works only because `findStealTarget` in module filters by `other.profile.shop`.
- Misleading API.

### 7. blackmail has isDuty without minimumScore
- **File**: `modules/crime-justice/affordances.ts:120`
- CLAUDE.md #13: "isDuty without minimumScore — likely a bug"
- blackmail is not civic duty, but isDuty blocks "talk" for target at score >= 0.5.

### 8. baseProbability — dead field on AffordanceDefinition
- **File**: `al.ts:121`, all 20+ affordances
- Defined, populated (values 0.15-1.0), but **never read** anywhere in engine.
- ~20 dead values. LLM provides stochasticity through decision freedom.
- **Fix**: Remove field and all values, or implement if needed.

### 9. parseDoWhy — dead code (65 lines)
- **File**: `volition.ts:681-746`
- Exported, 0 callers. Was text-parsing fallback, replaced by structured JSON.
- **Fix**: Delete.

---

## CONSIDER

### 10. _volitionSchema cached forever
- **File**: `volition.ts:602-624`
- Created lazy once. If module calls `registerActionVerbs()` after first LLM call, new verbs won't appear in schema.
- Acceptable now (modules register at startup). Add `invalidateVolitionSchema()` for future.

### 11. Memory leak in tracking Maps
- **File**: `volition.ts:562` (_recentTalkTargets), `volition.ts:578` (_considerations)
- Grow unbounded. 100 game days × 7 NPC = ~300 entries. At 50 NPC = ~5000.
- **Fix**: Periodic cleanup on day advance.

### 12. Target finders use hardcoded event type strings
- **File**: `modules/crime-justice/target-finders.ts:104,339,516`
- `belief.eventType === 'NPC_KILLED' ? 'murder' : 'crime'` — module code (not engine violation), but fragile.
- **Fix**: Use `getEventLabel(eventType) ?? 'crime'` (already exists nearby).

---

## Clean Areas (Verified)

| Area | Grade | Notes |
|------|-------|-------|
| Scoring math (moodCurve, sentimentCurve) | A+ | Perfect continuity, personality-shifted zones, no division by zero |
| computeUtility | A | 5 inputs, clamped [0,1], bidirectional inhibition |
| Instinct builder | A+ | 7 tiers × 3 textures × 9 Enneagram × resistance voice × escalation |
| LLM prompt construction | A | Beliefs in USER (lost-middle avoidance), dynamic verb enum, no RP framing |
| Cooldown system | A | 3 levels, configurable per-affordance, persisted, absolute gameMinute |
| Import analysis | A | Zero imports from modules/server in engine |
| Bilateral design | A | isPlayer guards correct, validatePlayerAction mirrors NPC evaluation |
| Structured output | A | JSON schema constrained decoding, verb enum from registries |

---

## Industry Context

- CLWA scoring follows Dave Mark's [Utility AI response curves](https://www.gdcvault.com/play/1012410/Improving-AI-Decision-Modeling-Through) — piecewise non-linear functions. CLWA adds personality-shifted zone boundaries (more advanced than standard curves).
- Additive model with clamping vs multiplicative — correct choice for current scale (7 NPC, 20 affordances). At 50+ NPC, consider [Infinite Axis Utility System](https://www.cloderic.com/content/2013-04-24-ai-summit-2013-takeaway).
- PM→instinct→LLM pipeline is [unprecedented in industry](https://www.gamedeveloper.com/design/rimworld-dwarf-fortress-and-procedurally-generated-story-telling) (DF/RimWorld use pure rule systems without LLM).

---

## Priority

1. **Immediate**: Generic loop in checkRequirements (fixes 2 bugs + Economy Module Test)
2. **Soon**: Delete parseDoWhy, baseProbability field; add canSentence to AffordanceRequirement; fix blackmail isDuty
3. **Defer**: Map cleanup, schema invalidation, DRY extract
4. **Don't touch**: Scoring math, instinct builder, LLM prompt — they work excellently
