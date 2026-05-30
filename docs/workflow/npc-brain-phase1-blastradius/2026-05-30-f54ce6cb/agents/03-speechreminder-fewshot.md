# Agent 3 — speechReminder rotation + adding rotating few-shot voice examples to the player-chat persona (Agent.buildSystemPrompt)

## Map: speechReminder rotation + rotating few-shot voice examples for player-chat persona

**TL;DR:** `speechReminder(agent)` (prompt-utils.ts:7) parses the NPC's newline-joined `speechStyle` string, pulls the `Example:` lines into a pool, and returns the description plus ONE randomly sampled example (`— e.g. ...`). It is used only in NPC<->NPC prompts. The player<->NPC chat persona — `Agent.buildSystemPrompt` (agent.ts:306, via `chatStream` at :103) — instead injects the WHOLE `speechStyle` verbatim (agent.ts:340-341), so the chat NPC sees every example at once: that is the "copied verbatim in the prototype" symptom. The fix is to reuse the same one-random-example rotation in the chat persona and add an optional structured `fewShotExamples?: string[]` source (default `[]`).

**Architecture / data flow:**
- `worlds/millhaven/npcs/*.json` → `NpcJson` (world-loader.ts:15) → `loadWorld()` maps to `AgentProfile` (world-loader.ts ~209) → `new Agent(profile, ...)`.
- `speechStyle` is a single string: line[0] = description, subsequent `Example: "..."` lines = the voice-example pool (bess.json:6 confirms format). Examples live INSIDE speechStyle today; there is no separate field.
- NPC<->NPC: conversation.ts (`buildInitiator/Responder/FollowUpPrompt` :235/:250/:268) and interaction.ts (`buildPurpose/ResponsePrompt` :156/:176) call `speechReminder(agent)` → `(Your voice: ${speech})`, one random example each.
- Player<->NPC: server.ts `chat` handler → `agent.chatStream` (server.ts:308) → `buildSystemPrompt` (agent.ts:109) → `## Speech style\n${this.profile.speechStyle}` (agent.ts:340) — verbatim, ALL examples.

**Rotation mechanism (reusable?):** Stateless, `Math.random`-based, one example per call, no persisted index. Reusable for player chat directly — `buildSystemPrompt` is rebuilt every `chatStream` turn (per player message, multi-turn history up to 12 msgs, agent.ts:114), so calling the same sampler there yields a fresh example each turn = natural rotation across the conversation. Caveat: `prompt-utils.ts` imports `Agent`, so agent.ts importing `speechReminder` would create a cycle — inline the sampling in `buildSystemPrompt` instead.

**Where AgentProfile is defined:** agent-types.ts:81-111 (exported interface). Optional fields are `field?: T`, spread conditionally in the loader. No `fewShotExamples` exists yet.

**Minimal safe add (default []):**
1. agent-types.ts:81 — add `fewShotExamples?: string[];` (additive).
2. world-loader.ts NpcJson:15 — add `fewShotExamples?: string[];`; in the profile mapping (~231) add `fewShotExamples: npc.fewShotExamples ?? [],` (concrete default, both boot paths → INV-21-safe).
3. agent.ts buildSystemPrompt (~340) — replace verbatim injection with: pool = `[...(fewShotExamples ?? []), ...speechStyle 'Example:' lines]`, sample one, render description + `e.g. <one>`.
4. (Optional) Update `speechReminder` to also merge `agent.profile.fewShotExamples`, so one rotation mechanism serves both player-chat and NPC<->NPC.

Player profile (index.ts:509-518) has `speechStyle: ''` and no examples; with default `[]` the player persona stays empty and safe — `speechReminder` already returns just the (empty) description when the pool is empty.

**Gotchas:**
- Import cycle agent ↔ prompt-utils — inline in buildSystemPrompt, don't import speechReminder into agent.ts.
- `Math.random` makes prompt text non-deterministic — any prompt snapshot tests will flake once an example is injected into the chat persona.
- If both inline `Example:` lines and `fewShotExamples` are present, decide merge vs. replace (default merge doubles the pool — harmless but be intentional).
- save.json round-trip: keep readers using `?? []` since older saves may lack the field (INV-21 boot-path consistency).
