# CLWA Autonomous Agent Notes

## Session: 2026-04-11 23:45 → 2026-04-12 01:15+

### Summary

28 commits on `night/autonomous-20260411`, all pushed to remote. 77 tests, 0 TS errors. Major M3 progress: CG v2 engine, criminal escalation system, heat system, witness reactions, conversation improvements, detective toolkit (alibi system), and numerous creative gameplay features.

### Commits

| # | What | Category |
|---|------|----------|
| 1 | Art pipeline files committed | housekeeping |
| 2 | **CG v2**: target selection pipeline, NPC-state conditions, exclusive groups, trigger index | engine |
| 3 | M3 witness reaction rules (cover-up / eager-report exclusive group) | module |
| 4 | SPEC-heat-system + SPEC-criminal-escalation | specs |
| 5 | Heat system Phase 1: computeHeat(), secret directive builder | module |
| 6 | CG v2 test suite (13 tests) | tests |
| 7 | NNA polishing (15+ unsafe `!` assertions fixed) | quality |
| 8 | ROADMAP + SPEC-cg-v2 status updated | docs |
| 9 | **Criminal escalation**: argue/threaten affordances, motive growth tick, kill 0.3→0.7 | module |
| 10 | Heat Phase 2: anxiety mood modifier | module |
| 11 | Conversation quality: trust-aware notes, richer follow-ups, secretLeakageTopics | engine+module |
| 12 | Emergent CG rules: grief-revenge, guard-warning, victim approach trigger | module |
| 13 | Motive rebalance: confidences lowered for escalation staircase | world data |
| 14 | Magistrate relationships expanded | world data |
| 15 | Intimidated witness directive | module |
| 16 | Combined condition CG v2 tests (+3 tests, 77 total) | tests |
| 17 | CLAUDE.md sync (77 tests, 22 affordances, M3 progress) | docs |
| 18 | ARCHITECTURE.md updated (CG v2, counts) + final session notes | docs |
| 19 | Suspicion topics: NPCs speculate about crimes | module |
| 20 | UI: emotional state indicators on NPC sprites | frontend |
| 21 | UI: approach toast shows descriptive text | frontend |
| 22 | Context-specific witness memories | module |
| 23 | Polishing spec updated (101/109 done) | docs |
| 24 | **Location history + alibi API** | server |
| 25 | **Arrest backlash** CG rule: friends resent investigation | module |
| 26 | **NPC schedule knowledge**: friends know routines | server |
| 27 | **Cover-up suppression**: concealment blocks belief transfer | engine |
| 28 | Sighting topics: NPCs mention co-located NPCs | module |

### New Systems

| System | Files | Engine? |
|--------|-------|---------|
| CG v2 (target pipeline, conditions, exclusive groups) | cg-engine.ts, cg-types.ts | Yes |
| Criminal escalation (argue→steal→threaten→kill) | affordances.ts, step-handlers.ts, target-finders.ts | No |
| Heat system (danger awareness + mood modifier) | heat.ts, index.ts | No |
| Witness reactions (cover-up / eager-report) | cg-rules.ts, index.ts | No |
| Cover-up suppression (blocks belief transfer) | world.ts | Yes |
| Location history + alibi API | game-context.ts, index.ts, routes.ts | No |
| Secret leakage topics | social/topic-sources.ts | No |
| Sighting topics | social/topic-sources.ts | No |
| Suspicion topics | crime/topic-sources.ts | No |
| Intimidated witness directive | index.ts | No |
| Schedule knowledge | index.ts | No |
| Emotional state UI indicators | game.js | No |

### Stats

- **Affordances**: 20 → 22 (added argue, threaten)
- **CG rules**: 11 → 17 (added 6: cover-up, eager-report, witness-argument, witness-threat, grief-revenge, guard-warning, arrest-backlash)
- **Topic sources**: 13 → 16 (added secretLeakage, sighting, suspicion)
- **Event types**: +8 (COVER_UP, REPORT_IMPULSE, ARGUMENT_WITNESSED, THREAT_WITNESSED, REVENGE_IMPULSE, GUARD_WARNING, ARREST_RESENTMENT)
- **Tests**: 61 → 77
- **Polishing**: 86/109 → 101/109

### Open Questions

1. **Motive growth vs decay**: Growth (0.03/hour) >> decay (0.001-0.004/day). Motives always escalate. Intentional — but may need gameplay tuning.
2. **Argue step handler**: Uses onCrimeEvent for ARGUMENT_WITNESSED, but arguments aren't crimes. May need separate dispatch.
3. **GUARD_WARNING**: Registered but no behavioral handler — guard should patrol or warn. Deferred.
4. **Kill threshold at 0.7**: With growth, kill accessible ~5-8 hours. GDD target is 1.5-2 hour sessions — may need faster growth or lower threshold.
5. **Remaining M3**: Garrett variability (corruption behavior) and NPC resistance (refusal to cooperate).
