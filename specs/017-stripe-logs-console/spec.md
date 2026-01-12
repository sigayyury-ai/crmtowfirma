# Feature Specification: Stripe Logs in Cursor Console (webhooks + automations)

**Feature Folder**: `specs/017-stripe-logs-console/`  
**Created**: 2026-01-12  
**Status**: Draft  
**Input**: “Нужны Stripe логи не из Dashboard, а из консоли Cursor/скрипта. Сейчас не приходят уведомления/автоматизации. Логи нужны для всех сценариев, включая Stripe webhooks после оплаты. Сделать ресёрч текущей инфраструктуры оплаты/автоматизаций и возможностей логирования. Создать spec.”

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Смотреть Stripe webhook processing в реальном времени (Priority: P1)

Как инженер/оператор, я хочу из терминала (Cursor) видеть **живые логи обработки Stripe webhook’ов** и ключевые поля (eventId, тип, dealId, sessionId, paymentIntentId), чтобы быстро понять: webhook пришёл/не пришёл, прошёл ли signature verify, и где именно падает обработка.

**Acceptance Scenarios**:

1. **Given** в Stripe происходит оплата, **When** webhook отправлен на наш endpoint, **Then** я вижу в консоли строки вида “Stripe webhook получен” и далее шаги обработки (persistSession, обновление статуса CRM, отправка уведомления).
2. **Given** webhook не проходит подпись, **When** я смотрю логи, **Then** я вижу “signature verification failed” с подсказкой, что именно проверить (секрет, live/test, endpoint).
3. **Given** webhook приходит “из другого кабинета/режима” и сейчас игнорируется, **When** я смотрю логи, **Then** я вижу явную строку “Events cabinet ignored” и понимаю причину.

---

### User Story 2 — Диагностика “почему не сработала автоматизация/уведомление” (Priority: P1)

Как инженер/оператор, я хочу одним скриптом получить сводку: **сколько webhook’ов пришло**, сколько обработано, сколько ошибок, и в каких сделках (dealId) есть проблемы — чтобы быстро локализовать причину “не пришли уведомления/не обновились статусы”.

**Acceptance Scenarios**:

1. **Given** я запускаю скрипт анализа логов за последние N строк/минут, **When** он отрабатывает, **Then** я вижу агрегированные счетчики по типам событий, ошибкам и статус-автоматизациям (по dealId).
2. **Given** в системе нет webhook’ов, **When** я запускаю анализ, **Then** я получаю явное предупреждение “webhook events not found” и next steps.

---

### User Story 3 — Проверка Stripe-side сигналов без Dashboard (Priority: P2)

Как инженер/оператор, я хочу из консоли получить список последних Stripe events по нужным типам (checkout.session.completed и т.п.) и сверить, что Stripe вообще генерирует события — без захода в Stripe Dashboard.

**Acceptance Scenarios**:

1. **Given** есть Stripe API key, **When** я запускаю скрипт “list recent Stripe events”, **Then** я вижу последние события с `event.id`, `type`, `created`, `livemode`, и `request.id` (если доступно).

---

### Edge Cases

- Webhook приходит, но падает на `resource_missing` при `checkout.sessions.retrieve` (несовпадение режима/кабинета).
- Webhook приходит, но `deal_id` отсутствует в metadata (невозможно связать с CRM).
- Уведомление не отправилось из-за SendPulse/CRM данных (нет Telegram ID / SendPulse ID и т.п.).
- Stripe отправляет повторные delivery (дубликаты) — важно видеть это в логах и не паниковать.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Система MUST предоставлять способ получать продакшен-логи обработки Stripe webhook’ов из консоли Cursor (без Stripe Dashboard).
- **FR-002**: Решение MUST покрывать минимум сценарии: `checkout.session.completed`, `payment_intent.succeeded`, `charge.refunded`, `invoice.payment_succeeded` и ошибки верификации подписи.
- **FR-003**: Решение MUST позволять фильтрацию/поиск по `dealId`, `sessionId`, `eventId` (в идеале — параметрами скрипта).
- **FR-004**: Решение MUST иметь режим “tail/stream” (живое наблюдение) и режим “анализ последних N строк/минут” (сводка).
- **FR-005**: Решение MUST работать без Stripe Dashboard (Stripe API допустим, если есть ключи).

### Non-Functional Requirements

- **NFR-001**: Скрипты MUST не выводить секреты (webhook secret, api keys).
- **NFR-002**: Скрипты SHOULD быть безопасны для запуска в прод-окружении (read-only).
- **NFR-003**: Отчёты SHOULD быть читабельны и “операторские” (короткие выводы + next steps).

### Key Entities *(include if feature involves data)*

- **StripeWebhookEvent**: событие Stripe (`event.id`, `type`, `request.id`, `livemode`).
- **WebhookProcessingLog**: лог обработки на нашей стороне (связка eventId → dealId/sessionId → шаги).
- **AutomationOutcome**: результат автоматизации (обновление статуса, создание ноута, отправка уведомления).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Инженер может за ≤ 5 минут определить, “webhook не пришёл / пришёл но не прошёл подпись / пришёл но упал в обработке”.
- **SC-002**: В 90% инцидентов “не пришли уведомления/не сработали автоматизации” причина определяется из консольных логов без Stripe Dashboard.
- **SC-003**: Ноль случаев утечки секретов в вывод скриптов.

