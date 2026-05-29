# NPC-brain Phase 0 — baseline summary (2026-05-29)

Harness: `tools/npc-brain/` · 8 fixtures × {qwen, haiku, sonnet} · judge=haiku (pointwise 1-5) · RUNS=1 · JUDGE_RUNS=1.
Full table: `baseline-2026-05-29T19-40-41.md` (+ `.json`). This is the **regression oracle** for Phases 1-5.

> Caveat: JUDGE_RUNS=1 = single (noisy) sample per cell; directionally clear, but rerun with JUDGE_RUNS=3 for the
> final Phase-5 comparison. The judge's `inChar` flag is meaningless for non-character tasks (il/volition/verdict)
> — to be fixed in the harness (don't score inChar there).

## Scores (1-5)

| task / scenario | qwen | haiku | sonnet |
|---|---|---|---|
| dialogue / about-garrett | **1.00** | 5.00 | 5.00 |
| dialogue / meta-deflect | **2.00** | 5.00 | 5.00 |
| npc-dialogue / bribe-rumor | 5.00 | 5.00 | 5.00 |
| il / benign-greeting | 3.00 | 4.00 | 4.00 |
| il / accusation-question | **2.00** | 4.00 | 3.00 |
| volition / debt-pressure | 5.00 | 4.00 | 5.00 |
| verdict / theft-moderate | 5.00 | 3.00 | 5.00 |
| reflection / after-theft | 4.00 | 4.00 | 5.00 |

Cost: qwen $0 (local), haiku ~$0.003-0.022/call, sonnet ~$0.002-0.016. Latency: qwen 0.9-3.6s; claude 5-43s
(cold-spawn; haiku reflection 42s spat 4214 output tokens — an outlier worth a maxTokens cap).

## Findings

1. **Qwen's failure mode is free-text dialogue, hard.** `about-garrett`=1.00: invented an event ("Ted took gold from
   a policeman") — grounded=0% — and **code-switched into Ukrainian** mid-reply. `meta-deflect`=2.00: broke character
   and **named itself** ("я — это Elara"). These are exactly the hallucination / language-mixing / self-naming issues
   the research flagged → the Phase 1 layered prompt (grounding + knowledge-boundary + language-lock + positive
   self-name guidance + few-shot) targets them directly.
2. **Qwen is competitive-to-equal on STRUCTURED tasks** at $0/fast: npc-dialogue 5, volition 5, verdict 5 (beat
   haiku's 3 on the verdict), il ~2-3 (weaker — used `theft` instead of the known `GOODS_STOLEN`, grounded=0%).
   → Routing: dialogue MUST go to Claude; volition/verdict/npc-dialogue can stay on Qwen (free, fast, no quality
   loss). il needs the known-event-type grounding fix before trusting Qwen.
3. **Haiku ≈ Sonnet on most tasks**; Sonnet edges ahead on open-ended (reflection 5 vs 4) and verdict proportionality.
   Haiku chose `release` on moderate-evidence theft (judged 3 = too lenient); qwen `fine` / sonnet `warning` (both 5).
4. **Structured-output (schema) pass rate = 100% across all three models** — constrained decoding works everywhere;
   the real differentiator is decision/roleplay quality, exactly as the research predicted.

## Implication for Phase 1
Biggest measurable win is lifting Qwen dialogue (1.0/2.0). Implement the layered prompt on `dialogue` with grounding,
knowledge-boundary, language-lock, positive self-name rule, and 3-5 few-shot; re-run `TASKS=dialogue` vs this
baseline. Target: Qwen dialogue ≥3-4, Haiku/Sonnet hold at 5.
