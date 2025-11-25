#!/usr/bin/env node

/**
 * Script to mark payment 1272 as refund
 */

require('dotenv').config();
const supabase = require('../src/services/supabaseClient');
const IncomeCategoryService = require('../src/services/pnl/incomeCategoryService');
const logger = require('../src/utils/logger');

async function main() {
  console.log('🔍 Marking payment 1272 as refund...\n');

  if (!supabase) {
    console.error('❌ Supabase client is not configured');
    process.exit(1);
  }

  try {
    // Get "Возвраты" income category
    const incomeCategoryService = new IncomeCategoryService();
    const categories = await incomeCategoryService.listCategories();
    const refundsCategory = categories.find(cat => cat.name === 'Возвраты');

    if (!refundsCategory) {
      console.error('❌ Category "Возвраты" not found in database');
      process.exit(1);
    }

    console.log(`✅ Found category "Возвраты" (ID: ${refundsCategory.id})\n`);

    // Get payment 1272
    const { data: payment, error: fetchError } = await supabase
      .from('payments')
      .select('*')
      .eq('id', 1272)
      .single();

    if (fetchError) {
      console.error('❌ Error fetching payment:', fetchError);
      process.exit(1);
    }

    if (!payment) {
      console.error('❌ Payment 1272 not found');
      process.exit(1);
    }

    console.log('📋 Current payment data:');
    console.log(`   ID: ${payment.id}`);
    console.log(`   Date: ${payment.operation_date}`);
    console.log(`   Amount: ${payment.amount} ${payment.currency}`);
    console.log(`   Description: ${payment.description}`);
    console.log(`   Direction: ${payment.direction}`);
    console.log(`   Proforma: ${payment.proforma_fullnumber || payment.proforma_id || '—'}`);
    console.log(`   Income Category ID: ${payment.income_category_id || '— (NULL)'}`);
    console.log('');

    // Update payment to mark as refund
    const now = new Date().toISOString();
    const { data: updated, error: updateError } = await supabase
      .from('payments')
      .update({
        income_category_id: refundsCategory.id,
        match_status: 'unmatched', // Don't match to proformas
        manual_status: null, // Clear manual matching
        manual_proforma_id: null,
        manual_proforma_fullnumber: null,
        manual_comment: 'Помечено как возврат (ZWROT в описании)',
        manual_user: 'system',
        manual_updated_at: now,
        updated_at: now
      })
      .eq('id', 1272)
      .select('*')
      .single();

    if (updateError) {
      console.error('❌ Error updating payment:', updateError);
      process.exit(1);
    }

    console.log('✅ Payment 1272 marked as refund');
    console.log(`   Income Category ID: ${updated.income_category_id} (Возвраты)`);
    console.log(`   Match Status: ${updated.match_status}`);
    console.log(`   Manual Status: ${updated.manual_status || '—'}`);
    console.log(`   Proforma: ${updated.proforma_fullnumber || updated.proforma_id || '—'}`);
    console.log('');
    console.log('💡 Payment will now appear in PNL report under "Возвраты" category');

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




