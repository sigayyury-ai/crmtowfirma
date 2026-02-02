#!/usr/bin/env node
/**
 * Найти последние N Stripe checkout сессий, отсутствующие в БД, и сохранить их через persistSession.
 * Использование: node scripts/sync-missing-stripe-sessions-to-db.js [limit]
 * По умолчанию limit=50.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const Stripe = require('stripe');
const StripeRepository = require('../src/services/stripe/repository');
const StripeProcessorService = require('../src/services/stripe/processor');

const LIMIT = parseInt(process.argv[2], 10) || 50;

async function main() {
  const stripe = new Stripe(process.env.STRIPE_API_KEY, { apiVersion: '2024-04-10' });
  const repository = new StripeRepository();
  const processor = new StripeProcessorService();

  if (!repository.isEnabled()) {
    console.error('Supabase/repository not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
    process.exit(1);
  }

  console.log(`\nFetching last ${LIMIT} Stripe checkout sessions...\n`);

  const listResponse = await stripe.checkout.sessions.list({
    limit: Math.min(LIMIT, 100)
  });

  const missing = [];
  for (const session of listResponse.data) {
    const inDb = await repository.findPaymentBySessionId(session.id);
    if (!inDb) {
      missing.push({
        sessionId: session.id,
        dealId: session.metadata?.deal_id || null,
        status: session.status,
        paymentStatus: session.payment_status
      });
    }
  }

  if (missing.length === 0) {
    console.log('No missing sessions. All sessions are already in DB.');
    return;
  }

  console.log(`Found ${missing.length} sessions missing in DB. Syncing...\n`);

  let ok = 0;
  let fail = 0;
  for (const { sessionId, dealId, status, paymentStatus } of missing) {
    try {
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      await processor.persistSession(session);
      ok += 1;
      console.log(`  OK   ${sessionId}  deal_id=${dealId}  status=${status}`);
    } catch (err) {
      fail += 1;
      console.error(`  FAIL ${sessionId}  deal_id=${dealId}  error=${err.message}`);
    }
  }

  console.log(`\nDone. Synced: ${ok}, failed: ${fail}, total: ${missing.length}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
