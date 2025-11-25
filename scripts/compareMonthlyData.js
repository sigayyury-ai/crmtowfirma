#!/usr/bin/env node

/**
 * Script to compare monthly income and expense data with reference values from image
 */

require('dotenv').config();
const supabase = require('../src/services/supabaseClient');

// Reference values from image (in EUR)
const REFERENCE_INCOME_EUR = {
  2: 0.00,    // February
  3: 0.00,    // March
  4: 2340.00, // April
  5: 1373.00, // May
  6: 5712.00, // June
  7: 19342.66, // July
  8: 10467.53, // August
  9: 18737.00, // September
  10: 19429.00, // October
  11: 17093.00, // November
  12: 23027.00  // December
};

const REFERENCE_EXPENSES_EUR = {
  2: 1325.62,  // February
  3: 1008.47,  // March
  4: 3040.42,  // April
  5: 9659.15,  // May
  6: 9188.22,  // June
  7: 15667.32, // July
  8: 14012.13, // August
  9: 13973.88, // September
  10: 16479.19, // October
  11: 20958.69, // November
  12: 22462.83  // December
};

// Exchange rates for 2024
const EXCHANGE_RATES = {
  2: 4.30, 3: 4.30, 4: 4.30, 5: 4.29, 6: 4.29,
  7: 4.26, 8: 4.27, 9: 4.29, 10: 4.32, 11: 4.25, 12: 4.25
};

function convertEurToPln(eur, month) {
  const rate = EXCHANGE_RATES[month] || 4.28;
  return eur * rate;
}

async function main() {
  console.log('🔍 Monthly Data Comparison');
  console.log('='.repeat(80));
  
  if (!supabase) {
    console.error('❌ Supabase client is not configured');
    process.exit(1);
  }

  // Get all expense entries for 2024
  const { data: expenses, error: expenseError } = await supabase
    .from('pnl_manual_entries')
    .select('*')
    .eq('year', 2024)
    .eq('entry_type', 'expense')
    .order('month', { ascending: true });

  if (expenseError) {
    console.error('❌ Error fetching expenses:', expenseError);
    return;
  }

  // Get all income entries for 2024
  const { data: income, error: incomeError } = await supabase
    .from('pnl_manual_entries')
    .select('*')
    .eq('year', 2024)
    .eq('entry_type', 'revenue')
    .order('month', { ascending: true });

  if (incomeError) {
    console.error('❌ Error fetching income:', incomeError);
    return;
  }

  // Calculate monthly totals
  const monthlyIncome = {};
  income.forEach(i => {
    if (!monthlyIncome[i.month]) monthlyIncome[i.month] = 0;
    monthlyIncome[i.month] += i.amount_pln || 0;
  });

  const monthlyExpenses = {};
  expenses.forEach(e => {
    if (!monthlyExpenses[e.month]) monthlyExpenses[e.month] = 0;
    monthlyExpenses[e.month] += e.amount_pln || 0;
  });

  const monthNames = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  console.log('\n💰 INCOME COMPARISON:');
  console.log('-'.repeat(80));
  console.log('Month | Reference (EUR) | Reference (PLN) | Actual (PLN) | Difference (PLN)');
  console.log('-'.repeat(80));
  
  for (let month = 2; month <= 12; month++) {
    const refEur = REFERENCE_INCOME_EUR[month] || 0;
    const refPln = convertEurToPln(refEur, month);
    const actualPln = monthlyIncome[month] || 0;
    const diff = actualPln - refPln;
    const diffSign = diff > 0 ? '+' : '';
    const diffColor = Math.abs(diff) > 1 ? '⚠️' : '✅';
    
    console.log(`${monthNames[month].padEnd(5)} | ${refEur.toFixed(2).padStart(15)} | ${refPln.toFixed(2).padStart(15)} | ${actualPln.toFixed(2).padStart(13)} | ${diffSign}${diff.toFixed(2).padStart(12)} ${diffColor}`);
  }

  console.log('\n💸 EXPENSES COMPARISON:');
  console.log('-'.repeat(80));
  console.log('Month | Reference (EUR) | Reference (PLN) | Actual (PLN) | Difference (PLN)');
  console.log('-'.repeat(80));
  
  for (let month = 2; month <= 12; month++) {
    const refEur = REFERENCE_EXPENSES_EUR[month] || 0;
    const refPln = convertEurToPln(refEur, month);
    const actualPln = monthlyExpenses[month] || 0;
    const diff = actualPln - refPln;
    const diffSign = diff > 0 ? '+' : '';
    const diffColor = Math.abs(diff) > 1 ? '⚠️' : '✅';
    
    console.log(`${monthNames[month].padEnd(5)} | ${refEur.toFixed(2).padStart(15)} | ${refPln.toFixed(2).padStart(15)} | ${actualPln.toFixed(2).padStart(13)} | ${diffSign}${diff.toFixed(2).padStart(12)} ${diffColor}`);
  }

  // Summary
  const totalRefIncomeEUR = Object.values(REFERENCE_INCOME_EUR).reduce((a, b) => a + b, 0);
  const totalRefExpensesEUR = Object.values(REFERENCE_EXPENSES_EUR).reduce((a, b) => a + b, 0);
  const totalRefProfitLossEUR = totalRefIncomeEUR - totalRefExpensesEUR;
  
  const totalActualIncomePLN = Object.values(monthlyIncome).reduce((a, b) => a + b, 0);
  const totalActualExpensesPLN = Object.values(monthlyExpenses).reduce((a, b) => a + b, 0);
  const totalActualProfitLossPLN = totalActualIncomePLN - totalActualExpensesPLN;
  
  const avgRate = 4.28;
  const totalRefIncomePLN = totalRefIncomeEUR * avgRate;
  const totalRefExpensesPLN = totalRefExpensesEUR * avgRate;
  const totalRefProfitLossPLN = totalRefProfitLossEUR * avgRate;

  console.log('\n📊 TOTAL SUMMARY:');
  console.log('-'.repeat(80));
  console.log(`Reference Income:   ${totalRefIncomeEUR.toFixed(2)} EUR = ${totalRefIncomePLN.toFixed(2)} PLN`);
  console.log(`Actual Income:      ${totalActualIncomePLN.toFixed(2)} PLN`);
  console.log(`Difference:         ${(totalActualIncomePLN - totalRefIncomePLN).toFixed(2)} PLN`);
  console.log('');
  console.log(`Reference Expenses: ${totalRefExpensesEUR.toFixed(2)} EUR = ${totalRefExpensesPLN.toFixed(2)} PLN`);
  console.log(`Actual Expenses:    ${totalActualExpensesPLN.toFixed(2)} PLN`);
  console.log(`Difference:         ${(totalActualExpensesPLN - totalRefExpensesPLN).toFixed(2)} PLN`);
  console.log('');
  console.log(`Reference P/L:      ${totalRefProfitLossEUR.toFixed(2)} EUR = ${totalRefProfitLossPLN.toFixed(2)} PLN`);
  console.log(`Actual P/L:         ${totalActualProfitLossPLN.toFixed(2)} PLN`);
  console.log(`Difference:         ${(totalActualProfitLossPLN - totalRefProfitLossPLN).toFixed(2)} PLN`);

  console.log('\n✅ Done!');
}

main().catch(error => {
  console.error('❌ Error:', error.message);
  process.exit(1);
});




