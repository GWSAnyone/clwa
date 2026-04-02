# SPEC: Player Accusation — Formal Accusation via Dialogue

> Milestone 2, задача 1. Игрок обвиняет NPC через диалог → оценка доказательств → NPC реагирует.
> Зависимости: SPEC-journal-v2, SPEC-evidence-presentation
> Статус: **спека**

---

## Цель

При speechAct `accuse` в IL — система автоматически агрегирует доказательную базу (journal + NPC beliefs + trust) → вычисляет evidence quality → инжектирует structured context в NPC prompt → NPC принимает обоснованное решение (арест, расследование, отказ). Неправильное обвинение имеет последствия.

## Почему это нужно

Сейчас `accuse` speechAct обрабатывается как обычный claim — создаёт testimony belief. Нет оценки доказательств, нет informed NPC response, нет consequences. Игрок может 100 раз повторить "Mark убил" и Garrett не сдвинется с мёртвой точки, ИЛИ арестует на основе одного claim с high trust.

**GDD:** "Must build a convincing case." Evidence quality matters. NPC evaluates based on trust, evidence, own beliefs, personality.

---

## Дизайн

### Trigger

speechAct `accuse` в DialogueMeaning, с claims содержащими subject (подозреваемый).

**Не триггерится при:**
- speechAct != 'accuse' (inform, question и т.д. — обычная обработка)
- Нет claims с subject (кого обвинять?)
- NPC не authority (не investigator и не canSentence) — обвинение обрабатывается как обычный claim, без формальной оценки

**Authority NPCs:** Garrett (investigator), Theron (canSentence). Только они получают полную accusation evaluation. Обвинение Ted'у = обычный claim (может gossip или testify дальше).

### Accusation Evaluation Flow

```
1. IL extracts: speechAct='accuse', claims=[{subject:'Mark', eventType:'NPC_KILLED', ...}]

2. Normal claim processing (existing):
   → Creates testimony belief in NPC (trust-scaled, as before)

3. NEW — Accusation evaluation (only for authority NPCs):
   a) Resolve suspect: claims[0].subject → suspectId
   b) Aggregate evidence:
      - Player journal: getCaseSummary(suspectId)
      - NPC's own beliefs: getMaxConfidenceFor(suspectName)
      - Evidence presented earlier in this session
      - Player trust
   c) Compute combined evidence quality
   d) Build accusation context for NPC prompt

4. NPC responds with accusation context injected:
   - Knows evidence quality (STRUCTURED, not LLM-evaluated)
   - Personality affects TONE, not outcome
   - If evidence sufficient → creates arrest/investigate goal
   - If insufficient → explains why

5. Mechanical effects based on evidence quality:
   - strong → goal_created (arrest if investigator, evaluate if canSentence)
   - moderate → goal_created (investigate — gather more evidence)
   - weak → no goal, small trust drop, NPC explains
   - insufficient → no goal, trust drop, warning about false accusations
```

### Combined Evidence Quality

```typescript
interface AccusationEvidence {
  suspectId: string;
  suspectName: string;

  // From player's journal (via getCaseSummary)
  journalScore: number;              // 0-1, from SPEC-journal-v2
  journalQuality: string;            // strong/moderate/weak/insufficient

  // From NPC's own beliefs
  npcMaxConfidence: number;          // 0-1, highest belief about suspect
  npcHasIndependentEvidence: boolean; // NPC found evidence without player

  // Player credibility
  playerTrust: number;               // 0-1

  // Combined assessment
  combinedScore: number;             // weighted sum
  combinedQuality: 'strong' | 'moderate' | 'weak' | 'insufficient';
}
```

**Combined score computation:**

```
combinedScore = journalScore × 0.5        // player's gathered evidence
              + npcMaxConfidence × 0.35    // NPC's own investigation
              + trustBonus × 0.15          // player credibility

trustBonus:
  trust >= 0.7: 1.0
  trust >= 0.4: 0.6
  trust < 0.4:  0.2

Thresholds (same as journal):
  strong:       >= 0.7
  moderate:     >= 0.4
  weak:         >= 0.2
  insufficient: < 0.2
```

**Пример:**
- Player journal score: 0.65 (moderate — 2 physical clues + 1 motive)
- NPC confidence: 0.5 (examine_scene deduction)
- Trust: 0.6 (trustBonus = 0.6)

```
combined = 0.65 × 0.5 + 0.5 × 0.35 + 0.6 × 0.15
         = 0.325 + 0.175 + 0.09
         = 0.59 → moderate
```

Garrett investigates further (not arrest yet).

### NPC Prompt Injection

```
[FORMAL ACCUSATION]
The player formally accuses {suspectName} of {crimeLabel}.

Evidence assessment:
- Player's documented evidence: {journalQuality} ({physical} physical, {opportunity} circumstantial, {motive} motive indicators)
- Your own findings: {npcConfidenceDesc} ({npcMaxConfidence})
- Player's trustworthiness: {trustDesc}
- Combined evidence quality: {combinedQuality}

{personalityGuidance}
```

**personalityGuidance** — зависит от NPC traits:
- High C (Garrett): "As a disciplined investigator, you need solid evidence before acting."
- High H (Theron): "Your commitment to justice demands thorough evaluation."
- Low H (corrupt Garrett variant): "You could be persuaded by other means..."

**combinedQuality → action guidance:**
```
strong:       "This evidence warrants immediate arrest."
moderate:     "Worth investigating further. Tell the player what additional evidence would help."
weak:         "Not enough to act. Explain what's missing."
insufficient: "This accusation has no basis. Warn the player about wasting your time."
```

### Mechanical Effects

**After NPC chat response:**

| Quality | Authority NPC Action | Player Effect |
|---------|---------------------|---------------|
| strong | Create arrest goal (investigator) or "proceed to trial" prompt (canSentence) | trust +0.05 (NPC appreciates solid case) |
| moderate | Create investigate goal (gather more evidence) | neutral |
| weak | No goal | trust -0.03 |
| insufficient | No goal | trust -0.08, ILEffect: goal_rejected |

**Goal creation:** Uses existing `createGoalFromRequest()` with affordanceId='arrest' or 'investigate'. Priority = 8 (high, player-driven).

### Wrong Accusation Consequences

**Trigger 1: Accusation rejected (insufficient evidence)**
- trust -0.08 (accusation without evidence = wasting time)
- Track: `accusationHistory` per NPC (see Repetition Handling below)

**Trigger 2: NPC_SENTENCED → release verdict (accused found innocent)**
Already exists: trust -0.15 to player (in event-handlers.ts).

**NEW — Trigger 3: Accused NPC becomes hostile**
When player accuses NPC (speechAct='accuse' directed at suspect):
- If accused is the NPC being talked to (player confronts suspect directly):
  - accused.adjustSentiment(playerId, -0.3)
  - accused.adjustTrust(playerId, -0.3)
- If accused is third party AND gets arrested:
  - On NPC_ARRESTED: accused.adjustSentiment(playerId, -0.5)
- If accused is third party AND released (innocent):
  - On release: accused.adjustSentiment(playerId, -0.4)
  - Friends of accused: for each NPC with sentiment > 0.2 toward accused:
    - npc.adjustTrust(playerId, -0.1)
    - npc.adjustSentiment(playerId, -0.08)

**Implementation location:** crime-justice/event-handlers.ts (NPC_ARRESTED, NPC_SENTENCED handlers). Extend existing trust evolution logic.

### Repetition Handling (Accusation Spam)

Нет жёсткого cooldown (нарушает "Words are weapons" — в реальной жизни можно повторить, просто перестанут слушать). Вместо этого: prompt-aware repetition detection + escalating trust penalty + journal freshness check.

**Data model (per authority NPC, transient — not persisted):**

```typescript
// На ILEffectContext или server-level tracking
accusationHistory: Map<string, {    // key = suspectId
  count: number;                    // how many times player accused this suspect to THIS NPC
  lastTick: number;                 // game minute of last accusation
  lastJournalHash: number;          // hash of journal entry count for suspect at time of accusation
}>
```

**Flow при повторном accuse того же suspect к тому же authority NPC:**

1. **Journal freshness check:** Вычислить текущий `journalHash` = count journal entries related to suspect. Если изменился с последнего обвинения → новые данные → fresh accusation, reset count.

2. **Если данные те же (hash совпадает):**
   - 2-й раз: prompt injection: `"The player has already accused {suspect} of this. They haven't presented new evidence."`
   - 3-й+ раз: `"The player keeps repeating the same accusation against {suspect} without new evidence. This is becoming tiresome and undermining their credibility."`

3. **Escalating trust penalty (no new evidence):**
   - 1-й раз: -0.08 (base, from evidence quality)
   - 2-й раз: -0.10
   - 3-й+: -0.12

**NPC responds naturally** to prompt injection: "Ты уже это говорил. Принеси доказательства." Player receives clear feedback через диалог, не UI-сообщение.

**Edge cases:**
- Accuse Mark to Garrett, then Mark to Theron → separate NPC, both hear it for the first time. No penalty.
- Accuse Mark, find 1 new clue, accuse again → journalHash changed → fresh accusation. Correct: even one new clue warrants re-evaluation.

### Multiple Suspects (Progressive Credibility Damage)

Смена теории — нормальный gameplay. Casual suspicion (speechAct='inform') ≠ formal accusation (speechAct='accuse'). Только формальные обвинения имеют вес и последствия.

**Data model (per authority NPC, transient):**

```typescript
formalAccusations: Array<{
  suspectId: string;
  tick: number;
}>
```

**При speechAct='accuse' к authority NPC — check previous formal accusations:**

| Ситуация | Prompt injection | Trust penalty |
|----------|-----------------|---------------|
| First suspect | Normal processing | (from evidence quality) |
| Second DIFFERENT suspect | `"Note: this player previously formally accused {prevSuspect}. Now they're accusing {newSuspect}. Their investigative judgment may be questionable."` | additional -0.05 |
| Third+ different suspect | `"This player has now accused {count} different people. They seem to be guessing rather than investigating."` | additional -0.05 per switch |

**Почему progressive, не blocking:**
- Blocking ("нельзя обвинить больше одного") = artificial marker
- Progressive damage через trust + prompt = organic consequence
- Если evidence на нового suspect действительно strong → evidence quality перевесит skepticism

**Edge cases:**
- Accused Mark (wrong), Mark released, now accuse Ted (right): Trust already dropped from wrong accusation (-0.15 on release). Plus skepticism penalty (-0.05). But if evidence strong → combined score still sufficient. Correct solution HARDER but possible. Good gameplay.
- Accused all 8 NPCs: By #8 trust ≈ -0.5 with all authority NPCs. Nobody listens. Organic game over for this approach.

### Theron → Garrett Authority Chain

**M2 (current):** Variant A — text hint. Theron responds: "Have Garrett arrest him first, then bring the case to me." Player must go to Garrett directly.

**Sufficient for M2 test:** "Player can convict by building a case." Player can and should go to Garrett first (investigator). Theron is judge (canSentence), not arresting officer.

**M3 (deferred):** Variant C — ARREST_ORDERED event. Theron emits event → CG rule → reactive arrest goal for Garrett. Enables: corrupt Garrett can IGNORE judge's order (low H → sabotage), creating conflict. Requires Garrett variability (M3 feature).

### Accusation to Non-Authority NPCs

When player accuses to non-authority NPC (Ted, Bess, etc.):
- Normal claim processing (testimony belief created)
- NO accusation evaluation (no evidence aggregation, no goal creation)
- NPC responds naturally from their personality + beliefs about suspect
- NPC may later gossip/testify to Garrett (existing TopicEngine + affordances)

This is realistic: telling Ted "Mark killed Bess" is gossip, not formal accusation.

---

## Data Model

### AccusationContext (transient, not persisted)

```typescript
interface AccusationContext {
  suspectId: string;
  suspectName: string;
  crimeType: string;              // from claim eventType → getEventLabel
  journalEvidence: CaseSummary;   // from PlayerJournal.getCaseSummary()
  npcMaxConfidence: number;
  npcHasOwnEvidence: boolean;
  playerTrust: number;
  combinedScore: number;
  combinedQuality: 'strong' | 'moderate' | 'weak' | 'insufficient';
  personalityGuidance: string;    // based on NPC traits
  actionGuidance: string;         // what to do based on quality
}
```

### AccusationTracker (per authority NPC, transient)

```typescript
interface AccusationTracker {
  // Per-suspect repetition tracking
  history: Map<string, {
    count: number;
    lastTick: number;
    lastJournalHash: number;
  }>;
  // Cross-suspect tracking
  formalAccusations: Array<{ suspectId: string; tick: number }>;
}
```

**Lifecycle:** Created per authority NPC on first accusation. Stored on server-level Map (not persisted — resets on restart, which is fine for roguelike).

### New function: buildAccusationContext()

```typescript
function buildAccusationContext(
  suspectId: string,
  claimEventType: string,
  npc: Agent,
  playerJournal: PlayerJournal,
  playerTrust: number,
  agents: Map<string, Agent>,
  tracker?: AccusationTracker,
): AccusationContext
```

**Location:** `packages/engine/src/il.ts` (или отдельный `accusation.ts` если слишком большой).

---

## Файлы

| Файл | Изменения |
|------|-----------|
| `packages/engine/src/il.ts` | В `applyDialogueMeaning`: при speechAct='accuse' + authority NPC → buildAccusationContext() → inject into prompt → create goal if quality sufficient |
| `packages/engine/src/journal.ts` | getCaseSummary() — already in SPEC-journal-v2 |
| `packages/modules/src/crime-justice/event-handlers.ts` | Wrong accusation consequences: hostile accused, friends trust drop |
| `packages/server/src/server.ts` | Pass playerJournal to ILEffectContext |
| `packages/server/public/game.js` | ILEffect rendering for accusation (goal_created/rejected badges) |

---

## Принципы

| Принцип | Соблюдение |
|---------|-----------|
| Words are weapons | Обвинение через диалог, не через кнопку/форму |
| Bilateral | NPC обвиняет через confront/demand_justice affordances. Player через speech+IL. Оба через речь. |
| PM = instinct, LLM = consciousness | Evidence quality = deterministic (engine). NPC tone/dialogue = LLM (consciousness). Engine не позволяет LLM решать виновность. |
| Structured data | AccusationContext = structured. evidenceQuality = computed, не LLM-evaluated. |
| Trust is currency | Trust модулирует combined score. Low trust = даже с evidence трудно убедить. |
| No artificial markers | Нет UI "обвинить". Просто скажи. |

---

## Тест

### Основной flow
1. Crime happens → player examines crime scene → journal entries
2. Player presents evidence to Garrett → evidence beliefs created
3. Player: "I accuse Mark of murdering Bess" → speechAct='accuse'
4. Accusation evaluation: journal moderate + NPC beliefs moderate → combined moderate
5. Garrett responds: "I'll look into it further" → investigate goal created
6. After investigation → evidence strong → player accuses again → arrest

### Wrong accusation
1. Player accuses Ted (innocent) with insufficient evidence
2. Garrett: "I need more proof" → no goal, trust -0.08
3. Player presents evidence → moderate → Garrett investigates → finds nothing
4. If Ted arrested and released → trust -0.15, Ted hostile to player, Ted's friends trust drop

### Repetition handling
1. Player accuses Mark to Garrett (insufficient) → trust -0.08
2. Player accuses Mark AGAIN, no new evidence → prompt says "already accused", trust -0.10
3. Player finds new clue → journal hash changes → accuses Mark again → fresh accusation (no penalty escalation)

### Multiple suspects
1. Player accuses Mark to Garrett → normal processing
2. Player accuses Ted to Garrett → prompt notes "previously accused Mark", additional trust -0.05
3. If evidence for Ted is strong → arrest still possible despite skepticism

### Theron redirect
1. Player accuses Mark to Theron → Theron says "Have Garrett arrest him first"
2. No arrest goal from Theron (M2 behavior)

### Personality variation
1. Principled Garrett (high C, high H): requires strong evidence
2. Corrupt Garrett (low H): might accept bribe instead of evidence (M3 feature, prompt-only in M2)
3. Theron (canSentence): "Have Garrett arrest him first, then I'll evaluate"
