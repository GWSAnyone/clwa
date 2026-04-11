# CLWA Autonomous Agent Notes

## Session: 2026-04-11 23:45 → 2026-04-12 ~02:00

### Summary
51 commits on `night/autonomous-20260411`, all pushed to remote. 82 tests, 0 TS errors, 0 TODOs.
M3 Living Opposition feature-complete. Extensive detective toolkit, UI polish, and creative gameplay features.

### Stats
| Metric | Before | After | Delta |
|--------|--------|-------|-------|
| Commits | 0 | 51 | +51 |
| Tests | 61 | 82 | +21 |
| Affordances | 20 | 22 | +2 (argue, threaten) |
| CG rules | 11 | 21 | +10 |
| Topic sources | 13 | 16 | +3 |
| Event types | ~15 | 24+ | +9 |
| Polishing | 86/109 | 101/109 | +15 |
| TODOs | 1 | 0 | -1 |

### M3 Living Opposition — All Features
1. **CG v2 engine** — target pipeline, NPC-state conditions, exclusive groups, trigger index
2. **Criminal escalation** — argue/threaten affordances, motive growth tick, kill threshold 0.7
3. **Heat system** — phases 1+2 (directive prose + mood modifier)
4. **Witness reactions** — cover-up/eager-report exclusive group + belief transfer suppression
5. **Garrett variability** — corrupt (H<0.4) guard ignores crimes via exclusive groups
6. **NPC resistance** — trust-gated chat responses
7. **Emergent cascades** — grief revenge, arrest backlash, guard warning

### Detective Toolkit
- Location history + alibi API (`/api/debug/alibi/:id?minute=N`)
- NPC schedule knowledge (friends know routines)
- Auto-journal from overhear (WorldCallbacks.onJournalEntry)
- Victory/false conviction toasts
- Town pulse endpoint (`/api/debug/pulse`)

### Conversation Quality
- Trust-aware relationship notes
- Richer follow-up prompts (mood + relationship in exchanges 2+)
- 3 new topic sources: secretLeakageTopics, sightingTopics, suspicionTopics

### UI Polish
- Emotional state indicators on NPC sprites
- Approach toast with descriptive text
- Readable cascade labels in event feed
- Escalation event toasts (argue, threaten)
- Journal entries show time of day
- Expanded detective hints (distressed NPCs, detained)
- Conversation starter hints by NPC role
- HUD: investigation progress (clues + suspects), speed indicator
- Keyboard shortcuts: J=journal, Escape closes journal/chat
- Context-specific witness memories

### Bugs Found & Fixed
1. **Argument cascade** — ARGUMENT_WITNESSED → WITNESS_MEMORY → WANTED_STATUS. Fixed: MINOR_INCIDENT_MEMORY type.
2. **Motive confidence too high** — 0.5-0.9 bypassed escalation. Fixed: 0.25-0.50.
3. **Growth rate too slow** — 0.03/h unreachable in session. Fixed: 0.06/h.

### Balance
- Escalation at 3x speed from conf 0.35: argue (immediate) → steal (~0min) → threaten (~50min) → kill (~117min)
- Motive growth >> decay: 0.06/h vs 0.001-0.004/day. Motives always escalate unless player intervenes.
- CG trigger index: 21 rules across 12 triggers. Max 5 per trigger (WITNESS_MEMORY). O(1) lookup.

### For Review
Branch `night/autonomous-20260411` is ready for review and merge into master. Recommended approach:
1. `git checkout master && git merge night/autonomous-20260411`
2. Run `bun run test` to verify (82 tests)
3. Start server (`bun run packages/server/src/index.ts`) and playtest
4. Check AGENT_NOTES open questions below

### Open Questions
1. Kill threshold at 0.70 — is ~2 hours (at 3x) the right pacing?
2. GUARD_WARNING event: registered but no behavioral handler yet
3. Blackmail affordance: no step handler, completes as conversation
4. Argue dispatches through onCrimeEvent (semantically imprecise but mechanically correct)
5. M4 readiness: arrival event, win/lose detection, end-of-run summary still needed
