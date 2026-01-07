# Quickstart — Stripe Payment Processor

1. **Setup environment**
   - Copy `.env` → `.env.local`, добавить `STRIPE_API_KEY` (live secret `sk_live_*`), `STRIPE_EVENTS_CACHE_TTL_MS`, `PIPEDRIVE_API_TOKEN`.
   - Убедиться, что Supabase credentials уже настроены (используются ProForm процессором).

2. **Install & start**
   ```bash
   npm install
   npm run dev
   ```
   Сервер поднимается на `http://localhost:3000`.

3. **Verify Stripe connectivity**
   ```bash
   curl http://localhost:3000/api/stripe-health
   ```
   Ответ `ok` подтверждает корректный ключ/сетевое подключение.

4. **Run processor manually (test mode)**
   - Используем Stripe test данные (карты `4242 ...`) и test product.  
   - Endpoint/скрипт: `node scripts/runStripeProcessor.js --deal <dealId> --mode test` (будет добавлен при реализации).  
   - Убедиться, что в логах появляется `PaymentProcessorRun source=stripe mode=test`.

5. **Check CRM stages**
   - Открыть сделку в Pipedrive → после первого платежа стадия меняется на `Second Payment` (stage_id=32) либо остаётся на `First Payment` (stage_id=18) если ожидается второй платёж.  
   - После полного набора платежей стадия → `Camp waiter` (stage_id=27).

6. **Review reports**
   - Перейти на `frontend/vat-margin.html` → вкладка «Мероприятия».  
   - Проверить, что суммы и валюты совпадают с Stripe Dashboard; export CSV содержит конверсию PLN.

7. **Validate refunds**
   - Создать refund в Stripe → запустить процессор повторно.  
   - Убедиться, что запись появилась в разделе «Удалённые проформы», а отчёты скорректировали сумму.

