#!/usr/bin/env node

/**
 * Script to fix payment directions for ALL payments in database based on amount_raw sign
 * 
 * This script reads all payments from the database and updates their direction
 * ('in' or 'out') based on the sign of amount_raw field.
 * 
 * Usage:
 *   node tests/scripts/fixAllPaymentDirections.js --dry-run  # Preview changes
 *   node tests/scripts/fixAllPaymentDirections.js --fix       # Apply fixes
 *   node tests/scripts/fixAllPaymentDirections.js --fix --direction=out  # Only fix payments that should be 'out'
 *   node tests/scripts/fixAllPaymentDirections.js --fix --direction=in   # Only fix payments that should be 'in'
 */

require('dotenv').config();
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');

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
  .option('direction', {
    type: 'string',
    choices: ['in', 'out'],
    description: 'Only fix payments that should be this direction'
  })
  .option('limit', {
    type: 'number',
    default: 10000,
    description: 'Maximum number of payments to process'
  })
  .option('batch-size', {
    type: 'number',
    default: 100,
    description: 'Number of payments to process in each batch'
  })
  .help()
  .argv;

if (!argv.dryRun && !argv.fix) {
  console.error('Error: Must specify either --dry-run or --fix');
  process.exit(1);
}

// Use supabaseClient from the project
const supabase = require('../../src/services/supabaseClient');

if (!supabase) {
  console.error('Error: Could not initialize Supabase client');
  console.error('Ensure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set in .env file');
  process.exit(1);
}

/**
 * Determine correct direction based on amount_raw
 */
function getCorrectDirection(amountRaw) {
  if (!amountRaw) {
    return null;
  }
  
  const cleaned = amountRaw.toString().trim();
  
  // Check if starts with minus sign
  if (cleaned.startsWith('-')) {
    return 'out'; // Expense
  }
  
  // Check if contains negative sign anywhere (some formats)
  if (cleaned.includes(' -') || cleaned.match(/^-\s*\d/)) {
    return 'out';
  }
  
  // Positive amount (no minus sign or starts with +)
  // Check if it's explicitly positive or just a number
  if (cleaned.startsWith('+') || cleaned.match(/^\d/)) {
    return 'in'; // Income
  }
  
  // Can't determine
  return null;
}

/**
 * Check if payment direction needs fixing
 */
function needsFix(payment) {
  const correctDirection = getCorrectDirection(payment.amount_raw);
  
  if (!correctDirection) {
    return false; // Can't determine, skip
  }
  
  // Check if current direction is wrong
  if (payment.direction !== correctDirection) {
    // If direction filter is specified, only fix if it matches
    if (argv.direction && correctDirection !== argv.direction) {
      return false;
    }
    return true;
  }
  
  return false;
}

async function main() {
  console.log('🔍 Searching for payments with incorrect directions...');
  console.log(`   Mode: ${argv.dryRun ? 'DRY RUN (preview only)' : 'FIX (will update database)'}`);
  if (argv.direction) {
    console.log(`   Filter: Only fixing payments that should be '${argv.direction}'`);
  }
  console.log(`   Batch size: ${argv.batchSize}`);
  console.log('');

  // Fetch payments in batches
  let allPayments = [];
  let offset = 0;
  const batchSize = argv.batchSize;

  console.log('📥 Fetching payments from database...');
  
  while (true) {
    let query = supabase
      .from('payments')
      .select('id, direction, amount_raw, description, operation_date, amount, currency')
      .not('amount_raw', 'is', null)
      .order('id', { ascending: true })
      .range(offset, offset + batchSize - 1);

    const { data: payments, error } = await query;

    if (error) {
      console.error('❌ Error fetching payments:', error);
      process.exit(1);
    }

    if (!payments || payments.length === 0) {
      break; // No more payments
    }

    allPayments.push(...payments);
    offset += batchSize;

    if (payments.length < batchSize) {
      break; // Last batch
    }

    if (allPayments.length >= argv.limit) {
      allPayments = allPayments.slice(0, argv.limit);
      break;
    }

    process.stdout.write(`   Fetched ${allPayments.length} payments...\r`);
  }

  console.log(`\n📊 Found ${allPayments.length} payments to check\n`);

  if (allPayments.length === 0) {
    console.log('✅ No payments found with amount_raw field');
    return;
  }

  // Find payments that need fixing
  const paymentsToFix = allPayments.filter(needsFix);

  if (paymentsToFix.length === 0) {
    console.log('✅ No payments need fixing - all directions are correct!');
    return;
  }

  console.log(`⚠️  Found ${paymentsToFix.length} payments with incorrect directions:\n`);

  // Group by current vs correct direction
  const stats = {
    'in->out': [],
    'out->in': []
  };

  paymentsToFix.forEach(payment => {
    const correctDirection = getCorrectDirection(payment.amount_raw);
    const key = `${payment.direction}->${correctDirection}`;
    if (!stats[key]) {
      stats[key] = [];
    }
    stats[key].push(payment);
  });

  // Display statistics
  console.log('📈 Statistics:');
  Object.keys(stats).forEach(key => {
    if (stats[key].length > 0) {
      console.log(`   ${key}: ${stats[key].length} payments`);
    }
  });
  console.log('');

  // Show sample payments
  console.log('📋 Sample payments to fix (first 10):');
  paymentsToFix.slice(0, 10).forEach((payment, index) => {
    const correctDirection = getCorrectDirection(payment.amount_raw);
    console.log(`   ${index + 1}. ID: ${payment.id}`);
    console.log(`      Current: direction='${payment.direction}', amount_raw='${payment.amount_raw}', amount=${payment.amount}`);
    console.log(`      Should be: direction='${correctDirection}'`);
    console.log(`      Description: ${payment.description?.substring(0, 60) || 'N/A'}...`);
    console.log(`      Date: ${payment.operation_date}, Amount: ${payment.amount} ${payment.currency}`);
    console.log('');
  });

  if (paymentsToFix.length > 10) {
    console.log(`   ... and ${paymentsToFix.length - 10} more\n`);
  }

  // Apply fixes if not dry-run
  if (!argv.dryRun) {
    console.log('🔧 Applying fixes...\n');

    let fixed = 0;
    let errors = 0;

    // Process in batches to avoid overwhelming the database
    const updateBatchSize = 50;
    for (let i = 0; i < paymentsToFix.length; i += updateBatchSize) {
      const batch = paymentsToFix.slice(i, i + updateBatchSize);
      
      for (const payment of batch) {
        const correctDirection = getCorrectDirection(payment.amount_raw);
        
        try {
          const { error: updateError } = await supabase
            .from('payments')
            .update({ 
              direction: correctDirection,
              updated_at: new Date().toISOString()
            })
            .eq('id', payment.id);

          if (updateError) {
            console.error(`❌ Error updating payment ${payment.id}:`, updateError.message);
            errors++;
          } else {
            fixed++;
            if (fixed % 10 === 0) {
              process.stdout.write(`   Fixed ${fixed}/${paymentsToFix.length}...\r`);
            }
          }
        } catch (error) {
          console.error(`❌ Error updating payment ${payment.id}:`, error.message);
          errors++;
        }
      }
    }

    console.log(`\n✅ Fixed ${fixed} payments`);
    if (errors > 0) {
      console.log(`❌ Errors: ${errors}`);
    }
  } else {
    console.log('\n💡 This was a dry run. Use --fix to apply changes.');
  }
}

main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});




