# Agent 07 — research: LLM-NPC roleplay consistency (2024–2026)

**Sources** (raw.json): RoleFact (arXiv 2406.17260, atomic-fact verify), TimeChara (2405.18027, knowledge-boundary
experts), Fixed-Persona SLM (AAAI 2026, 2511.10277, LoRA + 2 ChromaDB stores), Emotional RAG (2410.23041), VER emotion
reward (MDPI 2025), Cross-Platform NPC (2504.13928, 3-part prompt + 6-round window), Generative Agents (Park et al.),
Ian Bicking roleplay notes, persona-drift analysis (>30% after 8–12 turns).

## Key practices
- **Grounding via atomic-fact verify** (RoleFact): draft → decompose into atomic facts → verify each vs world facts →
  rewrite to drop unsupported (+18% precision, −44% temporal hallucination). **Don't fully strip parametric knowledge**
  (that lowered BOTH informativeness and precision) — modulate via a confidence threshold.
- **Knowledge-boundary hint** (TimeChara): cheap pre-pass injects "you don't know facts after your time / events you
  weren't present for; if unsure, say you don't know rather than invent." Even zero-shot wording measurably cut hallucination.
- **Static persona core first**, don't re-inject/mutate every turn (drift >30% by turn 8–12). Short system prompt
  (<300 tok); critical constraint at BEGIN **and** END (last message gets disproportionate attention).
- **Describe actions, don't negate traits**; traits as words ("wary", "nimble") not numbers.
- **Mood-dependent retrieval** (Emotional RAG): recall by semantic + emotional similarity to current mood; state mood explicitly.
- **Author-framing** + attributed player speech ("Player says: …") beats "You ARE X"; forbid ending every reply with a
  question / moral disclaimers / fourth-wall breaks.
- **Two decoupled memory stores** (conversation vs world-knowledge); cap history (~6 rounds) + guided summarization;
  rank by recency+importance+relevance; periodic Reflection synthesizes higher-level beliefs.
- **Measure with adversarial evals**: cross-universe Qs (shouldn't answer), future/not-present Qs, AND open-ended Qs
  (confirm not over-conservative). Co-measure refusal quality, not just hallucination.

## Model notes
Claude can run author-framing + knowledge-boundary + RoleFact self-check in-context without fine-tuning; **Haiku is
cheap enough to be the fact-checker / name-hallucination post-pass over Qwen drafts**. 7–9B (Qwen) holds persona far
better with a SHORT fixed prefix or LoRA than long instructions it deprioritizes — shorten, critical rule LAST,
concrete behavior over abstract rules, cap+summarize history, lean on retrieval grounding. Cross-NPC phrase repetition
(known CLWA issue) = persona drift → distinct fixed prefixes per archetype + mood-varied retrieval.

## Pitfalls
Amputating parametric knowledge; over-conservatism; 800+ tok walls; mutating persona per turn; conflicting fields
across layers (flip-flop); negation-based emotion rules; identical prompts across NPCs/models; bigger LoRA data
overfits; unbounded history; ending on questions / disclaimers; trusting NPCs to respect their own knowledge boundary.

## Applicability to CLWA
dialogue: fixed first-position persona + knowledge-boundary sentence + (optional) RoleFact post-pass for high-stakes
lines; restate the 1–2-sentence/in-character/known-facts guard at the END. npc-dialogue: two-store memory + attributed
speech + ground to the SPEAKER's beliefs only (fixes name hallucination). volition/il: Bicking hidden internal
monologue (private thought → spoken line). Centralize shared guardrails; per-NPC persona in world JSON; no duplicate facts.
