# CLWA Autonomous Agent Notes

## Session: 2026-04-11 23:45 → 2026-04-12 00:45

### Commits (15)

| # | Hash | What |
|---|------|------|
| 1 | `3e8c716` | v0.12.10: art pipeline files committed |
| 2 | `222e7cf` | **CG v2**: target selection pipeline, NPC-state conditions, exclusive groups, trigger index |
| 3 | `3f42864` | **M3 witness reactions**: COVER_UP (friend) + REPORT_IMPULSE (honest) in exclusive group |
| 4 | `31695c8` | **Specs**: SPEC-heat-system + SPEC-criminal-escalation |
| 5 | `97a078f` | **Heat Phase 1**: computeHeat(), 5 heat levels, secret directive builder |
| 6 | `8d9d595` | **CG v2 tests**: 13 new tests (74 total) |
| 7 | `991ae44` | **NNA polishing**: 15+ unsafe `!` → safe alternatives across 9 files |
| 8 | `3c21e88` | **Docs**: ROADMAP + SPEC-cg-v2 status updated |
| 9 | `4b3766e` | **Criminal escalation**: argue/threaten affordances, motive growth tick handler, kill threshold 0.3→0.7 |
| 10 | `8db8480` | **Heat Phase 2**: anxiety mood modifier proportional to heat score |
| 11 | `b795961` | **Conversation quality**: trust-aware notes, richer follow-ups, secretLeakageTopics |
| 12 | `9bf5fbb` | **Emergent CG rules**: grief-revenge-impulse, guard-heard-argument, victim approach trigger |
| 13 | `1bdfcf5` | **Motive rebalance**: initial confidences lowered for escalation staircase |
| 14 | `3b2d36a` | **World data**: magistrate relationships expanded |
| 15 | `7a6a6b2` | **Intimidated witness directive**: fear suppresses testimony |
| 16 | (this) | **Docs**: ARCHITECTURE.md updated, final AGENT_NOTES |

### Key Architectural Decisions

1. **CG v2 pipeline**: Separated target selection from condition evaluation. Fixes v1 early-return bug. Enables combining targetMode with any number of NPC-state conditions.

2. **Exclusive groups**: Friendship > honesty (COVER_UP priority 2 > REPORT_IMPULSE priority 1). Personal loyalty as stronger force than abstract morality.

3. **Heat as directive prose**: No new engine subsystem. Computed from existing beliefs, output through secret directive builder + mood modifier. Follows PM=instinct design.

4. **Escalation as motive confidence tiers**: argue (0.15) → steal (0.30) → threaten (0.50) → kill (0.70). Growth ~0.03/hour modulated by personality. Zero new state types.

5. **Motive rebalance**: Initial confidences lowered from 0.5-0.9 to 0.25-0.50 so escalation staircase actually plays out over 5-8 game hours.

### New Systems Summary

| System | What it does | Engine changes |
|--------|-------------|---------------|
| CG v2 | Target pipeline, NPC-state conditions, exclusive groups, trigger index | Yes (cg-engine.ts, cg-types.ts rewrite) |
| Witness reactions | Cover-up vs eager-report exclusive group | Module only |
| Heat system | Belief-derived danger → directive prose + mood modifier | Module only |
| Criminal escalation | argue/threaten affordances + motive growth tick | Module only |
| Secret leakage topics | Stressed NPCs leak secret hints in conversation | Module only |
| Intimidated witness directive | Fear suppresses testimony from intimidated witnesses | Module only |
| Grief revenge cascade | Friend of victim + low A → revenge motive | Module only |
| Victim approach | Threatened NPCs seek player for help | Module only |
| Conversation improvements | Trust-aware notes, richer follow-ups | Engine (prompts) |

### Open Questions for Review

1. **COVER_UP suppression**: Currently COVER_UP creates a concealment belief but doesn't prevent the NPC from spreading rumors through normal WITNESS_MEMORY cascade. May need mechanism to mark NPC as "won't gossip".

2. **Motive growth vs decay**: Motive growth (+0.03/hour) competes with belief decay. If decay is faster, motives never escalate. Need gameplay testing.

3. **Argue step handler**: Currently uses `onCrimeEvent` to fire ARGUMENT_WITNESSED. But arguments aren't crimes. May need separate event dispatch path.

4. **Kill threshold at 0.7**: Combined with motive growth, kill becomes accessible after ~5-8 hours. Is this the right pacing for a 1.5-2 hour session?

5. **Guard warning**: GUARD_WARNING event registered but no handler creates behavioral effect. Guard should patrol or warn the arguing NPCs.

### Invariant Compliance

All changes pass the A1-A9 checklist:
- Zero module strings added to engine
- All new state is typed
- All new behavior via registries
- Bilateral design maintained
- No reflex bypass (LLM always decides)
- Economy module test: all new mechanisms work with any event types

### Final State
- **Branch**: `night/autonomous-20260411` (15+ commits ahead of master)
- **TypeScript errors**: 0
- **Tests**: 74 pass, 0 fail
- **New affordances**: 2 (argue, threaten) — 22 total
- **New CG rules**: 5 (witness-cover-up, witness-eager-report, witness-argument, witness-threat, grief-revenge-impulse, guard-heard-argument)
- **New topic sources**: 1 (secretLeakageTopics) — 12 social + 2 crime = 14 total
- **New event types**: 6 (COVER_UP, REPORT_IMPULSE, ARGUMENT_WITNESSED, THREAT_WITNESSED, REVENGE_IMPULSE, GUARD_WARNING)
