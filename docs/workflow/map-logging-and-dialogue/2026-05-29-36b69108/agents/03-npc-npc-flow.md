# Agent 03 — NPC↔NPC dialogue flow

- **entryPoint**: `world.ts:1019` — `_handleTask` → `_handleConversation()` (casual). Goal-driven path:
  `world.ts:1016` → `_handleGoalStep(npcId)`. Both run in the tick/ProcessingQueue, not the player endpoint.
- **currentlyLogged**: **true** (but weak — speaker-only, often `'...'`).

## Chain
1. `index.ts:566` — `new World(...)` wired with `onLine` callback (`index.ts:591`).
2. `world.ts:1019` — `_handleConversation()` (scheduler `findPair` picks initiator+responder).
3. `world.ts:1294` — `onLlmCall('Conversation', 'A ↔ B [topic]')` (signal only, not reply).
4. `world.ts:1295` — `runConversation(initiator, responder, …, {onLine})`.
5. `conversation.ts:116` — `initiator.generateResponse(...)` → `agent.ts:207` `classify('npc-dialogue', {schema})`.
6. routed via `llm-defaults.ts` to **lm-studio/qwen**.
7. `conversation.ts:121` — `parseDialogue(initiatorRaw)` → `initiatorLine`.
8. `conversation.ts:136/141` — responder → `responderLine`.
9. `conversation.ts:132,156` — `options.onLine(iLine|rLine)` → `index.ts:592` sink:
   `console.log('    {speakerName}: "{text}"')` + WS `conversation:line`.
- **ALT goal-driven**: `world.ts:1186` `createInteractionRunner({onLine})` → `goals.ts:511/589`
  `runInteraction` → `interaction.ts:87/100` `onLine(...)` → same sink.

## Reply text & ids
- **replyTextLocation**: `conversation.ts:121` (`initiatorLine`) + `:141` (`responderLine`); goal-driven
  `interaction.ts:84` (`ownerLine`) + `:97` (`targetLine`). At sink: `line.text`.
- Inside `runConversation` both ids are in scope (initiator/responder `.profile.id/.name`); listener = the other
  agent. **The sink's `ConversationLine` has NO listener id** (`world-types.ts:56-60`) → can't name listener
  without a type change. No player text — topic/goal-purpose drove the turn.

## Why "nothing shows"
1. Casual pairs rarely fire — `findPair` (`world.ts:1281`) returns null without a co-located eligible pair / cooldown.
2. Qwen returns empty → `parseDialogue` yields `''` → turn skipped at `:122-124/:142-144` (emits `[Conv:SKIP]`).
3. `line.text` often degrades to `'...'` (`conversation.ts:64`).

## Suggested log site
- **`conversation.ts:156`** (after `onLine(rLine)`): one rich line per exchange — both ids+names, location, topic,
  both texts. Single point where everything is in scope.
- Mirror at **`interaction.ts:104`** for goal-driven (purpose + both lines). Keep inside engine, `Agent` fields
  only (INV-14).
