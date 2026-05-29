# Agent 09 — research: small/local model (Qwen 7–9B) prompting + one portable prompt Qwen→Haiku→Sonnet

**Sources** (raw.json): Alibaba Qwen structured-output + JSON-mode docs; Jan.ai Qwen3 settings (greedy-decoding
warning); MePO (arXiv 2505.09930, why frontier prompts hurt small models); Aidan Cooper constrained decoding;
TianPan grammar-constrained generation (prompt-only <40% vs ~100%); LLM failure modes; Yoav Goldberg (CoT-in-schema);
EVA-Qwen2.5-7B roleplay card; zero-vs-few-shot; Rinat Abdullin structured output (reason-before-verdict).

## Key practices
- **Keep native constrained decoding ON** (json_schema strict) — the single highest-leverage lever for 7–9B
  (prompt-only JSON <40% on complex schemas vs ~100%; one team 32%→0.4% errors). CLWA already does this.
- **Reason field BEFORE the enum/decision field** (autoregressive: answer conditions on prior tokens) — cheap CoT substitute.
- **Natural descriptive enum values**, never opaque codes / forced lowercasing (lowers confidence).
- **One or two inline few-shot** showing tricky cases (a null, a "do nothing", a refusal) — frontier gets these zero-shot.
- **Match temp to task; never greedy on Qwen** (it repeats/breaks). Structured 0.15–0.4; roleplay 0.7–1.0;
  presence_penalty only on roleplay (>1.0 risks language-mixing).
- **Short, direct, imperative** instructions — MePO: frontier-optimized prompts exploit multi-step reasoning 7–9B can't do.
- **Trim context hard** (context rot at every length increase); **re-inject the critical constraint at the END** (attenuation).
- **Always validate + one-shot reformat retry**; don't embed a long CoT scratchpad inside the strict schema.

## The portable-prompt asymmetry (key for the 3-model comparison)
A Qwen-tuned prompt (short, explicit, inline example, schema-pinned, reason-before-answer, constraint-at-end) **runs
fine on Sonnet/Haiku**; a Sonnet-tuned prompt **fails on Qwen**. → **Author ONE prompt per task to the small model's
ceiling; frontier models coast.** Avoid frontier-only devices (deep CoT in prompt, abstract meta-instructions).

## Comparison-methodology note
**Measure DECISION/ROLEPLAY QUALITY, not format compliance** — constrained decoding flattens format differences, so a
format-failure-rate metric will wrongly conclude "they're equal." Hold embedding model + schema + example + field order
+ trimmed context constant; vary only the LLM; log schema-pass-rate + retry count as a secondary signal.

## Applicability to CLWA (per task)
volition (qwen, 0.35, maxTok 100): natural-language affordance enum, reason-before-action, feed only the PM-scored
shortlist, 1-shot "wait" example. il (qwen, 0.15, maxTok 400): most over-extraction-exposed → populate only fields
with explicit evidence, emit null otherwise (INV-07), one null-field example. verdict (sonnet→qwen fallback 300 tok):
clearest graceful-degradation case — one prompt, reason-before-verdict, inline example kept for both tiers, schema
fits 300. reflection (sonnet→qwen 0.7, 150): presence_penalty ~0.5 + "avoid repeating these" recent lines (cross-NPC
repetition). npc-dialogue (qwen 0.7, 200): tight character block + entity roster (no invented names) + end-of-prompt
persona re-inject. embeddings: model-locked → hold constant across the comparison.

## Pitfalls
Prose-only "respond in JSON"; greedy/temp 0; max_tokens too low (truncated JSON); decision-before-reason; opaque
enums; porting frontier prompts down unchanged; CoT-in-schema; rule stated only once at top; padding context;
trusting structured output without validation; comparing on format-failure-rate (flattened by constrained decoding);
presence_penalty >1.0 on Qwen (language-mixing).
