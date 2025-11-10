# Implementation Plan: Hourly CRM Scheduler

**Branch**: `001-hourly-scheduler` | **Date**: 2025-11-09 | **Spec**: `specs/001-hourly-scheduler/spec.md`  
**Input**: Feature specification from `specs/001-hourly-scheduler/spec.md`

**Note**: This plan aligns with the Spec Kit workflow and will guide subsequent `/speckit.tasks` and `/speckit.implement` phases.

## Summary

Автоматизировать запуск поиска CRM-триггеров каждые 60 минут, сохранив возможность ручного polling и убрав из интерфейса элементы управления планировщиком. План включает обновление `SchedulerService`, пересмотры API маршрутов, переработку UI мониторинга и расширение логирования, чтобы соответствовать принципам Reliable Automation Flow и Transparent Observability.

## Technical Context

**Language/Version**: Node.js 18.x (Render)  
**Primary Dependencies**: Express, node-cron, Winston logger, Supabase client  
**Storage**: Supabase (реестр проформ), in-memory журнал запусков (расширяется в рамках задачи)  
**Testing**: Jest unit-тесты (scheduler), manual smoke в staging UI, журнал логов Render  
**Target Platform**: Backend (Render container) + Web UI (operator dashboard)  
**Project Type**: web (single repo: backend + vanilla frontend)  
**Performance Goals**: Запуск планировщика ≤ 3 мин на проход; UI обновляется < 1 c  
**Constraints**: Нельзя нарушить существующий manual polling; соблюдение конституционных принципов логирования  
**Scale/Scope**: До 1 запуска/час, ~50 CRM триггеров/сутки, 3-5 операторов мониторинга

## Constitution Check

- **Invoice Data Fidelity**: Планировщик вызывает существующий пайплайн, который уже гарантирует корректность данных. ❗ Требование: не изменять последовательность работы `InvoiceProcessingService`. → ✅ при сохранении текущих вызовов.
- **Reliable Automation Flow**: Автозапуск должен быть идемпотентным, с блокировкой параллельных запусков и повторной попыткой при сбое. → В план включены guardrails (см. Этап 1, 2).
- **Transparent Observability**: Нужно логировать каждый запуск и ошибку, плюс вывести статистику в UI. → Добавлены требования к журналу и API.
- **Secure Credential Stewardship**: Новых секретов не требуется; важно не логировать токены. → Соблюдается при использовании существующего logger.
- **Spec-Driven Delivery Discipline**: Спека утверждена, чеклист заполнен. План соответствует workflow. ✅

Гейты пройдены при условии реализации журналирования запусков и блокировки параллельных cron-задач.

## Project Structure

### Documentation (this feature)

```text
specs/001-hourly-scheduler/
├── plan.md              # Этот файл
├── research.md          # TBD: cron guardrails, Render timezone, retry policy
├── data-model.md        # TBD: SchedulerRun, TriggerScanResult
├── quickstart.md        # TBD: как мониторить часовой планировщик
├── contracts/           # TBD: описание обновлённого API мониторинга
└── tasks.md             # Будет создано через /speckit.tasks
```

### Source Code (repository root)

```text
src/
├── index.js                     # Автостарт планировщика при запуске приложения
├── routes/
│   └── api.js                   # Удалить start/stop endpoints, обновить мониторинг
├── services/
│   ├── scheduler.js             # Переписать под ежечасный cron, журнал запусков
│   ├── invoiceProcessing.js     # Проверить совместимость с новым режимом
│   └── payments/                # Без изменений (manual polling сохраняется)
├── utils/
│   └── logger.js                # Убедиться, что логи покрывают новые события
frontend/
├── index.html                   # Убрать кнопки планировщика, оставить мониторинг
├── script.js                    # Обновить fetch статуса/истории без start/stop
└── style.css                    # При необходимости подчистить стили панелей

scripts/
└── check-apis.js                # Опционально обновить smoke-проверку статуса

tests/
└── unit/
    └── scheduler.test.js        # Добавить тесты блокировки и расписания
```

**Structure Decision**: Работа ограничивается существующим backend и статическим frontend. Новых проектов не создаём; расширяем `SchedulerService`, `api.js`, фронтовый dashboard и модульные тесты.

## Implementation Strategy

### Phase 0 — Research & Design
1. Подтвердить таймзону: Render использует UTC; cron выражение будет `0 * * * *` с учётом нужного смещения (план → Europe/Warsaw). Решить: использовать часовой cron с timezone или собственный setInterval.
2. Проанализировать текущее состояние UI (`frontend/index.html`, `frontend/script.js`) и API (`/api/invoice-processing/*`). Составить список элементов, которые нужно удалить/заменить.
3. Спроектировать структуру журнала запусков: в памяти (массив фиксированной длины) или Supabase. Решение: для V1 достаточно in-memory c бэкапом в логах; задокументировать предел (≥24 записей).
4. Уточнить retry policy: минимум одна повторная попытка в течение часа → разработать алгоритм (например, retry через setTimeout на 10 минут).

### Phase 1 — Backend Updates
1. **Cron переписываем на ежечасный**:
   - Заменить три отдельные задачи на одну cron-задачу `cron.schedule('0 * * * *', ...)` с timezone `Europe/Warsaw`.
   - Добавить флаг выполнения, чтобы второй запуск пропускался, если предыдущий не завершён.
2. **Журнал запусков**:
   - Создать структуру `this.runHistory` (массив объектов `{ startedAt, finishedAt, durationMs, status, processed, errors, message }`).
   - Ограничивать длину (например, 48 записей) и предоставлять метод `getRunHistory()`.
3. **Обработка ошибок/ретраи**:
   - Если `runInvoiceProcessing` вернул `success: false`, запланировать повтор через `setTimeout` (например, 15 минут) при условии, что retry ещё не выполнялся.
   - Логировать все кейсы через Winston с тегами `scheduler`.
4. **API обновления**:
   - Удалить/деактивировать маршруты `POST /api/invoice-processing/start|stop|run`? (Start/stop точно убрать; `run` оставить как ручной polling? Спека говорит удалить ручной запуск планировщика, но оставить manual polling. Значит удаляем `/start` и `/stop`, сохраняем `/run` и `/queue`/`pending`.)
   - Добавить новый маршрут `GET /api/invoice-processing/scheduler-history` возврат `runHistory`.
   - Обновить `GET /api/invoice-processing/status` чтобы отражать `isRunning`, `lastRun`, `nextRun`, `retryScheduled` без кнопок.
5. Обновить `index.js`, чтобы планировщик стартовал автоматически без проверок UI-кнопок.

### Phase 2 — Frontend Updates
1. Удалить HTML-блок кнопок «Запустить/Остановить/Обновить статус» и статус-карточку.
2. Добавить виджет «Журнал автоматических запусков»: таблица с колонками `Время старта`, `Длительность`, `Статус`, `Обработано`, `Ошибки`, `Комментарий`.
3. Настроить периодическое обновление истории (polling каждые 60 секунд) через новый API endpoint.
4. Сохранить блок ручного polling (кнопка и визуальные подсказки), уточнить тексты, что планировщик выполняется автоматически каждый час.
5. Обновить стили: удалить классы, связанные с кнопками планировщика.

### Phase 3 — Testing & Validation
1. Unit-тесты для `scheduler.js`: проверка, что второй запуск не стартует при активном первом; что истории не превышают лимит; что retry планируется.
2. Manual smoke на стейдже:
   - Дождаться автоматического запуска (можно временно сократить интервал до 1 минуты под флагом env для теста).
   - Проверить UI отображение истории и отсутствие кнопок.
   - Запустить ручной polling и убедиться, что cron не меняет расписание.
3. Просмотреть логи Render: подтверждение сообщений о запуске/завершении, наличие ошибок.
4. Проверить, что API `/start|stop` недоступны (возвращают 404/410 или удалены).

### Phase 4 — Documentation & Deployment
1. Обновить README/операторскую документацию: описать новый режим, где смотреть историю, как инициировать ручной polling.
2. Добавить раздел в `quickstart.md` с инструкциями по мониторингу запуска.
3. Согласовать с поддержкой, что кнопки исчезнут; получить подтверждение до релиза.
4. План релиза: deploy вне часа, чтобы сразу наблюдать авто-запуск через лог.

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Cron запускает параллельные задачи | Дублирование проформ, нагрузка на CRM | Ввести блокировку и проверку `isRunning`, логировать пропуски |
| Длительный сбой CRM | Планировщик не успевает обработать триггеры | Добавить retry + уведомление в логах, ручной polling как fallback |
| Потеря истории при рестарте контейнера | Отсутствие прозрачности | Историю дублировать в логах; опционально рассмотреть Supabase storage в будущем |
| Пользователи не знают о автозапуске | Лишние запросы в поддержку | Обновить UI тексты и документацию, сделать подсказки |
| Ошибки при удалении API маршрутов | Клиентские скрипты ломаются | Пройтись по фронтенду, убедиться что старые fetch вызовы удалены |

## Testing Plan

1. **Unit**: Jest тесты для `SchedulerService` (проверка cron интервала, истории, retry-флага).
2. **Integration/API**: cURL/Postman проверки новых маршрутов `status`, `scheduler-history`; удостовериться, что `/start|stop` отсутствуют.
3. **UI Smoke**: В браузере проверить, что журнал отображается и обновляется, manual polling работает.
4. **Regression**: Запустить полный pipeline создания проформы (ручной polling) и убедиться, что новая логика не ломает существующие сервисы.

## Release Criteria

- Авто-запуск отрабатывает как минимум 3 цикла на стейдже без ручного вмешательства и ошибок.
- UI отображает не менее 24 записей истории и сообщения об ошибках (смоделированная ошибка фиксируется).
- Логи Render показывают структурированные записи о запуске/завершении и пропусках.
- Документация и quickstart обновлены, операторы подтверждают, что понимают новый процесс.
- Code review подтверждает соответствие конституции (особенно Reliable Automation Flow и Transparent Observability).

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |
