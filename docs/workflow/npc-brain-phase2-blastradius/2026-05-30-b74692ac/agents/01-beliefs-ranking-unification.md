# Agent 1 — Belief ranking unification (M6 Phase 2) — beliefs.ts / agent.ts / event-registry.ts / decay.ts / crime-justice

## Map: Belief ranking unification (M6 Phase 2)

**TL;DR:** Сейчас beliefs ранжируются ТРЕМЯ независимыми способами: `summarizeForPrompt` (чистый confidence DESC), `serializeMemoryState` (inline confidence×recency, top-30) и crime-justice role builder (свой filter+sort top-1). decay.ts уже содержит готовые scoring-примитивы, которые ни один из путей не использует. Цель Phase 2 — свести всё к одному `BeliefManager.getTopBeliefs(k, {recency, relevance, topic})`.

**Architecture:**
- `beliefs.ts` BeliefManager — единственный store; `getAllBeliefs` (`beliefs.ts:117`, confidence DESC) — базовый источник; текстовые рендеры `summarizeForPrompt` (`:121`, 2-е лицо, для LLM), `summarizeForMemory` (`:147`, 3-е лицо, для векторной памяти).
- `agent.ts` `serializeMemoryState` (`:260`) — снапшот для qdrant, второе ранжирование; `buildRoleDirective` (`:423`) — собирает системный промпт.
- `event-registry.ts` — phrasing hook: `phraseBelief` (`:765`, first-non-null-wins), `registerBeliefPhrasing` (`:761`), `BELIEF_PHRASINGS` (`:759`, пустой в движке), `getEventLabel`/`getEventLabelSafe` (`:135`/`:140`).
- `decay.ts` — `decayedImportance` (`:7`), `freshness` (`:15`), `compositeScore` (`:26`) — НЕ используются в beliefs/agent.
- `crime-justice/index.ts` — blanket phrasing (`:643`), role builder (`:651`).

**Data flow (ранжирование):**
Path A (LLM-промпт): `getAllBeliefs` (confidence DESC, `beliefs.ts:118`) → `.filter(object||subject)` → `.slice(0,k)` → certainty-ladder + `phraseBelief` → строка `- You {certainty}: {relation}{where} ({how})` (`beliefs.ts:138`). **Recency не участвует.**
Path B (snapshot): `getAllBeliefs` → inline `score = confidence × 1/(1+days*0.1)` (`agent.ts:272-274`) → sort → top-30 → структурированные поля. **Своя формула, decay.ts не задействован.**
Path C (role): `getAllBeliefs().filter(isTransferable && conf>=0.3).sort(conf)[0]` (`index.ts:656-661`).

**Key decisions / patterns:**
1. phraseBelief — first-non-null-wins, per-event поддерживается через возврат `null` для чужих eventType (`event-registry.ts:771-777`). crime-justice регистрирует ОДНУ blanket-функцию, игнорирующую eventType (`index.ts:643`); комментарий явно рекомендует per-event при сосуществовании модулей (`index.ts:640-642`).
2. getEventLabelSafe (warn+fallback) уже существует и используется модулем (`index.ts:663,706,730`), но beliefs.ts по-прежнему использует getEventLabel с silent null-drop (`beliefs.ts:131-132,161-162`).
3. Две certainty-лестницы для одних beliefs: prompt `>0.8/>0.5` (`:130`) vs memory `>0.7/>0.4` (`:160`).

**Gotchas:**
- BeliefManager не знает currentDay — для recency его придётся прокидывать параметром (`beliefs.ts`).
- `summarizeForPrompt` имеет 5 call-sites с разными maxBeliefs (3/3/3/2/2) и разными обёртками — расширение сигнатуры затронет все (`agent.ts:429`, `volition.ts:404`, `interaction.ts:75-76,157,176`).
- `getAllBeliefs` вызывается ~20 раз в crime-justice как фильтр-итератор — getTopBeliefs их НЕ заменяет.
- Дублирование top-belief: `## What you know` (`agent.ts:429`) и role-секции (`index.ts:651-693`) показывают один и тот же belief — dedup target.

**Referenced answers:**
- Q: точные сигнатуры? / A: см. exactApi (verbatim).
- Q: как расходятся пути? / A: A=confidence DESC, B=confidence×recency(inline), C=filter+sort top-1; ни один не использует decay.ts.
- Q: чистый единый API? / A: `getTopBeliefs(k, {recency, relevanceEventType, topicEventType, currentDay})` на BeliefManager, переиспользует decay.freshness; вызывать из `summarizeForPrompt` (`beliefs.ts:124`) и из `serializeMemoryState` (`agent.ts:270`).
- Q: recency cue? / A: расширить шаблон `beliefs.ts:138`, прокинуть currentDay, добавить `(yesterday)/(Nd ago)`.
- Q: per-event phrasing сегодня? / A: уже поддерживается — fn возвращает null для чужих eventType; заменить blanket `index.ts:643-645` на eventType-scoped функции, event-registry менять не нужно.

**Tests that pin output:** `genre-neutrality.test.ts:81-91` (phraseBelief who/target + first-non-null-wins), `save-load.test.ts:172,322,337` (getAllBeliefs length/порядок).
