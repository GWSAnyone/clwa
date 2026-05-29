# Agent 02 — audit: beliefs & vector-memory → context

**Site**: `beliefs.ts` summarizeForPrompt (:121) / summarizeForMemory (:147) / getAllBeliefs (:117);
`memory.ts` recall (:150,:177); `event-registry.ts phraseBelief` (:766); crime phrasing (`crime-justice/index.ts:643`);
injection at `agent.ts:305` (memories) + `buildRoleDirective` + `volition.ts:403` (beliefs in USER prompt).

## How it works
Two channels: (A) **beliefs** — structured fields rendered to NL at build time; in volition they sit in the USER
prompt under `WHAT YOU KNOW:` (deliberately, to dodge lost-middle), in dialogue they sit in the SYSTEM prompt as
`## What you know` + role-directive sections. (B) **memory** — vector recall top-5, composite score
`relevance*0.4 + decayedImportance*0.4 + freshness*0.2`, injected as `## Your memories` with time+vividness labels.

## Top quality risks
- **Beliefs ranked by pure confidence DESC** — no recency/salience/topic relevance, and NO recency cue (model can't
  tell fresh certainty from a decayed months-old rumour; memories have a cue, beliefs don't).
- **Duplication**: `## What you know` and the crime role-directive narrate the same top belief twice.
- **Blanket phrasing** `"${who} committed ${verb} against ${target}"` is ungrammatical for theft/attack.
- **Silent loss**: unregistered event label → belief dropped from prompt with no warning.
- **Normalization mismatch**: decay.ts composite ÷10 vs memory.ts recall raw decayedImportance. Recency keys off
  creation, not last-access. Degenerate recall query on terse inputs ("hi") returns noise.
- Autonomous decisions never recall episodic memory (only dialogue). Belief→memory→belief echo via interaction.ts:112.
- No global prompt token budget; memory block (low priority, bottom) is first truncation casualty.

## Top improvements
Composite ranking (confidence×recency) + topic filter for prompt beliefs; recency cue on belief lines; dedup vs role
directive; per-event phrasing via `registerBeliefPhrasing` (already supports first-non-null-wins); replace silent
null-drop with safe+warn; guard degenerate recall; feed memories to volition or document the split; soft token budget
+ reorder so memories survive; tag belief-derived memories to break the echo loop.
