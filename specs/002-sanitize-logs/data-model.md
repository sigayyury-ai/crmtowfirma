# Data Model

## LogEntry
- `level`: string (info, success, warning, error)
- `timestamp`: ISO string
- `message`: original текст сообщения
- `context`: объект с доп. полями (service, requestId, userId)
- `metadata`: объект (durationMs, statusCode, correlationId)
- `sanitizedMessage`: строка после маскировки
- `maskedFields`: массив `SanitizedField`

## SanitizedField
- `type`: enum (EMAIL, PHONE, TOKEN, PROFORMA_NUMBER, AMOUNT)
- `originalLength`: number
- `replacement`: string (например `***masked***`)
- `pattern`: регулярное выражение, вызвавшее маскировку

## IncidentCounter
- `totalMasked`: number
- `maskedByType`: словарь `{ type: count }`
- `latestIncidents`: массив ссылок на `SanitizedField` (ограничено N)

## IncidentReport
- `generatedAt`: ISO string
- `totalIncidents`: number
- `incidents`: массив объектов `{ timestamp, messageId, type, replacement }`
- `exportFormat`: string (`json` | `csv`)

## SanitizerConfig
- `enabled`: boolean
- `devVerbose`: boolean
- `patterns`: словарь `{ type: RegExp }`
- `amountThreshold`: number (порог округления)
- `maxIncidents`: number (лимит для предупреждений)
