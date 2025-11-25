#!/usr/bin/env node

/**
 * Script to fix payment 1335: change direction from 'in' to 'out' and assign to "Возвраты клиентам" expense category
 */

require('dotenv').config();
const supabase = require('../../src/services/supabaseClient');
const ExpenseCategoryService = require('../../src/services/pnl/expenseCategoryService');
const logger = require('../../src/utils/logger');

async function main() {
  console.log('🔧 Fixing payment 1335: changing to expense with "Возвраты клиентам" category...\n');

  if (!supabase) {
    console.error('❌ Supabase client is not configured');
    process.exit(1);
  }

  try {
    // Get "Возвраты клиентам" expense category
    const expenseCategoryService = new ExpenseCategoryService();
    const categories = await expenseCategoryService.listCategories();
    const refundsCategory = categories.find(cat => cat.name === 'Возвраты клиентам');

    if (!refundsCategory) {
      console.error('❌ Category "Возвраты клиентам" not found');
      process.exit(1);
    }

    console.log(`✅ Found category "Возвраты клиентам" (ID: ${refundsCategory.id})\n`);

    // Get payment 1335
    const { data: payment, error: fetchError } = await supabase
      .from('payments')
      .select('*')
      .eq('id', 1335)
      .single();

    if (fetchError) {
      console.error('❌ Error fetching payment:', fetchError);
      process.exit(1);
    }

    if (!payment) {
      console.error('❌ Payment 1335 not found');
      process.exit(1);
    }

    console.log('📋 Current payment data:');
    console.log(`   ID: ${payment.id}`);
    console.log(`   Date: ${payment.operation_date}`);
    console.log(`   Amount: ${payment.amount} ${payment.currency}`);
    console.log(`   Description: ${payment.description}`);
    console.log(`   Current Direction: ${payment.direction}`);
    console.log(`   Current Income Category ID: ${payment.income_category_id || '— (NULL)'}`);
    console.log(`   Current Expense Category ID: ${payment.expense_category_id || '— (NULL)'}`);
    console.log('');

    // Update payment: change direction to 'out', assign expense category, clear income category
    const now = new Date().toISOString();
    const { data: updated, error: updateError } = await supabase
      .from('payments')
      .update({
        direction: 'out', // Change to expense
        expense_category_id: refundsCategory.id, // Assign to "Возвраты клиентам"
        income_category_id: null, // Clear income category
        match_status: 'unmatched', // Clear proforma matching
        manual_status: null, // Clear manual matching
        manual_proforma_id: null,
        manual_proforma_fullnumber: null,
        manual_comment: 'Исправлено: возврат клиенту переведен в расходы',
        manual_user: 'system',
        manual_updated_at: now,
        updated_at: now
      })
      .eq('id', 1335)
      .select('*')
      .single();

    if (updateError) {
      console.error('❌ Error updating payment:', updateError);
      process.exit(1);
    }

    console.log('✅ Payment 1335 fixed successfully');
    console.log(`   New Direction: ${updated.direction} (expense)`);
    console.log(`   Expense Category ID: ${updated.expense_category_id} (Возвраты клиентам)`);
    console.log(`   Income Category ID: ${updated.income_category_id || '— (NULL)'}`);
    console.log(`   Match Status: ${updated.match_status}`);
    console.log(`   Manual Status: ${updated.manual_status || '—'}`);
    console.log('');
    console.log('💡 Payment will now appear in expenses list with category "Возвраты клиентам"');

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




