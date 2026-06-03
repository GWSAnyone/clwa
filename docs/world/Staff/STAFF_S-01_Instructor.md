---
type: character
id: s-01-brevik
status: draft
aliases: ["Brevik", "S-01"]
tags: [type/character, status/draft, staff]
related: ["[[STAFF_S-02_Dispatcher]]"]
updated: 2026-06-02
---

> [!summary] TL;DR
> Staff, без Отрицания. Инструктор-надзиратель — лицо системы; ведёт инструктаж
> игрока (диегетический туториал). Верит «содержание = милосердие», истинно
> верующий в протокол, добр в рамках правил. Когда игрок кристаллизуется — Brevik
> становится его надзирателем (инструкция → клетка). Несёт ось дискриминации «свои
> против гонимых». Клинический словарь Recluse/Vector. Контраст к Illa.

# STAFF DOSSIER · S-01 · "BREVIK"

> **Статус:** брейншторм-концепт, фаза идеи. Спутник к `CONCEPT_Negation.md`.
> **Формат:** staff-карточка (НЕ Relict — Отрицания нет). Несёт ось
> дискриминации «свои против гонимых». Полноценный bilateral-агент.

---

```
╔══════════════════════════════════════════════════════════════╗
║  STAFF FILE S-01                                              ║
║  ROLE .................... instructor / warden                ║
║  NEGATION ................ none (baseline human)              ║
║  FUNCTION ................ inducts new staff; enforces protocol║
║  VOICE ................... "the system" (Recluse/Vector terms)║
║  STANCE TO RELICTS ....... containment is mercy (true believer)║
╚══════════════════════════════════════════════════════════════╝
```

---

## 1. IDENTITY

- **Designation in record:** S-01.
- **Common name:** Brevik *(draft)*.
- **Role:** instructor-warden. The face the player meets first: runs the
  **induction** (diegetic tutorial — protocols, classes, the daily order).
- **Prior occupation:** long-serving custodian of the Object; came up through
  the protocol, not from outside.
- **Disposition:** calm, precise, unhurried. Not cruel — a **true believer**
  that the rules are the kindest thing on offer. Speaks the clinical dialect:
  "Recluse," "Vector," "the subject," never the street labels.

---

## 2. FUNCTION & VOICE

- **Induction:** S-01 teaches the player the world. Mechanically this is the
  **boot knowledge-seeding** (knownFacts) made diegetic — the player ends
  competent at the *system*, ignorant of the *people* (rerolled per run).
- **Voice of the system:** every protocol the player learns is in Brevik's
  words. He is the source of "the rules" — and thus the measure against which
  every later violation is judged.
- **The turn:** when the player crystallizes into a Relict (§4.5 of concept),
  the protocols Brevik taught now apply **to the player.** The instructor
  becomes, structurally, a warden over the man he trained. Brevik does not
  relish this — but he does not flinch from it either. *That* is the horror.

---

## 3. STANCE — "CONTAINMENT IS MERCY"

> Brevik is the discrimination axis given a human, sympathetic face. He does not
> hate Relicts; he believes the world outside would kill them and the Object
> keeps them alive. This makes him harder to argue with than a bigot.

- Holds the **system's denial of kinship** (Recluse ≠ Vector — see terminology)
  as settled fact: he classifies, he does not wonder.
- Treats the self-name "Relict" as a sentimental folk error — gently, which
  stings more than mockery.
- Genuinely protective and genuinely a jailer. The player cannot resolve him
  into villain or ally; the engine plays the tension through trust/sentiment.

---

## 4. SOCIAL DYNAMICS (emergent hooks)

> Not scripted — resolved through beliefs / relationships / witnessed consequence.

- **The trusted warden:** agents who accept the Object's order trust Brevik;
  those who chafe resent him. He is a sentiment fault line by his mere role.
- **The measure of violation:** every protocol break is, in belief-space, a
  break of *Brevik's* rules. Witnesses route blame through him.
- **The kind jailer's grief:** if a containment decision he enforces leads to
  harm (Mara summoned, a subject stalled), Brevik carries it — and other agents
  watch whether he bends. A believer who bends is a story.
- **Vocabulary clash:** Brevik says "Vector"; a frightened resident says
  "porchenniy"; the player learns which word a given NPC uses — a readout of
  where they stand.

---

## 5. ENGINE PROFILE (служебное — заготовка под CLWA)

> Genre-neutral data. Roles/labels — контент-строки, НЕ идентификаторы движка
> (INV-14). Числа — BASE values; рандомизация per-run. **No negation fields.**

### OCEAN+H + Enneagram
| O | C | E | A | N | H | Enneagram | Role |
|---|---|---|---|---|---|---|------|------|
| 0.35 | 0.95 | 0.5 | 0.55 | 0.3 | 0.6 | 1w9 Reformer | Instructor (Staff) |

- **C 0.95** — абсолютная дисциплина протокола.
- **O 0.35** — не подвергает систему сомнению, не ищет нового.
- **N 0.3** — спокоен, устойчив, его не раскачать.
- **A 0.55 / H 0.6** — добр в рамках правил; правила выше доброты.
- **1w9** — праведность порядка + потребность в стабильности/мире.

### Agent data
```
isPlayer:      false
negation:      none            // staff — baseline human, NO negation fields
vocabulary:    "system"        // uses Recluse/Vector clinical terms (content)
role:          "instructor"    // display only; behavior via capability flags
function:      induction (seeds player knownFacts), protocol enforcement
```
> NB: staff — обычные CLWA-агенты без negation-полей. Их «системный словарь» —
> per-NPC vocabulary-данные (терминология §1), не движковая логика. На таких,
> как Brevik, стоит ось дискриминации (standing/sentiment, §6.1 концепта).

---

## 6. OPEN QUESTIONS
- [ ] Был ли Brevik когда-то ранен Vector'ом (оправдание веры) — или вера чистая.
- [ ] Имя — финал «Brevik» или подобрать.
- [ ] Глубина участия в триггер-инциденте превращения игрока.

---

*Staff-шаблон. Последующие карточки (S-0X) следуют этой структуре.*
