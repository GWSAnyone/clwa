# Agent 3 — CLWA dialogue history — M6 Phase 2 (rolling-summary, clearChatHistory on NPC switch + warm-session reset, NPC↔NPC window, conversationText dedup)

## Map: CLWA dialogue history — M6 Phase 2

**TL;DR:** Player chat history lives in two disconnected places — `Agent._chatHistory` (in-process buffer, trimmed to 12 in `chatStream` only) and the warm per-NPC Claude session (in-process conversation memory keyed by `agentId`). `clearChatHistory()` exists and is correct but is dead code (zero callers). The server chat handler tracks the current NPC only in a per-message-local var, so NPC-switch is currently undetectable server-side. NPC↔NPC prompts already receive the full line array but deliberately use only the last line. The verbatim `Player said.../I replied...` transcript is stored to vector memory on every turn (the dedup target). Adding a `history-summary` task is mechanical via `registerLlmTask` + a Qwen route.

**Architecture:**
- `Agent` (engine, `agent.ts:35`) — owns `_chatHistory` (`:48`), `clearChatHistory()` (`:51`, dead), `chat()` (`:83`, no history), `chatStream()` (`:110`, trims to 12, stores transcript). Calls `generate('dialogue')`/`generateStream('dialogue')`.
- Server chat handler (`server.ts:128`) — orchestrates IL → effects → `agent.chatStream(...)`. Tracks NPC only via local `chatAgentId` (`:85`, `:129`). `chat_open`/`chat_close` (`:110`/`:118`) toggle `inPlayerChat`.
- `ClaudeCodeProvider` (`claude-code/src/index.ts:131`) — two `ClaudeSessionPool`s: `pool` (streaming, keyed by `agentId`, `:137`) and `structuredPool` (keyed `agentId::model::schema`, `:138`,`:298`). `stream()` reuses/respawns warm sessions (`:377-413`). Only `dispose()` (all) exists (`:467`).
- `ClaudeSessionPool` (`session.ts:256`) — `get/set/remove/size/disposeAll`. No per-agent reset. `ClaudeSession.kill()` (`:209`) is the teardown primitive.
- `runConversation` (`conversation.ts:82`) — NPC↔NPC loop; holds full `lines[]`, calls `buildInitiatorPrompt`/`buildFollowUpPrompt`/`buildResponderPrompt`.
- LLM registry/façade (`llm-registry.ts`, `llm-client.ts`) — `registerLlmTask` (`:50`), `generate()`/`generateStream()`, `validateLlmRouterContract` (`:155`).
- Routing tables — `llm-defaults.ts:buildDefaultRouter()` + `world.json:467` `config.llm.routes`.

**Data flow (player chat):**
WS `chat` (`server.ts:128`) → IL extract (`:183`) → `applyDialogueMeaning` (`:246`) → `agent.chatStream(effectiveMessage, onToken, fullContext)` (`:308`) → push user to `_chatHistory`, trim>12 (`agent.ts:121`) → `generateStream('dialogue', {history, agentContext:{id}})` (`:130`) → warm session via `pool.get(agentId)` (`index.ts:377`) → push reply to `_chatHistory` (`agent.ts:141`) → store `Player said: "..." I replied: "..."` @imp 2 (`:143`) → `chat:done` (`server.ts:312`).

**NPC↔NPC flow:** `runConversation` loop (`conversation.ts:96`) builds `lines[]`; follow-up exchanges pass full `lines` to `buildFollowUpPrompt` (`:97`) which then uses only `previousLines[length-1]` (`:266`). Responder gets only the current `initiatorLine: string` (`:255`).

**Key decisions / patterns:**
1. Trim-to-12 is `chatStream`-only (`agent.ts:122`); `chat()` keeps no history — player path is streaming so this is the live path.
2. Warm sessions are per-`agentId`; persona/model change auto-respawns (`index.ts:379`). Switching NPCs hits a different key, so corruption isn't the issue — stale same-NPC memory across re-opens is.
3. `LlmTask` is an open string (`llm-types.ts:15`); unrouted tasks fall back to `LLM_ROUTER.default` (Qwen) and still validate (`llm-registry.ts:162`).
4. Engine never names providers — routing lives in server `llm-defaults.ts` + per-world `world.json` (control panel).

**Gotchas:**
- `clearChatHistory()` has zero callers (confirmed via `find_referencing_symbols`) — wiring it is the whole task.
- `chatAgentId` is per-message-local (`server.ts:85`) — cannot detect NPC switch; needs promotion to per-connection state.
- No per-agent session reset in the provider contract (`llm-types.ts:190`); only `dispose()` (kills ALL). Must add a method + sweep `structuredPool`'s compound keys.
- Transcript stored twice (`agent.ts:99` and `:143`) — dedup must treat both for consistency.
- `history-summary` must route to Qwen (different semaphore than `dialogue`/claude-code) to avoid blocking the in-flight stream (INV-01).

**Referenced answers:**
- Q: clearChatHistory body + who should call it? / A: `clearChatHistory(): void { this._chatHistory = []; }` (`agent.ts:50-53`). The SERVER chat handler should call it on the PREVIOUS agent when `msg.agentId` changes — but `chatAgentId` (`server.ts:85`) is per-message-local; promote to per-connection state, then call on the prior id in the `chat` branch (`:128`) or in `chat_open` (`:110`).
- Q: ClaudeSessionPool reset API? / A: None for one agent — only `remove(agentId)`/`disposeAll()` (`session.ts:272/281`) and `ClaudeSession.kill()` (`:209`). Add `resetAgentSession(agentId)` on `ClaudeCodeProvider` (kill+remove from `pool`, sweep `structuredPool` prefix `agentId::`), expose optional `resetAgentSession?` on `LlmProvider` (`llm-types.ts:190`), and a thin engine façade.
- Q: How to register + route history-summary? / A: `registerLlmTask('history-summary', {});` in crime-justice bootstrap (`index.ts:59-64`); add a `{provider:'lm-studio', model:QWEN, ...}` route to `buildDefaultRouter()` (`llm-defaults.ts:47`) and `world.json` `config.llm.routes` (`:475`). Call it via `generate('history-summary', {system, user, agentContext:{id}})` (`llm-client.ts:153`).
- Q: NPC↔NPC last-line handling? / A: `buildFollowUpPrompt` receives full `previousLines` (`conversation.ts:262`) but uses only `[length-1]` (`:266`); `buildResponderPrompt` gets only the current `initiatorLine: string` (`:246`); `buildInitiatorPrompt` has none. The full `lines[]` is available at the call site (`:97`) — thread `lines.slice(-3)` into the builders.

**Not explored:** `formatHistorySeed` internals, `NpcMemoryManager`/`onObserve` file-memory side, `analyzeConversationImpact` (importance adjustment in world.ts), and the `chat()` non-streaming path's live usage (player path uses `chatStream`).
