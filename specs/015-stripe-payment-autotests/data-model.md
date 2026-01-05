# Data Model: Автотесты Stripe платежей

## Entities

### TestRun

Представляет одно выполнение тестового набора.

**Fields**:
- `id` (string, UUID): Уникальный идентификатор запуска
- `startedAt` (timestamp): Время начала выполнения
- `finishedAt` (timestamp, nullable): Время завершения выполнения
- `durationMs` (number): Длительность выполнения в миллисекундах
- `status` (enum: 'running' | 'completed' | 'failed' | 'timeout'): Статус выполнения
- `totalTests` (number): Общее количество тестов
- `passedTests` (number): Количество пройденных тестов
- `failedTests` (number): Количество провалившихся тестов
- `skippedTests` (number): Количество пропущенных тестов
- `summary` (object): Сводная информация о результатах
- `correlationId` (string): Correlation ID для логирования

**Storage**: In-memory during execution, logged to Winston, optionally persisted to Supabase

**Validation Rules**:
- `startedAt` must be set on creation
- `totalTests` = `passedTests` + `failedTests` + `skippedTests`
- `status` transitions: `running` → `completed` | `failed` | `timeout`

### TestResult

Представляет результат выполнения одного теста.

**Fields**:
- `testName` (string): Название теста (e.g., "deposit_payment_creation")
- `status` (enum: 'passed' | 'failed' | 'skipped'): Статус теста
- `startedAt` (timestamp): Время начала теста
- `finishedAt` (timestamp): Время завершения теста
- `durationMs` (number): Длительность выполнения в миллисекундах
- `error` (object, nullable): Детали ошибки (если статус = 'failed')
  - `message` (string): Сообщение об ошибке
  - `stack` (string, nullable): Stack trace
  - `code` (string, nullable): Код ошибки
- `assertions` (array): Массив проверенных утверждений
  - `description` (string): Описание утверждения
  - `passed` (boolean): Результат проверки
  - `expected` (any): Ожидаемое значение
  - `actual` (any): Фактическое значение
- `testData` (object): Данные, использованные в тесте
  - `dealId` (string, nullable): ID тестовой сделки
  - `sessionId` (string, nullable): ID Stripe сессии
  - `paymentId` (string, nullable): ID платежа в БД
- `correlationId` (string): Correlation ID для логирования

**Storage**: In-memory during execution, logged to Winston

**Validation Rules**:
- `testName` must be unique within TestRun
- `status` must be one of: 'passed', 'failed', 'skipped'
- If `status` = 'failed', `error` must be set
- `startedAt` must be set on creation
- `finishedAt` must be set on completion

### TestDeal

Временная тестовая сделка в Pipedrive.

**Fields** (Pipedrive deal fields):
- `id` (number): Pipedrive deal ID
- `title` (string): Название сделки (prefixed with `[TEST]`)
- `value` (number): Сумма сделки
- `currency` (string): Валюта (default: 'PLN')
- `expected_close_date` (date): Дата закрытия (используется для определения графика)
- `invoice_type` (string): Тип инвойса (для тестов: '75' для Stripe)
- `stage_id` (number): Стадия сделки
- `person_id` (number, nullable): ID контакта
- `tags` (array): Теги (включает 'stripe_autotest')
- `created_at` (timestamp): Время создания
- `testMarker` (string): Маркер теста ('stripe_autotest')

**Storage**: Pipedrive CRM (temporary)

**Validation Rules**:
- `title` must start with `[TEST]`
- `tags` must include 'stripe_autotest'
- `value` must be > 0
- `expected_close_date` must be valid date
- `invoice_type` must be '75' for Stripe tests

**Cleanup**: Deleted after test completion or by cleanup cron job

### TestSession

Временная Stripe Checkout Session для тестирования.

**Fields** (Stripe session fields):
- `id` (string): Stripe session ID
- `deal_id` (string): ID тестовой сделки (from metadata)
- `payment_type` (enum: 'deposit' | 'rest' | 'single'): Тип платежа
- `payment_schedule` (enum: '50/50' | '100%'): График платежей
- `amount` (number): Сумма платежа
- `currency` (string): Валюта
- `status` (string): Статус сессии (Stripe)
- `url` (string): URL для оплаты
- `expires_at` (timestamp): Время истечения
- `testMarker` (string): Маркер теста ('autotest')

**Storage**: Stripe test mode (temporary)

**Validation Rules**:
- `deal_id` must reference TestDeal
- `payment_type` must match deal's payment schedule
- `amount` must be > 0
- `expires_at` must be in future on creation

**Cleanup**: Expires automatically (24h), or deleted via Stripe API

### TestPayment

Временная запись платежа в Supabase для тестирования.

**Fields** (Supabase stripe_payments table):
- `id` (uuid): Уникальный идентификатор
- `session_id` (string): Stripe session ID
- `deal_id` (string): Pipedrive deal ID
- `payment_type` (enum: 'deposit' | 'rest' | 'single'): Тип платежа
- `payment_schedule` (enum: '50/50' | '100%'): График платежей
- `payment_status` (enum: 'unpaid' | 'paid' | 'refunded'): Статус платежа
- `amount` (number): Сумма платежа
- `currency` (string): Валюта
- `created_at` (timestamp): Время создания
- `updated_at` (timestamp): Время обновления
- `is_test_data` (boolean): Маркер тестовых данных (true)

**Storage**: Supabase `stripe_payments` table (temporary)

**Validation Rules**:
- `is_test_data` must be true
- `session_id` must reference TestSession
- `deal_id` must reference TestDeal
- `payment_status` transitions: `unpaid` → `paid` → `refunded`

**Cleanup**: Deleted after test completion or by cleanup cron job

### TestNotification

Запись о тестовом уведомлении через SendPulse.

**Fields**:
- `sendpulseId` (string): Telegram ID получателя (тестовый)
- `message` (string): Текст сообщения
- `sentAt` (timestamp): Время отправки
- `success` (boolean): Успешность отправки
- `error` (string, nullable): Ошибка (если success = false)
- `testMarker` (string): Маркер теста ('autotest')

**Storage**: Logged to Winston, not persisted to database

**Validation Rules**:
- `sendpulseId` must be valid Telegram ID
- `message` must contain payment link and schedule info
- If `success` = false, `error` must be set

## Relationships

```
TestRun
  ├── has many → TestResult
  │     ├── uses → TestDeal
  │     ├── uses → TestSession
  │     ├── uses → TestPayment
  │     └── uses → TestNotification
  │
  └── cleanup → TestDeal (delete)
  └── cleanup → TestSession (expire/delete)
  └── cleanup → TestPayment (delete)
```

## State Transitions

### TestRun Status

```
running → completed (all tests passed)
running → failed (any test failed)
running → timeout (execution exceeded time limit)
```

### TestPayment Status

```
unpaid → paid (webhook checkout.session.completed)
paid → refunded (webhook charge.refunded)
```

## Data Isolation Strategy

1. **Naming Convention**: All test data prefixed with `[TEST]` or tagged with `stripe_autotest`
2. **Database Marker**: `is_test_data = true` in Supabase records
3. **Stripe Mode**: `STRIPE_MODE=test` environment variable
4. **Pipedrive Tags**: `stripe_autotest` tag on test deals
5. **SendPulse**: Test Telegram ID or test channel

## Cleanup Strategy

1. **Immediate Cleanup**: After each test in `finally` block
2. **Scheduled Cleanup**: Daily cron job at 4:00 AM to remove orphaned test data
3. **TTL-based**: Test data older than 7 days automatically removed
4. **Manual Cleanup**: Script for emergency cleanup

