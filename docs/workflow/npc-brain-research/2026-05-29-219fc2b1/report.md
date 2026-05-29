# Report — NPC Brain: context-assembly audit + prompt/context best practices

## TL;DR

CLWA's prompt machinery is genuinely sophisticated, but it was **tuned defensively for a 9B local model (Qwen)**
and stuffs almost everything into one ever-growing system prompt. The 4 research threads are remarkably unanimous,
and their recommendations line up one-to-one with the audit's risk list.

**Answer to the headline question ("more advanced shared system prompt vs more per-NPC tuning?"): it's BOTH, layered.**
- a **compact, byte-stable SHARED scaffold** (guardrails) — same for every NPC, prompt-cacheable;
- **dense PER-NPC persona data** (voice, values, few-shot example lines, traits-as-words) — one source of truth;
- **volatile state in the USER turn** (mood, top beliefs, recalled memories, scene, active directive), with the
  single most critical constraint restated **last**.

The biggest single defect today: **two divergent persona representations** (the prose `buildSystemPrompt` AND the
numeric `CLAUDE.local.md`) that can contradict each other and shift behaviour when the LLM route is toggled.

---

## Part 1 — Audit: the 5 context-assembly sites (top risks)

### 1. System prompt (`agent.ts buildSystemPrompt` + crime role/secret builders + `CLAUDE.local.md`)
- **Everything is in the system prompt** — persona + mood + beliefs + memories + secret + inner-conflict + heat +
  trust + role duty + stress/growth + Rules — one unbounded markdown wall. The code itself acknowledges "lost in
  the middle" (shop items were moved to the user turn) but secret/role/trust directives were **not** given the same
  treatment.
- **Two persona sources** (prose system prompt vs numeric `CLAUDE.local.md` auto-loaded on the claude-code route)
  → redundancy/conflict (prose "calm" vs neuroticism 0.65), behaviour not guaranteed stable across the lm-studio↔claude toggle.
- **Personality flattening**: `bigFiveToDescription` emits nothing for any trait in 0.3–0.7 → an all-moderate NPC
  becomes literally "You are balanced personality."
- **No few-shot examples**; `speechStyle` "Example:" lines are passed raw (copyable verbatim); the anti-copy rotation
  exists only on the NPC↔NPC path.
- Mutually-exclusive role directive (investigator **else** perpetrator **else** witness) silently drops guilt for an
  investigator who is also a perpetrator. Mood prose and stress/growth prose can contradict.
- Heavy `CRITICAL:`/`Never` negative phrasing; name-hallucination guard is a single weak negation.

### 2. Beliefs & vector memory → context (`beliefs.ts`, `memory.ts`)
- **Beliefs selected by pure confidence DESC** — no recency, no salience, no topic relevance, and (unlike memories)
  **no recency cue**, so the model can't tell a fresh certainty from a months-old decayed rumour.
- `## What you know` (summarizeForPrompt) and the crime role-directive **render the same belief twice** in different words.
- Belief phrasing is one blanket `"${who} committed ${verb} against ${target}"` → ungrammatical for theft/attack
  ("committed theft against Bess"). `registerBeliefPhrasing` (per-event) already exists but isn't used for this.
- Beliefs with an unregistered event label are **silently dropped** from the prompt.
- Normalization inconsistency: `decay.ts` composite divides decayedImportance by 10, but the live `memory.ts` recall
  uses it raw → the two scoring paths disagree. Recency keys off **creation** day, not last-access.
- Autonomous decisions (`volition`) never recall episodic memory — only dialogue does (act-vs-speak asymmetry).

### 3. IL extraction (`il.ts extractDialogueMeaning`)
- **No few-shot examples**; the prompt fights over-extraction with repeated "RARE/OMIT/never" nagging, and the real
  defense lives in code (`validateAndResolve`, non-strict schema, isReal() sentinels) — fragile, model-specific.
- `requestedAction.action` is enum-forced to affordance verbs → "show me your wares" maps to the nearest verb
  ("steal"); only the trade-priority hack rescues it.
- `speechAct` is single-valued but real messages are multi-act → lossy.
- The **full** NPC/location/event-type lists are dumped uncapped every call (scales badly, more enum surface to mismatch).
- **No fallback route for IL** → any Qwen hiccup silently degrades every player line to `smalltalk`/conf 0.
- Trade categories are hardcoded inline while every other vocabulary is registry-driven.

### 4. Verdict & reflection (`crime-justice/step-handlers.ts`, `reflection.ts`)
- **Verdict leaks guilt** through `buildSuspectDefense` tone (remorseful/evasive derived from whether the suspect
  holds a perpetrator-belief) — the model can pattern-match the defense wording instead of weighing evidence.
- Evidence lines are **uncapped & unordered** beyond 3 tier buckets; one strong clue can be buried by many weak ones.
- Only rubric is one "Consider: strong evidence → harsher" line; no calibration examples, no severity ranges shown
  for the available verdicts → inconsistent run-to-run.
- `reasoning` is generated **alongside** the verdict, not before it → post-hoc rationalization.
- Reflection has **no schema/validation** (raw text, canned fallback); two overlapping reflection mechanisms append
  to `reflections.md` (drift/dupe risk); reflection memories get importance 9 (sticky, can crowd out fresh ones).
- Doc drift: `clwa/overview` says reflection → Qwen, but code routes it to claude-code/sonnet.

### 5. Dialogue + history (`conversation.ts`, `agent.ts chatStream`)
- **Player history trimmed to last 12 messages with NO rolling summary** → anything >6 exchanges ago vanishes.
- **`clearChatHistory()` is defined but never called** → per-NPC buffer persists across separate conversations
  (stale context on switch-back); buffer is process-memory only (lost on restart, not in save).
- **NPC↔NPC carries only the single previous line** (no real history window) → topic drift/repetition; the explicit
  echo/repeat guards exist precisely because this is fragile.
- **Weak player framing**: raw player text sent with no "the stranger says:" attribution (contrast the NPC↔NPC
  responder prompt which quotes + attributes the speaker).
- Conversation memory injects `Player said "...". I replied "..."` which then re-recalls → self-reference echo.

---

## Part 2 — Best practices (4 research threads, actionable)

### A. Claude prompting (Anthropic official + practitioner)
- Persona in **system** (persistent anchor), volatile context in **user**. Even one role sentence matters.
- Define the character **densely** (backstory, worldview, speech patterns, triggers, what they DON'T know); structure
  with XML tags; pre-load **3–5 diverse few-shot in-voice examples** (incl. how the character deflects meta/off-world).
- **Phrase constraints positively** + give the WHY; show the output format rather than describing it; for structured
  tasks use **native Structured Outputs**, not prose tricks.
- Counter the default assistant tone explicitly; add a never-break-character / never-say-AI clause.
- **Claude 4.5/4.6 follow instructions more literally** → dial back shouty `CRITICAL/MUST` (now over-triggers).
- **Prefill is removed on Sonnet 4.6** → re-inject persona via the **user** turn on long threads. Set `effort` low for chat.
- Keep prompts short & high-signal (verbosity hurts, especially Haiku).

### B. Roleplay consistency (research 2024–2026)
- **Grounding** beats trusting parametric knowledge: RoleFact draft→decompose→verify-against-facts→rewrite (+18%
  precision, −44% temporal hallucination); but don't fully amputate parametric knowledge (it lowered BOTH
  informativeness and precision) — **modulate**.
- **Knowledge-boundary hint** (TimeChara): a cheap pre-pass sentence ("you don't know facts after your time / events
  you weren't present for; if unsure, say you don't know rather than invent") measurably cuts hallucination.
- **Static persona core first; don't re-inject/mutate every turn** (drift >30% after 8–12 turns).
- **Short system prompt (<300 tokens target); critical constraint at BEGIN and END.**
- **Describe actions, don't negate traits**; traits as words not numbers.
- **Mood-dependent retrieval** (Emotional RAG): bias recall toward memories matching current mood; state mood explicitly.
- **Author-framing** + attributed player speech > "You ARE X". Forbid ending every reply with a question / disclaimers.
- **Two-store memory** (conversation vs world-knowledge), cap history (~6 rounds) + summarize; ground each NPC to ITS
  OWN beliefs to stop it voicing another NPC's private knowledge (directly addresses CLWA name hallucination).

### C. Context engineering (Anthropic + Stanford Generative Agents + Lost-in-the-Middle)
- Composite memory score = recency + importance + relevance (CLWA already does ~this); **fix recency to key off
  last-access, and reconcile the /10 vs raw normalization**.
- **Over-fetch then rerank**, inject a **small** final K (5–8, not 30 — extra memories dilute attention).
- **U-shape**: load-bearing context at START and END, never middle; order retrieved items **ascending** so the best
  lands last (right before the model speaks).
- Separate stable persona (cache) from volatile state (refresh) — **byte-stable persona = prompt-cache win = lower cost**.
- **Compact proactively** (~70–80% budget), not at the ceiling; treat the window as a hard token budget per section.
- Four failure modes when over-stuffing memory: poisoning, distraction, confusion, clash.

### D. Small-model prompting (Qwen 7–9B), and one portable prompt Qwen→Haiku→Sonnet
- **Author the prompt to the SMALL model's ceiling; frontier models coast.** A Qwen-tuned prompt (short, explicit,
  inline example, schema-pinned, reason-before-answer, constraint-at-end) runs fine on Sonnet; the reverse fails.
- Keep **native constrained decoding ON** (json_schema strict) — biggest lever for 7–9B (prompt-only JSON <40% vs ~100%).
- **Reason field BEFORE the enum/verdict field** (autoregressive: answer conditions on prior tokens).
- **Never greedy (temp 0) on Qwen**; structured 0.15–0.4, roleplay 0.7–1.0; presence_penalty only on roleplay (>1.0 risks language-mixing).
- One or two inline few-shot examples showing the **tricky** cases (a null, a "do nothing", a refusal).
- Re-inject the critical constraint at the END (instruction attenuation); trim context hard (context rot hits 9B at every length).
- **For the 3-model comparison: measure DECISION/ROLEPLAY QUALITY, not format compliance** (constrained decoding
  flattens format differences). Hold embedding model + schema + example + context constant; vary only the LLM.

---

## Part 3 — Convergence (audit risk ↔ research fix)

| Audit risk | Research fix |
|------------|--------------|
| Everything in system prompt, unbounded wall | Stable persona in system (cached) + volatile state in user; <300-tok core; critical rule at END |
| Two persona reps (prose vs numeric) conflict | One source of truth; unify; don't duplicate facts across layers |
| No few-shot; raw copyable Example: lines | 3–5 diverse in-voice few-shot (rotated), incl. edge cases |
| Beliefs by pure confidence, no recency cue, dupe with role directive | Composite recency+importance+relevance; recency cue; ascending order; dedup; per-event phrasing |
| IL over-extraction fought with nagging | Concrete few-shot (benign→empty, threat→pressure); null-field example; reason-before-fields |
| Verdict leaks guilt; no calibration; reasoning after verdict | Neutral demeanor facts; severity ranges + 2–3 calibration examples; reason-before-verdict field order |
| Name hallucination (known issue) | Ground to NPC's own beliefs; knowledge-boundary sentence; entity roster; optional post-gen name check |
| `CRITICAL:` everywhere | Soften — Claude 4.5/4.6 over-trigger; positive phrasing + rationale |
| Memories top-30, mid-context | Top 5–8, JIT-relevant, ascending, late position |
| History trimmed, no summary; clearChatHistory never called | Rolling summary of dropped turns; call clearHistory on NPC switch; NPC↔NPC history window |

---

## Part 4 — Design recommendation (for sign-off)

**Layered prompt architecture (single source of truth per fact):**
1. **Shared base scaffold** — compact guardrails, byte-stable, authored once, reused by every NPC and every task:
   anti-AI / anti-fourth-wall / action-not-negation / concision / **knowledge-boundary (only known facts; if unsure
   say so)** / language-mirror. Soften ALL-CAPS. Lives as editable data (not hardcode), prompt-cacheable.
2. **Per-NPC persona** (world JSON) — dense: background, values, **speech style + 3–5 few-shot in-voice lines**,
   traits as graded words (fix the 0.3–0.7 flattening), Enneagram. **Unify the prose vs numeric `CLAUDE.local.md`
   duplication into one representation.**
3. **Volatile state in the USER turn** — mood (+ mood-biased memory recall), top **5–8** beliefs with recency cues &
   topic relevance & ascending order, recalled memories, scene, the active directive; **restate the one hardest
   constraint LAST**.

**Context-assembly fixes**: composite belief ranking + recency cue + per-event phrasing (`registerBeliefPhrasing`);
cap memories 5–8; reconcile normalization + last-access recency; dedup belief vs role-directive; knowledge-boundary
sentence; attributed player speech; call `clearChatHistory` / rolling summary; NPC↔NPC history window; IL & verdict
few-shot + reason-before-answer; IL fallback route.

**Model routing**: structured/well-defined (volition, il, verdict) → **Haiku** (matches Sonnet, cheaper); open-ended/
voice (dialogue, reflection) → **Sonnet**. Author ONE portable prompt per task tuned to Qwen. Keep persona byte-stable
for cache. **All editable in the World Editor** (per the standing requirement) — base scaffold + per-NPC fields +
few-shot + routing as data.

**Process**: this is analysis. Next per the 4-step process = **decisions** (sign-off on the layered architecture +
priority order), then a **spec**, then implement on a feature branch. Recommend starting with the highest-visibility
task (`dialogue`) as the vertical slice that proves the architecture, then propagate.

---

## Part 5 — 3-model comparison harness (plan)

- **Fixtures**: identical scenarios per task — `volition`, `il`, `verdict`, `reflection`, `dialogue`, `npc-dialogue`
  — drawn from real Millhaven situations (e.g. Elara asked about Garrett; a theft witnessed; an accusation with weak
  evidence). Several scenarios each to cover easy/ambiguous/adversarial.
- **Matrix**: Qwen (lm-studio) × Haiku × Sonnet (claude-code subscription — no paid API). Hold constant: embedding
  model, json_schema (strict), inline example, field order, trimmed context. Vary only the LLM.
- **Metrics**: primary = **decision/roleplay quality** via an LLM-as-judge rubric (in-character? grounded in given
  facts? right action/verdict? right refusal vs over-conservatism?); secondary = tokens in/out, costUsd, latencyMs
  (already captured by `LlmUsageEvent` + the new console `[LLM]` line), schema-validation pass rate + retry count.
- **Output**: a comparison table per task → informs which task goes to which model and validates the portable prompt.
- Builds on the bench tools already in `tools/` (bench-haiku-vs-qwen, bench-dialogue-quality, bench-schema-conformance).
