# Workflow run - roadmap-upgrade-negation-world

- Question: deep per-theme analysis -> detailed concrete roadmap (replace generic bullets)
- Run ID: wf_0f6e0a4f-4f4 (RESUMED; first attempt w60u2it51 failed on StructuredOutput non-compliance / net drop -> critics+synth switched to default subagent + synth catch)
- Date: 2026-06-04
- Agents: 15 (12 themes cached + 2 critics + synth) · tokens ~1.14M(run1)+~1.11M(run2) · raw items: 67
- removed/merged generic: 15 · addedConcrete: 62

## Removed / merged generic
- 6 разрозненных housekeeping-проходов (core-mechanics-6 / setting-apparatus-5 / history-calendar-4 / locations-5 / world-name-4 / tensions-cohesion-6) сведены в ЕДИНОЕ правило housekeeping (под-шаг финализации каждой ветки + обязательный sync Dashboard+RESUME+frontmatter), а не 6 отдельных work-items
- derogat-5 «решить вопрос калибровки» переписан в конкретную рекомендацию-дефолт (калибровка однажды при Intake S-01 по симптом-догадке; прибор не обманываем носителем, но staff может перевесить эталон = намеренный мис-файл) — иначе планировщик упёрся бы в «надо подумать»
- setting-apparatus-4 «широта сети» из колеблющегося work/noop переведён в чистый close-as-noop (снять чекбокс + 1 wikilink, новый контент НЕ писать)
- engine-bridge-6 «спроектировать ИЛИ отложить» (две взаимоисключающие ветки без критерия) переписан в decision-gate с дефолтом=deferred-stub (fromAttribute generic key), build только если R-0 входит в первые прогоны (не входит)
- merged cast-depth-4 → authority-4 (оба «кто над Illa/Brevik» в STAFF_S-02 §6)
- merged authority-5 → locations-3 (оба «наблюдательный пост/взгляд системы», locations-3 движковый владелец)
- merged tensions-cohesion-2 → derogat-2 (мис-файл как процедура re-калибровки = одна механика; T-10 — её tension-обёртка)
- merged locations-6 → engine-bridge-3 (co-location-матрица опасных пар = один артефакт; lore-таблица питает движковый ZoneState/getCoPresent)
- merged design-loops-3 → engine-bridge-7 (trigger-reroll-constraints + crystallization сидят на одном пуле)
- merged derogat-3 → engine-bridge-5 (телли ненадёжной стрелки = lore-сторона DEROGAT readout, движок-сторона — EB-5)
- merged design-loops-4 → engine-bridge-7 (end-state накопитель/пороги = тот же crystallization-накопитель; EB-7 = единственный владелец схемы)
- merged core-mechanics-3 → core-mechanics-2 (цена form-гибрида Orin и class-гибрида «оба» — один проход о цене гибридов, 2-й закон Сандерсона)
- merged cast-depth-5(визуал) разнесён: персонажи остаются в cast-depth-5, зоны — в locations-1, но согласован единый 2.5D-формат (не два конкурирующих)
- 4 ветки переизобретали «накопитель дрейфа кристаллизации» (core-mechanics-4 окно / derogat-3 телли / design-loops-4 пороги / engine-bridge-7 ось) → EB-7 назначен ЕДИНСТВЕННЫМ владельцем схемы, остальные ссылаются
- 3 ветки трактовали «карту манифестаций DEROGAT» противоречиво (derogat-1 build / core-mechanics-6 don't-build / engine-bridge-5 consume) → guard CM-6 сделан зависимостью свода D-1 (guard пишется ДО свода, колонка ПРОБЕЛ read-only)

