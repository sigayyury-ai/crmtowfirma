# Research Notes: 017-stripe-logs-console

## Current webhook & automation infrastructure (as-is)

### Where Stripe webhook is handled

- Endpoint: `POST /api/webhooks/stripe`
- Code: `src/routes/stripeWebhook.js`
- Mounted early (before JSON body parsing) in `src/index.js` via `app.use('/api', stripeWebhookRoutes)`

Key implementation details we can leverage for log tracking:

- Raw body reading from stream + `stripe.webhooks.constructEvent(...)` signature verification.
- Rich structured logs already exist:
  - `Stripe webhook received` (debug) — has signature presence, body length.
  - `Stripe webhook signature verification failed` (warn)
  - `Stripe webhook from Events cabinet ignored` (info)
  - `📥 Stripe webhook получен | Тип: ...` (info) — includes `eventId`, `eventType`, `requestId`, object id/type.
  - Per-event processing logs for:
    - `checkout.session.completed`
    - `checkout.session.async_payment_*`
    - `payment_intent.*`
    - `charge.*`
    - `invoice.*`

### Where automation happens after payment

In `stripeWebhook.js` the main “happy path” for paid checkout is:

1) `stripeProcessor.repository.updatePaymentStatus(session.id, ...)`
2) `stripeProcessor.persistSession(session)` (main processing pipeline)
3) `stripeProcessor.triggerCrmStatusAutomation(...)` / `statusAutomationService.syncDealStage(...)` (inside processor)
4) Notification sending (SendPulse) is attempted after payment completion.

Because these steps log at `info/warn/error`, **Render logs are already the primary source-of-truth** for “did the automation happen”.

### Known failure modes already visible in logs

- Missing `STRIPE_WEBHOOK_SECRET` → webhook returns 400 and logs warn with hint.
- Signature verification failure → returns 401; log includes hints (endpoint ID/URL expectations).
- Events cabinet mismatch / wrong secret → currently treated as “ignored” and returns 200 (to stop retries).
- `resource_missing` on retrieving session → indicates wrong mode/key or missing session.

## Existing log access tooling in repo

### Render logs

There is an existing supported script:

- `scripts/fetch-render-logs.js`
  - one-shot: `node scripts/fetch-render-logs.js --lines=1000`
  - streaming: `node scripts/fetch-render-logs.js --tail`

There are also convenience scripts:

- `scripts/analyze-stripe-webhooks-and-notifications.js` — aggregates webhook/notification/status lines from the last N Render log lines.
- `scripts/watch-production-webhooks.js` — streams Render logs and highlights webhook/stripe-related lines.

This repo already treats Render logs as the canonical place to debug webhook processing without dashboards.

### Stripe-side signals without Dashboard

There is an existing script:

- `scripts/debug-webhook-delivery.js`
  - checks endpoint availability (GET)
  - lists recent Stripe events via `stripe.events.list(...)`
  - lists webhook endpoints via `stripe.webhookEndpoints.list(...)`

Limitations:

- Stripe API does not provide full “delivery attempt logs” for a webhook endpoint in the same way as Dashboard; we mostly get:
  - events (`stripe.events.list`) and fields like `event.request.id` / `pending_webhooks`.

## Current docs coverage

Docs already present:

- `docs/stripe-webhook-system.md` — detailed webhook processing flow and troubleshooting.
- `docs/stripe-webhook-secret-troubleshooting.md` — signature issues.

Note: Workspace rule mentions `docs/api-reference.md`, but in this repository that file is not present. For this feature we do not add new public API for the product; we add scripts/spec docs.

## Conclusion: best approach for “Stripe logs in Cursor”

V1 should rely on:

1) **Render logs** (our processing truth) via `scripts/fetch-render-logs.js --tail` and focused filters.
2) **Stripe Events API** (Stripe-side truth) via a small script that lists recent events/types and prints `event.id/type/created/livemode/request.id`.
3) A “glue” script that correlates:
   - event ids/types seen in Stripe,
   - and whether those ids appear in Render logs (processed/failed/ignored).

