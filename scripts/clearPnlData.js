#!/usr/bin/env node

/**
 * Script to clear PNL manual entries for a specific year
 */

require('dotenv').config();
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');

const argv = yargs(hideBin(process.argv))
  .option('year', {
    type: 'number',
    required: true,
    description: 'Year to clear data for'
  })
  .option('dry-run', {
    type: 'boolean',
    default: false,
    description: 'Preview changes without applying them'
  })
  .help()
  .argv;

async function main() {
  console.log('🗑️  Clear PNL Data Tool');
  console.log('='.repeat(50));
  console.log(`Year: ${argv.year}`);
  console.log(`Mode: ${argv.dryRun ? 'DRY RUN (preview only)' : 'DELETE (will remove data)'}`);
  console.log('');

  if (!supabase) {
    console.error('❌ Supabase client is not configured');
    process.exit(1);
  }

  // Count existing entries
  const { count: expenseCount } = await supabase
    .from('pnl_manual_entries')
    .select('*', { count: 'exact', head: true })
    .eq('year', argv.year)
    .eq('entry_type', 'expense');

  const { count: incomeCount } = await supabase
    .from('pnl_manual_entries')
    .select('*', { count: 'exact', head: true })
    .eq('year', argv.year)
    .eq('entry_type', 'revenue');

  console.log(`📊 Found ${expenseCount || 0} expense entries for year ${argv.year}`);
  console.log(`📊 Found ${incomeCount || 0} income entries for year ${argv.year}`);
  console.log('');

  if (argv.dryRun) {
    console.log('💡 This was a dry run. Use --no-dry-run to delete data.');
    return;
  }

  // Delete expense entries
  console.log('🗑️  Deleting expense entries...');
  const { error: expenseError } = await supabase
    .from('pnl_manual_entries')
    .delete()
    .eq('year', argv.year)
    .eq('entry_type', 'expense');

  if (expenseError) {
    console.error('❌ Error deleting expense entries:', expenseError.message);
  } else {
    console.log(`✅ Deleted ${expenseCount || 0} expense entries`);
  }

  // Delete income entries
  console.log('🗑️  Deleting income entries...');
  const { error: incomeError } = await supabase
    .from('pnl_manual_entries')
    .delete()
    .eq('year', argv.year)
    .eq('entry_type', 'revenue');

  if (incomeError) {
    console.error('❌ Error deleting income entries:', incomeError.message);
  } else {
    console.log(`✅ Deleted ${incomeCount || 0} income entries`);
  }

  console.log('');
  console.log('✅ Done!');
}

main().catch(error => {
  console.error('❌ Error:', error.message);
  process.exit(1);
});




