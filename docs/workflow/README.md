# Workflow Reports Archive

Raw, browsable outputs of multi-agent **Workflow** runs (the parallel-agent orchestrations the
assistant runs for surveys, audits, planning). Kept so you can always read the **raw** report — every
agent's findings and the final synthesis — not just the assistant's chat summary.

> These files are written by the **main agent** from the workflow's returned result **after** it completes —
> NOT by the workflow's subagents. The workflow *script* is sandboxed (no FS), and subagents also do not
> reliably write to disk: the default workflow subagent is return-oriented and skips side-effecting tool
> calls (falsely claims "WRITE=success" with 0 tool calls), and even `general-purpose` subagent writes hit a
> known Claude Code persistence bug (issues #7032/#9458/#4462). **Convention:** every workflow ends with
> `return { result, agents }` (final synthesis + each agent's output) so the main agent can persist both the
> synthesis and per-agent reports. Each agent's schema SHOULD carry a `reportMd` string (its own readable
> report) → written verbatim as `agents/<NN>-<label>.md`; the synthesis's `reportMd` → `report.md`. Where a
> `reportMd` is absent, the report is rendered from the structured result. Each run is immutable history.

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
