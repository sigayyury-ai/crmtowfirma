#!/usr/bin/env node

/**
 * CLI скрипт для тестирования гибридных наличных платежей.
 * Возможности:
 *  - показать список “кемпов” (продуктов) из Pipedrive;
 *  - создать тестовую сделку с разбиением суммы на наличные/Stripe;
 *  - добавить запись о кэш‑ожидании в Supabase;
 *  - создать Stripe Checkout для безналичной части;
 *  - подтвердить / вернуть / удалить наличные платежи;
 *  - инициировать проверки и возвраты Stripe.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const fs = require('fs');
const path = require('path');
const { hideBin } = require('yargs/helpers');
const yargs = require('yargs');
const { PIPEDRIVE_CASH_FIELDS, CASH_STATUS_OPTIONS } = require('../config/customFields');
const PipedriveClient = require('../src/services/pipedrive');
const CashPaymentsRepository = require('../src/services/cash/cashPaymentsRepository');
const { createCashReminder } = require('../src/services/cash/cashReminderService');
const { ensureCashStatus } = require('../src/services/cash/cashStatusSync');
const cashPnlSyncService = require('../src/services/cash/cashPnlSyncService');
const StripeProcessorService = require('../src/services/stripe/processor');
const { getStripeClient } = require('../src/services/stripe/client');

const ENABLE_STAGE_AUTOMATION = String(process.env.ENABLE_CASH_STAGE_AUTOMATION || 'true').toLowerCase() === 'true';
const CASH_STAGE_SECOND_PAYMENT_ID = Number(process.env.CASH_STAGE_SECOND_PAYMENT_ID || 32);
const CASH_STAGE_CAMP_WAITER_ID = Number(process.env.CASH_STAGE_CAMP_WAITER_ID || 27);

const RUNS_FILE = path.resolve(__dirname, '../tmp/hybrid-cash-runs.json');

function ensureRunStorage() {
  const dir = path.dirname(RUNS_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(RUNS_FILE)) {
    fs.writeFileSync(RUNS_FILE, JSON.stringify({}, null, 2));
  }
}

function loadRuns() {
  ensureRunStorage();
  try {
    const raw = fs.readFileSync(RUNS_FILE, 'utf8');
    return JSON.parse(raw || '{}');
  } catch (error) {
    console.warn('⚠️  Failed to read runs file, starting fresh.', error.message);
    return {};
  }
}

function saveRuns(runs) {
  ensureRunStorage();
  fs.writeFileSync(RUNS_FILE, JSON.stringify(runs, null, 2));
}

function toIsoDate(value) {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

function defaultExpectedDate() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 3);
  return d.toISOString().slice(0, 10);
}

function defaultCloseDate() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 30);
  return d.toISOString().slice(0, 10);
}

function getInvoiceFieldKey() {
  return process.env.PIPEDRIVE_INVOICE_TYPE_FIELD_KEY || 'ad67729ecfe0345287b71a3b00910e8ba5b3b496';
}

function getStripeTriggerValue() {
  return String(process.env.PIPEDRIVE_STRIPE_INVOICE_TYPE_VALUE || '75');
}

function requireCashRepo(repo) {
  if (!repo.isEnabled()) {
    throw new Error('Supabase client is not configured. Cash payment operations unavailable.');
  }
}

async function listCampsCommand(argv) {
  const pipedrive = new PipedriveClient();
  const result = await pipedrive.listProducts({
    limit: argv.limit,
    start: argv.start,
    search: argv.search
  });

  if (!result.success) {
    console.error('❌ Failed to fetch products from Pipedrive:', result.error);
    process.exit(1);
  }

  if (!result.products.length) {
    console.log('ℹ️  No products found. Try adjusting --search or --start.');
    return;
  }

  console.log(`\n📦 Available products (limit=${argv.limit}, start=${argv.start}):\n`);
  result.products.forEach((product) => {
    console.log(
      `• #${product.id} | ${product.name || 'Unnamed'} | price=${product.prices?.[0]?.price || product.unit_price || 'n/a'} ${product.prices?.[0]?.currency || ''}`
    );
  });
  console.log('');
}

async function setupCommand(argv) {
  const pipedrive = new PipedriveClient();
  const repo = new CashPaymentsRepository();
  requireCashRepo(repo);

  const runs = loadRuns();
  const runId = argv.runId || `hybrid-${Date.now()}`;
  if (runs[runId]) {
    console.error(`❌ Run ID ${runId} already exists. Choose another (--run-id).`);
    process.exit(1);
  }

  const totalAmount = Number(argv.total);
  const cashAmount = Number(argv.cash);
  const currency = (argv.currency || 'PLN').toUpperCase();

  if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
    console.error('❌ --total must be a positive number.');
    process.exit(1);
  }
  if (!Number.isFinite(cashAmount) || cashAmount <= 0 || cashAmount > totalAmount) {
    console.error('❌ --cash must be positive and less than or equal to --total.');
    process.exit(1);
  }

  const cardAmount = Number((totalAmount - cashAmount).toFixed(2));
  const expectedDate = toIsoDate(argv.expectedDate) || defaultExpectedDate();
  const closeDate = toIsoDate(argv.closeDate) || defaultCloseDate();

  const productResult = await pipedrive.getProduct(argv.campId);
  if (!productResult.success) {
    console.error('❌ Failed to fetch product info:', productResult.error);
    process.exit(1);
  }
  const product = productResult.product;
  const dealTitle = argv.title || `Hybrid Cash Test — ${product.name || `Camp ${argv.campId}`}`;

  const cashFieldPayload = {};
  if (PIPEDRIVE_CASH_FIELDS.cashAmount?.key) {
    cashFieldPayload[PIPEDRIVE_CASH_FIELDS.cashAmount.key] = cashAmount;
  }
  if (PIPEDRIVE_CASH_FIELDS.cashExpectedDate?.key) {
    cashFieldPayload[PIPEDRIVE_CASH_FIELDS.cashExpectedDate.key] = expectedDate;
  }
  if (PIPEDRIVE_CASH_FIELDS.cashStatus?.key) {
    cashFieldPayload[PIPEDRIVE_CASH_FIELDS.cashStatus.key] = CASH_STATUS_OPTIONS.PENDING;
  }
  if (PIPEDRIVE_CASH_FIELDS.cashReceivedAmount?.key) {
    cashFieldPayload[PIPEDRIVE_CASH_FIELDS.cashReceivedAmount.key] = null;
  }

  const dealPayload = {
    title: dealTitle,
    value: totalAmount,
    currency,
    person_id: argv.personId,
    expected_close_date: closeDate,
    close_date: closeDate,
    ...cashFieldPayload
  };

  if (argv.stageId) {
    dealPayload.stage_id = argv.stageId;
  }

  if (argv.triggerStripeField) {
    dealPayload[getInvoiceFieldKey()] = getStripeTriggerValue();
  }

  const dealResult = await pipedrive.createDeal(dealPayload);
  if (!dealResult.success) {
    console.error('❌ Failed to create deal:', dealResult.error);
    process.exit(1);
  }

  const deal = dealResult.deal;
  const dealId = deal.id;
  console.log(`✅ Deal #${dealId} created for person ${argv.personId}`);

  const addProductResult = await pipedrive.addProductToDeal(dealId, {
    product_id: argv.campId,
    item_price: totalAmount,
    quantity: argv.quantity,
    sum: totalAmount,
    currency,
    enabled_flag: 1
  });

  if (!addProductResult.success) {
    console.warn('⚠️  Failed to attach product to deal:', addProductResult.error);
  } else {
    console.log(`📦 Linked product "${product.name}" to deal.`);
  }

  const noteContent = [
    `Hybrid cash test run ${runId}`,
    `Camp: ${product.name || argv.campId}`,
    `Total: ${totalAmount} ${currency}`,
    `Cash: ${cashAmount} ${currency}`,
    `Card: ${cardAmount} ${currency}`,
    `Expected cash date: ${expectedDate}`,
    argv.note ? `Note: ${argv.note}` : null
  ].filter(Boolean).join('\n');

  if (noteContent && noteContent.trim()) {
    console.log('📝 Creating note in deal', {
      dealId,
      personId: argv.personId,
      noteContent
    });
    await pipedrive.createDealNote({
      deal_id: dealId,
      person_id: argv.personId,
      content: noteContent
    });
  }

  const metadata = {
    test_run_id: runId,
    scenario: 'hybrid-cash-cli',
    created_at: new Date().toISOString(),
    card_amount: cardAmount,
    camp_id: argv.campId,
    buyerName: deal.person_name || deal.title || `Deal #${dealId}`,
    dealTitle: deal.title || null
  };

  const cashPayment = await repo.createPayment({
    deal_id: dealId,
    proforma_id: null,
    product_id: Number(argv.campId) || null,
    cash_expected_amount: cashAmount,
    currency,
    amount_pln: currency === 'PLN' ? cashAmount : null,
    expected_date: expectedDate,
    status: 'pending_confirmation',
    source: 'manual',
    metadata,
    created_by: 'hybrid-cli'
  });

  if (!cashPayment) {
    console.error('❌ Failed to create cash payment record in Supabase.');
    process.exit(1);
  }

  await repo.logEvent(cashPayment.id, 'cli:create', {
    source: 'hybrid-cli',
    payload: { runId },
    createdBy: 'hybrid-cli'
  });

  await ensureCashStatus({
    pipedriveClient: pipedrive,
    dealId,
    targetStatus: 'PENDING'
  });

  await createCashReminder(pipedrive, {
    dealId,
    amount: cashAmount,
    currency,
    expectedDate,
    closeDate: deal.expected_close_date || deal.close_date,
    source: 'Hybrid CLI',
    buyerName: deal.person_name || deal.title,
    personId: argv.personId,
    sendpulseClient: null
  });

  let stripeSession = null;
  if (argv.createSession && cardAmount > 0) {
    process.env.STRIPE_MODE = argv.stripeMode || process.env.STRIPE_MODE || 'test';
    const stripeProcessor = new StripeProcessorService();
    const sessionResult = await stripeProcessor.createCheckoutSessionForDeal(
      { id: dealId },
      {
        trigger: 'hybrid-cli',
        runId,
        paymentType: 'final',
        customAmount: cardAmount,
        skipNotification: true
      }
    );

    if (sessionResult.success) {
      stripeSession = sessionResult;
    } else {
      console.warn('⚠️  Failed to create Stripe Checkout session:', sessionResult.error);
    }
  }

  runs[runId] = {
    runId,
    createdAt: new Date().toISOString(),
    personId: argv.personId,
    campProductId: argv.campId,
    campName: product.name,
    dealId,
    cashPaymentId: cashPayment.id,
    cashAmount,
    totalAmount,
    cardAmount,
    currency,
    expectedDate,
    note: argv.note || null,
    stripeSessionId: stripeSession?.sessionId || null,
    stripeSessionUrl: stripeSession?.sessionUrl || null,
    paymentIntentId: null,
    stripePaymentStatus: null
  };

  saveRuns(runs);

  console.log('\n🎯 Scenario prepared!');
  console.log(`   Run ID: ${runId}`);
  console.log(`   Deal ID: ${dealId}`);
  console.log(`   Cash payment ID: ${cashPayment.id}`);
  if (stripeSession?.sessionUrl) {
    console.log(`   Stripe Checkout URL: ${stripeSession.sessionUrl}`);
    console.log('   👉 Complete the card payment manually, then run "stripe-status" to capture payment intent.');
  }
  console.log('\nNext steps:');
  console.log(` - Confirm cash: node scripts/hybridCashTestScenario.js confirm-cash --run ${runId}`);
  if (stripeSession?.sessionId) {
    console.log(` - Check Stripe payment: node scripts/hybridCashTestScenario.js stripe-status --run ${runId}`);
    console.log(` - Refund via Stripe: node scripts/hybridCashTestScenario.js stripe-refund --run ${runId}`);
  }
  console.log('');
}

function resolveRun(runs, runId) {
  const run = runs[runId];
  if (!run) {
    console.error(`❌ Run ID ${runId} not found. Use "runs" command to list.`);
    process.exit(1);
  }
  return run;
}

async function confirmCashCommand(argv) {
  const runs = loadRuns();
  const run = resolveRun(runs, argv.run);
  if (!run.cashPaymentId) {
    console.error('❌ This run has no cash payment recorded.');
    process.exit(1);
  }

  const repo = new CashPaymentsRepository();
  requireCashRepo(repo);
  const pipedrive = new PipedriveClient();

  const amount = Number(argv.amount || run.cashAmount);
  const payment = await repo.confirmPayment(run.cashPaymentId, {
    amount,
    currency: run.currency,
    confirmedAt: new Date().toISOString(),
    confirmedBy: 'hybrid-cli',
    note: argv.note || run.note
  });

  if (!payment) {
    console.error('❌ Cash payment record not found in Supabase.');
    process.exit(1);
  }

  await cashPnlSyncService.upsertEntryFromPayment(payment);
  await ensureCashStatus({
    pipedriveClient: pipedrive,
    dealId: run.dealId,
    targetStatus: 'RECEIVED'
  });

  if (ENABLE_STAGE_AUTOMATION && CASH_STAGE_CAMP_WAITER_ID) {
    try {
      await pipedrive.updateDealStage(run.dealId, CASH_STAGE_CAMP_WAITER_ID);
    } catch (error) {
      console.warn('⚠️  Failed to update deal stage:', error.message);
    }
  }

  runs[run.runId] = { ...run, cashPaymentStatus: payment.status, cashConfirmedAt: payment.confirmed_at };
  saveRuns(runs);
  console.log(`✅ Cash payment ${payment.id} marked as received (${amount} ${run.currency}).`);
}

async function refundCashCommand(argv) {
  const runs = loadRuns();
  const run = resolveRun(runs, argv.run);
  if (!run.cashPaymentId) {
    console.error('❌ This run has no cash payment recorded.');
    process.exit(1);
  }

  const repo = new CashPaymentsRepository();
  requireCashRepo(repo);
  const pipedrive = new PipedriveClient();

  const amount = Number(argv.amount || run.cashAmount);
  const result = await repo.refundPayment(run.cashPaymentId, {
    amount,
    currency: run.currency,
    reason: argv.reason || 'Hybrid CLI refund',
    processedBy: 'hybrid-cli',
    processedAt: new Date().toISOString(),
    note: argv.note || null
  });

  if (!result) {
    console.error('❌ Cash payment record not found for refund.');
    process.exit(1);
  }

  await cashPnlSyncService.markEntryRefunded(result.payment, argv.reason || 'Hybrid CLI refund');
  await ensureCashStatus({
    pipedriveClient: pipedrive,
    dealId: run.dealId,
    targetStatus: 'REFUNDED'
  });

  if (ENABLE_STAGE_AUTOMATION && CASH_STAGE_SECOND_PAYMENT_ID) {
    try {
      await pipedrive.updateDealStage(run.dealId, CASH_STAGE_SECOND_PAYMENT_ID);
    } catch (error) {
      console.warn('⚠️  Failed to update deal stage:', error.message);
    }
  }

  runs[run.runId] = {
    ...run,
    cashPaymentStatus: result.payment.status,
    cashRefundId: result.refund?.id || null,
    cashRefundedAt: result.refund?.processed_at || new Date().toISOString()
  };
  saveRuns(runs);
  console.log(`✅ Cash payment ${run.cashPaymentId} refunded (${amount} ${run.currency}).`);
}

async function deleteCashCommand(argv) {
  const runs = loadRuns();
  const run = resolveRun(runs, argv.run);
  if (!run.cashPaymentId) {
    console.error('ℹ️  This run has no cash payment to delete.');
    return;
  }

  const repo = new CashPaymentsRepository();
  requireCashRepo(repo);

  const { error } = await repo.supabase
    .from('cash_payments')
    .delete()
    .eq('id', run.cashPaymentId);

  if (error) {
    console.error('❌ Failed to delete cash payment:', error.message);
    process.exit(1);
  }

  runs[run.runId].cashPaymentId = null;
  runs[run.runId].cashPaymentStatus = 'deleted';
  saveRuns(runs);
  console.log(`🗑 Cash payment ${run.cashPaymentId} deleted from Supabase.`);
}

async function stripeStatusCommand(argv) {
  const runs = loadRuns();
  const run = resolveRun(runs, argv.run);
  const sessionId = argv.sessionId || run.stripeSessionId;
  if (!sessionId) {
    console.error('❌ No Stripe session stored for this run. Re-run setup or specify --session-id.');
    process.exit(1);
  }

  process.env.STRIPE_MODE = argv.stripeMode || process.env.STRIPE_MODE || 'test';
  const stripe = getStripeClient();

  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ['payment_intent', 'payment_intent.charges']
  });

  const paymentIntent = session.payment_intent;
  const paymentIntentId = typeof paymentIntent === 'string' ? paymentIntent : paymentIntent?.id;
  const paymentStatus = session.payment_status;
  const amountTotal = session.amount_total ? session.amount_total / 100 : null;
  const currency = session.currency?.toUpperCase();
  const latestCharge = paymentIntent?.charges?.data?.[0];
  const amountReceived = latestCharge?.amount ? latestCharge.amount / 100 : null;

  runs[run.runId] = {
    ...run,
    stripeSessionId: session.id,
    stripeSessionUrl: session.url || run.stripeSessionUrl,
    paymentIntentId,
    stripePaymentStatus: paymentStatus,
    stripeAmount: amountTotal,
    stripeCurrency: currency,
    stripeChargeId: latestCharge?.id || null
  };
  saveRuns(runs);

  console.log('\n💳 Stripe status:');
  console.log(`   Session: ${session.id}`);
  console.log(`   Payment intent: ${paymentIntentId || 'n/a'}`);
  console.log(`   Payment status: ${paymentStatus}`);
  console.log(`   Amount: ${amountReceived ?? amountTotal ?? 'n/a'} ${currency || ''}`);
  console.log('');
}

async function stripeRefundCommand(argv) {
  const runs = loadRuns();
  const run = resolveRun(runs, argv.run);
  const paymentIntentId = argv.paymentIntent || run.paymentIntentId;
  if (!paymentIntentId) {
    console.error('❌ Payment intent unknown. Run "stripe-status" first or provide --payment-intent.');
    process.exit(1);
  }

  process.env.STRIPE_MODE = argv.stripeMode || process.env.STRIPE_MODE || 'test';
  const stripe = getStripeClient();
  const refundParams = {
    payment_intent: paymentIntentId
  };

  if (argv.amount) {
    const cents = Math.round(Number(argv.amount) * 100);
    if (!Number.isFinite(cents) || cents <= 0) {
      console.error('❌ --amount must be > 0 for partial refund.');
      process.exit(1);
    }
    refundParams.amount = cents;
  }

  const refund = await stripe.refunds.create(refundParams);
  runs[run.runId] = {
    ...run,
    stripeRefundId: refund.id,
    stripeRefundStatus: refund.status,
    stripePaymentStatus: 'refunded'
  };
  saveRuns(runs);
  console.log(`✅ Stripe refund created (${refund.id}, status=${refund.status}).`);
}

function listRunsCommand() {
  const runs = loadRuns();
  const entries = Object.values(runs);
  if (!entries.length) {
    console.log('ℹ️  No runs recorded yet. Use "setup" command to create one.');
    return;
  }

  console.log('\n🗂 Stored hybrid cash runs:\n');
  entries.forEach((run) => {
    console.log(
      `• ${run.runId} | deal=${run.dealId} | cashPayment=${run.cashPaymentId || 'none'} | stripeSession=${run.stripeSessionId || 'none'} | status=${run.cashPaymentStatus || 'pending'}`
    );
  });
  console.log('');
}

async function cleanupCommand(argv) {
  const runs = loadRuns();
  const run = resolveRun(runs, argv.run);
  const repo = new CashPaymentsRepository();
  const pipedrive = new PipedriveClient();
  requireCashRepo(repo);

  if (!argv.keepCash && run.cashPaymentId) {
    const { error } = await repo.supabase
      .from('cash_payments')
      .delete()
      .eq('id', run.cashPaymentId);

    if (error) {
      console.warn('⚠️  Failed to delete cash payment during cleanup:', error.message);
    } else {
      console.log(`🗑 Removed cash payment ${run.cashPaymentId}`);
    }
  }

  if (argv.deleteDeal && run.dealId) {
    try {
      await pipedrive.client.delete(`/deals/${run.dealId}`, {
        params: { api_token: pipedrive.apiToken }
      });
      console.log(`🗑 Deal ${run.dealId} deleted from Pipedrive.`);
    } catch (error) {
      console.warn('⚠️  Failed to delete deal in Pipedrive:', error.message);
    }
  }

  delete runs[run.runId];
  saveRuns(runs);
  console.log(`✅ Run ${argv.run} cleaned up.`);
}

yargs(hideBin(process.argv))
  .command('camps', 'List available camp products from Pipedrive', (cmd) => {
    cmd
      .option('search', { type: 'string', describe: 'Filter products by name' })
      .option('limit', { type: 'number', default: 20 })
      .option('start', { type: 'number', default: 0 });
  }, listCampsCommand)
  .command('setup', 'Create hybrid test scenario', (cmd) => {
    cmd
      .option('camp-id', { type: 'number', demandOption: true, describe: 'Pipedrive product ID (camp)' })
      .option('person-id', { type: 'number', default: 863 })
      .option('total', { type: 'number', default: 10 })
      .option('cash', { type: 'number', default: 5 })
      .option('currency', { type: 'string', default: 'PLN' })
      .option('expected-date', { type: 'string', describe: 'YYYY-MM-DD expected cash date' })
      .option('close-date', { type: 'string', describe: 'Deal close date (defaults +30d)' })
      .option('stage-id', { type: 'number', describe: 'Stage for new deal (optional)' })
      .option('title', { type: 'string', describe: 'Custom deal title' })
      .option('quantity', { type: 'number', default: 1 })
      .option('run-id', { type: 'string' })
      .option('note', { type: 'string' })
      .option('trigger-stripe-field', { type: 'boolean', default: true })
      .option('create-session', { type: 'boolean', default: true })
      .option('stripe-mode', { type: 'string', default: process.env.STRIPE_MODE || 'test' });
  }, setupCommand)
  .command('confirm-cash', 'Confirm cash payment for a run', (cmd) => {
    cmd
      .option('run', { type: 'string', demandOption: true })
      .option('amount', { type: 'number' })
      .option('note', { type: 'string' });
  }, confirmCashCommand)
  .command('refund-cash', 'Create cash refund for a run', (cmd) => {
    cmd
      .option('run', { type: 'string', demandOption: true })
      .option('amount', { type: 'number' })
      .option('reason', { type: 'string' })
      .option('note', { type: 'string' });
  }, refundCashCommand)
  .command('delete-cash', 'Hard delete the cash payment record for a run', (cmd) => {
    cmd
      .option('run', { type: 'string', demandOption: true });
  }, deleteCashCommand)
  .command('stripe-status', 'Fetch Stripe Checkout session/payment intent info', (cmd) => {
    cmd
      .option('run', { type: 'string', demandOption: true })
      .option('session-id', { type: 'string' })
      .option('stripe-mode', { type: 'string', default: process.env.STRIPE_MODE || 'test' });
  }, stripeStatusCommand)
  .command('stripe-refund', 'Create Stripe refund for the run', (cmd) => {
    cmd
      .option('run', { type: 'string', demandOption: true })
      .option('amount', { type: 'number', describe: 'Optional partial refund amount' })
      .option('payment-intent', { type: 'string' })
      .option('stripe-mode', { type: 'string', default: process.env.STRIPE_MODE || 'test' });
  }, stripeRefundCommand)
  .command('runs', 'List stored test runs', listRunsCommand)
  .command('cleanup', 'Remove stored run metadata (and optionally delete deal/cash)', (cmd) => {
    cmd
      .option('run', { type: 'string', demandOption: true })
      .option('keep-cash', { type: 'boolean', default: false })
      .option('delete-deal', { type: 'boolean', default: false });
  }, cleanupCommand)
  .demandCommand(1)
  .help()
  .strict()
  .parse();
