# 03-static-recount

> Per-agent re-probe output. genre: static-recount · score: 9/10 · verdict: module-only · moduleSatisfiable: 97%

## Remaining leaks flagged
- packages/engine/src/volition.ts:170 — hasCapability(agent.profile, 'investigator') hardcoded crime capability string (gates a debug console.log only)
- packages/engine/src/event-projection.ts:10 — WorldState.wantedSubjects field init (pursuit-flavored identifier; populated via generic isPursuitEvent)
- packages/engine/src/event-projection.ts:27 — const wanted = event.subject ?? event.payload?.perpetratorName (perpetratorName = documented untyped-payload residual w/ graceful subject fallback)
- packages/engine/src/event-types.ts:18 — wantedSubjects: Set<string> type field (pursuit naming)
- packages/engine/src/journal.ts — DEFERRED (A10): 46 crime-vocab occurrences (PlayerJournal: clues, suspects, evidence, perpetratorName)
- packages/engine/src/il.ts — DEFERRED (A4b): 99 crime-vocab occurrences (accusation/evidence-presentation subsystem)

---

## Phase A Genre-Neutralization — Static Re-Audit (INV-14)

**Branch:** `feature/engine-neutralization` (HEAD `99a6c9e`). **tsc:** exit 0. Scope: `packages/engine/src`, CODE only (identifiers + string literals), excluding comments, excluding deferred `journal.ts`/`il.ts`, excluding documented payload-key + WS-contract residuals.

### 1. Structural boundary — PERFECT
Grep for every engine→module import shape (`from '../modules'`, `from '../../modules'`, `@clwa/crime`, `@clwa/modules`, `require('...modules')`): **zero matches**. The engine imports nothing from modules. INV-14's structural half is intact.

### 2. New neutralization hooks — all confirmed GENERIC
| Hook | Location | Verdict |
|---|---|---|
| `registerRoleDirectiveBuilder` / `RoleDirectiveBuilderFn` | event-registry.ts:730-743 | generic — ctx = {agent, nameResolver} → string[]; no crime vocab |
| `registerBeliefPhrasing` / `phraseBelief` | event-registry.ts:751-779 | generic — neutral fallback `${who} — ${verb} (${target})`, explicitly no wrongdoing framing; first non-null module wins |
| `registerTargetEnricher` / `TargetEnricherFn` | al.ts:215-220 | generic — (target, agent, ctx) → void |
| `REQUIREMENT_CHECKERS` / `POST_TARGET_REQUIREMENT_CHECKERS` | al.ts:209-213 | generic — `Map<string, fn>` keyed by requirement field name; whole requirement passed as params bag |
| `capabilities` / `hasCapability` | agent-types.ts:107,115-116 | generic — `Record<string,boolean>` + `hasCapability(profile, key)`; engine never names a capability in its own type |

A5/A6/A7/A8/A9 verified at the type level: `AgentProfile.capabilities` open, `state.status: string|undefined` open, `SceneResidue` (was `CrimeScene`) carries crime words only in JSDoc, `scene-residue.ts` (was `crime-scene.ts`) clean, `processAgentDeath` (was `processKill`) present, `BELIEF_SOURCE` trimmed to testimony/observation/evidence/gossip.

### 3. Remaining CODE-level crime vocab — NON-DEFERRED surface

After excluding comments and the documented residuals, the entire non-deferred engine has effectively **ONE** hardcoded crime string and **one** pursuit-named field cluster:

- **`volition.ts:170` — `hasCapability(agent.profile, 'investigator')`** — the only hardcoded crime-justice capability string in live engine code. It gates a single debug `console.log`. **Non-blocking** (inert: removing the module leaves the branch simply never logging). Still a genuine semantic leak — the engine literally names the crime capability `'investigator'`.
- **`event-projection.ts:10/27/28` + `event-types.ts:18` — `wantedSubjects` / `const wanted`** — pursuit-flavored identifiers. Behaviorally neutral: the set is populated only through the generic `isPursuitEvent(event.type)` registry gate (modules decide what is a "pursuit"). The `?? event.payload?.perpetratorName` on line 27 is the already-documented untyped-payload residual, and it has a graceful `event.subject ??` primary. Counts as a **naming** leak, not a behavioral one.

`BODY_DISCOVERY` (processing-queue.ts:8, world.ts:712/877, event-registry.ts:520) was checked and is NOT counted: it is a universal death-perception phase alongside DAY_ADVANCE/VOLITION/CONVERSATION; any genre with mortality has body discovery, and the concrete event type is module-registered via `registerBodyDiscoveryEvent`. The Enneagram `'JUSTICE'`/`'peace through justice'` prose (instinct-builder.ts:105, agent.ts:438) and the Type-5 `'Investigator'` label are universal personality psychology, not crime-module vocabulary — also not counted.

### 4. Deferred (tracked follow-up A10 + A4b) — counted, not a new failure
- `journal.ts` — **46** crime-vocab occurrences (PlayerJournal: clues, suspects, evidence, perpetratorName).
- `il.ts` — **99** crime-vocab occurrences (accusation/evidence-presentation: `buildAccusationContext`/`buildAccusationPrompt`/`processEvidencePresentation`, `getEventLabelSafe(claimEventType, 'wrongdoing')`).

These two files hold ~98% of all remaining crime vocabulary in the engine, which is exactly why they are the explicit next extraction step.

### 5. Verdict
**Non-deferred surface: leak count = 1 genuine semantic leak** (`volition.ts:170 'investigator'`) **+ 1 borderline naming cluster** (`wantedSubjects`). Both **non-blocking** — nothing mis-renders or mis-behaves for a non-crime genre; a clean module supplies its own capabilities and pursuit events and the engine runs identically.

Baseline was 7/10 occasional-engine, ~8 leaks. Phase A drove the non-deferred surface from ~8 leaks down to **1 (+1 cosmetic)**, all inert. The semantic INV-14 boundary on the non-deferred surface is **near-perfect** — not literally zero (the single `'investigator'` debug-gate string remains), so I stop just short of declaring it PERFECT, but it is module-only quality.

**Score 9/10 module-only.** The two residuals are trivial follow-ups (rename `wantedSubjects`→`pursuedSubjects`; move the debug-log behind a generic capability or drop the gate). Engine cleanliness ~97% for the non-deferred surface; the only substantial remaining crime concentration is the consciously-deferred journal.ts + il.ts (A10/A4b).
