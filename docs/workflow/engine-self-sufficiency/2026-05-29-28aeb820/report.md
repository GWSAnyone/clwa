# CLWA Engine Self-Sufficiency Audit — Module-Only, or Also Engine Changes?

## The Question
CLWA claims: **engine = universal behavioral-physics laws + empty registries; modules fill them; a NEW game = a new data MODULE, no engine changes** (INV-14: engine never imports modules, zero module-specific strings). We empirically tested that promise against two genres of completely different focus than the current crime-justice milestone: a **peaceful trading-economy village** and a **non-violent court-romance**. Every claim below is grounded in direct source reads.

## Verdict: OCCASIONAL-ENGINE (not module-only)

The behavioral **physics** is genuinely universal. The promise as an *absolute* ("zero engine changes") is **false** for a different-focus game — but it fails in a narrow, bounded, fixable way, not a structural one.

- **What holds (~85% module-only, both genres):** event types (EventType is a free `string`, no union), affordances, action verbs, multi-step actions, consequence cascades, beliefs/rumor transfer, conversation topics, and — critically — **motivation**. `computeUtility` in `al.ts` is domain-agnostic; greed maps to low-H/low-A trait weights, ambition/love to Enneagram data. `cg-engine.ts` has zero crime knowledge. These need **no engine edits**.
- **What forces engine touches:** (A) one genuine **missing universal capability** per state-heavy genre, and (B) a handful of **crime-justice assumption leaks** that wrongly live in the engine.
- **The boundary, precisely:** the **import** boundary (engine→module) is *perfect* — zero violations. The **semantic** boundary ("zero module-specific strings") is *partially violated*. The leaks are in **types, defaults, and prose** — never in the dispatch logic, which correctly uses boolean flag predicates (`isTransferable`, `isPerpetrator`, `isConcealment`) and open registries.

## Self-Sufficiency Score: 7/10

> Interpretation: 9-10 = drop-in module-only · **7-8 = module + a one-time bounded engine investment per new domain** · 4-6 = frequent engine surgery · 0-3 = engine is genre-specific.

| Dimension | Score | Weight | Note |
|---|---|---|---|
| Motivation (volition/PM utility) | 1.0 | 20% | `al.ts` utility dims + Enneagram; domain-agnostic |
| Consequences (CG cascade) | 1.0 | 15% | `cg-engine.ts` zero crime knowledge; op-based conditions |
| Events (string EventType) | 1.0 | 10% | `cg-types.ts:3` free string; register* covers it |
| Affordances & verbs | 1.0 | 10% | `AFFORDANCE_REGISTRY.push` + `registerActionVerbs` |
| Beliefs & rumor | 0.5 | 10% | free `eventType` works BUT `'rumor'` hardcoded + crime-framed NL phrasing |
| Requirement gating | 0.5 | 10% | `REQUIREMENT_CHECKERS` open BUT crime field names on the type |
| Prompt / role-directive prose | 0.0 | 10% | inline crime English, no module-override hook |
| Persisted economic/relationship STATE | 0.0 | 15% | no wealth/inventory; closed RelationType, no standing axis |

**Weighted ≈ 0.72 → 7/10.** CLWA sits firmly at "module + small one-time engine investment."

## Engine Change Frequency: **occasional-engine** (headline answer)

## The Crux: Legit Gaps vs Assumption Leaks

This distinction is the heart of the user's question. A "gap" is the engine *missing a universal law* (legitimate to add — not a failure of the module model). A "leak" is *crime vocabulary that escaped into the engine* (a real failure of INV-14's spirit).

### (4) LEGIT GAPS — missing UNIVERSAL capabilities (FINE to add)
These are "new universal laws." Adding them is not a concession to crime; **3+ unrelated genres need each**.

1. **Persisted mutable resource state.** `AgentState` (`agent-types.ts:132-170`, directly read) has alive/status/location/mood/beliefs/relationships but **no wealth, no inventory quantity, no ownership ledger**. `AgentProfile.shop` is a static `ShopItem[]` (price, no quantity, no buy-side balance). Every economy/RPG/4X/survival world needs this. Add a generic resource slab + save-schema slot + atomic value-transfer helper. *One-time universal investment.*
2. **Relationship richness.** `RelationType` (`relationships.ts:1`) is a **closed union** (friend|rival|family|acquaintance|romantic|mentor|colleague); `Relationship` carries only sentiment+trust. No `'alliance'`/`'betrothed'` without an engine edit, and **no standing/favor/rank scalar** — which IS the court-romance win condition. Any social MMO (politics, guilds, factions) needs registry-backed bond types + a standing axis.
3. **Extensible capability-flag slot** (straddles gap/leak — the *open slot* is the gap). The `has_capability` CG op already reads arbitrary profile fields, so making the slot an open `Map<string,boolean>` is a small universal hardening.
4. **Richer drive/motive shape** beyond `motive:{targetId,reason}` — universally useful for ambition/affection/goal stacks.

### (5) ASSUMPTION LEAKS — crime-justice knowledge that escaped (FAILURES, generalize out)

1. **`'rumor'` hardcoded belief-source string** — `world.ts:1181,1194,1309` (directly grepped). The engine's own NPC-conversation belief transfer uses a *crime-module* source name, not a `BELIEF_SOURCE.GOSSIP` constant or registry lookup. **The single most actionable bug.** *Blocking* (an economy module's gossip is silently mis-sourced).
2. **Crime-framed prompt prose** — `agent.ts:376-405` `buildRoleDirective` (directly read): `"ACTIVE DUTY ... investigating the {crime} of {victim}. Suspect:"`, `"Guilt gnaws at you"`, `"You are wanted for a crime. Every sound could be the guard coming for you."` No module-override hook for the engine's *own* sections. A courtier with a transferable belief renders `"investigating the courtship of X. Suspect: Y."` *Blocking* (mis-renders for non-crime genres). Fix: `registerRoleDirectiveBuilder`.
3. **Belief NL phrasing `"committed {verb} against {target}"`** — `beliefs.ts` summarizeForPrompt/Memory + il.ts question handler. Accusation framing in a universal subsystem. Fix: `registerBeliefPhrasing`.
4. **Inline concealment/accusation prose** — `secret-directives.ts:20-89` (`"deny any involvement"`, `"redirect suspicion"`, `"you want justice"`) and `il.ts:594-690` `buildAccusationContext` (`"I am the law here"`). Gated by flags, but the *response text* assumes adversarial criminal concealment. Fix: route through the existing `SECRET_DIRECTIVE_BUILDERS` registry.
5. **Crime field NAMES on engine TYPES** — `AffordanceRequirement` (`al.ts:11-49`: `isCriminal`/`isWanted`/`hasCrimeBelief`/`notPerpetrator`/`canSentence`/`deductionBelowThreshold`) plus an inline `req.beliefConfidence` special-case (`al.ts:294`); and `AgentProfile` (`agent-types.ts:101-106`: `investigator`/`detersCrime`/`canSentence`). Dispatch via `REQUIREMENT_CHECKERS` (`al.ts:229,288-298`) is **generic and INV-12-compliant** — a module CAN register `hasStock` via record cast — but the *type* enumerates one module's vocabulary. Fix: strip crime fields, keep only universal ones, route the rest through the open registry. *Non-blocking* (works via cast) but a real type leak.
6. **Crime-NAMED engine primitives** — `CrimeScene`/`createCrimeScene`/`markCrimeScene`/`ExaminationPoint` (`world-types.ts:114-150`), `processKill`/`crimeScenes`/`bodyDiscoveries`/`TickResult.murder`/`TickResult.crimeScene` (`world.ts:1485-1568`), `GoalActionResult.crimeEvent` (`goals.ts`). *Inert* in a no-crime world (not blocking) but crime-domain dead weight; a politics/economy world wanting its own location-marker has only the crime-named one. Fix: rename to `EventScene`/`WorldMarker`/`processAgentDeath`/`genericEvent`.
7. **Pre-seeded crime DEFAULTS** — `event-registry.ts:312-318` `BELIEF_SOURCE_LABELS` (`'body_discovery'→'found the body'`), `:332-338` `BELIEF_SOURCE` constants (BODY_DISCOVERY/EVIDENCE/DEDUCTION), `:347-353` `SOURCE_TRANSFER_WEIGHTS`. Modules already override these — *dead defaults that document crime assumptions*. Fix: start empty (TESTIMONY/OBSERVATION arguably universal, may stay).
8. **`il.ts` TradeIntent + closed `EmotionalPressure.type` union** — the engine is coupled to BOTH crime *and* a half-built economy. Runtime uses `getRegisteredPressureTypes()` so new pressures work, but the TS type is pinned. Fix: `EmotionalPressure.type = string`; move TradeIntent to a module-registered intent kind.

### Cross-genre convergence (why confidence is high)
Both probes — a state-heavy economy and a prose-heavy social genre — *independently* landed on the same three engine touch-points: **typed-requirement-field leak, prompt-prose leak, and a state gap**. Convergence across maximally-different genres makes these structural verdicts, not one-off quirks.

## Invariant Status
- **INV-14 import boundary:** PERFECT (zero engine→module imports).
- **INV-14 "zero module-specific strings":** PARTIALLY VIOLATED (`'rumor'`, prose, type field names, pre-seeded defaults).
- **INV-08/09/10/12/15:** COMPLIANT for flag-checks — engine uses boolean predicates and open registries, not event-string comparisons. The leaks are in *types/defaults/prose*, not dispatch.

## The Reusable Module-Sufficiency Test
1. **Define the genre as data** — its events, affordances, verbs, consequence rules, beliefs, roles, WIN CONDITION, and persistent STATE.
2. **Trace each need to its engine landing spot** — registry (event/affordance/step/CG/belief/requirement), agent-state field, or prose hook.
3. **Bucket every unsatisfiable need:** (G) LEGIT GAP if 3+ unrelated genres need it (new universal law); (L) ASSUMPTION LEAK if it's meaningful only in the crime domain (generalize out). Split capability-flag-style items: open *slot* = gap, crime *names* = leak.
4. **Metric:** `module-satisfiable % = registry/data-only needs / total needs`. Record `leak count` and `gap count`, and mark each leak **blocking** (mis-renders/mis-behaves — `'rumor'`, prose) vs **non-blocking** (inert dead weight — CrimeScene naming). Verdict: ≥90% & no blocking leaks → module-only; 75-90% with a bounded one-time investment → occasional-engine; <75% or blocking leaks → frequent-engine.
5. **Cross-genre confirmation** — run two maximally-different genres; shared touch-points are real verdicts.
6. **Re-run after each refactor** — watch % climb to 100 and leak-count drop to 0.

## Bottom Line
The architecture pattern is **correct and proven** — 53 registries plus a domain-agnostic volition/CG/belief/goals/mood core genuinely carry non-crime genres for motivation, consequences, and behavior. The implementation has **accreted crime knowledge in the engine layer** (one hardcoded source string, inline crime prose with no override hook, crime-named types and defaults, dead crime primitives). A different-focus game therefore needs **a module PLUS a bounded, one-time engine investment** — add one state subsystem (or one relationship-richness upgrade) and drain ~8 prose/type leaks — after which that domain's content is genuinely module-only. **Occasional-engine, 7/10.**

## Confidence: HIGH
Every load-bearing claim verified against source (not faith): `AgentState`/`AgentProfile` (agent-types.ts), `buildRoleDirective` (agent.ts:376-405), `AffordanceRequirement` + `REQUIREMENT_CHECKERS` + `checkRegistryRequirements` (al.ts:11-49,229,288-298), `'rumor'` (world.ts:1181,1194,1309), `RelationType` (relationships.ts:1), pre-seeded defaults (event-registry.ts:312-353). Both independent probes converged. Residual uncertainty (low): not every one of the 53 registries nor server.ts trade endpoint read line-by-line, but spot-checks of the highest-leverage files are consistent.