# Implementation Plan: Hybrid Cash + Bank Payments

## Scope & Goals
- Поддержать сценарии «проформа + наличные», «Stripe + наличные» и полностью наличные оплаты без попадания наличных в официальные VAT/продуктовые отчёты.
- Добавить учёт наличных в CRM и управленческих отчётах (P&L, внутренний «кассовый журнал»).
- Обеспечить аудит, права доступа и оперативный контроль статусов наличных платежей.

## Phase 0 — Foundations & Alignment
1. **Finalize field contracts**
   - Забронировать Pipedrive поле `cash_amount` (deal level) и документировать возможные диапазоны, валюты, обязательность.
   - Уточнить ключи кастомных полей (например, `cash_received_amount`, «Cash status») и добавить их в `.env.example`.
2. **Inventory current flows**
   - Описать, какие сервисы сейчас создают проформы/Stripe-платежи: `invoiceProcessing`, `stripe/processor`, `vatMargin`.
   - Зафиксировать точки, где нужно считать `bank_total`.
3. **Security & permissions**
   - Определить роли «Manager»/«Cashier» в Supabase Auth (или текущей ACL модели).

## Phase 1 — Data Model & Storage
1. **Supabase schema changes**
   - Создать таблицу `cash_payments` (id, proforma_id, deal_id, amount, currency, fx_rate_pln, received_date, received_by, confirmed_by, status, source, comments, created_at, updated_at).
   - Создать таблицу `cash_payment_events` (для аудита действий).
   - Добавить таблицу `cash_refunds` (link cash_payment_id, amount, currency, reason, processed_by, processed_at).
   - Обновить `proformas` (или `proforma_summary`) полями `payments_total_cash`, `payments_total_bank`.
   - Добавить материализованный view `cash_summary_monthly` для агрегатов по продукту/месяцу.
2. **Migrations & seed scripts**
   - Написать миграции (SQL/Knex) с откатом.
   - Подготовить seed для тестовых данных (интеграционные тесты).
3. **P&L integration groundwork**
   - Расширить `pnl_revenue_entries` новой категорией `cash`.
   - Добавить foreign key `cash_payment_id` (nullable) для связи с журналом.

## Phase 2 — CRM & Trigger Workflow
1. **Pipedrive deal hooks**
   - Обновить `src/services/pipedrive.js` / `webhooks` для чтения `cash_amount` и `cash_status`.
   - Если `cash_amount > 0`, создавать задачу «Получить наличные» и записывать ожидание в Supabase (`cash_expected_amount`).
2. **Manual action: “Получили наличные”**
   - Добавить endpoint `POST /api/cash-payments` (auth: Manager/Cashier) → создает запись в `cash_payments` и ставит статус `pending_confirmation`.
   - Поддержать опциональный источник: `deal`, `proforma`, `stripe_session`.
3. **Automation hooks**
   - В `invoiceProcessing.processDealInvoice` и Stripe-пайплайне после успешного безнала вызывать `cashWorkflow.scheduleRemainder()` если `cash_amount` задан.
   - Автозакрытие стадии сделки, когда cash подтвержден (опционально конфиг).

## Phase 3 — Cash Confirmation & Audit
1. **Confirmation endpoint**
   - `PATCH /api/cash-payments/:id/confirm` → только для Cashier/Admin, фиксирует `cash_received_amount`, дату и пользователя.
   - Поддержать частичное подтверждение/коррекцию.
2. **Refund handling**
   - Endpoint `POST /api/cash-refunds` → привязка к cash_payment, изменение статуса на `refunded`.
   - Синхронизация с deal stage (например, возврат → reopen).
3. **Audit log**
   - Middleware, который пишет действия в `cash_payment_events`.
   - В логах указывать источник вызова (API, scheduler, manual script).

## Phase 4 — Reporting & UI
1. **VAT Margin Tracker UI**
   - Новая кнопка «Добавить наличный платёж» в карточке проформы (использует API Phase 2).
   - Плашки в summary («Bank: X PLN / Cash: Y PLN / Total: Z PLN»).
   - Indicator если cash ожидался, но не подтверждён.
2. **Cash Journal**
   - Страница/таб «Наличные» в админке: фильтры по продукту, кассиру, статусам; экспорт CSV.
   - Детальная карточка платежа (история изменений, связанные сделки/проформы).
3. **P&L updates**
   - При подтверждении кэша создавать запись в `pnl_revenue_entries` с категорией `cash`.
   - Обновить отчёт «Приходы — Наличные» в UI/экспорт.

## Phase 5 — Stripe + Cash Hybrid Support
1. **Metadata contract**
   - При создании Stripe Checkout Session записывать ожидаемый `cash_amount` (metadata) и ID пользователя.
2. **Post-Stripe orchestration**
   - В `stripe/processor` после успешного депозита: создавать запись ожидания cash (если в metadata > 0).
3. **Notifications**
   - Slack/email уведомление для кассы, когда требуется получить наличный хвост.

## Phase 6 — Testing & QA
1. **Unit tests**
   - Сервисы: `cashPaymentsService`, `cashWorkflow`, P&L sync adapters.
   - Permission guards.
2. **Integration tests**
   - Scenarios:
     - Прямой кэш (без проформы).
     - Проформа bank + cash.
     - Stripe депозит + cash остаток.
     - Возврат наличных.
3. **E2E smoke**
   - Скрипт `scripts/runCashFlowDemo.js` (seed → simulate CRM trigger → API calls → verify Supabase data).

## Phase 7 — Deployment & Ops
1. **Feature flags**
   - Env `ENABLE_CASH_PAYMENTS` для плавного включения.
2. **Monitoring**
   - Добавить алерты (Render / Supabase) по ошибкам cash API.
3. **Docs & training**
   - Обновить `README`, `docs/pipedrive-automations-setup.md`, `VAT-Margin user guide`.
   - Провести сессию для менеджеров (гайды по вводу наличных).

## Deliverables Checklist
- [ ] SQL миграции и Supabase schema docs.
- [ ] Новые API endpoints + Swagger/OpenAPI описание.
,- [ ] Cash journal UI + VAT Margin интеграция.
- [ ] CRM trigger updates и webhook обработчики.
- [ ] P&L автоматизация для наличных.
- [ ] Тесты (unit, integration, e2e) и скрипты для демонстрации.
- [ ] Обновлённые инструкции и runbook по инцидентам.
