# Agent 02 — player↔NPC dialogue flow

- **entryPoint**: `server.ts:128` — WS handler `if (msg.type === 'chat')` (client msg `{type:'chat', agentId,
  message, evidenceIds?}` from `ws.ts:49`).
- **currentlyLogged**: **false** (reply only streamed to client + stored in memory).

## Chain
1. `ws.ts:49` — client `chat` WSMessage arrives.
2. `server.ts:128` — resolves speaker `agent = agents.get(msg.agentId)`, validates alive + co-location with
   `world.playerAgent`, freezes NPC (`inPlayerChat=true`).
3. `server.ts:183` — `extractDialogueMeaning(msg.message, ilContext)` → structured meaning.
4. `server.ts:246` — `applyDialogueMeaning(...)` mutates beliefs/mood/relationships, returns `ilAdditionalContext`.
5. `server.ts:296-305` — assembles `fullContext` (secretDirectives + trustDirective + approachCtx +
   ilAdditionalContext) and `effectiveMessage` (player text +shop inventory if trade).
6. `server.ts:308` — `await agent.chatStream(effectiveMessage, onToken, fullContext)` → **`fullReply`**.
7. `agent.ts:103` — `chatStream` recalls memories, `buildSystemPrompt`, pushes msg to `_chatHistory`.
8. `agent.ts:120` — `generateStream('dialogue', {...})`; returned at `agent.ts:139`.
9. `llm-client.ts:200` — `generateStream` façade: semaphore (INV-01), accumulates `full`, returns `full || '...'`.
10. provider `stream` yields token chunks only (no reply logging).
11. `server.ts:312` — `chat:done {agentId, fullReply}` to client.

## Reply text & speaker/listener
- **replyTextLocation**: `server.ts:308`, var `fullReply` (in scope through ~:353).
- **speaker** = `agent` (id `msg.agentId`, name `agent.profile.name`, loc `agent.state.location`).
- **listener** = `world.playerAgent` (local `playerAgent`, id usually `'player'`).
- Player input = `msg.message` (prompt actually sent = `effectiveMessage`).
- Also in scope: `meaning.speechAct`, `meaning.extractionConfidence`, `npcTrust` (computed ~:252),
  `chatSession.messageCount`, `world.gameMinute`, `agent.state.currentDay`.

## Suggested log site
Insert one line **after `server.ts:312`** (inside the `chat` block):
```
  [Chat] <player> → <npc> @<loc> dD mM [act:<speechAct> trust:<t>] reply: <fullReply flattened>
```
Matches the existing two-space `[Tag]` convention (e.g. :188/:212/:304/:337).
