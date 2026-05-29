# Genre-neutrality static guard can false-pass: prose regex only scans string literals, symbol blocklist is enumerated, no concept-level assertion

- **Dimension**: tests
- **Severity**: major · **Category**: test-gap
- **Location**: `tests/architecture.test.ts:121`
- **Adversarial verdict**: confirmed

## Issue
The INV-14 prose guard (CRIME_PROSE at line 121) is applied ONLY to the inner content of quoted string literals (stringLiterals() at 124-130). A reintroduced crime concept as an IDENTIFIER or type -- e.g. `function detectMurder()`, `interface ArrestWarrant`, a `crimeHeat` field -- is NOT flagged because it's not inside quotes. The FORBIDDEN-symbol list (148-161) only catches the SPECIFIC renamed symbols from A1/A6/A8/A9 (CrimeScene, processKill, etc.); it is an enumerated blocklist, not a general rule, so any NEW crime-named symbol slips through. The suite header (113-117) claims A10+A4b moved the entire investigation/journal subsystem out so 'NOTHING is excluded', but no test asserts the engine is free of PlayerJournal/accusation/evidence-scoring identifiers. The guard is weaker than its docstring implies and could green-light a partial crime re-import.

## Suggested fix
Extend CRIME_PROSE scanning to also run against code identifiers (tighter word set), OR add a test that engine source contains no PlayerJournal/getCaseSummary/buildAccusationContext/processEvidencePresentation identifiers (these now live only in modules/). Add a self-test asserting the crime-prose regex fires on a known-bad fixture so a broken regex can't silently pass everything.

## Adversarial verification
Every factual claim in the finding holds against the actual current source.

1. Prose regex scans ONLY string-literal content. tests/architecture.test.ts:132-143 — the loop does `for (const lit of stringLiterals(code)) { if (CRIME_PROSE.test(lit)) ... }`. `stringLiterals()` (124-130) extracts only the inner content of `'...'`/`"..."`/`` `...` `` matches. `CRIME_PROSE` (line 121: `/\b(murder|crime|criminal|arrest|theft|robbery|suspect|perpetrator)\b/i`) is therefore never run against code identifiers/types. A reintroduced `function detectMurder()`, `interface ArrestWarrant`, or `crimeHeat` field is unquoted and slips through. Confirmed there are no other references to CRIME_PROSE in the file (only line 137).

2. The FORBIDDEN list (148-161) is an enumerated blocklist of the 12 SPECIFIC A1/A6/A8/A9 renamed symbols (CrimeScene, processKill, markCrimeScene, createCrimeScene, crimeScenes, bodyDiscoveries, onMurder, onCrimeScene, onCrimeEvent, CRIME_SCENE_TEMPLATES, source:'rumor', typed crime capability flag). It is not a general rule — a NEW crime-named symbol matches none of these regexes. Confirmed.

3. The suite header (112-114) claims A10+A4b moved the investigation/journal subsystem out entirely ("NOTHING is excluded"), yet no test asserts the engine is free of PlayerJournal/getCaseSummary/buildAccusationContext/processEvidencePresentation. Verified these four identifiers live exclusively in packages/modules/src/crime-justice/investigation.ts (class PlayerJournal at :50, getCaseSummary at :112, buildAccusationContext at :205, processEvidencePresentation at :281; re-exported via modules/src/index.ts:4) and are ABSENT as live engine code — engine occurrences are only relocation comments (il.ts:443/473-474, index.ts:217, world.ts:73/147) plus the generic opaque `playerJournal?: unknown` field (il.ts:465). Nothing guards their re-import.

The gap is NOT closed by the companion suite. tests/genre-neutrality.test.ts is a positive/behavioral extensibility proof (the "Economy Module Test", lines 109-153) plus a few narrow allowlist checks (BELIEF_SOURCE keys exclude BODY_DISCOVERY/DEDUCTION at :57-58; hasCapability(...,'investigator')===false at :65). None is a source-level guard against reintroducing a crime identifier or type into the engine.

No regex self-test exists: CRIME_PROSE never appears in a positive `.test(...)===true` assertion against a known-bad fixture, so a broken/mistyped regex would silently pass everything — exactly the false-pass failure mode the finding describes.

Note on scope (not a refutation): the engine deliberately retains GENERIC primitives named Evidence/EvidenceLayer and an `accusation?` speech-act flag (evidence.ts; event-registry.ts:856-869) whose docstrings explicitly cover non-crime genres (e.g. economy 'transaction'). These are intentional and outside the CRIME_PROSE word set, so they are not the leak — the finding's chosen examples (detectMurder/ArrestWarrant/crimeHeat/PlayerJournal-scoring) are the correct, genuinely-unguarded class. Severity 'major' is fair: a partial crime re-import expressed as identifiers/types would currently green-light against INV-14's stated "zero crime vocabulary" bar.
