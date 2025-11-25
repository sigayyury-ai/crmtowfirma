#!/usr/bin/env node

/**
 * Script to check all payments marked as refunds (income_category_id = "Возвраты")
 */

require('dotenv').config();
const supabase = require('../src/services/supabaseClient');
const IncomeCategoryService = require('../src/services/pnl/incomeCategoryService');
const logger = require('../src/utils/logger');

async function main() {
  console.log('🔍 Checking all payments marked as refunds...\n');

  if (!supabase) {
    console.error('❌ Supabase client is not configured');
    process.exit(1);
  }

  try {
    // Get "Возвраты" category ID
    const incomeCategoryService = new IncomeCategoryService();
    const categories = await incomeCategoryService.listCategories();
    const refundsCategory = categories.find(cat => cat.name === 'Возвраты');

    if (!refundsCategory) {
      console.error('❌ Category "Возвраты" not found');
      process.exit(1);
    }

    console.log(`✅ Found category "Возвраты" (ID: ${refundsCategory.id})\n`);

    // Get all payments with income_category_id = refundsCategory.id
    const { data: payments, error } = await supabase
      .from('payments')
      .select('*')
      .eq('income_category_id', refundsCategory.id)
      .is('deleted_at', null)
      .order('operation_date', { ascending: false })
      .limit(100);

    if (error) {
      console.error('❌ Error fetching payments:', error);
      process.exit(1);
    }

    if (!payments || payments.length === 0) {
      console.log('❌ No payments found with category "Возвраты"');
      return;
    }

    console.log(`📊 Found ${payments.length} payment(s) marked as refunds:\n`);

    payments.forEach((payment, index) => {
      const date = payment.operation_date ? new Date(payment.operation_date).toLocaleDateString('ru-RU') : 'N/A';
      const amount = `${payment.amount || 0} ${payment.currency || 'PLN'}`;
      const status = payment.manual_status === 'approved' ? 'approved' : (payment.match_status || 'unmatched');
      
      console.log(`${index + 1}. Payment ID: ${payment.id}`);
      console.log(`   📅 Date: ${date} (${payment.operation_date || 'N/A'})`);
      console.log(`   💰 Amount: ${amount}`);
      console.log(`   👤 Payer: ${payment.payer_name || '—'}`);
      console.log(`   📝 Description: ${payment.description?.substring(0, 80) || '—'}...`);
      console.log(`   📊 Status: ${status}`);
      console.log(`   🎯 Match Status: ${payment.match_status || '—'}`);
      console.log(`   ✅ Manual Status: ${payment.manual_status || '—'}`);
      console.log(`   📄 Proforma: ${payment.proforma_fullnumber || payment.proforma_id || '—'}`);
      console.log(`   💬 Manual Comment: ${payment.manual_comment || '—'}`);
      console.log(`   👤 Manual User: ${payment.manual_user || '—'}`);
      console.log(`   📅 Created At: ${payment.created_at ? new Date(payment.created_at).toLocaleString('ru-RU') : '—'}`);
      console.log(`   📅 Updated At: ${payment.updated_at ? new Date(payment.updated_at).toLocaleString('ru-RU') : '—'}`);
      console.log('');
    });

    // Check if they should appear in PNL report
    console.log('💡 PNL Report Analysis:');
    console.log('   - These payments should appear in PNL report under "Возвраты" category');
    console.log('   - They are income payments (direction="in") with income_category_id =', refundsCategory.id);
    console.log('   - Check PNL report service to see if they are filtered correctly');

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




