# Implementation Tasks: Hybrid Cash + Bank Payments

**Feature**: 014-hybrid-cash-payments  
**Branch**: `014-hybrid-cash-payments`  
**Date**: 2025-11-23  
**Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

## Overview
Задачи организованы по фазам из плана. Каждая фаза завершается независимым тестом/демо-сценарием. До запуска разработки согласовать значения новых полей Pipedrive/Supabase и включить флаг `ENABLE_CASH_PAYMENTS` только на стейдже.

```
Phase 0 (Foundations)
      ↓
Phase 1 (Data Model)
      ↓
Phase 2 (CRM & Triggers)
      ↓
Phase 3 (Confirmation & Audit)
      ↓
Phase 4 (Reporting/UI)
      ↓
Phase 5 (Stripe Hybrid)
      ↓
Phase 6 (Testing)
      ↓
Phase 7 (Deploy/Ops)
```

---

## Phase 0 — Foundations & Alignment
**Goal**: Зафиксировать контракты полей и роли до написания кода.

- [ ] **T001** Собрать требования к полю `cash_amount` в Pipedrive (обязательность, валидации, подсказки) и задокументировать в `docs/pipedrive-automations-setup.md`.
- [ ] **T002** Получить/создать ключи кастомных полей (`cash_received_amount`, `cash_status`, `cash_expected_date`) и добавить их в `.env.example` + `config/customFields.js`.
- [ ] **T003** Обновить описание ролей (Manager/Cashier/Admin) в Supabase ACL, описать матрицу доступа в `docs/access-control.md`.
- [ ] **T004** Составить карту существующих потоков (Proforma/Stripe/VAT Margin) и отметить точки расчета `payments_total_bank` в `docs/architecture.md`.

**Independent test**: Чеклист полей и ролей согласован в Notion/Confluence, обновлённые env и docs присутствуют в репозитории.

---

## Phase 1 — Data Model & Storage
**Goal**: Добавить таблицы и представления для учёта наличных.

- [ ] **T010** Создать миграцию с таблицами `cash_payments`, `cash_payment_events`, `cash_refunds`, обновлениями `proformas` (`payments_total_cash`) и `pnl_revenue_entries` (категория `cash`, FK).
- [ ] **T011** Создать materialized view `cash_summary_monthly` + SQL в `supabase/migrations` для агрегации по продукту/месяцу.
- [ ] **T012** Добавить seed-скрипт `scripts/seedCashDemo.js`, создающий тестовые данные bank+cash.
- [ ] **T013** Обновить ORM/репозитории (`src/db/index.js` или аналог) методами для новых таблиц.

**Independent test**: `npm run migrate && node scripts/seedCashDemo.js` завершаетcя без ошибок; запросы к новым таблицам возвращают тестовые записи.

---

## Phase 2 — CRM & Trigger Workflow
**Goal**: Фиксировать ожидания наличных при создании проформ/Stripe и из CRM.

- [ ] **T020** Обновить `src/services/pipedrive.js`/webhooks: чтение `cash_amount`, запись `cash_expected_amount` в Supabase (таблица `deal_cash_expectations` или поле в `proformas`).
- [ ] **T021** Добавить endpoint `POST /api/cash-payments` (auth Manager/Cashier) → создаёт запись с `status=pending_confirmation`.
- [ ] **T022** Расширить `invoiceProcessing.processDealInvoice` и Stripe-пайплайн: при `cash_amount>0` создавать ожидание в новой таблице + логировать задачу.
- [ ] **T023** Добавить генерацию Pipedrive Activity/Note «Получить наличные» при создании ожидания.

**Independent test**: Создать сделку с `cash_amount`; после триггера в Supabase появляется запись ожидания, в CRM — activity, endpoint принимает ручной ввод cash-платежа (status pending).

---

## Phase 3 — Cash Confirmation & Audit
**Goal**: Подтверждать/корректировать наличные и вести аудит.

- [ ] **T030** Реализовать `cashPaymentsService` (create/update/confirm/refund helpers + валидации прав).
- [ ] **T031** Endpoint `PATCH /api/cash-payments/:id/confirm` (роль Cashier/Admin): фиксирует `cash_received_amount`, дату, пользователя, обновляет `payments_total_cash`.
- [ ] **T032** Endpoint `POST /api/cash-refunds` + `PATCH /api/cash-payments/:id/reopen` для возвратов/коррекции.
- [ ] **T033** Middleware аудита: все действия с cash пишутся в `cash_payment_events` (источник, payload snapshot).
- [ ] **T034** Хуки стадии сделок: при подтверждении наличных обновлять stage/labels в Pipedrive (если в конфиге включено).
- [ ] **T035** Обработка Pipedrive Activity: при закрытии задачи «Получить наличные» определять связанный `cash_payment` и автоматически ставить `status=received` (с фиксацией пользователя и даты).

**Independent test**: Через API создать cash-платёж, подтвердить, взять лог аудита (должна быть запись create+confirm). Провести возврат — статус меняется, stage в CRM обновляется.

---

## Phase 4 — Reporting & UI
**Goal**: Добавить UI-часть (VAT Margin + Cash Journal + P&L синхронизация).

- [ ] **T040** Расширить VAT Margin Tracker UI: кнопка «Добавить наличный платёж», бейджи Bank/Cash в summary, индикатор «ожидаем кэш».
- [ ] **T041** Создать Cash Journal (`frontend/cash-journal.html`, JS + API `GET /api/cash-payments?filters`), экспорт CSV.
- [ ] **T042** Добавить API `GET /api/cash-summary?period` (использует view `cash_summary_monthly`) для агрегатов.
- [ ] **T043** Интеграция с P&L: сервис, который при подтверждении кэша создаёт запись в `pnl_revenue_entries` с категорией `cash`.
- [ ] **T044** Документировать пользовательский поток (readme/guide) и добавить скриншоты UI.

**Independent test**: Пользователь через VAT Margin добавляет cash → запись видна в Cash Journal, summary обновляется, в P&L отчёте появляется строка «Приходы — Наличные» за месяц.

---

## Phase 5 — Stripe + Cash Hybrid Support
**Goal**: Поддержать сценарий «Stripe депозит + наличный остаток».

- [ ] **T050** Обновить создание Stripe Checkout Session: добавлять metadata `cash_amount`/`cash_due_date`.
- [ ] **T051** В `stripe/processor` после `checkout.session.completed` создавать ожидание cash и уведомление кассиру.
- [ ] **T052** Slack/Email уведомления (через `notifyService`): «Получить X PLN наличными по сделке Y».
- [ ] **T053** Сценарий автозакрытия: если cash подтверждён → отметить в Supabase, обновить stage в CRM.

**Independent test**: Прогнать Stripe тестовую оплату с metadata cash → система создаёт ожидание cash, отправляет уведомление, подтверждение закрывает остаток и обновляет сделку.

---

## Phase 6 — Testing & QA
**Goal**: Покрыть сервисы тестами и собрать e2e-демо.

- [ ] **T060** Unit tests: `cashPaymentsService`, `cashWorkflow`, ACL guard (Jest).
- [ ] **T061** Integration tests: API (`/api/cash-payments`, `/api/cash-summary`), миграции и P&L синхронизация (использовать тестовую БД).
- [ ] **T062** E2E скрипт `scripts/runCashFlowDemo.js`: создаёт сделку, проводит bank+cash, делает возврат; выводит summary в консоль.
- [ ] **T063** QA checklist (Notion/markdown) + ручные тесты на staging (разные роли, ошибки валидации, race conditions).

**Independent test**: Все тесты (`npm test`, `npm run test:integration`, `node scripts/runCashFlowDemo.js`) проходят; QA чеклист подписан.

---

## Phase 7 — Deployment & Ops
**Goal**: Безопасно включить фичу и настроить мониторинг.

- [ ] **T070** Добавить флаг `ENABLE_CASH_PAYMENTS` и конфиг `CASH_NOTIFICATIONS_CHANNEL`. Вывести его в `.env`, Helm/render configs.
- [ ] **T071** Подготовить runbook: что делать при ошибках оплаты/возврата, где искать логи/таблицы.
- [ ] **T072** Настроить мониторинг (Render alerts, Supabase row count) + Slack канал для ошибок cash API.
- [ ] **T073** Провести обучение менеджеров/кассиров (короткий Loom или живой созвон) и зафиксировать инструкции.

**Independent test**: Фича включена на staging → smoke OK, затем включена на прод; алерты приходят в Slack, runbook доступен, пользователи обучены.
