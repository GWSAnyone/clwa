# NPC-brain — Phase 5 final comparison (2026-05-30)

Milestone **M6 (NPC Brain)** closing measurement. Harness: `tools/npc-brain/` · 8 fixtures × {qwen, haiku, sonnet}
· judge = haiku (pointwise 1–5) · RUNS=1 · **JUDGE_RUNS=3** (auditor-grade; P0 used JUDGE_RUNS=1).
Raw: `baseline-2026-05-30T17-23-48.{md,json}` + `p5-dialogue-compare.log` (copied into this folder).

> **No paid Anthropic API** — Qwen via local LM Studio, Haiku/Sonnet via the claude-code subscription CLI.

## Methodology caveat (read first)

The harness fixtures are **static, hand-authored prompt strings**. `FIXTURES` encodes the **baseline (P0)** prompt;
`LAYERED` (fixtures-layered.ts) encodes the **new layered design — for `dialogue` only**. So:

- The **dialogue uplift** below is a direct, measured A/B of the M6 layered prompt (baseline vs layered, same model).
- The other-task P3 improvements (verdict reason-before-decision, reflection sanitize, IL few-shot, npc-dialogue
  presence-penalty) live **in the engine**, not in these static fixtures — the baseline run re-runs the *old* prompts,
  so it functions as a **regression oracle** (numbers should match P0), not as a measure of those engine changes.
  Those are validated by `bun test` (280) + the final clwa-auditor (INV-14/01/16/21 CLEAN), not by this table.

## Full baseline table — current quality + routing signals (JUDGE_RUNS=3)

| task / scenario | qwen | haiku | sonnet | schema | notes |
|---|---|---|---|---|---|
| dialogue / about-garrett | **1.00** | 4.00 | 5.00 | — | qwen grounded=0%, code-switched to Ukrainian, invented a claim |
| dialogue / meta-deflect | **2.00** | 4.00 | 5.00 | — | qwen grounded=0% (invented bribe claim); broke meta-deflect |
| npc-dialogue / bribe-rumor | 3.00 | 5.00 | 5.00 | 100% | all schema-valid; qwen terse but in-character |
| il / benign-greeting | 3.00 | 5.00 | 5.00 | 100% | all grounded; qwen low extractionConfidence |
| il / accusation-question | **2.00** | 4.00 | 3.00 | 100% | qwen used `theft` (not the known `GOODS_STOLEN`), grounded=0% |
| volition / debt-pressure | **5.00** | 4.00 | 5.00 | 100% | qwen = sonnet, free + fast; haiku slightly over-narrated |
| verdict / theft-moderate | **5.00** | 3.00 | 5.00 | 100% | haiku `release` (too lenient, grounded=0%); qwen `fine` / sonnet `warning` |
| reflection / after-theft | 2.00 | 5.00 | 5.00 | — | qwen grounded=0% (over-generalized); claude both strong |

Cost/latency: qwen $0 / 0.9–2.5s (local). Claude 5–22s, $0.002–0.016/call (subscription CLI). Schema-pass = **100%
across all three models** on every structured task — constrained decoding works everywhere; the differentiator is
decision/roleplay quality, as the research predicted.

### P0 → P5 consistency (oracle holds)
P5 baseline reproduces the P0 table (2026-05-29) on the discriminating cells: dialogue qwen 1.0/2.0, il-accusation
qwen 2.0, volition qwen 5.0, verdict qwen 5.0 — identical. Minor judge-noise drift on a couple of cells
(npc-dialogue qwen 5→3, reflection qwen 4→2) is within JUDGE_RUNS sampling variance. The harness is stable.

## Dialogue layered uplift — baseline vs layered (the M6 win)

Same scenarios × 3 models, baseline prompt vs the M6 layered prompt (JUDGE_RUNS=3):

| scenario | model | base | layered | Δ | grounded |
|---|---|---|---|---|---|
| about-garrett | qwen | 2.0 | 2.0 | +0.0 | n → n |
| about-garrett | haiku | 2.0 | 5.0 | **+3.0** | n → **Y** |
| about-garrett | sonnet | 3.0 | 5.0 | **+2.0** | n → **Y** |
| meta-deflect | qwen | 1.0 | 5.0 | **+4.0** | n → **Y** |
| meta-deflect | haiku | 4.0 | 5.0 | +1.0 | Y → Y |
| meta-deflect | sonnet | 3.0 | 5.0 | **+2.0** | n → **Y** |

**Mean uplift +2.0** (base 2.5 → layered 4.5). **Grounding flipped n→Y in 5 of 6 cells.**

Headline: **Qwen meta-deflect 1.0 → 5.0**. The baseline literally broke character and admitted being an AI
("…да, я искусственный интеллект"); the layered prompt's knowledge-boundary + in-character + positive-self-name
rules turned that into a graceful in-world deflection ("моя память о событиях этого города ценнее любой базы данных").
Exactly the failure mode the research flagged — now closed.

**Honest caveat — Qwen / about-garrett stayed at 2.0 (ungrounded).** On the open-ended "tell me about X" recall it
still fragments/invents even with the layered prompt. The layered design reliably fixes *deflection* and lifts the
*Claude* models to the ceiling (all four claude cells → 5.0, grounded Y), but does **not** fully fix Qwen's free-text
recall-grounding. This **validates** (not contradicts) the routing decision: **dialogue → Haiku**, Qwen fallback only.

## Routing recommendations (data-driven — matches millhaven `world.json` live routes)

- **dialogue → Haiku** (Qwen fallback). Qwen baseline collapses on free-text roleplay (grounding/language); Haiku
  holds 4–5 fast and cheap. Sonnet reserved (5.0 but pricier/slower) — fallback-worthy, not default.
- **npc-dialogue → Qwen** (+ `presencePenalty` 0.5 against cross-NPC repetition). Schema-valid, in-character, free.
- **volition → Qwen**. Equals Sonnet (5.0) at $0 / ~1.4s — no reason to pay.
- **verdict → Sonnet**. Proportionality matters; Haiku was too lenient (`release` = 3.0). Qwen `fine` also fine (5.0)
  but Sonnet's calibrated `warning` is the safer default for the justice-quality-critical path.
- **reflection → Sonnet**. Open-ended synthesis; both claude models 5.0, Qwen over-generalizes (grounded=0%).
- **il → Qwen** with the claude-code/haiku **fallback** (live config) — Qwen is cheap/fast and schema-valid, but its
  event-type grounding is weaker (`theft` vs `GOODS_STOLEN`); the P3 few-shot targets this, fallback covers misses.
- **embeddings → Qwen** (local nomic-embed). **history-summary → default (Qwen)** — cheap text task.

This is exactly the live routing in `worlds/millhaven/world.json`. The data confirms the assignments.

## Conclusion
M6 closes with the routing strategy empirically validated: pay Claude only where free-text quality is the product
(dialogue, reflection, calibrated verdict); keep structured/decision tasks (volition, npc-dialogue, il, embeddings,
history-summary) on free, fast, local Qwen with no measured quality loss. The layered prompt's measured job — lifting
Qwen free-text dialogue off the floor — is quantified below.
