# Economy Module — Reusable-Substrate Map (engine, AS-IS)

The engine already ships a tested economic substrate. An Economy/Trade module reuses it with **zero engine edits** (INV-14). Below: each primitive, exact symbol/API, and how the module wires to it. All paths under `C:\Ledevia\Projects\CLWA`.

## 1. Money & quantified state — ScalarAttribute (B1)
`packages/engine/src/attributes.ts`
- `interface ScalarAttribute { base; min; max; modifiers: AttributeModifier[] }`
- `interface AttributeModifier { id; source; category; magnitude; remaining; duration; decay:'exponential'|'linear'|'none' }`
- `attributeEffective(attr) = clamp(base + Σ modifierEffective(m), min, max)`; `modifierEffective` applies the decay ratio (exponential = ratio², linear = ratio).
- `createAttribute(base, min=-Inf, max=Inf)`; `getAttributeValue(attrs, key)` -> effective | undefined; `decayAttribute(attr, dtMinutes)` ages/evicts modifiers.

**World API** (`world.ts` 658-708): `getAttribute`, `setAttribute(id,key,base,min,max)`, `adjustAttributeBase(id,key,delta)` (permanent, auto-declares at 0, returns new effective), `addAttributeModifier(id,key,mod)` (NaN/Infinity-guarded), `transferAttribute(from,to,key,amount)` — **atomic & conserved, debits `base` not `effective`** so a temporary +modifier can't be minted into permanent wealth (explicit conservation guard, tested).

**Tick**: `world.ts` ~589 decays every agent's attributes every 5 game-min (real tick only), same cadence as mood — free time-based economic decay (debt interest, expiring buffs).

**Module usage**: declare gold `world.setAttribute(id,'gold',N,0,MAX)`; sale = `transferAttribute(buyer,seller,'gold',price)`. Crime's `heat` is belief-derived (`heat.ts`), so **gold is the first real module consumer** of ScalarAttribute — but it is fully covered by `tests/attributes.test.ts`.

## 2. Economic decisions inside volition — SCORING_CONTRIBUTORS
`packages/engine/src/al.ts`
- `type ScoringContributorFn = (aff, agent) => number`
- `registerScoringContributor(fn)` / `getScoringContributors()` / `clearScoringContributors()` (test teardown).
- `computeUtility()` **step 6** sums every contributor into the raw affordance score (alongside personality/mood/relationship/belief/trust channels), then clamps [0,1].

**This is the hook to make economic state drive NPC choices.** Gate the contributor on `aff.id`/`aff.category` to scope it. Proven in `attributes.test.ts`: a contributor returning `debt*0.5` makes a debt-0.8 NPC score `eco_smuggle` at 0.40 vs 0.0 for a solvent NPC.

## 3. Goods — Inventory (B2)
`packages/engine/src/inventory.ts`
- `interface Item { id; kind(free string); quantity; state?:Record<string,unknown> }`
- `addItem` **stacks** fungible kinds (no `state`), new instance for state-bearing; `removeItems` returns false if insufficient and splices empty stacks; `countItems` sums by kind.

**World API** (`world.ts` 739-777): `getInventory`, `countItem`, `hasItem(id,kind,qty)`, `giveItem(id,kind,qty,state)`, `removeItem`, `transferItem(from,to,kind,qty)` — **atomic** (remove-then-give, no-op on shortfall). Crime-justice **already** calls `addItem/removeItems/countItems` directly in `step-handlers.ts` (theft moves the stolen item) — the precedent for economy step handlers.

## 4. Collectives & rank — Factions + Standing (B3)
- `AgentState.factions?: string[]`; `world.ts` 712-734: `isFactionMember`, `joinFaction` (idempotent), `leaveFaction`, `getFactions`. Open keys: `merchant-guild`, `smuggler-ring`, `trade-coalition`.
- Per-faction/agent **standing** is a separate axis on relationships: `RelationshipGraph.adjustStanding(targetId,delta)` clamps -1..1 (`relationships.ts` 104-109), field `rel.standing`. The bribe endpoint already drives it (`adjustStanding('magistrate',-0.08)` to corrupt justice).

## 5. Roles — open capabilities map
`AgentProfile.capabilities?: Record<string,boolean>` + `hasCapability(profile,key)` (`agent-types.ts` 118). Economy declares `isMerchant`/`canAudit`/`canGrantFavor` with no engine edit (asserted in `genre-neutrality.test.ts`).

## 6. CG gating — attr / faction / has_capability ops
`cg-types.ts` `RuleCondition.op` ∈ {…,'attr','faction','has_capability'}; `comparator` for numeric. `cg-engine.ts` `evaluateFilter` (280-303):
- `attr` -> `getAttributeValue(state.attributes, field)` vs `value` (undefined attr ⇒ never matches);
- `faction` -> `state.factions.includes(value??field)`;
- `has_capability` -> `hasCapability(profile, value??field)`.

Economy: `{op:'attr',field:'gold',comparator:'<',value:10,of:'target'}` (relief-for-poor / audit-the-broke), `{op:'faction',value:'merchant-guild'}`, `{op:'has_capability',value:'isMerchant'}`. All tested in `attributes.test.ts`.

## 7. Affordance gating — REQUIREMENT_CHECKERS
`al.ts`. `AffordanceRequirement` has universal gates (`period`,`moodBelow`,`sentimentBelow`,`maxWitnesses`,`beliefConfidence`) **plus** an open `[key:string]:unknown` resolved via `REQUIREMENT_CHECKERS` (pre-target) and `POST_TARGET_REQUIREMENT_CHECKERS` (post-target). `checkRequirements()` runs universal gates → `findTarget` → registry checkers; the **whole requirement object** is passed as `params`, so a key carries its own value (`minCapital:50`, `atMarket:true`). Module: `REQUIREMENT_CHECKERS.set('minCapital',fn)` in its index. Proven via `eco_defraud` + `minCapital`/`atMarket` in `genre-neutrality.test.ts`.

**AffordanceDefinition / StepTemplate / StepExecutionContext** (al.ts / event-registry.ts 386): declarative steps (`action`,`location:'$target'`,`emitEventType`,`beliefTransfer`); step ctx exposes `owner`+`agents` Map (mutate inventory directly, crime precedent), `onEmitEvent` (emit TRADE/FRAUD), `goalManager`, `addMoodModifier`. Note: step ctx has **no World ref** — NPC-side economic transfers mutate `agent.state` via `addItem/removeItems`; the server-side trade flow uses World directly.

## 8. Event / belief / goal registries
`event-registry.ts`: `registerEventCategory('economy',['TRADE','FRAUD','SMUGGLING'])`, `registerEventLabels`, `registerEventTypeFlags/Batch` (`EventTypeFlags{transferable,informationOnly,subjectReacts,decayRate}` — **INV-08**: events are invisible to beliefs/CG/transfer without flags), `registerActionVerbs` (**INV-10**: LLM constrained decoding blocks unregistered verbs like 'buy'/'sell'), `registerSourceFlags` (**INV-09**), `registerBeliefCreator`/`registerBeliefPhrasing`, `registerStepHandler`. `genre-neutrality.test.ts` registers FRAUD `transferable:true` and confirms the gossip/belief pipeline works for a non-crime event. Emergent-motive pattern (crime's THEFT_DISCOVERED -> victim REVENGE_DESIRE) reusable for FRAUD_DISCOVERED.

## 9. Persistence — already covered
`world.ts` `toJSON` (1880-1882) serializes attributes/factions/inventory when present; `loadState` (1980-1993) re-validates: attributes re-clamped via `createAttribute` + finite-modifier filter, factions string-filtered, inventory dropped if quantity non-finite/≤0 (SL-07). Economy state round-trips with no module work.

## 10. Slated to MIGRATE into the module (substrate already ready)
- **Legacy shop catalog**: `AgentProfile.shop?: ShopItem[]` / `ShopItem{id,name,price,description}` (`agent-types.ts`). `world-loader.ts` ~294 already seeds merchant stock into **real inventory** (one stack qty 8 per shop entry, `item.kind = shop id`), keeping prices on `profile.shop`. The **working** trade endpoint `POST /api/shop/:m/buy/:item` (`routes.ts` 618-638) checks `countItem`+`getAttribute('gold')` then `transferAttribute`+`transferItem`. `POST /api/bribe/:target/:amount` (640-663) does gold transfer + venality-scaled sentiment/trust + justice-standing corruption. **Migration = move the catalog/price model and buy/bribe orchestration into the economy module; the engine primitives stay byte-for-byte the same.**
- **Legacy IL TradeIntent**: `interface TradeIntent{category?,itemName?}` on `DialogueMeaning.tradeIntent` (`il.ts`). `isTradeSpeechAct`, `getILTradeVerbs()`/`registerILTradeVerbs()`, `IL_TRADE_VERB_SET` (registered dynamically — no hardcoded verbs in engine), and the speechAct-correction logic (tradeIntent overrides hallucinated `requestedAction`) all exist. `server.ts` 262/301 injects the shop catalog into the player message on `speechAct==='trade'`. **Migration = module owns the trade verbs + shop-injection; the IL extraction substrate already lives in the engine.**

## Bottom line
Every economic mechanic the module needs — money, conserved goods, atomic trades, guilds, standing, merchant roles, economic CG gates, gold-driven volition, economic events/beliefs, persistence — is already an engine primitive with a tested API. The genre-neutrality test is the live proof that registering an Economy module requires **no engine code changes**. The module's real work is: (a) author the trade/fraud/smuggle affordances + step handlers, (b) register economy events/verbs/capabilities/requirement-checkers, (c) move the legacy `shop`/`ShopItem` catalog and IL trade-injection out of the server into the module, and (d) register a SCORING_CONTRIBUTOR so wealth/debt influence NPC decisions.