# SPEC-motive-pool: Randomized Motive Assignment

> **Status:** Draft v1
> **Scope:** GDD M1 — "Motive network expansion" + "Conditional motives"
> **Depends on:** SPEC-trait-randomization (traits + relationships already randomized)
> **Changes:** server only. Zero engine, zero module changes.

---

## Problem

Mark always hates Bess. Hilda always hates Ted. Every seed produces the same potential criminals. GDD promises "each restart shuffles the deck" — but only traits shuffle, motives are fixed.

Hilda has a motive (father's death in Ted's tavern) but her numbers never reach crime zone. Ted and Elara are crime-capable by H range but have no motives. Result: Mark commits crime 100% of runs.

## Solution: Motive Pool

Define a pool of possible motives in world data. At randomization time, evaluate conditions against randomized traits/relationships. Roll seeded dice. Different seed = different NPCs get motives = different criminals.

---

## Motive Definition

```typescript
interface MotiveDefinition {
  id: string;                    // unique identifier
  from: string;                  // NPC id (or "any" for generic)
  to: string;                    // target NPC id (or "any_has_shop", etc.)
  reason: string;                // narrative text for LLM prompts
  probability: number;           // 0-1, chance of activation after conditions pass
  requires?: {
    fromHBelow?: number;         // from NPC honesty must be below this
    fromNAbove?: number;         // from NPC neuroticism must be above this
    sentimentBelow?: number;     // from→to sentiment must be below this
  };
}
```

## Motive Pool (Millhaven)

```json
[
  {
    "id": "secret_exposed",
    "from": "mark", "to": "bess",
    "reason": "Old Bess figured out your exotic spices are common herbs. She hinted she might tell everyone.",
    "probability": 0.75,
    "requires": { "fromHBelow": 0.45 }
  },
  {
    "id": "fathers_death",
    "from": "hilda", "to": "ted",
    "reason": "Your father bled out on the tavern floor while Ted watched and did nothing to help.",
    "probability": 0.5,
    "requires": { "sentimentBelow": -0.15 }
  },
  {
    "id": "gambling_debt",
    "from": "ted", "to": "mark",
    "reason": "Mark holds your gambling debts over your head. Every day the interest grows. One night you could settle this permanently.",
    "probability": 0.35,
    "requires": { "fromHBelow": 0.5, "sentimentBelow": -0.2 }
  },
  {
    "id": "too_many_questions",
    "from": "elara", "to": "garrett",
    "reason": "Garrett has been asking too many questions about your past. He's getting close to things that should stay buried.",
    "probability": 0.4,
    "requires": { "fromHBelow": 0.5, "sentimentBelow": -0.15 }
  },
  {
    "id": "trade_rivalry",
    "from": "mark", "to": "hilda",
    "reason": "Hilda overcharges you for metalwork and everyone knows it. She's bleeding you dry on purpose.",
    "probability": 0.3,
    "requires": { "fromHBelow": 0.4, "sentimentBelow": -0.15 }
  },
  {
    "id": "herbal_knowledge",
    "from": "bess", "to": "mark",
    "reason": "Mark has been selling fake herbs as medicine. Someone could get hurt. Perhaps someone should ensure he stops — permanently.",
    "probability": 0.2,
    "requires": { "fromHBelow": 0.6, "fromNAbove": 0.5, "sentimentBelow": -0.3 }
  }
]
```

### Pool Properties

- **6 motives** for 8 NPCs (not everyone has a potential motive)
- **Mark appears in 2** (as aggressor): secret_exposed + trade_rivalry. Can get 0, 1, or 2 motives per seed.
- **Hilda, Ted, Elara, Bess** each have 1 potential motive — activates only on right seed
- **Aldric, Garrett, Theron** — no motives in pool (authority/peaceful roles). They never commit crime.
- **Probabilities** calibrated: Mark's primary motive 0.75 (usually active), others 0.2-0.5 (less frequent)
- **Conditions** gate on randomized traits + relationships — motive only fires if NPC is "that kind of person" on this seed

---

## Assignment Algorithm

In `trait-randomizer.ts`, after traits + moods + relationships randomized:

```
function assignMotives(pool, profiles, relationships, seed):
  for each motive in pool:
    from = findProfile(motive.from)
    to = findProfile(motive.to)
    if not from or not to: skip

    // Check trait conditions against RANDOMIZED values
    if motive.requires.fromHBelow and from.bigFive.honesty >= fromHBelow: skip
    if motive.requires.fromNAbove and from.bigFive.neuroticism < fromNAbove: skip

    // Check relationship conditions against RANDOMIZED sentiment
    sentiment = getRandomizedSentiment(from.id, to.id, relationships)
    if motive.requires.sentimentBelow and sentiment >= sentimentBelow: skip

    // Seeded probability roll
    rng = mulberry32(seed + hashString('motive_' + motive.id))
    if rng() > motive.probability: skip

    // Assign motive to NPC
    from.motive = { targetId: to.id, reason: motive.reason }
```

**Per-motive sub-seed** — same pattern as per-NPC trait randomization. Adding/removing motives from pool doesn't change dice rolls for existing ones.

---

## Side Effects of Motive Assignment

When NPC gets a motive, the relationship pressure should match:

1. **Sentiment floor**: if motive assigned but from→to sentiment is weak (> -0.3), push sentiment down to at least -0.35. Criminal needs negative relationship for social stress to drive mood down.

2. **Initial mood push**: if motive assigned but starting mood is too high (> baseMood - 0.1), add extra negative initial_conditions modifier. Criminal needs to start trending down.

These ensure that HAVING a motive produces enough mechanical pressure for crime to be reachable — not guaranteed, but possible.

---

## What Motives Do (no changes)

Existing systems already use `motive`:
- **Target finders**: `findMotiveTarget()` reads `agent.motive.targetId`
- **Secret directives**: includes motive reason in LLM system prompt
- **Instinct builder**: `{reason:...}` interpolation from motive
- **Kill affordance**: `sentimentBelow: -0.4` → checks relationship, motive drives sentiment down

Zero engine changes needed. Motive assignment = data preparation, same as trait randomization.

---

## Calibration: What Changes Per Seed

### Scenario examples with pool

**Seed A** (H rolls low for Mark, Hilda gets moderate):
- Mark: H=0.20, Bess sentiment=-0.75 → secret_exposed passes (H<0.45, prob 0.75, roll passes)
- Hilda: H=0.55, Ted sentiment=-0.20 → fathers_death passes conditions (sent<-0.15) but roll fails (0.5, bad luck)
- **Criminal: Mark only**

**Seed B** (Mark H moderate, Hilda H low):
- Mark: H=0.38, Bess sentiment=-0.50 → secret_exposed passes
- Hilda: H=0.42, Ted sentiment=-0.45 → fathers_death passes (sent<-0.15, prob 0.5, roll passes)
- **Criminals: Mark AND Hilda** → who strikes first depends on mood trajectory

**Seed C** (Mark H too high, Ted gets desperate):
- Mark: H=0.48 → secret_exposed FAILS (H not < 0.45)
- Ted: H=0.38, Mark sentiment=-0.35 → gambling_debt passes (H<0.5, sent<-0.2, prob 0.35, roll passes)
- **Criminal: Ted** → totally different story!

**Seed D** (everyone moderate):
- All motives fail conditions or probability → no motives assigned
- Generic fallback: find NPC with lowest H + strongest negative relationship → auto-assign "deep grudge"
- **Criminal: whoever drew worst personality cards**

---

## Fallback: Generic Grudge

If zero narrative motives pass, assign a generic motive to the most crime-prone NPC:

```
if no NPC has motive:
  candidates = NPCs sorted by H ascending
  for each candidate:
    strongestEnemy = relationship with lowest sentiment
    if strongestEnemy.sentiment < -0.2:
      candidate.motive = {
        targetId: strongestEnemy.id,
        reason: "You cannot stand {name}. Something about them makes your blood boil."
      }
      break
```

This ensures at least one potential criminal per run. Generic motive = less narrative richness, but crime still happens.

---

## Files Changed

| File | Change |
|------|--------|
| `worlds/millhaven/motives.json` | New — motive pool (6 entries) |
| `worlds/millhaven/npcs/*.json` | Remove hardcoded `motive` field (→ null, assigned at runtime) |
| `server/src/trait-randomizer.ts` | `assignMotives()` function |
| `server/src/world-loader.ts` | Load motives.json |
| `server/src/index.ts` | Call assignMotives after randomizeRelationships |

No engine changes. No module changes. Pure server + data.

---

## Test Metric

1. 10 seeds → at least 3 different primary criminals
2. At least 1 seed where Mark is NOT the criminal
3. At least 1 seed with 2 potential criminals (competition for who strikes first)
4. Fallback produces a criminal when all narrative motives fail
5. Same seed always produces same motive assignment (deterministic)
