# Agent 04 — audit: verdict & reflection

**Site**: VERDICT — `crime-justice/step-handlers.ts:378` (sentence_npc), system/user :444-461, schema :463-487,
helpers :51-156 (gatherEvidenceGrouped/buildSuspectDefense/buildJudgeContext/buildCommunityPressure). REFLECTION —
`reflection.ts:54-79` (threshold) + `server/index.ts:51-77` & `npc-memory-manager.ts:136-171` (consolidation).
Both routed to claude-code/sonnet (`llm-defaults.ts`). Verbatim prompts in `raw.json`.

## Structure
VERDICT: `classify('verdict', {system,user,schema, maxTokensOverride:300, temp 0.4})`. User = accusation line +
`Crime severity: n/10` + tiered evidence (STRONG/MODERATE/WEAK) + SUSPECT'S DEFENSE + COMMUNITY + AVAILABLE VERDICTS +
one "Consider:" rubric line. Schema {verdict enum, reasoning}. On claude-code the magistrate's `CLAUDE.md` persona +
6 `@memory/*.md` files auto-load as invisible ambient context. REFLECTION: `generate('reflection')` plain text, no schema.

## Top quality risks
- **Verdict leaks guilt**: buildSuspectDefense tone (remorseful/evasive vs steady) is derived from whether the suspect
  holds a perpetrator-belief → model can pattern-match the wording instead of weighing evidence.
- Evidence lines **uncapped & unordered** beyond 3 buckets; many weak witnesses bury the strong clue + inflate tokens.
- Only rubric is one "Consider:" line; **no calibration examples**, and the severity ranges that gate AVAILABLE
  VERDICTS aren't shown to the model → loose, inconsistent selection.
- `reasoning` generated **alongside** the verdict → post-hoc rationalization (not reason-before-decision).
- crimeSeverity silently falls back to magic 3; buildJudgeContext returns '' if bigFive missing (judge personality vanishes).
- REFLECTION has **no schema/validation** (canned fallback); two overlapping reflection mechanisms append to
  reflections.md (drift/dupe); reflection memories get importance 9 (sticky, crowd out fresh). Doc says Qwen, code = sonnet.
- Ambient CLAUDE.md + 6 @memory files are invisible at the call site and can grow unbounded → unpredictable cost.

## Top improvements
Stop leaking guilt via defense tone (neutral demeanor facts); show severity range per verdict option; 2–3 worked
calibration examples; cap+rank evidence; reason-before-verdict field order; make degraded-severity explicit; give
reflection a tiny schema / prefix-strip + non-empty validation; unify the two reflection paths + dedup; reconcile
the reflection route vs `clwa/overview`; budget/consolidate ambient context before high-value verdict calls.
