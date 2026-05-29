# M5 Review — Run Metadata

- **Workflow**: m5-review (adversarial multi-dimension review of M5 = engine neutralization + generalization)
- **Run ID**: wf_7b0c7b68-358
- **Date**: 2026-05-29
- **Branch reviewed**: feature/engine-generalization
- **Agents**: 27 (5 dimensions × find → adversarial verify + synthesis)
- **Question**: Adversarial multi-dimension review of the M5 engine work (neutralization + generalization), then rank confirmed findings

## Headline
- **Overall verdict**: SHIP WITH FIXES.
- **Confirmed findings**: 14 · **Critical**: 0
- **By severity (ranked)**: major 6 · minor 7

## Most important fix
Move the attribute-decay step out of the shared _computeMoodTick into the real-tick path _tickMoodSystem only (world.ts:556-559). Today decayAttribute() runs inside _computeMoodTick, which is also called in a ticks-long loop by advanceMoodMath (world.ts:803) — the debug calibration what-if exposed at routes.ts:1000 and explicitly documented 'Mood math only... not behavior testing.' Hitting that endpoint now silently ages and expires every agent's attribute modifiers on the LIVE agent objects (no clone), permanently consuming non-self-correcting conserved state (HP regen, wound debuffs, buffs, needs) for any attribute-using module. It is latent for the crime game (no attributes) but is silent conserved-state corruption via a route advertised as side-effect-free. The loneliness step already lives in _tickMoodSystem, so the precedent and the fix are both one-line moves: lift the `if (agent.state.attributes) for (...) decayAttribute(...)` block up to the real-tick caller.

## Workflow logs (agent failures during run)
- parallel[0] failed: agent({schema}): subagent completed without calling StructuredOutput (after 2 in-conversation nudges)
- parallel[1] failed: agent({schema}): subagent completed without calling StructuredOutput (after 2 in-conversation nudges)
- parallel[0] failed: agent({schema}): subagent completed without calling StructuredOutput (after 2 in-conversation nudges)
- parallel[1] failed: agent({schema}): subagent completed without calling StructuredOutput (after 2 in-conversation nudges)
- parallel[4] failed: agent({schema}): subagent completed without calling StructuredOutput (after 2 in-conversation nudges)
- pipeline[1] failed: agent({schema}): subagent completed without calling StructuredOutput (after 2 in-conversation nudges)

> 6 finder agents failed to call StructuredOutput; synthesis was produced from the successful agents +
> adversarial verifiers. All 13 ranked findings are source-verified (see agents/).

## Disposition (post-review, on feature/engine-generalization)
All 13 ranked findings were addressed to diamond level:
- #1 decay hoisted to _tickMoodSystem · #2 SL-07 load validation + addAttributeModifier finite guard ·
  #5 genre-neutrality guard hardened (identifier scan + regex self-test; also fixed a latent CRLF bug in
  codeLines) · #6 dead world.playerState deleted · #7 residual crime nouns renamed (DiscoveryContext.affectedId,
  onAgentDeath actorId/affectedId) · #9 for...in → Object.values · #12 '==' comparator added · #13 redundant cast dropped.
- Test gaps closed: #3 save/load round-trip · #4 applyDialogueMeaning e2e · #8 registry teardown ·
  #10 transfer edge-cases · #11 CG attr/faction op branches.
