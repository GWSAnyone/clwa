# SPEC: Journal V2 — Suspect Tracking & Case Summary

> Milestone 2, фундамент. Журнал из плоского списка → инструмент детектива.
> Статус: **спека**

---

## Цель

Журнал игрока получает structured поля для evidence backing, suspect tracking и case summary. Это фундамент для Evidence Presentation и Player Accusation.

## Почему это нужно

Текущий журнал — плоский список записей (clue/testimony/observation) с text + relatedNpcs. Для детективного тулкита нужно:
1. Structured evidence data на каждой записи (для evidence presentation NPC)
2. Отслеживание подозреваемых (группировка улик по suspect)
3. Case summary (автоматическая оценка силы доказательной базы перед обвинением)

---

## Дизайн

### Structured Fields на JournalEntry

При создании journal entry из crime scene examination — structured data уже доступна (Evidence Layer). Сохраняем её:

```typescript
interface JournalEntry {
  // Existing fields (unchanged)
  id: string;
  type: 'clue' | 'testimony' | 'observation';
  text: string;
  source: string;
  relatedNpcs: string[];
  locationId?: string;
  gameDay: number;
  tick: number;
  crimeSceneId?: string;

  // NEW: structured evidence data
  evidenceCategory?: 'opportunity' | 'motive' | 'physical' | 'alibi' | 'witness';
  evidenceWeight?: number;       // 0.1-0.3, from Evidence Layer
  suspectId?: string;            // Who this evidence points to (NPC ID)
  victimId?: string;             // Victim (NPC ID)
  eventType?: string;            // Related event type from registry (NPC_KILLED, GOODS_STOLEN)
  presentedTo: string[];         // NPC IDs who've been shown this evidence (dedup)
}
```

**Заполнение:** При `POST /api/examine/:locationId/:pointId` — examine endpoint уже получает Evidence objects из EL. Передаём structured data в journal entry.

**presentedTo:** Инициализируется как `[]`. Заполняется при Evidence Presentation (см. SPEC-evidence-presentation). Предотвращает повторное предъявление одной улики одному NPC.

### Suspect Tracking

```typescript
// В PlayerJournal
suspects: Set<string>;  // NPC IDs, marked by player

markSuspect(npcId: string): void;     // toggle
isSuspect(npcId: string): boolean;
getSuspects(): string[];
```

**Gameplay:** Marking suspect — действие игрока, не создаёт beliefs/effects. Это UI/организационный инструмент. NPCs не знают что их отметили.

### Case Summary

```typescript
interface CaseSummary {
  suspectId: string;
  suspectName: string;
  entries: JournalEntry[];           // all entries related to suspect
  evidence: {
    physical: number;                // count
    opportunity: number;
    motive: number;
    testimony: number;
    observation: number;
  };
  totalScore: number;                // 0-1, computed from evidence weights
  quality: 'strong' | 'moderate' | 'weak' | 'insufficient';
  summary: string;                   // human-readable description
}
```

**Score computation:**

```
totalScore = Σ(entry.evidenceWeight ?? defaultWeight[entry.type])

defaultWeight:
  clue without evidenceWeight: 0.10
  testimony: 0.12
  observation: 0.08

Quality thresholds:
  strong:       totalScore >= 0.7
  moderate:     totalScore >= 0.4
  weak:         totalScore >= 0.2
  insufficient: totalScore < 0.2
```

**Использование:** Case summary вызывается при accusation (SPEC-player-accusation) и доступен игроку через API/UI для оценки силы дела перед обвинением.

---

## API

| Endpoint | Method | Описание |
|----------|--------|----------|
| `GET /api/journal` | GET | Existing. Добавить `?groupBy=suspect` |
| `GET /api/journal/case/:npcId` | GET | Case summary для подозреваемого |
| `POST /api/journal/suspect/:npcId` | POST | Toggle suspect status |
| `GET /api/journal/suspects` | GET | Список отмеченных подозреваемых |

### GET /api/journal?groupBy=suspect

```json
{
  "suspects": {
    "mark": { "name": "Mark", "isSuspect": true, "entries": [...], "evidenceCount": 4 },
    "elara": { "name": "Elara", "isSuspect": false, "entries": [...], "evidenceCount": 1 }
  },
  "unrelated": [...]
}
```

### GET /api/journal/case/:npcId

```json
{
  "suspectId": "mark",
  "suspectName": "Mark",
  "entries": [...],
  "evidence": { "physical": 2, "opportunity": 1, "motive": 1, "testimony": 0, "observation": 0 },
  "totalScore": 0.65,
  "quality": "moderate",
  "summary": "2 physical clues, 1 opportunity, 1 motive indicator"
}
```

---

## Файлы

| Файл | Изменения |
|------|-----------|
| `packages/engine/src/journal.ts` | Новые поля JournalEntry, suspects Set, getCaseSummary(), getEntriesForSuspect(), markSuspect() |
| `packages/server/src/routes.ts` | Новые endpoints: journal/case, journal/suspect. Обновить examine endpoint — передавать structured evidence data |
| `packages/server/public/game.js` | Journal panel: suspect grouping, case summary badge, suspect toggle |

---

## Persistence

- `suspects` сериализуется как `string[]` в toJSON, восстанавливается как `Set` в fromJSON
- `presentedTo` на каждом entry — сериализуется как `string[]`
- Обратная совместимость: старые save без suspects/presentedTo → пустые defaults

---

## Тест

1. Examine crime scene → journal entry получает structured fields (evidenceCategory, evidenceWeight, suspectId)
2. POST /api/journal/suspect/mark → Mark отмечен как подозреваемый
3. GET /api/journal?groupBy=suspect → entries сгруппированы по suspect
4. GET /api/journal/case/mark → case summary с correct evidence counts и quality
5. Persistence: save → load → suspects и structured fields сохранены
