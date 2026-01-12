# План реализации: 017-stripe-logs-console

**Date**: 2026-01-12  
**Spec**: `specs/017-stripe-logs-console/spec.md`

## Summary

Сделать удобный способ отслеживать Stripe webhook логи и результаты автоматизаций **из терминала (Cursor)** без Stripe Dashboard:

- live tail прод-логов (Render) с фильтрами под Stripe,
- сводный анализ последних N строк логов (webhooks / уведомления / CRM stage automation),
- (опционально) сверка со Stripe events через Stripe API (list events).

## Implementation Strategy

### Phase 0 — Research confirmation

- Подтвердить ключевые лог-строки в `src/routes/stripeWebhook.js` (уже есть).
- Зафиксировать “ключи корреляции”:
  - `eventId`, `eventType`, `requestId`, `dealId`, `sessionId`, `paymentIntentId`.

### Phase 1 — Operator scripts (no backend changes)

1) **Streaming / tail**
   - Использовать `scripts/fetch-render-logs.js --tail`.
   - Добавить новый скрипт-обёртку `scripts/watch-stripe-webhooks.js`, который:
     - запускает tail,
     - подсвечивает и группирует строки по `eventId`/`dealId`,
     - показывает краткий итог по каждой оплате (получен webhook → persistSession → CRM automation → notification).

2) **One-shot analysis**
   - Укрепить/расширить `scripts/analyze-stripe-webhooks-and-notifications.js`:
     - добавить поиск по `eventId/sessionId/dealId`,
     - добавить отдельный счётчик “signature failed” и “events cabinet ignored”.

3) **Stripe-side events**
   - Добавить `scripts/stripe-list-events.js`:
     - `--types=...` и `--limit=...` и `--since=...`
     - печатает `event.id`, `type`, `created`, `livemode`, `request.id`, `pending_webhooks`.

4) **Correlation report**
   - Добавить `scripts/stripe-webhook-correlation.js`:
     - (A) берёт события из Stripe за окно
     - (B) берёт логи Render за N строк
     - (C) выводит “видно в Stripe / видно в Render / ignored / signature failed”.

### Phase 2 — Documentation

- Док “how-to” в `docs/` (или доп. секция в `docs/stripe-webhook-system.md`):
  - команды для быстрого хвоста,
  - команды для анализа,
  - типичные паттерны ошибок и next steps.

## Testing Plan

- Запуск скриптов на staging/prod, проверить:
  - что не падают без ключей,
  - что не печатают секреты,
  - что корректно группируют строки и находят типичные ошибки.

