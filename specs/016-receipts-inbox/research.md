# Research Notes: 016-receipts-inbox

## Existing infrastructure: routes, auth, and where to register new endpoints

- **Express app entry**: `src/index.js`
  - API router mounted at **`app.use('/api', apiRoutes)`**.
  - Google auth (`requireAuth`) protects both the UI and API routes.
  - Therefore new endpoints for this feature should be added to **`src/routes/api.js`**; separate “registration” is not required beyond being part of that router.

## Existing UI entry point

Таб “Платежи” уже существует в `frontend/vat-margin.html` и управляется `frontend/vat-margin-script.js` через саб-табы (`data-payments-tab`).
Это позволяет добавить “Чеки” как ещё один саб-таб без создания новой страницы.

## Existing UI infrastructure details (functions & variables)

Файлы:

- `frontend/vat-margin.html` — основная страница с табами и саб-табами “Платежи”.
- `frontend/vat-margin-script.js` — контроллер.

Ключевые переменные/паттерны:

- `API_BASE = '/api'`
- `activeTab = 'payments'`
- `activePaymentsSubtab = 'incoming'`
- переключение саб-табов: `togglePaymentsSubtab(subtab, options)`
  - включает/выключает секции по `data-payments-tab`
  - обновляет URL path для саб-табов (incoming/outgoing/diagnostics)

Для “Чеки” (receipts) нужно:

- добавить `data-payments-tab="receipts"` в HTML
- добавить секцию `#payments-receipts`
- расширить `togglePaymentsSubtab()` чтобы знал про `receipts`
- добавить URL mapping для саб-таба (например `'/vat-margin/receipts'`)

## Existing backend primitives

- `src/routes/api.js` уже использует `multer` (memoryStorage) и имеет похожие загрузки (CSV).
- Supabase клиент используется с service role key (`src/services/supabaseClient.js`), что позволяет:
  - писать в таблицы,
  - работать с Supabase Storage (если включить в код).

## Data research: current DB tables we already rely on (payments pipeline)

### `payments` (bank CSV → normalized payments)

Поля, которые уже используются в коде (по существующим select/resolve):

- `id` (во многих местах парсится как integer)
- `operation_date`, `description`
- `amount`, `currency`, `direction` (`in`/`out`)
- `payer_name`, `payer_normalized_name`
- `source`, `operation_hash`, `import_id`
- `deleted_at` (soft delete)
- поля мэтчинга к проформе:
  - `match_status`, `match_confidence`, `match_reason`, `match_metadata`
  - `auto_proforma_id`, `auto_proforma_fullnumber`
  - `manual_status`, `manual_proforma_id`, `manual_proforma_fullnumber`, `manual_user`, `manual_updated_at`, `manual_comment`
- PNL поля:
  - `expense_category_id`, `income_category_id`

### `payment_imports`

Таблица истории загрузок CSV:

- `id`, `filename`, `uploaded_at`, `total_records`, `matched`, `needs_review`, `user_name`

Связь:

- `payments.import_id` → `payment_imports.id`

### `products` / `payment_product_links`

Существующий функционал “платёж → продукт” использует:

- `products`: `id`, `name`, `normalized_name`, `calculation_status`
- `payment_product_links`: `payment_id`, `product_id`, `direction`, `linked_by`, `linked_at`

Связь:

- `payment_product_links.payment_id` → `payments.id`
- `payment_product_links.product_id` → `products.id`

## AI capabilities in repo

Есть `src/services/ai/openAIService.js`, который использует `chat/completions`.
Для сценария B понадобится либо:

- модель/режим, который умеет работать с изображениями (vision) и/или OCR, либо
- отдельный OCR шаг + LLM для структурирования текста.

V1 можно сделать “без AI”: хранить документ и давать ручной выбор платежа; но по текущей задаче требуется сценарий B с автоподбором, значит минимум нужно извлечение суммы/даты/валюты.

## HEIC

HEIC требует конвертации/декодирования. Это может потребовать доп. зависимости или поддержки libvips с heif.
Вариант стратегии:

- если HEIC конвертируется на сервере — делаем это автоматически,
- если нет — сохраняем файл и явно показываем пользователю, что “HEIC не удалось обработать, попробуйте JPG/PDF”.

Спека требует поддержки HEIC, поэтому в реализации нужно заранее выбрать стратегию и протестировать в окружении.

## Mobile-first requirements (API & UI implications)

### API (route should be “mobile-friendly”)

На мобильных часто:

- хуже сеть и выше latency,
- “upload” легко обрывается,
- нельзя держать долгий HTTP запрос.

Поэтому для сценария B рекомендуется:

- `POST /api/receipts/upload`:
  - быстро отвечает (`202` + `receipt_id`) и запускает обработку асинхронно,
  - либо возвращает `200` если обработка успела быстро.
- `GET /api/receipts/:id`:
  - UI делает polling до финального статуса.

### UI (one button + camera/file picker)

Для `<input type="file">`:

- `accept=".heic,.heif,.jpg,.jpeg,.pdf,image/heic,image/heif,image/jpeg,application/pdf"`
- опционально `capture="environment"` для быстрого фото чека с камеры.


