# Economy/Trade module (M7) — design workflow synthesis

6 agents, 2 phases (Survey → Design). Produced the analysis behind `docs/specs/SPEC-economy.md`.
Per-agent reports: `agents/01..06-*.md`. Full structured return: `raw.json`.

## Headline
The CLWA engine **already contains a complete, tested economic substrate** (M5/Phase-B: scalar attributes, inventory,
factions, capabilities, CG `attr`/`faction`/`has_capability` ops, `registerScoringContributor`). **~75–85 % of an economy
maps to existing primitives with zero engine edits** — proven live in `tests/genre-neutrality.test.ts`, which already
registers a non-crime "economy" genre through the identical registration functions crime-justice uses.

→ **v1 of the Economy module is almost pure module content + one mandatory engine cleanup (P0).** No new engine primitives
are required for v1; pricing/needs/debt are achievable module-side (tick handlers + a positive `debt` scalar).

## The 3 "gaps" (all universal, none economy-vocabulary — and all optional for v1)
1. **AttributeFlow** — generic per-tick base drift (`decayAttribute` only decays modifiers). v1 routes around it with a
   module `registerTickPhaseHandler` + `adjustAttributeBase`.
2. **Signed/negative-balance transfer** (`allowNegative` + `min<0`) — `transferAttribute` refuses base<amount → blocks loans.
   v1 routes around it with a separate positive `debt` scalar.
3. **`INTENT_KIND` registry** — likely unnecessary; the existing `registerILTradeVerbs` / `registerSpeechActs` hooks suffice.

## The 1 mandatory engine touch (P0, a cleanup not a capability)
The engine is **not** genre-neutral for trade today: hardcoded `"trade" = buy/sell/browse` prose in `il.ts:73,141-154,202`
and `AgentProfile.shop`/`ShopItem` in `agent-types.ts:113,123`. P0 lifts these into the existing IL trade registries +
module data, and adds a symmetric `TRADE_PROSE` guard to `architecture.test.ts`. Pure refactor; crime tests stay green.

## Module content (mirrors crime-justice)
8 affordances (buy/sell/haggle/produce/hoard/lend/collect_debt/smuggle), economy/market/credit event categories with flags,
belief sources/phrasing, a scoring contributor (debt×0.5 + hunger×0.4 → economic affordance utility), module-side pricing
(price:KIND attribute drifted by a tick handler from supply/demand), needs (hunger scalar), debt (positive scalar +
`debtLedger` Map), step handlers, mood/goals/topics, `ECONOMY_CG_RULES`.

## Composition with crime — 3 genre-neutral seams (no module-to-module imports)
Shared World value primitives (theft moves real gold+inventory), shared belief/gossip bus (FRAUD spreads like rumor),
shared CG cascade bus (`SHORTAGE`+hunger → `DEBT_PRESSURE`; `GOODS_STOLEN`+merchant-guild → `GUILD_ALARM`; `DEBT_DEFAULT` →
`PERSONAL_GRUDGE`). Server merges `[...CRIME_CG_RULES, ...ECONOMY_CG_RULES]`. Crime game stays a passing regression oracle.

## Phased plan
P0 close the engine leak (+ TRADE_PROSE guard) · P1 module skeleton + boot/neutrality · P2 trade affordances + scoring
contributor · P3 dynamic pricing + needs (tick handler) · P4 debt/contract + cross-module CG (debt→crime) · P5 markets +
smuggling/fraud rings. Regression-safe: boundary first, content second.

## INV-14 verdict (from the design)
Every economy item is a `register*()` call or a push into an exported array/Map. The engine names no economic concept;
it iterates opaque registries and checks boolean flags. `SHORTAGE→desperation→smuggle` and `GOODS_STOLEN→GUILD_ALARM` run
on the unchanged crime machinery — the universal-engine thesis holds for economics.
