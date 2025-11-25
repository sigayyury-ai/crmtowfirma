#!/usr/bin/env node

/**
 * Script to check imported PNL data from database
 */

require('dotenv').config();
const supabase = require('../src/services/supabaseClient');

async function main() {
  console.log('🔍 Checking Imported PNL Data');
  console.log('='.repeat(50));
  
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
    .order('expense_category_id', { ascending: true })
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
    .order('category_id', { ascending: true })
    .order('month', { ascending: true });

  if (incomeError) {
    console.error('❌ Error fetching income:', incomeError);
    return;
  }

  console.log(`\n💰 Expenses: ${expenses.length} entries`);
  console.log(`💵 Income: ${income.length} entries`);

  // Calculate totals
  const totalExpenses = expenses.reduce((sum, e) => sum + (e.amount_pln || 0), 0);
  const totalIncome = income.reduce((sum, i) => sum + (i.amount_pln || 0), 0);

  console.log(`\n📊 Totals:`);
  console.log(`  Expenses: ${totalExpenses.toFixed(2)} PLN`);
  console.log(`  Income: ${totalIncome.toFixed(2)} PLN`);
  console.log(`  Profit/Loss: ${(totalIncome - totalExpenses).toFixed(2)} PLN`);

  // Reference values from image (in EUR)
  const referenceExpensesEUR = 127775.91;
  const referenceIncomeEUR = 117521.30;
  const referenceProfitLossEUR = -9026.00;
  
  // Convert to PLN using average rate ~4.28
  const avgRate = 4.28;
  const referenceExpensesPLN = referenceExpensesEUR * avgRate;
  const referenceIncomePLN = referenceIncomeEUR * avgRate;
  const referenceProfitLossPLN = referenceProfitLossEUR * avgRate;

  console.log(`\n🎯 Reference Values (from image):`);
  console.log(`  Expenses: ${referenceExpensesPLN.toFixed(2)} PLN (${referenceExpensesEUR.toFixed(2)} EUR)`);
  console.log(`  Income: ${referenceIncomePLN.toFixed(2)} PLN (${referenceIncomeEUR.toFixed(2)} EUR)`);
  console.log(`  Profit/Loss: ${referenceProfitLossPLN.toFixed(2)} PLN (${referenceProfitLossEUR.toFixed(2)} EUR)`);

  console.log(`\n📈 Differences:`);
  console.log(`  Expenses: ${(totalExpenses - referenceExpensesPLN).toFixed(2)} PLN`);
  console.log(`  Income: ${(totalIncome - referenceIncomePLN).toFixed(2)} PLN`);
  console.log(`  Profit/Loss: ${((totalIncome - totalExpenses) - referenceProfitLossPLN).toFixed(2)} PLN`);

  // Show monthly breakdown
  console.log(`\n📅 Monthly Income Breakdown:`);
  const monthlyIncome = {};
  income.forEach(i => {
    if (!monthlyIncome[i.month]) monthlyIncome[i.month] = 0;
    monthlyIncome[i.month] += i.amount_pln || 0;
  });
  Object.keys(monthlyIncome).sort((a, b) => a - b).forEach(month => {
    console.log(`  Month ${month}: ${monthlyIncome[month].toFixed(2)} PLN`);
  });

  console.log(`\n📅 Monthly Expense Breakdown:`);
  const monthlyExpenses = {};
  expenses.forEach(e => {
    if (!monthlyExpenses[e.month]) monthlyExpenses[e.month] = 0;
    monthlyExpenses[e.month] += e.amount_pln || 0;
  });
  Object.keys(monthlyExpenses).sort((a, b) => a - b).forEach(month => {
    console.log(`  Month ${month}: ${monthlyExpenses[month].toFixed(2)} PLN`);
  });

  console.log('\n✅ Done!');
}

main().catch(error => {
  console.error('❌ Error:', error.message);
  process.exit(1);
});




