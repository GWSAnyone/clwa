# Economy/Trade Module — Composition, Boundary, Scenarios, Metrics, Phased Plan

Grounded against current source. Key seams verified: `World.transferAttribute` conservation guard (world.ts:699-707), `computeUtility` scoring-contributor loop (al.ts:486), `ConsequenceEngine(rules[], opts)` flat-array constructor (cg-engine.ts:27) wired once in server `index.ts:776`, the IL trade leak (il.ts:73/141-154/202/225/231), the working trade endpoints (routes.ts:618-659), and the INV-14 architecture lint (`tests/architecture.test.ts`, CRIME_PROSE at line 123 with self-test at 156).

---

## 1. COMPOSITION — how Economy meets Crime-Justice

Crime and Economy **never import each other**. They compose on three engine buses that are already genre-neutral:

### Bus A — World value primitives (theft/smuggling/fraud move REAL value)
- Crime's `steal_from` step handler already mutates inventory via `addItem/removeItems/countItems` (step-handlers.ts precedent). The stolen `Item` is the **same** object an economy seller owns, and the gold a thief covets is the **same** `ScalarAttribute` a merchant accumulates.
- Therefore theft = a crime affordance that removes value an economy actor created; smuggling = transferItem of goods whose price is set by the economy pricing law; fraud = a "sale" step handler that transfers buyer gold but withholds the item (a deliberately broken `transferItem`).
- Conservation is guaranteed: `transferAttribute` debits **base** not effective (world.ts:702-705), so a thief cannot mint gold via a +modifier — value is conserved across both genres.

### Bus B — Belief / gossip bus (economic reputation spreads like crime rumor)
- `FRAUD`, `PRICE_GOUGING`, `HOARDING` register via `registerEventCategory/Labels` + `registerEventTypeFlagsBatch({transferable:true})` (INV-08). They then flow through the **same** gossip pipeline as `RUMOR_SPREAD` (genre-neutrality.test.ts already proves FRAUD gossips).
- `registerBeliefCreator('FRAUD_DISCOVERED', …)` + `registerMemoryTextBuilder` make a victim believe "merchant X cheated me" — which can feed an emergent `REVENGE_DESIRE` motive (crime's exact emergent-motive pattern, subsystem-reference Beliefs&Motives).

### Bus C — CG cascade bus (debt/scarcity → desperation → crime)
- The server constructs **one** `ConsequenceEngine` over a single flat `ConsequenceRule[]` (index.ts:776). Composition = server passes `[...CRIME_CG_RULES, ...ECONOMY_CG_RULES]`. This is a **server wiring change, not an engine change**.
- Cross-module rule lives in `ECONOMY_CG_RULES` and is the hinge:
  `{ trigger:'DEBT_DEFAULT', targetMode:'subject', conditions:[{op:'attr',field:'gold',comparator:'<',value:5,of:'subject'}], consequence:{ type:'<theft/revenge motive>', importance, delayDays, probability } }`.
  The trigger is an **economy** event; the consequence seeds a **crime** motive — desperation-driven crime emerges, neither module naming the other.
- CG v2 already has `attr`/`faction`/`has_capability` ops (cg-engine.ts:284-303), so rules can gate on a gold attribute or a guild faction with zero engine change — the live INV-14 proof.

### Markets as crime venues
- Market = `LocationDef`; a persistent stall/black-market site = generalized `SceneResidue` (free `sceneType` string). An `atMarket` `REQUIREMENT_CHECKER` gates both legitimate `buy`/`sell` and illicit `smuggle`/`fence` affordances at the same location — the venue is shared, the affordances differ by capability flag.

### Crime stays a passing regression oracle
Economy only **adds** registry entries and **concatenates** CG arrays. It never edits `CRIME_AFFORDANCES`, `CRIME_CG_RULES`, crime step handlers, or crime event flags. After P0's pure refactor (below), the full crime test suite (architecture, cg-v2, heat, regression, boot-smoke, save-load) must remain green at every phase — that is the explicit acceptance gate.

---

## 2. BOUNDARY (INV-14) — the engine must never learn "trade"

### Current state: engine is clean for crime, NOT clean for trade
- `tests/architecture.test.ts` `CRIME_PROSE` (line 123) bans murder/crime/arrest/theft prose in engine string literals; self-test at line 156 even asserts `'the merchant sold grain at the market'` ⇒ `false`. So economy prose is the designated SAFE case — but there is **no symmetric guard** that trade vocabulary stays out.
- **Live leak 1 — IL TradeIntent**: `il.ts:141-154` defines `interface TradeIntent` + `DialogueMeaning.tradeIntent`; `il.ts:73` a hardcoded `tradeIntent` schema branch; `il.ts:202/225/231` the English prose `'"trade" = player wants to buy, sell, browse goods, or ask about prices'`. The engine literally knows the word "trade". Trade is the ONLY intent kind not data-driven — `speechActs`, `pressureTypes`, `claimSources`, `questionTopics` are all already module-registered via `getRegistered*()`.
- **Live leak 2 — AgentProfile.shop / ShopItem**: `agent-types.ts` carries `shop?: ShopItem[]` and `ShopItem{id,name,price,description}` — a crime-era domain concept resident in the engine. Server `routes.ts:618-659` already does the real transfer on engine primitives; only the catalog/display + IL injection remain to migrate.

### Leakage risks while building Economy (and how to avoid)
| Risk | Avoidance |
|---|---|
| Hardcoding "buy"/"sell"/"haggle" anywhere in engine | All action verbs via `registerActionVerbs` (INV-10); engine reads `ACTION_VERB_MAP`, never a literal |
| A typed `isMerchant?: boolean` field creeping into `AgentProfile` | Use the open `capabilities` map + `hasCapability` (Design Philosophy #1); architecture.test.ts already bans typed crime-capability fields (line 206) — extend the FORBIDDEN list to trade ones |
| Pricing/needs logic landing in `world.ts` decay | Pricing law lives in a module `registerTickPhaseHandler`; `decayAttribute` (world.ts:591) stays generic, decays only temporary modifiers |
| TradeIntent staying in il.ts and being "extended" for negotiation | P0 lifts TradeIntent into a registered intent kind FIRST, so negotiation/contracts become module data, not engine edits |
| Engine fallback strings like `?? 'trade'` | INV-15 — registry returns null ⇒ skip/throw, never a domain fallback |

### Required boundary work (mechanical)
1. Generalize `tradeIntent` → a module-registered intent (mirror `registerSpeechActs`); move trade prose behind a `registerILIntentProse`-style hook.
2. Migrate `shop`/`ShopItem` out of `agent-types.ts` into the economy module (inventory + `price:<good>` attributes already back it).
3. **Add `TRADE_PROSE` guard** to `tests/architecture.test.ts` (regex on sell/haggle/debt/merchant/invoice + self-test), making the universal-engine thesis a bidirectional CI oracle.

---

## 3. EMERGENT STORY SCENARIOS (capabilities, not scripts)

1. **Price war / undercutting** — two merchants with low-Honesty/low-Agreeableness weights both run `sell` at a market; the loser's `standing` drops; a `registerScoringContributor` reading the price gap makes the rival undercut further. Rival resentment via CG `UNDERCUT` rule.
2. **Hoarding / artificial scarcity** — a high-Conscientiousness/low-Agreeableness NPC runs `hoard`; aggregate `countItem('grain')` across agents falls; a CG `attr`-comparator rule fires `SHORTAGE` → panic-buying mood + price spike.
3. **Debt spiral → crime** — NPC borrows (`lend` affordance, gold attribute min<0); `registerDayAdvanceHandler` accrues interest; on `DEBT_DEFAULT` the cross-module CG rule (Bus C) seeds a theft/revenge motive — **economy causes crime**.
4. **Smuggling ring** — `smuggler-ring` faction + `isSmuggler` capability gate a `smuggle` affordance moving high-price goods past an `atMarket` check; guard belief + crime's pursuit machinery activate if witnessed.
5. **Fraud + reputation collapse** — a `sell` step handler that withholds the item emits `FRAUD`; victim belief gossips (Bus B); merchant `standing` and trust collapse across the town; buyers avoid them (negative scoring contributor).
6. **Famine-driven theft** — a decaying `hunger` attribute feeds a scoring contributor; when critical it boosts `buy`/`eat`, and if gold is insufficient, boosts crime's `steal_from` — "steals because family starving" (the documented vision gap, now serviceable).
7. **Bribery/corruption hinge** — existing `/api/bribe` (routes.ts:640-659) generalized into a `grant_favor` affordance: gold buys a guard's `standing` and suppresses a wanted status — economy bends crime justice.
8. **Guild monopoly backlash** — a `merchant-guild` faction corners a good; CG `monopoly→community_anger` rule lowers town sentiment toward guild members.

---

## 4. SUCCESS METRICS (how we know it works)

- **Prices move**: `getAttribute(merchant,'price:grain')` base changes over ≥N ticks in response to `countItem` supply swings (not static like the old `ShopItem.price`). Assert non-zero variance over a sim run.
- **NPCs make economic decisions autonomously**: volition logs show NPCs selecting `buy/sell/hoard/lend` via `computeUtility` (scoring contributor non-zero), not just player-triggered `/api/shop`. Count economy-affordance executions/day > 0.
- **Scarcity emerges, not seeded**: a `SHORTAGE` CG consequence fires from low aggregate inventory without any scripted trigger.
- **Value is conserved**: total gold + (Σ goods × reference price) across all agents is invariant under transfers (transferAttribute/transferItem are conserved) — assertable in a test.
- **Cross-module causation observable**: at least one `DEBT_DEFAULT`→crime-motive cascade in a multi-day run (CG chain log).
- **Boundary holds**: `bun test` architecture suite green WITH the new `TRADE_PROSE` guard; `genre-neutrality.test.ts` still passes; engine contains zero "trade"/"sell"/"haggle" literals.
- **Regression oracle intact**: full crime-justice suite (cg-v2, heat, regression, boot-smoke, save-load) green at every phase.
- **Persistence**: economy state (attributes/factions/inventory) survives save→load (world.ts toJSON 1880-1882 / loadState 1980-1993 already handle it) — assert round-trip in save-load.test.ts.

---

## 5. PHASED PLAN (engine primitives first, then module content — regression-safe)

**P0 — Close the engine leaks (pure refactor, no new behavior).** Lift `TradeIntent`/trade prose out of il.ts into a module-registered intent kind; migrate `shop`/`ShopItem` out of `agent-types.ts`; add the `TRADE_PROSE` guard to `tests/architecture.test.ts`. Gate: all existing tests green; engine has zero trade literals. *Why first:* otherwise every economy extension would require editing engine il.ts, and the boundary oracle wouldn't catch leaks.

**P1 — Economy module skeleton + server merge.** `packages/modules/src/economy/index.ts` with idempotent `registerEconomyModule()` (registers `economy` event category TRADE/FRAUD/DEBT_DEFAULT with flags, action verbs, source flags) + exported `ECONOMY_CG_RULES`; server merges `[...CRIME_CG_RULES, ...ECONOMY_CG_RULES]` into `new ConsequenceEngine(...)` and calls `registerEconomyModule()` at boot. Gate: boot-smoke + genre-neutrality green; crime untouched.

**P2 — Trade affordances + economic decisions.** `buy/sell/haggle` affordances (data), target finders (buyer/seller), `REQUIREMENT_CHECKERS` (canAfford/hasStock/atMarket), step handlers using `transferItem`+`transferAttribute`, and a `registerScoringContributor` folding wealth/price into utility. Gate metric: NPCs autonomously execute trade affordances.

**P3 — Dynamic pricing + Needs (the real gaps).** `pricing.ts` (heat.ts analog) drives `price:<good>` base via `registerTickPhaseHandler` reading supply/demand; `hunger` decaying attribute feeds a scoring contributor. Gate metric: prices move; scarcity emerges.

**P4 — Debt/contract instrument + cross-module CG.** `lend`/`settle_debt` affordances, `DEBT_OWED` belief, negative-min gold attribute, `registerDayAdvanceHandler` interest, and the `DEBT_DEFAULT`→crime-motive cross-module rule (Bus C). Gate metric: at least one debt→crime cascade in a multi-day run; crime suite still green.

**P5 — Markets-as-venues + smuggling/fraud rings.** `smuggler-ring`/`merchant-guild` factions, `smuggle`/`fence`/`defraud` affordances gated by capability + SceneResidue market markers; FRAUD reputation gossip + revenge composition. Gate: scenarios 4-8 reproducible; conservation + boundary tests still pass.

Each phase ends with `bun test` + `bun x tsc --noEmit` (0 errors) and a save/load round-trip check.