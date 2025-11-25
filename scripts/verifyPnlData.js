#!/usr/bin/env node

/**
 * Script to verify PNL data against reference values
 */

require('dotenv').config();
const supabase = require('../src/services/supabaseClient');
const PnlReportService = require('../src/services/pnl/pnlReportService');

async function main() {
  console.log('🔍 PNL Data Verification');
  console.log('='.repeat(50));
  
  if (!supabase) {
    console.error('❌ Supabase client is not configured');
    process.exit(1);
  }

  const service = new PnlReportService();
  
  try {
    const result = await service.getMonthlyRevenue(2024, true);
    
    console.log('\n📊 Current Data Summary:');
    console.log('-'.repeat(50));
    console.log(`Total Revenue: ${result.total?.amountPln?.toFixed(2) || 0} PLN`);
    console.log(`Total Expenses: ${result.expensesTotal?.amountPln?.toFixed(2) || 0} PLN`);
    console.log(`Total Profit/Loss: ${result.profitLoss?.total?.amountPln?.toFixed(2) || 0} PLN`);
    console.log(`Total Balance: ${result.balance?.total?.amountPln?.toFixed(2) || 0} PLN`);
    
    console.log('\n📅 Monthly Profit/Loss:');
    console.log('-'.repeat(50));
    result.profitLoss?.monthly?.forEach(entry => {
      const monthNames = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      console.log(`  ${monthNames[entry.month]}: ${entry.amountPln.toFixed(2)} PLN`);
    });
    
    console.log('\n📅 Monthly Balance:');
    console.log('-'.repeat(50));
    result.balance?.monthly?.forEach(entry => {
      const monthNames = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      console.log(`  ${monthNames[entry.month]}: ${entry.amountPln.toFixed(2)} PLN`);
    });
    
    // Reference values from image (converted to PLN using average rate ~4.28)
    const referenceProfitLossEUR = -9026.00;
    const referenceProfitLossPLN = referenceProfitLossEUR * 4.28; // Approximate conversion
    
    console.log('\n🎯 Reference Values:');
    console.log('-'.repeat(50));
    console.log(`Expected Profit/Loss: ~${referenceProfitLossPLN.toFixed(2)} PLN (${referenceProfitLossEUR.toFixed(2)} EUR)`);
    console.log(`Actual Profit/Loss: ${result.profitLoss?.total?.amountPln?.toFixed(2) || 0} PLN`);
    console.log(`Difference: ${((result.profitLoss?.total?.amountPln || 0) - referenceProfitLossPLN).toFixed(2)} PLN`);
    
    console.log('\n✅ Done!');
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();




