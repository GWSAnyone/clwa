# SPEC: Engine Genre-Neutralization (drain all crime-justice leaks)

> **Milestone**: M5 (Engine Generalization) — Phase A (cleanliness, prerequisite for Phase B)
> **Status**: **🚧 IN PROGRESS** (branch `feature/engine-neutralization`)
> **Depends on**: SPEC-position-movement (v0.15.0), SPEC-remove-gamespeed (v0.15.1)
> **Source of truth**: `docs/workflow/engine-self-sufficiency/2026-05-29-28aeb820/` (verdict + leak list) and
>   `docs/workflow/engine-generalization-survey/2026-05-29-3d7ddc1c/` (per-subsystem maps). All 9 per-agent
>   reports re-read before implementation — leak inventory below merges every leak both surveys found.
> **Created**: 2026-05-29

---

## Цель

Привести движок к **бриллиантовой genre-нейтральности**: убрать ВСЕ протёкшие в `packages/engine` знания crime-justice
домена (hardcoded строки, имена полей типов, crime-названные примитивы, crime-framed промпт-проза, dead defaults),
так чтобы семантическая граница INV-14 («zero module-specific strings») стала **PERFECT**, а не «PARTIALLY VIOLATED».
Это фундамент под Phase B (universal capability subsystems) — сначала чистим базу, потом наращиваем на чистом.

## Контекст (вердикт двух surveys)

Движок — **occasional-engine, 7/10** module-sufficient. Поведенческая *физика* (events, affordances, CG, beliefs,
goals, volition, mood) — действительно универсальна; **import**-граница INV-14 идеальна (ноль импортов engine→module).
Но **semantic**-граница нарушена: crime-вокабуляр осел в движке как строки, имена типов, dead defaults и проза.
Часть утечек **blocking** (движок mis-render'ит для не-crime жанра: придворная сплетня рендерится как
«investigating the courtship of X. Suspect: Y»). Цель Phase A — поднять оценку 7→9-10, leak-count→0.

**Bar**: поведение существующей crime-игры **идентично** (это регресс-оракул). Каждая утечка генерализуется
паттерном **additive-before-destructive**: (1) добавить engine-registry/hook, (2) crime-модуль регистрирует свой
контент через hook, (3) убрать inline-контент из движка, (4) `tsc` 0 + `bun test` зелёный — и только потом дальше.
Базлайн перед стартом: tsc 0, **210/210** тестов.

## Инвентарь утечек и план дренажа

Каждый шаг — отдельный коммит. Порядок: от самого точечного/ценного (A1) к самому объёмному (A9 rename).

| # | Утечка | Локация | Подход | Severity | Статус |
|---|--------|---------|--------|----------|--------|
| **A1** | `'rumor'` hardcoded belief-source | `world.ts:1181,1194,1309` | engine `BELIEF_SOURCE.GOSSIP`; унифицировать crime secondhand-источники в `gossip`; `heat.ts` считает `gossip` | blocking | ✅ |
| **A2** | Role-directive crime-проза | `agent.ts:376-405` `buildRoleDirective` | `registerRoleDirectiveBuilder` (зеркало `registerSecretDirectiveBuilder`); crime-проза → модуль | blocking | ✅ |
| **A3** | Belief NL «committed {verb} against {target}» | `beliefs.ts` summarizeForPrompt/Memory + `il.ts` question-handler | `registerBeliefPhrasing` (per event-type/category); нейтральный fallback в движке | blocking | ☐ |
| **A4** | Concealment/accusation проза | `secret-directives.ts:20-89` + `il.ts:594-690` buildAccusationContext | роутить текст через `SECRET_DIRECTIVE_BUILDERS`-паттерн; crime-текст → модуль | blocking | ☐ |
| **A5** | AffordanceRequirement crime-поля + хардкод-ветки + findByRole-обогащение + StepTemplate crime-поля | `al.ts:11-49,269-280,294,301-320,332-371,537-541,79-105`; `goals.ts` GoalStep | strip crime-полей из engine-типа → generic params bag + `REQUIREMENT_CHECKERS`; обогащение/ветки → модуль; StepTemplate crime-поля → generic `extra` | type leak | ☐ |
| **A6** | AgentProfile capability-флаги | `agent-types.ts:101-106`; reads `al.ts:332-335,305`, `volition.ts:143,169` | open `capabilities: Record<string,boolean>`; `has_capability` op — единственный источник; `isArrestTarget`→нейтральное имя | type leak | ☐ |
| **A7** | EmotionalPressure union + TradeIntent + shop/ShopItem | `il.ts:147-150,152`; `agent-types.ts:107-118` | `EmotionalPressure.type=string` (registry); TradeIntent → module-registered intent; shop/ShopItem → оценить (Phase B inventory заменит) | type leak | ☐ |
| **A8** | Pre-seeded crime defaults | `event-registry.ts:312-318,332-338,347-353` | пустые maps; crime-метки/веса → модуль; TESTIMONY/OBSERVATION/GOSSIP — универсальны, остаются | dead leak | ☐ |
| **A9** | CrimeScene → generic primitive (rename) | `world-types.ts:114-150`; `world.ts:1485-1568`; `goals.ts`; `event-registry.ts`; `crime-scene.ts`; server; `game.js`; tests | Serena `rename_symbol`: `CrimeScene→SceneResidue`, `processKill→processAgentDeath`, `crimeEvent→genericEvent`, `ExaminationPoint→…` | naming leak | ☐ |
| **A10** | PlayerJournal investigation-журнал в движке | `journal.ts:1-48` | оценить blast radius → generic player-observation log или crime-модуль | naming leak | ☐ |

**Borderline (нейтрализуется только проза-коммент, механика — универсальная психология, не трогаем мат):**
`al.ts:430` moodCurve коммент «more crime-prone»; `volition.ts:488-497` DUTY-blocks-talk проза. Instinct
RESISTANCE/TEXTURE registry-ификация (`instinct-builder.ts`) — это **gap/enhancement** (нужен новый registry,
проза — универсальная moral-friction), отложено в Phase B, НЕ часть A.

## Переиспользуем (не изобретаем)
- Hook-форма: `registerSecretDirectiveBuilder` → модель для `registerRoleDirectiveBuilder`/`registerBeliefPhrasing`.
- `REQUIREMENT_CHECKERS` open registry + `checkRegistryRequirements` (A5).
- CG `has_capability` op (A6). `getRegisteredPressureTypes()` (A7). `registerEventLabels`/`registerSourceFlags` (A1/A8).
- Serena `rename_symbol` для A9/A10 (codebase-wide, reference-safe).

## Риски
- **A5/A6** — горячий requirement/decision-путь, общий для NPC volition И `validatePlayerAction`: bilateral-паритет
  (INV-17) обязан сохраниться; crime-мир — регресс-оракул.
- **A6/A9/A10** меняют persisted/authored shapes (capability JSON, save-поля): world-loader/world-editor мигрируют
  в lockstep. Старых сейвов нет (подтверждено) → save-миграция не нужна.
- Serena stale-index при длинных цепочках symbol-edit на одном файле → частый `tsc`, при подозрении — full Write.

## Verification (после A1–A10)
- После КАЖДОГО шага: `bunx tsc --noEmit` == 0, `bun test` зелёный (210+).
- `clwa-auditor` на дифф: INV-14 (особ. semantic), INV-08/09/10/12/15, INV-17 bilateral.
- Повторный прогон **module-sufficiency test** (метод в self-sufficiency `report.md`) на двух probe-жанрах:
  оценка 7→8-9, leak-count→0 (измеримый сигнал успеха). Отчёт — в `docs/workflow/`.
- Live (LM Studio): прогон crime-флоу (kill→investigate→arrest→sentence) — без изменений.

## Что НЕ делается в Phase A (осознанно)
- Новые capability-субсистемы (scalar-attribute, inventory, factions) — это **Phase B**
  (`SPEC-engine-generalization.md`), проектируются на уже чистой базе.
- Удаление capability как таковой — запрещено: каждая утечка генерализуется (registry+модуль), не вырезается.
