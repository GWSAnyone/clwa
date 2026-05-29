# 01-reprobe-trading-economy

> Per-agent re-probe output. genre: Peaceful Trading-Economy Village (produce / buy / sell / price / undercut, zero crime) · score: 8.5/10 · verdict: occasional-engine · moduleSatisfiable: 93%

## Remaining leaks flagged
- packages/engine/src/journal.ts:1-240 (PlayerJournal — clue/testimony/observation entry types, addClue 'crime scene examination', markSuspect/isSuspect/getSuspects, getEntriesForSuspect, getCaseSummary perpetratorName + quality strong/moderate/weak/insufficient, crimeSceneId/suspectId/victimId/evidenceCategory fields — KNOWN-DEFERRED A10)
- packages/engine/src/il.ts:459-695 (PresentedEvidence suspectId/perpetratorName/victimId; ConversationSession.accusationHistory/formalAccusations; processEvidencePresentation hardcoded 'crime scene investigation' prose; AccusationContext/buildAccusationContext/buildAccusationPrompt crimeLabel/'FORMAL ACCUSATION'/'warrants immediate action'/investigator+canSentence gates — KNOWN-DEFERRED A4b)
- packages/engine/src/il.ts:771-875 (accusation branch in applyDialogueMeaning — gated by isAccusationSpeechAct, dead code when no accusation speechAct registered — KNOWN-DEFERRED A4b)
- packages/engine/src/world.ts:1300 (overheardClaim prose 'may be involved in <verb>' — mild investigation framing applied to ALL transferable-belief overhears)
- packages/engine/src/world.ts:1324-1333 (player overhear auto-creates PlayerJournal observation entry — routes a neutral overhear into the crime-coded journal structure)
- packages/engine/src/al.ts:55-83 (StepTemplate JSDoc + fields: perpetratorName/crimeLocation/crimeType interpolation vars, 'crime beliefs' comment on beliefTransfer)
- packages/engine/src/world-types.ts:114-150 (SceneResidue JSDoc residuals: 'crime scene', 'Who committed the crime', 'Victim of the crime', 'perpetrator' — inert comments; fields themselves neutral actorId/affectedId/sceneType)
- packages/engine/src/cg-engine.ts:345,372,391,393 (event.payload.perpetratorName/affectedName reads with graceful fallback — DOCUMENTED ACCEPTABLE untyped payload bag)
- packages/engine/src/world.ts:52-55,139,270-274,1341,1521-1524,1581,1756 (inert crime-vocab comments on callbacks/fields)
- packages/engine/src/beliefs.ts:39-41,49,68,121 (inert crime-vocab comments: 'two testimonies about same crime', 'specific suspect', 'X committed')
- packages/server/src/ws.ts:28,31 ('murder' / 'crime:scene' / crimeType WS message union — DOCUMENTED ACCEPTABLE game-UI/wiring layer, not engine)
- packages/server/src/index.ts:149,155 (IL vocab wiring mixes crime claim-sources 'suspects'/'deduced' + pressure types 'threat'/'bribe'/'intimidation'/'guilt' into shared server bootstrap — bootstrap layer, not engine, but a trading genre inherits crime vocab unless it swaps this wiring)

---

## Re-probe: Peaceful Trading-Economy Village vs NEUTRALIZED engine

### A1–A9 landing confirmed (read actual current source)
| Change | Verified in source |
|---|---|
| A1 conversation belief source → `BELIEF_SOURCE.GOSSIP` | world.ts:1181,1194,1309 (conversation + overhear transfer all use GOSSIP, not 'rumor'). event-registry.ts:332-342 defines GOSSIP as engine-universal. |
| A2 `buildRoleDirective` → `registerRoleDirectiveBuilder` | agent.ts:360-395 emits only universal belief summary + relationships + motive, then delegates to `getRoleDirectiveBuilders()`. Crime prose gone. |
| A3 belief NL → `registerBeliefPhrasing` + neutral fallback | beliefs.ts:137,165 + il.ts:891 call `phraseBelief()`; event-registry.ts:766-780 neutral fallback `X — verb (Y)`, no wrongdoing framing. |
| A4a `buildSecretDirectives` → aggregator | event-registry.ts:704-721 `SECRET_DIRECTIVE_BUILDERS` registry. |
| A5 AffordanceRequirement open bag + checker registries | al.ts:10-28 `[key:string]:unknown`; 209-219 REQUIREMENT_CHECKERS / POST_TARGET_REQUIREMENT_CHECKERS / registerTargetEnricher; 269-301 generic iteration. No inline notGuard/isInvestigator/canSentence branches. |
| A6 AgentProfile open `capabilities` + `hasCapability()` | agent-types.ts:107,115-117. investigator/detersCrime/canSentence now only doc examples. CG `has_capability` op uses it (cg-engine.ts:283-285). |
| A7 EmotionalPressure.type → string | il.ts:148-153 registry-backed; getRegisteredPressureTypes(). |
| A8 pre-seeded crime sources moved out; engine keeps testimony/observation | event-registry.ts:315-318 labels, 352-355 transfer weights. No BODY_DISCOVERY/DEDUCTION constants; dead SOURCE_CONFIDENCE gone. |
| A9 CrimeScene→SceneResidue, processKill→processAgentDeath, callbacks renamed | world-types.ts:128-150 (sceneType/actorId/affectedId); scene-residue.ts (createSceneResidue, genre-neutral); world.ts:53-55 onAgentDeath/onSceneResidue, 1529 processAgentDeath, 1488 markSceneResidue. |

Baseline was 7/10 occasional-engine, ~8 leaks. Phase A drained those; the live engine is materially cleaner.

### Trading-genre needs → engine landing spot (all SATISFIABLE)
- **Browse shop / inventory** → `AgentProfile.shop: ShopItem[]` (agent-types.ts:119-124), consumed by server routes/ws/world-loader. ✓
- **"Show me your wares" / buy / sell / haggle** → IL `tradeIntent` is **first-class in the engine** (il.ts:72-75,155-160,374-380) with semantic correction forcing trade speechAct (il.ts:283-301). Trade speechAct + buy/sell/browse verbs registered (server/index.ts:146,150). ✓
- **Ask price / opinion of a vendor** → IL questions → belief gather via `phraseBelief` (neutral). questionTopics registry. ✓
- **Produce / sell goods as an NPC action** → AL affordance with module step type; volition.ts:975 generic default step handler resolves ANY registered step (`trade` listed as example). actionVerb via registerActionVerbs. ✓
- **"Garrett undercut my prices" belief spreading NPC→NPC and via overhear** → conversation/overhear transfer gated by `isTransferable`, source GOSSIP, any eventType (e.g. PRICE_UNDERCUT). ✓
- **Vendor rivalry / mood / sentiment from competition** → mood modifiers, sentimentCurve, social-stress drift, CG rules on economy event types — all registry/data driven. ✓
- **Player asks NPC to do something (e.g. "stock more bread")** → IL requestedAction → getAffordanceIdsForVerb → goalCreator. ✓
- **Reputation / "who is a fair trader"** → relationships + beliefs + capabilities (e.g. `isMerchant`). ✓

**Module-satisfiable ≈ 93%.** The ~7% gap = the deferred PlayerJournal + IL accusation/evidence subsystem, which a peaceful trading player has no analogue for (no case, no suspects, no evidence presentation).

### Remaining crime leaks this genre would hit — and why NONE are blocking
1. **journal.ts PlayerJournal (A10, deferred).** Crime-coded throughout (clue/testimony/observation types, suspects, case summary quality strong/moderate/weak/insufficient, perpetratorName/crimeSceneId). A trading player has nothing to investigate. **Non-blocking**: the journal only fills when (a) a crime scene is examined or (b) a transferable-belief overhear occurs. A pure trading world registers no scene-residue templates and (if desired) no transferable economy beliefs, so it stays empty. The one live path that touches it on a neutral overhear is world.ts:1324-1333 — but only fires for the *player* agent AND only when `overheardClaim` is non-empty, which a trading genre can avoid by phrasing/transferability config. Inert, not mis-rendering.
2. **il.ts evidence-presentation + accusation (A4b, deferred).** `processEvidencePresentation` only runs if `ctx.presentedEvidence` is populated (a crime client feeds this; a trade client never does). The accusation branch (il.ts:771) is gated by `isAccusationSpeechAct(speechAct)` — no module registers an `accusation:true` speech act in a trading genre, so the whole branch is **dead code**. Inert, not blocking.
3. **world.ts:1300 overheardClaim prose "may be involved in <verb>".** Mild investigation framing applied to all transferable-belief overhears. Would read slightly off for "may be involved in price-cutting" but still grammatical/usable — cosmetic, **non-blocking**.
4. **al.ts:55-83 StepTemplate JSDoc + crime interpolation vars** (perpetratorName/crimeLocation/crimeType/'crime beliefs'). Comment/var-name residual; the interpolation engine is generic ({var:fallback}). Inert.
5. **Inert comments**: world-types.ts:114-150 (SceneResidue "crime scene"/"perpetrator"/"victim" JSDoc; fields themselves neutral), world.ts callback comments, beliefs.ts comments, cg-engine.ts comments. Pure documentation; zero runtime effect.
6. **cg-engine.ts payload reads perpetratorName/affectedName** (DOCUMENTED ACCEPTABLE) — untyped payload bag with graceful fallback to event.subject/object/'someone'. Works for any genre.
7. **Boundary-adjacent (NOT engine):** server/src/index.ts:149,155 IL-vocab wiring still mixes crime claim-sources ('suspects','deduced') and pressure types ('threat','bribe','intimidation','guilt') into the shared bootstrap; server/src/ws.ts:28,31 'murder'/'crime:scene'/crimeType WS union. These are the documented game-UI/wiring residuals — a trading genre swaps the bootstrap wiring, not engine code.

### Crash-safety on a crime-free world
No engine path crashes without crime data: `getBodyDiscoveryEventType()`→null short-circuits body discovery (world.ts:1349); `getDefaultDeathEvent()` only throws inside `processAgentDeath`, never auto-invoked; createSceneResidue throws only if a sceneType is explicitly requested with no template (a trading world requests none); EvidenceLayer/CG/STEP_HANDLERS are empty-registry no-ops.

### Verdict vs the 7/10 baseline
**Re-rated to 8.5/10 — occasional-engine (up from 7/10).** Phase A neutralized every baseline leak; the two clusters this genre would still touch (PlayerJournal A10, IL accusation/evidence A4b) are **inert for trading** — they sit behind crime-only gates (`isAccusationSpeechAct`, scene-residue templates, presentedEvidence) that a peaceful trading genre never trips, so they neither mis-render nor crash. They remain "engine knows a domain it shouldn't" (real INV-14 debt) which keeps this short of module-only(9-10); the single bounded remaining investment is finishing A10+A4b (generalize PlayerJournal → a neutral "notebook" of typed records, and lift the accusation/evidence-presentation subsystem into the module). With those done, this genre would be module-only. No blocking leaks → not frequent-engine. Hence high-end occasional-engine.
