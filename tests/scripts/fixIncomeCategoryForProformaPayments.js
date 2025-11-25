#!/usr/bin/env node

/**
 * Script to assign "На счет" income category to payments matched to proformas
 * that don't have income_category_id
 * 
 * Usage:
 *   node tests/scripts/fixIncomeCategoryForProformaPayments.js --dry-run  # Preview changes
 *   node tests/scripts/fixIncomeCategoryForProformaPayments.js --fix     # Apply fixes
 */

require('dotenv').config();
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const supabase = require('../../src/services/supabaseClient');
const IncomeCategoryService = require('../../src/services/pnl/incomeCategoryService');
const logger = require('../../src/utils/logger');

const argv = yargs(hideBin(process.argv))
  .option('dry-run', {
    type: 'boolean',
    default: false,
    description: 'Preview changes without applying them'
  })
  .option('fix', {
    type: 'boolean',
    default: false,
    description: 'Apply fixes to database'
  })
  .help()
  .argv;

if (!argv.dryRun && !argv.fix) {
  console.error('Error: Must specify either --dry-run or --fix');
  process.exit(1);
}

if (!supabase) {
  console.error('❌ Supabase client is not configured');
  process.exit(1);
}

async function main() {
  console.log('🔍 Finding income payments matched to proformas without income category...');
  console.log(`   Mode: ${argv.dryRun ? 'DRY RUN (preview only)' : 'FIX (will update database)'}`);
  console.log('');

  try {
    // Get "На счет" category ID
    const incomeCategoryService = new IncomeCategoryService();
    const categories = await incomeCategoryService.listCategories();
    const naSchetCategory = categories.find(cat => cat.name === 'На счет');

    if (!naSchetCategory) {
      console.error('❌ Category "На счет" not found in database');
      process.exit(1);
    }

    console.log(`✅ Found category "На счет" (ID: ${naSchetCategory.id})\n`);

    // Find income payments matched to proformas without income_category_id
    const { data: payments, error } = await supabase
      .from('payments')
      .select('id, operation_date, description, amount, currency, proforma_id, proforma_fullnumber, income_category_id, manual_status, match_status')
      .eq('direction', 'in')
      .not('proforma_id', 'is', null) // Has proforma_id
      .is('income_category_id', null) // No income_category_id
      .is('deleted_at', null) // Not deleted
      .order('operation_date', { ascending: false })
      .limit(1000);

    if (error) {
      console.error('❌ Error fetching payments:', error);
      process.exit(1);
    }

    if (!payments || payments.length === 0) {
      console.log('✅ No payments need fixing - all proforma payments have income category');
      return;
    }

    console.log(`📊 Found ${payments.length} payment(s) matched to proformas without income category:\n`);

    // Show sample payments
    console.log('📋 Sample payments to fix (first 10):');
    payments.slice(0, 10).forEach((payment, index) => {
      const date = payment.operation_date ? new Date(payment.operation_date).toLocaleDateString('ru-RU') : 'N/A';
      const amount = `${payment.amount || 0} ${payment.currency || 'PLN'}`;
      const status = payment.manual_status === 'approved' ? 'approved' : (payment.match_status || 'unmatched');
      
      console.log(`   ${index + 1}. Payment ID: ${payment.id}`);
      console.log(`      Date: ${date}`);
      console.log(`      Amount: ${amount}`);
      console.log(`      Proforma: ${payment.proforma_fullnumber || payment.proforma_id || '—'}`);
      console.log(`      Status: ${status}`);
      console.log(`      Description: ${payment.description?.substring(0, 60) || '—'}...`);
      console.log('');
    });

    if (payments.length > 10) {
      console.log(`   ... and ${payments.length - 10} more\n`);
    }

    // Apply fixes if not dry-run
    if (!argv.dryRun) {
      console.log('🔧 Applying fixes...\n');

      let fixed = 0;
      let errors = 0;

      for (const payment of payments) {
        const { error: updateError } = await supabase
          .from('payments')
          .update({ 
            income_category_id: naSchetCategory.id,
            updated_at: new Date().toISOString()
          })
          .eq('id', payment.id);

        if (updateError) {
          console.error(`❌ Error updating payment ${payment.id}:`, updateError.message);
          errors++;
        } else {
          fixed++;
          if (fixed % 10 === 0) {
            process.stdout.write(`   Fixed ${fixed}/${payments.length}...\r`);
          }
        }
      }

      console.log(`\n✅ Fixed ${fixed} payment(s)`);
      if (errors > 0) {
        console.log(`❌ Errors: ${errors}`);
      }
    } else {
      console.log('\n💡 This was a dry run. Use --fix to apply changes.');
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




