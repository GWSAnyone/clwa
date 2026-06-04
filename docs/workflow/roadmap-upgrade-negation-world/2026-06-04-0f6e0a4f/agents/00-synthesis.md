## Синтез детального роадмапа «Отрицание / Relict»

Прочитал текущий роадмап + ключевые файлы (CONCEPT §2/§4.5–4.7/§6.4/§6.6/§8/§9, _Metaplot_SPOILERS, _Object-Layout, Dashboard) и подтвердил по диску критические факты:
- **_Cast-Relationship-Matrix.md и player-template досье физически ОТСУТСТВУЮТ** (cast-depth-3 / missed-1 верны).
- **M8/M9 = только спеки, не код.** SPEC-affordance-modifier §94: `validatePlayerAction` — мёртвый код, ноль live-вызовов; PHASE 4 (player-execution-эмиссия `onActionExecuted`) не приземлена. SPEC-personality-plasticity PHASE 4 ждёт того же. Значит ВЕСЬ engine-bridge стоит на не-построенном фундаменте (missed-4 верен) → ввёл явный gate **EB-0**.
- **`strengthScale` имеет только `fromSelfBelief`/`fromSentimentToTarget`/`fromAttribute`** — НЕТ `fromAttention` (engine-bridge-6 gap реален; дефолт = deferred-stub через `fromAttribute`).
- **§4.7 = скелет + ОДИН пример** (пулы пусты — design-loops-1 верен). §8 «Открыто» = 3 пункта (имя мира, пулы §4.7, планировка) — мех-семена нигде не залогированы.

Применил 9 merges (7 из критика-А + 4 из критика-Б, с дедупом), переписал 12 generic-флагов в конкретику с выписанными полюсами решений, влил 14 missed-items (9+10 с дедупом). Каждый пункт получил: статус/приоритет/усилие/зависимости/целевой файл/под-шаги.

**Главные структурные швы, которых не было ни в одной ветке** (теперь отдельные пункты): игрок-как-артефакт (PL-1), спойлер-leak-gate (X-1), M8/M9-impl-блокер (EB-0), Quies-владелец (EB-5), dual-ownership пулов §4.7 (привязка design-loops-1↔EB-7), save/load-контракт (EB-8), Dashboard как 3-й трекер (правило housekeeping).

**Приоритезация:** 3.1 reveal-каскад (MR-1 каскад×M-C, MR-2 буквальность DEESSE) = ближайший P0, как требует рубрика. Параллельно P0-housekeeping в Tensions (T-09..T-13 уже сидят на реальных Hooks).

