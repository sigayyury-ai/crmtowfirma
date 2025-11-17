## Phase 0 Research Notes

### 1. Timezone and Cron Strategy
- Current implementation (`src/services/scheduler.js`) uses `node-cron@3.0.3` with explicit `timezone: 'Europe/Warsaw'` per job. Render containers run on UTC (confirmed in previous deployments); `node-cron` respects the provided timezone when native ICU data is available in Node 18 (present by default).
- Target schedule: один запуск в час на отметке `HH:00`. Выражение `0 * * * *` с `timezone: 'Europe/Warsaw'` даёт полуночный старт и далее каждый час.
- Guardrail: при рестарте контейнера cron-задача активируется сразу. Чтобы покрыть сценарий «пропущен >1 час», добавим проверку `lastRunAt` и, при необходимости, немедленный запуск после инициализации.

### 2. Текущее состояние API и UI
- API (`src/routes/api.js`):
  - Эндпоинты `/api/invoice-processing/start` и `/stop` дергают `scheduler.start()/stop()`; для новой модели они становятся Legacy и должны быть удалены.
  - `/api/invoice-processing/status` возвращает поля `isRunning`, `jobsCount`, `schedule`, `nextRuns` — без истории и retry-флагов.
  - `/api/invoice-processing/run` остаётся основным ручным polling (POST).
  - Нет эндпоинта для истории запусков; придётся добавить `GET /api/invoice-processing/scheduler-history` + расширить `status` (например, `lastRun`, `nextRun`, `retryScheduled`).
- UI (`frontend/index.html` и `frontend/script.js`):
  - Блок «Планировщик» содержит кнопки старт/стоп/обновить; JS привязан к `/start`/`/stop`.
  - Табло статуса опирается на старые поля (`jobsCount`, список расписаний).
  - В разделе «Ручная обработка» уже есть кнопка polling — сохраняем.
  - Нет виджета истории; потребуется новый контейнер и JS для периодического fetch истории.

### 3. Журнал запусков (`SchedulerRun`)
- Минимальный набор, покрывающий требования спецификации:
  ```json
  {
    "id": "<uuid|timestamp>",
    "startedAt": "<Date>",
    "finishedAt": "<Date|null>",
    "durationMs": "<number|null>",
    "status": "success|error|skipped|retry-scheduled",
    "processed": {
      "total": 0,
      "successful": 0,
      "errors": 0,
      "deletions": 0
    },
    "errors": ["..."],
    "message": "summary string",
    "trigger": "cron|retry|manual",
    "retryAttempt": 0
  }
  ```
- Храним in-memory `runHistory` (кольцевой буфер на 48 записей ≈ 2 суток) + логируем каждую запись через Winston (`logger.info/error`).
- Методы:
  - `recordRunStart(trigger)` → возвращает объект записи и mutates `this.currentRun`.
  - `recordRunFinish(result)` → обновляет запись, пушит в `runHistory`, поддерживает размер.
  - `getRunHistory()` → копия массива для API/фронта.

### 4. Retry Policy (FR-007)
- Базовая логика:
  1. Cron запускает `runCycle({ trigger: 'cron', retryAttempt: 0 })`.
  2. При `success === false` планировщик ставит `setTimeout` на 15 минут (`this.retryTimeout`) и отмечает `retryScheduled: true`.
  3. Retry вызовет `runCycle({ trigger: 'retry', retryAttempt: previous + 1 })`, но не более 1 попытки в час (reset при следующем cron).
  4. Если retry успешен — логируем отдельную запись с `status: 'success'` и `trigger: 'retry'`.
  5. Если retry проваливается — помечаем `status: 'error'`, `retryScheduled: false`, дублируем ошибку в логах.
- Параллельные запуски: `this.isRunning` и отдельный `this.pendingRetry` защитит от двойного старта. Cron при активном запуске записывает `status: 'skipped'` и завершает без обработки.

### 5. Outstanding Questions / Follow-ups
- Стоит ли сохранять историю в Supabase? Спека допускает in-memory + логи, поэтому переносим в backlog.
- Нужно уточнить у команды, достаточно ли одного retry (спека говорит «не менее одной попытки»); пока планируем 1 повтор через 15 минут.
- Для UI предупреждений: надо определиться с визуальным маркером (баннер/иконка). Решим при обновлении `frontend/script.js`.






