#!/usr/bin/env node

/**
 * Script to find missing categories by comparing expected vs imported data
 */

require('dotenv').config();
const supabase = require('../src/services/supabaseClient');
const ExpenseCategoryService = require('../src/services/pnl/expenseCategoryService');

// Reference values from image (in EUR)
const REFERENCE_EXPENSES_EUR = {
  10: 16479.19, // October
  11: 20958.69, // November
  12: 22462.83  // December
};

// Exchange rates for 2024
const EXCHANGE_RATES = {
  10: 4.32, 11: 4.25, 12: 4.25
};

// Original data from parseImageData (what should be imported)
const ORIGINAL_DATA = {
  10: { // October
    'Tools': 119.16,
    'Works': 0.00,
    'Other': 888.17, // After subtracting Пользование деньгами
    'Cost of house': 3973.38,
    'Food': 235.43,
    'Transfer': 1033.80,
    'Referal programm': 0.00,
    'Paid ads': 3373.00,
    'ZUS': 250.58,
    'Бухгалтерия': 119.35,
    'Tax / PIT': 803.50,
    'Tax Vat': 296.27,
    'Stripe FEE': 134.54,
    'Возвраты по ВАТ': 0.00,
    'Возвраты клиентам': 360.00,
    'На вывод': 2331.00,
    'Пользование деньгами': 230.00 // Should be excluded
  },
  11: { // November
    'Tools': 148.98,
    'Works': 324.07,
    'Other': -4.81, // After subtracting Пользование деньгами
    'Cost of house': 5281.32,
    'Food': 458.50,
    'Transfer': 2911.19,
    'Referal programm': 156.00,
    'Paid ads': 3265.00,
    'ZUS': 124.42,
    'Бухгалтерия': 122.80,
    'Tax / PIT': 1390.74,
    'Tax Vat': 827.31,
    'Stripe FEE': 286.94,
    'Возвраты по ВАТ': 0.00,
    'Возвраты клиентам': 2912.40,
    'На вывод': 2314.81,
    'Пользование деньгами': 439.00 // Should be excluded
  },
  12: { // December
    'Tools': 186.34,
    'Works': 263.53,
    'Other': 721.08, // After subtracting Пользование деньгами
    'Cost of house': 10988.24,
    'Food': 1704.24,
    'Transfer': 1160.00,
    'Referal programm': 0.00,
    'Paid ads': 1507.25,
    'ZUS': 252.94,
    'Бухгалтерия': 227.06,
    'Tax / PIT': 458.10,
    'Tax Vat': 586.12,
    'Stripe FEE': 0.00,
    'Возвраты по ВАТ': 0.00,
    'Возвраты клиентам': 1619.00,
    'На вывод': 2352.94,
    'Пользование деньгами': 436.00 // Should be excluded
  }
};

function convertEurToPln(eur, month) {
  const rate = EXCHANGE_RATES[month] || 4.28;
  return eur * rate;
}

async function main() {
  console.log('🔍 Finding Missing Categories');
  console.log('='.repeat(80));
  
  if (!supabase) {
    console.error('❌ Supabase client is not configured');
    process.exit(1);
  }

  const expenseCategoryService = new ExpenseCategoryService();
  const categories = await expenseCategoryService.listCategories();
  const categoryMap = new Map(categories.map(c => [c.id, c]));

  for (const month of [10, 11, 12]) {
    console.log(`\n📅 Month ${month}:`);
    console.log('-'.repeat(80));
    
    // Calculate expected total from original data (excluding Пользование деньгами)
    const monthData = ORIGINAL_DATA[month];
    let expectedTotalEUR = 0;
    Object.keys(monthData).forEach(cat => {
      if (cat !== 'Пользование деньгами') {
        expectedTotalEUR += monthData[cat] || 0;
      }
    });
    
    const expectedTotalPLN = convertEurToPln(expectedTotalEUR, month);
    const referenceTotalPLN = convertEurToPln(REFERENCE_EXPENSES_EUR[month], month);
    
    console.log(`Expected from original data: ${expectedTotalEUR.toFixed(2)} EUR = ${expectedTotalPLN.toFixed(2)} PLN`);
    console.log(`Reference from image:        ${REFERENCE_EXPENSES_EUR[month].toFixed(2)} EUR = ${referenceTotalPLN.toFixed(2)} PLN`);
    console.log(`Difference:                  ${(referenceTotalPLN - expectedTotalPLN).toFixed(2)} PLN`);
    
    // Get imported data
    const { data: imported, error } = await supabase
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
    
    const importedTotalPLN = imported.reduce((sum, e) => sum + (e.amount_pln || 0), 0);
    console.log(`Imported total:              ${importedTotalPLN.toFixed(2)} PLN`);
    console.log(`Missing:                     ${(referenceTotalPLN - importedTotalPLN).toFixed(2)} PLN`);
    
    // Show breakdown
    console.log('\nCategory breakdown:');
    imported.forEach(e => {
      const category = categoryMap.get(e.expense_category_id);
      const categoryName = category ? category.name : `Unknown (ID: ${e.expense_category_id})`;
      console.log(`  ${categoryName.padEnd(30)}: ${(e.amount_pln || 0).toFixed(2)} PLN`);
    });
  }

  console.log('\n✅ Done!');
}

main().catch(error => {
  console.error('❌ Error:', error.message);
  process.exit(1);
});




