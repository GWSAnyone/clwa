# attr CG op equality not expressible via the typed comparator

- **Dimension**: consistency-perf
- **Severity**: minor · **Category**: consistency
- **Location**: `packages/engine/src/cg-engine.ts (attr op); packages/engine/src/cg-types.ts:53`
- **Adversarial verdict**: confirmed

## Issue
The attr op switch uses `default: v === target` for equality, but RuleCondition.comparator is typed `'>' | '<' | '>=' | '<='` with no '=' member. Equality only fires when comparator is undefined, while the op comment implies a comparator-driven equality. Mildly misleading typing/comment; float === equality is also fragile (mirrors trait/relationship ops).

## Suggested fix
Either add an explicit '==' to the comparator union and case, or update the comment to state equality is the implicit default when comparator is omitted.

## Adversarial verification
Verified on branch feature/engine-generalization by reading the actual source. cg-types.ts:53 declares `comparator?: '>' | '<' | '>=' | '<=';` with no '=' / '==' member. cg-engine.ts:297-303 (attr op) switches on cond.comparator with cases '>','>=','<','<=' and `default: return v === target;` (line 302) — so float === equality is only reachable when comparator is undefined, never selectable through the typed union. The "mirrors trait/relationship ops" claim also holds: checkTrait (cg-engine.ts:346) and checkRelationship (cg-engine.ts:354) both delegate to compare() (cg-engine.ts:368-376), whose `default: return a === b;` (line 374) is the same unreachable-via-union float-equality fallback, since both pass `cond.comparator ?? '>'`. This is a genuine consistency/typing wart, not part of the accepted residual list (untyped payload keys, WS crime:scene contract, shop->inventory migration). One mild overstatement in the finding: the comment at cg-engine.ts:293 ("compare a scalar attribute's effective value to cond.value") is generic and does not literally "imply a comparator-driven equality" — but that nuance does not change the verdict. No behavior change vs the crime game: the equality default is still reachable when comparator is omitted and CG rules in practice use the four ordered comparators, so the crime regression oracle is unaffected. Severity 'minor' is correctly assigned; the suggested fix (add explicit '==' to the union+case, or document equality as the implicit comparator-omitted default) is sound. Verdict: confirmed.
