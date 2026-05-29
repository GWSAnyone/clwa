# Redundant cast left over from the EmotionalPressure union->string change

- **Dimension**: consistency-perf
- **Severity**: minor · **Category**: abstraction
- **Location**: `packages/engine/src/il.ts:348`
- **Adversarial verdict**: confirmed

## Issue
`type: String(ep.type) as EmotionalPressure['type']` — after A7, EmotionalPressure.type is `string`, so the cast is a no-op leftover from when type was a closed union.

## Suggested fix
Drop the `as EmotionalPressure['type']` cast; `String(ep.type)` already yields string.

## Adversarial verification
Verified against actual current source on feature/engine-generalization.

1) The cast exists exactly where claimed: `packages/engine/src/il.ts:348` reads `type: String(ep.type) as EmotionalPressure['type'],` (confirmed via grep, exact line 348).

2) The premise is correct. On the feature branch, the interface at packages/engine/src/il.ts:132-137 declares `type: string` (with a doc comment "Engine does not pin a closed set (INV-14)"). So `EmotionalPressure['type']` resolves to `string`, and `String(ep.type)` already returns `string` — the `as EmotionalPressure['type']` is a pure no-op.

3) The "leftover" history checks out. On master, packages/engine/src/il.ts the same interface declared `type: 'threat' | 'bribe' | 'flattery' | 'guilt' | 'intimidation'` (a closed union), where the cast genuinely narrowed `string` -> union. Phase A's neutralization (INV-14) widened it to `string` but left the now-dead cast in place.

This is a real, if minor, consistency/cleanliness wart — not a bug, not a behavior change (cast is erased at compile time; runtime behavior identical), not an accepted/known residual from the briefing. The suggested fix (drop the cast, keep `String(ep.type)`) is correct and safe. Severity minor / category abstraction-cleanliness is accurate.
