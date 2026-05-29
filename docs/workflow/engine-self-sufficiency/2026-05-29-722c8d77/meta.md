# Run metadata

| Field | Value |
|-------|-------|
| Workflow | `engine-self-sufficiency` (RE-PROBE after Phase A) |
| Run id | `wf_722c8d77-6e7` |
| Task id | `wd1f15lgj` |
| Date | 2026-05-29 |
| Agents | 4 (2 genre re-probes + 1 static recount + synthesis) |
| Subagent tokens | ~419 704 |
| Duration | ~458 s (~7.6 min) |
| Result | `report.md` (synthesis `reportMd`) · `raw.json` (full return) · `agents/` (per-probe) |
| Baseline run | `2026-05-29-28aeb820` (7/10) |

## Question
Measure the engine module-sufficiency AFTER Phase A genre-neutralization (A1–A9 + A4a) vs the 7/10
baseline — did the score climb and leak-count drop, per the reusable module-sufficiency method?

## Phases / agents
- **Re-probe** (parallel, `general-purpose`): `reprobe:trading-economy`, `reprobe:court-romance`
  (each re-traces its genre against the current neutralized engine source), `static-recount`
  (greps engine for remaining crime vocab, confirms import boundary + new hooks generic).
- **Verdict**: synthesis — new weighted score vs 7/10, remaining-leak split (deferred vs genuine vs inert).

## Headline
**8.5/10 occasional-engine (high end), up from 7/10.** Blocking leaks: **2 → 0** (A2/A3 prose drained,
source-verified). Per-genre: trading 8.5 (93% module-satisfiable), court-romance 9 (92%), static-recount
9 (97%). The 8.5 weighted floor is set entirely by the consciously-deferred PlayerJournal + IL
accusation/evidence subsystem (~191 of 455 crime-vocab occurrences quarantined in journal.ts + il.ts
behind crime-only gates). The two flagged non-deferred residuals (volition.ts debug gate, wantedSubjects)
were drained immediately after this run → non-deferred surface now effectively zero genuine leaks.

> Per-agent `reportMd` rendered under `agents/`. Full structured return (synthesis + 3 probes) in `raw.json`.
> Raw per-agent transcripts: session `subagents/workflows/wf_722c8d77-6e7/`.
