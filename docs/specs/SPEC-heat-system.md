# SPEC: Heat System — Criminal Danger Awareness and Adaptive Behavior

> **Milestone**: M3 (Living Opposition)
> **Status**: spec
> **Depends on**: CG v2 (done), existing affordance scoring, beliefModifiers, secret directives
> **Engine changes**: None. Pure module data — beliefModifiers, secret directive builders, CG rules.

---

## Problem

The criminal NPC is reactive but not adaptive. After committing a crime:
- `subjectReacts` on WANTED_STATUS triggers a single reactive volition evaluation
- Secret directives tell the NPC to deny, but with no escalation
- The criminal doesn't track how much the investigation has progressed
- Whether 1 witness or 5 witnesses + guard investigating + player confronting — same behavioral response

**GDD target**: Criminal monitors danger level. High heat → flee or lay low. Corrupt Garrett → low heat. Criminal who feels safe → escalates to bigger crimes.

---

## Design: Heat as Perceived Danger

Heat is **not** a new subsystem or numeric state. Heat is the criminal's **perception of danger**, derived from what they know (beliefs, events received, player interactions).

### Core Principle

The criminal doesn't have perfect information. They know:
- They committed the crime (perpetrator belief)
- If they were seen (witnesses present at crime scene)
- If they overheard rumors about themselves (at public places)
- If the player confronted them (IL pressure)
- If they were explicitly told they're wanted (WANTED_STATUS reactive)

What they DON'T know (unless informed):
- Whether the guard is investigating
- How many witnesses exist
- What evidence has been gathered
- What the player told the guard

This asymmetry IS the gameplay. A smart player gathers evidence quietly; a reckless player tips off the criminal.

### Heat Inputs (criminal's perspective)

| Source | How criminal learns | Heat contribution |
|--------|-------------------|-------------------|
| **Witnessed** | Was at crime scene, saw witnesses | Believes witnesses exist |
| **Rumor overheard** | At public place when RUMOR_SPREAD fires | People are talking |
| **Player confrontation** | IL pressure (threaten, accuse) | Someone suspects me |
| **Guard questioning** | Guard interacts with criminal | Authority is involved |
| **Wanted status** | subjectReacts → reactive volition | I'm officially wanted |
| **Time since crime** | Game minutes elapsed | Increasing paranoia |
| **No witnesses seen** | No one at crime scene | Feeling safe (negative heat) |

### Mechanism: beliefModifiers + Secret Directives

No new engine code. Two module-level mechanisms:

#### 1. Affordance beliefModifiers (existing pattern)

Current affordances already use `beliefModifiers` to check agent beliefs and adjust utility. Example from kill:
```typescript
beliefModifiers: [
  { beliefCategory: 'motive', multiplier: 1.5 },
]
```

**New beliefModifiers for crime affordances:**

```typescript
// On flee affordance:
beliefModifiers: [
  // Criminal who knows witnesses exist → flee is attractive
  { beliefSource: 'perpetrator', whenHasWitnessBeliefs: true, bonus: 0.15 },
  // Criminal who heard rumors → more urgency
  { beliefSource: 'perpetrator', whenHasRumorBeliefs: true, bonus: 0.10 },
]
```

Wait — `beliefModifiers` currently only support `beliefCategory` and `multiplier`. Extending them for heat-specific checks would add module knowledge to the engine's beliefModifier evaluation.

**Better approach**: use a REQUIREMENT_CHECKER that computes a heat score, then a beliefModifier-like mechanism that reads it.

Actually, the SIMPLEST approach: **compute heat in the secret directive builder.** The criminal already gets secret directives injected into their system prompt. The directive builder has full access to the criminal's beliefs and the world state. The heat score can be computed there and expressed as vivid instinct prose.

#### 2. Secret Directive Enhancement (existing pattern)

Current secret directives (in SECRET_DIRECTIVE_BUILDERS registry):
- Criminal NPC gets directives about denial, cover-up
- But these are static — same text regardless of investigation state

**Enhanced heat-aware directives:**

```typescript
registerSecretDirectiveBuilder('heat_awareness', (agent, ctx) => {
  if (!isPerpetrator(agent)) return null;
  
  const heat = computeHeat(agent, ctx);
  
  if (heat >= 0.8) {
    return `EXTREME DANGER: You know the investigation is closing in. You must flee or find a way to destroy evidence immediately. Every moment you stay increases the risk of arrest.`;
  }
  if (heat >= 0.5) {
    return `You sense danger. People are talking, and the guard may be investigating. Be cautious — avoid suspicious behavior, consider laying low, and think about silencing anyone who knows.`;
  }
  if (heat >= 0.2) {
    return `You're somewhat worried. There may have been witnesses, and rumors could be spreading. Stay alert but don't panic — act normal, avoid the scene of the crime.`;
  }
  return `You believe no one knows what you did. You feel relatively safe, but remain vigilant.`;
});
```

#### 3. Heat Computation (module function)

```typescript
function computeHeat(agent: Agent, ctx: WorldContext): number {
  let heat = 0;
  const beliefs = agent.state.beliefs?.getAllBeliefs() ?? [];
  
  // Base: perpetrator always has some paranoia (time-based)
  const perpetratorBelief = beliefs.find(b => isPerpetrator(b.source));
  if (!perpetratorBelief) return 0; // not a perpetrator
  
  // Time since crime → gradual paranoia increase (capped)
  const minutesSinceCrime = ctx.gameMinute - (perpetratorBelief.gameDay * 1440);
  heat += Math.min(0.15, minutesSinceCrime / 1440 * 0.1); // +0.1 per game day, max 0.15
  
  // Was seen by witnesses (criminal was at scene, others present)
  const witnessBeliefs = beliefs.filter(b => 
    b.source === 'witness' && b.eventType === perpetratorBelief.eventType
  );
  if (witnessBeliefs.length > 0) heat += 0.2;
  
  // Overheard rumors about self
  const rumorBeliefs = beliefs.filter(b =>
    b.source === 'rumor' && b.subject === agent.profile.name
  );
  heat += rumorBeliefs.length * 0.15;
  
  // Was confronted by player (lastInteractionOutcome or pressure beliefs)
  if (agent.state.lastInteractionOutcome?.type === 'denial' ||
      agent.state.lastInteractionOutcome?.type === 'deflection') {
    heat += 0.2; // was questioned/accused
  }
  
  // WANTED_STATUS reactive events received
  // (tracked via belief with source 'testimony' about own crime)
  const wantedBeliefs = beliefs.filter(b =>
    b.source === 'testimony' && b.subject === agent.profile.name
  );
  if (wantedBeliefs.length > 0) heat += 0.3;
  
  // Guard at same location → immediate danger boost
  for (const [, other] of ctx.agents) {
    if (other.profile.investigator && other.state.location === agent.state.location) {
      heat += 0.15;
      break;
    }
  }
  
  return Math.min(1.0, heat);
}
```

### Heat → Behavior Mapping

| Heat Level | Range | Criminal Behavior | Affordance Impact |
|-----------|-------|-------------------|-------------------|
| **Safe** | 0.0-0.2 | Normal behavior, may escalate | Crime affordances normal |
| **Uneasy** | 0.2-0.4 | Cautious, avoids crime scene | Crime locations get penalty |
| **Anxious** | 0.4-0.6 | Active concealment, avoids guard | destroy_evidence/intimidate boost |
| **Panicked** | 0.6-0.8 | Lay low, isolate | lay_low gets large boost |
| **Desperate** | 0.8-1.0 | Flee or extreme measures | flee gets massive boost |

### Integration Points

1. **Secret directive builder** (primary): heat-aware prose injected into criminal's system prompt. LLM reads it and factors into all decisions. This is the PM=instinct mechanism — vivid prose creates behavioral pressure.

2. **Affordance instinctContext** (secondary): heat level affects how instinct builder describes crime vs. self-preservation affordances. High heat → flee instinct is vivid ("your life is at stake"), crime instinct is muted ("too risky right now").

3. **Mood modifier** (tertiary): high heat creates anxiety mood modifier. This feeds into moodCurve which affects all affordance utility scores. A panicked criminal has lower mood → different decision landscape.

---

## What is NOT in this spec

| Excluded | Why | Where it belongs |
|----------|-----|-----------------|
| Corrupt Garrett suppressing heat | Garrett variability is a separate feature | SPEC-garrett-variability |
| Criminal escalation (minor → major) | Different axis — crime ambition, not danger awareness | SPEC-criminal-escalation |
| Player heat tracking | Player isn't an NPC, doesn't need instinct/directive system | N/A |
| Guard suspicion system | Guard perspective is investigator affordances, not heat | Existing investigate/arrest |

---

## Implementation Plan

### Phase 1: Heat computation + secret directive (minimal)
1. Add `computeHeat()` function in crime-justice module (new file: `heat.ts`)
2. Register heat-aware secret directive builder
3. Test: commit crime → time passes → criminal's system prompt reflects increasing paranoia

### Phase 2: Mood integration
1. Register a tick phase handler that computes heat for perpetrator NPCs
2. Create anxiety mood modifier proportional to heat
3. Test: high heat → mood drops → crime affordances less attractive (moodCurve)

### Phase 3: Affordance context (optional, may not be needed)
1. If LLM doesn't respond well enough to directive prose alone, add heat to instinctContext
2. Test: "You feel hunted" vs "You feel safe" changes LLM decisions

---

## Files

| File | Changes |
|------|---------|
| `modules/src/crime-justice/heat.ts` | New: computeHeat(), getHeatLevel() |
| `modules/src/crime-justice/index.ts` | Register heat secret directive builder, heat mood tick handler |
| `modules/src/crime-justice/event-handlers.ts` | None (heat reads existing beliefs, no new events needed) |

**Blast radius**: Zero engine changes. Module-only. Heat reads existing state (beliefs, relationships, location), produces output through existing mechanisms (directives, mood modifiers).

---

## Invariant Audit

- [x] A1: No module strings in engine — heat is module-only
- [x] A2: All state typed — heat is computed, not stored (no new state)
- [x] A3: New behavior = registry entries — secret directive builder, tick phase handler
- [x] A4: Bilateral — N/A (heat is criminal-only by design; player doesn't have instincts)
- [x] A5: No reflex bypass — heat influences through directives (LLM decides), not hard behavior
- [x] A6: No shared functions modified
- [x] A7: No engine changes at all
- [x] A8: Economy test — FRAUD perpetrator would get heat from same mechanisms
- [x] A9: Simplest solution — reads existing beliefs, outputs through existing mechanisms

---

## Test

1. Crime committed, no witnesses → heat ~0.1, directive says "you feel safe"
2. Crime with witnesses → heat ~0.3, directive says "be cautious"
3. Player confronts criminal → heat jumps to ~0.5, directive mentions danger
4. WANTED_STATUS fires → heat ~0.7, directive urges fleeing
5. Guard at criminal's location + wanted → heat ~0.85, directive is desperate
6. Different personality criminals respond differently (LLM interprets same heat directive through their personality lens)
