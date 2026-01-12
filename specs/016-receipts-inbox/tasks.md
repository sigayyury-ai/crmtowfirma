# Задачи: 016-receipts-inbox

## UI (1–2 дня)

### FE-001: Добавить саб-таб “Чеки” в разделе “Платежи”
- В `frontend/vat-margin.html` добавить кнопку саб-таба `data-payments-tab="receipts"`
- Добавить секцию-контейнер для контента

### FE-002: Одна кнопка загрузки
- File input + кнопка “Загрузить документ”
- Ограничение по accept: `.heic,.heif,.jpg,.jpeg,.pdf`
- Отображение состояния загрузки/ошибки/результата

### FE-003: Отображение результата матчинга
- Показывать: распознанные поля (если есть), кандидатов платежей (top N)
- Клик по кандидату → подтверждение привязки
- Кнопка/ссылка “Отвязать” (минимальная)

## Backend (2–4 дня)

### BE-001: Таблицы Supabase
- `receipt_uploads`
- `receipt_extractions`
- `receipt_payment_links`
- индексы (по `uploaded_at`, `payment_id`)

### BE-002: Upload endpoint
- `POST /api/receipts/upload` (multipart)
- Валидации: формат/размер
- Сохранение файла (storage) + запись в БД

### BE-003: Extract + match (v1)
- Извлечь сумму/валюту/дату/вендор (через AI/vision или fallback)
- Посчитать кандидатов по `payments`
- Вернуть top N с `score` и `reason`

### BE-004: Confirm / unlink
- `POST /api/receipts/:id/link-payment`
- `DELETE /api/receipts/:id/link-payment`
- Аудит: `linked_by`, `linked_at`

### BE-005: Получение деталей receipt
- `GET /api/receipts/:id` для UI (метаданные + extraction + кандидаты + link)

## Observability & Safety (0.5–1 день)

### OBS-001: Логи
- Логировать: upload, size/mime, receipt_id, статус обработки, ошибки
- Не логировать содержимое документов

### SEC-001: Доступ к файлам
- Отдавать документы через подписанные ссылки или проксировать скачивание
- Не делать публичные URL без контроля

## Tests (0.5–1.5 дня)

### TEST-001: Unit на скоринг кандидатов
- Сумма/дата/валюта/текст
- Коллизии одинаковых сумм

### TEST-002: Smoke checklist
- JPG / PDF / HEIC
- “кандидаты не найдены”
- confirm + unlink

