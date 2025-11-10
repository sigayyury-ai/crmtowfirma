# API Contracts: Отчет по мероприятиям (Stripe)

Дата: 2025-11-10  
Основано на: `spec.md`, `plan.md`, `research.md`

## Общие соглашения

- Базовый префикс: `/api/reports/stripe-events`
- Все эндпоинты защищены middleware авторизации; требуется роль `finance`.
- Ответы в формате JSON, поле `success` (boolean) и `data`/`error`.
- Даты в UTC, ISO8601.
- Все суммы в валюте отчета (PLN по умолчанию), точность — 2 знака после запятой.
- Параметр `eventKey` — URL-encoded строка, полученная из `line_item.description`.

## 1. Получить список мероприятий (summary)

**Endpoint**: `GET /api/reports/stripe-events/summary`

**Query параметры**:

| Параметр | Тип | Обязательный | Описание |
|----------|-----|--------------|----------|
| `from` | string (ISO8601) | Нет | Начало периода фильтра (UTC). |
| `to` | string (ISO8601) | Нет | Конец периода. |
| `limit` | integer | Нет (default 50) | Максимум мероприятий, 1–200. |
| `startingAfter` | string | Нет | Cursor (eventKey) для постраничной выборки. |

**Пример ответа**:

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "eventKey": "event-summer-retreat",
        "eventLabel": "Summer Retreat 2025",
        "currency": "PLN",
        "grossRevenue": 18850.00,
        "participantsCount": 18,
        "paymentsCount": 20,
        "lastPaymentAt": "2025-06-12T10:15:42Z",
        "warnings": []
      }
    ],
    "pageInfo": {
      "limit": 50,
      "hasMore": false,
      "nextCursor": null
    }
  }
}
```

**Ошибки**:
- `400 INVALID_RANGE` — если `from > to` или период > 1 года.
- `401 UNAUTHORIZED`, `403 FORBIDDEN` — нарушения доступа.
- `500 STRIPE_ERROR` — при проблемах с API.

## 2. Получить детальный отчет по мероприятию

**Endpoint**: `GET /api/reports/stripe-events/:eventKey`

**Query параметры**:

| Параметр | Тип | Обязательный | Описание |
|----------|-----|--------------|----------|
| `from` | string | Нет | Ограничение по дате платежа «не ранее». |
| `to` | string | Нет | Ограничение по дате платежа «не позднее». |

**Пример ответа**:

```json
{
  "success": true,
  "data": {
    "eventReport": {
      "eventKey": "event-summer-retreat",
      "eventLabel": "Summer Retreat 2025",
      "currency": "PLN",
      "period": { "from": "2025-05-01", "to": "2025-06-30" },
      "totalSessions": 12,
      "totalLineItems": 12,
      "warnings": [],
      "expenses": {
        "inputAmount": 9102.66,
        "perParticipant": 1300.38,
        "details": [
          { "category": "Продукты", "amount": 1375.64 },
          { "category": "Транспорт", "amount": 227.02 },
          { "category": "Аренда", "amount": 7500.00 }
        ],
        "currency": "PLN"
      },
      "participants": [
        {
          "participantId": "artur@example.com",
          "displayName": "Артур",
          "email": "artur@example.com",
          "paymentsCount": 1,
          "totalAmount": 680.00,
          "averageAmount": 680.00,
          "expenseShare": 1300.38,
          "margin": -620.38,
          "vatRate": 0.23,
          "vatDue": -142.69,
          "currency": "PLN",
          "notes": []
        }
      ],
      "totals": {
        "grossRevenue": 179.00,
        "expenses": 9102.66,
        "margin": -8923.66,
        "vatRate": 0.23,
        "vatDue": -2052.44,
        "participantsCount": 7,
        "sessionsCount": 12
      },
      "generatedAt": "2025-11-10T10:15:00Z"
    }
  }
}
```

**Ошибки**:
- `404 EVENT_NOT_FOUND` — нет платежей с таким ключом.
- `409 MULTI_CURRENCY` — присутствует смесь валют (если выбрана политика блокировки).
- `500 STRIPE_ERROR` — ошибки Stripe.

## 3. Сохранить/обновить расходы

**Endpoint**: `POST /api/reports/stripe-events/:eventKey/expenses`

**Тело запроса**:

```json
{
  "amount": 9102.66,
  "currency": "PLN",
  "details": [
    { "category": "Продукты", "amount": 1375.64 },
    { "category": "Транспорт", "amount": 227.02 },
    { "category": "Аренда", "amount": 7500.00 }
  ]
}
```

- `amount` — обязательный, > 0.
- `currency` — по умолчанию `PLN`, при несовпадении с валютой отчета возвращается предупреждение.
- `details` — опциональны; сумма элементов должна равняться `amount` (допускается расхождение ≤ 0.01).

**Пример ответа**:

```json
{
  "success": true,
  "data": {
    "eventKey": "event-summer-retreat",
    "expenses": {
      "inputAmount": 9102.66,
      "perParticipant": 1300.38,
      "currency": "PLN",
      "details": [
        { "category": "Продукты", "amount": 1375.64 },
        { "category": "Транспорт", "amount": 227.02 },
        { "category": "Аренда", "amount": 7500.00 }
      ]
    },
    "totals": {
      "grossRevenue": 179.00,
      "expenses": 9102.66,
      "margin": -8923.66,
      "vatDue": -2052.44
    }
  }
}
```

**Ошибки**:
- `400 INVALID_AMOUNT` — отрицательная сумма или NaN.
- `400 DETAILS_MISMATCH` — сумма деталей не совпадает.
- `404 EVENT_NOT_FOUND`.

> Примечание: Расходы не сохраняются в постоянном хранилище. Сервер может держать значения в памяти на время сессии (или вернуть клиенту для последующей подачи при экспорте).

## 4. Экспорт отчета

**Endpoint**: `GET /api/reports/stripe-events/:eventKey/export`

**Query параметры**:

| Параметр | Тип | Обязательный | Описание |
|----------|-----|--------------|----------|
| `format` | enum (`csv`,`json`) | Нет (default `csv`) | Формат выгрузки. |
| `from` / `to` | string | Нет | Параметры как в `GET /:eventKey`. |

**Ответ**:

- `200` — бинарный ответ (`text/csv` или `application/json`) c заголовками `Content-Disposition: attachment; filename="event-summer-retreat.csv"`.
- `400` — неподдерживаемый формат.
- `404` — мероприятие не найдено.

### Структура CSV

```
Имя участника,Email,Сумма,Расходы,Маржа,VAT ставка,VAT к оплате
Артур,artur@example.com,680.00,1300.38,-620.38,23%,-142.69
...
Итого,,,9102.66,-8923.66,, -2052.44
```

## 5. Health-check Stripe связи (опционально)

**Endpoint**: `GET /api/reports/stripe-events/health`

**Назначение**: Быстрая проверка доступности Stripe API и корректности конфигурации ключа (используется DevOps/Support).

**Ответ**:

```json
{
  "success": true,
  "data": {
    "stripeStatus": "ok",
    "lastSuccessfulCallAt": "2025-11-10T09:00:00Z",
    "requiredScopes": ["checkout.sessions.read"],
    "warnings": []
  }
}
```

**Ошибки**:
- `503 STRIPE_UNAVAILABLE` — Stripe вернул ошибку подключения.
- `401/403` — отсутствуют нужные права (неверный ключ).

## Валидация запросов

- `eventKey`: string, 1–120 символов, только латиница/цифры/`-_/`.
- `amount`: number, > 0, максимум два знака после запятой.
- Все даты (`from`, `to`) проверяются на ISO8601 и что период не превышает 365 дней.
- На каждый запрос добавляется `X-Request-Id` (UUID), который возвращается в заголовках ответов и передается в Stripe.

## Логирование и наблюдаемость

- Для успешных ответов логируется `eventKey`, `durationMs`, `sessionsCount`, `participantsCount`, `warnings`.
- Для ошибок — `eventKey`, `error.code`, HTTP статус, `stripeRequestId` (если доступен).
- Логи не содержат email/имена в явном виде; допускается маска вида `a***@domain.com`.

## Ограничения и квоты

- Считаем лимит: до 500 line items за отчёт. При превышении возвращается `413 REPORT_TOO_LARGE`.
- Повторные запросы к тому же мероприятию внутри 15 минут могут обслуживаться из кеша (заголовок `X-Cache: HIT/MISS`).

## Нерешённые вопросы (для Phase 2)

- Нужно ли долговременное хранение расходов и кто будет источником правды.
- Требуется ли аудит экспортов (журнал действий пользователей).
- Формат выгрузки Excel (`xlsx`) — потенциальное расширение.

