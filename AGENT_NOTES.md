# CLWA Autonomous Agent Notes

## Session: 2026-04-11 23:45 → 2026-04-12 ~01:50

### Summary
41 commits on `night/autonomous-20260411`, all pushed. 82 tests, 0 TS errors.
M3 Living Opposition feature-complete. Extensive bonus features for detective gameplay.

### Session Stats
| Metric | Before | After |
|--------|--------|-------|
| Tests | 61 | 82 (+21) |
| Affordances | 20 | 22 (+argue, threaten) |
| CG rules | 11 | 21 (+10: witness reactions, escalation, emergent, corruption) |
| Topic sources | 13 | 16 (+secretLeakage, sighting, suspicion) |
| Event types | ~15 | 23+ (+COVER_UP, REPORT_IMPULSE, ARGUMENT_WITNESSED, THREAT_WITNESSED, REVENGE_IMPULSE, GUARD_WARNING, ARREST_RESENTMENT, CORRUPTION_COVER, MINOR_INCIDENT_MEMORY) |
| Polishing | 86/109 | 101/109 |

### M3 Living Opposition — Feature Complete
| Feature | Status | Key Files |
|---------|--------|-----------|
| CG v2 engine | Done | cg-engine.ts, cg-types.ts |
| Criminal escalation | Done | affordances.ts, step-handlers.ts, target-finders.ts |
| Heat system | Done (phases 1+2) | heat.ts, index.ts |
| Witness reactions | Done | cg-rules.ts, index.ts |
| Cover-up suppression | Done | world.ts |
| Garrett variability | Done | cg-rules.ts, index.ts |
| NPC resistance | Done | server.ts |
| Emergent cascades | Done | cg-rules.ts, index.ts |

### Bugs Found & Fixed
1. **Argument cascade bug** (commit 41): ARGUMENT_WITNESSED → WITNESS_MEMORY → WANTED_STATUS. Arguments created wanted status like murders. Fixed: MINOR_INCIDENT_MEMORY type.
2. **Motive confidence too high** (commit 13): Starting conf 0.5-0.9 bypassed escalation staircase. Fixed: 0.25-0.50.
3. **Growth rate too slow** (commit 34): 0.03/h = kill in ~4h real time. Fixed: 0.06/h = kill in ~2h.

### Open Questions
1. **Kill threshold pacing**: 0.70 conf, growth 0.06/h. At 3x speed from conf 0.35: ~117 min to kill. May need gameplay testing to verify feel.
2. **GUARD_WARNING handler**: Registered event type but no behavioral effect. Guard should patrol/warn.
3. **Blackmail repetition**: No frustration mechanism. Known pre-existing gap.
4. **Argue as onCrimeEvent**: Arguments dispatch through onCrimeEvent pipeline but aren't crimes. Works mechanically but semantically imprecise. Low priority.
5. **M4 readiness**: Arrival event, win/lose detection, end-of-run summary still needed.

### What Works End-to-End
Traced full scenario: Mark (H=0.2, grudge 0.35) → argue with Bess → witnesses get MINOR_INCIDENT_MEMORY (no guard cascade) → grudge grows to 0.50 → threaten Bess → THREAT_WITNESSED → WITNESS_MEMORY → guard cascade → if honest guard: WANTED_STATUS + investigation. If corrupt guard (H<0.4): CORRUPTION_COVER.

### CG Trigger Index Performance
20 rules distributed across 12 trigger types. Max 5 rules per trigger (WITNESS_MEMORY — the most cascaded type). O(1) lookup. No performance concerns at current scale.

### Victory/Conviction Feedback
- Correct conviction (suspect in journal + exile/imprisonment): "Case solved!"
- Unknown conviction (not in journal suspects): "Was it the right person?"
- Creates emotional closure and seeds replay motivation.
