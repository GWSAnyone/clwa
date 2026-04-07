# AUDIT: Intent Layer (IL) — Ultra-Deep Review

> Date: 2026-04-07 | Version: v0.11.0-dev | Grade: **B-**

---

## Summary

IL is architecturally solid — dynamic schema, registry delegation, deterministic accusation are strong design decisions at or above academic state-of-art. **1 critical bug** found: name/ID mismatch in belief.subject breaks the entire detective gameplay cycle (player testimony invisible to accusation scanner). **1 must-fix dead code** (timePeriod field). **4 should-fix** quality issues.

---

## MUST FIX (Critical)

### 1. Name/ID mismatch in belief.subject
- **Files**: `il.ts:761`, `il.ts:553`, `il.ts:631`, `il.ts:897`
- IL creates beliefs with `subject: subjectAgent?.profile.name` ("Mark"), but accusation checks `b.subject === suspectId` ("mark"), and question answering checks `b.subject === aboutAgent.profile.id` ("mark")
- Name ("Mark") !== ID ("mark") — player testimony beliefs INVISIBLE to accusation
- `npcMaxConfidence` underreported → `combinedScore` underreported → quality tier may be 'weak' instead of 'moderate' → arrest doesn't fire
- **Evidence**: modules already know about this — `target-finders.ts:170,184,211` has defensive dual check `b.subject === agent.profile.name || b.subject === agent.profile.id`
- **Fix**: IL claims MUST store ID: `subject: subjectAgent?.profile.id ?? null`. Or at minimum, accusation/question logic must check both.
- **Impact**: Breaks entire detective gameplay cycle. Must fix BEFORE M2 gameplay test.

### 2. Claim timePeriod — dead field
- **Files**: `il.ts:53-60` (schema), `il.ts:120` (interface), `il.ts:216` (prompt), `il.ts:419` (resolve)
- JSON Schema has `additionalProperties: false` but NO timePeriod property → LLM can never produce it
- Claim.timePeriod always undefined. ~20 wasted prompt tokens.
- **Fix**: Add timePeriod to schema, or remove from interface/prompt.

---

## SHOULD FIX

### 3. Missing trust effect report in self-accusation
- **File**: `il.ts:797-799`
- `adjustTrust(-0.15)` called but only sentiment change pushed to `ctx.effects`
- WS broadcast won't show trust penalty to client
- **Fix**: Add `ctx.effects.push({ type: 'relationship_change', field: 'trust', delta: -0.15 })`

### 4. adjustBilateral doesn't change player trust
- **File**: `il.ts:1065-1069`
- NPC gets sentiment + trust changes. Player gets only sentiment * bilateralFactor. Player trust toward NPC never changes.
- For threat/bribe/insult — is this intentional? Should be explicitly documented.
- **Fix**: Add trust line or document the design decision.

### 5. resolveNpcName ambiguity on partial match
- **File**: `il.ts:438-440`
- Partial match returns FIRST result. "ar" matches "garrett" and "elara" — depends on array order.
- At 7 NPCs: unlikely collisions. At 50 NPCs: "Mark" vs "Marcus", "El" vs "Elara" vs "Elena"
- **Fix**: Score partial matches (prefer shortest name, or Levenshtein). Or require exact match.

### 6. formalAccusations.tick stores gameDay
- **File**: `il.ts:853`
- Field named `tick` but contains `ctx.gameDay`. Semantic mismatch.
- **Fix**: Rename to `gameDay` or pass real gameMinute.

---

## CONSIDER

### 7. Bribe pressure effects — all zeros
- **File**: `world-types.ts:269`, `il.ts:959-971`
- `pressureEffects.bribe = { mood: 0, sentiment: 0, trust: 0 }` — no mechanical reaction
- NPC with H=0.3 gets "tempting" prompt but zero state change
- **Suggestion**: H-gated trust: `trust: H >= 0.6 ? -0.10 : 0.05`. M3 scope.

### 8. question topic not validated server-side
- **File**: `il.ts:331-337`
- Schema enum prevents invalid values, but no defense-in-depth check
- Low risk with constrained decoding.

### 9. Stale newMood in mood_change effects
- **Files**: `il.ts:934`, `il.ts:990`
- `newMood: npc.state.mood` captured BEFORE modifier applied. Always stale.
- Document or remove from effect.

### 10. resolveILConfig shallow merge for nested Records
- **File**: `world-types.ts:287-296`
- Partial override of `pressureEffects.threat` replaces entire `pressureEffects` — flattery lost
- **Fix**: Deep merge for nested Records, or document.

---

## Clean Areas (Verified)

| Area | Grade | Notes |
|------|-------|-------|
| Engine/Module boundary | A | Zero module imports. No module string comparisons |
| Registry pattern | A | isTransferable, getAffordanceIdsForVerb, getEventLabelSafe — all delegated |
| Structured data | A | json_schema constrained decoding, no text parsing |
| LLM discipline | A | Semaphore in finally, structured output, no RP framing |
| Dynamic schema | A+ | Registry-driven enums, rebuilt per-call, dead NPCs removed |
| Trade verb injection | A | IL_TRADE_VERBS first in enum — workaround for 9B constrained decoding bias |
| Hallucination filtering | A | BENIGN_SPEECH_ACTS filter for low-intensity pressure on smalltalk |
| Accusation determinism | A | buildAccusationContext fully deterministic, LLM only voices result |
| ILConfig externalization | A | Zero hardcoded magic numbers, all in WorldConfig |
| Evidence not trust-scaled | A | Physical evidence weight independent of player trust — correct design |

---

## Concurrency Note

**Race condition in parallel chat messages** (`server.ts:82-331`): Two messages for same NPC → first completes, sets `inPlayerChat=false` in finally → second still processing but NPC unfrozen. Tick could run movement/goals. **Low probability** in single-player but architecturally unsafe. No per-NPC chat mutex.

---

## Industry Context

- **DSL-through-LLM pattern**: [Real-Time World Crafting (2025)](https://arxiv.org/html/2510.16952) — CLWA's IL is a production implementation of this academic concept, with dynamic registry-driven schema
- **Constrained decoding bias**: [Guide to Structured Outputs](https://www.aidancooper.co.uk/constrained-decoding/) — CLWA's trade verb injection is a correct workaround
- **Belief-based reputation**: [ScienceDirect NPC reputation](https://www.sciencedirect.com/science/article/abs/pii/S1875952123000204) — CLWA's claims→addBelief→confidence*trust is a direct implementation
- **Deterministic evidence evaluation**: [DECIDE framework](https://dl.acm.org/doi/fullHtml/10.1145/3681716.3681732) — separation between evidence processing and choice mechanism

---

## Priority

1. **Name/ID mismatch** — blocks M2 gameplay test
2. **timePeriod cleanup** — dead code, wasted tokens
3. **Bilateral trust decision** — document or fix
4. **Everything else** — quality improvements
