# Data Model — Stripe Payment Processor

## 1. StripePayment

| Field | Type | Source | Notes |
|-------|------|--------|-------|
| `id` | UUID | Supabase PK | Generated on insert |
| `source` | enum(`stripe`,`proform`) | Processor | Объединённое поле для отчётов |
| `deal_id` | string | Pipedrive | Обязательное, сопоставление CRM |
| `participant_id` | string | CRM (person) | Опционально, если метаданные присутствуют |
| `product_id` | string | Internal ProductLink ID | Стабильный идентификатор продукта (CRM ↔ Stripe) |
| `session_id` | string | Stripe Checkout Session | Используется как часть уникального ключа |
| `invoice_number` | string | Stripe metadata | Отражается в CRM, используется в отчётах |
| `payment_type` | enum(`deposit`,`rest`,`addon`,`single`) | Rule engine | Определяется по close_date и stage |
| `currency` | string(3) | Stripe | Валюта платежа |
| `amount` | decimal(12,2) | Stripe | Оригинальная сумма |
| `exchange_rate` | decimal(10,6) | open.er-api.com | Сохраняем источник и timestamp |
| `amount_pln` | decimal(12,2) | Calculated | С банковским округлением |
| `amount_tax` | decimal(12,2) | Stripe | Сумма VAT (если рассчитан Checkout) |
| `amount_tax_pln` | decimal(12,2) | Calculated | VAT после конвертации в PLN |
| `tax_behavior` | enum(`inclusive`,`exclusive`,`none`) | Stripe Tax | Отражает режим расчёта |
| `tax_rate_id` | string | Stripe Tax | Ставка VAT, применённая Stripe |
| `status` | enum(`processed`,`pending_metadata`,`refunded`,`deleted`) | Processor | Побочные состояния для мониторинга |
| `created_at` | timestamptz | Stripe | ISO timestamp Checkout Session |
| `processed_at` | timestamptz | System | Когда запись сохранена |
| `processor_run_id` | uuid | PaymentProcessorRun | Для аудита |
| `company_name` | string | Pipedrive Organization | Заполняется при B2B |
| `company_tax_id` | string | Pipedrive Organization | NIP/VAT номер |
| `company_address` | string | Pipedrive Organization | Полный адрес плательщика |
| `company_country` | string(2) | Pipedrive Organization | ISO-код страны |
| `address_validated` | boolean | Processor | true, если адрес подтверждён |

### Validation
- `(deal_id, session_id)` уникальна.  
- `amount_pln = roundBankers(amount * exchange_rate)`.  
- `payment_type` должен соответствовать правилу >30/≤30 дней.  
- `status=refunded` только если существует связанная запись в логах удалений.  
- При `company_country = 'PL'` поля `amount_tax`, `tax_behavior` обязательны.  
- Если `address_validated = false`, запись не попадает в отчёты, а в CRM ставится задача на корректировку данных.

## 2. PaymentProcessorRun

| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid PK |
| `source` | enum(`proform`,`stripe`) |
| `started_at` / `finished_at` | timestamptz |
| `triggered_by` | enum(`scheduler`,`manual`) + user id |
| `total_processed` | int |
| `total_skipped` | int |
| `total_errors` | int |
| `metadata` | jsonb (фильтры, cursors) |

### Usage
- Связан с `StripePayment.processor_run_id`.  
- Логи предоставляют runId для корреляции.

## 3. ParticipantPaymentPlan

| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid |
| `deal_id` | string |
| `participant_id` | string |
| `product_id` | string |
| `expected_payments` | int (1 или 2) |
| `received_payments` | int |
| `balance_due_pln` | decimal |
| `last_payment_at` | timestamptz |
| `stage_id` | int (Pipedrive stage) |
| `company_country` | string(2) | Помогает определить VAT flow |

### State transitions
1. INIT (`received_payments=0`, stage_id=18 / First Payment)  
2. AFTER_FIRST (`received_payments=1` и `expected_payments=2`, stage_id=32 / Second Payment)  
3. COMPLETE (`received_payments>=expected_payments`, stage_id=27 / Camp waiter)  
4. REFUND (`balance_due_pln > 0` после возврата) — требует ручной проверки.

## 4. StripeDocument

| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid |
| `payment_id` | uuid FK -> StripePayment |
| `document_type` | enum(`receipt`,`confirmation`) |
| `source_url` | text |
| `mime_type` | string |
| `created_at` | timestamptz |

## 5. Deletion/Refund Log (reuse existing table)

| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid |
| `payment_id` | uuid FK |
| `deal_id` | string |
| `reason` | enum(`stripe_refund`,`wfirma_deleted`) |
| `amount` / `amount_pln` | decimal (отрицательные) |
| `logged_at` | timestamptz |
| `notes` | text (Stripe refund id) |

### Process
- При refund создаём запись в логах и обновляем связанные отчёты (месячный, продуктовый).  
- Для отчётов отрицательные суммы суммируются автоматически, сохраняя историю.

## 6. ProductLink (CRM ↔ Stripe ↔ Internal)

| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid PK | Используется как `product_id` во всех платёжных таблицах |
| `crm_product_id` | string | ID продукта в Pipedrive |
| `crm_product_name` | string | Последнее известное название (для справки) |
| `stripe_product_id` | string | ID продукта в Stripe |
| `camp_product_id` | string | Существующий internal id (если уже есть в БД) |
| `created_at` / `updated_at` | timestamptz | Аудит изменений |
| `status` | enum(`active`,`archived`) | Позволяет маппить старые сделки |
| `default_tax_behavior` | enum(`inclusive`,`exclusive`,`none`) | Предпочтительный режим VAT |

### Usage
- Любой платёж/отчёт хранит только `product_link_id` → названия подставляются по актуальным данным.  
- При переименовании CRM продукта запись в ProductLink обновляет `crm_product_name`, сохраняя связь.  
- Stripe Checkout Session metadata содержит `product_link_id` или `crm_product_id`, и процессор резолвит на ProductLink.

