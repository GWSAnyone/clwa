# SPEC: Conversation Session — Per-Chat State for Multi-Turn Detective Interaction

> Решает deferred задачи из SPEC-player-accusation (repetition tracking, multiple suspects).
> Необходим для M3 multi-turn interrogations.
> Статус: **implemented** (v0.11.0-dev)

---

## Проблема

Каждое сообщение игрока в чате обрабатывается IL **независимо**. Между сообщениями не сохраняется structured context:

1. **Спам обвинениями** (deferred из SPEC-player-accusation): если игрок 5 раз говорит "Mark убийца" — каждый раз одинаковый trust penalty. Нет эскалации, нет journal freshness check. Нужен per-session accusation tracker.

2. **Множественные подозреваемые** (deferred из SPEC-player-accusation): если игрок обвинил Mark, потом Ted — NPC не знает о предыдущем обвинении. Нужен per-session formal accusation log.

3. **M3 multi-turn interrogation**: игрок задаёт серию вопросов, каждый следующий основан на предыдущем ответе. IL не знает что это цепочка вопросов, не может injection'ить "this is a follow-up question".

### Что УЖЕ работает без session state

| Аспект | Как | Почему OK |
|--------|-----|-----------|
| **LLM chat history** | agent.chatStream сохраняет message history | NPC помнит ВСЕ слова — и свои, и игрока |
| **Evidence beliefs** | processEvidencePresentation → npc.state.beliefs | Beliefs persist, accusation evaluation читает их |
| **Trust/mood changes** | adjustTrust/adjustSentiment → agent.state | Persist на agent, видны в следующем сообщении |
| **Accusation evidence score** | buildAccusationContext → reads beliefs | Evidence из msg 1 видна в accusation из msg 3 |

**Вывод:** mechanical effects корректны без session state. LLM dialogue адекватен (chat history). Session state нужен для **structured tracking** (repetition, escalation), не для correctness.

---

## Дизайн

### ConversationSession — transient per-chat object

```typescript
interface ConversationSession {
  npcId: string;
  startedAt: number;              // gameMinute
  messageCount: number;

  // Accusation repetition tracking (SPEC-player-accusation §Repetition Handling)
  accusationHistory: Map<string, {    // key = suspectId
    count: number;
    lastJournalHash: number;          // journal entry count for suspect at time of accusation
  }>;

  // Multiple suspect tracking (SPEC-player-accusation §Multiple Suspects)
  formalAccusations: Array<{
    suspectId: string;
    suspectName: string;
    tick: number;
  }>;
}
```

### Lifecycle (as implemented)

```
Player clicks NPC → WS 'chat' message → server checks:
  sessions.has(npcId)? → reuse existing session
                       → create new ConversationSession

Each WS 'chat' message:
  session.messageCount++
  IL + effects processing with session context

Player closes chat (Escape / click away):
  agent.state.inPlayerChat = false (existing finally block)
  session.messageCount = 0 (reset counter, keep accusation history)

New game (POST /api/new-game):
  clearChatSessions() → all sessions destroyed

WS disconnect:
  chatSessions.clear() → all sessions destroyed
```

**Persistent within game run.** Sessions survive chat close — accusationHistory and formalAccusations persist so NPCs remember prior accusations across conversations. Destroyed on new-game or WS disconnect. Not saved to disk (roguelike, OK).

### Storage: server-level Map

```typescript
// В server.ts или game-context.ts
const chatSessions = new Map<string, ConversationSession>();
```

**Не на GameContext** (пересоздаётся при new game). Просто module-level variable в server.ts.

### Integration с IL

**Extend ILEffectContext:**

```typescript
interface ILEffectContext {
  // ...existing fields...
  chatSession?: ConversationSession;
}
```

**В applyDialogueMeaning, секция 1b (accusation evaluation):**

```typescript
if (meaning.speechAct === 'accuse' && ctx.chatSession) {
  const session = ctx.chatSession;
  const suspectId = suspectAgent.profile.id;

  // --- Repetition check ---
  const history = session.accusationHistory.get(suspectId);
  const currentJournalHash = ctx.playerJournal?.getEntriesForSuspect(suspectId).length ?? 0;

  if (history) {
    const isNewEvidence = currentJournalHash !== history.lastJournalHash;
    if (isNewEvidence) {
      // Fresh accusation — new evidence found, reset count
      history.count = 1;
      history.lastJournalHash = currentJournalHash;
    } else {
      // Same evidence, repeated accusation
      history.count++;
      // Prompt injection for repetition
      if (history.count === 2) {
        sections.push(`The player has already accused ${suspectName} of this. They haven't presented new evidence.`);
      } else {
        sections.push(`The player keeps repeating the same accusation against ${suspectName} without new evidence. This is becoming tiresome and undermining their credibility.`);
      }
      // Escalating trust penalty
      const penalty = history.count === 2 ? -0.10 : -0.12;
      npc.state.relationships?.adjustTrust(playerId, penalty);
      ctx.effects.push({ type: 'relationship_change', field: 'trust', delta: penalty });
    }
  } else {
    session.accusationHistory.set(suspectId, { count: 1, lastJournalHash: currentJournalHash });
  }

  // --- Multiple suspect tracking ---
  const prevAccusations = session.formalAccusations.filter(a => a.suspectId !== suspectId);
  if (prevAccusations.length > 0) {
    const prevNames = prevAccusations.map(a => a.suspectName).join(', ');
    if (prevAccusations.length === 1) {
      sections.push(`Note: this player previously formally accused ${prevNames}. Now they're accusing ${suspectName}. Their investigative judgment may be questionable.`);
    } else {
      sections.push(`This player has now accused ${prevAccusations.length + 1} different people (${prevNames}, now ${suspectName}). They seem to be guessing rather than investigating.`);
    }
    // Progressive credibility damage
    npc.state.relationships?.adjustTrust(playerId, -0.05);
    ctx.effects.push({ type: 'relationship_change', field: 'trust', delta: -0.05 });
  }
  session.formalAccusations.push({ suspectId, suspectName, tick: ctx.gameDay });
}
```

---

## Server Integration

### Chat handler changes (server.ts)

```typescript
// Module-level
const chatSessions = new Map<string, ConversationSession>();

// In WS chat handler, after agent validation:
if (!chatSessions.has(msg.agentId)) {
  chatSessions.set(msg.agentId, {
    npcId: msg.agentId,
    startedAt: world.gameMinute,
    messageCount: 0,
    accusationHistory: new Map(),
    formalAccusations: [],
  });
}
const session = chatSessions.get(msg.agentId)!;
session.messageCount++;

// Pass to effectCtx:
const effectCtx: ILEffectContext = {
  // ...existing fields...
  chatSession: session,
};

// In finally block (where inPlayerChat is cleared):
if (chatAgentId) {
  chatSessions.delete(chatAgentId);
}
```

**Wait** — the finally block clears inPlayerChat on EVERY message, not just on chat close. Let me re-read...

Actually, looking at the server code: the finally block runs after each message processing. `inPlayerChat` is set to true at start, cleared in finally. So it's per-message, not per-session!

The NPC is frozen during ONE message processing. Between messages, NPC is unfrozen. This means there's no persistent "chat is open" state on the server.

**How to detect session boundary (chat open vs chat close):**
- Session CREATE: first 'chat' message to this NPC → create if not exists
- Session DESTROY: how? Server doesn't know when player closes the chat UI

**Options:**
1. **Timeout**: if no message to NPC for 60 seconds → destroy session
2. **Explicit close message**: client sends WS `{ type: 'chat_close', agentId }` when player presses Escape
3. **Per-message session**: session lives for the duration of one `inPlayerChat=true` cycle (too short)

**Best: option 2** — explicit close message. Client already knows when chat closes (Escape key / click away). Adding one WS message is trivial.

### Client-side (game.js)

```javascript
// When player closes chat (Escape or click away):
ws.send(JSON.stringify({ type: 'chat_close', agentId: currentChatNpc }));
```

### Server-side

```typescript
// New WS message type
if (msg.type === 'chat_close') {
  chatSessions.delete(msg.agentId);
}
```

Update WSClientMessage:
```typescript
export type WSClientMessage =
  | { type: 'chat'; agentId: string; message: string; evidenceIds?: string[] }
  | { type: 'chat_close'; agentId: string }
  | { type: 'player_move'; x: number; y: number };
```

---

## Файлы

| Файл | Изменения |
|------|-----------|
| `packages/engine/src/il.ts` | ConversationSession interface, ILEffectContext.chatSession field, repetition + multiple suspect logic in accusation section |
| `packages/server/src/server.ts` | chatSessions Map, create/reuse on 'chat', reset messageCount on 'chat_close', clearChatSessions() export, pass to effectCtx |
| `packages/server/src/index.ts` | clearChatSessions() call in newGame handler |
| `packages/server/src/ws.ts` | WSClientMessage: 'chat_close' type |
| `packages/server/public/game.js` | Send 'chat_close' WS message on Escape/close |

---

## Edge Cases (as implemented)

| Ситуация | Поведение |
|----------|----------|
| Player opens chat, sends nothing, closes | No session created (created on first 'chat' message) |
| Player opens chat with A, then opens with B | Session A persists (messageCount reset), session B created |
| Server restart mid-chat | Sessions lost. Next message creates fresh session. OK for roguelike |
| Player accuses Mark to Garrett, closes chat, reopens | **Same session reused.** Garrett remembers prior accusations — repetition penalty applies if no new evidence |
| Player accuses Mark to Garrett, then Mark to Theron | Different NPCs, different sessions. No cross-NPC tracking (by design) |
| New game started | All sessions cleared via clearChatSessions(). Clean slate |
| WS client disconnects | All sessions cleared (single-player assumption) |

---

## Принципы

| Принцип | Соблюдение |
|---------|-----------|
| Bilateral | NPC-NPC conversations don't have sessions (single exchange). Player sessions are asymmetric but justified — player has multi-turn conversations, NPCs don't |
| Engine purity | ConversationSession lives in engine (il.ts types). Session management in server. No module-specific content |
| Structured data | accusationHistory uses journal entry counts (hash), not text comparison. Dedup via Set for unique suspects |
| No artificial markers | Repetition detection is organic — NPC naturally responds "you already said this", not a UI error message |
| Game-run scoped | Sessions persist within a game run (survive chat close). Cleared on new-game and WS disconnect. Not saved to disk |

---

## Тест

1. Player accuses Mark to Garrett (insufficient) → trust -0.08
2. Player accuses Mark AGAIN in same chat, no new evidence → escalated prompt "already accused", trust -0.10
3. Player finds new clue, accuses Mark again → journal hash changed → fresh accusation, no escalation
4. Player accuses Mark, then Ted in same chat → prompt notes "previously accused Mark", additional trust -0.05
5. Player closes chat, reopens, accuses Mark again without new evidence → **repetition detected** (session persists across chat close)
6. Player accuses Mark to Garrett, opens chat with Theron, accuses Mark → separate session, no cross-NPC tracking
7. New game → accuse Mark → no repetition penalty (sessions cleared on new-game)
