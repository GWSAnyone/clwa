# Workflow Reports Archive

Raw, browsable outputs of multi-agent **Workflow** runs (the parallel-agent orchestrations the
assistant runs for surveys, audits, planning). Kept so you can always read the **raw** report — every
agent's findings and the final synthesis — not just the assistant's chat summary.

> Workflow scripts run sandboxed (no filesystem access), so these files are written by the **main agent**
> from the workflow's returned result **after** it completes. Each run is immutable history.

## Layout

```
docs/workflow/
  README.md                              ← this file
  <workflow-slug>/                       ← one folder per workflow kind (meta.name), e.g. engine-self-sufficiency/
    <YYYY-MM-DD>-<runid8>/               ← one folder per run (date + short run id), e.g. 2026-05-29-28aeb820/
      report.md      ← final synthesis, readable (the headline deliverable)
      meta.md        ← the question/prompt, run id, phases, agent count, tokens, duration, date
      agents/
        <NN>-<label>.md   ← each agent's findings, rendered readable (NN = run order)
      raw.json       ← full raw returned result (total fidelity fallback)
```

- **slug** = the workflow's `meta.name` (stable across runs of the same workflow → history accumulates per kind).
- **runid8** = first 8 chars of the `wf_…` run id (disambiguates same-day re-runs).
- `report.md` is the agent's own prose where the synthesis emitted a `reportMd` field; otherwise rendered from structure.

## Index of workflow kinds

| Slug | Purpose |
|------|---------|
| `engine-generalization-survey` | Rank engine investments that widen game-creation space |
| `engine-self-sufficiency` | Empirically verify module-only extensibility (does a new genre need only a module?) |
| `plan-position-movement` | Plan + adversarially reflect on the position-movement rewrite (Item 2) |
| `whats-next-clwa` | Survey open specs/roadmap/audit → ranked next-task recommendation |

> New workflow kinds append a row here. Runs append a dated folder under their slug.
