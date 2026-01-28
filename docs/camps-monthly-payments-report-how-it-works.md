# Отчёт по кемпам / платежам / месяцам — как работает агрегация

Этот документ фиксирует, **где в проекте находятся отчёты** и **как именно агрегируются входящие поступления** (банк + Stripe + Stripe Events) и **как исключаются возвраты**.

## Что именно есть в проекте

### 1) Отчёт по месяцам (PNL / “Месячные приходы”)

- **UI страница**: `frontend/pnl-report.html`
- **Фронт-логика**: `frontend/pnl-report-script.js` *(файл большой; UI вызывает API и рендерит таблицы/вкладки)*
- **Бэкенд агрегации**: `src/services/pnl/pnlReportService.js`
- **Спецификация**: `specs/011-pnl-report/spec.md`
- **Док по модели/агрегации**:
  - `specs/011-pnl-report/data-model.md`
  - `specs/011-pnl-report/research.md`

**Суть**: строит **помесячные** суммы приходов (в PLN), собирая **все входящие** (bank + stripe + cash), с правилами фильтрации и исключением возвратов.

### 2) Отчёт по платежам/кемпам (группировка по продуктам / `camp_product_id`)

- **Основной сервис агрегации**: `src/services/vatMargin/paymentRevenueReportService.js`

**Суть**: собирает входящие платежи (bank + stripe + stripe_event) за диапазон дат и группирует по “продукту/кемпу”, используя:
- продукт из проформ (`proformas.proforma_products.products`)
- `product_links.camp_product_id` для корректной привязки Stripe платежей к продукту/кемпу
- каталог `products`

## Как PNL агрегирует “все входящие поступления” (помесячно)

Ключевая функция: `PnlReportService.getMonthlyRevenue(year, includeBreakdown)`
в `src/services/pnl/pnlReportService.js`.

### 1) Источники данных

#### 1.1) Банковские платежи (таблица `payments`)

Правила загрузки:
- `direction = 'in'` (только входящие)
- `deleted_at is null` (не удалённые)
- `operation_date` в границах выбранного года (UTC)

Поля, которые используются в агрегации: `operation_date`, `amount`, `currency`, `manual_status`, `match_status`, `proforma_id`, `income_category_id`.

#### 1.2) Stripe платежи

Stripe платежи берутся через репозиторий `StripeRepository` (внутренний слой доступа к данным Stripe/БД).

Критично:
- учитываются только `payment_status === 'paid'`
- дата платежа для отчёта берётся из `created_at` (как “фактическая дата платежа”), а не `processed_at` (дата синка)

#### 1.3) Наличные (hybrid cash payments)

Добавляются платежи из таблицы `cash_payments` со статусом `status='received'`, дата берётся как:
`confirmed_at` (если есть) иначе `expected_date` иначе `created_at`.

Далее они добавляются в категорию “Наличные” (либо fallback по названию).

### 2) Какие платежи считаются “обработанными” (processed)

Логика в `filterProcessedPayments()`:
- **bank**: `manual_status === 'approved'` **или** `match_status === 'matched'`
- **stripe**: `stripe_payment_status === 'paid'`
- `facebook_ads` исключаются (не реальные банковские транзакции)

Дополнительно: категория “Возвраты” может быть включена как данные, но затем отсекается как refunded (см. ниже).

### 3) Как исключаются возвраты

PNL исключает возвраты двумя слоями:

1) Для Stripe: собирается `refundedPaymentIds` из `stripeRepository.listDeletions()` с причинами:
   - `deal_lost`
   - `stripe_refund`

2) Дальше все processed платежи фильтруются функцией `isPaymentRefunded(payment, refundedPaymentIds)`, которая проверяет:
   - `stripe_payment_status === 'refunded'` (для source=stripe)
   - payment.id / stripe_session_id находится в `refundedPaymentIds`

### 4) Как происходит агрегация по месяцам

- месяц определяется `extractMonthFromDate()` через `getUTCMonth()+1`
- сумма считается в PLN:
  - Stripe: использует `stripe_amount_pln` (если есть)
  - Bank: если есть `proforma_id`, то берёт `proformas.payments_total_pln` или конвертирует `amount * proformas.currency_exchange`
  - если валюта не PLN и нет проформы с курсом — payment может быть пропущен (PLN amount = null)

Далее суммы агрегируются:
- по категориям приходов (`income_category_id`) и месяцам
- затем строится итоговая помесячная сумма (sum по категориям)

## Как отчёт “по платежам/кемпам” агрегирует входящие и связывает с кемпами

Ключевой сервис: `PaymentRevenueReportService` в `src/services/vatMargin/paymentRevenueReportService.js`.

### 1) Источники входящих платежей

#### 1.1) Банковские платежи (`payments`)

Правила:
- `direction='in'`
- `deleted_at is null`
- дата в диапазоне (если задано)
- если статус-скоуп не `all`, то показываются только:
  - `manual_status = approved` **или** `match_status = matched`
- `manual_status = rejected` исключается всегда

#### 1.2) Stripe payments

Берётся через `stripeRepository.listPayments({ status: 'processed' })`, затем:
- исключаются refunded платежи (как и в PNL) по deletions:
  - `deal_lost`
  - `stripe_refund`
- Stripe платежи мапятся в унифицированную структуру “payments” и добавляются в общий список

#### 1.3) Stripe event items (`stripe_event_items`)

Синтетические “платежи” строятся из line items:
- источник `source='stripe_event'`
- сумма PLN берётся из `amount_pln`
- продукт пытается быть найден в каталоге `products`:
  - по `event_key` / `event_label` (строгий матч через нормализацию)
  - либо по `product_id` (если поле есть)

### 2) Как сервис “понимает кемп/продукт” (группировка)

Ключевой момент для Stripe:
- поле `stripe_product_id` в агрегируемых “платежах” — это **не Stripe product id**,
  а `product_links.id` (UUID), хранимый в `stripe_payments.product_id`.
- дальше сервис поднимает `product_links` через `stripeRepository.listProductLinksByIds(...)`
- и использует `product_links.camp_product_id` как реальный `products.id` (ID кемпа/продукта) для группировки.

Если `camp_product_id` отсутствует — сервис пытается делать fallback через сопоставление по имени, но это менее надёжно.

### 3) Утилиты для фикса связей `camp_product_id` (важно для “отчёта по кемпам”)

- `scripts/fix-product-link-camp-product-id.js`
  - пример точечной починки `camp_product_id` для конкретного продукта (например, NY2026)
- `scripts/updateProductLinkCampIds.js`
  - массовое обновление `camp_product_id` после мержа/дедупликации продуктов

## Где смотреть “док о том как работает”

- **PNL (месяцы, приходы, исключение возвратов)**:
  - `specs/011-pnl-report/spec.md`
  - `specs/011-pnl-report/data-model.md`
  - `specs/011-pnl-report/research.md`
- **Короткая проверка отчётов на 2026**:
  - `docs/year-2026-reports-check.md`

## Примечание про “ежемесячный отчёт по кемпам”

Сейчас в коде есть:
- **помесячный отчёт** (PNL) — но без обязательной разбивки “по кемпам/продуктам”
- **отчёт по продуктам/кемпам** (payment revenue report) — но на диапазон дат, а не “таблица month × camp”

Если нужен именно “month × camp”, логичнее всего расширять `PaymentRevenueReportService` (там уже корректная привязка Stripe к `camp_product_id`) и добавить агрегацию по месяцу поверх уже нормализованных платежей.

