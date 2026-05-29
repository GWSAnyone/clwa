# SPEC: Engine Genre-Neutralization (drain all crime-justice leaks)

> **Milestone**: M5 (Engine Generalization) — Phase A (cleanliness, prerequisite for Phase B)
> **Status**: **✅ Phase A COMPLETE** (A1–A9 + A4a drained & verified; A10+A4b consciously deferred — turn-key spec below).
>   Branch `feature/engine-neutralization`. tsc 0, **222/222** tests (was 210; +genre-neutrality guard + Economy Module Test).
>   `clwa-auditor`: 95% — import boundary PERFECT, INV-08/09/10/12/17 intact, all blocking/major leaks gone.
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
| **A3** | Belief NL «committed {verb} against {target}» | `beliefs.ts` summarizeForPrompt/Memory + `il.ts` question-handler | `registerBeliefPhrasing` (per event-type/category); нейтральный fallback в движке | blocking | ✅ |
| **A4a** | Concealment/witness проза | `secret-directives.ts:20-89` | 3 inline-секции → crime secret-directive builders (порядок сохранён); движок = чистый агрегатор | blocking | ✅ |
| **A4b** | Accusation-flow проза («I am the law here») + eval | `il.ts:575-692,768-872` (entangled с `PlayerJournal`+`investigator/canSentence`) | извлечь весь accusation-блок в модуль через generic IL speech-act-effect hook — **объединён с A10, после A6** | blocking | ☐ |
| **A5** | AffordanceRequirement crime-поля + хардкод-ветки + findByRole-обогащение | `al.ts:11-49,269-280,294,301-320,332-371,537-541` | тип → universal+open index-sig; checkers generic params (весь `req`); `notGuard/isInvestigator/canSentence`→`REQUIREMENT_CHECKERS`, `noGuardNearby`→`POST_TARGET_REQUIREMENT_CHECKERS`, findByRole-обогащение→`registerTargetEnricher`; `validatePlayerAction` bilateral | type leak | ✅ |
| **A5b** | StepTemplate/GoalStep crime-combat поля | `al.ts:79-105` + `goals.ts` GoalStep (`evaluateSuspect`/`lethal`/`beliefTransfer`-коммент) | `beliefTransfer` универсален (нейтрализовать коммент); `evaluateSuspect`/`lethal` — проверить потребление, убрать/делегировать в interact-hook | type leak | ☐ |
| **A6** | AgentProfile capability-флаги | `agent-types.ts:101-106`; reads в engine/module/server | open `capabilities: Record<string,boolean>` + хелпер `hasCapability()`; `has_capability` op читает map; world-loader копирует capabilities (не сплющивает); API client'у отдаёт derived `investigator`. `isArrestTarget`-rename → **в A9**; crime-проза в server `llm-npc-prompt-builder` — server-слойный след (не INV-14 движка) | type leak | ✅ |
| **A7** | EmotionalPressure closed union | `il.ts:147-150` | `EmotionalPressure.type=string` (рантайм уже через `getRegisteredPressureTypes`/`getPressureHandler`) | type leak | ✅ |
| **A7b** | TradeIntent + shop/ShopItem (economy half-subsystem) | `il.ts:153,166,72,214,237,281`; `agent-types.ts:107-119` | **→ Phase B (B2 inventory)**: рабочая shop-фича (panel/ws/steal); Phase-B inventory заменяет shop/ShopItem и переносит TradeIntent в economy-модуль. Вырывать сейчас = сломать фичу или scaffold | type leak | ⏭ Phase B |
| **A8** | Pre-seeded crime defaults | `event-registry.ts` BELIEF_SOURCE_LABELS/SOURCE_TRANSFER_WEIGHTS/BELIEF_SOURCE; `beliefs.ts` SOURCE_CONFIDENCE | label/weight maps — только universal (testimony/observation); body_discovery/evidence/deduction → crime (идентичные значения); `BELIEF_SOURCE` без BODY_DISCOVERY/DEDUCTION (EVIDENCE остаётся — engine IL ссылается); мёртвый `SOURCE_CONFIDENCE` удалён | dead leak | ✅ |
| **A9** | CrimeScene → generic primitive (rename) | engine: `world-types.ts`, `world.ts`, `event-registry.ts`, `scene-residue.ts`(↤crime-scene.ts), `goals.ts`, `cg-engine.ts`, `index.ts` | `CrimeScene→SceneResidue`(+JSON/Template), поля `crimeType→sceneType`/`perpetratorId→actorId`/`victimId→affectedId`, `processKill→processAgentDeath`, `markCrimeScene→markSceneResidue`, `createCrimeScene→createSceneResidue`, `crimeScenes→sceneResidues`, `bodyDiscoveries→deathDiscoveries`, callbacks `onMurder→onAgentDeath`/`onCrimeScene→onSceneResidue`/`onCrimeEvent→onEmitEvent`, `crimeEvent→emittedEvent`, `TickResult.murder→death/crimeScene→sceneResidue`, const `CRIME_SCENE_TEMPLATES→SCENE_RESIDUE_TEMPLATES`, BeliefCreator/MemoryBuilder params, файл переименован. Убраны backward-compat алиасы из index. Client/server-msg `crime:scene`+`crimeType` — game/wiring-слой (не движок), оставлен; payload-ключи `perpetratorName/affectedName` — graceful-degrading residual | naming leak | ✅ |
| **A10+A4b** | PlayerJournal + accusation/evidence-presentation подсистема в движке | `journal.ts`, `il.ts` (PresentedEvidence/ConversationSession/AccusationContext/buildAccusationContext/buildAccusationPrompt/processEvidencePresentation + accusation-ветка в applyDialogueMeaning), `world.ts` (journal field/save/auto-obs) | **⏸ ОТЛОЖЕНО** — turn-key дизайн ниже; требует live investigate→accuse прогона | minor (journal) / major (accusation prose) | ⏸ |

**Borderline (нейтрализуется только проза-коммент, механика — универсальная психология, не трогаем мат):**
`al.ts:430` moodCurve коммент «more crime-prone»; `volition.ts:488-497` DUTY-blocks-talk проза. Instinct
RESISTANCE/TEXTURE registry-ификация (`instinct-builder.ts`) — это **gap/enhancement** (нужен новый registry,
проза — универсальная moral-friction), отложено в Phase B, НЕ часть A.

## A10+A4b — turn-key дизайн извлечения (для отдельной сессии с live-прогоном)

**Почему отложено:** это ~300 строк, монолитная подсистема, завязанная на player-chat hot-path И save/load
(INV-21 boot). Эксперт-карта (`docs/workflow` senior-reviewer) оценила риск MEDIUM, 3 high-blast точки:
(1) перенос владения journal в save (`world.ts:108/142/1776/1828`), (2) hot-path auto-obs запись
(`world.ts:1324-1333`), (3) ширина контекста generic-хука. PlayerJournal-класс **0 engine-импортов**
(чистый перенос); IL-сторона удаляется чисто; политика (`registerAccusationResponseHandler`) уже registry.
Клиентский wire-контракт (`{type:'chat', evidenceIds}` + `/api/journal*`) — server-side, НЕ трогается.
Журнал — **MINOR** утечка (non-blocking, инертна в no-crime мире). Требует живого investigate→accuse прогона.

**Дизайн (server-owns-journal):**
1. **Crime-модуль** `crime-justice/investigation.ts`: перенести verbatim `PlayerJournal`+`JournalEntry`+`CaseSummary`
   (из engine `journal.ts`) + `PresentedEvidence`+`ConversationSession`+`AccusationContext`+`computeTrustBonus`+
   `buildAccusationContext`+`buildAccusationPrompt`+`processEvidencePresentation` (из `il.ts`) + accusation-policy
   (инлайн из `index.ts:130-144`) + reimpl `findAgentByName`. Экспорт `registerInvestigationModule()` →
   `registerDialogueEffectHandler((meaning, ctx) => [...evidenceSections, ...accusationSections])`.
2. **Движок** `il.ts`: добавить `DialogueEffectHandlerFn` + `registerDialogueEffectHandler`/`getDialogueEffectHandlers`.
   `ILEffectContext`: `playerJournal?:unknown`, `presentedEvidence?:unknown[]`, `chatSession?:unknown` (generic; модуль
   кастует). В `applyDialogueMeaning` заменить evidence-call(717) + accusation-ветку(771-872) на dispatch хука
   (после claims). Удалить перенесённый код + accusation-response registry + exports (index.ts:189-190). Удалить `journal.ts`.
3. **Движок** `world.ts`: убрать `journal:PlayerJournal` field + import + `onJournalEntry`; добавить opaque
   `playerState:Record<string,unknown>` (round-trip в toJSON/loadState; `WorldSaveData.playerState`) + callback
   `onPlayerObserve?({text,locationId,gameDay,tick,relatedNpcs})` (заменяет auto-obs запись 1324-1333).
4. **Server**: владеет `journal=new PlayerJournal()` (из модуля); `world.journal`→`journal` (server.ts + routes.ts,
   проброс в route-фабрику); `onPlayerObserve`→`journal.addObservation`+broadcast; в save-блоб (index.ts:262) добавить
   `journal:journal.toJSON()`, при загрузке `PlayerJournal.fromJSON(savedData.journal)`; зарегистрировать
   `registerInvestigationModule()`; передавать `playerJournal: journal` в ILEffectContext.
5. **Тесты**: save round-trip журнала; accusation combinedScore/quality; dialogue-effect хук вызывается с нужным
   контекстом; existing save-load + boot-smoke зелёные. **Live**: investigate→accuse прогон (LM Studio).
   Промпт-строки переносятся **byte-identical** → LLM-поведение неизменно по построению.

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

## Verification — РЕЗУЛЬТАТ (выполнено)
- ✅ После КАЖДОГО шага: `bunx tsc --noEmit` == 0, `bun test` зелёный. Итог: **222/222** (210 базлайн + genre-neutrality guard + Economy Module Test).
- ✅ `clwa-auditor` на полный дифф Phase A: **95%** — import-граница INV-14 PERFECT, INV-08/09/10/12/17 целы,
  все blocking/major утечки устранены. Найденный 1 BUG (TickResult.crimeType) + naming-debts (D1–D6) — устранены.
- ✅ **Re-probe module-sufficiency** (`docs/workflow/engine-self-sufficiency/2026-05-29-722c8d77/`):
  **7/10 → 8.5/10** occasional-engine (high end, bordering module-only). **Blocking leaks 2→0** (source-verified).
  Per-genre: trading 8.5 (93%), court-romance **9** (92%), static-recount **9** (97%). 8.5 weighted floor задан
  целиком отложенной A10+A4b подсистемой (~191/455 crime-vocab в journal.ts+il.ts за crime-only гейтами).
  Два не-deferred остатка (volition.ts debug-gate, `wantedSubjects`) — дренированы сразу после прогона →
  не-deferred поверхность движка теперь без genuine-утечек.
- ✅ Permanent **genre-neutrality regression guard** (`tests/architecture.test.ts` → "Engine Semantic Neutrality"):
  падает, если crime-проза вернётся в engine-строки или если переименованные примитивы (CrimeScene/processKill/
  onMurder/'rumor'/typed capability flags) реинтродуцируются. journal.ts+il.ts исключены (deferred).
- ⏳ Live (LM Studio): прогон crime-флоу (kill→investigate→arrest→sentence) — **остаётся** (gated на запуск сервера +
  LM Studio пользователем). A1–A9 behavior-identical по построению (registry-делегация + verbatim-проза в модуле).

## Что НЕ делается в Phase A (осознанно)
- Новые capability-субсистемы (scalar-attribute, inventory, factions) — это **Phase B**
  (`SPEC-engine-generalization.md`), проектируются на уже чистой базе.
- Удаление capability как таковой — запрещено: каждая утечка генерализуется (registry+модуль), не вырезается.
