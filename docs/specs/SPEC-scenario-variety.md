# SPEC: Scenario Variety

> Milestone 1, финальная задача. Гарантировать что рандомизация даёт разные истории.
> Статус: **спека утверждена (v2 — sentiment-based targeting)**

---

## Проблема

Kill affordance требует `hasMotive: true` + `findMotiveTarget` (reads `profile.motive.targetId`). Только 2 NPC имеют motives (Mark→Bess, Hilda→Ted). Результат: преступник почти всегда Mark, жертва почти всегда Bess.

## Решение: sentiment-based kill targeting

Убрать `hasMotive` из kill requirements. Заменить `findMotiveTarget` на `findMostHatedTarget` — ищет NPC с самым низким sentiment. Sentiment уже рандомизируется каждый seed → variety «бесплатно».

### Что меняется

| Компонент | Было | Стало |
|-----------|------|-------|
| kill requires | `hasMotive: true` | убрано (sentiment threshold достаточен) |
| kill targetFinder | `findMotiveTarget` → `profile.motive.targetId` | `findMostHatedTarget` → lowest sentiment NPC |
| `profile.motive` | gate для kill | опциональное нарративное обогащение |
| instinct context | `{reason:motive.reason}` | `{reason:motive.reason ∥ "deep resentment toward TARGET"}` |

### Что НЕ меняется

- Engine — ноль изменений
- `hasMotive` interface в al.ts — остаётся (другие affordances могут использовать)
- Существующие motive поля (Mark, Hilda) — остаются, используются для rich instinct text
- Sentiment randomization — уже работает
- Все остальные affordances — без изменений

### findMostHatedTarget

```typescript
function findMostHatedTarget(npcId: string, agent: Agent, ctx: AffordanceContext): AffordanceTarget | null {
  const rels = agent.state.relationships;
  if (!rels) return null;

  let bestId: string | null = null;
  let bestSentiment = 0; // only consider negative
  let bestName = '';
  let bestLocation = '';

  for (const [otherId, other] of ctx.agents) {
    if (otherId === npcId || !other.state.alive) continue;
    if (other.profile.isPlayer) continue;
    if (other.state.status) continue; // detained/exiled/etc

    const rel = rels.getRelationship(otherId);
    if (!rel) continue;
    if (rel.sentiment < bestSentiment) {
      bestSentiment = rel.sentiment;
      bestId = otherId;
      bestName = other.profile.name;
      bestLocation = other.state.location;
    }
  }

  if (!bestId) return null;

  // Enrich with motive reason if available
  const motive = agent.profile.motive;
  const reason = (motive && motive.targetId === bestId) ? motive.reason : undefined;

  return {
    targetId: bestId,
    targetName: bestName,
    targetLocation: bestLocation,
    extra: reason ? { reason } : {},
  };
}
```

### Instinct context fallback

Kill affordance `instinctContext` использует `{reason:...}`. Если motive.reason есть для данной цели → используется. Если нет → шаблон fallback: `"is a threat that must be eliminated"` (уже в текущем определении).

Interpolation `{reason:fallback}` уже поддерживается engine template resolver. Нулевые изменения.

---

## Motive как нарративное обогащение (optional Phase B)

Статические motives остаются в JSON. При совпадении target → richer instinct text. Можно добавить больше для качества нарратива:

| NPC | Target | Reason | Статус |
|-----|--------|--------|--------|
| Mark→Bess | bess | She figured out your exotic spices are common herbs | ✅ Есть |
| Hilda→Ted | ted | Your father bled out on the tavern floor | ✅ Есть |
| Ted→Mark | mark | Gambling debts are crushing you and he won't stop pressing | Опционально |
| Garrett→Elara | elara | She's hiding something and you can't prove it... yet | Опционально |
| Elara→Garrett | garrett | He's getting too close to your cover | Опционально |

Эти motives НЕ gate kill. Они обогащают instinct description ЕСЛИ sentiment-based targeting выбрал ту же цель что и motive.targetId.

---

## Файлы

| Файл | Изменение | Строк |
|------|-----------|-------|
| `modules/crime-justice/affordances.ts` | kill: убрать `hasMotive: true` | -1 строка |
| `modules/crime-justice/target-finders.ts` | Добавить `findMostHatedTarget`, зарегистрировать | +25 строк |
| `modules/crime-justice/affordances.ts` | kill: `targetFinder: 'most_hated'` | 1 строка |

**Итого: ~25 строк изменений в modules. Ноль в engine.**

---

## Гарантии variety

| Constraint | Как обеспечен |
|-----------|---------------|
| Минимум 1 враждебная пара | Mark→Bess sentimentRange [-0.9, -0.3] → всегда < -0.3 |
| Разные убийцы per seed | H randomization: Mark (всегда < 0.5), Hilda/Elara/Ted (иногда < 0.5) |
| Разные жертвы per seed | Sentiment randomization: Hilda→Ted иногда very negative, иногда neutral |
| Kill не происходит если все добрые | moodBelow: -0.6 + sentimentBelow: -0.4 + H weight → score < MIN_SCORE |

---

## Acceptance test

```
5 seeds (100, 200, 300, 400, 500):
  - ≥ 3 из 5: crime occurred
  - ≥ 2 разных преступника
  - ≥ 2 разных жертвы
  - ≥ 2 разных типа (kill vs steal vs blackmail)
```

---

## Отложено

| Что | Почему |
|-----|--------|
| LoRA | Отдельная задача, GPU 35h. Не блокирует variety |
| Crime Severity Tiers | Milestone 3. Нужны новые minor crime types |
| Добавление motive.reason для Ted/Garrett/Elara | Optional enrichment. Можно в любой момент, не блокирует |

---

## Связь с принципами

| Принцип | Оценка |
|---------|--------|
| Эмерджентный нарратив | ✅ Кто убийца = f(sentiment + H + mood) |
| Engine = universal | ✅ Engine не меняется |
| Modules = data | ✅ Только affordance definition + target finder |
| Декларативно | ✅ sentimentBelow threshold в данных |
| No text matching | ✅ Sentiment — число |
| Bilateral | ✅ Работает для любого Agent |
| PM = инстинкт | ✅ H + sentiment → score → instinct → LLM решает |
