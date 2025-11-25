#!/usr/bin/env node

/**
 * Script to fix payment directions in database based on CSV file
 * 
 * This script reads a CSV file and updates payment directions ('in' or 'out')
 * in the database based on the amount sign and category from CSV.
 * 
 * Usage:
 *   node tests/scripts/fixPaymentsFromCsv.js --csv=tests/all.csv --dry-run  # Preview changes
 *   node tests/scripts/fixPaymentsFromCsv.js --csv=tests/all.csv --fix       # Apply fixes
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');

const argv = yargs(hideBin(process.argv))
  .option('csv', {
    type: 'string',
    required: true,
    description: 'Path to CSV file'
  })
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
  .option('limit', {
    type: 'number',
    default: 10000,
    description: 'Maximum number of payments to process'
  })
  .help()
  .argv;

if (!argv.dryRun && !argv.fix) {
  console.error('Error: Must specify either --dry-run or --fix');
  process.exit(1);
}

// Use supabaseClient from the project
const supabase = require('../../src/services/supabaseClient');
const { parseBankStatement } = require('../../src/services/payments/bankStatementParser');

if (!supabase) {
  console.error('Error: Could not initialize Supabase client');
  console.error('Ensure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set in .env file');
  process.exit(1);
}

/**
 * Determine correct direction based on CSV record
 * The parser already determines direction based on amount sign and stores it in record.direction
 */
function getCorrectDirection(record) {
  if (!record) {
    return null;
  }

  // The parser already determined direction based on amount sign
  // Negative amount in CSV = 'out' (expense), Positive amount = 'in' (income)
  // We just use the direction from the parsed record
  if (record.direction === 'out' || record.direction === 'in') {
    return record.direction;
  }

  // Fallback: if direction is not set, try to determine from amount_raw if available
  if (record.amount_raw) {
    const cleaned = record.amount_raw.toString().trim();
    if (cleaned.startsWith('-')) {
      return 'out'; // Expense
    } else if (cleaned.match(/^[0-9]/)) {
      return 'in'; // Income
    }
  }

  // Can't determine
  return null;
}

/**
 * Find payment in database by operation details
 */
async function findPaymentInDatabase(record) {
  if (!record.operation_hash) {
    return null;
  }

  // Try to find by operation_hash first (most reliable)
  const { data: paymentByHash, error: hashError } = await supabase
    .from('payments')
    .select('id, direction, amount, description, operation_date, operation_hash')
    .eq('operation_hash', record.operation_hash)
    .maybeSingle();

  if (!hashError && paymentByHash) {
    return paymentByHash;
  }

  // Fallback: try to find by date, amount, and description
  if (record.operation_date && record.amount && record.description) {
    const { data: paymentByDetails, error: detailsError } = await supabase
      .from('payments')
      .select('id, direction, amount, description, operation_date, operation_hash')
      .eq('operation_date', record.operation_date)
      .eq('amount', Math.abs(record.amount)) // Compare absolute value
      .ilike('description', `%${record.description.substring(0, 50)}%`)
      .limit(1)
      .maybeSingle();

    if (!detailsError && paymentByDetails) {
      return paymentByDetails;
    }
  }

  return null;
}

/**
 * Check if payment direction needs fixing
 */
function needsFix(payment, correctDirection) {
  if (!payment || !correctDirection) {
    return false;
  }

  // Check if current direction is wrong
  return payment.direction !== correctDirection;
}

async function main() {
  console.log('🔍 Reading CSV file and fixing payment directions...');
  console.log(`   CSV file: ${argv.csv}`);
  console.log(`   Mode: ${argv.dryRun ? 'DRY RUN (preview only)' : 'FIX (will update database)'}`);
  console.log('');

  // Read CSV file
  let csvContent;
  try {
    const csvPath = path.resolve(argv.csv);
    csvContent = fs.readFileSync(csvPath, 'utf-8');
  } catch (error) {
    console.error(`❌ Error reading CSV file: ${error.message}`);
    process.exit(1);
  }

  // Parse CSV
  let records;
  try {
    records = parseBankStatement(csvContent);
  } catch (error) {
    console.error(`❌ Error parsing CSV file: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  }

  if (!records || records.length === 0) {
    console.log('✅ No records found in CSV file');
    return;
  }

  console.log(`📊 Found ${records.length} records in CSV file\n`);

  // Process records
  const paymentsToFix = [];
  const paymentsNotFound = [];
  const paymentsAlreadyCorrect = [];
  const errors = [];

  let processed = 0;
  for (const record of records.slice(0, argv.limit)) {
    processed++;
    
    if (processed % 100 === 0) {
      process.stdout.write(`   Processing ${processed}/${Math.min(records.length, argv.limit)}...\r`);
    }

    const correctDirection = getCorrectDirection(record);
    
    if (!correctDirection) {
      continue; // Skip records where we can't determine direction
    }

    try {
      const payment = await findPaymentInDatabase(record);
      
      if (!payment) {
        paymentsNotFound.push({
          record,
          correctDirection
        });
        continue;
      }

      if (needsFix(payment, correctDirection)) {
        paymentsToFix.push({
          payment,
          record,
          correctDirection
        });
      } else {
        paymentsAlreadyCorrect.push({
          payment,
          record,
          correctDirection
        });
      }
    } catch (error) {
      errors.push({
        record,
        error: error.message
      });
    }
  }

  console.log(`\n📈 Statistics:`);
  console.log(`   Total records processed: ${processed}`);
  console.log(`   Payments found in database: ${paymentsAlreadyCorrect.length + paymentsToFix.length}`);
  console.log(`   Payments already correct: ${paymentsAlreadyCorrect.length}`);
  console.log(`   Payments need fixing: ${paymentsToFix.length}`);
  console.log(`   Payments not found: ${paymentsNotFound.length}`);
  console.log(`   Errors: ${errors.length}`);
  console.log('');

  if (paymentsToFix.length === 0) {
    console.log('✅ No payments need fixing - all directions are correct!');
    if (paymentsNotFound.length > 0) {
      console.log(`\n⚠️  Note: ${paymentsNotFound.length} payments from CSV were not found in database`);
      console.log('   Sample not found payments (first 5):');
      paymentsNotFound.slice(0, 5).forEach((item, index) => {
        console.log(`   ${index + 1}. Date: ${item.record.operation_date}, Amount: ${item.record.amount}, Description: ${item.record.description?.substring(0, 60)}...`);
      });
    }
    return;
  }

  // Group by current vs correct direction
  const stats = {
    'in->out': [],
    'out->in': []
  };

  paymentsToFix.forEach(item => {
    const key = `${item.payment.direction}->${item.correctDirection}`;
    if (!stats[key]) {
      stats[key] = [];
    }
    stats[key].push(item);
  });

  // Display statistics
  console.log('📈 Direction changes:');
  Object.keys(stats).forEach(key => {
    if (stats[key].length > 0) {
      console.log(`   ${key}: ${stats[key].length} payments`);
    }
  });
  console.log('');

  // Show sample payments
  console.log('📋 Sample payments to fix (first 10):');
  paymentsToFix.slice(0, 10).forEach((item, index) => {
    console.log(`   ${index + 1}. Payment ID: ${item.payment.id}`);
    console.log(`      Current: direction='${item.payment.direction}', amount=${item.payment.amount}`);
    console.log(`      Should be: direction='${item.correctDirection}'`);
    console.log(`      Description: ${item.payment.description?.substring(0, 60) || 'N/A'}...`);
    console.log(`      Date: ${item.payment.operation_date}`);
    console.log('');
  });

  if (paymentsToFix.length > 10) {
    console.log(`   ... and ${paymentsToFix.length - 10} more\n`);
  }

  // Apply fixes if not dry-run
  if (!argv.dryRun) {
    console.log('🔧 Applying fixes...\n');

    let fixed = 0;
    let fixErrors = 0;

    for (const item of paymentsToFix) {
      try {
        const { error: updateError } = await supabase
          .from('payments')
          .update({ 
            direction: item.correctDirection,
            updated_at: new Date().toISOString()
          })
          .eq('id', item.payment.id);

        if (updateError) {
          console.error(`❌ Error updating payment ${item.payment.id}:`, updateError.message);
          fixErrors++;
        } else {
          fixed++;
          if (fixed % 10 === 0) {
            process.stdout.write(`   Fixed ${fixed}/${paymentsToFix.length}...\r`);
          }
        }
      } catch (error) {
        console.error(`❌ Error updating payment ${item.payment.id}:`, error.message);
        fixErrors++;
      }
    }

    console.log(`\n✅ Fixed ${fixed} payments`);
    if (fixErrors > 0) {
      console.log(`❌ Errors: ${fixErrors}`);
    }
  } else {
    console.log('\n💡 This was a dry run. Use --fix to apply changes.');
  }

  if (paymentsNotFound.length > 0) {
    console.log(`\n⚠️  Note: ${paymentsNotFound.length} payments from CSV were not found in database`);
    console.log('   These payments may not have been imported yet, or have different operation_hash');
  }
}

main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});

