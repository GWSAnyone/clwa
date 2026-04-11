# CLWA Autonomous Agent Notes

## Session: 2026-04-11 ~23:45

### State assessment
- **Version**: v0.12.10 (branch `night/autonomous-20260411`)
- **M1**: Done (Replayable Crime)
- **M2**: Done (Detective Toolkit — backend + Web UI)
- **M2.5**: Done (persistent memory, TS strict, contract validation, world editor)
- **TypeScript errors**: 0
- **Tests**: 61 pass, 0 fail
- **Previous sessions**: no AGENT_NOTES.md existed
- **Polishing spec**: 86/109 done, 15 deferred, 8 pending (all P3 NNA)

### M3 specs found
- `SPEC-cg-v2.md` — ready, detailed implementation plan
- `SPEC-conversation-session.md` — implemented
- Heat system, criminal escalation, Garrett variability — designed in GDD, no dedicated specs

### My plan for this session

**Priority 1: CG v2 (SPEC-cg-v2.md)**
The gate for all M3 work. Spec is detailed and well-designed. Three changes:
1. Target Selection Pipeline — split evaluateConditions into resolveTargets + filter/gate
2. NPC-State Condition Ops — trait, relationship, belief conditions
3. Exclusive Groups + Trigger Index — priority resolution + O(1) lookup

Blast radius analysis:
- `cg-types.ts` — extend interfaces (backward compatible, all new fields optional)
- `cg-engine.ts` — rewrite evaluateConditions, add trigger index in constructor, exclusive groups in process()
- `cg-rules.ts` — migrate 11 rules (mechanical: has_witnesses → targetMode 'witnesses', is_public_place → targetMode 'location' + gate)
- Public API unchanged: constructor(rules, options), process(event, ctx, depth)
- No changes needed in world.ts, server.ts, routes.ts, tests

Note: spec mentions 13 rules but only 11 exist in cg-rules.ts. sentence-rumor and fled-rumor are handled by event handlers in event-handlers.ts, not CG. This is correct — those events create beliefs directly, not via cascade.

**Priority 2: Write SPEC-heat-system.md and SPEC-criminal-escalation.md**

**Priority 3: Add new M3 CG rules using CG v2**
- witness-cover-up (friend covers for criminal)
- witness-eager-report (honest witness reports immediately)
- corruption-cover (corrupt guard ignores wanted status)

**Priority 4: Remaining P3 polishing items**
