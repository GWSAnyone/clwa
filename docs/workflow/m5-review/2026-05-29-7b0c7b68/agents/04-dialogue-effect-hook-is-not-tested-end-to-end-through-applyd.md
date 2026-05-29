# Dialogue-effect hook is NOT tested end-to-end through applyDialogueMeaning

- **Dimension**: tests
- **Severity**: major · **Category**: test-gap
- **Location**: `tests/investigation.test.ts:98`
- **Adversarial verdict**: confirmed

## Issue
The A4b hook is the load-bearing extraction point (investigation/accusation moved out of the engine). The only test asserts registerDialogueEffectHandler pushes to the array and getDialogueEffectHandlers returns it -- a trivial registry test. It never proves the engine actually CALLS the handler and merges its return value. applyDialogueMeaning (il.ts:549-551) iterates getDialogueEffectHandlers() and does `sections.push(...handler(meaning, ctx))`; that contract (handler receives the real DialogueMeaning + ILEffectContext, and its returned strings appear in the output) is completely untested. A grep confirms applyDialogueMeaning/extractDialogueMeaning are invoked by ZERO tests in tests/. The behavior-preservation claim for the crime game's evidence-presentation/accusation prose rests on no automated check.

## Suggested fix
Add an end-to-end test: build an ILEffectContext (targetAgent with a player relationship, playerAgent, agents map, effects:[], gameDay), register a probe handler returning ['__SECTION__'] that asserts it received the passed meaning/ctx, call await applyDialogueMeaning(meaning, ctx) and assert the returned string contains '__SECTION__'. Add one test driving the real registerInvestigationModule handler with presentedEvidence/playerJournal in ctx to lock the verbatim evidence-presentation behavior the regression oracle depends on.

## Adversarial verification
Verified against the actual feature/engine-generalization source. The sole A4b test (tests/investigation.test.ts:97-106) is exactly the trivial registry test described: it registers a no-op probe `const probe = () => ['__probe__']`, then asserts only `getDialogueEffectHandlers().length === before+1` and `after.toContain(probe)`. It never invokes the engine, never asserts the handler is called with the real `(meaning, ctx)`, and never asserts the returned strings appear in output.

The load-bearing contract is real and unguarded: il.ts:549-550 runs `for (const handler of getDialogueEffectHandlers()) { sections.push(...handler(meaning, ctx)); }` inside `applyDialogueMeaning` (declared at il.ts:487). (Minor nit: finding cites il.ts:549-551; the loop is 549-551 including the closing brace, so the call is at 549-550 — off by one, substance correct.)

Grep confirms zero end-to-end coverage: searching tests/ for `applyDialogueMeaning|extractDialogueMeaning` → no matches; for `registerInvestigationModule|ILEffectContext|DialogueMeaning|presentedEvidence` → no matches; for `processEvidencePresentation|processAccusation|speechAct|dialogueMeaning` → no matches (only the registry import/test lines at investigation.test.ts:9,98-102). 

The extracted crime prose this should protect lives entirely in the module: crime-justice/investigation.ts:411-419 `registerInvestigationModule()` registers the only real handler, which calls `processEvidencePresentation(ctx)` and `processAccusation(meaning, ctx)` — neither of which is exercised by any test. Since Phase A moved the PlayerJournal + evidence-presentation/accusation logic OUT of the engine and reconnects it solely through this hook, the regression-oracle behavior-preservation claim for that prose genuinely rests on no automated check. This is a real test gap, not the accepted/known residual (the documented residuals are the untyped event.payload keys and the WS crime:scene contract, neither of which is this). The suggested fix (a probe-handler round-trip test through applyDialogueMeaning plus one test driving the real registerInvestigationModule handler with presentedEvidence/playerJournal in ctx) is the correct lock. Severity major is fair given it is the extraction's load-bearing seam.
