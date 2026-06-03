---
type: character
id: s-02-illa
status: draft
aliases: ["Illa", "S-02"]
tags: [type/character, status/draft, staff]
related: ["[[STAFF_S-01_Instructor]]", "[[RELICT_R-V-01_Mara]]"]
updated: 2026-06-02
---

> [!summary] TL;DR
> Staff, без Отрицания. Диспетчер операций — рука, что тратит реликтов; решает,
> кого вызвать и какой ценой (Operations-петля). Бывший полевой медик-триаж;
> прагматична, устала, «активы, тратить с умом» — честный холод без прикрас. Точка,
> где игрок-вербовщик предлагает и исполняет контракты. Контраст к Brevik
> (милосердие-тюрьма ↔ честная эксплуатация).

# STAFF DOSSIER · S-02 · "ILLA"

> **Статус:** брейншторм-концепт, фаза идеи. Спутник к `CONCEPT_Negation.md`.
> **Формат:** staff-карточка (НЕ Relict — Отрицания нет). Рука Operations-петли.
> Полноценный bilateral-агент.

---

```
╔══════════════════════════════════════════════════════════════╗
║  STAFF FILE S-02                                              ║
║  ROLE .................... operations dispatcher              ║
║  NEGATION ................ none (baseline human)              ║
║  FUNCTION ................ deploys negations to tasks         ║
║  VOICE ................... pragmatic triage                   ║
║  STANCE TO RELICTS ....... assets to be spent wisely         ║
╚══════════════════════════════════════════════════════════════╝
```

---

## 1. IDENTITY

- **Designation in record:** S-02.
- **Common name:** Illa *(draft)*.
- **Role:** operations dispatcher. Decides **who is summoned to what** — which
  Relict is spent on which need (the wounded, the silenced, the breaking).
- **Prior occupation:** field triage medic — used to deciding, fast, who gets
  help and who does not. Carried that calculus into the Object.
- **Disposition:** tired, dry, decisive. Does not pretend the job is clean.
  Makes the moral-weight calls and does not look away from them — but makes
  them anyway.

---

## 2. FUNCTION & VOICE

- **The deploying hand:** S-02 drives the **Operations loop** (M-B). To summon
  Mara to a wounded subject is to condemn them to stall; Illa is the one who
  signs that. Every deployment is a cost spent through her.
- **Triage logic:** she ranks need against price — a calculus, not a feeling.
  This makes her the natural counter-weight to the player's compassion in the
  protocol loop: she'll spend a Relict the player wants to protect.
- **The player's lever:** the player negotiates, defies, or assists Illa's
  deployments. Cooperate and earn standing (and complicity); refuse and keep
  your hands clean (and lose leverage). She is where Operations bites.

---

## 3. STANCE — "ASSETS, SPENT WISELY"

> Illa does not despise Relicts and does not romanticize them. They are
> capabilities with costs, and her job is to not waste them. This is colder
> than Brevik's "mercy" — and, to some residents, more honest.

- Sees the self-name "Relict" as irrelevant to the work; uses "Vector,"
  "Recluse," or just the designation ("send DEFINIS").
- Will spend herself too — she does not exempt anyone, including, eventually,
  the player-as-Relict. Consistency is her ethic.
- Carries a private ledger of every call that went wrong. Does not show it.

---

## 4. SOCIAL DYNAMICS (emergent hooks)

> Not scripted — resolved through beliefs / relationships / witnessed consequence.

- **The one who spends you:** Relicts form beliefs about Illa as the source of
  their worst summons. Sentiment toward her tracks how she's deployed them.
- **Complicity economy:** when the player helps a deployment, witnesses route
  some of the moral weight onto the player too. Helping Illa is *becoming* Illa.
- **The honest cold:** some residents trust Illa precisely because she does not
  dress the cost up as kindness (contrast Brevik). The engine plays the split.
- **Dispatcher under pressure:** if deployments cascade into incidents, agents
  watch whether Illa keeps her nerve or starts sparing favorites — either is a
  visible shift in a supposedly impartial hand.

---

## 5. ENGINE PROFILE (служебное — заготовка под CLWA)

> Genre-neutral data. Roles/labels — контент-строки, НЕ идентификаторы движка
> (INV-14). Числа — BASE values; рандомизация per-run. **No negation fields.**

### OCEAN+H + Enneagram
| O | C | E | A | N | H | Enneagram | Role |
|---|---|---|---|---|---|---|------|------|
| 0.5 | 0.85 | 0.45 | 0.4 | 0.4 | 0.65 | 8w9 Challenger | Dispatcher (Staff) |

- **C 0.85** — методичный триаж, держит систему деплоев.
- **A 0.4** — не мягкая, дистанцирована от тех, кого тратит.
- **N 0.4** — устойчива под весом решений, но не безразлична (несёт ledger).
- **H 0.65** — честна о цене, не прикрывает её милосердием.
- **8w9** — берёт ответственность за тяжёлые решения, спокойная сила.

### Agent data
```
isPlayer:      false
negation:      none            // staff — baseline human, NO negation fields
vocabulary:    "system"        // designation-first ("send DEFINIS")
role:          "dispatcher"    // display only; behavior via capability flags
function:      operations deployment (drives M-B Operations loop)
```
> NB: staff без negation-полей. Illa — узел Operations-петли: через неё проходит
> цена применения даров (Trauma на носителях). Контраст Brevik (милосердие) vs
> Illa (честный холод) даёт две модели власти, между которыми лавирует игрок.

---

## 6. OPEN QUESTIONS
- [ ] Что в её «ledger» — конкретный сорвавшийся деплой как крючок.
- [ ] Имя — финал «Illa» или подобрать.
- [ ] Кто над Illa (управление Объектом — открытый вопрос §8 концепта).

---

*Staff-шаблон. Последующие карточки (S-0X) следуют этой структуре.*
