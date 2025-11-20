# Research Notes: System Status API Coverage

**Feature**: `001-status-api-checks`  
**Date**: 2025-11-10  
**Author**: GPT-5 Codex (Cursor session)  
**Purpose**: Закрыть гейты Phase 0 — определить параметры мониторинга, классификацию статусов, требования к логированию и управлению секретами перед реализацией health registry.

---

## 1. Cadence & Freshness Windows

| Check ID | Default cadence | Freshness window (stale) | Rationale |
|----------|-----------------|--------------------------|-----------|
| `wfirma` | 5 мин           | 15 мин                   | API уже используется в hourly cron → раз в 5 мин даёт раннее обнаружение; stale после 3 пропусков. |
| `pipedrive` | 5 мин       | 15 мин                   | Аналогично wFirma; вызов лёгкий (`/users/me`). |
| `scheduler` | 5 мин        | 10 мин                   | Планировщик должен запускаться ≥ раз в час. Помечаем stale, если опрос не прошёл два цикла; degraded/down рассчитываются по `isScheduled`, `lastRunAt`. |
| `sendpulse` | 10 мин      | 30 мин                   | OAuth токен живёт 1 час. Увеличили интервал, чтобы не злоупотреблять OAuth. |
| `stripe` | 10 мин          | 30 мин                   | Stripe rate limit ~25 req/s, но из соображений безопасности/стоимости хватит 6 проверок в час. |

**Implementation note**: Регистрация health-check'ов позволяет переопределять cadence через конфиг (e.g. `STATUS_CHECK_INTERVAL_MS`). Freshness вычисляется как `now - lastCheckedAt > freshnessWindow`.

## 2. Status Classification

- `operational`: Последний запуск успешен и укладывается в freshness window.
- `degraded`: Запрос завершился ошибкой, но есть надежда на авто-восстановление (HTTP 4xx, 5xx, таймауты). Бэкенд возвращает `failureSummary` с `errorCode`, `httpStatus`, `action`.
- `down`: Не удалось пройти критическую проверку (повторные ошибки > N attempts или критичные коды, например 401 invalid credentials). Для SendPulse/Stripe требуется ручная реактивация.
- `stale`: Проверка давно не выполнялась (`lastCheckedAt` > freshness), даже если предыдущий статус был `operational`.
- `unknown`: начальное состояние. UI подсвечивает серым до первой попытки.

Retries: каждый чек выполняется не более 1 повторной попытки синхронно при таймауте. Если повторная попытка тоже падает, статус `degraded/down` фиксируется, `failureSummary.retryIn` содержит рекомендованный интервал.

## 3. API-specific Health Strategy

| Integration | Request | Timeout | Failure handling | Notes |
|-------------|---------|---------|------------------|-------|
| wFirma | `GET /contractors/find` через существующий клиент (`testConnection`) | 8s | 401/403 → `down` (проверить ключи), 5xx/timeout → `degraded` (+ retry in 5 мин) | Логи уже структурированы; добавить маскировку company_id. |
| Pipedrive | `getUserInfo()` (внутри `testConnection`) | 6s | 401/403 → `down`; 429 → `degraded` + back-off 15 мин; 5xx/timeout → `degraded`. | Добавить в summary email/company только маскированно (e.g. `user.emailMasked`). |
| Scheduler | Вызов `scheduler.getStatus()` | 2s | `isScheduled=false` → `down`; `lastRunAt` > 65 мин → `degraded`; `retryScheduled` true → message «Retry pending до {nextRetryAt}`». | Не вызывает внешние API; нет ретраев. |
| SendPulse | `SendPulseClient.testConnection()` (OAuth + ping) | 10s | Нет кредов → `down` с action «Заполнить SENDPULSE_ID/SECRET»; 401 → `down`; 5xx/timeout → `degraded`, retry через 30 мин. | Клиент генерирует access token; кешируем токен в health registry и переиспользуем до expiry. |
| Stripe | Новый `StripeClient.healthPing()` → `stripe.accounts.retrieve({expand: []})` или `stripe.balance.retrieve()` | 8s | 401/403 → `down`; 429 → `degraded` + back-off 15 мин; 5xx/timeout → `degraded`. | Используем официальный SDK (в plan добавлен dependency). В summary показываем только `livemode`, `available[0].currency` без сумм. |

**Timeout enforcement**: используем `AbortController` или axios timeout (для Stripe SDK — `stripe.setHttpClient` с fetch + timeout). Логи должны фиксировать `durationMs`.

## 4. Logging & Observability

Log schema (JSON репорт через `logger.info`/`logger.error`):

```json
{
  "event": "health.check.result",
  "checkId": "stripe",
  "status": "degraded",
  "durationMs": 217,
  "httpStatus": 401,
  "errorCode": "invalid_api_key",
  "message": "Stripe API rejected credentials",
  "retryInMs": 900000,
  "correlationId": "status-refresh-<uuid>"
}
```

- `logger.info` для старт/успехов, `logger.warn` для degraded, `logger.error` для down.
- Используем `logSanitizer` (см. `src/utils/logSanitizer.js`) перед выводом `details`, чтобы скрывать emails/tokens. Health registry должен отдавать в summary уже освобождённые от PII поля.
- Корреляция: manual refresh генерирует `status-refresh-<uuid>` и пробрасывает в каждый чек.

## 5. Credential Stewardship

- Требуемые переменные:
  - `SENDPULSE_ID`, `SENDPULSE_SECRET` (уже есть в `.env.example`, заменить реальные значения на placeholders).
  - `STRIPE_SECRET_KEY` (добавить в `.env.example` и документацию; использовать restricted key с read-only scopes).
- Health registry не должен логировать значения переменных или access tokens. Для SendPulse access token не записываем в логи (только длину).
- Падение по отсутствию кредов → status `down`, `failureSummary.action` = «Добавить переменные окружения ...».

## 6. Outstanding Points & Resolutions

1. **UI contract**: карточки должны отображать `status`, `label`, `lastSuccessAt`, `lastFailureAt`, `failureSummary.message`, `action`. → Решено: задокументировать в Phase 1 `contracts/system-status.md`.
2. **Manual refresh concurrency**: при активном фоновом прогоне возвращать 409 (plan Phase 2). Потребуется mutex в registry.
3. **Reuse in scripts**: `scripts/check-apis.js` стоит адоптировать под новый registry (в план добавлено как Phase 4/optional).
4. **Future extensibility**: зарезервировать `metadata` поле в snapshot (object) для специфичных данных (например, `scheduler.retryScheduled`). Документируем сейчас, реализуем сразу, чтобы не ломать контракт.

## 7. Next Actions (Phase 1 Inputs)

- Создать `services/status/healthRegistry.js` с поддержкой тайм-аутов и mutex.
- Подготовить `services/stripe/client.js` (обёртка над Stripe SDK с `healthPing`).
- Обновить `.env.example` (удалить реальные SendPulse значения, добавить placeholder Stripe).
- Начать `contracts/system-status.md` с JSON схемой (включая `metadata`).

---  
**Phase 0 gate verdict**: Все вопросы, отмеченные в плане (cadence, logging, credential policy), закрыты. Можно переходить к Phase 1 реализации.









