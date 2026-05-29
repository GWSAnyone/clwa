# Agent 05 — audit: dialogue prompt + conversation history

**Site**: `conversation.ts` runConversation (:83), buildInitiator/Responder/FollowUp prompts (:232/:244/:262),
DIALOGUE_RULE (:106), DIALOGUE_SCHEMA (:24); `agent.ts` _chatHistory (:43), clearChatHistory (:46), chat (:77),
chatStream (:103), generateResponse (:198); `server.ts:296,308` fullContext + chatStream call. Verbatim in `raw.json`.

## Structure
Player↔NPC (chatStream): system prompt + multi-turn `history` array + current user message (free-text streaming).
NPC↔NPC (runConversation): system prompt + single-shot prompt with the prior line inlined as quoted text; structured
DIALOGUE_SCHEMA (speech 5–80 chars/<15 words + gesture). Player text passed raw as `user` (trade-mode wraps with
`[SHOP INVENTORY …]`).

## Top quality risks
- **History trimmed to last 12 messages, NO rolling summary** → >6 exchanges ago vanishes (only noisy vector recall left).
- **`clearChatHistory()` defined but NEVER called** → per-NPC buffer persists across separate conversations (stale
  context on switch-back); buffer is process-memory only (lost on restart, not in save).
- Two player paths: `chat()` builds no history, `chatStream()` does → desync if any caller uses chat().
- **NPC↔NPC carries only the single previous line** → topic drift/repetition; echo/repeat guards exist because it's fragile.
- **Weak player framing**: raw player text, no "the stranger says:" attribution (contrast NPC↔NPC responder prompt).
- additionalContext injected mid-prompt before Rules → lost-middle attenuation of trust/secret/IL.
- conversation memory injects `Player said "...". I replied "..."` → re-recalls → self-reference echo.
- speechReminder example sampling is random per call (non-deterministic voice); parseDialogue regex strippers can
  truncate legit speech with ' - ' / braces. No system/developer-role separation for Rules vs persona.

## Top improvements
Call clearChatHistory on NPC switch (or key history per-conversation; persist/document); rolling summary of dropped
turns; pass a 2–3 line history window to NPC↔NPC; frame player text with attribution + relationship; unify the two
player paths; move hard constraints (length/no-narration) to the END / user turn; dedup the literal Player-said memory;
stabilize speechReminder per conversation (seed once); add 1–2 few-shot in-voice exemplars per NPC/archetype.
