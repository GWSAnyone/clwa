# Agent 2 — CLWA memory recall + composite scoring (M6 Phase 2): packages/engine/src/memory.ts (VectorMemory.recall, payloadToScore, baseScore, fallback chain) + packages/engine/src/decay.ts (compositeScore/decayedImportance/freshness) + recall call sites in agent.ts

## Map: memory recall + composite-scoring рассинхрон (M6 Phase 2)

**TL;DR:** Существуют ДВА composite-формулы, которые расходятся по терму decayedImportance. Экспортированная `compositeScore` в decay.ts делит importance на 10 (нормализация к 0..1), но `recall` в memory.ts её НЕ вызывает — он инлайнит собственную копию БЕЗ деления, из-за чего в runtime importance (1..10) доминирует над relevance/freshness. Recency считается от ДНЯ СОЗДАНИЯ (gameDay), поля last-access не существует. Cap=5 задан тремя литералами в agent.ts + default в сигнатуре recall. Дегенератные (короткие) запросы не защищены на уровнях Qdrant/cosine.

**Architecture:**
- `decay.ts` — чистые функции скоринга: `decayedImportance` (decay.ts:8), `freshness` (decay.ts:16), `compositeScore` (decay.ts:27, Path A, ÷10). Третий потребитель — eviction.
- `memory.ts / VectorMemory` — хранение (store, dual-write _memoryLog+Qdrant) + `recall` (memory.ts:150) с инлайн-формулой (Path B, raw) + 3-уровневый fallback + eviction (memory.ts:266).
- `agent.ts` — 3 потребителя recall: chat (agent.ts:84), chatStream (agent.ts:115), generateResponse (agent.ts:212), все с литералом 5.
- `volition.ts` — recall НЕ использует (0 совпадений).

**Data flow:**
agent.chat/chatStream/generateResponse → recall(query, currentDay, 5)
→ если Qdrant up: embed(query) → qdrant.search(limit=5*3=15) → payloadToScore (decayedImportance/freshness от daysPassed=currentDay−gameDay) → relevance=cosine из Qdrant
→ иначе fallbackRecall (brute cosine по _memoryLog) → при падении embed: keywordRecall (substring, слова len>3)
→ ОБЩИЙ rerank: m.compositeScore = relevance*0.4 + decayedImportance*0.4 + freshness*0.2 (memory.ts:179, Path B, raw)
→ sort desc → slice(0, topK=5) (memory.ts:182) → в промпт LLM.

**Расхождение двух path (verbatim):**
- Path A (decay.ts:32): `relevance * 0.4 + (decayedImp / 10) * 0.4 + fresh * 0.2`
- Path B (memory.ts:179): `m.relevance * 0.4 + m.decayedImportance * 0.4 + m.freshness * 0.2`
Path A экспортируется и импортируется (memory.ts:2), но НИКОГДА не вызывается → dead import. Реальное ранжирование — Path B (без /10) → importance-доминирование.

**Key decisions / patterns:**
1. Over-fetch×3 затем rerank — кандидаты topK*3, финал slice(0,topK) (memory.ts:157,182). Масштабируется при подъёме K до 8.
2. 3-уровневая graceful degradation Qdrant→cosine→keyword (memory.ts:155/186/202); composite применяется только к финальному результату recall, промежуточные сортируют по relevance.
3. Recency = creation-time: daysPassed = currentDay − gameDay (memory.ts:309,323); gameDay ставится один раз в store (memory.ts:124), не мутируется; last-access поля нет (MemoryEntry agent-types.ts:200).
4. Eviction использует raw decayedImportance (memory.ts:278) — согласован с Path B по шкале, protected никогда не вытесняется.

**Gotchas:**
- Свежая память importance=10 в Path B: терм 10*0.4=4.0 затмевает relevance(max 0.4) и freshness(max 0.2) — relevance почти не влияет (memory.ts:179).
- compositeScore импортирован, но не используется (memory.ts:2) — комментарий decay.ts:23-25 обещает нормализацию 0..1, которой Path B не делает.
- Дегенератный запрос: keywordRecall отсекает короткие слова (memory.ts:203 filter len>3) → пусто; но Qdrant/cosine эмбеддят пустой/короткий запрос и вернут мусорный топ по importance — guard отсутствует.
- timestamp (unix ms) — creation-time, в скоринге не участвует вообще.

**Referenced answers:**
- Q: Два scoring path и как расходятся? / A: decay.ts:32 `(decayedImp/10)` vs memory.ts:179 raw `m.decayedImportance`; Path A мёртв, Path B активен → importance не нормализован.
- Q: Recency от creation или last-access? / A: От creation (gameDay), memory.ts:309/323; поля last-access нет нигде.
- Q: Где topK=5? / A: default memory.ts:150 + литералы agent.ts:84/115/212; срез memory.ts:182.
- Q: Как свести к ОДНОЙ нормализованной composite? / A: Заменить инлайн memory.ts:178-180 на вызов compositeScore() из decay.ts, /10 держать ТОЛЬКО внутри неё; не дублировать; eviction (memory.ts:278) не трогать.
- Q: Как защитить дегенератный запрос? / A: ранний guard в начале recall (memory.ts:151) до embed: trim + проверка значимых слов → return [] либо fallback на топ-importance.

**Not explored:**
- Реализация добавления last-access recency (потребует нового поля + миграции save.json/Qdrant payload — отдельная задача).
- llm-client embed() внутренности и поведение на пустой строке (не входит в скоуп скоринга).
