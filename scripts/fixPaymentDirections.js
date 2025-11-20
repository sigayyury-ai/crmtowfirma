#!/usr/bin/env node

/**
 * Script to fix payment directions based on amount_raw sign
 * 
 * Usage:
 *   node scripts/fixPaymentDirections.js --dry-run  # Preview changes
 *   node scripts/fixPaymentDirections.js --fix       # Apply fixes
 *   node scripts/fixPaymentDirections.js --fix --direction=out  # Only fix payments that should be 'out'
 *   node scripts/fixPaymentDirections.js --fix --direction=in   # Only fix payments that should be 'in'
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
    default: 1000,
    description: 'Maximum number of payments to process'
  })
  .help()
  .argv;

if (!argv.dryRun && !argv.fix) {
  console.error('Error: Must specify either --dry-run or --fix');
  process.exit(1);
}

// Use supabaseClient from the project
const supabase = require('../src/services/supabaseClient');

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
  return 'in'; // Income
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
  console.log('');

  // Fetch payments
  let query = supabase
    .from('payments')
    .select('id, direction, amount_raw, description, operation_date, amount, currency')
    .not('amount_raw', 'is', null)
    .limit(argv.limit);

  const { data: payments, error } = await query;

  if (error) {
    console.error('❌ Error fetching payments:', error);
    process.exit(1);
  }

  if (!payments || payments.length === 0) {
    console.log('✅ No payments found');
    return;
  }

  console.log(`📊 Found ${payments.length} payments to check\n`);

  // Find payments that need fixing
  const paymentsToFix = payments.filter(needsFix);

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
    console.log(`      Current: direction='${payment.direction}', amount_raw='${payment.amount_raw}'`);
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

    for (const payment of paymentsToFix) {
      const correctDirection = getCorrectDirection(payment.amount_raw);
      
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

