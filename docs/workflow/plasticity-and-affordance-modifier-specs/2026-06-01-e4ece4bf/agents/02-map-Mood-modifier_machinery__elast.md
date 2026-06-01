## Map: Mood-modifier machinery (the ELASTIC model)

**TL;DR:** Mood is a pure DERIVED scalar: `effectiveMood = clamp(baseMood + Σ modifierEffective(m), -1, 1)`, recomputed every tick. `baseMood` is the spring's rest position; `moodModifiers[]` are timed, decaying displacements that spring back to zero (elastic). INV-06 forbids writing `mood` directly — the only legal write is `addModifier()`, and the tick overwrites `mood` from base+modifiers. The scalar-attribute subsystem (`attributes.ts`) ALREADY generalizes this exact pattern to open string keys with a plastic base + elastic modifiers + optional base-drift — it is the ready-made template a trait axis would extend.

**Architecture (elastic model):**
- `MoodModifier` shape — `world-types.ts:6-14`: `{id, source, category, magnitude, remaining, duration, decay}`. `remaining=duration=0` ⇒ permanent. `category` = stacking group.
- `modifierEffective(m)` — `world-types.ts:17-22`: decay curve. `none`/`duration=0` → full magnitude; `linear` → `magnitude × (remaining/duration)`; `exponential` → `magnitude × ratio²`. **A byte-identical private copy lives at `attributes.ts:38-43`.**
- `AgentState.baseMood` / `mood` / `moodModifiers` — `agent-types.ts:147-152`. Comment is explicit: `mood` is "computed effectiveMood from baseMood + modifiers".
- `addModifier(npcId, mod)` — `world.ts:611-637`: the sole write API. NaN/Inf guard (614-618), per-category stacking cap (`maxPerCategory`, default 3) evicting the weakest non-permanent (629-634), assigns `crypto.randomUUID()`, pushes.
- `_upsertPermanent(mods, category, mag, source?)` — `world.ts:640-648`: singleton permanent modifier keyed by category (id=category, duration=0). Used for `social_stress` and `loneliness`.
- `removeModifiers(npcId, category)` — `world.ts:651-655`.

**Data flow (per tick, 5 game-min step):**
```
_tickMoodSystem() [world.ts:556]  — bilateral over alive, non-absent agents (INV-16)
  → _computeMoodTick(agent,cfg) [508]
       1. decay: each mod.remaining -= 5; splice if ≤0; NaN guard  [515-523]
       2. social_stress drift toward personality-scaled target (_upsertPermanent) [525-545]
       3. agent.state.mood = clamp(baseMood + Σ modifierEffective, -1,1)  [547-550]  ← ELASTIC SUM
  → loneliness permanent modifier (real-tick only) [571-580], recompute sum [582-587]
  → scalar-attribute decay+drift (real-tick only): decayAttribute/driftAttribute(attr,5) [591-593]
  → onMoodChange callback if |Δ|>0.0005 [595-597]  → WS broadcast
  → mood-history snapshot (cap MOOD_HISTORY_MAX) [599-603]
```
Inputs arrive ONLY through `addModifier` (conversations world.ts:1088/1093, goals 1248, death 1685, IL pressure, module hooks via `callbacks.addMoodModifier`). `_computeMoodTick` is intentionally side-effect-free (shared with calibration helper `advanceMoodMath`, world.ts:806) — conserved-state decay deliberately excluded (world.ts:551-553).

**How a trait axis reuses this EXACTLY (elastic modifier + plastic baseline):**
The scalar-attribute subsystem (`attributes.ts`) is the mood pattern already generalized to an OPEN registry — this is the reuse target:
- ELASTIC layer = `AttributeModifier` (`attributes.ts:11-23`, structurally identical to MoodModifier) on `ScalarAttribute.modifiers[]`, applied via `attributeEffective = clamp(base + Σ modifierEffective, min, max)` (`attributes.ts:54-58`) and ticked by `decayAttribute(attr,dt)` (`attributes.ts:61-69`). A temporary trait nudge (Enneagram stress/growth-style, but quantified) is exactly an `AttributeModifier` added via `addAttributeModifier()` (`world.ts:685`).
- PLASTIC layer = a permanent change to `ScalarAttribute.base`, done via `adjustAttributeBase(npcId,key,delta)` (`world.ts:674-682`, clamped). This is the "permanent set" — the analog of shifting `baseMood` rather than adding a transient modifier.
- BASE DRIFT (optional annealing) = `driftAttribute` (`attributes.ts:76-91`): base moves linearly or exponentially toward a target each tick — a ready-made mechanism for slow reversibility.

So a trait axis = one `ScalarAttribute` per open trait key: `base` = plastic disposition (re-set by lived experience / self-action), `modifiers[]` = elastic temporary shifts that spring back, `effective = clamp(base + Σ decayed modifiers)`. The SAME `_tickMoodSystem` loop that already calls `decayAttribute`/`driftAttribute` at `world.ts:591-593` would tick trait axes with zero new tick plumbing.

**Key facts / patterns:**
1. mood = derived, single-writer (INV-06) — `world.ts:550`. The whole elastic model exists so disposition springs back to a baseline each tick.
2. Two parallel-but-separate primitives today: bounded mood ([-1,1], no open keys, no base-drift) vs. open ScalarAttribute (arbitrary key/range + drift). Trait axes map onto the ScalarAttribute generalization, not onto mood's fixed shape.
3. `baseMood` itself is derived from static `bigFive` on load when absent (`world.ts:1988`: `0.3 - N×0.4 + E×0.2`) — already demonstrates "personality seeds a baseline" but the personality source is the IMMUTABLE profile.
4. Trait READS bypass state entirely: `computeUtility` reads `agent.profile.bigFive[TRAIT_MAP[trait]]` (`al.ts:451`), as do ~17 sites. A plastic baseline that does not flow through these reads is behaviorally inert.
5. Persistence already round-trips elastic+plastic state with INV-21 defaults and SL-07 NaN filtering for mood AND attributes (`world.ts:1882-1902`, `1987-2005`) — the discipline to copy for any new plastic trait field.

**Gotchas:**
- 5-min tick step is hardcoded in three places (`world.ts:522`, `592`); all durations/rates are calibrated to it.
- `_computeMoodTick` vs `_tickMoodSystem` split (calibration-safe vs real-tick): put trait DECAY in the real-tick path only, mirroring scalar attributes (`world.ts:591-593`), or risk double-decay during `advanceMoodMath`.
- Stacking eviction counts only `duration>0` modifiers (`world.ts:629`); permanent shifts use `_upsertPermanent`/`adjustAttributeBase`, a different code path — don't conflate a plastic baseline with a stacking modifier.
- `bigFive` on `AgentProfile` is the single biggest seam: making a trait baseline plastic means either relocating it into `AgentState` or shimming all ~17 direct reads. `cg-engine.ts:344` even casts `profile.bigFive` to `Record<string,number>` — an OPEN-axis read pattern already half-present.

**Not explored (outside this focus slice):** Affordance-space modifier / AL possible-set (SPEC 2), belief/relationship magnitude seams, Enneagram stress/growth prose (personality-prose.ts / agent.ts:531 buildStressGrowthDirective) beyond noting it as the existing TEMPORARY-shift mechanism, event-registry hook surface details.