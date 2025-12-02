#!/usr/bin/env node

/**
 * Re-approve December income payments that already have auto matches
 * but manual_status/manual_proforma_id were not set (bulk auto fix).
 *
 * Usage:
 *   node scripts/reapprove-dec-payments.js
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const supabase = require('../src/services/supabaseClient');
const PaymentService = require('../src/services/payments/paymentService');
const logger = require('../src/utils/logger');

async function main() {
  if (!supabase) {
    throw new Error('Supabase client is not configured');
  }

  const paymentService = new PaymentService();
const dateFrom = process.env.REAPPROVE_DATE_FROM || '2025-12-01';

  logger.info('Re-approving payments with missing manual_status...', { dateFrom });

  const { data: pending, error } = await supabase
    .from('payments')
    .select('id, proforma_id, proforma_fullnumber, match_confidence, operation_date, manual_status, manual_proforma_id')
    .eq('direction', 'in')
    .is('deleted_at', null)
    .gte('operation_date', dateFrom)
    .not('proforma_id', 'is', null)
    .or('manual_status.is.null,and(manual_status.eq.approved,manual_proforma_id.is.null)')
    .order('operation_date', { ascending: true });

  if (error) {
    throw error;
  }

  if (!pending || pending.length === 0) {
    logger.info('No December payments require re-approval');
    return;
  }

  logger.info('Found payments to approve', { count: pending.length });

  const results = [];
  for (const payment of pending) {
    try {
      await paymentService.approveAutoMatch(payment.id, { user: 'auto-dec-relink' });
      results.push({ paymentId: payment.id, status: 'approved' });
    } catch (err) {
      logger.error('Failed to approve payment', { paymentId: payment.id, error: err.message });
      results.push({ paymentId: payment.id, status: 'error', error: err.message });
    }
  }

  logger.info('Re-approval finished', { approved: results.filter(r => r.status === 'approved').length });
  console.log(JSON.stringify(results, null, 2));
}

main().catch((error) => {
  logger.error('reapprove-dec-payments failed', { error: error.message });
  console.error('❌ Error:', error.message);
  process.exit(1);
});


