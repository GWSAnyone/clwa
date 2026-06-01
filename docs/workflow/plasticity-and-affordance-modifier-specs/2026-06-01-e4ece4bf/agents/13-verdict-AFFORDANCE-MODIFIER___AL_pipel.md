# SPEC 2 (Affordance-Space Modifier) — Adversarial Review: AL pipeline ↔ Bilateral

Lens: does "A changes B's possible set" break computeUtility / target-finders / validatePlayerAction; is the player a correct source AND target (INV-16); is the zone carrier coherent with perception/co-location; can NPC and player diverge on the same modifier. All claims checked against source.

## What holds up (verified)
- **Gate vs score separation (DEC-1) is sound.** `computeUtility` (al.ts:447-491) is gate-independent; a forbidden action returns `null` in `checkRequirements` (al.ts:321) before scoring runs in volition (volition.ts:160-163). Riding strength on `registerScoringContributor` (al.ts:439) cannot make an action possible, and the binary gate cannot express "more attractive." No "scored but impossible." This is correct.
- **Target finders are untouched and don't need to be.** `findTarget`/`findReactiveTarget` (al.ts:359-387) decide *who A can target*; gating *T's own set* happens inside T's `checkRequirements`. The store-on-source / evaluate-on-target model (DEC-3) is mechanically consistent with `getCoPresent` (perception.ts:54-65), which does NOT filter `isPlayer` — so the player is a valid co-present projector/target at the perception layer.
- **ScalarAttribute reuse for ZoneState is clean.** `decayAttribute`/`driftAttribute`/`attributeEffective` (attributes.ts:38-97) operate on a bare `ScalarAttribute` with no agent reference, so applying them to `ZoneState.attributes` is correct with zero new math. The override decay idiom (remaining/duration/splice) mirrors `decayAttribute` exactly.
- **Tick bilaterality for decay holds.** `_tickMoodSystem` (world.ts:561-604) iterates all agents incl. player (only skips dead/absent), so per-agent override decay would cover the player. The separate zone-decay loop is justified (zones aren't in the agent loop).
- **INV-21 / save-load reuse is sound** (omit-when-empty at world.ts:1892; optional fields default absent).

## Where it breaks (the bilateral core)
The spec's bilateral story is asserted but **structurally unreachable on the live player path**, and three findings share one root cause:

1. **`validatePlayerAction` is dead code** — defined al.ts:510, exported index.ts:57, **zero production callers** (confirmed by full-repo grep; `docs/_archive/clwa-buddy.md:63` already flags "Player action bypasses validatePlayerAction()"). The live player path is IL speech-acts → pressure handlers (server.ts:236-246 → server/src/index.ts:161-202) with **no affordance gate**. Both volition loops skip the player (volition.ts:139, 230). So a zone curfew / cross-agent forbid gates every NPC but never the player → direct INV-16/INV-17 divergence.
2. **The plasticity seam can't fire for the player** — `onAffordanceOverrideUsed` rides the NPC-only goal-execution callback (`onGoalAction`, world.ts:1242); the player produces no GoalActionResult, only IL pressure events with no affordance identity. The `onMoodChange` parallel the spec leans on is false: that callback is bilateral because it rides the all-agent tick; this one isn't.
3. **Cross-agent "NPC forbids player" (Type-II) is unrealizable today** — same root: nothing runs the player through `isAffordanceForbidden`.

Plus two pipeline-correctness gaps independent of the player:

4. **Decision-time-only gate** — committed goals execute via `processGoalTick` (world.ts:1235-1260) with **no requirement re-check**, so a forbid projected after a multi-step goal commits is silently ineffective. The canonical "suppress a power right now" is exactly a late projection.
5. **Hot-path cost understated** — `AffordanceContext` (built world.ts:1772) is a flat snapshot with no `zoneStates`; the per-(affordance×agent) co-present override scan in the hottest loop (volition.ts:154-165) needs a per-tick location→overrides cache and an explicit no-overrides early-out (the latter is what actually guarantees the crime/economy oracle is unchanged — make it explicit, not emergent).

And two asymmetries to close: the player path skips `checkPostTargetRequirements` entirely (al.ts:510-562 vs al.ts:323), so permit/forbid touch a different requirement surface on each side (finding 6); and equal-specificity multi-projector precedence/save-load order is unspecified (finding 8).

## Bottom line
The genre-neutral primitive and the gate-vs-score split are well-designed and the NPC side is implementable largely as written. But **the bilateral guarantee is the spec's central claim for this lens and it does not hold**: the player's possibility gate, override-use detection, and post-target surface are all missing or dead. Fix findings 1/3/6 as a single "revive the player possibility gate" workstream (and make it a hard precondition for the zone/cross-agent phases), add an execution-time gate (finding 4), and specify the hot-path cache + early-out (finding 5). Until then, SPEC 2 should be scoped as NPC-only with the player-bilateral work called out as a named prerequisite, not a one-line insertion.