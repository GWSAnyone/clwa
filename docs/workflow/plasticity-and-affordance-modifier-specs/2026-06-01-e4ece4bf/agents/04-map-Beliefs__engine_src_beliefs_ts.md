## Map: Beliefs + Relationships — seams for Personality Plasticity (SPEC1) и Affordance-Space Modifier (SPEC2)

**Допущение:** глубина — medium→deep на двух запрошенных файлах + точки интеграции (al.ts/event-registry.ts/cg-engine.ts/il.ts). Это карта реальности, не дизайн.

**TL;DR:** `beliefs.ts` — плоский `Map<id,Belief>` store с одной точкой записи (`addBelief`) и confidence∈[0,1]; `relationships.ts` — направленный граф sentiment/trust/standing с клампленными мутаторами. Оба уже читаются `computeUtility` (al.ts) как каналы скоринга, и оба уже имеют прецедент «масштабировать величину от trust» (il.ts:532). Чистые seam-формы для обоих SPEC существуют, но «self-belief» — это MODULE-конвенция (`b.subject===self.id`), а не engine-примитив, и self-направленных relationship нет.

---

### Beliefs — что ЕСТЬ

**Shape** (`beliefs.ts:6`): `{id, eventType, subject|null, object|null, location|null, confidence 0..1, source, sourceNpcId|null, gameDay, lastUpdated}`. Нет поля «self»/«about-me».

**API** (`BeliefManager`, `beliefs.ts:41`):
- `addBelief` (44) — единственная запись. Contract guards (id/eventType/source/confidence∈[0,1], кидает иначе). Dedup по `(eventType,object,source)` через `findExisting` (74) — НЕ по id; одинаковый source про одно событие → reinforce (берёт max confidence), разные source → сосуществуют.
- `getMaxConfidenceFor(subject, eventTypeMatcher?)` (82) — точный примитив для «масштабировать величину от self-belief»: вызов с `subject=selfId`.
- `queryBeliefs({eventType,subject,object})` (92), `getStrongestBelief` (120), `getTopBeliefs` (138, confidence×recency).
- `decayBeliefs` (108) — `confidence = max(0.1, conf - sourceRate×eventTypeRate×days)`. Floor 0.1, никогда не 0.

**Source-флаги** (3 раздельных registry в `event-registry.ts`, ключ — строка source):
- константы `BELIEF_SOURCE {TESTIMONY,OBSERVATION,GOSSIP,EVIDENCE}` (332) — engine владеет; modules добавляют свои.
- `registerBeliefSourceLabels` (320, fallback=identity), `registerSourceTransferWeights` (357, fallback 0.6), `registerSourceDecayRates` (371, fallback 0.02), `registerSourceCategory/isSourceCategory` (654, семантические группы guilt/direct_experience).

**Event→belief emission seam** (то, что нужно SPEC1 «shift emits a belief/memory»):
- `registerBeliefCreator(consequenceType, fn)` (605) ← вызывается из `cg-engine.ts:397`: CG резолвит subject/object в ID, потом дёргает module-creator, который пишет `addBelief`. 11 примеров в crime `index.ts:408-555`.
- `registerBeliefPhrasing`/`phraseBelief` (762/766) — genre-neutral NL-фрейминг, first-non-null-wins, нейтральный fallback без «wrongdoing».
- Прецедент engine-emitted belief: `il.ts:539` пишет belief с `source=TESTIMONY`.

### Relationships — что ЕСТЬ

**Shape** (`relationships.ts:5`): `{targetId, targetName, type, sentiment -1..1, trust 0..1, standing? -1..1}`. Направленный (от носителя к target). `getRelationship(self)` → null.

**API** (`RelationshipGraph`, 49): `getRelationship` (64), `adjustSentiment`/`adjustTrust` (72/81, клампят + `onChange`), `adjustStanding` (106, клампит, НЕ `onChange`), `getTestimonyWeight(src)` (91, trust как множитель уверенности, fallback 0.3 для чужих), `getGriefPenalty` (97). `addRelationship` (53) — единственный chokepoint санитизации (SL-07).

---

### Data flow seam (как оба SPEC сцепляются с существующим скорингом)

`computeUtility` (`al.ts:447`) уже агрегирует 6 каналов:
- **sentiment**: `relationshipWeight × sentimentCurve(rel.sentiment)` (461-463) — но только если `rel` существует (для чужих null → 0).
- **trust**: `trustWeight × rel.trust` (482).
- **belief**: `beliefModifiers[].weight × maxConfidence(eventType)` (468-478).
- **module-каналы**: `registerScoringContributor` (439).

**SPEC2 affordance-override seam** = `REQUIREMENT_CHECKERS` (al.ts:209) / `POST_TARGET_REQUIREMENT_CHECKERS` (213) — экспортированные `Map`, заполняемые модулями `.set()`; `AffordanceRequirement` имеет открытый `[key:string]:unknown` (27). И NPC-путь (`checkRequirements` 318/323) и player-путь (`validatePlayerAction` 532) гоняют ТОТ ЖЕ Map → bilateral parity (INV-16/17) сохраняется автоматически, ЕСЛИ override зарегистрирован как requirement-checker (а не как scoring-only эффект — иначе player его обойдёт, см. risks).

**Прецедент «strength scales from sentiment/trust»**: `il.ts:532` `effectiveConfidence = claim.confidence × playerTrust` и `checkPostTargetRequirements` gate `sentimentBelow` (al.ts:291) — обе SPEC-семьи масштабирования (sentiment-to-target, self-belief) имеют рабочий аналог в коде.

---

### Чистая форма seams (что есть; без реализации)

**SPEC1 — magnitude от self-belief:** читать `BeliefManager.getMaxConfidenceFor(selfId, matcher)` — но matcher/eventType ОБЯЗАН приходить от модуля (INV-14). «Self» сейчас = `subject===agent.profile.id` (module-конвенция: crime `index.ts:688`, `heat.ts:45 matchesSelf`); engine-примитива нет.
**SPEC1 — shift emits belief/memory:** идёт через ту же дорожку `registerBeliefCreator → addBelief`; memory — через `agent.memory.store` (agent.ts:160/247). Внимание на dedup-ключ `(eventType,object,source)` — новый source во избежание clobber крайм-beliefs.
**SPEC2 — strength от sentiment-to-target:** `getRelationship(targetId).sentiment` (raw, genre-neutral) — НЕ `sentimentCurve` (крайм-тюненые зоны). Для self/zone-источника sentiment отсутствует → fallback на self-belief.
**SPEC2 — strength от self-belief:** тот же `getMaxConfidenceFor(selfId, …)`.

**Не исследовано:** attributes.ts (B1 ScalarAttribute) / mood (deformation physics) — вне FOCUS; instinct-builder/personality-prose чтение bigFive; Enneagram stress/growth. Polit/economy module данные кроме как для подтверждения паттернов.