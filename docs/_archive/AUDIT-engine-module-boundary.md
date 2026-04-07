# AUDIT: Engine/Module Boundary — Ultra-Deep Review

> Date: 2026-04-07 | Version: v0.11.0-dev | Grade: **B+**

---

## Summary

95% of engine code strictly follows the registry pattern. **3 critical violations** found, all concentrated in one area: **IL accusation response logic** (il.ts:858-876, world.ts:1598). This is the only place where the Economy Module Test fails. Fix is localized — one new registry (`ACCUSATION_RESPONSE_REGISTRY`) + move policy logic to crime-justice module.

**3 medium violations** — pre-populated registry defaults in event-registry.ts with module-specific entries.

---

## MUST FIX (Critical)

### 1. Hardcoded 'arrest' and 'investigate' in IL accusation logic
- **File**: `packages/engine/src/il.ts:858-876`
- **Invariant**: #3 (Registry pattern), #2 (Engine = Universal Laws)
- Engine hardcodes: strong evidence + investigator = `'arrest'` goal, moderate = `'investigate'` goal
- Economy module with `tax_audit` or `confiscate_goods` affordances would still get `'arrest'`
- **Fix**: `ACCUSATION_RESPONSE_REGISTRY` — module registers mapping (evidence_quality, npc_capability) → goal_type

### 2. Hardcoded 'arrest' in isArrestTarget
- **File**: `packages/engine/src/world.ts:1598`
- `isArrestTarget: (npcId) => this.goalManager.isTargetOfGoalType(npcId, 'arrest')`
- Economy module `confiscate` goal won't block re-evaluation → duplicate goals
- **Fix**: `registerBlockingGoalTypes(['arrest', ...])` — registry of goal types that prevent target re-evaluation

### 3. Hardcoded evidence quality → goal type mapping
- **File**: `packages/engine/src/il.ts:858-876`
- Same code as #1 from decision logic side. Engine decides policy: strong=arrest, moderate=investigate
- This is crime-justice module policy, not engine law
- **Fix**: Same `ACCUSATION_RESPONSE_REGISTRY`

---

## SHOULD FIX (Medium)

### 4. RELATIONSHIP_LABELS hardcoded defaults
- **File**: `packages/engine/src/event-registry.ts:291-299`
- Engine pre-populates: friend, colleague, family, rival, mentor, romantic, acquaintance
- Should be empty, filled by modules via `registerRelationshipLabels()`

### 5. BELIEF_SOURCE_LABELS includes module sources
- **File**: `packages/engine/src/event-registry.ts:312-323`
- 5 of 10 entries are module-defined: witness, interrogation, rumor, perpetrator, cover_up
- Engine sources (testimony, observation, evidence, deduction, body_discovery) are OK
- Module sources should move to `registerCrimeJusticeModule()`

### 6. SOURCE_TRANSFER_WEIGHTS includes module sources
- **File**: `packages/engine/src/event-registry.ts:352-362`
- 4 module-defined sources with hardcoded weights: witness 0.85, rumor 0.5, perpetrator 0.0, cover_up 0.0
- Same fix: move to module registration

---

## CONSIDER (Low)

### 7. Legacy 'free' string in loadState
- **File**: `packages/engine/src/world.ts:1803`
- Backward compat: `status === 'free' ? undefined : status`
- Invariant #9 says null/undefined = free. This is migration code.
- Can be removed after next major version

---

## Clean Areas (Verified)

| Area | Status | Evidence |
|------|--------|----------|
| Import analysis (engine → modules) | CLEAN | 0 imports from modules/server in engine/ |
| Capability flags vs role strings | CLEAN | al.ts, goals.ts use investigator/detersCrime/canSentence |
| Bilateral design | CLEAN | isPlayer guards in all NPC-only loops |
| LLM discipline | CLEAN | Semaphore acquire/release in finally, 6 call sites |
| Event type flags | CLEAN | isTransferable(), isPerpetrator() — never string comparison |
| Discovery handlers | CLEAN | Engine detects condition, module owns response via registry |
| Location system | CLEAN | Slug IDs in logic, display names via locationResolver |
| Structured data | CLEAN | json_schema on all LLM decision calls |
| ProcessingQueue | CLEAN | Priority sort, dedup, async consumer with yield |

---

## Economy Module Test — Trace

| # | Subsystem | Result |
|---|-----------|--------|
| 1 | Registration (events, flags, verbs) | PASS |
| 2 | AL (affordances) | PASS |
| 3 | PM (personality scoring) | PASS |
| 4 | Volition (LLM decision) | PASS |
| 5 | Goals (step execution) | PASS |
| 6 | CG (cascade) | PASS |
| 7 | Beliefs (transfer, decay, dedup) | PASS |
| 8 | IL (accusation response) | **FAIL** — hardcoded 'arrest'/'investigate' |
| 9 | isArrestTarget guard | **FAIL** — checks only 'arrest' |

7/9 clean. Fix items 1-3 → 9/9.

---

## Priority

1. `ACCUSATION_RESPONSE_REGISTRY` — blocks multi-module extensibility
2. Registry defaults cleanup — hygiene, move module entries to registerCrimeJusticeModule()
3. Legacy 'free' string — trivial, next major version
