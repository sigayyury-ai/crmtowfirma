# Data Model: Payment Microservices Architecture

**Feature**: 018-payment-microservices-architecture  
**Date**: 2026-02-02  
**Based on**: Research of current database structure and microservices requirements

## Overview

Модель данных для микросервисной архитектуры платежей. Включает существующие таблицы (расширенные) и новые таблицы для поддержки микросервисов, валидации, истории изменений и защиты от дублирования.

## Existing Tables (Extended)

### 1. stripe_payments (Existing, Extended)

**Purpose**: Основная таблица для хранения Stripe платежей и сессий.

**Current Structure**: 39 полей (см. research.md)

**Extensions for Microservices**:
- Добавить поле `status_history` JSONB для хранения истории статусов (опционально, можно использовать отдельную таблицу)
- Добавить поле `amount_history` JSONB для хранения истории изменений сумм (опционально, можно использовать отдельную таблицу)
- Добавить индекс на `customer_email` для быстрого поиска всех платежей клиента
- Добавить уникальное ограничение на `(deal_id + payment_type)` WHERE `status = 'open'` для предотвращения дубликатов активных сессий

**Relationships**:
- `deal_id` → Pipedrive deals
- `product_id` → `product_links.id`
- `income_category_id` → `pnl_revenue_categories.id`

---

## New Tables for Microservices

### 2. validation_errors

**Purpose**: Хранение ошибок валидации данных при создании сессий и обработке платежей.

**Fields**:

| Field | Type | Description | Constraints |
|-------|------|-------------|-------------|
| `id` | UUID | Первичный ключ | PRIMARY KEY, DEFAULT gen_random_uuid() |
| `deal_id` | TEXT | ID сделки в Pipedrive | NOT NULL |
| `process_type` | VARCHAR(50) | Тип процесса | NOT NULL (`session_creation`, `payment_processing`, `webhook_processing`) |
| `process_id` | UUID | ID процесса (для связи с process_states) | NULL |
| `errors` | JSONB | Массив ошибок валидации | NOT NULL |
| `data` | JSONB | Данные, которые не прошли валидацию | NULL |
| `field_errors` | JSONB | Ошибки по полям: `{ "field": "error_message" }` | NULL |
| `missing_fields` | TEXT[] | Список недостающих обязательных полей | NULL |
| `invalid_fields` | TEXT[] | Список полей с некорректными значениями | NULL |
| `status` | VARCHAR(20) | Статус обработки ошибки | NOT NULL, DEFAULT 'pending' (`pending`, `resolved`, `ignored`, `warning`) |
| `severity` | VARCHAR(10) | Уровень серьезности | NOT NULL, DEFAULT 'error' (`error`, `warning`) |
| `resolved_at` | TIMESTAMPTZ | Время разрешения ошибки | NULL |
| `resolved_by` | VARCHAR(255) | Кто разрешил ошибку | NULL |
| `created_at` | TIMESTAMPTZ | Время создания записи | NOT NULL, DEFAULT NOW() |
| `updated_at` | TIMESTAMPTZ | Время обновления | NOT NULL, DEFAULT NOW() |

**Indexes**:
- Индекс на `deal_id` для быстрого поиска ошибок по сделке
- Индекс на `process_type` для фильтрации по типу процесса
- Индекс на `status` для поиска неразрешенных ошибок
- Индекс на `created_at` для сортировки по времени

**Example errors structure (severity='error')**:
```json
{
  "errors": [
    {
      "field": "product",
      "message": "Product is required - deal must have at least one product",
      "code": "REQUIRED_FIELD"
    },
    {
      "field": "amount",
      "message": "Amount must be positive",
      "code": "INVALID_VALUE",
      "value": -100
    }
  ],
  "field_errors": {
    "product": "Product is required",
    "amount": "Amount must be positive"
  },
  "missing_fields": ["product"],
  "invalid_fields": ["amount"],
  "severity": "error"
}
```

**Example warnings structure (severity='warning')**:
```json
{
  "errors": [
    {
      "field": "notification_channel_id",
      "message": "SendPulse ID or Telegram Chat ID not found - notifications will be sent via email only. Consider adding SendPulse ID or Telegram Chat ID for better communication.",
      "code": "MISSING_NOTIFICATION_CHANNEL",
      "severity": "warning"
    }
  ],
  "field_errors": {
    "notification_channel_id": "SendPulse ID or Telegram Chat ID not found - email will be used as fallback"
  },
  "missing_fields": ["notification_channel_id"],
  "invalid_fields": [],
  "severity": "warning"
}
```

**Разница между ошибками и предупреждениями**:
- **Ошибки (severity='error')**: Блокируют создание сессии, сессия НЕ создается
- **Предупреждения (severity='warning')**: НЕ блокируют создание сессии, сессия создается успешно, но менеджер уведомляется

**Validation Rules for Session Creation**:

1. **Product Validation**:
   - `deal.products` must exist and have at least one product
   - First product must have valid `product_id` or `product.id`
   - Product must have `name` or `product.name` or fallback to `deal.title`

2. **Price/Amount Validation**:
   - `amount` must be a number > 0
   - `amount` must not exceed `deal.value` (if deal value is specified)
   - For 50/50 schedule: `deposit_amount + rest_amount` should equal `deal.value`
   - `amount` cannot be `null`, `undefined`, or `NaN`

3. **Address Validation**:
   - For B2C: `person.address` or `person.address_street` must exist
   - For B2B: `organization.address` or `organization.address_street` must exist
   - Address must include `country` (ISO code: PL, US, GB, etc.)
   - For VAT-required countries (PL): address must be complete and validated
   - Address validation checks: `address_validated = true` or address parts are complete

4. **Customer Name Validation**:
   - For B2C: `person.name` must exist and not be empty
   - For B2B: `organization.name` must exist and not be empty
   - Name cannot be `null`, `undefined`, or empty string

5. **Email Validation**:
   - `person.email[0].value` or `person.email` or `organization.email[0].value` or `organization.email` must exist
   - Email must match valid email format (regex: `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`)

6. **Currency Validation**:
   - `deal.currency` must exist or default to 'PLN'
   - Currency must be valid ISO code: PLN, EUR, USD, GBP, etc.
   - Currency normalization: full names (e.g., "Polish Zloty") → ISO codes (e.g., "PLN")

7. **Deal Status Validation**:
   - `deal.status` must not be 'lost' or 'deleted'
   - `deal.deleted` must not be `true`
   - `deal.invoice_type` must not be '74' or 'Delete'

8. **B2B Validation** (только для B2B сделок):
   - **Organization Validation**:
     - `deal.organization_id` must exist and not be 0 or null
     - Organization must exist in Pipedrive and be accessible via API
     - Organization must have `name` field filled
   - **Business ID (Tax ID/NIP) Validation**:
     - `organization.nip` or `organization.tax_id` or `organization.vat_number` must exist
     - Business ID cannot be empty or null
     - Business ID is required for creating invoices and VAT reports
     - For Poland: NIP format validation (10 digits)
     - For other countries: VAT number format validation (country-specific)
   - **B2B Address Validation**:
     - Organization address must be complete (street, city, postal_code, country)
     - Country must be specified for VAT calculation
     - For PL: full address required for VAT invoices

**B2B Detection Logic**:
- B2B is detected if:
  - `deal.organization_id` is present and not 0/null, OR
  - `deal.invoice_type` = 'company' or similar B2B flag, OR
  - Organization exists and has Business ID
- If B2B detected, all B2B-specific validations apply

9. **Notification Channel Validation** (WARNING, not blocking):
   - **SendPulse ID Validation**:
     - `person.sendpulse_id` or `person.custom_fields[PIPEDRIVE_SENDPULSE_ID_FIELD_KEY]` should exist (recommended)
     - SendPulse ID field key: `ff1aa263ac9f0e54e2ae7bec6d7215d027bf1b8c`
     - Used for sending notifications via SendPulse (Telegram/Instagram)
   - **Telegram Chat ID Validation** (alternative):
     - `person.telegram_chat_id` or `person.custom_fields[PIPEDRIVE_TELEGRAM_CHAT_ID_FIELD_KEY]` may exist
     - Used as alternative notification channel
   - **Notification Channel Warning** (NOT blocking):
     - If neither SendPulse ID NOR Telegram Chat ID found → generate WARNING (not error)
     - Email is used as fallback notification channel (email is always required and available)
     - Session creation continues successfully
     - Manager is notified about missing notification channels
     - Task created in CRM for manager to fill SendPulse ID or Telegram Chat ID

**Notification Channel Detection Logic**:
- Check for SendPulse ID first (primary channel)
- If SendPulse ID not found, check for Telegram Chat ID (alternative)
- If neither found → WARNING (not error):
  - Session creation continues (email is fallback)
  - Warning saved to validation_errors table with status='warning'
  - Manager notified via CRM task
  - Email notification sent to customer (fallback channel)
- For B2B: check Person's notification channels (Organization may not have direct notification channels)

---

### 3. process_states

**Purpose**: Сохранение состояния процессов для возможности перезапуска после исправления ошибок.

**Fields**:

| Field | Type | Description | Constraints |
|-------|------|-------------|-------------|
| `id` | UUID | Первичный ключ | PRIMARY KEY, DEFAULT gen_random_uuid() |
| `process_type` | VARCHAR(50) | Тип процесса | NOT NULL |
| `process_name` | VARCHAR(100) | Название процесса (описательное) | NULL |
| `deal_id` | TEXT | ID сделки в Pipedrive | NULL |
| `state` | JSONB | Состояние процесса (все данные для перезапуска) | NOT NULL |
| `errors` | JSONB | Ошибки, которые привели к остановке процесса | NULL |
| `status` | VARCHAR(20) | Статус процесса | NOT NULL, DEFAULT 'failed' (`failed`, `retrying`, `completed`, `cancelled`) |
| `retry_count` | INTEGER | Количество попыток перезапуска | NOT NULL, DEFAULT 0 |
| `max_retries` | INTEGER | Максимальное количество попыток | NOT NULL, DEFAULT 3 |
| `last_retry_at` | TIMESTAMPTZ | Время последней попытки перезапуска | NULL |
| `completed_at` | TIMESTAMPTZ | Время успешного завершения | NULL |
| `created_at` | TIMESTAMPTZ | Время создания записи | NOT NULL, DEFAULT NOW() |
| `updated_at` | TIMESTAMPTZ | Время обновления | NOT NULL, DEFAULT NOW() |

**Indexes**:
- Индекс на `process_type` для фильтрации по типу
- Индекс на `deal_id` для поиска по сделке
- Индекс на `status` для поиска процессов требующих внимания
- Индекс на `created_at` для очистки старых записей

**Example state structure**:
```json
{
  "step": "session_creation",
  "data": {
    "deal_id": "1848",
    "payment_type": "deposit",
    "amount": 885,
    "currency": "EUR"
  },
  "context": {
    "trigger": "pipedrive_webhook",
    "user": "manager@example.com"
  }
}
```

---

### 4. notification_logs

**Purpose**: Расширенный лог отправленных уведомлений с TTL для предотвращения дубликатов.

**Fields**:

| Field | Type | Description | Constraints |
|-------|------|-------------|-------------|
| `id` | UUID | Первичный ключ | PRIMARY KEY, DEFAULT gen_random_uuid() |
| `deal_id` | TEXT | ID сделки в Pipedrive | NULL |
| `recipient` | VARCHAR(255) | Получатель (email или SendPulse ID) | NOT NULL |
| `recipient_type` | VARCHAR(20) | Тип получателя | NOT NULL (`email`, `sendpulse_id`, `telegram`) |
| `notification_type` | VARCHAR(50) | Тип уведомления | NOT NULL (`payment_link_created`, `payment_received`, `payment_reminder`, `session_expired`, `payment_refunded`) |
| `channel` | VARCHAR(20) | Канал отправки | NOT NULL (`email`, `telegram`, `sms`) |
| `message_hash` | TEXT | Хеш сообщения для дедупликации | NULL |
| `ttl_hours` | INTEGER | TTL в часах (по умолчанию 24) | NOT NULL, DEFAULT 24 |
| `expires_at` | TIMESTAMPTZ | Время истечения TTL | NOT NULL |
| `sent_at` | TIMESTAMPTZ | Время отправки | NOT NULL, DEFAULT NOW() |
| `sent_by` | VARCHAR(50) | Кто/что отправило | NOT NULL (`system`, `cron`, `manual`, `microservice_name`) |
| `success` | BOOLEAN | Успешность отправки | NOT NULL, DEFAULT true |
| `error_message` | TEXT | Сообщение об ошибке (если не успешно) | NULL |
| `metadata` | JSONB | Дополнительные метаданные | NULL |
| `created_at` | TIMESTAMPTZ | Время создания записи | NOT NULL, DEFAULT NOW() |

**Indexes**:
- Уникальный индекс на `(recipient, notification_type, DATE_TRUNC('hour', sent_at))` для предотвращения дубликатов в пределах часа
- Индекс на `deal_id` для поиска по сделке
- Индекс на `expires_at` для очистки истекших записей
- Индекс на `sent_at` для сортировки

**Idempotency Key**: `recipient + notification_type + DATE_TRUNC('hour', sent_at)`

---

### 5. payment_status_history

**Purpose**: История изменений статусов платежей для аудита и отслеживания изменений.

**Fields**:

| Field | Type | Description | Constraints |
|-------|------|-------------|-------------|
| `id` | UUID | Первичный ключ | PRIMARY KEY, DEFAULT gen_random_uuid() |
| `payment_id` | UUID | FK на stripe_payments.id | NOT NULL, REFERENCES stripe_payments(id) ON DELETE CASCADE |
| `session_id` | TEXT | Stripe session ID (для быстрого поиска) | NULL |
| `deal_id` | TEXT | ID сделки в Pipedrive | NOT NULL |
| `old_status` | VARCHAR(50) | Предыдущий статус | NULL |
| `new_status` | VARCHAR(50) | Новый статус | NOT NULL |
| `status_field` | VARCHAR(50) | Какое поле статуса изменилось | NOT NULL (`payment_status`, `status`, `crm_stage_id`) |
| `reason` | TEXT | Причина изменения статуса | NULL |
| `changed_by` | VARCHAR(255) | Кто/что изменило статус | NOT NULL (`system`, `webhook`, `cron`, `manual`, `microservice_name`) |
| `metadata` | JSONB | Дополнительные метаданные | NULL |
| `created_at` | TIMESTAMPTZ | Время изменения | NOT NULL, DEFAULT NOW() |

**Indexes**:
- Индекс на `payment_id` для поиска истории по платежу
- Индекс на `deal_id` для поиска по сделке
- Индекс на `session_id` для быстрого поиска
- Индекс на `created_at` для сортировки по времени

---

### 6. payment_amount_history

**Purpose**: История изменений сумм платежей для аудита и отслеживания изменений.

**Fields**:

| Field | Type | Description | Constraints |
|-------|------|-------------|-------------|
| `id` | UUID | Первичный ключ | PRIMARY KEY, DEFAULT gen_random_uuid() |
| `payment_id` | UUID | FK на stripe_payments.id | NOT NULL, REFERENCES stripe_payments(id) ON DELETE CASCADE |
| `session_id` | TEXT | Stripe session ID | NULL |
| `deal_id` | TEXT | ID сделки в Pipedrive | NOT NULL |
| `amount_field` | VARCHAR(50) | Какое поле суммы изменилось | NOT NULL (`original_amount`, `amount_pln`, `amount_tax`) |
| `old_amount` | NUMERIC(15,2) | Предыдущая сумма | NULL |
| `new_amount` | NUMERIC(15,2) | Новая сумма | NOT NULL |
| `currency` | VARCHAR(3) | Валюта суммы | NULL |
| `reason` | TEXT | Причина изменения суммы | NULL |
| `changed_by` | VARCHAR(255) | Кто/что изменило сумму | NOT NULL |
| `metadata` | JSONB | Дополнительные метаданные | NULL |
| `created_at` | TIMESTAMPTZ | Время изменения | NOT NULL, DEFAULT NOW() |

**Indexes**:
- Индекс на `payment_id` для поиска истории по платежу
- Индекс на `deal_id` для поиска по сделке
- Индекс на `created_at` для сортировки

---

### 7. session_duplicate_checks

**Purpose**: Логирование проверок дубликатов сессий для аудита и анализа.

**Fields**:

| Field | Type | Description | Constraints |
|-------|------|-------------|-------------|
| `id` | UUID | Первичный ключ | PRIMARY KEY, DEFAULT gen_random_uuid() |
| `deal_id` | TEXT | ID сделки в Pipedrive | NOT NULL |
| `payment_type` | VARCHAR(20) | Тип платежа | NOT NULL (`deposit`, `rest`, `single`) |
| `check_type` | VARCHAR(50) | Тип проверки | NOT NULL (`before_creation`, `recreation_check`) |
| `duplicate_found` | BOOLEAN | Найден ли дубликат | NOT NULL |
| `existing_session_id` | TEXT | ID существующей сессии (если найден дубликат) | NULL |
| `existing_session_status` | VARCHAR(20) | Статус существующей сессии | NULL |
| `action_taken` | VARCHAR(50) | Действие, которое было предпринято | NOT NULL (`created`, `skipped`, `recreated`) |
| `checked_at` | TIMESTAMPTZ | Время проверки | NOT NULL, DEFAULT NOW() |
| `metadata` | JSONB | Дополнительные метаданные | NULL |

**Indexes**:
- Индекс на `deal_id` для поиска по сделке
- Индекс на `checked_at` для сортировки по времени
- Индекс на `duplicate_found` для анализа дубликатов

---

### 8. event_logs

**Purpose**: Логи обработанных событий для идемпотентности и аудита.

**Fields**:

| Field | Type | Description | Constraints |
|-------|------|-------------|-------------|
| `id` | UUID | Первичный ключ | PRIMARY KEY, DEFAULT gen_random_uuid() |
| `event_id` | TEXT | ID события (Stripe event ID или внутренний) | NOT NULL |
| `event_type` | VARCHAR(100) | Тип события | NOT NULL |
| `event_source` | VARCHAR(50) | Источник события | NOT NULL (`stripe_webhook`, `internal`, `cron`) |
| `processed` | BOOLEAN | Обработано ли событие | NOT NULL, DEFAULT false |
| `processed_at` | TIMESTAMPTZ | Время обработки | NULL |
| `processed_by` | VARCHAR(100) | Какой сервис обработал | NULL |
| `duplicate` | BOOLEAN | Было ли это дубликатом | NOT NULL, DEFAULT false |
| `payload` | JSONB | Полный payload события | NULL |
| `metadata` | JSONB | Дополнительные метаданные | NULL |
| `created_at` | TIMESTAMPTZ | Время получения события | NOT NULL, DEFAULT NOW() |

**Indexes**:
- Уникальный индекс на `event_id` для предотвращения дубликатов
- Индекс на `event_type` для фильтрации по типу
- Индекс на `processed` для поиска необработанных событий
- Индекс на `created_at` для сортировки

---

### 9. customer_payment_history

**Purpose**: Агрегированная история всех платежей клиента для быстрого доступа.

**Fields**:

| Field | Type | Description | Constraints |
|-------|------|-------------|-------------|
| `id` | UUID | Первичный ключ | PRIMARY KEY, DEFAULT gen_random_uuid() |
| `customer_email` | VARCHAR(255) | Email клиента | NOT NULL |
| `customer_name` | VARCHAR(255) | Имя клиента | NULL |
| `deal_id` | TEXT | ID сделки в Pipedrive | NOT NULL |
| `total_sessions` | INTEGER | Общее количество созданных сессий | NOT NULL, DEFAULT 0 |
| `paid_sessions` | INTEGER | Количество оплаченных сессий | NOT NULL, DEFAULT 0 |
| `total_amount` | NUMERIC(15,2) | Общая сумма всех платежей | NOT NULL, DEFAULT 0 |
| `total_amount_pln` | NUMERIC(15,2) | Общая сумма в PLN | NOT NULL, DEFAULT 0 |
| `total_refunded` | NUMERIC(15,2) | Общая сумма возвратов | NOT NULL, DEFAULT 0 |
| `currencies` | TEXT[] | Массив валют платежей | NULL |
| `first_payment_at` | TIMESTAMPTZ | Дата первого платежа | NULL |
| `last_payment_at` | TIMESTAMPTZ | Дата последнего платежа | NULL |
| `updated_at` | TIMESTAMPTZ | Время последнего обновления | NOT NULL, DEFAULT NOW() |
| `created_at` | TIMESTAMPTZ | Время создания записи | NOT NULL, DEFAULT NOW() |

**Indexes**:
- Уникальный индекс на `(customer_email, deal_id)` для предотвращения дубликатов
- Индекс на `customer_email` для быстрого поиска всех платежей клиента
- Индекс на `deal_id` для поиска по сделке
- Индекс на `updated_at` для сортировки

**Note**: Эта таблица может быть materialized view или обновляться через триггеры/события.

---

## Relationships

```
stripe_payments
  ├── id → payment_status_history.payment_id
  ├── id → payment_amount_history.payment_id
  ├── deal_id → validation_errors.deal_id
  ├── deal_id → process_states.deal_id
  ├── deal_id → session_duplicate_checks.deal_id
  └── session_id → event_logs (через metadata)

validation_errors
  └── process_id → process_states.id

notification_logs
  └── deal_id → Pipedrive deals

customer_payment_history
  ├── customer_email → stripe_payments.customer_email
  └── deal_id → Pipedrive deals
```

## Data Integrity Rules

1. **Уникальность сессий**: Уникальный индекс на `stripe_payments.session_id`
2. **Дубликаты сессий**: Уникальное ограничение на `(deal_id + payment_type)` WHERE `status = 'open'` для активных сессий
3. **Дубликаты уведомлений**: Уникальный индекс на `(recipient, notification_type, DATE_TRUNC('hour', sent_at))` в `notification_logs`
4. **Дубликаты событий**: Уникальный индекс на `event_logs.event_id`
5. **История платежей**: Каждое изменение статуса/суммы создает запись в истории
6. **Валидация**: Каждая ошибка валидации сохраняется в `validation_errors` с возможностью перезапуска через `process_states`

## Migration Strategy

### Phase 0: Create New Tables
- Создать все новые таблицы через миграции
- Добавить индексы
- Настроить constraints

### Phase 1+: Gradual Integration
- Микросервисы начинают использовать новые таблицы
- Старые таблицы продолжают использоваться параллельно
- Постепенный переход на новые таблицы

### Future: Materialized Views
- `customer_payment_history` может быть materialized view для производительности
- Обновление через триггеры или события
