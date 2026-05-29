# Agent 08 — research: context engineering & memory management

**Sources** (raw.json): Anthropic "Effective context engineering for AI agents"; Stanford Generative Agents
(recency+importance+relevance); Liu et al. "Lost in the Middle" (TACL 2024); Morph "Context Rot" (Chroma 18-model
study, U-shape); mem0 context-engineering guide (80% token cut via summarization); Weaviate (selective promotion,
4 failure modes); arXiv 2505.16067 (experience-following); Comet best practices.

## Key practices
- **Composite memory score** = recency + importance + relevance, each min-max normalized; recency = exp-decay on
  **last-access** (not creation). CLWA's `relevance*0.4 + decayedImportance*0.4 + freshness*0.2` is sound — gaps are
  recency-on-creation and a normalization inconsistency.
- **Over-fetch then rerank**; inject a **small final K (5–8)** — extra memories dilute attention.
- **U-shape**: load-bearing context at START and END, never middle (30%+ accuracy loss mid-context, RoPE artifact).
  Order retrieved items **ascending** so the best lands last, right before the model speaks.
- **Separate stable persona (cache) from volatile state (refresh)** — byte-stable persona = prompt-cache win = lower cost.
- **Compact PROACTIVELY** (~70–80% budget), not at the ceiling; treat the window as a hard per-section token budget.
- Structured/delimited context (headers/XML + numeric value **and** label) beats prose for state.
- Promote to long-term selectively (importance-gated); retire by recency + retrieval-frequency.
- Four over-stuffing failure modes: **poisoning, distraction, confusion, clash.**

## Model notes
CLWA's small local Qwen suffers lost-in-the-middle + context rot **earlier and harder** → aggressive curation
(top 5–8, not 30) matters MORE than on frontier models; re-stating critical constraints near the decision point is
exactly right; structured-output adherence is more fragile (hence the defensive parseDialogue). Do relevance
filtering OUTSIDE the model (over-fetch+rerank) since 9B can't distill relevance from a long dump.

## Pitfalls
Too many memories (CLWA top-30); important item in the MIDDLE; recency on creation not last-access; the decay.ts ÷10
vs memory.ts raw inconsistency; truncating instead of summarizing; reactive compaction at the ceiling; reflections
(imp 9) crowding out fresh observations; context poisoning by a wrong high-confidence belief; mixing volatile state
into the cached persona prefix (breaks cache); dumping raw transcripts (self-reference cascade).

## Applicability to CLWA
npc-dialogue threading: move the line-being-reacted-to + active topic to the very END of the user turn, persona
cached at start. Beliefs: cut top-30 → 5–8, JIT-relevant to interlocutor/topic, ascending order, late position.
memory.ts: fix last-access recency + reconcile normalization. reflection/consolidation: trigger on budget not just
importance-50. All structured tasks: small curated set, labeled fields, the decision criterion / JSON schema LAST.
