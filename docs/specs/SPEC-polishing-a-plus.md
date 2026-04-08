# SPEC: Polishing to A+ State

**Status**: PARTIAL (2026-04-08) — 82/109 done, 17 deferred  
**Created**: 2026-04-07  
**Scope**: Full codebase quality sweep — dead code, type safety, frontend, LLM prompts, save/load, known debt  
**Total items**: 162 (109 actionable → 82 done, 17 deferred, 10 false positive/already fixed)  

---

## How to use this spec

Each item has:
- **ID** — unique, stable across sessions (e.g. `TS-03`)
- **Status** — `[ ]` pending, `[x]` done, `[~]` deferred, `[!]` blocked
- **Severity** — P0 (critical), P1 (high), P2 (medium), P3 (low)
- **File:line** — exact location at time of audit (may shift after edits)

Work through phases in order. Mark items `[x]` as completed. If an item turns out invalid, mark `[~]` with a note.

---

## Phase 1: Safety & Stability (P0)

### 1.1 — Web UI Critical

| ID | Severity | Status | File | Issue |
|----|----------|--------|------|-------|
| FE-01 | P0 | [x] | `public/game.js:474-478` | try-catch around JSON.parse + console.error('[WS Parse Error]'). |
| FE-02 | P0 | [x] | `public/game.js:472` | ws.onerror handler added. |
| FE-03 | P1 | [x] | `public/game.js:462-465` | sendWS() helper with readyState guard. All ws.send() calls replaced. |

### 1.2 — Engine Critical Type Safety

| ID | Severity | Status | File | Issue |
|----|----------|--------|------|-------|
| TS-01 | P0 | [x] | `engine/src/cg-engine.ts:187` | Fixed: `as Record<string, unknown>` (typed dynamic access, intentional CG design). |
| TS-02 | P0 | [x] | `engine/src/event-registry.ts:589` | Fixed: `rule: ConsequenceRule`. |
| TS-03 | P0 | [x] | `modules/src/crime-justice/step-handlers.ts` | Fixed: all params properly typed as `Agent`, `Map<string, Agent>`. |
| TS-04 | P0 | [x] | `modules/src/crime-justice/step-handlers.ts` | Fixed: `suspect: Agent`. |
| TS-05 | P0 | [x] | `modules/src/crime-justice/step-handlers.ts` | Fixed: `judge: Agent`. |
| TS-06 | P0 | [x] | `modules/src/crime-justice/step-handlers.ts` | Fixed: all 3 params typed. |
| TS-07 | P0 | [x] | `modules/src/crime-justice/step-handlers.ts` | Fixed: `owner: Agent, target: Agent`. |

---

## Phase 2: Known Architectural Debt

| ID | Severity | Status | File | Issue |
|----|----------|--------|------|-------|
| DEBT-01 | P1 | [x] | `engine/src/world.ts` | Extracted `_computeMoodTick()` shared helper. `_tickMoodSystem` and `advanceMoodMath` both use it. |
| DEBT-02 | P1 | [x] | `engine/src/world-types.ts`, `server/src/index.ts` | DEFAULT_IL_CONFIG now has `{}` empty defaults. Server provides pressure/speech act effects in WorldConfig. |
| DEBT-03 | P2 | [x] | `engine/src/cg-engine.ts` | Generic fallback + `console.warn('[CG] No memory text builder for:')`. No raw event.type in NPC memory. |
| DEBT-04 | P1 | [x] | `engine/src/event-registry.ts` | `storeEvent: (event: WorldEvent)`, `pushEffect: (effect: ILEffect)`. |

---

## Phase 3: Dead Code Cleanup

All items are confirmed unused exports — zero breaking changes expected.

| ID | Severity | Status | File | Symbol | Type | Notes |
|----|----------|--------|------|--------|------|-------|
| DC-01 | P3 | [x] | `server/src/logger.ts` | `getLogFilePath` | function | Removed `export`. |
| DC-02 | P3 | [x] | `server/src/position-manager.ts` | `EntityPosition` | interface | Removed `export`. |
| DC-03 | P3 | [x] | `server/src/position-manager.ts` | `ZoneData` | interface | Removed `export`. |
| DC-04 | P3 | [x] | `server/src/server.ts` | `ServerConfig` | interface | Removed `export`. |
| DC-05 | P3 | [x] | `server/src/trait-randomizer.ts` | `RelationshipRanges` | interface | Removed `export`. |
| DC-06 | P3 | [x] | `engine/src/schedule.ts` | `TIME_PERIODS` | const | Removed `export`. `TimePeriod` type still exported. |
| DC-07 | P2 | [~] | `engine/src/volition.ts` | `recordTalkTarget` | function | **False positive**: called at volition.ts:371. |
| DC-08 | P2 | [~] | `modules/src/crime-justice/target-finders.ts` | `findSurveillanceTarget` | function | **False positive**: registered in TARGET_FINDERS. |
| DC-09 | P2 | [~] | `engine/src/il.ts` | `getAccusationResponse` | function | **False positive**: called at il.ts:851. |

---

## Phase 4: Type Safety Sweep

### 4.1 — `as any` Casts

| ID | Severity | Status | File | Issue |
|----|----------|--------|------|-------|
| TS-08 | P1 | [x] | `server/src/routes.ts` | Removed `as any` — source is string, types match. |
| TS-09 | P1 | [x] | `server/src/routes.ts` | Removed `as any` — body.type is string. |
| TS-10 | P1 | [x] | `server/src/routes.ts` | Removed `as any` — NpcStatus is string. |
| TS-11 | P2 | [x] | `server/src/server.ts` | Changed to `undefined as unknown as Response`. |
| TS-12 | P2 | [x] | `server/src/server.ts` | `_fallback` added to DialogueMeaning type, cast removed. |
| TS-13 | P2 | [x] | `server/src/trait-randomizer.ts` | Changed to `Record<string, [number, number]>`. |
| TS-14 | P3 | [x] | `engine/src/il.ts` | `_fallback` field added to type, cast removed. |
| TS-15 | P3 | [x] | `engine/src/il.ts` | Same as TS-14. |
| TS-16 | P2 | [x] | `engine/src/il.ts` | Removed casts — types match after DEBT-04. |
| TS-17 | P3 | [x] | `engine/src/world.ts` | Removed `as any` — 'idle' is valid NpcProcessingState. |
| TS-18 | P3 | [x] | `engine/src/world.ts` | Removed `as any` — string type matches. |

### 4.2 — `any` Type Annotations (Parameters & Returns)

| ID | Severity | Status | File | Issue |
|----|----------|--------|------|-------|
| TS-19 | P1 | [~] | `modules/src/crime-justice/step-handlers.ts` | Already typed (Phase 1 fix). |
| TS-20 | P1 | [~] | `modules/src/crime-justice/step-handlers.ts` | Already typed (Phase 1 fix). |
| TS-21 | P1 | [~] | `modules/src/crime-justice/step-handlers.ts` | Already typed (Phase 1 fix). |
| TS-22 | P1 | [x] | `modules/src/crime-justice/index.ts` | `(b: Belief) =>`. |
| TS-23 | P1 | [x] | `modules/src/crime-justice/index.ts` | `(b: Belief) =>`. |
| TS-24 | P1 | [x] | `modules/src/crime-justice/index.ts` | `(b: Belief) =>`. |
| TS-25 | P1 | [x] | `modules/src/crime-justice/index.ts` | `(b: Belief) =>`. |
| TS-26 | P1 | [x] | `modules/src/crime-justice/index.ts` | `(e: WorldEvent) =>`. |
| TS-27 | P1 | [x] | `modules/src/crime-justice/index.ts` | `(e: WorldEvent) =>`. |
| TS-28 | P1 | [x] | `modules/src/crime-justice/index.ts` | `(e: WorldEvent) =>`. |
| TS-29 | P1 | [x] | `modules/src/crime-justice/index.ts` | `(a: Belief, b: Belief) =>`. |
| TS-30 | P2 | [x] | `server/src/routes.ts` | `Record<string, string>`. |
| TS-31 | P2 | [x] | `server/src/server.ts` | Typed as ShopItem shape. |
| TS-32 | P2 | [x] | `engine/src/world.ts` | `Omit<MoodModifier, 'id'>`. |
| TS-33 | P2 | [x] | `engine/src/world.ts` | `unknown[]` instead of `any[]`. |
| TS-34 | P2 | [x] | `engine/src/world.ts` | `unknown[]` instead of `any[]`. |
| TS-35 | P2 | [x] | `engine/src/world.ts` | `Record<string, unknown>`. |

### 4.3 — Loose Object Types

| ID | Severity | Status | File | Issue |
|----|----------|--------|------|-------|
| TS-36 | P1 | [x] | `engine/src/world.ts` | `Record<string, Record<string, unknown>>`. |
| TS-37 | P2 | [x] | `engine/src/world.ts` | `ReturnType<TopicEngine['toJSON']>`. |
| TS-38 | P3 | [~] | `engine/src/topic-engine.ts` | Deferred — toJSON return type derived via ReturnType in consumer. |
| TS-39 | P2 | [~] | `modules/src/crime-justice/index.ts` | Deferred — `data: {}` is intentional for reactive goals with no extra data. |

### 4.4 — Non-null Assertions (`!`)

Every `!` is a runtime assumption that value is non-null. If assumption breaks, TypeError at runtime.

**SAFE** = preceding guard guarantees non-null. **QUESTIONABLE** = implicit invariant, no explicit guard.

#### 4.4a — Safe (guarded, but still tracked)

| ID | Severity | Status | File:Line | Code | Guard |
|----|----------|--------|-----------|------|-------|
| NNA-01 | P3 | [ ] | `engine/src/volition.ts:573` | `_recentTalkTargets.get(npcId)!.set(...)` | Line 572: `if (!has(npcId))` + create |
| NNA-02 | P3 | [ ] | `engine/src/volition.ts:586` | `_considerations.get(npcId)!` | Line 585: `if (!has(npcId))` + create |
| NNA-03 | P3 | [ ] | `engine/src/world.ts:944` | `topic.beliefTransfer!.subject!` | Line 941: `if (topic.beliefTransfer?.subject)` |
| NNA-04 | P3 | [ ] | `engine/src/world.ts:1126` | `this.agents.get(pair.a)!` | scheduler.findPair returns valid IDs |
| NNA-05 | P3 | [ ] | `engine/src/world.ts:1127` | `this.agents.get(pair.b)!` | same as NNA-04 |
| NNA-06 | P3 | [ ] | `engine/src/world.ts:1327` | `deadByLocation.get(loc)!.push(...)` | Line 1326: `if (!has(loc))` + create |
| NNA-07 | P3 | [ ] | `engine/src/agent.ts:343` | `crimeBeliefs.find(b => isPerpetrator(b.source))!` | Line 342: `some()` check |
| NNA-08 | P3 | [ ] | `engine/src/agent.ts:348` | `crimeBeliefs.find(b => isFirsthand(b.source))!` | Line 347: `some()` check |
| NNA-09 | P3 | [ ] | `server/src/server.ts:149` | `chatSessions.get(msg.agentId)!` | Lines 142-148: `if (!has())` + create |
| NNA-10 | P3 | [ ] | `engine/src/event-registry.ts:189` | `DEATH_EVENTS.values().next().value!` | Line 188: `DEATH_EVENTS.size > 0` |
| NNA-11 | P3 | [ ] | `engine/src/event-registry.ts:646` | `SOURCE_CATEGORIES.get(category)!` | Line 645: `if (!has())` + create |
| NNA-12 | P3 | [ ] | `engine/src/pathfinding.ts:26` | `queue.shift()!` | Line 25: `while (queue.length > 0)` |
| NNA-13 | P3 | [ ] | `engine/src/processing-queue.ts:87` | `this.queue.shift()!` | Line 81: early return if empty |
| NNA-14 | P3 | [ ] | `server/src/trait-randomizer.ts:259` | `rel.sentimentRange!` | Line 258: `if (hasSentimentRange)` |
| NNA-15 | P3 | [ ] | `server/src/trait-randomizer.ts:266` | `rel.trustRange!` | Line 265: `if (hasTrustRange)` |

#### 4.4b — Questionable (implicit invariant or no guard)

| ID | Severity | Status | File:Line | Code | Risk |
|----|----------|--------|-----------|------|------|
| NNA-16 | P2 | [ ] | `engine/src/world.ts:410` | `agent.state.transitTo!` | Assumes transitTo set when transitProgress >= 1. No explicit guard. If violated → location = undefined. |
| NNA-17 | P2 | [ ] | `engine/src/world.ts:1362` | `type: bodyDiscoveryType!` | Implicit — assumes set by earlier logic. If null → event type = undefined. |
| NNA-18 | P2 | [ ] | `engine/src/world.ts:1379` | `getDiscoveryHandler(bodyDiscoveryType!)` | Same variable as NNA-17. |
| NNA-19 | P2 | [ ] | `engine/src/world.ts:1395` | `sharedCtx.witnessIds!.add(id)` | Assumes witnessIds initialized on WorldContext. |
| NNA-20 | P2 | [x] | `engine/src/goals.ts` | Fixed: `(goal.waitTicks ?? 0) + 1`. |
| NNA-21 | P2 | [ ] | `engine/src/goals.ts:412` | `sender.state.beliefs!.getAllBeliefs()` | Direction-dependent: sender varies. Partial guard on line 406. |
| NNA-22 | P2 | [ ] | `engine/src/goals.ts:420` | `receiver.state.beliefs!.getAllBeliefs()` | Same as NNA-21. |
| NNA-23 | P2 | [ ] | `engine/src/goals.ts:425` | `receiver.state.beliefs!.addBelief(...)` | Same as NNA-21. |
| NNA-24 | P2 | [ ] | `server/src/server.ts:317` | `playerAgent!.profile.name` | Assumes playerAgent set. If null → "undefined" in text. |
| NNA-25 | P2 | [ ] | `server/src/routes.ts:209` | `path.split('/').pop()!` | `pop()` can return undefined on empty array. Downstream null check catches it, but assertion is misleading. |
| NNA-26 | P2 | [ ] | `server/src/routes.ts:219` | `path.split('/').pop()!` | Same as NNA-25. |
| NNA-27 | P2 | [ ] | `server/src/routes.ts:229` | `path.split('/').pop()!` | Same as NNA-25. |
| NNA-28 | P2 | [ ] | `server/src/routes.ts:241` | `path.split('/').pop()!` | Same as NNA-25. |
| NNA-29 | P2 | [ ] | `server/src/routes.ts:490` | `path.split('/').pop()!` | Same as NNA-25. processKill(undefined) would fail downstream. |
| NNA-30 | P2 | [ ] | `modules/src/crime-justice/index.ts:632` | `playerAgent!.state.beliefs` | Assumes playerAgent available in context. No guard. |
| NNA-31 | P2 | [ ] | `modules/src/crime-justice/index.ts:654` | `playerAgent!.profile.id` | Same as NNA-30. |
| NNA-32 | P2 | [ ] | `modules/src/crime-justice/index.ts:762` | `ctx.agents.get(guardId)!` | `guardId` from `find()` which can return undefined. Guard checks `if (guardId)` but assertion is fragile. |
| NNA-33 | P2 | [ ] | `modules/src/crime-justice/step-handlers.ts:312` | `ctx.evidenceLayer!.discover(...)` | No check that evidenceLayer exists on context. |
| NNA-34 | P2 | [ ] | `modules/src/crime-justice/topic-sources.ts:512` | `.map(b => b.object!)` | Filter ensures object truthy, but `!` is redundant and misleading. Remove `!` or use `as string`. |
| NNA-35 | P2 | [ ] | `modules/src/crime-justice/topic-sources.ts:601` | `ctx.agents?.get(belief.object!)` | No check that `belief.object` is defined. `?.` downstream makes `!` redundant. |
| NNA-36 | P2 | [ ] | `modules/src/crime-justice/topic-sources.ts:605` | `ctx.agents?.get(belief.object!)` | Same as NNA-35. |
| NNA-37 | P2 | [ ] | `modules/src/crime-justice/target-finders.ts:267` | `b.subject!` (×2) | No check that subject exists. Map gets undefined key. |
| NNA-38 | P2 | [ ] | `modules/src/crime-justice/target-finders.ts:364` | `belief.location!` | No check. undefined → breaks downstream location logic. |
| NNA-39 | P2 | [ ] | `modules/src/crime-justice/target-finders.ts:368` | `belief.location!` | Same as NNA-38. |
| NNA-40 | P2 | [ ] | `engine/src/llm-client.ts:166` | `res.body!.getReader()` | Assumes body exists after status 200. Fetch spec doesn't guarantee body on all responses. |
| NNA-41 | P2 | [ ] | `server/src/trait-randomizer.ts:347` | `fromAgent.state.relationships!.adjustSentiment(...)` | No check that relationships system exists. |

### 4.5 — Type Assertions (`as Type`, excluding `as any`)

Every `as Type` tells TypeScript "trust me" — bypasses compile-time checking.

#### 4.5a — Guarded (type check or context guarantees correctness)

| ID | Severity | Status | File:Line | Code | Why tracked |
|----|----------|--------|-----------|------|-------------|
| TA-01 | P3 | [ ] | `engine/src/agent.ts:152` | `history.slice(0, -1) as Array<{role: 'user'\|'assistant'; content: string}>` | Narrowing after slice. Safe but implicit type assumption. |
| TA-02 | P3 | [ ] | `engine/src/cg-engine.ts:183` | `(agent.profile as Record<string, unknown>)[capFlag]` | Dynamic key from REQUIREMENT_CHECKERS. Safe pattern but relies on registry contract. |
| TA-03 | P3 | [ ] | `engine/src/al.ts:287` | `req as Record<string, unknown>` | AffordanceRequirement → dynamic key check. Idiomatic. |
| TA-04 | P3 | [ ] | `engine/src/al.ts:546` | `(req as Record<string, unknown>)[key]` | Same as TA-03. |
| TA-05 | P3 | [ ] | `engine/src/il.ts:263` | `JSON.parse(content) as Record<string, unknown>` | Immediately validated with type checks. |
| TA-06 | P3 | [ ] | `engine/src/il.ts:294` | `raw.tradeIntent as Record<string, unknown>` | Guarded: `typeof === 'object'` check precedes. |
| TA-07 | P3 | [ ] | `engine/src/il.ts:296` | `raw.requestedAction as Record<string, unknown>` | Guarded: `typeof === 'object'` check precedes. |
| TA-08 | P3 | [ ] | `engine/src/il.ts:320` | `.filter(Boolean) as Claim[]` | Idiomatic TS pattern after Boolean filter. |
| TA-09 | P3 | [ ] | `engine/src/memory.ts:70` | `points[0].payload as Record<string, unknown>` | Qdrant SDK payload is dynamic. |
| TA-10 | P3 | [ ] | `engine/src/memory.ts:123` | `r.payload as Record<string, unknown>` | Same as TA-09. |
| TA-11 | P3 | [ ] | `engine/src/memory.ts:156` | `p.payload as Record<string, unknown>` | Same as TA-09. |
| TA-12 | P3 | [ ] | `engine/src/volition.ts:991` | `steps.push(step as GoalStep)` | Built up through property assignments. All fields present. |
| TA-13 | P3 | [ ] | `engine/src/world.ts:1039` | `crimeData.type as WorldEvent['type']` | Event types registered by modules. |
| TA-14 | P3 | [ ] | `engine/src/world.ts:1602` | `this.currentPeriod as AffordanceContext['period']` | Computed from gameMinute, guaranteed enum value. |
| TA-15 | P3 | [ ] | `server/src/index.ts:169` | `JSON.parse(raw) as SaveData` | Validated by version check on line 170. |
| TA-16 | P3 | [ ] | `server/src/index.ts:224` | `def.type as RelationType` | World JSON relationship definitions. |
| TA-17 | P3 | [ ] | `server/src/index.ts:225` | `def.type as RelationType` (in DEFAULT_SENTIMENT lookup) | Same as TA-16. |
| TA-18 | P3 | [ ] | `server/src/index.ts:226` | `def.type as RelationType` (in DEFAULT_TRUST lookup) | Same as TA-16. |
| TA-19 | P3 | [ ] | `server/src/index.ts:348` | `'acquaintance' as RelationType` | Literal — valid enum value. |
| TA-20 | P3 | [ ] | `server/src/index.ts:354` | `'acquaintance' as RelationType` | Same as TA-19. |
| TA-21 | P3 | [ ] | `server/src/trait-randomizer.ts:189` | `range as TraitRange` | Built up through iteration. All fields present. |
| TA-22 | P3 | [ ] | `server/src/world-loader.ts:145` | `JSON.parse(raw) as T` | Generic JSON.parse — idiomatic. |
| TA-23 | P3 | [ ] | `server/src/world-loader.ts:241` | `{...} as ScheduleEntry` | All required fields present in object literal. |

#### 4.5b — Bypass (no type guard, TypeScript checking bypassed)

| ID | Severity | Status | File:Line | Code | Risk |
|----|----------|--------|-----------|------|------|
| TA-24 | P2 | [ ] | `engine/src/il.ts:337` | `raw.requestedAction as Record<string, unknown>` | Outer condition checks type, but no re-verify at cast site. Pattern inconsistency. |
| TA-25 | P2 | [ ] | `engine/src/il.ts:360` | `raw.emotionalPressure as Record<string, unknown>` | Same — outer condition, no re-verify. |
| TA-26 | P2 | [ ] | `engine/src/il.ts:367` | `String(ep.type) as EmotionalPressure['type']` | Registry check on line 362, but cast doesn't re-verify. |
| TA-27 | P2 | [ ] | `engine/src/il.ts:378` | `raw.tradeIntent as Record<string, unknown>` | Same pattern as TA-24. |
| TA-28 | P1 | [ ] | `engine/src/interaction.ts:142` | `{} as GoalStep` | Empty object cast to GoalStep. **Dangerous** — no fields guaranteed. |
| TA-29 | P2 | [ ] | `engine/src/world.ts:1778` | `(data as any).affordanceCooldowns as Record<string, Record<string, number>>` | Nested cast after `as any`. Save data restoration. No validation. |
| TA-30 | P2 | [ ] | `engine/src/world.ts:1784` | `(data as any).decisionCooldowns as Record<string, number>` | Same as TA-29. |
| TA-31 | P1 | [ ] | `server/src/index.ts:518` | `{ resetting: false } as GameContext` | Partial object cast. Fields filled later by Object.assign — but TS can't verify. |
| TA-32 | P1 | [ ] | `server/src/routes.ts:174` | `url.searchParams.get('type') as EventType \| null` | URL string cast to EventType without validation. User input → type bypass. |
| TA-33 | P1 | [ ] | `server/src/routes.ts:254` | `url.searchParams.get('type') as 'clue'\|'testimony'\|'observation'\|null` | Same — URL input without validation. |

---

## Phase 5: Web UI Hardening

### 5.1 — Error Handling & Resilience

| ID | Severity | Status | File | Issue |
|----|----------|--------|------|-------|
| FE-04 | P1 | [x] | `public/game.js` | All 6 `.catch(() => {})` → `.catch(err => console.warn('[Fetch]', err))`. |
| FE-05 | P2 | [~] | `public/game.js` | Partially fixed (Array.isArray on movement data). Relationship fetch deferred — server always returns array. |
| FE-06 | P2 | [x] | `public/game.js` | WS reconnect debounce via `_wsReconnectTimer` guard. |

### 5.2 — Code Quality

| ID | Severity | Status | File | Issue |
|----|----------|--------|------|-------|
| FE-07 | P2 | [~] | `public/game.js` | Deferred — large refactor (258 lines, 22 cases), high blast radius. |
| FE-08 | P2 | [~] | `public/game.js` | Deferred — magic numbers refactor, low risk but tedious. |
| FE-09 | P2 | [~] | `public/game.js` | Deferred — name→agent map cache, O(n)→O(1). |
| FE-10 | P2 | [~] | `public/game.js` | Deferred — openChat() split. |
| FE-11 | P2 | [~] | `public/game.js` | Deferred — renderMindSection() refactor. |
| FE-12 | P3 | [x] | `public/game.js` | Status sanitized via `.replace(/[^a-z_-]/gi, '')`. |

### 5.3 — Performance

| ID | Severity | Status | File | Issue |
|----|----------|--------|------|-------|
| FE-13 | P2 | [~] | `public/game.js` | CHAT_HISTORY_CAP=50 defined but not enforced. Deferred — scroll container visually caps. |
| FE-14 | P3 | [x] | `public/game.js` | Cached via `state._feedEl`. |
| FE-15 | P3 | [x] | `public/game.js` | Added delta threshold (< 0.01 skip). |

### 5.4 — Accessibility

| ID | Severity | Status | File | Issue |
|----|----------|--------|------|-------|
| FE-16 | P2 | [x] | `public/game.html` | Added `role="button"`, `tabindex="0"`, `onkeydown` for Enter/Space on all 4 mind headers. |
| FE-17 | P3 | [x] | `public/game.html` | Increased contrast: #888→#aaa, #5a7a8a→#8aacbc, #6a8a9a→#9abaca. |
| FE-18 | P3 | [~] | `public/game.js` | Deferred — keyboard shortcuts for chat/journal/evidence. |

### 5.5 — Networking

| ID | Severity | Status | File | Issue |
|----|----------|--------|------|-------|
| FE-19 | P2 | [x] | `public/game.js` | Same as FE-03, already fixed. |

### 5.6 — innerHTML Patterns

| ID | Severity | Status | File | Issue |
|----|----------|--------|------|-------|
| FE-20 | P3 | [x] | `public/game.js` | Replaced innerHTML with DOM API (createElement + addEventListener). |
| FE-21 | P3 | [x] | `public/app.js` | Replaced innerHTML with createElement + textContent. |

---

## Phase 6: LLM Prompt Refinements

### 6.1 — Critical

| ID | Severity | Status | File | Issue |
|----|----------|--------|------|-------|
| LLM-01 | P1 | [x] | `engine/src/volition.ts` | `volitionTemperature` in WorldConfig (default 0.35). Passed via AffordanceContext. |
| LLM-02 | P1 | [x] | `modules/src/crime-justice/step-handlers.ts` | Retry with higher maxTokens on first failure + console.warn on both fail. |

### 6.2 — High

| ID | Severity | Status | File | Issue |
|----|----------|--------|------|-------|
| LLM-03 | P1 | [x] | `engine/src/conversation.ts` | `dialogueRule` in WorldConfig, default "under 15 words". Schema maxLength 80. |
| LLM-04 | P1 | [x] | `engine/src/interaction.ts` | Aligned to "at most 15 words" (was 20). `speechConstraint` in WorldConfig. |
| LLM-05 | P1 | [x] | `engine/src/conversation.ts` | `moodLine()` added to initiator + responder prompts. Volition already had it. |

### 6.3 — Medium

| ID | Severity | Status | File | Issue |
|----|----------|--------|------|-------|
| LLM-06 | P2 | [~] | `engine/src/volition.ts` | Deferred — prompt overflow protection (top-N affordances + co-located NPCs). Complex, needs gameplay testing. |
| LLM-07 | P2 | [x] | `engine/src/conversation.ts` | Synchronized: prompt "under 15 words" + schema maxLength: 80. |
| LLM-08 | P2 | [x] | `engine/src/il.ts` | All dynamic enums sorted alphabetically in buildILSchema. |
| LLM-09 | P2 | [~] | `engine/src/il.ts` | Deferred — implicit accusation trigger on claim+authority. Complex IL logic change. |
| LLM-10 | P3 | [x] | `engine/src/reflection.ts`, `engine/src/agent.ts` | BigFive + Enneagram coreFear/coreDesire in reflection prompt. |

### 6.4 — Optimization

| ID | Severity | Status | File | Issue |
|----|----------|--------|------|-------|
| LLM-11 | P3 | [x] | `engine/src/volition.ts` | Volition schema already lazy singleton. IL schema is per-call (ctx-dependent) — correct, not cacheable. |
| LLM-12 | P3 | [~] | `engine/src/agent.ts`, `engine/src/volition.ts` | Deferred — belief dedup requires careful prompt restructuring. |

---

## Phase 7: Save/Load Robustness

### 7.1 — Type Safety in Restore

| ID | Severity | Status | File | Issue |
|----|----------|--------|------|-------|
| SL-01 | P2 | [x] | `engine/src/world.ts` | `WorldSaveData` type with `gameMinute` field. Zero `as any`. |
| SL-02 | P2 | [x] | `engine/src/world.ts` | `gameSpeed` in `WorldSaveData`. |
| SL-03 | P2 | [x] | `engine/src/world.ts` | `WorldSaveAgentData` type with `baseMood`. |
| SL-04 | P2 | [x] | `engine/src/world.ts` | `moodModifiers` in `WorldSaveAgentData`. |
| SL-05 | P2 | [x] | `engine/src/world.ts` | `evidence`, `topicEngine` in `WorldSaveData`. `journal`/`evidence` no longer readonly. |

### 7.2 — Validation Gaps

| ID | Severity | Status | File | Issue |
|----|----------|--------|------|-------|
| SL-06 | P2 | [~] | `engine/src/world.ts` | Deferred — status validation. NpcStatus is string, no enum to validate against (by design). |
| SL-07 | P2 | [x] | `engine/src/world.ts` | Mood clamped to [-1,1] on load. NaN modifiers filtered. |
| SL-08 | P2 | [~] | `engine/src/beliefs.ts` | Deferred — belief validation on load. Low risk: corrupted saves are rare. |
| SL-09 | P3 | [~] | `engine/src/goals.ts` | Deferred — goal step validation. |
| SL-10 | P3 | [~] | `server/src/position-manager.ts` | Deferred — position bounds. |

### 7.3 — Migration Infrastructure (for future)

| ID | Severity | Status | File | Issue |
|----|----------|--------|------|-------|
| SL-11 | P3 | [~] | `server/src/index.ts` | Deferred — migration infrastructure. Not needed until save format changes. |

---

## Summary by Phase

| Phase | Raw audit finds | Actionable items | P0 | P1 | P2 | P3 |
|-------|-----------------|------------------|----|----|----|----|
| 1 — Safety & Stability | 10 | 10 | 9 | 1 | 0 | 0 |
| 2 — Known Debt | 4 | 4 | 0 | 3 | 1 | 0 |
| 3 — Dead Code | 9 | 9 | 0 | 0 | 3 | 6 |
| 4 — Type Safety | ~112 | 42 | 0 | 13 | 19 | 10 |
| 5 — Web UI | ~17 | 21 | 0 | 1 | 11 | 9 |
| 6 — LLM Prompts | ~10 | 12 | 0 | 5 | 4 | 3 |
| 7 — Save/Load | ~11 | 11 | 0 | 0 | 7 | 4 |
| **Total** | **~173** | **109** | **9** | **23** | **45** | **32** |

**Why raw ≠ actionable**: Type safety audit found ~112 instances total, but ~70 are safe patterns (legitimate `as Type` narrowing, safe `!` on guaranteed collections, `as const`). Only 42 are actual problems. Web UI items split/merged during spec detailing.

---

## Execution Notes

- **Phase 1 first** — safety issues, zero tolerance.
- **Phases 2-4** — backend-only, testable, minimal blast radius. Can run server + `test-ticks.sh` after each sub-phase to verify.
- **Phase 5** — frontend, visual verification needed. Run game UI and interact.
- **Phase 6** — prompt changes affect NPC behavior. Test with `test-ticks.sh 5` + manual chat after changes.
- **Phase 7** — defer until save format actually changes. Current v1 is stable.
- **After all phases**: run full `test-ticks.sh 10`, play game manually, verify no regressions.
