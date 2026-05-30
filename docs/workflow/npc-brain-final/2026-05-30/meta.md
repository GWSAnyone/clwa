# meta — NPC-brain Phase 5 final comparison

- **Date**: 2026-05-30
- **Milestone**: M6 (NPC Brain) — closing measurement, SPEC-npc-brain Phase 5.
- **Harness**: `tools/npc-brain/` — `run-baseline.ts` (all 8 fixtures × 3 models) + `run-dialogue-compare.ts`
  (dialogue baseline vs layered × 3 models).
- **Config**: MODELS=qwen,haiku,sonnet · RUNS=1 · JUDGE_RUNS=3 · judge=haiku (pointwise 1–5).
- **Models**: Qwen3.5-9b via local LM Studio; Haiku + Sonnet via claude-code subscription CLI. **No paid Anthropic API.**
- **Files**:
  - `report.md` — synthesis (baseline table, dialogue uplift, routing recommendations, methodology caveat).
  - `baseline.{md,json}` — raw full-table harness output (`baseline-2026-05-30T17-23-48`).
  - `dialogue-compare.log` — raw baseline-vs-layered dialogue run.
- **Headline**: layered prompt mean uplift **+2.0** on dialogue (base 2.5 → layered 4.5), grounding n→Y in 5/6 cells;
  Qwen meta-deflect 1.0→5.0 (fixed the "I am an AI" character break). Qwen open-ended recall (about-garrett) stays
  weak → validates **dialogue → Haiku** routing. Schema-pass 100% across all models on structured tasks.
- **Prior baseline (P0)**: `docs/workflow/npc-brain-baseline/2026-05-29/` (regression oracle; P5 reproduces it).
