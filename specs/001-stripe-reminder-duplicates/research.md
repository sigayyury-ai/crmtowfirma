# Research: Защита от дубликатов напоминаний для Stripe платежей

**Feature**: 001-stripe-reminder-duplicates  
**Date**: 2026-01-11  
**Status**: Complete

## Research Questions

### 1. Структура таблицы логов напоминаний

**Question**: Какую структуру должна иметь таблица `stripe_reminder_logs` для предотвращения дубликатов?

**Decision**: Использовать структуру, аналогичную `proforma_reminder_logs`, но с уникальным индексом на `(deal_id, second_payment_date)` без `sent_date`, чтобы предотвращать дубликаты навсегда, а не только на один день.

**Rationale**: 
- Поскольку cron работает раз в день, защита только на один день не имеет смысла
- Уникальный индекс на `(deal_id, second_payment_date)` гарантирует, что для каждой комбинации сделки и даты второго платежа будет максимум одна запись
- Поле `sent_date` сохраняется для аудита, но не входит в уникальный индекс
- Поле `session_id` добавляется для отслеживания, какая Stripe сессия была связана с напоминанием

**Alternatives considered**:
- Уникальный индекс на `(deal_id, second_payment_date, sent_date)` - отклонено, так как позволяет отправлять дубликаты на разные дни
- Отдельная таблица без `sent_date` - отклонено, так как `sent_date` нужен для аудита

### 2. Точки проверки истории напоминаний

**Question**: Где именно нужно проверять историю напоминаний?

**Decision**: Проверка должна выполняться в двух точках:
1. В `findReminderTasks()` - при создании задач напоминаний
2. В `processAllReminders()` - непосредственно перед отправкой каждого напоминания

**Rationale**:
- Двойная проверка защищает от race conditions
- Проверка в `findReminderTasks()` предотвращает создание ненужных задач
- Проверка перед отправкой - финальная защита на случай, если платеж был оплачен между созданием задачи и отправкой

**Alternatives considered**:
- Только проверка в `findReminderTasks()` - отклонено, недостаточно защиты от race conditions
- Только проверка перед отправкой - отклонено, создает ненужные задачи в памяти

### 3. Обработка конфликтов уникальности

**Question**: Как обрабатывать ситуацию, когда два процесса одновременно пытаются создать запись о напоминании?

**Decision**: Использовать graceful handling - при ошибке уникальности (код 23505) логировать предупреждение и пропускать отправку, не падая с ошибкой.

**Rationale**:
- Уникальный индекс в базе данных гарантирует, что только один процесс сможет создать запись
- Второй процесс получит ошибку уникальности и должен корректно обработать её
- Это стандартный паттерн для идемпотентных операций

**Alternatives considered**:
- Блокировка на уровне приложения - отклонено, избыточно для данной задачи
- Retry механизм - отклонено, если запись уже существует, повторная попытка не нужна

### 4. Интеграция с существующим кодом

**Question**: Как интегрировать новую функциональность с существующим `SecondPaymentSchedulerService`?

**Decision**: Добавить методы `wasReminderSentEver()`, `persistReminderLog()` аналогично `ProformaSecondPaymentReminderService`, и использовать их в существующих методах `findReminderTasks()` и `processAllReminders()`.

**Rationale**:
- Соответствует существующему паттерну для проформ
- Минимальные изменения в существующем коде
- Легко тестировать и поддерживать

**Alternatives considered**:
- Создать отдельный сервис для логирования - отклонено, избыточно для данной задачи
- Использовать только in-memory кеш - отклонено, не работает между запусками cron

### 5. Проверка статуса оплаты

**Question**: Нужно ли проверять статус оплаты перед проверкой истории напоминаний?

**Decision**: Да, проверка статуса оплаты должна выполняться перед проверкой истории. Если платеж уже оплачен (>=90% от ожидаемой суммы), напоминание не должно отправляться независимо от истории.

**Rationale**:
- Основная цель - не беспокоить клиентов, которые уже оплатили
- Проверка оплаты более важна, чем проверка истории
- Если платеж оплачен, нет смысла проверять историю

**Alternatives considered**:
- Проверять только историю - отклонено, может отправлять напоминания оплаченным платежам
- Проверять только статус оплаты - отклонено, история тоже важна для предотвращения дубликатов

## Technical Decisions

### Database Schema

**Table**: `stripe_reminder_logs`

**Structure**:
- `id` BIGSERIAL PRIMARY KEY
- `deal_id` INTEGER NOT NULL
- `second_payment_date` DATE NOT NULL
- `session_id` TEXT NOT NULL (Stripe checkout session ID)
- `sent_date` DATE NOT NULL DEFAULT CURRENT_DATE (for audit)
- `sent_at` TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
- `run_id` UUID NULL
- `trigger_source` VARCHAR(64) NULL
- `sendpulse_id` VARCHAR(128) NULL
- `message_hash` TEXT NULL (optional, for future deduplication)

**Unique Constraint**: `(deal_id, second_payment_date)` - prevents duplicates across all time

**Indexes**:
- Primary key on `id`
- Unique index on `(deal_id, second_payment_date)`
- Index on `deal_id` for quick lookups
- Index on `sent_at` for audit queries

### Code Integration Points

1. **`SecondPaymentSchedulerService.findReminderTasks()`**: Добавить проверку `wasReminderSentEver()` перед добавлением задачи в список
2. **`SecondPaymentSchedulerService.processAllReminders()`**: Добавить проверку `wasReminderSentEver()` и статуса оплаты перед отправкой
3. **`SecondPaymentSchedulerService.sendReminder()`**: Добавить вызов `persistReminderLog()` после успешной отправки через SendPulse

### Error Handling

- Database errors: Log warning, continue processing (fail-open approach)
- Uniqueness violations: Log info, skip reminder (expected behavior)
- SendPulse errors: Do not create log record (reminder not sent)

## Dependencies

- Existing `SecondPaymentSchedulerService` class
- Existing Supabase client configuration
- Existing SendPulse client integration
- Existing logger (Winston)
- Database migration system

## References

- `scripts/migrations/015_create_proforma_reminder_logs.sql` - reference implementation
- `src/services/proformaSecondPaymentReminderService.js` - reference implementation pattern
- `src/services/stripe/secondPaymentSchedulerService.js` - target for modifications


