# План реализации: 016-receipts-inbox

**Date**: 2026-01-12  
**Spec**: `specs/016-receipts-inbox/spec.md`

## Summary

Добавить в разделе “Платежи” отдельный саб-таб “Чеки” с одной кнопкой загрузки (HEIC/JPG/PDF) и реализовать сценарий B: документ загружается в “инбокс”, система извлекает поля и предлагает кандидатов банковских платежей для привязки; пользователь подтверждает.

## Technical Context (current repo)

- **Frontend**: `frontend/vat-margin.html` + `frontend/vat-margin-script.js` (таб “Платежи” уже имеет саб-табы).
- **Backend**: `src/routes/api.js` (уже есть `multer` и endpoints для payments).
- **Storage**: Supabase (DB). Для файлов — Supabase Storage (предпочтительно) или DB-only (нежелательно).
- **AI**: есть `src/services/ai/openAIService.js` (уже используется для категоризации расходов; можно расширять для OCR/vision).

## Proposed Architecture

### Data model (Supabase)

Таблицы:

- `receipt_uploads`
  - `id` UUID PK
  - `storage_bucket` TEXT
  - `storage_path` TEXT
  - `original_filename` TEXT
  - `mime_type` TEXT
  - `size_bytes` BIGINT
  - `uploaded_by` TEXT NULL
  - `uploaded_at` TIMESTAMPTZ DEFAULT now()
  - `status` TEXT (`uploaded` | `processing` | `matched` | `failed`)
  - `deleted_at` TIMESTAMPTZ NULL (опционально)
- `receipt_extractions`
  - `id` UUID PK
  - `receipt_id` UUID FK → `receipt_uploads.id`
  - `status` TEXT (`queued` | `processing` | `done` | `failed`)
  - `extracted_json` JSONB (vendor/date/amount/currency + confidence + raw_text optional)
  - `error` TEXT NULL
  - `created_at`, `updated_at`
- `receipt_payment_links`
  - `id` UUID PK
  - `receipt_id` UUID FK → `receipt_uploads.id` UNIQUE
  - `payment_id` (тип как в `payments.id`)
  - `linked_by` TEXT NULL
  - `linked_at` TIMESTAMPTZ DEFAULT now()

### Matching logic (v1)

Скоринг кандидатов по `payments`:

- фильтр по валюте (если извлечена)
- окно по дате: ±0..3 дня (настраиваемо)
- сумма: точное совпадение/толеранс (настраиваемый, напр. 0.01–5)
- текст: совпадение vendor ↔ `payer_name`/`description` (если есть)

Возвращать top-N (например 10) с полями: `payment_id`, `operation_date`, `amount`, `currency`, `description`, `score`, `reason`.

### HEIC handling

Варианты:

- **A (предпочтительно)**: сервер конвертирует HEIC → JPEG перед OCR/vision (и сохраняет оба файла или только конвертированный для обработки).
- **B**: если конвертация недоступна, сохраняем оригинал и помечаем статусом “needs_conversion/failed” с понятным сообщением.

## API Plan (new endpoints)

- `POST /api/receipts/upload` (multipart `file`) → создаёт `receipt_uploads`, кладёт файл в storage, запускает обработку/матчинг, возвращает `receipt_id` + статус + кандидаты (если успели).
- `GET /api/receipts/:id` → детали: метаданные, извлеченные поля, кандидаты, текущее состояние линка.
- `POST /api/receipts/:id/link-payment` body `{ paymentId }` → подтверждение кандидата (создаёт/обновляет `receipt_payment_links`).
- `DELETE /api/receipts/:id/link-payment` → отвязать.

## Frontend Plan (Payments → subtab “Чеки”)

- Добавить кнопку “Загрузить документ” (input file accept: `.heic,.heif,.jpg,.jpeg,.pdf`).
- После загрузки показывать:
  - статус обработки,
  - извлеченные поля (если есть),
  - список кандидатов (клик по строке = confirm).

## Testing Plan

- Smoke:
  - загрузка JPG/PDF/HEIC (HEIC: ожидаем корректное поведение в соответствии с выбранной стратегией)
  - кейс “нет кандидатов”
  - подтверждение и отмена привязки
- Unit:
  - скоринг кандидатов (pure function)
  - валидации форматов/размера

