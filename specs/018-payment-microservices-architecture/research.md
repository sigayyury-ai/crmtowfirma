# Research: Текущая структура базы данных для Stripe платежей

**Дата исследования**: 2026-02-02  
**Цель**: Изучение текущей структуры БД для Stripe платежей с целью проектирования микросервисной архитектуры  
**Метод**: Прямой запрос к базе данных Supabase через скрипт `scripts/inspect-stripe-payments-table.js`  
**Статистика**: Проанализировано 529 записей в таблице `stripe_payments`

## Обзор

Текущая система использует PostgreSQL (Supabase) для хранения данных о Stripe платежах. База данных содержит несколько связанных таблиц для хранения платежей, сессий, событий, напоминаний и других связанных данных.

## Основные таблицы

### 1. stripe_payments

**Назначение**: Основная таблица для хранения Stripe платежей и сессий.

**Структура полей** (на основе реального запроса к БД от 2026-02-02):

| Поле | Тип | Описание | Источник | Nullable |
|------|-----|----------|----------|----------|
| `id` | UUID | Первичный ключ | Генерируется при создании | NOT NULL |
| `session_id` | TEXT | Stripe Checkout Session ID | Stripe API (уникальный ключ для upsert) | NOT NULL |
| `deal_id` | TEXT | ID сделки в Pipedrive | CRM (обязательное поле) | NOT NULL |
| `product_id` | UUID | ID продукта (ProductLink) | Внутренний идентификатор | NULL |
| `payment_type` | VARCHAR(7) | Тип платежа | `deposit`, `rest`, `addon`, `single` | NULL (62% записей NULL) |
| `payment_schedule` | VARCHAR(5) | График платежей | `50/50` или `100%` | NULL |
| `payment_status` | VARCHAR(4-20) | Статус платежа | `paid`, `unpaid`, `event_placeholder` | NULL |
| `payment_mode` | VARCHAR(7) | Режим платежа | `payment` (для checkout sessions) | NULL |
| `currency` | VARCHAR(3) | Валюта платежа | Stripe (PLN, EUR, USD и т.д.) | NULL |
| `original_amount` | INTEGER | Оригинальная сумма в минимальных единицах | Stripe (в центах/копейках) | NULL |
| `amount_pln` | NUMERIC | Сумма в PLN | Рассчитывается с курсом | NULL |
| `exchange_rate` | NUMERIC | Курс валют | open.er-api.com | NULL |
| `exchange_rate_fetched_at` | TIMESTAMPTZ | Время получения курса | Системная дата | NULL |
| `amount_tax` | NUMERIC | Сумма VAT | Stripe Tax | NULL |
| `amount_tax_pln` | NUMERIC | VAT в PLN | Рассчитывается | NULL |
| `tax_behavior` | VARCHAR(9) | Режим расчета VAT | `inclusive`, `exclusive`, `none` | NULL |
| `tax_rate_id` | VARCHAR(3) | ID ставки VAT | Stripe Tax (например, "23%") | NULL |
| `invoice_number` | VARCHAR(255) | Номер инвойса | Stripe metadata | NULL (большинство NULL) |
| `receipt_number` | VARCHAR(255) | Номер квитанции | Stripe metadata | NULL (большинство NULL) |
| `checkout_url` | TEXT | URL сессии оплаты | Stripe Checkout Session URL | NULL (большинство NULL) |
| `status` | VARCHAR(9) | Статус обработки | `processed`, `pending_metadata`, `refunded`, `deleted` | NULL |
| `income_category_id` | INTEGER | Категория дохода P&L | Ссылка на pnl_revenue_categories | NULL (большинство NULL) |
| `customer_email` | VARCHAR | Email клиента | Stripe customer_details | NULL |
| `customer_name` | VARCHAR | Имя клиента | Stripe customer_details | NULL |
| `customer_type` | VARCHAR(6) | Тип клиента | `person` или `company` | NULL |
| `customer_country` | VARCHAR(2) | Страна клиента (ISO код) | Stripe customer_details.address | NULL |
| `company_name` | VARCHAR | Название компании (для B2B) | Stripe customer_details | NULL (для B2C) |
| `company_tax_id` | VARCHAR | Налоговый ID компании (NIP для PL) | Stripe customer_details | NULL (для B2C) |
| `company_address` | TEXT | Адрес компании | Stripe customer_details | NULL (для B2C) |
| `company_country` | VARCHAR(2) | Страна компании | Stripe customer_details | NULL (для B2C) |
| `address_validated` | BOOLEAN | Флаг валидации адреса | Системная валидация | NULL |
| `address_validation_reason` | TEXT | Причина валидации/невалидации адреса | Системная валидация | NULL |
| `expected_vat` | BOOLEAN | Ожидается ли VAT для этого платежа | Бизнес-логика (страна = PL) | NULL |
| `raw_payload` | JSONB | Полный payload от Stripe | Для аудита и отладки | NULL |
| `created_at` | TIMESTAMPTZ | Дата создания сессии | Stripe timestamp | NULL |
| `processed_at` | TIMESTAMPTZ | Дата обработки платежа | Системная дата | NULL |
| `updated_at` | TIMESTAMPTZ | Дата обновления | Автоматически обновляется | NULL |

**Статистика по реальным данным** (на 2026-02-02):
- Всего записей: **529**
- `payment_status`: `paid` (380), `unpaid` (125), `event_placeholder` (24)
- `payment_type`: `deposit` (57), `rest` (34), `single` (108), `NULL` (330 - 62%)
- Большинство записей имеют `payment_type = NULL`, что указывает на необходимость миграции данных или обновления логики заполнения

**Индексы**:
- Уникальный индекс на `session_id` (для upsert)
- Индекс на `deal_id` (для поиска по сделке)
- Индекс на `invoice_number`
- Индекс на `receipt_number`
- Индекс на `income_category_id`
- Индекс на `payment_status`
- Индекс на `created_at` / `processed_at` (для фильтрации по датам)

**Особенности**:
- Использует `upsert` с конфликтом по `session_id` для идемпотентности
- Поддерживает опциональные поля (invoice_number, receipt_number, payment_schedule, checkout_url) с fallback при их отсутствии
- Хранит полный `raw_payload` от Stripe для аудита
- **Важно**: `original_amount` хранится как INTEGER в минимальных единицах валюты (центах/копейках), а не как NUMERIC с десятичными знаками
- Хранит данные клиента напрямую в таблице (customer_email, customer_name, customer_type, customer_country) для быстрого доступа без JOIN
- Поддерживает B2B данные (company_name, company_tax_id, company_address, company_country) для юридических лиц
- Имеет поля для валидации адреса (address_validated, address_validation_reason) и VAT логики (expected_vat)
- Хранит время получения курса валют (exchange_rate_fetched_at) для аудита

---

### 2. stripe_event_items

**Назначение**: Хранение событий Stripe для аналитики и отчетности.

**Структура**:

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | UUID | Первичный ключ |
| `line_item_id` | TEXT | ID line item в Stripe (уникальный) |
| `session_id` | TEXT | Ссылка на stripe_payments(session_id) |
| `event_key` | TEXT | Ключ события (например, "checkout.session.completed") |
| `event_label` | TEXT | Человекочитаемый лейбл события |
| `currency` | TEXT | Валюта (по умолчанию PLN) |
| `amount` | NUMERIC(18,2) | Сумма в оригинальной валюте |
| `amount_pln` | NUMERIC(18,2) | Сумма в PLN |
| `payment_status` | TEXT | Статус платежа |
| `refund_status` | TEXT | Статус возврата (если применимо) |
| `customer_id` | TEXT | ID клиента в Stripe |
| `customer_email` | TEXT | Email клиента |
| `customer_name` | TEXT | Имя клиента |
| `created_at` | TIMESTAMPTZ | Дата создания записи |
| `updated_at` | TIMESTAMPTZ | Дата обновления |

**Индексы**:
- Уникальный индекс на `line_item_id`
- Индекс на `event_key`
- Индекс на `session_id`
- Индекс на `payment_status`
- Индекс на `updated_at`

**Особенности**:
- Изначально имела FK на stripe_payments, но была удалена (миграция 014) для возможности хранения событий без сессий
- Используется для агрегации событий и аналитики

---

### 3. stripe_event_summary

**Назначение**: Агрегированная сводка по событиям Stripe.

**Структура**:

| Поле | Тип | Описание |
|------|-----|----------|
| `event_key` | TEXT | Ключ события (первичный ключ) |
| `event_label` | TEXT | Человекочитаемый лейбл |
| `currency` | TEXT | Валюта |
| `gross_revenue` | NUMERIC(18,2) | Общая выручка |
| `gross_revenue_pln` | NUMERIC(18,2) | Выручка в PLN |
| `payments_count` | INTEGER | Количество платежей |
| `participants_count` | INTEGER | Количество участников |
| `refunds_count` | INTEGER | Количество возвратов |
| `warnings` | TEXT[] | Массив предупреждений |
| `last_payment_at` | TIMESTAMPTZ | Дата последнего платежа |
| `updated_at` | TIMESTAMPTZ | Дата обновления |

---

### 4. stripe_event_participants

**Назначение**: Участники событий с агрегированными суммами.

**Структура**:

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | UUID | Первичный ключ |
| `event_key` | TEXT | FK на stripe_event_summary |
| `participant_id` | TEXT | ID участника |
| `display_name` | TEXT | Отображаемое имя |
| `email` | TEXT | Email участника |
| `currency` | TEXT | Валюта |
| `total_amount` | NUMERIC(18,2) | Общая сумма |
| `total_amount_pln` | NUMERIC(18,2) | Сумма в PLN |
| `payments_count` | INTEGER | Количество платежей |
| `refund_amount_pln` | NUMERIC(18,2) | Сумма возвратов в PLN |
| `updated_at` | TIMESTAMPTZ | Дата обновления |

**Индексы**:
- Уникальный индекс на `(event_key, participant_id)`
- Индекс на `event_key`
- Индекс на `email`

---

### 5. stripe_event_aggregation_jobs

**Назначение**: Журнал задач агрегации событий.

**Структура**:

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | UUID | Первичный ключ |
| `started_at` | TIMESTAMPTZ | Время начала |
| `finished_at` | TIMESTAMPTZ | Время завершения |
| `status` | TEXT | Статус задачи |
| `processed_sessions` | INTEGER | Количество обработанных сессий |
| `detected_refunds` | INTEGER | Количество обнаруженных возвратов |
| `error_message` | TEXT | Сообщение об ошибке (если есть) |

---

### 6. stripe_reminder_logs

**Назначение**: Журнал отправленных напоминаний о платежах для предотвращения дублирования.

**Структура**:

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | BIGSERIAL | Первичный ключ |
| `deal_id` | INTEGER | ID сделки в Pipedrive |
| `second_payment_date` | DATE | Дата второго платежа |
| `session_id` | TEXT | ID Stripe checkout session |
| `sent_date` | DATE | Календарный день отправки |
| `sent_at` | TIMESTAMPTZ | Точное время отправки |
| `run_id` | UUID | ID запуска cron |
| `trigger_source` | VARCHAR(64) | Источник запуска |
| `sendpulse_id` | VARCHAR(128) | ID контакта в SendPulse |
| `message_hash` | TEXT | Хеш сообщения |
| `action_type` | VARCHAR(32) | Тип действия: `session_created` или `reminder_sent` |

**Индексы**:
- Уникальный индекс на `(deal_id, second_payment_date, action_type)` - предотвращает дублирование
- Индекс на `deal_id`
- Индекс на `sent_at`
- Индекс на `session_id`

**Особенности**:
- Используется для предотвращения отправки повторных напоминаний
- Поддерживает два типа действий: создание сессии и отправка напоминания
- Уникальность по комбинации deal_id + second_payment_date + action_type

---

### 7. stripe_payment_locks

**Назначение**: Распределенные блокировки для предотвращения race conditions при создании сессий.

**Структура**:

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | BIGSERIAL | Первичный ключ |
| `lock_key` | VARCHAR(255) | Уникальный ключ блокировки |
| `lock_id` | VARCHAR(255) | ID экземпляра блокировки |
| `deal_id` | VARCHAR(255) | ID сделки в Pipedrive |
| `lock_type` | VARCHAR(100) | Тип блокировки (по умолчанию 'payment_creation') |
| `expires_at` | TIMESTAMPTZ | Время истечения блокировки |
| `created_at` | TIMESTAMPTZ | Время создания |

**Индексы**:
- Уникальный индекс на `lock_key`
- Индекс на `expires_at` (для очистки)
- Индекс на `deal_id`
- Индекс на `lock_type`

**Особенности**:
- Используется для предотвращения одновременного создания нескольких сессий для одной сделки
- Автоматическая очистка истекших блокировок

---

### 8. stripe_payment_deletions

**Назначение**: Журнал удаленных платежей и возвратов (аналог удаленных проформ).

**Структура** (на основе data-model.md и кода):

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | UUID | Первичный ключ |
| `payment_id` | UUID | FK на stripe_payments |
| `deal_id` | TEXT | ID сделки |
| `reason` | TEXT | Причина: `stripe_refund`, `wfirma_deleted` |
| `amount` | NUMERIC | Сумма (отрицательная для возвратов) |
| `amount_pln` | NUMERIC | Сумма в PLN |
| `currency` | TEXT | Валюта |
| `logged_at` | TIMESTAMPTZ | Время логирования |
| `notes` | TEXT | Примечания (Stripe refund id) |
| `metadata` | JSONB | Дополнительные метаданные |
| `raw_payload` | JSONB | Полный payload от Stripe |

**Особенности**:
- Проверка дубликатов перед вставкой (по payment_id + reason + refund_id)
- Отрицательные суммы для возвратов
- Используется в отчетах для вычитания возвратов

---

### 9. stripe_documents

**Назначение**: Хранение документов, связанных с платежами (квитанции, подтверждения).

**Структура** (на основе data-model.md):

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | UUID | Первичный ключ |
| `payment_id` | UUID | FK на stripe_payments |
| `document_type` | TEXT | Тип документа: `receipt`, `confirmation` |
| `source_url` | TEXT | URL документа |
| `mime_type` | TEXT | MIME тип файла |
| `created_at` | TIMESTAMPTZ | Дата создания |

**Особенности**:
- Уникальность по `(payment_id, document_type)` для upsert

---

### 10. product_links

**Назначение**: Связь между продуктами CRM, Stripe и внутренними идентификаторами.

**Структура**:

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | UUID | Первичный ключ (используется как product_id в платежах) |
| `crm_product_id` | TEXT | ID продукта в Pipedrive |
| `crm_product_name` | TEXT | Название продукта в CRM |
| `stripe_product_id` | TEXT | ID продукта в Stripe |
| `camp_product_id` | TEXT | Внутренний ID продукта |
| `status` | TEXT | Статус: `active`, `archived` |
| `created_at` | TIMESTAMPTZ | Дата создания |
| `updated_at` | TIMESTAMPTZ | Дата обновления |

**Особенности**:
- Upsert по `(crm_product_id, stripe_product_id)`
- Стабильный идентификатор для связи платежей с продуктами

---

### 11. cash_payments

**Назначение**: Хранение наличных платежей для гибридных платежей.

**Структура**:

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | BIGSERIAL | Первичный ключ |
| `deal_id` | BIGINT | ID сделки в Pipedrive |
| `proforma_id` | TEXT | FK на proformas (опционально) |
| `proforma_fullnumber` | VARCHAR(255) | Номер проформы |
| `cash_expected_amount` | NUMERIC(15,2) | Ожидаемая сумма наличных |
| `cash_received_amount` | NUMERIC(15,2) | Фактически полученная сумма |
| `currency` | VARCHAR(3) | Валюта (по умолчанию PLN) |
| `amount_pln` | NUMERIC(15,2) | Сумма в PLN |
| `status` | VARCHAR(32) | Статус: `pending`, `pending_confirmation`, `received`, `refunded`, `cancelled` |
| `source` | VARCHAR(32) | Источник: `manual`, `crm`, `stripe` |
| `expected_date` | DATE | Ожидаемая дата получения |
| `confirmed_at` | TIMESTAMPTZ | Время подтверждения |
| `confirmed_by` | VARCHAR(255) | Кто подтвердил |
| `created_by` | VARCHAR(255) | Кто создал |
| `note` | TEXT | Примечание |
| `metadata` | JSONB | Дополнительные метаданные |
| `created_at` | TIMESTAMPTZ | Дата создания |
| `updated_at` | TIMESTAMPTZ | Дата обновления |

**Индексы**:
- Индекс на `deal_id`
- Индекс на `proforma_id`
- Индекс на `status`

---

## Связи между таблицами

```
stripe_payments
  ├── session_id (уникальный ключ)
  ├── deal_id → Pipedrive deals
  ├── product_id → product_links.id
  └── income_category_id → pnl_revenue_categories.id

stripe_event_items
  └── session_id → stripe_payments.session_id (без FK после миграции 014)

stripe_event_participants
  └── event_key → stripe_event_summary.event_key

stripe_reminder_logs
  ├── deal_id → Pipedrive deals
  └── session_id → stripe_payments.session_id

stripe_payment_deletions
  └── payment_id → stripe_payments.id

stripe_documents
  └── payment_id → stripe_payments.id

cash_payments
  ├── deal_id → Pipedrive deals
  └── proforma_id → proformas.id
```

---

## Текущие проблемы и ограничения

### 1. Отсутствие истории изменений
- Нет таблицы для хранения истории изменений сумм платежей
- Нет таблицы для хранения истории изменений статусов
- Нет таблицы для хранения истории изменений сессий
- Нет возможности отследить, когда и почему изменилась сумма или статус платежа

### 2. Ограниченная защита от дублирования
- Проверка дубликатов сессий выполняется в коде, а не на уровне БД
- Нет уникального ограничения на комбинацию (deal_id + payment_type + status) для активных сессий
- Проверка дубликатов уведомлений только через stripe_reminder_logs с фиксированным TTL
- **Проблема**: 62% записей имеют `payment_type = NULL`, что затрудняет проверку дубликатов

### 3. Отсутствие таблиц для валидации и процессов
- Нет таблицы `validation_errors` для хранения ошибок валидации
- Нет таблицы `process_states` для сохранения состояния процессов при ошибках
- Нет таблицы `session_duplicate_checks` для логирования проверок дубликатов
- Нет возможности перезапустить процесс после исправления ошибок без потери контекста

### 4. Ограниченная история клиентов
- Нет агрегированной таблицы `customer_payment_history` для быстрого доступа к истории клиента
- История платежей клиента собирается через JOIN запросы, что может быть медленно
- Нет индекса на `customer_email` для быстрого поиска всех платежей клиента

### 5. Отсутствие таблиц для микросервисов
- Нет таблицы для хранения состояний микросервисов
- Нет таблицы для логирования операций микросервисов
- Нет таблицы для хранения конфигурации микросервисов

### 6. Проблемы с данными
- **62% записей имеют `payment_type = NULL`** - требуется миграция или обновление логики заполнения
- `checkout_url` в большинстве записей NULL - возможно, не заполняется при создании сессии
- `invoice_number` и `receipt_number` в большинстве записей NULL - возможно, заполняются позже или не всегда доступны
- Нет поля `participant_id` в реальной структуре (хотя упоминается в data-model.md) - возможно, удалено или не используется

---

## Рекомендации для микросервисной архитектуры

### Новые таблицы для добавления

1. **validation_errors** - ошибки валидации данных
2. **process_states** - состояния процессов для перезапуска
3. **session_duplicate_checks** - логи проверок дубликатов сессий
4. **notification_logs** - расширенный лог уведомлений с TTL
5. **payment_status_history** - история изменений статусов платежей
6. **payment_amount_history** - история изменений сумм платежей
7. **customer_payment_history** - агрегированная история клиентов
8. **microservice_logs** - логи операций микросервисов
9. **event_logs** - логи обработанных событий для идемпотентности

### Улучшения существующих таблиц

1. **stripe_payments**:
   - Добавить уникальное ограничение на (deal_id + payment_type) WHERE status = 'open' для предотвращения дубликатов активных сессий
   - Добавить поле `status_history` JSONB для хранения истории статусов
   - Добавить поле `amount_history` JSONB для хранения истории изменений сумм

2. **stripe_reminder_logs**:
   - Расширить для поддержки различных типов уведомлений
   - Добавить поле `ttl_hours` для настраиваемого TTL
   - Добавить поле `notification_type` для различения типов уведомлений

3. **stripe_payment_locks**:
   - Добавить поле `service_name` для идентификации микросервиса, создавшего блокировку
   - Добавить поле `lock_reason` для описания причины блокировки

---

## Выводы

Текущая структура БД хорошо подходит для монолитной архитектуры, но требует дополнений для микросервисной архитектуры:

1. **Хорошо**: Идемпотентность через upsert по session_id, логирование событий, защита от дублирования напоминаний
2. **Требует улучшения**: История изменений, защита от дублирования сессий на уровне БД, таблицы для валидации и процессов
3. **Нужно добавить**: Таблицы для микросервисов, расширенное логирование, агрегированные таблицы для производительности

Рекомендуется создать миграции для новых таблиц перед внедрением микросервисной архитектуры.

---

## Результаты реального запроса к БД

**Дата запроса**: 2026-02-02  
**Скрипт**: `scripts/inspect-stripe-payments-table.js`  
**Всего записей**: 529

### Обнаруженные дополнительные поля

При реальном запросе к БД обнаружены поля, которые не были упомянуты в миграциях:

1. **Поля клиента** (хранятся напрямую в таблице):
   - `customer_email` - Email клиента
   - `customer_name` - Имя клиента
   - `customer_type` - Тип клиента (`person` или `company`)
   - `customer_country` - Страна клиента (ISO код, например "PL")

2. **Поля компании** (для B2B):
   - `company_name` - Название компании
   - `company_tax_id` - Налоговый ID (NIP для Польши)
   - `company_address` - Адрес компании
   - `company_country` - Страна компании

3. **Поля валидации**:
   - `address_validated` - BOOLEAN флаг валидации адреса
   - `address_validation_reason` - Причина валидации/невалидации
   - `expected_vat` - BOOLEAN флаг ожидания VAT

4. **Дополнительные служебные поля**:
   - `payment_mode` - Режим платежа (`payment` для checkout sessions)
   - `exchange_rate_fetched_at` - Время получения курса валют

### Важные наблюдения

1. **Тип данных `original_amount`**: 
   - Хранится как INTEGER (в минимальных единицах валюты - центах/копейках)
   - Например: 88500 центов = 885.00 EUR
   - Это важно учитывать при расчетах и отображении

2. **Проблема с NULL значениями**:
   - 62% записей (330 из 529) имеют `payment_type = NULL`
   - Это указывает на необходимость миграции данных или обновления логики заполнения
   - Может затруднять проверку дубликатов и фильтрацию

3. **Распределение статусов**:
   - `paid`: 380 записей (72%)
   - `unpaid`: 125 записей (24%)
   - `event_placeholder`: 24 записи (4%) - специальный статус для событий

4. **Распределение типов платежей** (из не-NULL записей):
   - `deposit`: 57 записей
   - `rest`: 34 записи
   - `single`: 108 записей
   - `NULL`: 330 записей (62%)

5. **Отсутствие поля `participant_id`**:
   - В реальной структуре БД поле `participant_id` отсутствует
   - Хотя оно упоминается в data-model.md, в реальных данных его нет
   - Возможно, было удалено или не используется

6. **NULL значения в опциональных полях**:
   - `checkout_url`: большинство записей NULL
   - `invoice_number`: большинство записей NULL
   - `receipt_number`: большинство записей NULL
   - `income_category_id`: большинство записей NULL

### Пример реальной записи

```json
{
  "id": "49c4a4c0-93f7-42ae-a754-c252097be0c3",
  "session_id": "cs_live_a17eZBcftXawfTZs0Jar1RZoFvAdHgqT4uilOKFBC53jWGwXESj90Qi43m",
  "deal_id": "1848",
  "product_id": "a3cc925c-7dd0-4f5c-87a6-616f8286f872",
  "payment_type": "deposit",
  "payment_schedule": "50/50",
  "payment_status": "paid",
  "currency": "EUR",
  "original_amount": 885,  // В минимальных единицах (центах)
  "amount_pln": 3727.22,
  "exchange_rate": 4.211552,
  "amount_tax": 165.49,
  "amount_tax_pln": 696.97,
  "tax_behavior": "inclusive",
  "tax_rate_id": "23%",
  "status": "processed",
  "customer_email": "onemtut@gmail.com",
  "customer_name": "Mikhail Chuprynski",
  "customer_type": "person",
  "customer_country": "PL",
  "address_validated": true,
  "expected_vat": true,
  "raw_payload": { /* полный payload от Stripe */ }
}
```

### Рекомендации на основе реальных данных

1. **Миграция данных**: Заполнить `payment_type` для записей с NULL значениями на основе анализа `payment_schedule` и других полей
2. **Индексы**: Добавить индекс на `customer_email` для быстрого поиска всех платежей клиента
3. **Валидация**: Убедиться, что `payment_type` всегда заполняется при создании новой записи
4. **Документация**: Обновить документацию с учетом реальной структуры БД (особенно про INTEGER для `original_amount`)
5. **Микросервисы**: Учесть наличие полей клиента и компании при проектировании микросервисов для избежания дублирования данных
