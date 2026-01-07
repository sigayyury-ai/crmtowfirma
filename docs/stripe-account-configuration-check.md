# Проверка конфигурации Stripe кабинетов

## Проблема

Если в Events кабинете Stripe появляются клиенты и платежи, которые должны быть в основном кабинете, это означает, что в Render неправильно настроен `STRIPE_API_KEY`.

## Причина

`STRIPE_API_KEY` в Render указывает на Events кабинет вместо основного кабинета.

## Решение

### 1. Проверьте настройки в Render Dashboard

1. Откройте Render Dashboard → Ваш сервис → Environment
2. Найдите переменную `STRIPE_API_KEY`
3. Убедитесь, что это ключ **ОСНОВНОГО** кабинета (для платежей), а НЕ Events кабинета

### 2. Проверьте переменные окружения

Должны быть настроены **ДВА** разных ключа:

- **`STRIPE_API_KEY`** = ключ основного кабинета (для создания платежей, клиентов, сессий)
- **`STRIPE_EVENTS_API_KEY`** = ключ Events кабинета (только для отчетов по мероприятиям)

**ВАЖНО**: Эти ключи должны быть **РАЗНЫМИ**!

### 3. Как получить правильные ключи

#### Основной кабинет (для платежей):
1. Войдите в **основной** Stripe кабинет (не Events)
2. Developers → API keys
3. Скопируйте **Secret key** (начинается с `sk_live_...`)
4. Это значение должно быть в `STRIPE_API_KEY`

#### Events кабинет (для отчетов):
1. Войдите в **Events** Stripe кабинет
2. Developers → API keys
3. Скопируйте **Secret key** (начинается с `sk_live_...`)
4. Это значение должно быть в `STRIPE_EVENTS_API_KEY`

### 4. Проверка в логах

После исправления настроек, в логах приложения вы увидите:

```
info: Using Stripe API key for payments {
  apiKeyPrefix: "sk_live_XXXXXXXXXX...",
  keyType: "live",
  accountType: "PRIMARY",
  note: "This key should be from PRIMARY Stripe account, NOT Events account"
}
```

При создании клиента:
```
info: Created new Stripe Customer {
  customerId: "cus_...",
  email: "...",
  dealId: "...",
  apiKeyPrefix: "sk_live_XXXXXXXXXX...",
  accountType: "PRIMARY",
  note: "Customer created in PRIMARY Stripe account (STRIPE_API_KEY)"
}
```

### 5. Если ключи перепутаны

Если в логах видно ошибку:
```
error: ❌ КРИТИЧЕСКАЯ ОШИБКА: STRIPE_API_KEY и STRIPE_EVENTS_API_KEY одинаковые!
```

Это означает, что в Render оба ключа указывают на один и тот же кабинет. Исправьте это немедленно!

## Проверка после исправления

1. Создайте тестовую сделку с платежом
2. Проверьте в основном Stripe кабинете - клиент и платеж должны появиться там
3. Проверьте в Events кабинете - там НЕ должно быть новых клиентов/платежей (только старые, которые были созданы по ошибке)

## Дополнительная информация

- Events кабинет используется **ТОЛЬКО** для:
  - Получения отчетов по мероприятиям (`/api/reports/stripe-events/*`)
  - Скрипта `backfillStripeEventItems.js` с флагом `--events`
  
- Основной кабинет используется для:
  - Создания клиентов (`createCustomer`)
  - Создания Checkout сессий (`createCheckoutSession`)
  - Обработки webhook'ов
  - Всех операций с платежами

