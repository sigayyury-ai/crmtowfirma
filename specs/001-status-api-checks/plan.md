# Implementation Plan: System Status API Coverage

**Branch**: `001-status-api-checks` | **Date**: 2025-11-10 | **Spec**: `specs/001-status-api-checks/spec.md`  
**Input**: Feature specification from `specs/001-status-api-checks/spec.md`

**Note**: План описывает расширение блока «Статус системы» за счёт автоматических health-check'ов для всех интеграций, включая SendPulse и Stripe, с соблюдением конституционных гейтов.

## Summary

Обновляем мониторинг интеграций, чтобы операторы видели единый список API (wFirma, Pipedrive, планировщик проформ, SendPulse, Stripe) с актуальным состоянием, последними успешными/неуспешными проверками и индикатором устаревших данных. На бэкенде появится реестр health-check'ов с фиксированной периодичностью, ручным обновлением и журналированием результатов; фронтенд переходит с разрозненных вызовов на единый endpoint и перерисовывает карточки статуса с развернутым контекстом ошибок.

## Technical Context

**Language/Version**: Node.js 18.x (Render) + Vanilla JS фронтенд  
**Primary Dependencies**: `express`, `axios`, `node-cron`, кастомные клиенты Pipedrive/wFirma/SendPulse, ⚠️ добавить `stripe` SDK (server-side only)  
**Storage**: In-memory state в сервисе статусов; долговременное хранилище не требуется  
**Testing**: Jest (unit для health registry), supertest (API), manual smoke UI + scripted check-apis  
**Target Platform**: Backend API на Render, статический dashboard на Render CDN  
**Project Type**: Web (monorepo: backend + статический frontend)  
**Performance Goals**: Health-check цикл ≤ 2 с на вызов; UI обновление < 500 мс; не блокировать основной поток обработки счетов  
**Constraints**: Не логировать секреты; уважать rate limits внешних API (особенно Stripe); health-check не должен создавать/менять данные  
**Scale/Scope**: 5 интеграций в статусе, опрос каждые 5 мин (можно конфигурировать), до 5 операторов одновременного просмотра

## Constitution Check

| Principle | Status | Notes |
|-----------|--------|-------|
| Invoice Data Fidelity | ✅ | Мониторинг только читает статусы, не затрагивает поток проформ. |
| Reliable Automation Flow | ⚠️ | Нужно подтвердить, что periodic checks не мешают cron-процессам и фиксируют retriable ошибки планировщика. Гейт: задокументировать guardrails для тайм-аутов и параллельных запусков registry (Phase 0 deliverable). |
| Transparent Observability | ⚠️ | Требуется структурированное логирование health-check результатов (без секретов), + surfaced failure summaries в API. Гейт: финализировать формат логов/ответов до начала реализации. |
| Secure Credential Stewardship | ⚠️ | Новые проверки используют SendPulse и Stripe ключи — необходимо гарантировать отсутствие утечек в логах/ответах, обновить `env.example` с безопасными placeholder'ами. Гейт: ревизия переменных окружения/маскировки. |
| Spec-Driven Delivery Discipline | ✅ | Спецификация актуальна, чеклист заполнен, план следует workflow. |

## Project Structure

### Documentation (this feature)

```text
specs/001-status-api-checks/
├── plan.md              # Этот файл
├── research.md          # Phase 0: протоколы health-check, тайм-ауты, логирование
├── data-model.md        # Phase 1: структура ApiEndpointStatus
├── quickstart.md        # Phase 3: инструкция для операторов по статус-блоку
├── contracts/           # Phase 1: JSON contract system-status API
└── tasks.md             # Будет создано через /speckit.tasks
```

### Source Code (repository root)

```text
src/
├── index.js                        # Регистрируем health registry при старте
├── routes/
│   ├── api.js                      # Подключаем system-status endpoints
│   └── status.js                   # (new) Router для health-check API
├── services/
│   ├── status/
│   │   ├── healthRegistry.js       # (new) Инфраструктура периодических проверок
│   │   └── checks/
│   │       ├── pipedriveCheck.js   # (new) Адаптеры для конкретных API
│   │       ├── wfirmaCheck.js      # (new)
│   │       ├── schedulerCheck.js   # (new)
│   │       ├── sendpulseCheck.js   # (new)
│   │       └── stripeCheck.js      # (new)
│   ├── sendpulse.js                # Переиспользуем для тестов подключения
│   └── stripe/
│       └── client.js               # (new) Лёгкий обёртка/health call
├── utils/
│   └── logger.js                   # Убедиться, что маскирование покрывает новые логи

frontend/
├── index.html                      # Расширить блок статуса, добавить карточки API
├── script.js                       # Переписать refresh на новый endpoint, UI формат
└── style.css                       # Акценты для degraded/stale статусов

tests/
├── unit/
│   └── status/
│       └── healthRegistry.test.js  # (new) Юнит-тесты логики статусов
└── integration/
    └── statusRoutes.test.js        # (new) supertest покрытие API
```

**Structure Decision**: Добавляем изолированный модуль `services/status` с адаптерами под каждую интеграцию, чтобы health-check логика не расползалась по существующим сервисам. Отдельные роуты позволяют версионировать contract без засорения `api.js`. Stripe клиент выносим в `services/stripe` для последующих фич (перекликается с планом `001-stripe-event-report`).

## Implementation Strategy

### Phase 0 — Research & Monitoring Design
1. Уточнить cadence (по умолчанию 5 минут) и freshness window для stale-состояния; описать это в `research.md`.
2. Задокументировать формат `ApiEndpointStatus`: поля, enum статусов (`operational`, `degraded`, `down`, `stale`), структура failure summary.
3. Определить тайм-ауты и политику повторов для каждого API: SendPulse (OAuth + ping), Stripe (balance или `/v1/charges` with limit=1, один retry), wFirma/Pipedrive (существующие клиенты).
4. Согласовать с Observability гейтом формат логов (JSON с `healthCheckId`, `status`, `durationMs`, `errorCode`) и правило маскировки чувствительных данных (ключей/ID) в logger.
5. Провести секретный аудит: какие env переменные требуются (`SENDPULSE_*`, `STRIPE_SECRET_KEY`), обновить `env.example` placeholders (без реальных ключей) и описать требуемые переменные в `research.md`.

### Phase 1 — Backend Health Registry
1. Реализовать `healthRegistry`:
   - Регистрация чеков с параметрами `id`, `label`, `freshnessMs`, `run` (async).
   - Хранение snapshot: `status`, `lastCheckedAt`, `lastSuccessAt`, `lastFailureAt`, `failureSummary`, `durationMs`.
   - Планировщик (`setInterval` или `node-cron`) с защитой от параллельных запусков; логировать start/finish.
   - Метод `refreshAll({force})` для ручного запуска.
2. Адаптеры чеков:
   - `pipedriveCheck`: вызывает `pipedriveClient.testConnection()`, парсит пользователя/компанию.
   - `wfirmaCheck`: использует существующий `testConnection`, обрезает payload до безопасных полей.
   - `schedulerCheck`: дергает `scheduler.getStatus()`, помечает `degraded`, если `isScheduled=false` или `lastRunAt` старше ожидаемого.
   - `sendpulseCheck`: инициализирует клиента в try/catch (если нет кредов — `stale` с actionable message), вызывает `testConnection`.
   - `stripeCheck`: новый `StripeClient.healthPing()` (GET `/v1/balance` или `GET /v1/events?limit=1`); ошибки классифицировать по HTTP status (401 → degraded + credential hint).
3. Интегрировать registry в `src/index.js`: инициализация при старте сервера, graceful shutdown.
4. Добавить structured logs через `logger.info/ error` с маскированием (использовать `logSanitizer` при необходимости).

### Phase 2 — API Surface
1. Создать `src/routes/status.js`:
   - `GET /api/system/status` — возвращает список `ApiEndpointStatus` + метаданные (`updatedAt`, `refreshInProgress`).
   - `POST /api/system/status/refresh` — запускает `refreshAll(force=true)`, возвращает обновленный snapshot, защищает от concurrent refresh (409 если уже идёт).
2. Подключить роутер в `api.js`, добавить auth middleware, если требуется (сейчас операторский UI без auth).
3. Расширить contract в `specs/001-status-api-checks/contracts/system-status.md` (Phase 1 deliverable) — JSON структура, коды ошибок.

### Phase 3 — Frontend Update
1. Обновить `frontend/index.html`: 
   - Расширить сетку статусов до списка карточек (5 row, adaptable).
   - Добавить отображение `lastSuccess`, `lastFailure`, `stale` бейдж.
2. Переписать `script.js`:
   - `refreshSystemStatus` → запрос `/api/system/status`.
   - Новая кнопка «Перезапустить проверку» → `POST /api/system/status/refresh`.
   - Render severity цветов: operational=green, degraded=amber, down=red, stale=grey/striped.
   - Показ actionable message (error summary, recommended action из registry).
3. Уточнить логирование в UI (logs-section): добавлять записи с результатами обновления статуса.
4. Настроить авто-обновление (polling) каждые 5 минут без конфликтов с manual refresh.

### Phase 4 — Testing & Documentation
1. Написать unit-тесты для registry (успех, ошибка, stale по времени, предотвращение параллельных запусков).
2. Написать integration-тесты (`supertest`) для GET/POST endpoints с моками регистра, проверка кодов 200/202/409.
3. Ручной сценарий: отключить креды SendPulse/Stripe и убедиться, что UI отображает degraded + actionable message.
4. Обновить `research.md`/`quickstart.md`: как интерпретировать статусы, где смотреть логи, как менять freshness.
5. Обновить `scripts/check-apis.js`, чтобы переиспользовать новые чек-функции (опционально, но рекомендуется для parity).

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Health-check перегружает внешние API (rate limit) | Потенциальные блокировки аккаунтов | Настроить экспоненциальные интервалы при ошибках, ограничить concurrency, использовать lightweight endpoints (`balance`, `testConnection`). |
| Отсутствующие креды приводят к постоянным ошибкам | Шум в UI, операторы путаются | Явно помечать `down` с причиной «credentials missing» и подсказкой по .env, не пытаться ретраить до исправления. |
| Логи случайно содержат токены | Нарушение Secure Credential Stewardship | Маскировать все входные данные, использовать `sanitizeValue` перед логированием, добавить unit-тест на маскирование. |
| Registry зависает (promise never resolves) | UI показывает stale/down по всем API | Ввести hard timeout (AbortController) и watchdog, логировать превышения. |
| Расхождение UI и API форматов | Операторы видят некорректные статусы | Зафиксировать JSON contract, покрыть supertest + UI smoke, использовать TypeScript типы в будущем (отражено как пожелание). |

## Testing Plan

1. **Unit**: `healthRegistry.test.js` — успешный run, ошибка с failureSummary, stale transition, двойной refresh → второй отклоняется с `skipped`.
2. **Integration**: `statusRoutes.test.js` — mock registry, проверить `GET` (200, payload shape) и `POST` (202 + follow-up `GET`, 409 при повторе).
3. **Manual/API Smoke**:
   - Выполнить `POST /api/system/status/refresh` и подтвердить обновление UI.
   - Инвалидировать SendPulse креды → убедиться, что статус `degraded` с actionable message.
   - Временно остановить cron планировщик (toggle env) → статус `scheduler` показывает degraded/down.
4. **Regression**: Запустить `scripts/check-apis.js` (после обновления) для сверки ответов; UI кнопки Polling/Operations продолжают работать.

## Release Criteria

- Все 5 интеграций отображаются в статус-блоке с обновлением < 5 минут и корректными таймстампами.
- Health registry логирует каждую проверку (`info` + `error`) без утечки секретов (проверено ревью + manual grep).
- UI демонстрирует деградацию (ручной тест: выключенные креды) и stale (> freshness window) по ожидаемым сценариям.
- Документация (`research.md`, `quickstart.md`, contracts) обновлена, операторы понимают, как интерпретировать статусы.
- Jest/unit и supertest проходят; ручные проверки зафиксированы в релизных заметках.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |
