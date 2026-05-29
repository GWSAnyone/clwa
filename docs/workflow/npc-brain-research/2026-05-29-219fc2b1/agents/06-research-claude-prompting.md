# Agent 06 — research: Claude prompting for roleplay personas

**Sources** (full list in raw.json): Anthropic official — keep-Claude-in-character (role prompting + prefill),
prompting best practices (Opus 4.8 / Sonnet 4.6 / Haiku 4.5), increase output consistency, models overview,
customer-support persona, mitigate-jailbreaks (XML `<values>`); + Sider Haiku-4.5 strategies, Morph Sonnet-vs-Haiku,
RP|Fiend roleplay system-prompt guide.

## Key practices
- Persona in the **system** prompt (persistent anchor); per-turn context in **user**.
- Define the character **densely** (backstory, worldview, speech patterns, triggers, what they DON'T know); bare roles
  → generic dialogue. Structure with XML tags (`<persona>/<values>/<speech_style>/<constraints>/<scenarios>`).
- **Pre-load common scenarios with canned in-voice replies**; use **3–5 diverse few-shot examples** (`<example>`),
  covering edge cases (deflecting meta/off-world, hostility, silence).
- **Phrase constraints positively** + give the WHY (Claude generalizes from rationale); SHOW the format, don't describe it.
- Counter the default direct/low-validation assistant tone explicitly; add never-break-character / never-say-AI.
- **Claude 4.5/4.6 follow instructions more literally** → dial back shouty `CRITICAL/MUST` (now over-triggers).
- **Prefill removed on Sonnet 4.6** → re-inject persona via the **user** turn on long threads (works on Haiku 4.5).
- Set `effort` low/medium for chat; generous max_tokens. Keep prompts short & high-signal (verbosity hurts Haiku).
- Match prompt style to output style (markdown in prompt → markdown out; write prose for spoken dialogue).

## Model notes
**Haiku 4.5** ($1/$5, prefill OK): wants short/explicit/structured prompts, labeled sections, one exemplar, mandated
schema; matches Sonnet on well-defined tasks, gap on ambiguous/reasoning-heavy. **Sonnet 4.6** ($3/$15, no prefill,
defaults effort=high): tolerates implicit reasoning, holds long-thread coherence, richer prose. Both more literal +
system-prompt-responsive than older Claude. Porting Qwen-tuned (long, ALL-CAPS) prompts verbatim to Claude
over-constrains and flattens voice.

## Pitfalls
Vague persona; relying on prefill (Sonnet 4.6 → 400); ALL-CAPS over-trigger; lore over-stuffing; negative-only rules;
forgetting to counter default tone; mutating system prompt every tick (kills cache → higher cost); homogeneous
few-shot; schemaInPrompt where native json_schema exists; not setting effort; meta-leakage without an explicit clause.

## Applicability to CLWA
Stable persona (name/PM/Enneagram/register/anti-AI) in `system`; volatile (mood/beliefs/scene/instinct) in `user` →
cache win, lowers recorded costUsd. dialogue/npc-dialogue = canonical keep-in-character (dense persona + few-shot +
author-framing + user-turn re-inject). Structured tasks (verdict/il/volition) → native Structured Outputs, route to
**Haiku**; open-ended (dialogue/reflection) → **Sonnet**. Add a shared never-AI clause to the base template.
