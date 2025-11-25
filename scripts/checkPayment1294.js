#!/usr/bin/env node

/**
 * Script to check payment 1294 - should be income (return from car rental service)
 */

require('dotenv').config();
const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');

async function main() {
  console.log('🔍 Checking payment 1294...\n');

  if (!supabase) {
    console.error('❌ Supabase client is not configured');
    process.exit(1);
  }

  try {
    // Get payment 1294
    const { data: payment, error: fetchError } = await supabase
      .from('payments')
      .select('*')
      .eq('id', 1294)
      .single();

    if (fetchError) {
      console.error('❌ Error fetching payment:', fetchError);
      process.exit(1);
    }

    if (!payment) {
      console.error('❌ Payment 1294 not found');
      process.exit(1);
    }

    console.log('📋 Payment 1294 data:');
    console.log(`   ID: ${payment.id}`);
    console.log(`   Date: ${payment.operation_date}`);
    console.log(`   Amount: ${payment.amount} ${payment.currency}`);
    console.log(`   Description: ${payment.description}`);
    console.log(`   Direction: ${payment.direction}`);
    console.log(`   Income Category ID: ${payment.income_category_id || '— (NULL)'}`);
    console.log(`   Expense Category ID: ${payment.expense_category_id || '— (NULL)'}`);
    console.log(`   Match Status: ${payment.match_status || '—'}`);
    console.log(`   Manual Status: ${payment.manual_status || '—'}`);
    console.log('');

    // Check if it's correctly configured as income
    if (payment.direction === 'in') {
      console.log('✅ Payment 1294 is correctly configured as INCOME (direction="in")');
      console.log('   This is a refund FROM car rental service TO us, so it should be income.');
    } else {
      console.log(`⚠️  Payment 1294 has direction="${payment.direction}", but should be "in" (income)`);
    }

    if (payment.expense_category_id) {
      console.log(`⚠️  Warning: Payment has expense_category_id=${payment.expense_category_id}, but it should be income (no expense category)`);
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




