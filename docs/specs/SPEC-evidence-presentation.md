# SPEC: Evidence Presentation — Show Evidence to NPC

> **Milestone**: M2 (Detective Toolkit)
> **Status**: Implemented (v0.12.0)
> **Depends on**: SPEC-journal-v2 (done)
> **Engine changes**: EvidenceLayer, structured JournalEntry fields, IL evidence handling.
> **Created**: 2026-04-03
> **Completed**: 2026-04-03
> Milestone 2, задача 3. Игрок показывает собранные улики NPC → backed beliefs.

---

## Цель

Игрок может показать NPC физические улики из журнала. Улики создают beliefs с source `evidence` и confidence НЕ зависящей от trust (физические факты объективны). Это ключевой инструмент для построения дела перед обвинением.

## Почему это нужно

Сейчас единственный способ передать информацию NPC — claims через IL (source: testimony, confidence × trust). Если trust = 0.3, даже реальные улики создают belief с confidence 0.27. Физическое доказательство (окровавленный нож, следы на месте) должно иметь confidence не зависящую от того, доверяет ли NPC игроку.

**Bilateral:** NPC передают evidence друг другу через beliefTransfer в interactions (source: evidence/deduction). Игрок получает аналогичный механизм.

---

## Дизайн

### Flow

```
1. Player has journal entries from crime scene examination
2. In chat: player clicks "Present evidence" → selects entries
3. Player types message: "Look at this — I found traces at the crime scene"
4. Client sends: POST /api/chat { message, evidenceIds: [entryId1, entryId2] }
5. Server validates: entries exist in journal, not already presented to this NPC
6. For each entry:
   a) Create belief in NPC (source: EVIDENCE, confidence: evidenceWeight, NOT trust-scaled)
   b) Mark entry.presentedTo.push(npcId)
7. Build evidence context string → inject into NPC prompt
8. IL extracts meaning from player text normally (claims, questions, etc.)
9. NPC responds with awareness of shown evidence
10. ILEffects broadcast: belief_created (source: evidence) for each
```

### Evidence → Belief Mapping

| Entry Category | Belief Source | Confidence | Trust-scaled? |
|---------------|-------------|------------|---------------|
| physical | `EVIDENCE` | entry.evidenceWeight (0.15-0.25) | **No** |
| opportunity | `EVIDENCE` | entry.evidenceWeight (0.15) | **No** |
| motive | `EVIDENCE` | entry.evidenceWeight (0.2) | **No** |
| testimony (journal) | `TESTIMONY` | 0.5 | **No** (documented, not hearsay) |
| observation | `TESTIMONY` | 0.4 × trust | **Yes** (player's own word) |

**Почему evidence не скалируется trust:** Если игрок показывает Garrett окровавленный нож — факт существования ножа не зависит от доверия. Trust скалирует СЛОВА (testimony). Evidence = факт.

**Почему journal testimony НЕ скалируется:** Это задокументированное показание другого NPC, записанное игроком. NPC может проверить его, поговорив с источником. Confidence 0.5 — fixed, отражает надёжность задокументированного показания.

### Belief Creation

```typescript
// Для каждого presented evidence entry:
npc.state.beliefs?.addBelief({
  eventType: entry.eventType,           // from structured journal field
  subject: entry.suspectId ? agents.get(entry.suspectId)?.profile.name : null,
  object: entry.victimId ? agents.get(entry.victimId)?.profile.name : null,
  location: entry.locationId,
  confidence: computeEvidenceConfidence(entry),  // NOT trust-scaled for physical
  source: BELIEF_SOURCE.EVIDENCE,       // 'evidence' — existing source
  sourceNpcId: playerId,
  gameDay: ctx.gameDay,
});
```

### Dedup

- `presentedTo[]` на JournalEntry трекает кому показано
- Повторная попытка → skip с сообщением: "You already showed this to {NPC}"
- Разным NPC можно показать одну и ту же улику (Garrett + Theron + Ted — разные реакции)

### Prompt Injection

```
[EVIDENCE PRESENTED]
The player shows you documented evidence:
- "Traces of merchant goods found near the body" (physical evidence, pointing to Mark)
- "Mark was seen at Market Square around the time of the murder" (opportunity)

This is tangible evidence from the crime scene investigation, not just hearsay.
Consider it alongside your own knowledge.
```

Инжектируется ПЕРЕД IL extraction, чтобы NPC знал о evidence при формировании ответа.

### ILEffects

Для каждого evidence-backed belief:
```typescript
effects.push({
  type: 'belief_created',
  eventType: entry.eventType,
  subject: suspectName,
  confidence: confidence,
  source: 'evidence',
});
```

Client показывает: `"📋 Evidence: Mark at crime scene (conf: 0.25, source: evidence)"`

---

## API

### POST /api/chat (extended)

Request body:
```json
{
  "npcId": "garrett",
  "message": "Look at this evidence I found",
  "evidenceIds": ["journal-entry-1", "journal-entry-2"]
}
```

Response: existing streaming response + ILEffects with evidence beliefs.

### Validation

1. Each evidenceId must exist in player's journal
2. Each entry must NOT have npcId in presentedTo
3. Entry must have structured fields (evidenceCategory, eventType) — text-only entries can't create evidence beliefs
4. Max 5 entries per presentation (prevent spam)

---

## UI (game.js)

### Chat Modal Changes

1. **"Present Evidence" button** — appears below input textarea when journal has clue entries
2. On click → **evidence selector overlay**:
   - List of journal entries with checkboxes
   - Grouped by suspect (if suspects marked)
   - Each entry shows: text, category badge, suspect name
   - Max 5 selection
3. Selected entries stored in `pendingEvidence[]`
4. Visual indicator in chat: "📋 2 pieces of evidence attached"
5. On send → evidenceIds included in POST
6. After send → clear pendingEvidence, update presentedTo locally

### Evidence Selector

```
┌─────────────────────────────────┐
│ Select Evidence to Present      │
├─────────────────────────────────┤
│ ☑ Traces of merchant goods      │
│   [physical] → points to Mark   │
│ ☑ Mark seen at Market Square    │
│   [opportunity] → points to Mark│
│ ☐ Elara was present             │
│   [opportunity] → points to Elara│
│                                 │
│         [Present (2)]  [Cancel] │
└─────────────────────────────────┘
```

---

## Файлы

| Файл | Изменения |
|------|-----------|
| `packages/engine/src/il.ts` | Новый `processEvidencePresentation()` — создаёт beliefs из journal entries |
| `packages/engine/src/journal.ts` | `markPresented(entryId, npcId)`, `canPresent(entryId, npcId)` |
| `packages/server/src/server.ts` | Chat handler: принимает evidenceIds, validates, передаёт в IL context |
| `packages/server/public/game.js` | Evidence selector UI, pending evidence state, chat integration |

---

## Принципы

| Принцип | Соблюдение |
|---------|-----------|
| Bilateral | NPC→NPC: beliefTransfer (source: evidence/deduction). Player→NPC: evidence presentation. Same belief source. |
| Structured data | Evidence → belief через structured fields, не text matching |
| Registry | eventType из registry, BELIEF_SOURCE.EVIDENCE — existing constant |
| No double standards | Physical evidence confidence одинакова для NPC examine_scene и player presentation |
| Words are weapons | Evidence attached to chat message, не отдельная UI-форма вне диалога |

---

## Тест

1. Examine crime scene → journal entry с structured fields
2. Open chat with Garrett → "Present evidence" button visible
3. Select 2 entries → send message → beliefs created in Garrett (source: evidence)
4. Beliefs NOT trust-scaled (physical evidence confidence = evidenceWeight)
5. Repeat presentation of same entry → rejected (already presented)
6. Present to different NPC (Ted) → works (different NPC)
7. ILEffects broadcast: belief_created with source=evidence
