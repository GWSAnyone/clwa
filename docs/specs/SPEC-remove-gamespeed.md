# SPEC: Remove gameSpeed Mechanic — Fixed Clock + autoTick Run/Stop

> **Milestone**: M4 (Complete Session) — follow-up к position-movement
> **Status**: **✅ COMPLETE** (v0.15.1). Механика `gameSpeed` удалена целиком; Master Clock — фиксированный интервал (1 игровая минута / реальная секунда), старт/стоп только через autoTick (`start/stopMasterClock`). tsc 0, 210/210 тестов, 0 ссылок `gameSpeed` в коде. Живой прогон подтвердил: лог `[MasterClock] Started (1 game-min/sec)`, autoTick стоп→старт (paused→running), `/api/auto-state` и `/api/time` без поля `gameSpeed`.
> **Depends on**: SPEC-position-movement (v0.15.0)
> **Engine changes**: удалены `WorldConfig.gameSpeed`, `World._gameSpeed`/getter/save-load; интервал часов фиксирован.
> **Created**: 2026-05-29
> **Implemented**: 2026-05-29 (commit v0.15.1)
> **Completed**: 2026-05-29 (живой прогон: фикс-cadence часов + autoTick run/stop подтверждены, gameSpeed отсутствует в API)

---

## Цель

Убрать `gameSpeed` — он плохо ложится в LLM-управляемый мир и является лишней гибкостью без ценности.

## Почему

`gameSpeed` смешивал **два** разных понятия, и оба проблемны:

1. **Пауза (`gameSpeed=0`)** — **избыточна**. Старт/стоп часов уже делает **autoTick**: `POST /api/auto` → `world.startMasterClock()`/`stopMasterClock()`. `_gameSpeed <= 0` в тике был вторым, дублирующим путём паузы.
2. **Множитель (`1/2/3`)** — **плохо ложится в LLM-мир**. Часы тикали `1000/gameSpeed` мс, то есть на 3x просто чаще дёргался volition → **×3 частота LLM-вызовов** (упор в throughput/лимиты, а не в «скорость мира»); game-минутные кулдауны истекали втрое быстрее в реальном времени → искажался весь pacing; и это был источник client/server рассинхрона (P4 из position-movement). В мире, где темп задаёт скорость мышления LLM, «перемотка» физически не делает мир быстрее.

UI-контрол скорости был удалён ещё раньше (`syncSpeedButtons` стал no-op), эндпоинта смены скорости не было — то есть `gameSpeed` уже фактически всегда равнялся 1. Эта спека убирает оставшуюся вестигиальную обвязку.

## Что сделано

| Слой | Изменение |
|------|-----------|
| **engine `world.ts`** | удалены `_gameSpeed` поле/`gameSpeed` getter/ctor-присваивание/save-load; `startMasterClock` → фикс `setInterval(…, 1000)` (убрана проверка `<=0` — стоп через `stopMasterClock`); из save-state JSON убрано `gameSpeed` |
| **engine `world-types.ts`** | удалены `WorldConfig.gameSpeed` + `DEFAULT_WORLD_CONFIG.gameSpeed`; из комментария `goalStuckMinutes` убран caveat «at gameSpeed > 1» |
| **server** | `gameSpeed` убран из `/api/time`, `/api/auto-state`, `POST /api/auto`, `time_update` broadcast, `world-loader` (`WorldJson.config.gameSpeed`) |
| **client `game.js`** | dead-reckoning — просто `walkSpeed` (без `× gameSpeed`); HUD `#hud-speed` теперь показывает `running`/`paused` по autoTick; удалён no-op `syncSpeedButtons` + его вызовы; `state.gameSpeed` убран |

**Run/stop сохранён** через autoTick (`POST /api/auto`) — единственный контроль часов. Для ручного шага остаются `/api/tick` + `/api/day`.

## Что НЕ делалось (осознанно)
- Пауза как отдельный флаг **не вводилась** — autoTick (стоп часов) её полностью закрывает.
- Перемотка (fast-forward) **не сохранена** — в LLM-симе она бессмысленна (упирается в latency LLM), для тестов есть ручной tick/day.

## Тест
1. Сервер стартует, часы идут на 1 игр-мин/сек (лог `[MasterClock] Started (1 game-min/sec)`).
2. `POST /api/auto` останавливает и запускает часы; HUD показывает `paused`/`running`.
3. NPC движется с постоянной скоростью (нет множителя). Live-прогон — при включённом LM Studio.
4. Регресс: `grep gameSpeed packages/**` = 0; tsc 0; `bun test` зелёный.
