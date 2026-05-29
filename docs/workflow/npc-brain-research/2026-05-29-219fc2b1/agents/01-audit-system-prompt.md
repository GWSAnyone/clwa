# Agent 01 — audit: system-prompt construction

**Site**: `agent.ts buildSystemPrompt` (:306) + `buildRoleDirective` (:362) + crime role/secret builders
(`crime-justice/index.ts:651,699-816`) + heat (`heat.ts:107`) + the parallel `CLAUDE.local.md`
(`llm-npc-prompt-builder.ts:28`, claude-code route only). Full verbatim prompt text in `raw.json`.

## Structure
One big markdown template (`agent.ts:330-358`), fixed order: identity → Background → Personality → deepest drives →
Speech style → Current state (loc/activity/mood) → roleDirective (What you know / module role / People you know /
What drives you) → stress/growth → Your memories → secret → inner conflict → additionalContext (secrets→trust→
approach→IL) → Rules. On claude-code the SAME prose goes as `--system-prompt` AND a numeric `CLAUDE.local.md` persona
auto-loads — two stacked assemblies.

## Per-NPC vs shared
Per-NPC authored: name/role/background/speechStyle/secret/innerConflict/motive/enneagram/bigFive/capabilities/llm.
Live per-NPC: mood/location/beliefs/relationships/memories/heat/trust. Shared boilerplate: every header, the
bigFive→adjective map, 5-tier mood prose, 9×2 stress/growth tables (DUPLICATED in agent.ts long + personality-prose.ts
short — only long used), Rules block, all crime directive prose, trust strings, the whole CLAUDE.local.md scaffold.

## Top quality risks
- Personality flattening: nothing emitted for traits in 0.3–0.7 → "You are balanced personality."
- **Two divergent persona reps** (prose vs numeric CLAUDE.local.md) — redundancy/conflict, behaviour shifts with route.
- No few-shot; speechStyle Example: lines passed raw (copyable). Self-name guard = one weak negation (name-halluc).
- Over-stuffing: secret+conflict+HIDDEN crime+heat+trust+role+stress+beliefs+rels = wall of competing imperatives;
  "lost middle" mitigated only for shop items, not directives.
- Mutually-exclusive role directive (investigator else perpetrator…) drops guilt for investigator-perpetrator.
- Mood prose vs stress/growth prose can contradict. Anti-AI clause only on claude-code route.

## Top improvements
Graded mid-band descriptors; unify the two persona reps (one source of truth); few-shot via rotated speechReminder;
move top directive/Rules to END (lost-middle); reconcile mood↔stress; positive self-name guidance; accumulate role
facets; add anti-AI to shared Rules; delete duplicate stress/growth table.
