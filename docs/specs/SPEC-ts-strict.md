# SPEC: TypeScript Strict Mode Cleanup

> **Milestone**: Infrastructure
> **Status**: DONE (v0.12.1, 2026-04-10) — 156 errors → 0, 4 runtime bugs found and fixed
> **Priority**: Low (Bun runtime doesn't enforce, but IDE and CI benefit)

## Problem

`bun x tsc --noEmit` reports 156 errors across 18 files. Code works at runtime (Bun transpiles without type checking), but strict TS would catch real bugs earlier.

## How to reproduce

```bash
cd CLWA && bun x tsc --noEmit 2>&1 | grep "error TS" | wc -l
```

## Root causes (by error count)

1. **GoalStep loose typing (75 errors)** — `step-handlers.ts` (54) + `goals.ts` (21). Step fields (`target`, `reason`, `importance`, `ticks`) typed as `unknown`. Need discriminated union or proper step interfaces.
2. **Null safety (44 errors)** — `string | null` assigned to `string` across IL, event handlers, server. Need `?? ''` or proper nullable types.
3. **Broadcast type (20 errors)** — `server/index.ts` + `routes.ts`. WS message `data` field too narrow for all event shapes.
4. **Misc (17 errors)** — duplicate identifiers, missing exports, extra object literal fields.

## Approach

1. Fix GoalStep — proper discriminated union with typed step variants
2. Fix null safety — nullable fields where null is valid, guards where it isn't
3. Widen broadcast data type or use discriminated union for WS messages
4. Clean up remaining: duplicate Agent import, missing EnneagramProfile export, etc.

## Verification

```bash
bun x tsc --noEmit 2>&1 | grep "error TS" | wc -l
# Target: 0
bun run test
# Target: all pass
```
