# Задачи: 017-stripe-logs-console

## Research / Inventory

### R-001: Зафиксировать ключевые лог-строки и поля корреляции
- `src/routes/stripeWebhook.js`: “Stripe webhook получен”, “signature verification failed”, “Events cabinet ignored”
- `src/services/stripe/processor.js`: persistSession / persistRefund лог-строки
- `src/services/crm/statusAutomationService.js`: лог-строки обновления стадий и отправки уведомлений

## Scripts (operator tools)

### S-001: Live tail скрипт для Stripe webhook’ов (Cursor-friendly)
- Новый `scripts/watch-stripe-webhooks.js`:
  - запускает `node scripts/fetch-render-logs.js --tail`
  - фильтрует и подсвечивает строки, связанные со Stripe webhooks и автоматизациями
  - параметры:
    - `--deal=1234`
    - `--event=evt_...`
    - `--session=cs_...`
    - `--quiet` (показывать только ключевые)

### S-002: Расширить агрегатор логов
- Улучшить `scripts/analyze-stripe-webhooks-and-notifications.js`:
  - добавить счётчики:
    - signature failed
    - events cabinet ignored
    - resource_missing
  - добавить фильтрацию по `--deal=`, `--session=`, `--event=`

### S-003: Stripe events list (без Dashboard)
- Новый `scripts/stripe-list-events.js`:
  - `--types=checkout.session.completed,payment_intent.succeeded,...`
  - `--limit=50`
  - `--since=60m`
  - выводит: `event.id`, `type`, `created`, `livemode`, `request.id`, `pending_webhooks`

### S-004: Correlation report (Stripe vs Render)
- Новый `scripts/stripe-webhook-correlation.js`:
  - получает события из Stripe за окно времени
  - получает Render logs за N строк
  - выводит таблицу: eventId/type/created + “seen in Render?” + “signature failed?” + “ignored?”

## Docs

### D-001: Обновить operator guide
- Дополнить `docs/stripe-webhook-system.md` секцией “Логи из консоли (Cursor)”
- Добавить быстрые команды:
  - tail
  - анализ
  - stripe events list

## Safety

### SEC-001: Redaction
- Убедиться, что скрипты не выводят:
  - `STRIPE_WEBHOOK_SECRET`
  - `STRIPE_*_API_KEY`
  - email/phone (маскировать при необходимости)

