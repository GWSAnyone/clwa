# Economy/Trade Module — Primitive Gap Classification & New-Primitive Design

## Verification note
Every load-bearing claim below was checked against current engine source (not just the survey digest):
`registerScoringContributor`/`SCORING_CONTRIBUTORS` summed in `computeUtility` (al.ts:439/486); `decayAttribute` decays only modifiers (attributes.ts:55-63); `transferAttribute` refuses `base<amount` (world.ts:700-708); CG `attr` op with full comparators + `faction`/`has_capability` (cg-engine.ts:284-303); no `Need`/market/pricing/recipe primitive in engine; `TradeIntent` engine-resident (il.ts:73,141,202,276); `AgentProfile.shop`/`ShopItem` engine-resident (agent-types.ts:113,123).

## Headline
The economy needs **NO mandatory new engine primitive for its core**. ~70-85% maps to verified existing substrate. There are exactly **3 genuine engine gaps**, and the INV-14 discipline is that **all three resolve to GENERIC primitives, none to economy vocabulary**:

| Gap (verified) | Wrong fix (INV-14 violation) | Correct universal primitive |
|---|---|---|
| Attribute base never drifts (attributes.ts:55) | a "market/price" subsystem | generic `ScalarAttribute.drift` + `driftAttribute()` in tick |
| `transferAttribute` forbids negative (world.ts:704) | a "debt/loan" type | `min<0` attributes + `allowOverdraft` transfer; debt CONTRACT stays module |
| `TradeIntent` hardcoded in IL (il.ts:141) | another baked intent branch | `INTENT_KIND` registry (mirrors speech-acts/pressure-types) |

## Classification by requirement
- **reuse-existing (zero engine work):** wealth=ScalarAttribute; goods=Inventory+atomic transferItem; guilds=factions; per-guild standing=scalar; professions=capabilities+hasCapability; economic decision-making=computeUtility + registerScoringContributor (gate on `aff.category==='economic'`).
- **module-content (data filling empty registries):** buy/sell/haggle/lend/smuggle affordances; TRADE/FRAUD/DEBT events+flags+beliefs+gossip; ECONOMY_CG_RULES (gold/faction-gated via existing CG ops — the live INV-14 proof); tick-driven price drift / interest / restock / need decay; **dynamic pricing law** (a `pricing.ts` analog of crime's `heat.ts`); **Needs** (a drifting scalar fed into the scoring contributor — NOT a Need primitive).
- **fill-registry / migrate OUT of engine:** `AgentProfile.shop`/`ShopItem` → module price-attributes + inventory + buy logic; IL trade prose/injection → module (after INTENT_KIND lands).
- **NEW engine primitive (only 3, all universal):** attribute base-drift; signed/overdraft transfer; module-registered intent kinds.

## The three new primitives (designs)

### 1. `ScalarAttribute.drift` (universal)
Add `drift?: { ratePerMinute: number; toward?: number }` to `ScalarAttribute`; add `driftAttribute(attr, dtMinutes)` called next to `decayAttribute` in the world.ts:589 tick loop. `toward` unset = linear unbounded; `toward` set = exponential approach. NaN/Infinity-guarded (SL-07), dt passed so INV-19 holds. Module sets drift on `price:bread`, `debt`, `hunger`. Non-economic proof: HP-regen, radiation decay.

### 2. Signed / overdraft transfer (universal) — unblocks debt
Permit `min<0` attributes (verify `createAttribute`/`setAttribute` don't force min=0) and add `transferAttribute(..., {allowOverdraft})` (or a `lendAttribute` sibling) that may debit the source below zero down to its declared min while preserving conservation. **The debt INSTRUMENT (creditor/debtor/amount/due-date/default→consequence) is 100% module content**: a `DEBT_OWED` belief + an `ECONOMY_CG_RULES` rule firing on default + a module-tracked deadline map reconstructed from events on reload (module-scope mutable state pattern, like crime's `imprisonmentTimers`). Engine only relaxes a clamp; it learns no economic concept.

### 3. `INTENT_KIND` registry (universal) — fixes the crime-assumption-leak
Generalize the hardcoded `TradeIntent` into `registerIntentKind({ key, schemaFragment, promptHint, correctionFn? })`; IL dynamic schema + semantic-correction iterate registered kinds instead of the baked `trade` branch (delete il.ts:73/141/202/276 trade specifics). The economy module registers `trade` (later `negotiate`/`contract`); politics could register `endorse`, combat `challenge`. Speech acts/pressure types/claim sources are *already* module-registered — trade is the lone exception, an INV-15 smell.

## Negotiation/contracts (forward-looking)
Multi-round haggle (offer/counteroffer/reservation/clearing price) has no engine construct and needs none beyond the above: it is module conversation logic + a transient negotiated price in `goal.data`, plus optionally a registered `negotiate` INTENT_KIND. No engine primitive.

## Module skeleton
`packages/modules/src/economy/`: `index.ts` (idempotent `registerEconomyModule()` + re-export `ECONOMY_CG_RULES`), `affordances.ts`, `target-finders.ts`, `cg-rules.ts`, `step-handlers.ts`, `event-handlers.ts`, `topic-sources.ts`, `pricing.ts` (the `heat.ts` analog: supply/demand law + tick handler). Keep the INV-10 self-validation loop (`registerActionVerbs` for buy/sell/haggle/lend). Same shape as crime-justice; engine never imports it.