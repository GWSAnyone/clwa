# Run metadata

| Field | Value |
|-------|-------|
| Workflow | `engine-self-sufficiency` |
| Run id | `wf_28aeb820-083` |
| Task id | `w65yc1sf8` |
| Date | 2026-05-29 |
| Agents | 4 (static audit [clwa-auditor] + 2 genre probes + synthesis) |
| Subagent tokens | ~493 028 |
| Duration | ~524 s (~8.7 min) |
| Result | `report.md` (the synthesis' own `reportMd`, verbatim) · `raw.json` (full raw return) |

## Question
Empirically verify whether the engine is module-sufficient: for a game of a COMPLETELY different focus
than crime-detective, would you need ONLY a new module (as designed) or also constant engine changes? Plus:
design a repeatable verification METHOD.

## Phases / agents
- **Probe** (parallel): `audit-static-coupling` (clwa-auditor: engine→module coupling, INV-14 rigor, registry
  coverage), `probe-trading-economy` (peaceful trading village, zero crime — trace module-only vs forced
  engine changes), `probe-court-romance` (non-violent court intrigue — same trace, contrasting genre).
- **Verdict**: synthesis — sufficiency verdict + score rubric + legit-gaps vs assumption-leaks + reusable
  module-sufficiency test + full `reportMd`.

## Headline
**occasional-engine, 7/10** — behavioral physics universal (~85% module-satisfiable, both genres converged);
a different-focus game needs a module **plus a bounded one-time engine investment** (one state subsystem or
relationship-richness upgrade + draining ~8 prose/type crime leaks), after which that domain is module-only.
Import boundary perfect; semantic boundary partially violated. The reusable test method is in `report.md`.

> Per-agent raw outputs were consumed by the synthesis (only the synthesis is in `raw.json`); per-agent
> transcripts live under the session's `subagents/workflows/wf_28aeb820-083/`.
