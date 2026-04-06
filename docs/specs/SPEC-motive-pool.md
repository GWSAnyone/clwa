# SPEC-motive-pool: Motives as Beliefs

> **Status:** Implemented (2026-04-06)
> **Scope:** GDD M1 — "Motive network expansion" + "Conditional motives"
> **Depends on:** SPEC-trait-randomization, belief system (BeliefManager)
> **Engine changes:** EventTypeFlags.decayRate (1 field). Rest = module + server.

---

## Problem

`profile.motive` is a string in JSON. It decorates LLM prompts but has zero mechanical effect. Kill uses `crime_belief` target finder (not motive). Steal uses `targetHasShop`. Blackmail uses `secret_belief`. The motive field is narrative decoration, not a system.

Meanwhile, the belief system (BeliefManager) already does everything motives need: confidence, decay, source tracking, transfer, event categories, beliefModifiers on affordances. Creating a parallel motive system = unnecessary entity.

## Solution: Motives = Beliefs with category 'motive'

No new system. Extend beliefs. Register motive event types. Use existing beliefModifiers for mechanical crime scoring. Motive beliefs emerge from events and relationships during gameplay.

---

## Architecture

### Motive Belief Structure

```
eventType: 'PERSONAL_GRUDGE' | 'REVENGE_DESIRE' | 'THREAT_PERCEIVED'
subject: null                   // not used (perpetrator semantics don't apply)
object: target NPC name         // who the motive is directed at (dedup key!)
confidence: 0.0–1.0             // strength of motive
source: 'personal_motive'       // new source type, transfer weight = 0
```

**Why object, not subject:** Belief dedup key = `(eventType, object, source)`. Using `object = targetName` allows multiple motives of the same type toward different NPCs. If object were null, only ONE PERSONAL_GRUDGE could exist per NPC — adding a second would overwrite the first.

### Narrative Reason

Separate from belief. Stored as agent memory (observe):
```
agent.observe("Bess knows my spices are fake. She could ruin everything.", 8)
```
Belief = mechanical effect. Memory = LLM prompt context. Different systems, different purposes.

### Registration (crime-justice module)

```typescript
registerEventCategory('motive', ['PERSONAL_GRUDGE', 'REVENGE_DESIRE', 'THREAT_PERCEIVED']);
registerSourceTransferWeights({ personal_motive: 0 }); // grudges don't gossip
registerEventTypeFlagsBatch(['PERSONAL_GRUDGE', 'REVENGE_DESIRE', 'THREAT_PERCEIVED'], {
  decayRate: 0.1,  // 10x slower than facts — grudges persist
});
```

### Engine Addition: decayRate on EventTypeFlags

```typescript
// EventTypeFlags (event-registry.ts):
export interface EventTypeFlags {
  transferable?: boolean;
  informationOnly?: boolean;
  subjectReacts?: boolean;
  decayRate?: number;        // NEW: multiplier for belief decay. Default 1.0. Motives: 0.1.
}
```

`decayBeliefs()` combines source-based and eventType-based rates:
```
effectiveRate = sourceDecayRate × (eventTypeDecayRate ?? 1.0)
```
At eventType rate 0.1: effective decay = sourceRate × 0.1 (10x slower). Confidence 0.9 → 0.5 in ~23 game days. Session = ~5 game days → motive barely decays.

Per-eventType differentiation possible:
- `REVENGE_DESIRE`: decayRate 0.05 (semi-permanent — trauma persists)
- `PERSONAL_GRUDGE`: decayRate 0.1 (slow fade without reinforcement)
- `THREAT_PERCEIVED`: decayRate 0.2 (situational — fades faster if threat not reinforced)

---

## Motive Pool (Millhaven)

9 motives across 6 NPCs. Probabilities balanced to produce 3+ different criminals in 10 seeds.

```json
[
  {
    "id": "secret_exposed",
    "from": "mark", "to": "bess",
    "type": "THREAT_PERCEIVED",
    "reason": "Old Bess figured out your exotic spices are common herbs. She hinted she might tell everyone.",
    "confidence": 0.9,
    "probability": 0.6,
    "requires": { "fromHBelow": 0.45 }
  },
  {
    "id": "fathers_death",
    "from": "hilda", "to": "ted",
    "type": "REVENGE_DESIRE",
    "reason": "Your father bled out on the tavern floor while Ted watched and did nothing to help.",
    "confidence": 0.85,
    "probability": 0.45,
    "requires": { "sentimentBelow": -0.15 }
  },
  {
    "id": "gambling_debt",
    "from": "ted", "to": "mark",
    "type": "PERSONAL_GRUDGE",
    "reason": "Mark holds your gambling debts over your head. Every day the interest grows.",
    "confidence": 0.7,
    "probability": 0.35,
    "requires": { "fromHBelow": 0.5, "sentimentBelow": -0.2 }
  },
  {
    "id": "too_many_questions",
    "from": "elara", "to": "garrett",
    "type": "THREAT_PERCEIVED",
    "reason": "Garrett has been asking too many questions about your past. He's getting close to things that should stay buried.",
    "confidence": 0.75,
    "probability": 0.35,
    "requires": { "fromHBelow": 0.5, "sentimentBelow": -0.15 }
  },
  {
    "id": "trade_rivalry",
    "from": "mark", "to": "hilda",
    "type": "PERSONAL_GRUDGE",
    "reason": "Hilda overcharges you for metalwork and everyone knows it. She's bleeding you dry on purpose.",
    "confidence": 0.6,
    "probability": 0.3,
    "requires": { "fromHBelow": 0.4, "sentimentBelow": -0.15 }
  },
  {
    "id": "herbal_knowledge",
    "from": "bess", "to": "mark",
    "type": "PERSONAL_GRUDGE",
    "reason": "Mark sells fake herbs as medicine. Someone could get hurt. Perhaps someone should ensure he stops.",
    "confidence": 0.65,
    "probability": 0.25,
    "requires": { "fromHBelow": 0.6, "fromNAbove": 0.5, "sentimentBelow": -0.3 }
  },
  {
    "id": "corrupt_suspicion",
    "from": "garrett", "to": "elara",
    "type": "PERSONAL_GRUDGE",
    "reason": "Elara's stories always seem to know too much. She's hiding something, and you intend to find out — or make her pay.",
    "confidence": 0.6,
    "probability": 0.3,
    "requires": { "fromHBelow": 0.6, "sentimentBelow": -0.1 }
  },
  {
    "id": "moral_disgust",
    "from": "aldric", "to": "ted",
    "type": "PERSONAL_GRUDGE",
    "reason": "Ted waters down ale and cheats honest folk. You've prayed for his soul, but patience has limits.",
    "confidence": 0.5,
    "probability": 0.2,
    "requires": { "fromHBelow": 0.7, "fromNAbove": 0.4 }
  },
  {
    "id": "political_threat",
    "from": "ted", "to": "bess",
    "type": "THREAT_PERCEIVED",
    "reason": "Bess has been asking pointed questions about your finances. She knows about the debts, and she talks to everyone.",
    "confidence": 0.65,
    "probability": 0.3,
    "requires": { "fromHBelow": 0.5, "sentimentBelow": -0.15 }
  }
]
```

### Assignment at Game Start

```
for each motive in pool:
  check conditions against randomized traits/relationships
  roll seeded dice (per-motive sub-seed)
  if passes:
    agent.beliefs.addBelief({
      eventType: motive.type,
      subject: null,
      object: targetName,  // dedup key includes object — allows multiple motives per type
      confidence: motive.confidence,
      source: 'personal_motive',
      location: agent.location,
      gameDay: 1,
    })
    agent.observe(motive.reason, 8)  // narrative in memory, not belief
```

**Guards:**
- `if (motive.from === motive.to) skip` — no self-motives
- `if (!target.state.alive) skip` — no motives toward dead NPCs

Side effects: if motive assigned but sentiment too weak for social stress, push sentiment floor to -0.35.

---

## Emergent Motives (During Gameplay)

### Event-driven

| Trigger | Motive Created | On Who | Confidence |
|---------|---------------|--------|------------|
| THEFT_DISCOVERED (victim) | REVENGE_DESIRE | victim | 0.8 |
| NPC_KILLED (friend of victim) | REVENGE_DESIRE | friend (sentiment > 0.3) | sentiment × 0.8 |
| Blackmail step (when implemented) | THREAT_PERCEIVED | blackmail target | 0.7 |
| NPC_ARRESTED (if wrongfully?) | PERSONAL_GRUDGE | arrested NPC | 0.6 |

Implementation: in event handlers (crime-justice module), alongside existing mood/belief effects.

### Relationship-driven

In tick handler or conversation impact: if sentiment < -0.5 AND no existing motive belief against target → create PERSONAL_GRUDGE with confidence = |sentiment| × 0.7. Create once (hasMotiveBelief guard). Slow-burn grudge from repeated negative interactions.

### Reinforcement

Conversation impact: if topic mentions NPC who is target of speaker's motive belief → confidence += 0.05 (capped at 1.0). Talking about/with your enemy reinforces your grudge.

---

## Crime Integration

### beliefModifiers on Affordances

```typescript
// kill (pre-meditated murder):
beliefModifiers: [
  { eventType: 'REVENGE_DESIRE', weight: 0.5 },
  { eventType: 'PERSONAL_GRUDGE', weight: 0.4 },
  { eventType: 'THREAT_PERCEIVED', weight: 0.3 },
]

// steal:
beliefModifiers: [
  { eventType: 'DEBT_PRESSURE', weight: 0.3 },
  { eventType: 'PERSONAL_GRUDGE', weight: 0.15 },
]

// blackmail:
beliefModifiers: [
  { eventType: 'PERSONAL_SECRET', weight: 0.3 },
  { eventType: 'THREAT_PERCEIVED', weight: 0.2 },
]
```

Mark with THREAT_PERCEIVED (conf 0.9) about Bess → kill score += 0.9 × 0.3 = **+0.27**. Mechanical boost, not decoration.

### Target Finders

New: `'motive_target'` — finds NPC with highest confidence motive-category belief.

```typescript
function findMotiveTarget(npcId, agent, ctx): AffordanceTarget | null {
  if (!agent.state.beliefs) return null;
  let best: { id: string; name: string; conf: number } | null = null;
  for (const b of agent.state.beliefs.getAllBeliefs()) {
    if (!isEventCategory(b.eventType, 'motive')) continue;
    if (b.confidence < 0.3) continue;
    const target = findAgentByNameOrId(b.object, ctx.agents); // object = target name (dedup-safe)
    if (!target || target.id === npcId) continue;
    if (!best || b.confidence > best.conf) {
      best = { id: target.id, name: target.name, conf: b.confidence };
    }
  }
  if (!best) return null;
  const targetAgent = ctx.agents.get(best.id)!;
  return { targetId: best.id, targetName: best.name, targetLocation: targetAgent.state.location, extra: {} };
}
```

Kill affordance: `targetFinder: 'motive_target'` (pre-meditated).
Vigilante: keeps `targetFinder: 'crime_belief'` (reactive).

### Secret Directives

`buildSecretDirectives` reads motive beliefs instead of `profile.motive`:
```
const motiveBeliefs = agent.beliefs.filter(b => isEventCategory(b.eventType, 'motive'));
```
Combines with memory recall (narrative reason stored as observation).

---

## Migration

1. `profile.motive` → deprecated. World-loader still reads it.
2. At game start: if profile.motive exists AND no pool entry, convert to belief (backward compat).
3. Pool entries override profile.motive (pool is authoritative).
4. Eventually: remove motive field from NPC JSONs.

---

## Files Changed

| File | Change |
|------|--------|
| `engine/src/event-registry.ts` | Add `decayRate` to EventTypeFlags |
| `engine/src/beliefs.ts` | `decayBeliefs` reads decayRate per eventType |
| `modules/src/crime-justice/index.ts` | Register motive category, source, flags, beliefModifiers |
| `modules/src/crime-justice/affordances.ts` | Add beliefModifiers for motive types, kill targetFinder → 'motive_target' |
| `modules/src/crime-justice/target-finders.ts` | New findMotiveTarget |
| `modules/src/crime-justice/event-handlers.ts` | Create REVENGE_DESIRE on victimization |
| `server/src/trait-randomizer.ts` | assignMotives from pool → beliefs + memories |
| `server/src/world-loader.ts` | Load motives.json |
| `worlds/millhaven/motives.json` | New — motive pool |

---

## Test Metric

1. 10 seeds → at least 3 different primary criminals
2. Mark with THREAT_PERCEIVED belief → kill score measurably higher than without
3. Hilda victimized by theft → REVENGE_DESIRE belief created → Hilda becomes potential criminal
4. Motive confidence barely decays over 5 game days (decayRate 0.1)
5. Motive beliefs NOT transferred through gossip (source weight 0)
6. Same seed always produces same motive assignment
7. NPC can have 2 motives of same type toward different targets (dedup by object)

---

## Deferred (not blockers for M1)

| Feature | When | Notes |
|---------|------|-------|
| **Motive resolution** | M3 | Target dies/exiled → cleanup motive beliefs. Handler on NPC_KILLED/NPC_SENTENCED |
| **Positive motives** | M3 | PROTECT, LOYALTY event types → defensive affordances (warn, shield) |
| **Escalation** | M3 | PERSONAL_GRUDGE + provocative event → auto-upgrade to REVENGE_DESIRE |
| **Enneagram integration** | M3 | Stress type modulates motive confidence (Type 8 stress → withdrawal → -conf) |
| **Social awareness** | M4 | "I know X hates Y" — separate from personal motives. Different transfer mechanism |

---

## Known Behaviors (intentional, not bugs)

- **Absent NPC modifiers frozen**: imprisoned/exiled NPCs don't tick mood modifiers. On release, modifiers resume with original remaining. Arrest shock persists through imprisonment — intentional.
- **Circular motives**: Mark→Bess + Bess→Mark both possible. Race condition in ProcessingQueue = whoever processes first wins. This IS gameplay — emergent competition.
- **Blackmail no outcome**: M3 scope. Currently = conversation with loaded topic, zero mechanical effect. Mark may waste 2-3 volition cycles on blackmail before choosing steal/kill.
- **Event injection needs NPC at location**: dev tool limitation, not bug. CG cascade checks NPCs at event location. Set up NPC positions before injecting events.
