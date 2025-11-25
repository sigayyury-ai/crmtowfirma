#!/usr/bin/env node

/**
 * Script to check category breakdown for months with discrepancies
 */

require('dotenv').config();
const supabase = require('../src/services/supabaseClient');
const ExpenseCategoryService = require('../src/services/pnl/expenseCategoryService');

async function main() {
  console.log('🔍 Category Breakdown for Months with Discrepancies');
  console.log('='.repeat(80));
  
  if (!supabase) {
    console.error('❌ Supabase client is not configured');
    process.exit(1);
  }

  const expenseCategoryService = new ExpenseCategoryService();
  const categories = await expenseCategoryService.listCategories();
  const categoryMap = new Map(categories.map(c => [c.id, c]));

  // Months to check: Feb (2), Oct (10), Nov (11), Dec (12)
  const monthsToCheck = [2, 10, 11, 12];

  for (const month of monthsToCheck) {
    console.log(`\n📅 Month ${month}:`);
    console.log('-'.repeat(80));
    
    const { data, error } = await supabase
      .from('pnl_manual_entries')
      .select('*')
      .eq('year', 2024)
      .eq('entry_type', 'expense')
      .eq('month', month)
      .order('expense_category_id', { ascending: true });
    
    if (error) {
      console.error('Error:', error);
      continue;
    }

    let total = 0;
    data.forEach(e => {
      const category = categoryMap.get(e.expense_category_id);
      const categoryName = category ? category.name : `Unknown (ID: ${e.expense_category_id})`;
      const amount = e.amount_pln || 0;
      total += amount;
      console.log(`  ${categoryName.padEnd(30)}: ${amount.toFixed(2)} PLN`);
    });
    console.log(`  ${'TOTAL'.padEnd(30)}: ${total.toFixed(2)} PLN`);
  }

  console.log('\n✅ Done!');
}

main().catch(error => {
  console.error('❌ Error:', error.message);
  process.exit(1);
});




