## Economy/Trade Module — Content Registration Plan

Mirrors packages/modules/src/crime-justice/. Single hub registerEconomyModule(world) + exported ECONOMY_CG_RULES (server-consumed like CRIME_CG_RULES at server/index.ts:776). Zero engine edits beyond the tested M5 substrate.

### Verified substrate (precedents)
- Wealth/price/need/debt = ScalarAttribute on AgentState.attributes (attributes.ts). World getAttribute/setAttribute/adjustAttributeBase/addAttributeModifier/transferAttribute (world.ts:656-708). transferAttribute atomic+conserved, debits BASE, refuses base<amount (world.ts:704) — attributes.test.ts:93-155.
- Goods = Item + addItem/removeItems/countItems (inventory.ts); World transferItem atomic (world.ts:739-777). Crime steal_from mutates inventory (step-handlers.ts:228-231).
- Decision pressure = registerScoringContributor (al.ts:438) summed in computeUtility (~al.ts:486). attributes.test.ts:218-235: debt 0.8x0.5=0.40, poor>solvent.
- CG gating = ops attr/faction/has_capability (cg-engine.ts:284-303); attr comparator tested attributes.test.ts:158-216.
- Live INV-14 proof = tests/genre-neutrality.test.ts registers a full economy genre (TRADE/FRAUD, isMerchant/canAudit, eco_defraud, minCapital/atMarket) through identical registries.

### Folder layout
index.ts (hub + re-exports {ECONOMY_CG_RULES}), affordances.ts (ECONOMY_AFFORDANCES), target-finders.ts, cg-rules.ts (ECONOMY_CG_RULES), step-handlers.ts (+ module-scope debtLedger Map), event-handlers.ts, topic-sources.ts, pricing.ts (heat.ts analog), shop.ts (catalog + buy/bribe + IL trade verbs + shop-injection). registerEconomyModule(world) called once beside registerCrimeJusticeModule() (server/index.ts:43); takes World so handlers close over transferAttribute/transferItem (their contexts carry no World ref).

### 1. Affordances — AFFORDANCE_REGISTRY.push(...ECONOMY_AFFORDANCES), category 'economic'
AffordanceDefinition (al.ts:92-142), OCEAN+H weights for emergence (greed=low-H/low-A, desperation=scorer on debt/hunger):
- buy: actionVerb buy, targetFinder seller, requires {canAfford, atMarket}, weight C-high, beliefMod PRICE_FAVORABLE, steps move_to+buy_goods.
- sell: targetFinder buyer, requires {hasGoodsToSell, atMarket}, weight E-high, steps move_to+sell_goods.
- haggle: requires {atMarket}, weights A-low+H-low, instinctContext "{sellerName} is asking {priceQuote:too much}", steps move_to+haggle_with.
- produce: requires {canProduce, hasInputs}, weight C-high, step craft_goods @ $home (no target).
- hoard: requires {hasGoodsToSell}, weights A-low+N-high, beliefMod SHORTAGE.
- lend: targetFinder debtor_candidate, requires {hasCapital, minCapital:50}, weight A-high, step offer_loan.
- collect_debt: targetFinder debtor, requires {isCreditorOf}, suppressNearPlayer, beliefMod DEBT_OWED, step demand_payment.
- smuggle: requires {}, beliefMod SHORTAGE, boosted by the debt scoring contributor.
registerActionVerbs for all 8 (INV-10). Enricher fills target.extra priceQuote/itemName/debtAmount for step interpolation.

### 2. Event types — categories, flags (INV-08), labels
registerEventCategory: economy[TRADE_COMPLETED,FRAUD,PRICE_GOUGING], market[PRICE_SPIKE,SHORTAGE,SURPLUS,PRICE_FAVORABLE], credit[DEBT_OWED,DEBT_DEFAULT,LOAN_GRANTED]. registerEventTypeFlagsBatch transferable[FRAUD,PRICE_GOUGING,DEBT_DEFAULT]; informationOnly[TRADE_COMPLETED,PRICE_SPIKE,SHORTAGE,SURPLUS,PRICE_FAVORABLE]; registerEventTypeFlags DEBT_OWED {subjectReacts:true,decayRate:0.02}. registerEventLabels for each. NOTE crime already owns DEBT_PRESSURE/economic_pressure (index.ts:140) — economy should take ownership. Verified genre-neutrality.test.ts:123-130 (TRADE/FRAUD, isTransferable('FRAUD')===true).

### 3. Belief sources / phrasing / decay / transfer (INV-09)
registerSourceFlags transaction_record/ledger/market_observation {firsthand:true}, merchant_gossip {}. registerSourceCategory financial_evidence[ledger,transaction_record]. registerSourceDecayRates + registerSourceTransferWeights (ledger ~0, market_observation 0.6) + registerBeliefSourceLabels. registerBeliefPhrasing FRAUD/PRICE_GOUGING -> cheated/overcharged/gouged (genre-neutrality.test.ts:81-91). One registerBeliefCreator + registerMemoryTextBuilder pair per CG consequence (FRAUD_RUMOR, DEBT_REMINDER, SHORTAGE_PANIC), mirror crime index.ts:221-250.

### 4. Scoring contributor (central wiring)
registerScoringContributor((aff,agent)=> aff.category==='economic' ? f(attributes):0): smuggle/buy = debt*0.5 + hunger*0.4; hoard = debt*0.3. Exact attributes.test.ts:218-235 mechanic (debt 0.8x0.5=0.40, poor>solvent). computeUtility (~al.ts:486) sums SCORING_CONTRIBUTORS. clearScoringContributors() in test afterAll.

### 5. Gaps closed module-side
- Pricing (no engine law; decayAttribute world.ts:591 decays only modifiers): price:KIND ScalarAttribute on a synthetic market agent, drifted by a registerTickPhaseHandler (gameMinute%60, INV-19) reading supply(sum countItem)+demand(buy goals/hunger) then world.adjustAttributeBase (pricing.ts computePrice); supply<threshold emits SHORTAGE.
- Needs: decaying hunger ScalarAttribute raised by a registerTickPhaseHandler (%N, INV-16 isPlayer-aware); eating = removeItems(food,1)+adjustAttributeBase(hunger,-1); scorer folds hunger into buy utility. True Need registry deferred.
- Debt (transferAttribute refuses base<amount world.ts:704): offer_loan transferAttribute gold THEN adjustAttributeBase debt; interest+deadlines via registerDayAdvanceHandler + module-scope debtLedger Map (reconstructed-from-events, crime imprisonmentTimers precedent step-handlers.ts:48); interest via addAttributeModifier category 'interest'; missed deadline emits DEBT_DEFAULT; relation = DEBT_OWED belief + debtLedger. v1 uses a separate positive debt attribute (negative gold needs min<0); first-class contract object deferred.

### 6. ECONOMY_CG_RULES: ConsequenceRule[] (cg-types.ts:15-36, server-consumed)
- shortage->DEBT_PRESSURE: {trigger:'SHORTAGE',targetMode:'location',conditions:[{op:'attr',field:'hunger',comparator:'>',value:0.6,of:'target'}],consequence:{type:'DEBT_PRESSURE',importance:6,delayDays:0,probability:0.7}}.
- gouging->resentment: {trigger:'PRICE_GOUGING',targetMode:'witnesses',conditions:[{op:'relationship',actor:'target',toward:'subject',comparator:'<',value:0}],consequence:{type:'FRAUD',importance:5,probability:0.5}}.
- stock theft->guild reaction: {trigger:'GOODS_STOLEN',targetMode:'all',conditions:[{op:'faction',value:'merchant-guild',of:'target'},{op:'has_capability',value:'isMerchant',of:'target'}],consequence:{type:'GUILD_ALARM',importance:6}} — economy reacting to a crime event, zero shared code.
- default->grudge: {trigger:'DEBT_DEFAULT',targetMode:'affected',consequence:{type:'PERSONAL_GRUDGE'}}.
- low-funds audit: {op:'attr',field:'gold',comparator:'<',value:10,of:'target'} (exact tested shape attributes.test.ts:158-216).
Use exclusive+priority for competing market reactions.

### 7. Mood / goals
registerEventMoodShifts({TRADE_COMPLETED:+0.1,FRAUD:-0.25,DEBT_PRESSURE:-0.2,DEBT_DEFAULT:-0.15,SHORTAGE:-0.1,PRICE_GOUGING:-0.15}); registerGoalMoodBoost({buy:+0.05,sell:+0.1,collect_debt:+0.1,produce:+0.08}). All in-handler mood via ctx.addMoodModifier (INV-06).

### 8. Requirement checkers (capability-flag based) + finders + enricher
REQUIREMENT_CHECKERS: isMerchant/canProduce (hasCapability), canAfford/hasCapital (getAttributeValue gold vs params.price/minCapital — threading proven genre-neutrality.test.ts:95-103), hasGoodsToSell (inventory.length), hasInputs (countItems), isCreditorOf (debtLedger). POST_TARGET_REQUIREMENT_CHECKERS atMarket (targetLocation==='market-square', genre-neutrality.test.ts:105-112). registerEconomyTargetFinders: TARGET_FINDERS seller/buyer/debtor/debtor_candidate -> {targetId,targetName,targetLocation,extra}. registerTargetEnricher sets extra.priceQuote/itemName/debtAmount (mirror crime index.ts:119-129).

### 9. Step handlers — registerStepHandler(action, async ctx => GoalActionResult|null)
buy_goods/sell_goods/haggle_with/craft_goods/offer_loan/demand_payment/collect_payment. StepExecutionContext (event-registry.ts:386) has no World ref, so NPC-NPC item moves use engine inventory API (crime steal_from precedent step-handlers.ts:228-231); gold via closed-over world.transferAttribute + world.transferItem (atomic). sell_goods emits TRADE_COMPLETED via ctx.onEmitEvent. craft_goods removeItems(inputs)+addItem(output)+adjustAttributeBase. haggle_with may classify('price_negotiation') following sentence_npc (façade wraps acquire/release, INV-01). offer_loan/demand_payment update debtLedger + debt attribute, emit LOAN_GRANTED/DEBT_DEFAULT.

### 10. Directives, IL/trade migration, topics, ticks, event handlers, INV-10 guard
- Directives: registerSecretDirectiveBuilder (debtor hiding insolvency), registerRoleDirectiveBuilder (merchant duty gated hasCapability('isMerchant')), registerBeliefPhrasing.
- IL migration (fill-registry): registerILTradeVerbs(['buy','sell','haggle','browse','barter','price']) (event-registry.ts:886); registerSpeechActs([{act:'trade',trade:true},{act:'negotiate',trade:true}]) (event-registry.ts:861, isTradeSpeechAct reads the trade flag); registerActionVerbs all 8 (INV-10). Move legacy AgentProfile.shop/ShopItem catalog into module data (Map<merchantId,{kind,name,price,desc}[]>) seeding real inventory at world-load + price:KIND attributes; move buy/bribe route logic (routes.ts /api/shop/:m/buy/:item) and speechAct==='trade' shop-injection (server.ts:262/301) into module-owned functions. Engine TradeIntent type (il.ts:140-145) + speechAct correction STAY; only the vocabulary becomes registry data.
- LLM tasks: reuse volition/il/dialogue/npc-dialogue; add price_negotiation only if haggle does structured LLM.
- Topics: TOPIC_SOURCE_REGISTRY.push(tradeTopics,priceTopics,debtGossip) arity-3 + registerTopicGroupMapping({economy:'<group>'}).
- Tick/day: price-drift (%60), need-decay (%N), interest-accrual + market-restock (day-advance), debt-deadline pressure (%N). INV-16 isPlayer-aware; INV-19 absolute gameMinute.
- Event handlers: TRADE_COMPLETED->adjustTrust+, FRAUD->adjustSentiment-+spread, DEBT_DEFAULT->grudge belief + triggerReactiveEvaluation (INV-18 adjust*, not direct mutation).
- Self-validation (INV-10): after AFFORDANCE_REGISTRY.push, loop ECONOMY_AFFORDANCES and warn if getAffordanceIdsForVerb(verb).length===0 for any actionVerb.
- Re-exports: index.ts re-exports {ECONOMY_CG_RULES} + data the server/world-loader/tests pull.

### INV-14 verdict
Every item is a register*() call or a push into an exported array/Map. The engine names no economic concept; it iterates opaque registries and checks boolean flags. shortage->desperation->smuggle and GOODS_STOLEN->GUILD_ALARM run on the unchanged crime machinery — the universal-engine thesis holds for economics.
