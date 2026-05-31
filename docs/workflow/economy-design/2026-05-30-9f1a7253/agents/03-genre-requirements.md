# Economy/Trade Genre — Mechanic Surface vs Engine Concept Mapping

> Source-verified against current `packages/engine/src` (not just prior docs). The prior generalization-survey (2026-05-29, run `3d7ddc1c`) and economy-probe / re-probe (`28aeb820`, `722c8d77`) predate the M5 work; their headline gaps (quantified state, inventory, factions, capability registry, AffordanceRequirement open-bag) are **now FILLED**. What remains are a smaller set of genuine economy-specific gaps + the still-resident legacy trade plumbing.

## Bottom line
~70-85% of a believable living economy maps to **existing engine primitives with zero engine change**. The behavioral physics (PM utility scoring, CG cascades, beliefs, mood, goals/steps, bilateral player) is genuinely universal — economy-probe rated a trading village ~85-93% module-only. The hard wall the prior survey named ("**NO quantified-state primitive anywhere in the engine**") is **gone**: M5 added scalar attributes (B1), inventory (B2), factions (B3), and the scoring-contributor channel. The genuine remaining gaps are about economic *dynamics and instruments*, not *state*.

## Full mechanic surface → engine concept

### 1. Dynamic pricing (supply/demand) — GAP (law), substrate exists
- Price today = static `AgentProfile.shop` → `ShopItem.price` (agent-types.ts:112,122-127): read-only number, no quantity, no demand.
- Substrate: a good's price can be a `ScalarAttribute` (e.g. `price:bread`); supply = `countItem` over inventory; CG can gate on `attr` `<` threshold.
- **Missing**: the *pricing law* (price = f(supply, demand, scarcity)) and *base-value drift over time*. `decayAttribute` (world.ts:591, called per tick) decays only temporary **modifiers**, never base. So price evolution must be a module `registerTickPhaseHandler` calling `adjustAttributeBase`. Engine gives slots + tick hook, not the law.

### 2. Production over time — REUSABLE (module-side)
- `produce` affordance (OCEAN+H weights, e.g. high-Conscientiousness) → `STEP_HANDLER` → `World.giveItem` (output) + `adjustAttributeBase`/`removeItem` (inputs). Periodic background = `registerTickPhaseHandler`. Profession gate = `hasCapability`; guild = faction. Recipe = module data. No engine concept missing except a recipe primitive (acceptably module data).

### 3. Consumption over time / Needs — GAP (no Need primitive), fakeable
- Confirmed absent: no `Need` type, no `NEED_` registry (grep). Documented MISSING in generalization-survey agent 05.
- Fakeable: a decaying `ScalarAttribute` (`hunger`) + per-tick module decrement, feeding `computeUtility` via `registerScoringContributor` (al.ts:486) so critical need boosts buy/eat utility. Substrate present; **first-class Need primitive (definition registry, item-satisfaction link, criticality curve) is the gap.**

### 4. Trade affordance: buy/sell — EXISTS (partly engine-resident, leak)
- Execution: `transferItem` (goods) + `transferAttribute` (gold), both **atomic & conservation-guarded** (world.ts:695-777). NPC-side = affordance + `registerActionVerbs('buy','sell')` (INV-10) + step handler.
- Player-side already plumbed **inside the engine**: IL `TradeIntent` (il.ts:141-146), `tradeIntent` schema (il.ts:73), semantic correction (il.ts:276-301), hardcoded prose (il.ts:202). This is a documented **crime-assumption-leak** (trade baked into engine instead of module-registered).

### 5. Haggle / negotiate / counteroffer — GAP
- Partial: open `EmotionalPressure.type` (il.ts:134-139) can carry `lowball`/`price-gouge`; dialogue handles back-and-forth; sentiment/trust modulate willingness.
- **Missing**: multi-round offer/counteroffer state, reservation price, agreed clearing price. Economy-probe: "extending trade semantics (negotiation, counteroffers, contracts) means editing engine il.ts" — pending TradeIntent module-lift.

### 6. Wealth — EXISTS (the filled headline gap)
- Gold = `ScalarAttribute` on `AgentState.attributes` (B1). World `getAttribute/setAttribute/adjustAttributeBase/addAttributeModifier` (world.ts:659-693). Sale = `transferAttribute(buyer,seller,'gold',price)` (atomic, refuses if base<amount, world.ts:700-708). Persisted in save.json. Exactly the "new-universal-capability" the economy-probe demanded.

### 7. Debt / credit / loans / contracts — GAP
- `transferAttribute` refuses negative (no overdraft). No promissory/contract/obligation object, no interest, no due-date, no default trigger.
- Partial workaround: gold attr with `min=-Infinity` + a `DEBT_OWED` belief + a CG non-payment rule + absolute-gameMinute cooldown (INV-19). **But no first-class contract instrument** linking creditor/debtor/amount/due-date/default. Lending *motive* maps fine (affordance + scoring contributor); the *instrument* is the gap.

### 8. Scarcity / shortage — REUSABLE
- Scarcity = low aggregate `countItem` or depleted resource attr. CG reacts via `attr` op `<` threshold (cg-engine.ts:292-303) → SHORTAGE cascades. Only gaps: the price-response law (see #1) and a **world-level (non-agent) resource pool** (attributes/inventory are per-agent; a town grain reserve needs a synthetic agent or module structure).

### 9. Professions / roles / production-chains — EXISTS
- Profession = open capability flag (`hasCapability`), read by CG `has_capability` (cg-engine.ts:284-286) and `REQUIREMENT_CHECKERS`. Guild = faction. Role-gated affordance = requirement checker. Generic capability registry was a documented gap — **now filled**.

### 10. Markets / venues / stalls — REUSABLE
- Market = `LocationDef`; venue gate = `atLocation` requirement checker. Persistent market-stall/contested-territory marker = generalized `SceneResidue` (formerly CrimeScene, A9; `sceneType` free string; world.ts `markSceneResidue`). Slug-vs-display discipline (INV-11).

### 11. Economic motives/goals (buy/sell/hoard/lend) — EXISTS (strongest fit)
- `computeUtility` (al.ts:447-491) genre-agnostic: greed = low-Honesty/low-Agreeableness weights + moodWeight + rival-sentiment relationshipWeight. **Key channel**: `registerScoringContributor` (al.ts:439, invoked 486) injects need+price+wealth straight into utility → buy/sell/hoard/lend emerge organically. LLM (volition) makes final DO/WHY choice (no reflex bypass). Validates the universal-engine thesis for economics.

## Primitives already in the engine (M5 — the filled gaps)
| Primitive | Location | Prior-doc status |
|---|---|---|
| ScalarAttribute / AttributeModifier (B1) | attributes.ts; AgentState.attributes; World.get/set/adjust/addModifier/transferAttribute (world.ts:656-708) | was "biggest vision gap" → FILLED |
| Inventory (B2) | inventory.ts (Item); AgentState.inventory; World.getInventory/give/remove/transferItem (world.ts:737-777) | was MISSING → FILLED |
| Factions (B3) | AgentState.factions; World.join/leave/isFactionMember (world.ts:710-735); CG `faction` op | was MISSING → FILLED |
| Open capabilities + hasCapability | AgentProfile.capabilities; hasCapability(); CG `has_capability` (cg-engine.ts:284) | was crime-hardcoded → FILLED |
| CG attr/faction ops + comparators | cg-engine.ts:284-303; cg-types.ts:41 | NEW |
| registerScoringContributor | al.ts:437-445, used al.ts:486 | NEW (B1 wiring) |
| AffordanceRequirement open-bag | al.ts `[key:string]:unknown` + REQUIREMENT_CHECKERS | "single biggest INV-14 leak" → FILLED (A5) |

## Remaining gaps (ranked for the economy module)
1. **Dynamic-pricing / market-clearing law** + base-value drift (engine has tick hook, not the law).
2. **Needs/Resources subsystem** — no `Need` primitive (fakeable via decaying attr + scoring contributor).
3. **Debt/contract/obligation instrument** — no negative-balance/loan/credit/due-date construct.
4. **Legacy engine-resident trade plumbing pending migration**: `AgentProfile.shop`/`ShopItem` (static, no quantity/balance) and IL `TradeIntent`/schema/prose (il.ts:73,141-146,202) — documented **crime-assumption-leak**; the economy module should migrate shop→inventory+price-attr and lift TradeIntent into a module-registered intent kind.
5. **Per-tick economic timer**: not missing but note — all time-evolution rides on `registerTickPhaseHandler` (event-registry.ts:696); engine has no economic dynamics built in.
6. **Module-authoring tooling** (declarative manifest) — documented low-priority gap; write economy as TS mirroring `social/index.ts`.

## Reconciling with prior docs
- generalization-survey (3d7ddc1c) listed Inventory/Needs/Factions/capability-registry/AffordanceRequirement as MISSING. **Of these, only Needs survives as a true gap** — Inventory, Factions, capability registry, and the AffordanceRequirement open-bag are now in source (M5 + Phase A).
- economy-probe (28aeb820) forcedEngineChanges: the **new-universal-capability** (persistent mutable wealth/inventory/ownership + atomic transfer) is **done**. Its four **crime-assumption-leaks** — typed AffordanceRequirement fields (DONE/A5), CrimeScene→generic marker (DONE/A9), `crimeEvent` channel naming (cosmetic), and **IL TradeIntent (STILL resident)** — only the TradeIntent + ShopItem leak persists as economy-relevant.
- re-probe (722c8d77) re-rated the trading genre **8.5/10 occasional-engine, 93% module-satisfiable**, with the residual being deferred crime subsystems (PlayerJournal A10, IL accusation/evidence A4b) that a peaceful economy never trips — **not economy gaps**.