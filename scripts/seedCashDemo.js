#!/usr/bin/env node

/**
 * Seed script for hybrid cash payment demo data.
 * Creates demo products, proformas, cash payments (pending/confirmed/refunded)
 * so that VAT Margin / P&L flows have realistic fixtures.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');
const { normalizeName, normalizeWhitespace } = require('../src/utils/normalize');

const DEMO_KEY = 'cash-demo';
const CREATOR = 'seedCashDemo';
const PROFORMA_PREFIX = 'CASH-DEMO';

const SCENARIOS = [
  {
    key: 'surf-camp',
    dealId: 99001001,
    productName: 'Cash Demo — Surf Camp',
    proformaId: `${PROFORMA_PREFIX}-SURF`,
    fullnumber: `${PROFORMA_PREFIX}/SURF/2025`,
    currency: 'PLN',
    total: 9500,
    issueDate: '2025-11-10',
    buyer: {
      name: 'Demo Client Surf',
      email: 'surf-demo@comoon.io',
      phone: '+48 600 000 111'
    },
    payments: [
      {
        status: 'received',
        expectedAmount: 4000,
        currency: 'PLN',
        expectedDate: '2025-11-12',
        confirmedAt: '2025-11-13T09:05:00Z',
        confirmedBy: 'demo_cashier',
        note: 'Депозит в офисе Варшава'
      },
      {
        status: 'pending_confirmation',
        expectedAmount: 2500,
        currency: 'PLN',
        expectedDate: '2025-12-05',
        note: 'Привезти остаток за день до выезда'
      }
    ]
  },
  {
    key: 'sailing-eur',
    dealId: 99001002,
    productName: 'Cash Demo — Sailing Retreat',
    proformaId: `${PROFORMA_PREFIX}-SAIL`,
    fullnumber: `${PROFORMA_PREFIX}/SAIL/2025`,
    currency: 'EUR',
    currencyExchange: 4.3,
    total: 4200,
    issueDate: '2025-11-05',
    buyer: {
      name: 'Demo Client Sailing',
      email: 'sailing-demo@comoon.io'
    },
    payments: [
      {
        status: 'received',
        expectedAmount: 800,
        currency: 'EUR',
        expectedDate: '2025-11-15',
        confirmedAt: '2025-11-16T14:30:00Z',
        confirmedBy: 'demo_cashier',
        note: 'Выкуп депозита в марине'
      },
      {
        status: 'pending',
        expectedAmount: 1200,
        currency: 'EUR',
        expectedDate: '2025-11-28',
        note: 'Клиент привезёт при посадке на яхту'
      }
    ]
  },
  {
    key: 'workshop-refund',
    dealId: 99001003,
    productName: 'Cash Demo — Workshop',
    proformaId: `${PROFORMA_PREFIX}-WORK`,
    fullnumber: `${PROFORMA_PREFIX}/WORK/2025`,
    currency: 'PLN',
    total: 3000,
    issueDate: '2025-11-01',
    buyer: {
      name: 'Demo Client Workshop',
      email: 'workshop-demo@comoon.io'
    },
    payments: [
      {
        status: 'received',
        expectedAmount: 1500,
        currency: 'PLN',
        confirmedAt: '2025-11-03T10:00:00Z',
        confirmedBy: 'demo_cashier',
        note: 'Оплата на встрече'
      },
      {
        status: 'refunded',
        expectedAmount: 1500,
        currency: 'PLN',
        confirmedAt: '2025-11-07T09:00:00Z',
        confirmedBy: 'demo_cashier',
        note: 'Клиент отменил участие',
        refund: {
          reason: 'Клиент передумал',
          processedAt: '2025-11-08T12:00:00Z',
          processedBy: 'demo_cashier',
          status: 'processed'
        }
      }
    ]
  }
];

async function cleanupDemoData() {
  logger.info('Cleaning up previous cash demo data...');

  const { data: demoPayments, error: paymentsFetchError } = await supabase
    .from('cash_payments')
    .select('id')
    .contains('metadata', { demo: DEMO_KEY });

  if (paymentsFetchError) {
    throw paymentsFetchError;
  }

  if (Array.isArray(demoPayments) && demoPayments.length > 0) {
    const ids = demoPayments.map((row) => row.id);
    const { error: deletePaymentsError } = await supabase
      .from('cash_payments')
      .delete()
      .in('id', ids);

    if (deletePaymentsError) {
      throw deletePaymentsError;
    }

    logger.info(`Removed ${ids.length} cash_payments entries (events/refunds cascade deleted automatically).`);
  }

  const { data: demoProformas, error: proformaFetchError } = await supabase
    .from('proformas')
    .select('id')
    .ilike('fullnumber', `${PROFORMA_PREFIX}%`);

  if (proformaFetchError) {
    throw proformaFetchError;
  }

  if (Array.isArray(demoProformas) && demoProformas.length > 0) {
    const proformaIds = demoProformas.map((row) => row.id);

    const { error: deleteProductsError } = await supabase
      .from('proforma_products')
      .delete()
      .in('proforma_id', proformaIds);

    if (deleteProductsError) {
      throw deleteProductsError;
    }

    const { error: deleteProformasError } = await supabase
      .from('proformas')
      .delete()
      .in('id', proformaIds);

    if (deleteProformasError) {
      throw deleteProformasError;
    }

    logger.info(`Removed ${proformaIds.length} demo proformas (and their product rows).`);
  }
}

async function ensureProduct(name) {
  const normalized = normalizeName(name);
  const trimmed = normalizeWhitespace(name).slice(0, 255);

  const { data: existing, error: fetchError } = await supabase
    .from('products')
    .select('id, name')
    .eq('normalized_name', normalized)
    .maybeSingle();

  if (fetchError) {
    throw fetchError;
  }

  if (existing) {
    return existing;
  }

  const { data: inserted, error: insertError } = await supabase
    .from('products')
    .insert({
      name: trimmed,
      normalized_name: normalized
    })
    .select('id, name')
    .single();

  if (insertError) {
    throw insertError;
  }

  return inserted;
}

function calcPlnAmount(payment, scenario) {
  if (typeof payment.amountPln === 'number') {
    return payment.amountPln;
  }

  if (payment.currency === 'PLN') {
    return payment.expectedAmount;
  }

  const rate = payment.fxRate || scenario.currencyExchange || 1;
  return Number((payment.expectedAmount * rate).toFixed(2));
}

async function upsertProformaRecord(scenario, productId, cashTotals) {
  const issuedAt = scenario.issueDate || new Date().toISOString().slice(0, 10);

  const record = {
    id: scenario.proformaId,
    fullnumber: scenario.fullnumber,
    issued_at: issuedAt,
    currency: scenario.currency,
    total: scenario.total,
    payments_total: 0,
    payments_total_pln: scenario.currency === 'PLN' ? 0 : null,
    payments_total_cash: cashTotals.currencyTotal,
    payments_total_cash_pln: cashTotals.plnTotal,
    payments_currency_exchange: scenario.currencyExchange || (scenario.currency === 'PLN' ? 1 : null),
    pipedrive_deal_id: scenario.dealId,
    buyer_name: scenario.buyer?.name || 'Demo Client',
    buyer_email: scenario.buyer?.email || null,
    buyer_phone: scenario.buyer?.phone || null,
    status: 'active',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  const { error } = await supabase
    .from('proformas')
    .upsert(record, { onConflict: 'id' });

  if (error) {
    throw error;
  }

  // Replace product rows for this proforma
  const { error: deleteError } = await supabase
    .from('proforma_products')
    .delete()
    .eq('proforma_id', scenario.proformaId);

  if (deleteError) {
    throw deleteError;
  }

  const { error: insertError } = await supabase
    .from('proforma_products')
    .insert({
      proforma_id: scenario.proformaId,
      product_id: productId,
      quantity: 1,
      unit_price: scenario.total,
      line_total: scenario.total,
      name: scenario.productName
    });

  if (insertError) {
    throw insertError;
  }
}

async function insertCashPayments(scenario, productId) {
  const results = [];

  for (const payment of scenario.payments) {
    const amountPln = calcPlnAmount(payment, scenario);
    const confirmedAmount =
      payment.status === 'received' || payment.status === 'refunded'
        ? payment.cashReceivedAmount ?? payment.expectedAmount
        : payment.cashReceivedAmount ?? null;

    const payload = {
      deal_id: payment.dealId || scenario.dealId,
      proforma_id: scenario.proformaId,
      proforma_fullnumber: scenario.fullnumber,
      product_id: productId,
      cash_expected_amount: payment.expectedAmount,
      cash_received_amount: confirmedAmount,
      currency: payment.currency || scenario.currency,
      amount_pln: amountPln,
      status: payment.status,
      source: payment.source || 'manual',
      expected_date: payment.expectedDate || scenario.issueDate,
      confirmed_at: payment.confirmedAt || null,
      confirmed_by: payment.confirmedBy || null,
      created_by: CREATOR,
      note: payment.note || null,
      metadata: {
        demo: DEMO_KEY,
        scenario: scenario.key
      }
    };

    const { data: inserted, error } = await supabase
      .from('cash_payments')
      .insert(payload)
      .select('*')
      .single();

    if (error) {
      throw error;
    }

    const events = [
      {
        cash_payment_id: inserted.id,
        event_type: 'seed:create',
        source: CREATOR,
        payload: { status: payment.status, scenario: scenario.key },
        created_by: CREATOR
      }
    ];

    if (payment.status === 'received') {
      events.push({
        cash_payment_id: inserted.id,
        event_type: 'status:received',
        source: CREATOR,
        payload: { confirmed_at: payload.confirmed_at },
        created_by: CREATOR
      });
    }

    if (payment.status === 'refunded') {
      events.push({
        cash_payment_id: inserted.id,
        event_type: 'status:refunded',
        source: CREATOR,
        payload: { reason: payment.refund?.reason || 'Demo refund' },
        created_by: CREATOR
      });
    }

    const { error: eventsError } = await supabase
      .from('cash_payment_events')
      .insert(events);

    if (eventsError) {
      throw eventsError;
    }

    if (payment.refund) {
      const { error: refundError } = await supabase
        .from('cash_refunds')
        .insert({
          cash_payment_id: inserted.id,
          amount: payment.refund.amount ?? payment.expectedAmount,
          currency: payment.currency || scenario.currency,
          reason: payment.refund.reason || 'Demo refund',
          status: payment.refund.status || 'processed',
          processed_by: payment.refund.processedBy || CREATOR,
          processed_at: payment.refund.processedAt || new Date().toISOString(),
          note: payment.note || null
        });

      if (refundError) {
        throw refundError;
      }
    }

    results.push(inserted);
  }

  return results;
}

function summarizeCashTotals(payments, scenario) {
  return payments.reduce(
    (acc, payment) => {
      const amountPln = calcPlnAmount(payment, scenario);
      if (payment.status === 'received') {
        acc.currencyTotal += payment.expectedAmount;
        acc.plnTotal += amountPln;
      }
      return acc;
    },
    { currencyTotal: 0, plnTotal: 0 }
  );
}

async function main() {
  console.log('🚀 Seeding hybrid cash demo data...\n');

  if (!supabase) {
    console.error('❌ Supabase client is not configured. Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
    process.exit(1);
  }

  try {
    await cleanupDemoData();

    const summary = [];

    for (const scenario of SCENARIOS) {
      const product = await ensureProduct(scenario.productName);
      const cashTotals = summarizeCashTotals(scenario.payments, scenario);
      await upsertProformaRecord(scenario, product.id, cashTotals);
      const seededPayments = await insertCashPayments(scenario, product.id);
      summary.push({
        scenario: scenario.key,
        proforma: scenario.fullnumber,
        payments: seededPayments.length
      });
    }

    console.log('✅ Cash demo data created:\n');
    summary.forEach((entry, index) => {
      console.log(
        `${index + 1}. ${entry.scenario} — ${entry.proforma} (${entry.payments} cash payments)`
      );
    });

    console.log('\n📌 Note: refresh the materialized view manually if needed:');
    console.log('    REFRESH MATERIALIZED VIEW cash_summary_monthly;');
    console.log('\nDone.');
  } catch (error) {
    logger.error('Failed to seed cash demo data:', error);
    console.error('❌ Seeding failed:', error.message);
    process.exit(1);
  }
}

main();
