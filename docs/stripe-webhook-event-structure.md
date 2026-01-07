# Структура Stripe Webhook Event

## Параметры, передаваемые в webhook

Согласно официальной документации Stripe, каждый webhook event содержит следующие поля:

### Основные поля

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | string | Уникальный идентификатор события (начинается с `evt_...`) |
| `object` | string | Тип объекта, всегда `"event"` |
| `type` | string | Тип события (например, `checkout.session.completed`, `payment_intent.succeeded`) |
| `api_version` | string | Версия Stripe API, использованная при создании события |
| `created` | number | Unix timestamp создания события |
| `livemode` | boolean | `true` для live mode, `false` для test mode |
| `pending_webhooks` | number | Количество ожидающих обработку webhook'ов |
| `data` | object | Объект с данными события |
| `request` | object | Информация о запросе, инициировавшем событие |

### Поле `data`

Содержит объект события:

```json
{
  "data": {
    "object": {
      // Данные объекта события (например, Checkout Session, Payment Intent и т.д.)
      "id": "cs_...",
      "object": "checkout.session",
      // ... другие поля объекта
    },
    "previous_attributes": {
      // Измененные атрибуты (только для update событий)
    }
  }
}
```

### Поле `request`

Содержит информацию о запросе:

```json
{
  "request": {
    "id": "req_...",
    "idempotency_key": "..." // Опционально
  }
}
```

## Пример полной структуры

```json
{
  "id": "evt_1A2B3C4D5E6F7G8H9I0J",
  "object": "event",
  "api_version": "2024-04-10",
  "created": 1672531200,
  "data": {
    "object": {
      "id": "cs_live_...",
      "object": "checkout.session",
      "payment_status": "paid",
      "status": "complete",
      // ... другие поля Checkout Session
    }
  },
  "livemode": true,
  "pending_webhooks": 1,
  "request": {
    "id": "req_1A2B3C4D5E6F7G8H9I0J",
    "idempotency_key": "a1b2c3d4e5f6g7h8i9j0"
  },
  "type": "checkout.session.completed"
}
```

## ⚠️ Важно: Endpoint ID НЕ передается

**Endpoint ID** (начинается с `we_...`, например `we_1SXMcUBXP7ZF0H8RKWUimiqC`) **НЕ включается** в payload webhook события.

Endpoint ID используется только:
- В Stripe Dashboard для настройки webhook endpoint'ов
- В Stripe API для управления endpoint'ами
- Для получения информации о endpoint через API

### Как проверить, что webhook пришел с правильного endpoint'а?

Единственный способ проверить, что webhook пришел с нужного endpoint'а — это **верификация подписи**:

1. Каждый webhook endpoint имеет **уникальный signing secret** (начинается с `whsec_...`)
2. Если верификация подписи проходит успешно с вашим `STRIPE_WEBHOOK_SECRET`, значит webhook пришел с того endpoint'а, для которого был настроен этот secret
3. Если верификация не проходит, значит либо:
   - Используется неправильный secret
   - Webhook пришел с другого endpoint'а
   - Тело запроса было изменено (например, прокси)

## Наш endpoint

- **Endpoint ID**: `we_1SXMcUBXP7ZF0H8RKWUimiqC`
- **Endpoint URL**: `https://invoices.comoon.io/api/webhooks/stripe`
- **Signing Secret**: `whsec_3C20MQTOYRefcc0VMTOV6PWB507KHEwF`

Если верификация подписи проходит успешно с этим secret, значит webhook точно пришел с этого endpoint'а.

## Ссылки

- [Официальная документация Stripe: Webhook Events](https://stripe.com/docs/api/events/object)
- [Официальная документация Stripe: Webhook Signatures](https://stripe.com/docs/webhooks/signatures)

