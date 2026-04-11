# CLWA Autonomous Agent Notes

## Session: 2026-04-11 23:45 → 2026-04-12 00:20

### State assessment (start)
- **Version**: v0.12.10 (branch `night/autonomous-20260411`)
- **M1**: Done | **M2**: Done | **M2.5**: Done
- **TypeScript errors**: 0 | **Tests**: 61 pass
- **Polishing spec**: 86/109 done, 15 deferred

### Completed this session

| # | Commit | What |
|---|--------|------|
| 1 | `222e7cf` | **CG v2**: target selection pipeline, NPC-state conditions (trait/relationship/belief), exclusive groups, trigger index. Migrated all 11 rules. |
| 2 | `3f42864` | **M3 witness reaction rules**: first exclusive group `witness_reaction`. COVER_UP (friend covers) + REPORT_IMPULSE (honest witness). Full event type registration. |
| 3 | `31695c8` | **SPEC-heat-system.md**: belief-derived criminal danger awareness. **SPEC-criminal-escalation.md**: motive confidence tiers (argue→steal→threaten→kill). |
| 4 | `97a078f` | **Heat system phase 1**: `computeHeat()`, 5 heat levels, secret directive builder. Zero engine changes. |
| 5 | `8d9d595` | **CG v2 test suite**: 13 tests covering pipeline, conditions, exclusive groups, trigger index. Total: 74 tests. |
| 6 | `991ae44` | **NNA polishing**: 15+ unsafe `!` assertions → safe alternatives across 9 files. |
| 7 | (this) | **Docs update**: ROADMAP (CG v2 done, new specs), SPEC-cg-v2 status → implemented. |

### Key architectural decisions

1. **CG v2 evaluateConditions rewrite**: Separated target selection (resolveTargets) from condition evaluation (gate/filter pipeline). This fixes the v1 early-return bug where the first target-selecting condition short-circuited all subsequent ones. The new pipeline allows combining `targetMode: 'witnesses'` with any number of filter conditions.

2. **Exclusive groups**: Designed so friendship overrides honesty (COVER_UP priority 2 > REPORT_IMPULSE priority 1). This is a deliberate design choice — in CLWA's universe, personal loyalty is a stronger force than abstract morality. Can be easily reversed by changing priority numbers.

3. **Heat system as secret directive**: Rather than adding a new engine subsystem, heat is computed from existing beliefs and injected as prose into the LLM prompt. This follows PM=instinct design — vivid text creates behavioral pressure, LLM decides freely. Zero engine changes.

4. **Criminal escalation as motive confidence tiers**: Rather than adding an explicit "escalation state machine", crime severity naturally follows from motive belief confidence growth over time. This reuses existing motive mechanics — zero new state types.

### Open questions for review

1. **Corruption cover rule**: Deferred — CORRUPTION_COVER needs to intercept the investigate affordance chain, not just produce an event. Needs more design work.

2. **Heat Phase 2 (mood modifier)**: The spec describes adding a mood modifier proportional to heat. This would make criminal behavior organically shift via moodCurve without explicit LLM pressure. Worth implementing?

3. **Criminal escalation implementation**: SPEC ready, needs `argue` + `threaten` affordances + motive growth tick handler. Moderate effort, high gameplay impact.

4. **Witness COVER_UP behavioral effect**: Currently COVER_UP creates a concealment belief, but doesn't actively prevent the NPC from spreading rumors. The witness still gets WITNESS_MEMORY from the parent rule. May need a mechanism where COVER_UP suppresses RUMOR_SPREAD for that NPC.

### Invariant violations found (none introduced, pre-existing)

None found during this session. Engine/module boundary is clean.

### Final state
- **Branch**: `night/autonomous-20260411` (7 commits ahead of master)
- **TypeScript errors**: 0
- **Tests**: 74 pass, 0 fail
- **CG v2**: Implemented + tested
- **Heat system**: Phase 1 implemented
- **New specs**: heat-system, criminal-escalation
- **Polishing**: ~15 NNA items fixed
