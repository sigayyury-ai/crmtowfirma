# Настройка Stripe Webhook для мгновенной обработки платежей

## Описание

Webhook автоматически обрабатывает Stripe платежи сразу после их завершения, без задержек на периодическую проверку. Это обеспечивает мгновенное обновление статусов в CRM и отчетах.

## URL Webhook

```
POST https://your-domain.com/api/webhooks/stripe
```

## Настройка в Stripe Dashboard

1. Перейдите в **Developers** → **Webhooks** (в левом меню Stripe Dashboard)
2. Нажмите **Add endpoint** (или **+ Add endpoint**)
3. Заполните форму:
   - **Endpoint URL**: `https://your-domain.com/api/webhooks/stripe`
   - **Description** (опционально): "Обработка платежей для CRM"
4. В разделе **"Select events to listen to"** выберите:
   - Нажмите **"Select events"** или **"Add events"**
   - Найдите и отметьте галочками:
     - ✅ `checkout.session.completed` (основное событие - срабатывает когда клиент оплатил через Checkout)
     - ✅ `checkout.session.async_payment_succeeded` (для асинхронных платежей - банковские переводы и т.д.)
     - ✅ `checkout.session.async_payment_failed` (для отслеживания неудачных асинхронных платежей)
     - ✅ `checkout.session.expired` (для отслеживания истекших сессий)
     - ✅ `payment_intent.succeeded` (резервное событие - на случай если первое не сработало)
     - ✅ `payment_intent.payment_failed` (для отслеживания неудачных платежей)
     - ✅ `charge.refunded` (для обработки возвратов средств)
   - Или выберите **"Select all events"** если хотите получать все события (не обязательно)
5. Нажмите **Add endpoint**
6. После создания webhook, откройте его и скопируйте **Signing secret** (начинается с `whsec_...`)
   - Это секретный ключ для проверки подлинности webhook запросов
7. Добавьте в `.env`:
   ```
   STRIPE_WEBHOOK_SECRET=whsec_ваш_секретный_ключ
   ```

## Как это работает

### Успешные платежи

1. Клиент оплачивает через Stripe Checkout
2. Stripe отправляет webhook `checkout.session.completed` (мгновенные платежи) или `checkout.session.async_payment_succeeded` (асинхронные платежи)
3. Webhook обрабатывает платеж:
   - Обновляет статус платежа в базе данных (`payment_status = 'paid'`)
   - Проверяет, не был ли уже обработан
   - Сохраняет платеж в базу данных (если новый)
   - Обновляет статус сделки в CRM
   - Добавляет заметку о платеже
4. Если обработка не удалась → создается задача в CRM для проверки

### Неудачные платежи

1. При неудачной попытке оплаты Stripe отправляет webhook `payment_intent.payment_failed` или `checkout.session.async_payment_failed`
2. Webhook обновляет статус платежа в базе данных (`payment_status = 'unpaid'`)
3. Статус обновляется для корректного отображения в отчетах и аналитике

### Истекшие сессии

1. При истечении сессии оплаты Stripe отправляет webhook `checkout.session.expired`
2. Webhook обновляет статус платежа в базе данных (`payment_status = 'unpaid'`)
3. Это позволяет отслеживать, какие платежи не были завершены вовремя

## Обрабатываемые события

### `checkout.session.completed`
Основное событие, срабатывает когда Checkout Session завершен и оплачен (мгновенные платежи). Обрабатывает платеж и обновляет стадии сделки в CRM.

### `checkout.session.async_payment_succeeded`
Событие для асинхронных платежей (например, банковские переводы), которые обрабатываются не мгновенно. Обновляет статус платежа в базе данных и обрабатывает платеж через processor (обновляет стадии сделки).

### `checkout.session.async_payment_failed`
Событие для отслеживания неудачных асинхронных платежей. Обновляет статус платежа в базе данных на `unpaid` для корректного отображения в отчетах.

### `checkout.session.expired`
Событие для отслеживания истекших сессий оплаты. Обновляет статус платежа в базе данных на `unpaid`, чтобы отразить, что сессия истекла и платеж не был завершен.

### `payment_intent.succeeded`
Резервное событие на случай, если `checkout.session.completed` не сработало. Обновляет статус платежа в базе данных и обрабатывает платеж через processor.

### `payment_intent.payment_failed`
Событие для отслеживания неудачных платежей. Обновляет статус платежа в базе данных на `unpaid` при неудачной попытке оплаты.

### `charge.refunded`
Событие для обработки возвратов средств. Обрабатывается мгновенно при создании возврата в Stripe. Обрабатывает возврат через CRM sync и обновляет стадии сделки.

## Обработка ошибок

Если webhook не смог обработать платеж, автоматически создается задача в CRM со следующими данными:

- **Тема**: "⚠️ Ошибка обработки Stripe платежа"
- **Срок**: через 24 часа
- **Описание**: 
  - Тип события
  - Session ID и Payment Intent ID
  - Ссылки на Stripe Dashboard
  - Описание ошибки
  - Инструкции по проверке

## Защита от дубликатов

- Проверка существующих платежей перед обработкой
- Idempotent обработка - повторные webhook события игнорируются
- Периодическая проверка остается как fallback механизм

## Безопасность

Webhook проверяет подпись Stripe для защиты от поддельных запросов. В development режиме проверка может быть отключена для тестирования.

## Тестирование

### Вариант 1: Использование тестового скрипта (рекомендуется)

Создан удобный скрипт для тестирования webhook'ов:

```bash
# Убедитесь, что сервер запущен
npm run dev

# В другом терминале запустите тест
node scripts/test-stripe-webhook.js checkout.session.completed

# Доступные типы событий:
# - checkout.session.completed
# - checkout.session.async_payment_succeeded
# - checkout.session.async_payment_failed
# - checkout.session.expired
# - payment_intent.succeeded
# - payment_intent.payment_failed
# - charge.refunded

# Можно указать URL и секрет через переменные окружения:
WEBHOOK_URL=http://localhost:3000/api/webhooks/stripe \
STRIPE_WEBHOOK_SECRET=whsec_... \
node scripts/test-stripe-webhook.js checkout.session.completed
```

Скрипт автоматически:
- Проверяет доступность сервера
- Создает mock события Stripe
- Генерирует подпись webhook (если указан секрет)
- Отправляет запрос и показывает результат

### Вариант 2: Использование Stripe CLI

Для тестирования с реальными событиями Stripe:

```bash
# Установите Stripe CLI
# https://stripe.com/docs/stripe-cli

# Логин
stripe login

# Пересылка webhook на локальный сервер
stripe listen --forward-to localhost:3000/api/webhooks/stripe

# Триггер тестового события
stripe trigger checkout.session.completed
```

### Вариант 3: Ручной тест через curl

```bash
# Без проверки подписи (development)
curl -X POST http://localhost:3000/api/webhooks/stripe \
  -H "Content-Type: application/json" \
  -d '{
    "id": "evt_test",
    "type": "checkout.session.completed",
    "data": {
      "object": {
        "id": "cs_test_123",
        "payment_status": "paid",
        "metadata": {
          "deal_id": "1600"
        }
      }
    }
  }'
```

### Проверка логов

После отправки webhook проверьте логи сервера:

```bash
# Логи должны показать:
# - Получение webhook события
# - Обработку платежа
# - Успешное сохранение или ошибки
tail -f logs/error.log
```

## Fallback

Периодическая проверка (каждый час) остается как резервный механизм на случай, если:
- Webhook не был доставлен
- Webhook был доставлен, но обработка не удалась
- Webhook был настроен неправильно

## Логирование

Все события логируются:
- Получение webhook
- Обработка платежа
- Ошибки обработки
- Создание задач в CRM

