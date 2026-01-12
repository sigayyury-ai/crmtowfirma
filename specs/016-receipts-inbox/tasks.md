# Задачи: 016-receipts-inbox

## UI (1–2 дня)

### FE-001: Добавить саб-таб “Чеки” в разделе “Платежи”
- В `frontend/vat-margin.html` добавить кнопку саб-таба `data-payments-tab="receipts"`
- Добавить секцию-контейнер для контента
- В `frontend/vat-margin-script.js`:
  - расширить `togglePaymentsSubtab()` чтобы знал про `receipts`
  - добавить URL mapping для саб-таба (например `/vat-margin/receipts`)

### FE-002: Одна кнопка загрузки
- File input + кнопка “Загрузить документ”
- Ограничение по accept: `.heic,.heif,.jpg,.jpeg,.pdf`
- Mobile: опционально `capture="environment"` чтобы открывать камеру
- Отображение состояния загрузки/ошибки/результата

### FE-003: Отображение результата матчинга
- Показывать: распознанные поля (если есть), кандидатов платежей (top N)
- Клик по кандидату → подтверждение привязки
- Кнопка/ссылка “Отвязать” (минимальная)
- Кнопка/ссылка “Удалить чек” (soft delete)
- Для PDF: явно показывать “обработана 1-я страница” (V1) или количество страниц (если доступно)

## Backend (2–4 дня)

### BE-001: Таблицы Supabase
- `receipt_uploads`
- `receipt_extractions`
- `receipt_payment_links`
- индексы (по `uploaded_at`, `payment_id`)
 - добавить дедуп поля: `sha256`, `duplicate_of`

### BE-002: Upload endpoint
- `POST /api/receipts/upload` (multipart)
- Валидации: формат/размер
- Сохранение файла (storage) + запись в БД
- Mobile-friendly: быстрый ответ `202` + polling (не держать длинный запрос)
 - Дедуп: если `sha256` уже существует → вернуть оригинал/создать дубль с `duplicate_of`

### BE-003: Extract + match (v1)
- Извлечь сумму/валюту/дату/вендор (через AI/vision или fallback)
- Посчитать кандидатов по `payments`
- Вернуть top N с `score` и `reason`

### BE-004: Confirm / unlink
- `POST /api/receipts/:id/link-payment`
- `DELETE /api/receipts/:id/link-payment`
- Аудит: `linked_by`, `linked_at`
 - Перепривязка: link на другой paymentId должен заменять существующий link (с аудитом)

### BE-005: Получение деталей receipt
- `GET /api/receipts/:id` для UI (метаданные + extraction + кандидаты + link)

### BE-006: Delete receipt (retention)
- `DELETE /api/receipts/:id`:
  - soft delete метаданных
  - сделать файл недоступным (удалить/переместить/закрыть доступ)

## Observability & Safety (0.5–1 день)

### OBS-001: Логи
- Логировать: upload, size/mime, receipt_id, статус обработки, ошибки
- Не логировать содержимое документов

### SEC-001: Доступ к файлам
- Отдавать документы через подписанные ссылки или проксировать скачивание
- Не делать публичные URL без контроля

## Data research / constraints (to implement correctly)

### DATA-001: Уточнить тип `payments.id` в Supabase

В коде `payments.id` используется как integer (через `parseInt`), но в Supabase схема должна быть подтверждена.
Это влияет на тип поля `receipt_payment_links.payment_id`.

## Tests (0.5–1.5 дня)

### TEST-001: Unit на скоринг кандидатов
- Сумма/дата/валюта/текст
- Коллизии одинаковых сумм

### TEST-002: Smoke checklist
- JPG / PDF / HEIC
- “кандидаты не найдены”
- confirm + unlink

