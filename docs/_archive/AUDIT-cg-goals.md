# AUDIT: CG (Consequence Graph) + Goals — Ultra-Deep Review

> Date: 2026-04-07 | Version: v0.11.0-dev | Grade: **B**

---

## Summary

CG + Goals is one of the cleanest subsystems in CLWA. Registry-driven design works. Of 8 issues found, only 2 need immediate attention: `[CRIME` tag in engine (Economy Module Test violation) and module step infinite retry loop (latent bug). Edge cases well-handled: NPC death/arrest mid-goal, target killed, 0-step goals, concurrent goals — all correct.

---

## MUST FIX

### 1. `[CRIME` tag — module lexicon in engine
- **Files**: `goals.ts:461`, `interaction.ts:72`, `interaction.ts:177`
- Engine knows about `[CRIME...]` format — mini-DSL for structured data in purpose string
- `isUrgentReport = /\[CRIME\s/.test(purpose)` — direct condition on module lexicon
- Economy Module Test: `[TRADE...]` tags won't be handled, requires engine changes
- **Fix**: Generalize to `[META...]` or `[TAG...]` — engine strips any `[TAG...]` block. Better: purpose as object `{ display: string, meta?: Record<string, string> }` instead of string with embedded DSL.

### 2. Module step throws — infinite retry loop
- **Files**: `world.ts:822-836`, `goals.ts:596-602`
- If step handler throws: processingState resets to 'idle', but goal stays active, currentStep doesn't advance
- Next tick: same step, same exception, forever
- **Fix**: Retry counter on NpcGoal data, fail after 3 attempts:
  ```typescript
  goal.data._retryCount = ((goal.data._retryCount as number) ?? 0) + 1;
  if ((goal.data._retryCount as number) >= 3) goal.state = 'failed';
  ```

---

## SHOULD FIX

### 3. Empty CG conditions = dead rules
- **Files**: `cg-engine.ts:148-190`, `cg-rules.ts` rules 9, 10, 13
- `evaluateConditions` with `conditions: []` skips loop, returns `[]` — rules never fire
- sentence-rumor, fled-rumor, trial-rumor all have `conditions: []`
- Module event handlers already handle these events directly — CG rules are redundant
- TRIAL_REQUESTED event never emitted anywhere in codebase — fully dead
- **Fix**: Remove dead rules, or fix evaluateConditions to broadcast when conditions empty

### 4. No global cascade depth cap
- **File**: `cg-engine.ts:45`
- `maxChainDepth` is per-rule, no global safety cap
- Current rules form DAG (no cycles possible), but future modules could create cycles
- **Fix**: `MAX_GLOBAL_DEPTH = 10` at engine level, independent of rule data

### 5. Zombie goals on absent status
- **File**: `world.ts:700-703`
- Arrest via handler calls clearGoals, but absent status via debug API or future module doesn't
- Goals stay active but never processed (isStatusAbsent check in _enqueueWork)
- **Fix**: clearGoals in _enqueueWork when isStatusAbsent, or check in processGoalTick

### 6. RuleCondition.op unvalidated
- **File**: `cg-types.ts:35`
- `op` is `string`, not union. Unknown op silently falls through to `return []`
- **Fix**: Union type or console.warn for unknown ops

---

## CONSIDER

### 7. Goal memory accumulation
- **File**: `goals.ts:132`
- Completed/failed goals stay in array. 7 NPC × 100 days = ~7000 goals (~3.5MB). OK now.
- 50 NPC × 1000 days = 500,000 goals (~250MB). Phase 4 problem.
- `toJSON()` filters completed/failed. Save/load = GC.
- **Fix**: Periodic pruning (every N days or when length > 100 per NPC)

### 8. drain() callback loss
- **File**: `processing-queue.ts:109-115`
- Double drain() call: second overwrites _onEmpty, first never resolves
- Currently unlikely (single caller pattern). But fragile.
- **Fix**: Accumulate callbacks in array

### 9. Priority starvation at 50+ NPC
- P2 tasks (volition/goals) dominate. P3 (conversations) may never run during active phases.
- 50 NPC × 2s each = 100s P2 queue time. Conversations starved.
- **Fix for Phase 4**: Interleaving (every N P2 tasks, force one P3), or priority aging

---

## Clean Areas (Verified)

| Area | Grade | Notes |
|------|-------|-------|
| CG cascade recursion | A | DAG structure, maxChainDepth per-rule, no infinite loops possible with current rules |
| CG registry delegation | A | getBeliefCreator(), getMemoryTextBuilder(), getStepHandler() — all via registry |
| Step chaining | A | MAX_CHAIN=10, break on transit/LLM/wait. No infinite loop |
| move_to missing location | A | Graceful skip, advance to next step |
| interact chase logic | A | maxChase bounded by priority, no infinite pursuit |
| NPC death mid-goal | A | goal.state='failed', motive cleared |
| NPC arrest mid-goal | A | clearGoals called by handler |
| Target killed mid-step | A | Step skipped gracefully |
| Two NPCs targeting each other | A | Sequential queue processing, no deadlock |
| Goal 0 steps | A | Instant completion, no crash |
| witnessIds dedup | A | Shared context across cascade chain prevents duplicate WITNESS_MEMORY |
| Goal preemption | A | Clean pause/activate in getActiveGoal(), 15 lines, zero bugs |
| ProcessingQueue yield | A | setTimeout(0) macrotask, Master Clock fires between tasks |
| Concurrent cascade safety | A | Queue is sequential, no concurrent state modification |

---

## Edge Cases Tested

| Edge Case | Result | Status |
|-----------|--------|--------|
| NPC dies mid-goal | goal failed, motive cleared | OK |
| NPC arrested mid-goal | clearGoals via handler | OK |
| Target killed during step | step skipped | OK |
| Two NPCs target each other | sequential, no deadlock | OK |
| Goal with 0 steps | instant completion | OK |
| CG cascade kills subject | remaining effects apply to others | OK |
| Module step throws | retry forever (no counter) | **BUG** |
| Absent status without clearGoals | zombie goals | **BUG** |
| Empty CG conditions | rules 9,10,13 never fire | **DEAD CODE** |
| TRIAL_REQUESTED event | never emitted | **DEAD CODE** |

---

## Industry Context

- **Failure Cascades**: RimWorld uses dynamic "expectations" dampening; CLWA uses hard depth limit. Both valid, CLWA's is simpler. Consider dampening factor for Phase 4.
- **ProcessingQueue**: Analogous to OS process scheduler. Classic priority starvation applies at scale. Priority aging is standard solution.
- **setTimeout(0) yield**: Correct choice — avoids microtask starvation (Promise.resolve() would starve macrotasks).
- **Goal preemption**: Clean implementation matching industry standard (GOAP with priority interrupts).

---

## Priority

1. **Now**: `[CRIME` tag generalization + step retry counter (2 medium issues)
2. **M3**: Dead CG rules cleanup, global depth cap, zombie goals, condition op validation
3. **Phase 4**: Goal pruning, queue interleaving, location index for CG conditions
