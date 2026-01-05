# Phase 0 Research: Автотесты Stripe платежей

## Research Questions & Findings

### 1. Test Data Isolation Strategy

**Question**: Как изолировать тестовые данные от production?

**Decision**: Использовать специальный префикс для тестовых сделок и Stripe test mode.

**Rationale**: 
- Pipedrive: Тестовые сделки создаются с префиксом `[TEST]` в названии и специальным тегом `stripe_autotest`
- Stripe: Использовать `STRIPE_MODE=test` и тестовые API ключи
- Supabase: Тестовые записи помечаются полем `is_test_data=true` или префиксом в `deal_id`
- SendPulse: Использовать тестовый Telegram ID или специальный канал для тестов

**Alternatives considered**:
- Отдельный тестовый Pipedrive аккаунт: слишком сложно для поддержки
- Мокирование всех внешних сервисов: не покрывает реальные интеграции
- Использование production данных: нарушает принцип изоляции

### 2. Test Execution Framework

**Question**: Какой фреймворк использовать для тестов?

**Decision**: Custom test runner на базе Node.js с использованием существующих сервисов.

**Rationale**:
- Проект уже использует Node.js и Express
- Существующие сервисы (StripeProcessorService, PipedriveClient) можно переиспользовать
- Не требуется дополнительных зависимостей
- Полный контроль над выполнением и логированием

**Alternatives considered**:
- Jest: избыточно для интеграционных тестов, требует мокирования
- Mocha/Chai: дополнительная зависимость, не требуется для простых assertions
- Playwright/Cypress: для UI тестов, не подходит для backend

### 3. Cron Integration

**Question**: Как интегрировать тесты в существующую cron инфраструктуру?

**Decision**: Добавить новую cron задачу в `src/services/scheduler.js` с расписанием `0 3 * * *` (3:00 AM ежедневно).

**Rationale**:
- Существующий scheduler уже использует `node-cron` с timezone support
- Паттерн добавления новых cron задач уже установлен (см. `secondPaymentCronJob`, `googleMeetCalendarScanCronJob`)
- Время 3:00 AM минимизирует влияние на production нагрузку
- Логирование через существующий Winston logger

**Alternatives considered**:
- Отдельный cron процесс: усложняет мониторинг и логирование
- Внешний cron (Render cron jobs): требует дополнительной настройки
- Ручной запуск: не соответствует требованию автоматизации

### 4. Test Data Cleanup

**Question**: Как гарантировать 100% очистку тестовых данных?

**Decision**: Многоуровневая стратегия очистки с таймаутами и fallback механизмами.

**Rationale**:
- Cleanup в `finally` блоке каждого теста (гарантированная очистка)
- Отдельная cron задача для очистки "забытых" тестовых данных (ежедневно в 4:00 AM)
- Маркировка тестовых данных временными метками для идентификации
- Логирование всех операций очистки

**Alternatives considered**:
- TTL в базе данных: не подходит для Pipedrive и Stripe
- Ручная очистка: не масштабируется
- Игнорирование очистки: нарушает требование изоляции

### 5. Stripe Test Mode Integration

**Question**: Как использовать Stripe test mode для тестов?

**Decision**: Использовать `STRIPE_MODE=test` environment variable и тестовые ключи.

**Rationale**:
- Существующий код уже поддерживает `STRIPE_MODE` (см. `src/services/stripe/processor.js:31`)
- Stripe test mode предоставляет полный функционал без реальных платежей
- Тестовые сессии можно создавать и проверять без риска
- Webhook события можно симулировать через Stripe CLI или test mode

**Alternatives considered**:
- Мокирование Stripe API: не покрывает реальное поведение
- Использование production Stripe: риск реальных платежей
- Отдельный Stripe аккаунт: избыточно для тестов

### 6. Pipedrive Test Data Creation

**Question**: Как создавать тестовые сделки в Pipedrive?

**Decision**: Использовать Pipedrive API для создания тестовых сделок с маркировкой.

**Rationale**:
- Существующий `PipedriveClient` уже имеет методы для работы со сделками
- Тестовые сделки создаются с префиксом `[TEST]` и тегом `stripe_autotest`
- После теста сделки удаляются через API
- Если удаление не удалось, cron задача очистки удалит их позже

**Alternatives considered**:
- Использование существующих production сделок: нарушает изоляцию
- Мокирование Pipedrive API: не покрывает реальные интеграции
- Ручное создание тестовых сделок: не масштабируется

### 7. SendPulse Test Notifications

**Question**: Как тестировать отправку уведомлений без спама реальным пользователям?

**Decision**: Использовать тестовый Telegram ID или специальный тестовый канал.

**Rationale**:
- SendPulse требует реальный Telegram ID для отправки
- Можно использовать тестовый Telegram бот или канал
- Альтернативно: проверять только факт вызова SendPulse API без реальной отправки
- Логировать все попытки отправки для проверки

**Alternatives considered**:
- Отправка реальным пользователям: спам и нарушение изоляции
- Полное мокирование SendPulse: не покрывает реальные ошибки API
- Пропуск проверки уведомлений: нарушает требование end-to-end тестирования

### 8. Webhook Simulation

**Question**: Как симулировать webhook события для тестов?

**Decision**: Использовать прямые вызовы обработчиков webhook с валидными payload.

**Rationale**:
- Существующие webhook handlers (`stripeWebhook.js`, `pipedriveWebhook.js`) можно вызывать напрямую
- Для Stripe: использовать Stripe test mode events или симулировать payload
- Для Pipedrive: создавать валидные webhook payload вручную
- Проверять signature verification для Stripe (можно отключить для тестов)

**Alternatives considered**:
- Использование реальных webhook: не контролируемо и медленно
- Полное мокирование webhook: не покрывает реальную логику обработки
- Отдельный тестовый webhook endpoint: избыточно

### 9. Test Result Logging

**Question**: Как структурировать логирование результатов тестов?

**Decision**: Использовать Winston logger с structured logging и correlation IDs.

**Rationale**:
- Существующий logger уже настроен для structured logging
- Каждый тест получает уникальный correlation ID
- Результаты логируются в формате JSON для удобного парсинга
- Отдельные логи для успешных и неуспешных тестов
- Итоговый summary в конце выполнения

**Alternatives considered**:
- Простые console.log: не структурировано, сложно парсить
- Отдельная БД для результатов: избыточно для начала
- Email уведомления: может быть добавлено позже как опция

### 10. Error Handling and Retries

**Question**: Как обрабатывать временные ошибки в тестах?

**Decision**: Retry логика для внешних API вызовов, graceful degradation для некритичных проверок.

**Rationale**:
- Внешние API (Pipedrive, Stripe, SendPulse) могут быть временно недоступны
- Retry с exponential backoff для критичных операций
- Некритичные проверки (например, SendPulse) могут быть пропущены с предупреждением
- Все ошибки логируются для анализа

**Alternatives considered**:
- Fail fast: слишком строго для интеграционных тестов
- Бесконечные retries: может заблокировать выполнение
- Игнорирование ошибок: не помогает выявить проблемы

### 11. SendPulse Contact Deal ID Sync

**Question**: Как обновлять кастомное поле контакта в SendPulse с deal_id из CRM при отправке сообщения?

**Decision**: Добавить метод `updateContactCustomField()` в `SendPulseClient` и вызывать его после успешной отправки сообщения.

**Rationale**:
- SendPulse API поддерживает обновление контактов через `PUT /contacts/{contact_id}` или `PATCH /contacts/{contact_id}`
- Кастомные поля можно обновлять через поле `variables` в payload
- Обновление должно происходить после успешной отправки сообщения, но не блокировать отправку при ошибке
- Поле `deal_id` должно быть создано в SendPulse заранее (через UI или API)

**Alternatives considered**:
- Обновление до отправки сообщения: может замедлить процесс, не критично
- Синхронизация через отдельный cron: избыточно, достаточно обновлять при отправке
- Игнорирование ошибок обновления: правильно, отправка сообщения важнее

## Summary

Все вопросы разрешены. Основные решения:
1. Изоляция через теговые маркеры и test mode
2. Custom test runner на базе существующих сервисов
3. Интеграция в существующий cron scheduler
4. Многоуровневая стратегия очистки данных
5. Использование Stripe test mode
6. Создание тестовых сделок через Pipedrive API
7. Тестовые уведомления через тестовый Telegram ID
8. Прямые вызовы webhook handlers
9. Structured logging через Winston
10. Retry логика с graceful degradation
11. Обновление deal_id в SendPulse при отправке сообщений

