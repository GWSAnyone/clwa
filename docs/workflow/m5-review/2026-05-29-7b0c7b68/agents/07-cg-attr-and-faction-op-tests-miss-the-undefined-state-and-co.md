# CG 'attr' and 'faction' op tests miss the undefined-state and comparator branches

- **Dimension**: tests
- **Severity**: minor · **Category**: test-gap
- **Location**: `tests/attributes.test.ts:108`
- **Adversarial verdict**: confirmed

## Issue
The 'attr' op test (attributes.test.ts:108) only covers comparator '<' on a present attribute. The implementation (cg-engine.ts:292-303) has an important `if (v === undefined) return false` guard (target never declared the attribute) and four other comparators ('>','>=','<=', default '=='); none are tested. The 'faction' op test (relationships-factions.test.ts:85) only passes cond.value and only the membership true/false split; the `cond.value ?? cond.field` fallback (cg-engine.ts:290) and the factions-undefined -> false path are untested. These are exactly the edges a future refactor could break (e.g. returning true on undefined attr would wrongly flag every agent lacking the attribute).

## Suggested fix
Add cases: an agent with NO attributes declared is filtered OUT by an 'attr' rule (verifies undefined->false); cover '>=' and '==' comparators; for 'faction', add an agent with state.factions undefined asserted excluded, and one rule using cond.field instead of cond.value.

## Adversarial verification
Read the actual current source on feature/engine-generalization. Implementation: cg-engine.ts evaluateFilter has a 5-way comparator switch for 'attr' (>, >=, <, <=, default ==) at lines 297-303, an explicit `if (v === undefined) return false` guard at line 295, the `cond.value ?? cond.field` fallback for 'faction' at line 290, and a `?? false` for factions-undefined also at line 290. getAttributeValue (attributes.ts:67-70) returns undefined for undeclared keys.

attr-op gap (attributes.test.ts:107-127): the SOLE 'attr' rule (line 111) uses `comparator: '<'` only. Both test agents declare gold (poor=5 at line 115, rich=50 at line 116), so v is never undefined — the line-295 guard branch is never executed, and comparators >, >=, <=, == (lines 298,299,301,302) are never exercised. The undefined-return is unit-tested for the helper at attributes.test.ts:63-67, but NOT at the filter level: a refactor of evaluateFilter could drop the line-295 guard (causing undefined→true→every agent lacking the attribute wrongly matches) while getAttributeValue's own test stays green. So the finding's risk scenario is genuinely uncaught.

faction-op gap (relationships-factions.test.ts:84-103): the SOLE 'faction' rule (line 88) passes `value: 'house_valois'`, never `field`. Both agents define a non-empty state.factions array (member line 92, outsider line 93), so the `?? false` path for undefined factions (cg-engine.ts:290) is never hit, and the `cond.value ?? cond.field` fallback is never tested via field-only. Grep across the whole tests/ tree confirms exactly one occurrence of each op (op:'attr' only at attributes.test.ts:111, op:'faction' only at relationships-factions.test.ts:88). The sibling `cond.value ?? cond.field` pattern in has_capability is likewise only ever tested with value (cg-v2.test.ts:325,603), so the field-only fallback is untested anywhere.

Severity is correctly minor/test-gap: 'attr'/'faction' are NEW Phase B ops unused by the crime game, so there is no regression-oracle exposure — only forward-risk for future modules, exactly as the finding frames it ("edges a future refactor could break"). Line references and suggested fixes (add undefined-attr-excluded case, cover >= and ==, add factions-undefined-excluded case and a cond.field rule) are accurate and would close real gaps.
