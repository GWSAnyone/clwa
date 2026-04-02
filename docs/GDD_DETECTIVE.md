# CLWA: Detective Mode — Game Design Document

> Crime & Justice: первый играбельный модуль.
> Roguelike social detective — 1.5-2 часа за прогон, каждый рестарт уникален.
> Часть большего мира Shangri-La (см. VISION.md).

---

## Concept

**Genre:** Roguelike social detective
**Session:** 1.5-2 hours per playthrough
**Replayability:** Randomized NPC traits → different crimes, alliances, obstacles each run

### Elevator Pitch

You're a stranger arriving at a small settlement on an anonymous tip. Something is about to happen — but you don't know what, who, or when. Your only tools are words: questions, pressure, trust, and bluff. Each restart shuffles the deck — the honest guard becomes corrupt, the quiet herbalist becomes the killer.

---

## Player Role

**Stranger.** Not a detective by profession — but the anonymous tip and the situation naturally pull you into that role. You have no fixed class. The world defines who you are by your actions.

In Millhaven, the arrival context is the anonymous tip → detective work. In future locations, different contexts will guide different roles. But nothing stops you from:
- Ignoring the tip and helping the criminal instead
- Becoming a trader if the Economy module is active
- Playing both sides

**Your tools are social, not mechanical:**
- Ask questions, cross-reference stories
- Build trust to unlock honest answers
- Apply pressure (threats, bribes, flattery) — with consequences
- Observe NPC behavior (who avoids whom, who's nervous)
- Examine crime scenes for physical evidence
- Formally accuse suspects — but you must convince, not just point

**You are NOT:**
- A judge (Theron decides verdicts)
- A guard (Garrett makes arrests)
- All-powerful (NPCs can refuse, lie, ignore you)

---

## Core Loop

### Phase 1: Arrival (~15-20 min)
- Arrive with anonymous note: "Something terrible is about to happen in Millhaven"
- Meet residents, build first impressions
- Notice tensions (who hates whom, who's anxious, who avoids eye contact)
- Search for the tipster — **disguised tutorial** (teaches you to talk, observe, build trust)

### Phase 2: Escalation (~20-30 min)
- Minor incidents begin: arguments, petty theft, threats
- Form theories: who's dangerous, who's vulnerable, who can you trust
- Build relationships with key figures (Garrett, Theron, witnesses)
- Decide: warn potential victim? Pressure suspect? Wait and watch?

### Phase 3: Crime (~30-40 min)
- Major crime occurs — **or you prevent it**
- If prevented: criminal lies low, may try again or switch target
- If not prevented: investigation begins
- You + Garrett (if he trusts you) or you alone
- Interrogations, evidence, alibi checks. NPCs lie, forget, hide

### Phase 4: Resolution (~20-30 min)
- Build and present your case
- Trial (if major crime) — Theron evaluates evidence
- Or: cover-up, criminal escape, false conviction
- Consequences play out

---

## Tensions, Not Quests

CLWA doesn't have scripted quests. Instead: **tensions** — conflicting initial conditions between NPCs that the engine resolves organically.

A tension is not "go to X, talk to Y, collect Z." It's a set of beliefs, relationships, mood states, and secrets that create pressure. The engine simulates, the player (or no one) intervenes.

Example: "Mark owes money to Valdris lenders. Old Bess knows his spices are fake. Mark's sentiment toward Bess is -0.7. Mark's H is 0.2."

That's not a quest — it's a pressure cooker. What happens depends on randomized traits, player actions, and NPC autonomous decisions. Four players in the same situation → four different stories.

See `docs/Tensions/` in Obsidian for all defined tensions.

---

## Crime Severity Pyramid

| Tier | Examples | System Response |
|------|----------|-----------------|
| **Minor** | Brawl, petty theft, vandalism | Guard warning, overnight jail, small fine. No trial |
| **Moderate** | Major theft, blackmail, assault | Investigation, possible trial, imprisonment/exile |
| **Severe** | Murder, arson | Full chain: investigate → arrest → trial → sentence |

**Key design:** Minor crimes are **clues** to major ones. A petty theft might be the criminal testing how easy it is to evade the guard. A brawl might reveal the tension that ends in a knife.

---

## Escalation as Organic Clock

No artificial timer. Instead: **the criminal doesn't stop.**

If you do nothing:
1. Minor incidents (arguments, theft) → clues for the observant
2. Tension rises, NPC mood deteriorates, trust erodes
3. Major crime occurs (murder, arson)
4. If still nothing: criminal may flee (win for them), village falls apart

**Pacing control:** Crime escalation speed tuned so that the natural arc fits ~1.5-2 hours. Not a countdown — a pressure curve.

---

## Variability Per Playthrough

### NPC Trait Randomization
Each restart: OCEAN+H traits randomized within defined ranges per NPC archetype.

| NPC | Fixed | Randomized |
|-----|-------|------------|
| Garrett (guard) | Role, schedule, investigator flag | H (0.3-0.9): corrupt ↔ principled. C: rigid ↔ flexible |
| Mark (merchant) | Role, shop, schedule | H (0.1-0.7): con artist ↔ honest trader. N: cool ↔ paranoid |
| Ted (bartender) | Role, schedule | A (0.3-0.9): helpful ↔ hostile. H: honest ↔ watering ale |
| Hilda (blacksmith) | Role, schedule | A (0.1-0.6): empathetic ↔ cold. N: stoic ↔ volatile |
| Bess (herbalist) | Role, schedule | H (0.5-0.9): cryptic ↔ direct. E: hermit ↔ social |
| Aldric (priest) | Role, schedule | A (0.6-0.95): gentle ↔ rigid moralist. N: serene ↔ anxious |
| Elara (bard) | Role, schedule | H (0.3-0.7): loyal ↔ self-serving. A: caring ↔ manipulative |
| Theron (judge) | Role, schedule, canSentence | H (0.7-0.95): just ↔ legalistic. A (0.2-0.6): merciful ↔ harsh |

**Result:** Same cast, different personalities, different crimes, different alliances.

### Garrett Variability (Key Dynamic)
Garrett is the **pivot character** — your relationship with him defines the run:

| Garrett Type | H Range | Behavior |
|-------------|---------|----------|
| **Principled** | 0.7-0.9 | Investigates honestly. Trusts evidence. Cooperates if you prove yourself |
| **Lazy** | 0.5-0.7 | Does minimum. Needs your help but won't admit it. Slow to act |
| **Corrupt** | 0.3-0.5 | Can be bribed. May protect the criminal. May frame innocents |

Player doesn't know which Garrett they got. Must discover through interaction.

---

## Player Agency Branches

| Path | What You Do | Outcome |
|------|-------------|---------|
| **Solve** | Gather evidence, build trust, present case | Correct conviction. Best ending |
| **Prevent** | Warn victim, confront suspect before crime | Crime averted. But suspect still free |
| **Mistake** | Accuse wrong person with weak evidence | Innocent jailed, real criminal continues |
| **Complicit** | Help criminal (cover evidence, mislead guard) | Become accomplice. Unique ending |
| **Expose** | Discover Garrett is corrupt, expose him | Political crisis. Town in chaos |
| **Fail** | Do nothing or fail to convince anyone | Criminal escapes or kills again |

**No "game over."** Every outcome is a story. Restart for a different one.

---

## Accusation System

Player can't just point and say "he did it." Must build a convincing case.

**Formal accusation flow:**
1. Player tells Garrett (or Theron): "I believe [NPC] committed [crime]"
2. System evaluates: what evidence supports this? (player's gathered beliefs + presented evidence)
3. NPC (Garrett/Theron) evaluates based on:
   - Their trust in you
   - Evidence quality (beliefs with high confidence)
   - Their own beliefs (do they already suspect this person?)
   - Their personality (corrupt Garrett may dismiss valid evidence)
4. If convinced → arrest/trial proceeds
5. If not convinced → reputation damage, trust drops

**Wrong accusation consequences:**
- Accused NPC becomes hostile (sentiment drops sharply)
- Other NPCs who liked the accused distrust you
- Real criminal gains time
- If innocent is actually convicted → crimes continue → you realize the error

---

## Crime Prevention

Player can try to stop crime before it happens:

| Method | How | Risk |
|--------|-----|------|
| **Warn victim** | Tell potential victim about danger | Victim may flee, hide, or not believe you |
| **Confront suspect** | Pressure suspect directly | May back down, lie low, or escalate faster |
| **Alert guard** | Tell Garrett to watch suspect | Garrett may not trust you, or may be corrupt |
| **Change conditions** | Separate victim from suspect, improve mood | Temporary — criminal may wait for another chance |

**If crime is prevented:** Criminal doesn't disappear. They recalculate: new target, new timing, or give up (rare). Prevention is a temporary victory — must still address the root cause.

---

## Anonymous Tip (Meta-Mystery)

The anonymous note that brought you here is itself a mystery:
- **Who sent it?** One of the NPCs. Identity varies per playthrough.
- **Why?** Depends on sender: fear (victim sensing danger), guilt (friend of criminal), manipulation (someone using you)
- **Discovery:** Optional objective. Finding the tipster reveals deeper context about the crime

**Serves as tutorial:** While searching for the tipster, you naturally talk to everyone, learn the social dynamics, build initial trust. You're learning to play while pursuing a narrative goal.

---

## End-of-Run Summary

When the scenario resolves (or player decides to leave), show:

- **Timeline:** What happened, in what order, with timestamps
- **Your accuracy:** Who you suspected vs. who actually did it
- **Relationship map:** Final trust/sentiment with all NPCs
- **Key moments:** Decisions that changed the outcome
- **The tipster:** Revealed (if not discovered during play)
- **Alternate paths:** "If you had talked to Hilda on Day 1, you would have learned..."

---

## What Exists vs. What's Needed

### Already Working (Engine)
- [x] 8 NPCs with OCEAN+H, Enneagram, schedules, secrets, shops
- [x] 19 affordances (crime, duty, social) with declarative steps
- [x] Full crime chain: steal/murder → investigate → arrest → trial → sentence
- [x] Intent Layer v2: player speech → structured effects (claims, requests, pressure)
- [x] Belief system with confidence, sources, transfer, decay
- [x] Trust/sentiment relationships with evolution
- [x] TopicEngine v3.1 (13 topic sources)
- [x] Clock-driven architecture (Master Clock, ProcessingQueue, NPC state machine)
- [x] Web UI: Canvas2D, chat, event feed, NPC Mind panel
- [x] Evidence system with crime scenes and discoverable facts
- [x] Criminal behavior: flee, destroy evidence, intimidate witnesses, blackmail
- [x] Secret directives (criminal denial, cover-up, witness eagerness)
- [x] Perception system (canSee, canHear, co-location)

### Must Build (Game Layer)

| # | Feature | Complexity | Description |
|---|---------|-----------|-------------|
| 1 | **Scenario Manager** | Medium | New game / restart / state tracking (phase, crime status, run outcome) |
| 2 | **Trait Randomization** | Low | Randomize OCEAN+H within ranges at game start. Different run = different personalities |
| 3 | **Crime Escalation** | Medium | Criminal starts small, escalates if unpunished. Escalation state per criminal NPC |
| 4 | **Crime Severity Tiers** | Medium | Minor/moderate/severe classification. Proportional system response |
| 5 | **Player Accusation** | Medium | Formal "I accuse X" mechanic through IL → evidence evaluation → NPC response |
| 6 | **Crime Prevention** | Medium | Warn victim, confront suspect, alert guard — new IL actions + affordance responses |
| 7 | **Heat System** | Low-Med | Criminal tracks danger level. High heat → flee or lay low. Bribed Garrett → low heat |
| 8 | **Win/Lose Detection** | Medium | Track case state. Detect outcomes (correct solve, wrong accusation, escape, prevention) |
| 9 | **Session Arc** | Medium | Arrival event, anonymous tip, pacing hooks (tension tracking), resolution detection |
| 10 | **End-of-Run Summary** | Low-Med | Summary screen: timeline, accuracy, relationships, alternate paths |
| 11 | **Garrett Variability** | Low | Part of trait randomization + corruption-specific affordances/behaviors |
| 12 | **Anonymous Tip** | Low | Intro narrative, tipster identity selection, discovery as secondary objective |

---

## Milestone Roadmap

### Milestone 1: Replayable Crime (v0.11)
> Each restart produces a different crime scenario.

**Build:**
- ~~Scenario Manager (new game, restart, clean state)~~ ✅
- ~~Trait randomization (OCEAN+H ranges per NPC archetype)~~ ✅
- ~~Mood randomization (starting mood ranges)~~ ✅
- ~~Relationship randomization (sentiment/trust variance)~~ ✅
- Motive network expansion (more NPC motive pairs)
- Conditional motives (motives activate/deactivate per seed based on traits + sentiment)
- ~~Crime severity tiers~~ → moved to Milestone 3 (needs more crime types first)

**Result:** Start game → NPCs have different personalities AND different motives → different crime emerges → different investigation. Core replayability works.

**Test:** 5 restarts produce at least 3 distinct scenarios (different criminal, different crime type, different victim).

**Specs:** `SPEC-trait-randomization` ✅ | `SPEC-mood-relationship-randomization` ✅ | `SPEC-scenario-manager` ✅ | `SPEC-scenario-variety` (in progress)

---

### Milestone 2: Detective Toolkit (v0.12)
> Player can actively investigate and act, not just watch.

**Build:**
- ~~Player accusation mechanic (IL → evidence evaluation → NPC response)~~ ✅ backend
- ~~Crime prevention (warn victim, confront suspect, alert guard)~~ ✅ backend
- ~~Evidence presentation (show gathered evidence to NPC → belief transfer)~~ ✅ backend
- ~~Journal improvements (track suspects, evidence, theories)~~ ✅ backend
- Web UI: evidence selector, journal grouping, suspect toggle (pending)

**Result:** Player has real tools. Can gather clues, cross-reference, warn, accuse. Investigation is interactive.

**Specs:** `SPEC-journal-v2` ✅ | `SPEC-evidence-presentation` ✅ | `SPEC-player-accusation` ✅ | `SPEC-crime-prevention` ✅ | `SPEC-conversation-session` (pending)

**Test:** Player can prevent a crime by warning the victim. Player can convict the right criminal by building a case.

---

### Milestone 3: Living Opposition (v0.13)
> Investigation has real obstacles and stakes.

**Build:**
- Garrett variability (principled/lazy/corrupt per run)
- Crime severity tiers + proportional response (minor → warning, major → full chain)
- Criminal escalation (small crimes → big crimes if unpunished)
- Heat system (criminal monitors danger, flees when too high)
- NPC resistance (lies, cover-ups, refusal to cooperate)
- Wrong accusation consequences (trust damage, real criminal continues)

**Result:** Investigation is challenging. Garrett may help or hinder. Criminal doesn't just wait to be caught. Mistakes have consequences.

**Test:** Corrupt Garrett run: player must work around or expose him. Criminal escalates from theft to murder across 30 game minutes.

---

### Milestone 4: Complete Session (v0.14)
> Full game loop from arrival to credits.

**Build:**
- Arrival event + anonymous tip intro
- Tipster identity (randomized, discoverable)
- Win/lose detection (correct solve, wrong accusation, escape, prevention, complicity)
- End-of-run summary screen
- Tension/pacing system (ensure natural 1.5-2h arc)
- Session tuning (crime frequency, escalation speed, NPC responsiveness)

**Result:** Complete playable experience. Start → investigate → resolve → see results → restart with different scenario.

**Test:** 3 complete playthroughs, each ~1.5-2h, each with different outcome.

---

### Milestone 5: Polish & Demo (v0.15)
> Playable demo ready to show.

**Build:**
- UI improvements: case journal, evidence board, suspect tracker
- Day/night visual overlay
- Map decorations (Tiny Swords assets)
- Sound design (ambient, notification sounds)
- Tutorial polish (anonymous tip as guided intro)
- Balance pass: difficulty, pacing, NPC dialogue quality

**Result:** Demo-quality experience. Can be shown to others, played independently.

**Test:** Someone who hasn't seen the project can play and understand what to do within 5 minutes.

---

## Design Principles

1. **Words are weapons.** No combat, no inventory puzzles. Everything through dialogue and observation.
2. **Trust is currency.** NPCs don't cooperate because you're the player. They cooperate because you earned it.
3. **Every run is a story.** No "correct" playthrough. Failure is interesting.
4. **The world doesn't wait.** If you sit in the tavern, the criminal acts. Observation is passive; investigation is active.
5. **No artificial markers.** No quest arrows, no "talk to Garrett" prompts. You figure it out.
6. **Uncertainty is the game.** You're never 100% sure who did it. Neither are the NPCs.
7. **Tensions, not quests.** Initial conditions create pressure. The engine resolves them. The player intervenes or doesn't.

---

## Anti-Example: Crimson Desert

$125M budget, beautiful world, dead NPCs. Crimson Desert's core failure: scale without depth.

| Crimson Desert Problem | CLWA Solution |
|----------------------|---------------|
| Story: scripted, incoherent | Story: emergent from NPC decisions |
| Quests: marker chasing | No quests. Situations you choose to engage with |
| NPCs: decorations | NPCs: decide, remember, change relationships |
| Protagonist: empty shell | Player: identity through actions |
| No multiplayer | Architecturally prepared (bilateral design) |

**Lesson:** Go from depth to scale, not scale to depth. One village that truly lives > 100 locations that are scenery.

---

*Updated April 3, 2026*
*Long-term vision: see VISION.md*
