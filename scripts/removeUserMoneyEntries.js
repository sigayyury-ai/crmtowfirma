#!/usr/bin/env node

/**
 * Script to remove "Пользование деньгами" entries from expenses
 * These are credit interest payments and should not be counted as expenses
 */

require('dotenv').config();
const supabase = require('../src/services/supabaseClient');

async function main() {
  console.log('🗑️  Remove "Пользование деньгами" Entries');
  console.log('='.repeat(50));
  
  if (!supabase) {
    console.error('❌ Supabase client is not configured');
    process.exit(1);
  }

  // Find entries with 'Пользование деньгами' category (ID: 37 - Other)
  const { data, error } = await supabase
    .from('pnl_manual_entries')
    .select('*')
    .eq('year', 2024)
    .eq('entry_type', 'expense')
    .eq('expense_category_id', 37)
    .order('month', { ascending: true });
  
  if (error) {
    console.error('❌ Error fetching entries:', error);
    return;
  }

  // Filter entries that have notes mentioning 'Пользование деньгами'
  const userMoneyEntries = data.filter(e => 
    e.notes && e.notes.includes('Пользование деньгами')
  );
  
  console.log(`\n📊 Found ${userMoneyEntries.length} entries for "Пользование деньгами":`);
  let totalAmount = 0;
  userMoneyEntries.forEach(e => {
    console.log(`  Month ${e.month}: ${e.amount_pln} PLN`);
    totalAmount += e.amount_pln || 0;
  });
  console.log(`  Total: ${totalAmount.toFixed(2)} PLN`);
  
  if (userMoneyEntries.length === 0) {
    console.log('\n✅ No entries to delete');
    return;
  }

  // Delete these entries
  const ids = userMoneyEntries.map(e => e.id);
  const { error: deleteError } = await supabase
    .from('pnl_manual_entries')
    .delete()
    .in('id', ids);
  
  if (deleteError) {
    console.error('❌ Delete error:', deleteError);
    process.exit(1);
  }
  
  console.log(`\n✅ Deleted ${userMoneyEntries.length} entries`);
  console.log(`✅ Removed ${totalAmount.toFixed(2)} PLN from expenses`);
  console.log('\n✅ Done!');
}

main().catch(error => {
  console.error('❌ Error:', error.message);
  process.exit(1);
});




