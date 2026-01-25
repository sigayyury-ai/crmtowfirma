#!/usr/bin/env node

/**
 * Script to check payment 2921 - проверка оригинальной суммы
 */

require('dotenv').config();
const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');

async function main() {
  console.log('🔍 Checking payment 2921 through Supabase...\n');

  if (!supabase) {
    console.error('❌ Supabase client is not configured');
    process.exit(1);
  }

  try {
    // Get payment 2921
    const { data: payment, error: fetchError } = await supabase
      .from('payments')
      .select('*')
      .eq('id', 2921)
      .single();

    if (fetchError) {
      console.error('❌ Error fetching payment:', fetchError);
      process.exit(1);
    }

    if (!payment) {
      console.error('❌ Payment 2921 not found');
      process.exit(1);
    }

    console.log('📋 Payment 2921 details:');
    console.log('═'.repeat(80));
    console.log(`   ID: ${payment.id}`);
    console.log(`   Date: ${payment.operation_date}`);
    console.log(`   💰 Оригинальная сумма: ${payment.amount} ${payment.currency || 'PLN'}`);
    console.log(`   💰 Сумма в PLN: ${payment.amount_pln || '—'}`);
    console.log(`   📝 Description: ${payment.description || '—'}`);
    console.log(`   👤 Payer: ${payment.payer_name || '—'}`);
    console.log(`   🏦 Account: ${payment.account || '—'}`);
    console.log(`   📊 Direction: ${payment.direction || '—'}`);
    console.log(`   📈 Match Status: ${payment.match_status || '—'}`);
    console.log(`   ✅ Manual Status: ${payment.manual_status || '—'}`);
    console.log(`   📄 Proforma ID: ${payment.proforma_id || '—'}`);
    console.log(`   📄 Proforma Fullnumber: ${payment.proforma_fullnumber || '—'}`);
    console.log(`   💱 Exchange Rate: ${payment.exchange_rate || '—'}`);
    console.log('═'.repeat(80));
    console.log('');
    console.log(`✅ ОРИГИНАЛЬНАЯ СУММА: ${payment.amount} ${payment.currency || 'PLN'}`);

    // Also check if it's a Stripe payment
    if (payment.source === 'stripe' || payment.stripe_session_id) {
      console.log('\n⚠️  This might be a Stripe payment. Checking stripe_payments table...');
      
      const { data: stripePayment, error: stripeError } = await supabase
        .from('stripe_payments')
        .select('*')
        .or(`id.eq.${payment.id},session_id.eq.${payment.stripe_session_id}`)
        .limit(1)
        .maybeSingle();

      if (!stripeError && stripePayment) {
        console.log('\n📋 Stripe Payment details:');
        console.log('═'.repeat(80));
        console.log(`   💰 Оригинальная сумма (original_amount): ${stripePayment.original_amount || stripePayment.amount} ${stripePayment.currency || 'PLN'}`);
        console.log(`   💰 Сумма в PLN (amount_pln): ${stripePayment.amount_pln || '—'}`);
        console.log(`   💱 Exchange Rate: ${stripePayment.exchange_rate || '—'}`);
        console.log(`   Session ID: ${stripePayment.session_id || '—'}`);
        console.log(`   Payment Type: ${stripePayment.payment_type || '—'}`);
        console.log(`   Status: ${stripePayment.status || '—'}`);
        console.log('═'.repeat(80));
      }
    }

  } catch (error) {
    logger.error('❌ Fatal error:', error);
    console.error('❌ Fatal error:', error.message);
    process.exit(1);
  }
}

main().catch(error => {
  console.error('❌ Unhandled error:', error);
  process.exit(1);
});
