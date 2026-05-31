# crime-justice module registration pattern — and the economy-module template

All facts below are read from `packages/modules/src/crime-justice/*` and the engine registry surface in `packages/engine/src/{event-registry.ts,al.ts,il.ts,topic-engine.ts}`. The engine never imports the module (INV-14); the module fills empty engine registries at boot.

## 1. File / folder layout (mirror this for economy)

```
packages/modules/src/crime-justice/
  index.ts            # registerCrimeJusticeModule() — the ONE hub + re-exports
  affordances.ts      # CRIME_AFFORDANCES: AffordanceDefinition[]   (pure data)
  target-finders.ts   # registerCrimeTargetFinders() -> TARGET_FINDERS / REACTIVE_TARGET_FINDERS
  cg-rules.ts         # CRIME_CG_RULES: ConsequenceRule[]  (EXPORTED, server feeds CG engine)
  step-handlers.ts    # registerCrimeStepHandlers() + Step interfaces + CRIME_SEVERITY/VERDICT_OPTIONS + module-level imprisonmentTimers Map
  event-handlers.ts   # registerCrimeEventHandlers() -> registerEventHandler(...)
  evidence-rules.ts   # CRIME_EVIDENCE_RULES + evidence-sources.ts registerCrimeEvidenceSources()
  topic-sources.ts    # justiceTopics / playerRumorTopics / suspicionTopics : TopicSource
  investigation.ts    # PlayerJournal class + registerInvestigationModule() (dialogue-effect handler)
  heat.ts             # computeHeat / buildHeatDirective (domain pressure model)
```
Economy: `packages/modules/src/economy/` with `index.ts` (registerEconomyModule), `affordances.ts`, `target-finders.ts`, `cg-rules.ts` (export ECONOMY_CG_RULES), `step-handlers.ts`, `event-handlers.ts`, `topic-sources.ts`, and a `pricing.ts`/`market.ts` as the `heat.ts` analog.

## 2. The single hub: `registerCrimeJusticeModule()` — exact call sequence

The function is one long sequence of `register*()` calls and `REGISTRY.set/push`. Replicate this ordering:

1. **Declare LLM tasks** — `registerLlmTask('volition'|'il'|'verdict'|'dialogue'|'npc-dialogue'|'reflection', {requiresStructuredOutput?|requiresStreaming?})`. Module declares only what it actually calls; `embeddings` is engine-owned.
2. **Affordances** — `AFFORDANCE_REGISTRY.push(...CRIME_AFFORDANCES)` then `registerCrimeTargetFinders()`.
3. **Evidence** — `EVIDENCE_RULES.push(...CRIME_EVIDENCE_RULES); registerCrimeEvidenceSources()`.
4. **Requirement checkers** — `REQUIREMENT_CHECKERS.set(key,(agent,ctx,params)=>bool)` and `POST_TARGET_REQUIREMENT_CHECKERS.set('noGuardNearby',(agent,ctx,target)=>bool)`. Role gates use `hasCapability(agent.profile,'investigator')`, never the role string.
5. **`registerTargetEnricher((target,agent)=>void)`** — fills `target.extra` prose vars.
6. **`registerInvestigationModule()`** — registers the dialogue-effect handler.
7. **`registerBlockingGoalTypes(['arrest'])`**.
8. **Event metadata** — `registerEventCategory`, `registerEventTypeFlagsBatch`/`registerEventTypeFlags`, `registerEventLabels`, `registerEventGoalCleanup`, `registerEventSceneTypes`, `registerDeathEvents`, `registerPursuitEvents`, `registerWitnessEventType`, `registerBodyDiscoveryEventType` + `registerDiscoveryHandler`, `registerRumorEventType`, `registerSecretEventType`, `registerAbsentStatuses`.
9. **Source metadata** — `registerSourceFlags`, `registerSourceCategory`, `registerSourceDecayRates`, `registerSourceTransferWeights`, `registerBeliefSourceLabels`, `registerRelationshipLabels`.
10. **Motive sub-system** — more `registerEventCategory('motive',...)` + per-type `registerEventTypeFlags(type,{decayRate})` + a `personal_motive` source (flags/transfer/decay/label).
11. **Scene templates** — `registerSceneResidueTemplate(sceneType,{points,passiveNoticeText,personalizePoints,additionalPoints})`.
12. **Mood/goal** — `registerEventMoodShifts({TYPE:delta})`, `registerGoalMoodBoost({goalType:boost})`.
13. **CG output** — paired `registerBeliefCreator(consType, fn)` + `registerMemoryTextBuilder(consType, fn)` for every consequence type.
14. **Topics** — `TOPIC_SOURCE_REGISTRY.push(...)` + `registerTopicGroupMapping({category:group})`.
15. **Action verbs** — `registerActionVerbs({verb:[affordanceIds]})` then a validation loop that warns when an affordance's `actionVerb` is missing from the map (INV-10).
16. **`registerCrimeEventHandlers()`**.
17. **`registerConsequencePostHandler(fn)`** — grief/sentiment shift on learning of harm.
18. **`registerBeliefPhrasing(fn)`** + several ordered `registerSecretDirectiveBuilder(fn)` + `registerRoleDirectiveBuilder(fn)`.
19. **Tick/day handlers** — many `registerTickPhaseHandler(async ctx=>...)` (gate with `ctx.gameMinute % N`) + `registerDayAdvanceHandler(async ctx=>...)`.
20. **`registerCrimeStepHandlers()`** + `registerInteractPostHook` + `registerInteractionResultHook`.

## 3. Key data shapes

**AffordanceDefinition** (data record, no logic): `{id, actionVerb?, actionDescription?, label, instinctContext?, targetFinder?|targetRole?, category, severity, suppressNearPlayer?, isDuty?, minimumScore?, cooldownOverride?, resistTraits[], requires{checkerKeys + inline gates moodBelow/sentimentBelow/period/maxWitnesses/beliefConfidence}, weights[{trait,direction,multiplier}], moodWeight, relationshipWeight, trustWeight?, beliefModifiers[{eventType,weight}], goalType, goalPriority, eventBoost?{eventTypes[],boost,requiresRelationToObject?}, stepTemplates[{action,...}]}`. Step templates interpolate location tokens `$target/$home/$extra.X` and prose tokens `{targetName}`, `{reason:default}`, `{crimeType:default}`, `{perpetratorName:}`, `{affectedName:}`.

**Step handler** signature: `registerStepHandler(action, async (ctx: StepExecutionContext): Promise<GoalActionResult|null> => {...})`. `ctx` = `{goal, owner, agents, locations, addMoodModifier, onEmitEvent, goalManager, evidenceLayer, sceneResidues}`. Handler mutates state, emits world events via `ctx.onEmitEvent({type,subject,object,location,importance,payload})`, increments `goal.currentStep`, returns a result with a human description. In-handler LLM = build `LlmJsonSchema` then `await classify('verdict',{system,user,schema,agentContext:{id},maxTokensOverride,samplingOverride})`; the façade owns acquire/release (INV-01).

**ConsequenceRule** (CG): `{id, trigger, targetMode:'witnesses'|'affected'|'location'|'all', conditions:[{op:'trait'|'relationship'|'has_capability'|'is_public_place'|'faction'|'attr', ...}], consequence:{type,importance,delayDays,probability}, maxChainDepth, exclusive?, priority?, subjectUnknown?, tracksWitness?}`. NOTE: CG rules are NOT self-registered — `cg-rules.ts` EXPORTS the array; the server passes it to the CG engine constructor.

**TopicSource**: `(init, resp, ctx) => TopicProposal[]` (arity-3 enforced). Proposal: `{topicKey, subject, tone, moodValence, weight, initiatorHook, responderHook, category, minImportance?, beliefTransfer?{eventType,object|subject,confidenceMultiplier}}`.

## 4. Economy-specific reuse / new wiring

- **Gold rides on existing primitives**: wealth = a `ScalarAttribute`/`AttributeModifier` on `AgentState.attributes`; gate CG rules with the existing **`attr`** condition op (no engine change). Fold wealth/greed/desperation into utility via **`registerScoringContributor(fn)`** — this hook lives in `engine/src/al.ts:439` (SCORING_CONTRIBUTORS channel in computeUtility); crime-justice does not use it, so it is the clean economy channel.
- **Inventory/trade**: step handlers use the engine inventory API (`addItem`/`removeItems`/`countItems`, and `World.transferItem` atomic conserved move) exactly as `steal_from` already does.
- **Factions**: reuse the `faction` CG op + per-faction standing (crime already demonstrates `merchants_guild` GUILD_ALARM) — this is the INV-14 proof that economy needs zero engine edits.
- **IL trade migration substrate** (legacy `AgentProfile.shop`/`ShopItem` + `TradeIntent`): the empty registries already exist in `event-registry.ts` — `registerILTradeVerbs`, `registerClaimSources`, `registerSpeechActs([{act,trade?}])`, `registerQuestionTopics`, `registerDefaultSpeechAct`, plus `registerPressureTypes`/`registerPressureHandler`. The economy module fills these so IL dynamic schema recognizes buy/sell/haggle dialogue.

## 5. Invariants the economy module must honor (carry over from crime)
INV-01 (façade owns LLM semaphore — never call acquire/release in a handler), INV-06 (mood only via `ctx.addMoodModifier`), INV-08 (flag every new event type via `registerEventTypeFlagsBatch`), INV-09 (`registerSourceFlags` for every new belief source), INV-10 (`registerActionVerbs` for every affordance verb + keep the validation loop), INV-13 (belief dedup key = eventType+object+source — pick source strings deliberately), INV-14 (no engine import / zero engine string literals — economy vocabulary lives only in the module), INV-16 (every agent loop in tick/day handlers decides skip-or-include player), INV-18 (`adjustSentiment`/`adjustTrust` not direct mutation), INV-19 (gate tick handlers on absolute `ctx.gameMinute % N`).
