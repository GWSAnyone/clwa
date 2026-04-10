# SPEC-web-ui-m2: Detective Gameplay UI

> **Status:** IMPLEMENTED (2026-04-08)
> **Depends on:** SPEC-player-accusation, SPEC-evidence-presentation, SPEC-crime-prevention, SPEC-journal-v2
> **Goal:** After implementing this spec, a player can sit down and play a complete detective scenario — from crime discovery through investigation to resolution — entirely through the Web UI, using natural language.

---

## Problem

M2 backend is complete: accusation, evidence presentation, crime prevention, journal v2 all work through IL. But the Web UI doesn't expose most of these mechanics. Crime scene examination is hardcoded to a single point. Case progress is invisible. The player doesn't know what investigative options exist. The game looks like a chat simulator, not a detective game.

### Current state (audit results)

| Component | Status | Grade |
|-----------|--------|-------|
| Evidence presenter (select & send) | Working | A- |
| Journal (tabs, suspects, case quality) | Working | B+ |
| IL effect badges | Working | A |
| Chat panel (streaming, mind accordion) | Working | B+ |
| Crime scene examine | **Broken** — hardcoded point 0 | D |
| Investigative guidance | **Missing** | F |
| Case review | **Missing** | F |
| Realtime WS updates (state:update) | **Missing** | F |
| WS handlers (journal:entry, crime:scene) | Working, needs extension | C+ |

### Bugs found during audit

1. **XSS in event feed** — `renderEventFeed` uses `innerHTML` without `escapeHTML` on LLM-generated text
2. **Examine hardcoded to point 0** — `fetch(/api/examine/${locationId}/0)` ignores all other examination points
3. **Detained label drawn twice** — lines ~2099 and ~2155 in game.js
4. **Dead code** — broken color conversion in `drawActionEffects` (line ~750), immediately overwritten

---

## Decisions & Trade-offs

### D1: Natural language only — no action buttons

**Problem:** Player doesn't know they can accuse, warn, confront NPCs. The obvious fix is action buttons. But buttons transform the game from "talk to a living character" into "pick a dialogue option". This contradicts the core design: emergent narrative through natural conversation.

**Decision:** No action buttons. Instead: **Detective Intuition hints** — contextual narrative nudges that suggest investigative avenues without prescribing words. The player always types their own message.

**Reliability concern:** 9B model parses player intent via IL at ~60% for morally complex verbs. Without structured buttons, some actions may misparse.

**Mitigation:**
1. The NPC still RESPONDS to the text naturally even if IL doesn't extract the structured action. "I accuse you of murder!" → NPC reacts to being accused regardless of whether IL fires the formal accusation mechanic.
2. Evidence attachment (evidenceIds) already provides structured signal. Evidence + talking to guard = accusation context. Server can infer intent from conversation context without explicit action metadata.
3. The conversation IS the game. Structured effects (belief creation, goal triggers) are engine internals that enhance consistency. If they fire 60% of the time, the 40% isn't "broken" — the NPC just interpreted things differently. That's emergent.
4. For critical paths (formal accusation with verdict), the evidence presentation system (already structured, A- rating) carries the mechanical weight.

**What we explicitly reject:** `actionHint`, structured action buttons, predefined dialogue choices, auto-send templates. All player communication is natural language + optional evidence attachment.

### D2: No case strength score visible to player

**Problem:** Player needs to know when they have enough evidence to accuse. The obvious fix is a "case strength meter" or "Ready to accuse" indicator.

**Decision:** No aggregate score or readiness indicator shown to the player. Show the evidence breakdown (categories + details) and let the player judge for themselves.

**Why:** A real detective doesn't have a "conviction probability" meter. They review evidence, form a judgment, and take a risk. If they accuse with weak evidence, the guard may dismiss it — that's gameplay feedback. The OUTCOME of the accusation is the feedback, not a preemptive score. This preserves tension and player agency.

### D3: NPC response IS the feedback

**Problem:** IL effects (belief created, mood changed, goal triggered) are invisible side-effects. Should we show them prominently?

**Decision:** No prominent effect summaries. The NPC's dialogue response IS the feedback. If you confront a suspect, the LLM generates their reaction (denial, nervousness, confession). That reaction is the game.

IL badges remain for power users who want to see the mechanical details. They're already implemented and rated A. But no new "effect summary" UI.

### D4: Bilateral design

All UI components read data through agent-scoped APIs (`/api/beliefs/:id`, `/api/relationships/:id`). Journal is inherently player-scoped. For multiplayer (VISION.md), each player connects the same UI with their own agent ID.

**Required:** Add `id` field to `GET /api/player` response so client knows the player's agent ID for belief/relationship queries.

### D5: 60% IL parsing — controlled risk

Non-critical actions (warn, confront) depend entirely on IL parsing natural language. At ~60% reliability, ~40% of attempts won't trigger structured game effects (defensive goal, mood modifier). The NPC still responds naturally to the text.

**Why acceptable for M2:** Crime prevention is advanced gameplay, not critical path. The formal accusation (critical path to resolution) uses evidence attachment (structured) and doesn't depend on IL text parsing.

**Monitoring:** Track IL success rate in gameplay via `il_result` WS events. If critical actions systematically fail to parse, reconsider for M3. Possible M3 solutions: (a) "speaking tone" selector (inform / warn / accuse) — not action buttons, but emotional context; (b) server-side conversation context inference (evidence attached + guard = accusation context).

### D6: Data-driven, not hardcoded

- Hints built from player beliefs, journal state, NPC capabilities — not hardcoded strings
- Crime types, event labels — from backend registry data, not UI constants
- Evidence categories — from journal entry data, not UI enum
- Examination points — from backend scene data, not fixed list

---

## Design Principles

1. **Natural language first.** Every interaction through conversation. No dialogue menus, no action buttons. The player speaks, the world responds.
2. **Guide, don't command.** Show the player what's possible through narrative hints and information displays. Never prescribe words or actions.
3. **Extend, don't redesign.** Evidence presenter and journal work well. Add to them, don't rebuild.
4. **Context over clutter.** Show info relevant to the current NPC and player knowledge. Hide what's irrelevant.
5. **Match existing theme.** Glassmorphism dark panels, `rgba(20,28,38,0.65)` backgrounds, `backdrop-filter: blur`, amber/blue accents.

---

## Tier 1: Bug Fixes

### 1.1 XSS in event feed

`renderEventFeed()` — wrap `e.time` and `e.text` in `escapeHTML()`:

```js
feed.innerHTML = state.events.map(e =>
  `<div class="feed-item ${e.cls}"><span class="time">${escapeHTML(e.time)}</span> ${escapeHTML(e.text)}</div>`
).join('');
```

### 1.2 Detained label dedup

Remove the first DETAINED draw block (~lines 2098-2104). Keep the second one (~2154-2161) which draws the gray overlay + label.

### 1.3 Dead code removal

Remove the broken `ctx.strokeStyle = fx.color.replace(')' ...)` line (~750) that's immediately overwritten by correct hex→rgba conversion on the next lines.

### 1.4 Player ID in API

Add `id` field to `GET /api/player` response:

```js
return Response.json({
  id: player?.profile.id,  // ← add
  location: world.playerLocation,
  mood: player?.state.mood,
  // ...
});
```

Client stores `state.player.id` on init, uses for `/api/beliefs/${state.player.id}`.

---

## Tier 2: Core M2 Features

### 2.1 Detective Intuition Hints

**What:** A contextual narrative line above the chat input, representing the player character's inner detective sense. Suggests investigative avenues without prescribing dialogue.

**Why:** The player needs discoverability (know what's possible) without losing agency (choose their own words).

**Layout:**

```
┌─────────────────────────────────────┐
│ [Chat messages area]                │
│                                     │
├─────────────────────────────────────┤
│ 💡 You have evidence linking Mark   │  ← Detective Intuition hint
│    to the crime. This might be the  │
│    time to press him on it.         │
├─────────────────────────────────────┤
│ 📎 Evidence (3)                     │  ← Existing evidence bar
├─────────────────────────────────────┤
│ [Type a message...          ] [Send]│
└─────────────────────────────────────┘
```

**Hint templates by context:**

| Context | Hint text |
|---------|-----------|
| NPC is marked suspect + player has evidence | "You have evidence linking {name} to the crime. This might be the time to press them on it." |
| NPC is marked suspect + no evidence | "Something about {name} doesn't sit right. You might try asking about their whereabouts." |
| NPC is investigator + player has crime beliefs | "The guard could help investigate. You could share what you've learned about the crime." |
| NPC is potential victim (player has threat beliefs about someone else targeting them) | "You've heard {name} might be in danger. They deserve to know." |
| NPC has relationship with a suspect (from relationships data) | "{name} knows {suspect} well. They might have information." |
| No special context | No hint shown. Clean chat. |

**Context data sources:**
- `suspects`: from `GET /api/journal/suspects` (already fetched)
- `evidence about NPC`: journal entries filtered by suspect ID
- `investigator flag`: from NPC profile (`state.agents[id].profile.investigator`)
- `player crime beliefs`: `GET /api/beliefs/${state.player.id}` (requires 1.4)
- `NPC relationships`: `GET /api/relationships/${npcId}` (already fetched for Mind accordion)
- `{name}`, `{suspect}`: display names from `state.agents`

**Priority:** When multiple contexts apply, show the most specific hint. Priority order: has evidence about this NPC > suspect without evidence > investigator > potential victim > knows suspect > none.

**Multiple crimes/suspects:** If NPC is a suspect in multiple cases, hint references the case with the most evidence (highest entry count). If NPC is an investigator and player has multiple crime beliefs, hint uses generic "the crime" without specifying which. The player decides what to discuss.

**Implementation:**
- New `<div id="detective-hint">` between chat messages and evidence bar
- On chat open: `updateDetectiveHint(npcId)` evaluates contexts, renders top-priority hint
- On `journal:entry` WS event: re-evaluate hint if chat is open (new evidence may change context)
- Style: italic text, muted amber color (`#b89a50`), small font, `rgba(180,140,50,0.08)` background. Blends with theme, doesn't dominate.
- Dismissable: small × button. Hint stays dismissed for this chat session, reappears on next chat open.
- If no context applies: `detective-hint` is hidden. No empty box.

**What this is NOT:**
- Not action buttons. No clicks trigger messages.
- Not dialogue options. Player formulates their own words.
- Not tooltips or tutorials. It's the character's investigative instinct.

### 2.2 Crime Scene Examination

**What:** Replace single-button examine with a narrative panel listing examination points at a crime scene.

**Why:** Backend supports N examination points per crime scene. Currently UI only examines point 0. Player misses most evidence.

**Flow:**
1. Player enters crime scene location
2. Examination panel appears with narrative framing:

```
┌─ Crime Scene ────────────────────────┐
│ You survey the scene and notice      │
│ several things worth investigating:  │
│                                      │
│ ┌───────────────────────────────────┐│
│ │ 🔍 A body crumpled near the      ││
│ │    market stalls                  ││
│ │              [Look closer]        ││
│ ├───────────────────────────────────┤│
│ │ 🔍 A dark trail leading east     ││
│ │              [Follow it]          ││
│ ├───────────────────────────────────┤│
│ │ ✓ Broken merchant stall          ││
│ │    You found a torn piece of      ││
│ │    fabric caught on a nail.       ││
│ └───────────────────────────────────┘│
│                            [Leave]   │
└──────────────────────────────────────┘
```

3. Each action button: `POST /api/examine/:locationId/:pointId` (pointId = `point.id`, a string UUID)
4. On success: animate point → narrative discovery text (from `point.clueText`), mark as done, toast + journal update via WS
5. Already-examined points show what was found (muted text, no button)

**Narrative framing rules:**
- Panel header: "You survey the scene and notice several things worth investigating:"
- Action verbs vary by `point.type`: "Look closer" / "Follow it" / "Pick it up" / "Inspect" — heuristic based on `type` field (body → "Look closer", trail → "Follow it", object → "Pick it up", default → "Inspect")
- Discovery text: first-person narrative using `point.clueText`. "You find a torn piece of fabric caught on a nail." Not "Found: Torn fabric."
- All examined: "You've examined everything at this scene." + Leave button.

**API (verified from `world-types.ts` and `routes.ts`):**

```ts
// GET /api/crime-scene/:locationId
{
  id: string,
  locationId: string,           // slug ID, not display name
  crimeType: string,
  gameDay: number,
  active: boolean,
  points: ExaminationPoint[],   // field name is "points", NOT "examinationPoints"
  perpetrator?: string,         // display name (resolved by server)
  victim?: string               // display name (resolved by server)
}

// ExaminationPoint (from world-types.ts)
{
  id: string,        // UUID — used in POST /api/examine/:locationId/:pointId
  type: string,      // module-defined type (e.g. "body", "bloodstain", "weapon")
  description: string, // what the player sees before examining
  clueText: string,  // the clue revealed after examination
  examined: boolean   // has this point been examined
}

// POST /api/examine/:locationId/:pointId → returns journal entry + evidence data
```

**Note:** `examined` is a single boolean, not per-player. Acceptable for M2 (single player). For multiplayer: `examined: Set<playerId>` — documented as known architectural debt.

**Fallbacks:**
- API 404 → no panel (not a crime scene)
- Empty `points` array → "Nothing to examine" toast, close
- POST examine fails → toast "Something went wrong", keep button enabled for retry

**Interaction with chat:** Examine panel and chat panel are mutually exclusive. Opening chat hides examine panel. Closing chat restores examine panel if scene has unexamined points.

**Implementation:**
- New `<div id="examine-panel">` — glassmorphism panel, bottom-center, doesn't overlap chat
- Player location change → check `GET /api/crime-scene/:locationId`
- Points render as `<div class="examine-point">` — `point.description` + button or completed `point.clueText`
- Button click → `POST /api/examine/${locationId}/${point.id}` → animate transition (fade button → show clueText) → `journal:entry` WS handles journal update

### 2.3 Case Review

**What:** Evidence review view for a suspect in the journal. Shows collected evidence organized by category. No aggregate score, no readiness meter — player reviews and judges for themselves.

**Why:** Player needs to review their case before making decisions. But showing "Case Strength: 73% STRONG — Ready to accuse" removes detective agency. The player should feel the weight of their evidence and decide.

**API response (from `journal.ts` `getCaseSummary`):**

```ts
{
  suspectId: string,
  suspectName: string,
  entries: JournalEntry[],
  evidence: Record<string, number>,  // { physical: 2, witness: 3, motive: 1 }
  totalScore: number,                // 0.0–1.0 (NOT shown to player)
  quality: string,                   // NOT shown to player
  summary: string                    // "2 physical, 3 witness, 1 motive"
}
```

**Layout (inside journal panel, replaces entry list for selected suspect):**

```
┌─ Case File: Mark Blackwood ──────────┐
│                                      │
│ Evidence Collected:                  │
│  Physical evidence — 2 pieces        │
│  Witness accounts  — 3 testimonies   │
│  Motive indicators — 1               │
│                                      │
│ ─── Details ───                      │
│  ⬥ Weapon found at the scene         │
│    (physical, discovered at Market)  │
│  ⬥ Bess saw Mark near the body       │
│    (witness, from conversation)      │
│  ⬥ Mark had a grudge against victim  │
│    (motive, from testimony)          │
│  ⬥ Guard Garrett confirmed seeing    │
│    Mark in the area (witness)        │
│  ⬥ Torn fabric matches Mark's cloak  │
│    (physical, from crime scene)      │
│                                      │
│ [Back to Suspects]                   │
└──────────────────────────────────────┘
```

**Critical: only show categories with evidence.** `CaseSummary.evidence` is `Record<string, number>` — only keys with count > 0. Do NOT hardcode a full list of categories and show "none" for missing ones. Absence = no row. This keeps UI module-agnostic: Economy module adding "financial_records" category works without UI changes.

**What's NOT shown:**
- No "Case Strength" progress bar or percentage
- No `totalScore` or `quality` label (strong/moderate/weak/insufficient) — these are engine-internal for NPC evaluation
- No "Ready to accuse" signal
- No "Verdict Prediction"

The player reads their evidence, decides if it's enough, and acts. The guard's reaction to the accusation tells them if they were right.

**Implementation:**
- In suspects tab, clicking a suspect row calls `GET /api/journal/case/:npcId`
- Renders inline case review replacing entry list
- Evidence summary: one row per key in `evidence` object (dynamic, not fixed list)
- Evidence details: list of `entries` with category badge and source/location metadata
- "Back to Suspects" returns to suspects list
- If no entries: "No evidence collected yet. Investigate the crime scene and talk to people."

---

## Tier 3: High Value Enhancements

### 3.1 WebSocket Event Handling

**Already handled in game.js (extend, don't recreate):**

| WS Event | Current handler (game.js) | What to ADD |
|----------|--------------------------|-------------|
| `journal:entry` | Line 654: `addJournalEntry(data)` | Re-evaluate detective hint if chat open (`updateDetectiveHint()`). Flash journal button with glow animation |
| `crime:scene` | Line 642: push to `state.crimeScenes`, toast | If player is at that location, auto-show examine panel. Trigger pulsing ring on canvas if not already rendering |

**Not yet handled (add new):**

| WS Event | UI Response |
|----------|-------------|
| `state:update` | Merge mood/alive/location/status into `state.agents[agentId]`. Update NPC sprite on canvas (detained overlay, death pose). If chat open with this NPC, update mood bar. Trigger canvas redraw |

**Implementation:**
- `state:update`: new `case` handler. Merge fields into `state.agents[data.agentId]`, call `requestAnimationFrame` for canvas update
- `journal:entry`: add `updateDetectiveHint()` call to existing handler, add journal button flash
- `crime:scene`: add examine panel trigger to existing handler

### 3.2 NPC Mood Visual Cue

**What:** Subtle visual feedback when NPC mood shifts during conversation — color shift on the mood ring around NPC sprite on canvas.

**Why:** This replaces the rejected "IL Effect Summary" with a non-breaking, immersive alternative. Player sees the NPC's state change without breaking the fourth wall.

**Implementation:**
- On `state:update` WS with mood change: animate mood ring color transition (smooth over 1s)
- Optional: brief pulse effect on the ring when mood shifts > 0.1

### 3.3 Event Feed Enrichment

**What:** Add NPC-NPC conversation highlights and state changes to event feed.

Currently unused WS events worth adding:
- `conversation:line` — NPC-NPC dialogue (already on canvas bubbles, also add to feed)
- `state:update` for arrests, deaths — event feed notifications

All with `escapeHTML`.

---

## Tier 4: Polish

### 4.1 Event Feed Performance

Replace full innerHTML rebuild with incremental DOM:
- `addEvent()`: create element with `escapeHTML`, prepend to feed, remove last if > 50
- Eliminates layout thrashing on frequent events

### 4.2 Minimap

Small overlay in bottom-left corner:
- Location nodes positioned by zone polygon centroids from world.json
- NPC dots at positions from `state.agents` (color = mood gradient red→green)
- Player dot (white, larger)
- Crime scene indicator (pulsing red ring on location)
- Size: ~200x150px, `rgba(10,15,20,0.7)` background
- Click on location dot: camera pans

### 4.3 Journal Evidence Category Filter

In journal "All" tab, dynamically generated filter buttons from existing entries:
```
[All] + one button per unique evidenceCategory found in journal entries
```
Example with current crime-justice module: `[All] [physical] [witness] [motive]`

Buttons generated from `new Set(entries.map(e => e.evidenceCategory).filter(Boolean))`. No hardcoded category list — new modules adding categories (e.g. "financial_records") get filter buttons automatically.

Active filter highlighted (amber border). Non-matching entries: `display:none`.

---

## Out of Scope (M3+)

- **Action buttons / dialogue choices** — contradicts natural language design (Decision D1)
- **Case strength meter / readiness indicator** — contradicts detective agency (Decision D2)
- **IL effect summary display** — NPC response is the feedback (Decision D3)
- **Deduction board** — visual evidence web. Complex UI, deferred.
- **Player notes** — manual journal annotations. Nice but not core loop.
- **NPC interview auto-notes** — auto-generated conversation summaries.
- **Full responsive/mobile** — desktop-first Canvas2D game.
- **ES module split** — code organization, orthogonal to gameplay.
- **Dynamic action registry from server** — current hints cover crime-justice module. New modules = new spec.

---

## Implementation Order

```
Phase 1: Bug fixes (Tier 1)          — 1.1, 1.2, 1.3, 1.4
Phase 2: Core detective UI (Tier 2)  — 2.2 (examine), 2.1 (hints), 2.3 (case review)
Phase 3: Reactivity (Tier 3)        — 3.1 (WS), 3.2 (mood cue), 3.3 (feed enrichment)
Phase 4: Polish (Tier 4)            — 4.1, 4.2, 4.3 (as time allows)
```

**Phase 2 order rationale:** Examine first — unblocks evidence gathering (prerequisite for everything). Hints next — guides the player on what to do with evidence. Case review last — depends on having evidence to review.

---

## Acceptance Criteria

A complete M2 gameplay test:
1. Start new game → crime happens organically
2. Player walks to crime scene → narrative examination panel with multiple points
3. Player examines each point with narrative verbs → finds evidence → journal updates via WS
4. Player opens journal → sees evidence organized by suspect and category
5. Player opens chat with witness → detective hint suggests they might know something → player asks in their own words
6. Player opens chat with guard → hint suggests reporting the crime → player explains what they found
7. Player reviews case file for suspect → reads evidence breakdown → decides to accuse
8. Player opens chat with suspect → hint notes they have evidence → player confronts/accuses in their own words, attaches evidence
9. NPC responds naturally (denial, confession, fear) — that response IS the gameplay feedback
10. State changes visible in real time (arrests, mood shifts, new journal entries via WS)
11. Throughout: no action buttons, no dialogue menus, no "press X to accuse" — just conversation
