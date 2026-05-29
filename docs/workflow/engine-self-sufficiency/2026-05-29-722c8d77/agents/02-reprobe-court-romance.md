# 02-reprobe-court-romance

> Per-agent re-probe output. genre: Royal-Court Romance & Intrigue · score: 9/10 · verdict: module-only · moduleSatisfiable: 92%

## Remaining leaks flagged
- CLWA/packages/engine/src/il.ts:466-468 (ConversationSession crime fields suspectId/perpetratorName/victimId)
- CLWA/packages/engine/src/il.ts:476-483 (accusationHistory/formalAccusations session tracking)
- CLWA/packages/engine/src/il.ts:518-573 processEvidencePresentation (suspectId/perpetratorName + 'crime scene investigation' prose at :571)
- CLWA/packages/engine/src/il.ts:576-705 buildAccusationContext/buildAccusationPrompt (crimeLabel/perpetratorName/'arrest'/'investigator' prose)
- CLWA/packages/engine/src/il.ts:772-846 accusation branch ('I am the law here' at :785)
- CLWA/packages/engine/src/il.ts:86-107 AccusationResponse registry + getAccusationResponse
- CLWA/packages/engine/src/il.ts:762-763 claim-feedback prose 'was involved in X against Y' (mild 'against' framing, always-on claim path)
- CLWA/packages/engine/src/journal.ts:16-17,21-22,30-31,58,64,76 (crimeSceneId/suspectId/victimId/perpetratorName fields + 'crime scene examination' prose)
- CLWA/packages/engine/src/journal.ts:153-215 markSuspect/isSuspect/getSuspects/getCaseSummary (crime-named PlayerJournal API)
- CLWA/packages/engine/src/world.ts:142 World.journal = new PlayerJournal() (crime journal always instantiated)

---

# Re-probe: Royal-Court Romance & Intrigue vs. Neutralized Engine (Phase A)

## Verdict: module-only (9/10) — UP from 7/10 occasional-engine baseline

Phase A neutralization lands cleanly and **fully resolves the one bug that blocked this genre at baseline**: the courtier "investigating the courtship of X" mis-render. The remaining crime vocab is now quarantined entirely inside the consciously-deferred investigation/accusation/journal subsystem (`il.ts` + `journal.ts`, A10+A4b), which a non-violent court genre **never reaches** unless it opts in. Verified against current source on `feature/engine-neutralization`: tsc 0 errors, 222/222 tests pass.

## Genre definition as data
- **Win = social standing** (relationship sentiment/trust + favor capability), not survival.
- **Actions**: court, flatter, compliment, confide, ally, scheme, bribe-for-favor, spread gossip, withhold/reveal a secret. All non-violent.
- **Roles (capabilities)**: `canGrantFavor`, `isRival`, `isPatron`, `isConfidant` — declared as data, not engine-typed.
- **Events**: COURTED, ALLIANCE_FORMED, FAVOR_GRANTED, SECRET_SHARED, INTRIGUE_PLOTTED — registered transferable so they gossip.

## Trace each need to its engine landing spot

| Court need | Engine landing spot | Status |
|---|---|---|
| Court/flatter/scheme **affordances** | `AFFORDANCE_REGISTRY` + `computeUtility` (pure OCEAN+H) | OK — genre-neutral scorer, proven by Economy test (`tests/genre-neutrality.test.ts:125-146`) |
| Court action verbs reach LLM enum | `registerActionVerbs` (INV-10) | OK |
| Roles (canGrantFavor etc.) | `AgentProfile.capabilities: Record<string,boolean>` + `hasCapability()` (**A6**, `agent-types.ts:104-116`) | OK — open map, no engine edit |
| "Aldric courted Bess" belief NL | `phraseBelief()` registry + **neutral fallback** `"{who} — {verb} ({target})"` (**A3**, `event-registry.ts:766-780`) | **FIXED** — fallback has NO wrongdoing framing |
| Courtier's role-section prose | `getRoleDirectiveBuilders()` (**A2**, `agent.ts:376-378`); engine emits only universal belief/relationship/motive sections | **FIXED** — engine never frames a belief as a "crime"/"investigation" |
| NPC-NPC gossip about courtship | `BELIEF_SOURCE.GOSSIP` (**A1/A8**, `world.ts:1181/1194/1309`) + `transferBeliefs` uses `TESTIMONY` (`goals.ts:171`) | OK — engine-universal sources only |
| Affordance gates (atCourt, hasStanding) | `REQUIREMENT_CHECKERS`/`POST_TARGET_REQUIREMENT_CHECKERS` + open `[key:string]` params bag (**A5**, `al.ts:9-27`) | OK |
| Target enrichment (rival/patron flags) | `registerTargetEnricher` (**A5**) | OK |
| Emotional pressure (flattery/bribe/guilt) | `EmotionalPressure.type: string` registry-backed (**A7**, `il.ts:148-153`) + server `registerPressureTypes` (already includes flattery, bribe, guilt) | OK |
| Player claims "X is allied with Y" | IL claim path (`il.ts:721-769`) — `isTransferable` + `BELIEF_SOURCE.TESTIMONY` + `getEventLabelSafe` | OK (genre-neutral) — one mild prose artifact, see below |
| Scene aftermath (a tryst discovered, a torn letter) | `SceneResidue` (sceneType/actorId/affectedId) (**A9**, `scene-residue.ts`) | OK — explicitly genre-neutral |

## Why the baseline blocker is gone
At 7/10 baseline, two always-on prompt paths hardcoded crime English: `agent.buildRoleDirective` framed any belief as "you are investigating the murder/courtship of X", and `beliefs.summarizeForPrompt/Memory` rendered "X committed VERB against Y". For a court NPC holding a COURTED belief this produced the absurd "investigating the courtship of X" / "committed courtship against Y". **A2 + A3 moved 100% of that prose into the crime module** (`crime-justice/index.ts:641-691`) behind `registerBeliefPhrasing`/`registerRoleDirectiveBuilder`. The engine fallbacks are now neutral. A court module supplies its own phrasing ("X courted Y", "X formed an alliance with Y") and its own role directives. This is the decisive change.

## Remaining crime leaks — all NON-BLOCKING for this genre
Every remaining leak lives in the **deferred A10+A4b investigation/accusation/journal subsystem** and is **gated/inert** for a non-violent court genre:

1. **Accusation branch** (`il.ts:772-846`) — fires ONLY when a speech act with `accusation:true` is registered AND the NPC has `investigator`/`canSentence`. A court genre registers neither, so `isAccusationSpeechAct` is false → entire branch (incl. "I am the law here" at :785, `buildAccusationContext`/`buildAccusationPrompt` crime prose) is dead code. Inert, not mis-rendering.
2. **Evidence presentation** (`il.ts:518-573`) — runs unconditionally but early-returns unless `ctx.presentedEvidence` is non-empty; that array is populated only by the crime journal/evidence UI. "crime scene investigation" prose at :571 never renders for court. Inert.
3. **PlayerJournal** (`journal.ts` — `crimeSceneId`/`suspectId`/`victimId`/`perpetratorName`/`markSuspect`/`getCaseSummary`) is always instantiated at `world.ts:142`, but a court genre simply never calls its crime-named methods. Dead surface, not a mis-render.
4. **Mild prose artifact (only quasi-always-on item)**: `il.ts:762-763` claim-feedback renders "{subject} was involved in {label} **against** {object}". For a COURTED claim this reads "Aldric was involved in courtship against Bess" — the word "against" is a faint crime-leaning artifact. It is grammatically odd but NOT a hard mis-render (the LLM still gets the right entities + event label), and it is bounded to the player-claim path. Worth folding into the A3 phrasing delegation when A4b is extracted, but does not block.

The permanent regression guard (`tests/architecture.test.ts:112-160`) proves the **rest of the engine** (39 of 41 files) carries zero crime prose and zero crime-named primitives; only `journal.ts` + `il.ts` are excluded as tracked-deferred.

## Self-sufficiency: ~92% module-satisfiable, no blocking leaks
All core court loops (courtship/alliance affordances, favor capabilities, gossip propagation, belief phrasing, emotional pressure, relationship-as-win-condition) resolve through registries with zero engine edits — the same path the in-repo Economy test exercises. The ~8% shortfall is purely the optional accusation/journal subsystem, which is (a) not needed for a romance/intrigue win condition and (b) already documented as a turn-key extraction. No leak mis-renders in the court NPC's prompt.

## Re-rate
- Baseline: **7/10 occasional-engine** (~8 leaks, including the 2 blocking always-on prompt leaks A2/A3).
- Now: **9/10 module-only**. The blocking leaks are eliminated; remaining leaks are inert/gated and confined to one documented deferred subsystem. A bounded follow-up (A4b: delegate IL accusation phrasing + the `il.ts:763` "against" artifact via the existing `phraseBelief` hook; A10: rename PlayerJournal fields to generic case-file primitives) would close the last ~8% and lift to 10/10, but it is not required for this genre to ship correctly.
