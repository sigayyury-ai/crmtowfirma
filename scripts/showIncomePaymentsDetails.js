#!/usr/bin/env node

/**
 * Script to show detailed information about income payments without category
 * Shows full descriptions and all relevant fields
 */

require('dotenv').config();
const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');

async function main() {
  console.log('🔍 Showing detailed information about income payments without category...\n');

  if (!supabase) {
    console.error('❌ Supabase client is not configured');
    process.exit(1);
  }

  try {
    // Get all income payments without income_category_id
    const { data: payments, error } = await supabase
      .from('payments')
      .select('*')
      .eq('direction', 'in')
      .is('income_category_id', null)
      .is('deleted_at', null) // Exclude deleted payments
      .order('operation_date', { ascending: false })
      .limit(100);

    if (error) {
      console.error('❌ Error fetching payments:', error);
      process.exit(1);
    }

    if (!payments || payments.length === 0) {
      console.log('✅ No income payments without category found');
      return;
    }

    console.log(`📊 Found ${payments.length} income payment(s) without category:\n`);
    console.log('═'.repeat(100));

    payments.forEach((payment, index) => {
      const date = payment.operation_date ? new Date(payment.operation_date).toLocaleDateString('ru-RU') : 'N/A';
      const amount = `${payment.amount || 0} ${payment.currency || 'PLN'}`;
      const status = payment.manual_status === 'approved' ? 'approved' : (payment.match_status || 'unmatched');
      
      console.log(`\n${index + 1}. Payment ID: ${payment.id}`);
      console.log('─'.repeat(100));
      console.log(`   📅 Date: ${date} (${payment.operation_date || 'N/A'})`);
      console.log(`   💰 Amount: ${amount}`);
      console.log(`   👤 Payer: ${payment.payer_name || '—'}`);
      console.log(`   📝 Description:`);
      console.log(`      ${payment.description || '—'}`);
      console.log(`   🏦 Account: ${payment.account || '—'}`);
      console.log(`   📊 Status: ${status}`);
      console.log(`   🎯 Match Status: ${payment.match_status || '—'}`);
      console.log(`   ✅ Manual Status: ${payment.manual_status || '—'}`);
      console.log(`   📄 Proforma ID: ${payment.proforma_id || '—'}`);
      console.log(`   📄 Proforma Fullnumber: ${payment.proforma_fullnumber || '—'}`);
      console.log(`   📄 Manual Proforma ID: ${payment.manual_proforma_id || '—'}`);
      console.log(`   📄 Manual Proforma Fullnumber: ${payment.manual_proforma_fullnumber || '—'}`);
      console.log(`   💬 Manual Comment: ${payment.manual_comment || '—'}`);
      console.log(`   👤 Manual User: ${payment.manual_user || '—'}`);
      console.log(`   📈 Match Confidence: ${payment.match_confidence || '—'}%`);
      console.log(`   📋 Match Reason: ${payment.match_reason || '—'}`);
      console.log(`   🔍 Source: ${payment.source || '—'}`);
      console.log(`   📦 Expense Category ID: ${payment.expense_category_id || '—'}`);
      console.log(`   📦 Income Category ID: ${payment.income_category_id || '— (NULL - no category)'}`);
      console.log(`   🔑 Operation Hash: ${payment.operation_hash ? payment.operation_hash.substring(0, 20) + '...' : '—'}`);
      console.log(`   📅 Created At: ${payment.created_at ? new Date(payment.created_at).toLocaleString('ru-RU') : '—'}`);
      console.log(`   📅 Updated At: ${payment.updated_at ? new Date(payment.updated_at).toLocaleString('ru-RU') : '—'}`);
      
      if (payment.match_metadata) {
        console.log(`   📊 Match Metadata: ${JSON.stringify(payment.match_metadata, null, 2)}`);
      }
      
      console.log('─'.repeat(100));
    });

    console.log(`\n✅ Total: ${payments.length} income payment(s) without category`);
    console.log('\n💡 Analysis:');
    console.log('   - Payments with "approved" status are matched to proformas (normal income)');
    console.log('   - Payments with "unmatched" status need to be matched or categorized');
    console.log('   - Payments with "ZWROT" or "REFUND" in description should be marked as refunds');

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




