# Engine Generalization Survey — Report

> Workflow: `engine-generalization-survey` · run `wf_3d7ddc1c-b47` · 2026-05-29 · 5 agents
> Question: where is the CLWA engine universal vs crime-justice-locked, and which engine investments
> most widen the space for creating games? (rendered from the synthesis; full raw in `raw.json`)

## Headline — the single biggest vision gap

**There is NO quantified-state primitive anywhere in the engine.** `AgentState` is entirely symbolic/social
(alive, location, mood, status, beliefs, relationships) — confirmed: no balance, no inventory, no HP, no
standing, no faction. The only numeric-with-modifiers pattern that exists is `MoodModifier`.

Every second genre the vision names is gated on the **same missing shape** — *a named, clamped, decaying
scalar with modifiers and a condition op to read it*:
- Economy → gold + inventory
- Combat → HP + damage
- Politics → influence + standing
- Survival → need-meters

Until the engine has a generic scalar-attribute (and item-transfer) layer, a 2nd genre can only **fake**
quantitative state by stuffing numbers into the untyped `event.payload` and reimplementing accounting in
tick handlers — which violates conservation, has no persistence integrity, and is invisible to CG conditions
and affordance scoring. **This is a hard capability ceiling, not a smell** — the one thing standing between
"a different crime town" and "a different game."

The INV-14 vocabulary leaks (crime-named `AffordanceRequirement` fields, hardcoded `investigator`/`canSentence`
branches, `CrimeScene` in the public API) are real but **type-level** smells the registry escape hatches
already route around at runtime.

## Verdict on extensibility

Engine is **~80-90% genre-extensible at the registry/data plane** — events, affordances, scoring, steps,
consequences, beliefs, conversation, evidence, lifecycle hooks are all genuinely registry-driven (INV-14
import boundary is clean: zero module imports in engine). The ceiling is purely the **quantitative-state** gap.

## Recommendation

**Ship a minimal Economy spike FIRST, then build the generic scalar-attribute subsystem it exposes.**

- **Rationale**: a thin 2nd genre reveals more locked assumptions than any amount of analysis. The Economy
  spike (M) is cheap and immediately empirical — it hits the exact documented blockers and turns predictions
  into a concrete, ranked engine-edit list grounded in a running module. Then the scalar-attribute subsystem
  (L) — generalized from the `MoodModifier` pattern the engine already proves — is the ONE primitive that
  simultaneously backs Economy gold, Combat HP, Politics standing, Survival needs. That converts the engine
  from "crime-content-swappable" to "genre-extensible" — exactly the goal of widening game-creation space.
- **Tradeoff**: the spike is intentionally throwaway (numbers in payload, no conservation) — in tension with
  "no scaffolds", so it must be explicitly framed + time-boxed as a generality PROBE whose deliverable is the
  blocker list, not a feature; its fake-state is torn out and replaced by the real subsystem. Cost = doing
  Economy affordances/events twice. Alternative (subsystem first, no module driving it) risks designing the
  wrong shape in the abstract.
- **First concrete step**: author a ~80-line minimal Economy module (mirror `social/index.ts`): register
  `economy`/`TRADE`/`FRAUD` events + flags, two affordances (`defraud`, `trade`) with OCEAN+H weights, one
  `FRAUD→REPUTATION_LOSS` consequence rule, a `attempt_fraud` step handler that just emits the event. Wire in
  `server/index.ts`, run via debug API, and **record every point where you're forced to edit the engine or
  stuff state into `event.payload`** — that list becomes the spec for the scalar subsystem + requirement/
  capability hardening.

## Ranked options (10)

| # | Option | Category | Size | Leverage | Priority |
|---|--------|----------|------|----------|----------|
| 1 | Generic scalar-attribute subsystem on AgentState (universal numeric layer) | sim-depth | L | high | high |
| 2 | Thin 2nd module — minimal Economy (TRADE/FRAUD) as generality proof | genre-generality | M | high | high |
| 3 | Generalize AffordanceRequirement → registry-resolved keyed map (#1 INV-14 leak) | arch-hardening | M | high | high |
| 4 | Capability registry — replace hardcoded role booleans with string keys | arch-hardening | M | high | high |
| 5 | Inventory / item-instance / transfer subsystem | sim-depth | L | high | high |
| 6 | Faction / group / membership subsystem | sim-depth | L | medium | medium |
| 7 | Trauma layer — dynamic personality baselines (deepener, not widener) | sim-depth | S | medium | medium |
| 8 | Abstract CrimeScene → generic SceneResidue (de-crime public API) | arch-hardening | M | medium | medium |
| 9 | Declarative module manifest (modules as data, not 1200 lines TS) | authoring | L | medium | low (premature) |
| 10 | Generic affected-party/role typing for reactive volition + CG targets | genre-generality | M | medium | low |

### Detail per option

1. **Scalar-attribute subsystem** — string-keyed registry-declared numeric attr on AgentState (base, clamped
   range, decaying/timed modifiers, onChange broadcast) generalized from MoodModifier; + RuleCondition `attr
   gt/lt/eq` op + pluggable scoring-contributor channel in `computeUtility` (al.ts:461). Unlocks HP/gold/
   standing/needs at once. Risk: save-migration; keep v1 per-agent scalars, defer cross-agent conservation.
2. **Economy spike** — the recommended first step (see above). Will hit: no resource state, requirement params
   forward only `beliefConfidence` (al.ts:294), hardcoded capability flags (al.ts:332-335), ShopItem/TradeIntent
   union collisions. The collision IS the deliverable.
3. **AffordanceRequirement generalization** — remove crime-named typed fields (al.ts:11-49) + inline
   investigator/canSentence branches (al.ts:332-335, 365-368, 537-541); open string-keyed map via
   REQUIREMENT_CHECKERS + generic params bag. Makes "add Economy with zero engine changes" pass for requirements.
4. **Capability registry** — `investigator/detersCrime/canSentence` (agent-types.ts:101-106) → string-keyed
   capability bag; route through the existing CG `has_capability` op. Co-dependent with #3 (same pass).
5. **Inventory/transfer** — Item/Container model + atomic conserved transfer step; replaces dead static
   `AgentProfile.shop`; makes theft (step-handlers.ts:216 emits GOODS_STOLEN but mutates no state) real.
6. **Faction subsystem** — collective actor + membership + faction-scoped standing; touches the CLOSED
   RelationType union. Lower immediate leverage (no in-flight module needs it yet).
7. **Trauma** — TRAUMA_RULES applying permanent OCEAN+H baseline shifts; cheapest Phase-3 (no AgentState shape
   change). Deepens psychology but doesn't widen genre space.
8. **CrimeScene → SceneResidue** — abstract the spatial-residue subsystem (sceneType already a free string);
   mostly rename + move callbacks. Widens vocabulary cleanliness, not capability.
9. **Module manifest** — declarative module format + `registerModuleFromManifest()`. Premature: would ossify
   today's crime-shaped requirement vocabulary; defer until registries hardened by #3/#4 + the 2nd module.
10. **Affected-party typing** — generalize victim/grief assumptions in reactive volition (volition.ts:206-289)
    + grief tables → beneficiary/harmed/rival declared per event. Speculative without the spike driving the shape.
