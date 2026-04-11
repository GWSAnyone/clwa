# SPEC: Criminal Escalation — Progressive Crime Severity

> **Milestone**: M3 (Living Opposition)
> **Status**: spec
> **Depends on**: Motive pool (done), affordance scoring (done), heat system (SPEC-heat-system)
> **Engine changes**: None. Module data — new affordances, motive escalation, belief modifiers.

---

## Problem

Currently the criminal NPC either commits a crime or doesn't. There's no progression:
- Mark (H=0.2, sentiment toward Bess = -0.7) gets motive belief → kill affordance fires → murder
- No warning signs, no escalation, no opportunity for the player to intervene before the major crime
- GDD target: "Minor incidents begin: arguments, petty theft, threats" (Phase 2: Escalation)

**Design goal**: Criminal starts small and escalates if unpunished. Each escalation step is a clue for the observant player. Prevention at any step delays or prevents the next.

---

## Design: Escalation as Motive Confidence Growth

### Core Insight

Escalation is not a separate system — it's the **natural result of growing motive confidence**. A criminal with PERSONAL_GRUDGE at confidence 0.3 might argue. At 0.5, they might threaten. At 0.7, they might steal. At 0.9, they might kill.

The existing motive belief system already has:
- Motive types: PERSONAL_GRUDGE (decay 0.1), REVENGE_DESIRE (decay 0.05), THREAT_PERCEIVED (decay 0.2)
- Confidence ranges: assigned from pool, grow from events (victimization)
- Motive target finder: kill requires conf ≥ 0.3

The problem: kill and steal both have the same motive confidence threshold (0.3). There's no staircase.

### Escalation Staircase

| Crime Severity | Motive Confidence | Affordances | Examples |
|---------------|-------------------|-------------|----------|
| **Verbal** | 0.15 - 0.30 | argue, insult | Public argument, heated words |
| **Minor** | 0.30 - 0.50 | steal (petty), vandalize | Taking items, property damage |
| **Moderate** | 0.50 - 0.70 | threaten, blackmail, steal (major) | Direct threats, extortion |
| **Severe** | 0.70+ | kill, arson | Murder, destruction |

### Implementation: Tiered beliefConfidence on Affordances

Currently kill uses `beliefConfidence: 0.3` in its requirement checker. The fix is simple — raise thresholds:

```typescript
// kill affordance requirement
{ checker: 'hasCrimeBelief', params: { beliefCategory: 'motive', beliefConfidence: 0.7 } }

// steal affordance requirement  
{ checker: 'hasCrimeBelief', params: { beliefCategory: 'motive', beliefConfidence: 0.3 } }

// threaten affordance (new)
{ checker: 'hasCrimeBelief', params: { beliefCategory: 'motive', beliefConfidence: 0.5 } }

// argue affordance (new)
{ checker: 'hasCrimeBelief', params: { beliefCategory: 'motive', beliefConfidence: 0.15 } }
```

### Motive Confidence Growth

Motives already grow via:
- Initial assignment: pool assigns conf 0.3-0.5 based on traits
- Emergent: victimization → REVENGE_DESIRE at 0.8
- Sentiment decay: < -0.5 sentiment → PERSONAL_GRUDGE via tick handler

**New growth mechanisms** (module tick phase handler):

1. **Unresolved grudge escalation**: every N game hours, if motive belief exists and criminal hasn't acted on it, confidence grows by small delta. Frustration builds.
   ```
   if (motive.confidence < 0.9 && gameMinutesSinceCreated > 360) {
     motive.confidence += 0.05 per game day
   }
   ```

2. **Triggering events boost**: if criminal witnesses target doing something that reinforces the grudge (e.g., target getting attention, target succeeding), motive confidence gets a bump. This uses existing conversation topics and social interactions.

3. **Prevention delays**: if the player warns the target or confronts the criminal, the criminal may lay_low. During lay_low, motive doesn't grow. But lay_low expires (cooldown), and then growth resumes.

### New Affordances: argue, threaten

These are **precursor crimes** — visible warning signs that something worse is coming.

#### argue
- **Threshold**: motive conf ≥ 0.15
- **Target**: motive target
- **Steps**: move_to target → interact (argument LLM) → announce result
- **Effect**: target sentiment toward criminal drops, witnesses get memory, player can notice tension
- **CG**: ARGUMENT_WITNESSED → witnesses get low-importance memory
- **No legal consequence** — arguing isn't a crime, but it's a clue

#### threaten
- **Threshold**: motive conf ≥ 0.50
- **Target**: motive target
- **Steps**: move_to target → interact (threaten LLM) → announce result
- **Effect**: target gets THREAT_PERCEIVED motive (defensive), mood drops
- **CG**: THREAT_WITNESSED ��� witnesses get memory, may report to guard
- **Minor legal consequence** — guard may warn criminal

### Escalation Timeline (Target Gameplay)

```
Game start:
  Mark has PERSONAL_GRUDGE toward Bess (conf 0.35, from pool)
  
~30 min (morning): 
  Mark argues with Bess at market (argue affordance, conf 0.35 > 0.15)
  → Witnesses see tense exchange. Player CAN notice if present.
  
~2 hours (afternoon):
  Grudge grows to 0.45. Mark steals from Bess's herb stall (steal, conf 0.45 > 0.3)
  → If witnessed or discovered, player gets a clue about Mark's animosity.
  → If player confronts Mark, he lays low. Grudge growth pauses.
  
~4 hours (evening):
  If unpunished, grudge at 0.55. Mark threatens Bess privately (threaten, conf 0.55 > 0.50)
  → Bess is frightened, may tell player or guard. Clear warning sign.
  → If player warns Bess, she can hide/flee. Prevention possible.
  
~6 hours (night):
  If nothing stopped him, grudge at 0.75. Mark kills Bess (kill, conf 0.75 > 0.70)
  → Full crime chain begins.
```

**Key**: each step is observable, each step can be interrupted, and each interruption buys time. The player who pays attention can prevent the murder.

---

## Motive Growth Tick Handler

```typescript
registerTickPhaseHandler('motive_escalation', (ctx: TickPhaseContext) => {
  const GROWTH_INTERVAL = 60;  // check every 60 game minutes
  const GROWTH_RATE = 0.03;    // confidence growth per interval
  const MAX_CONFIDENCE = 0.95;
  const LAY_LOW_SUPPRESSES = true;
  
  for (const [id, agent] of ctx.agents) {
    if (agent.profile.isPlayer) continue;
    if (!agent.state.alive) continue;
    
    // Skip NPCs in lay_low or detained
    if (LAY_LOW_SUPPRESSES && agent.state.currentActivity === 'lay_low') continue;
    if (isStatusAbsent(agent.state.status)) continue;
    
    const motives = agent.state.beliefs?.getAllBeliefs()
      .filter(b => b.category === 'motive' && b.confidence < MAX_CONFIDENCE) ?? [];
    
    for (const motive of motives) {
      // Only grow if motive is old enough (prevent instant escalation)
      const age = ctx.gameMinute - (motive.gameDay * 1440);
      if (age < 180) continue; // at least 3 game hours old
      
      // Growth modulated by personality:
      // Low H → faster escalation (less moral restraint)
      // High N → faster escalation (more emotional volatility)
      const H = agent.profile.bigFive.honesty;
      const N = agent.profile.bigFive.neuroticism;
      const personalityFactor = (1.0 - H) * 0.6 + N * 0.4; // 0-1 range
      
      const adjustedGrowth = GROWTH_RATE * (0.5 + personalityFactor);
      motive.confidence = Math.min(MAX_CONFIDENCE, motive.confidence + adjustedGrowth);
    }
  }
});
```

---

## What is NOT in this spec

| Excluded | Why | Where |
|----------|-----|-------|
| Heat system | Separate axis — danger awareness vs crime ambition | SPEC-heat-system |
| Crime severity tiers (legal) | System response (guard warning vs trial) | Future spec |
| New CG rules for argue/threaten | Follows naturally once affordances exist | Implementation detail |
| Economic motives (debt → theft) | Economy module feature | Future |

---

## Files

| File | Changes |
|------|---------|
| `modules/src/crime-justice/affordances.ts` | Raise kill threshold to 0.7. Add argue + threaten affordances. |
| `modules/src/crime-justice/index.ts` | Register argue/threaten event types, labels, step handlers. Register motive escalation tick phase handler. |
| `modules/src/crime-justice/step-handlers.ts` | Add argue_npc and threaten_npc step handlers |
| `modules/src/crime-justice/cg-rules.ts` | Add ARGUMENT_WITNESSED and THREAT_WITNESSED cascade rules |
| `worlds/millhaven/motives.json` | Adjust initial motive confidences for new thresholds |

**Blast radius**: Zero engine changes. Module affordance data + tick handler + step handlers. Existing requirements/scoring system handles everything.

---

## Invariant Audit

- [x] A1: No module strings in engine
- [x] A2: Typed state — motive confidence is numeric, thresholds are numeric
- [x] A3: Registry entries — new affordances, new event types, new step handlers
- [x] A4: Bilateral — argue/threaten work for any agent with motives (bilateral by construction)
- [x] A5: No reflex bypass — affordance scoring presents options, LLM decides
- [x] A6: No shared engine functions modified
- [x] A7: No engine changes
- [x] A8: Economy module could add DEBT_PRESSURE → steal escalation with same mechanism
- [x] A9: Simplest correct — reuses existing motive beliefs, just adds threshold tiers + growth

---

## Test

1. Mark starts with PERSONAL_GRUDGE conf 0.35 → argues with Bess (not steal, not kill)
2. After 3 game hours, conf grows to ~0.50 → Mark threatens Bess
3. Player confronts Mark → Mark lays low → conf growth paused
4. Lay_low expires → conf resumes growing → eventually reaches kill threshold
5. Player warns Bess → Bess moves away → Mark can't find target → delayed
6. Low-H Mark (0.2) escalates faster than high-H Mark (0.7) due to personality factor
7. 5 restarts: different traits → different escalation speeds → different player windows
