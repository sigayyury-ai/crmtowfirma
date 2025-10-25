# Data Model: VAT маржа — сопоставление платежей

## BankTransaction
- **id**: UUID записи обработки
- **bookingDate**: дата проводки из CSV
- **operationDate**: дата операции
- **operationType**: тип операции (PRZELEW, ZAKUP и т.п.)
- **title**: поле `#Tytuł`, содержит номер проформы
- **description**: подробное описание/отправитель
- **accountNumber**: номер счёта отправителя
- **amountRaw**: строковое значение суммы из CSV (`1 055,00`)
- **amountPLN**: числовое значение в PLN (float)
- **currency**: валюта (для MVP — PLN)
- **proformaNumber**: найденный номер (например, `CO-PROF 16/2025`) или `null`
- **matchStatus**: `matched`, `manual`, `duplicate`, `missing`
- **proformaId**: ID проформы в wFirma (если найден)
- **productName**: продукт из проформы (если найден)
- **expectedAmount**: ожидаемая сумма из проформы (PLN)
- **difference**: `amountPLN - expectedAmount`
- **notes**: комментарии обработки (например, «найдено несколько совпадений»)
- **jobId**: идентификатор загрузки CSV (для группировки)

## ProformaMatch
- **proformaId**: ID проформы wFirma
- **proformaNumber**: `CO-PROF NN/YYYY`
- **productName**: описание/продукт проформы
- **expectedAmount**: сумма в PLN
- **payments**: массив ссылок на `BankTransaction`
- **status**: `paid`, `partial`, `overpaid`, `missing`
- **difference**: `sum(payments.amountPLN) - expectedAmount`
- **issueFlags**: массив меток (`missing_payment`, `extra_payment`, `duplicate_number`)

## ProductMonthlyAggregate
- **productName**
- **month**: `YYYY-MM`
- **expectedTotal**: сумма проформ (ожидаемая)
- **actualTotal**: сумма фактических платежей
- **difference**: `actualTotal - expectedTotal`
- **paidCount**: количество проформ со статусом `paid`
- **partialCount**: количество проформ со статусом `partial`
- **openCount**: проформы без платежей
- **currency**: PLN

## ManualReviewItem
- **id**: UUID
- **transactionId**: ссылка на `BankTransaction`
- **reason**: `no_proforma`, `multiple_matches`, `amount_mismatch`
- **suggestedProformas**: список номеров/ID (если есть кандидаты)
- **productOptions**: список продуктов (при необходимости)
- **assignedBy**: пользователь, который обработал
- **decision**: `completed`, `pending`
- **decisionNotes**: комментарий
- **decisionDate**

## ProcessJob (в памяти)
- **jobId**: UUID загрузки
- **uploadedBy**: пользователь (email)
- **uploadedAt**
- **fileName**
- **statistics**: { totalRows, matched, manual, duplicates, errors }
- **transactions**: массив `BankTransaction`
- **aggregates**: массив `ProductMonthlyAggregate`
- **manualQueue**: массив `ManualReviewItem`

## Mapping & Relationships
- Один `ProcessJob` содержит множество `BankTransaction`.
- `BankTransaction` может ссылаться на `ProformaMatch` (через `proformaId`).
- `ProformaMatch` агрегирует одну проформу и связанные платежи.
- `ProductMonthlyAggregate` строится из `ProformaMatch` и их статусов.
- `ManualReviewItem` относится к `BankTransaction`, требующему действий.
