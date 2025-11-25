#!/usr/bin/env node

/**
 * Script to check income payments without income category
 * Shows payments with direction='in' and income_category_id IS NULL
 */

require('dotenv').config();
const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');

async function main() {
  console.log('🔍 Checking income payments without category...\n');

  if (!supabase) {
    console.error('❌ Supabase client is not configured');
    process.exit(1);
  }

  try {
    // Get all income payments without income_category_id
    const { data: payments, error } = await supabase
      .from('payments')
      .select('id, operation_date, description, amount, currency, direction, payer_name, income_category_id, match_status, manual_status, proforma_id, proforma_fullnumber')
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

    // Group by status
    const byStatus = {
      matched: [],
      unmatched: [],
      needs_review: [],
      approved: []
    };

    payments.forEach(payment => {
      const status = payment.manual_status === 'approved' ? 'approved' : (payment.match_status || 'unmatched');
      if (!byStatus[status]) {
        byStatus[status] = [];
      }
      byStatus[status].push(payment);
    });

    // Display statistics
    console.log('📈 Statistics by status:');
    Object.keys(byStatus).forEach(status => {
      if (byStatus[status].length > 0) {
        console.log(`   ${status}: ${byStatus[status].length} payment(s)`);
      }
    });
    console.log('');

    // Display all payments
    console.log('📋 All income payments without category:\n');
    payments.forEach((payment, index) => {
      const date = payment.operation_date ? new Date(payment.operation_date).toLocaleDateString('ru-RU') : 'N/A';
      const amount = `${payment.amount || 0} ${payment.currency || 'PLN'}`;
      const status = payment.manual_status === 'approved' ? 'approved' : (payment.match_status || 'unmatched');
      const proforma = payment.proforma_fullnumber || payment.proforma_id || '—';
      
      console.log(`${index + 1}. Payment ID: ${payment.id}`);
      console.log(`   Date: ${date}`);
      console.log(`   Amount: ${amount}`);
      console.log(`   Payer: ${payment.payer_name || '—'}`);
      console.log(`   Description: ${payment.description?.substring(0, 80) || '—'}...`);
      console.log(`   Status: ${status}`);
      console.log(`   Proforma: ${proforma}`);
      console.log('');
    });

    // Summary
    console.log(`\n✅ Total: ${payments.length} income payment(s) without category`);
    console.log('💡 These payments can be:');
    console.log('   - Regular income payments (should be matched to proformas)');
    console.log('   - Refunds (should be marked as "Возвраты" category)');
    console.log('   - Other income (should have appropriate income category)');

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




