#!/usr/bin/env node

/**
 * Script to verify PNL 2024 import - compare Excel totals with database totals
 */

require('dotenv').config();
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
const supabase = require('../src/services/supabaseClient');

const EXCEL_FILE = path.join(__dirname, '../tmp/P&L  2.xlsx');
const YEAR = 2024;

function parseEurAmount(value) {
  if (!value) return null;
  if (typeof value === 'number') return value;
  
  let str = String(value).trim();
  str = str.replace(/€|EUR|EUR\s*/gi, '').trim();
  str = str.replace(/,/g, '');
  const amount = parseFloat(str);
  return isNaN(amount) ? null : amount;
}

async function main() {
  console.log('🔍 Verification of PNL 2024 Import');
  console.log('='.repeat(70));
  console.log('');
  
  // Read Excel file
  console.log('📁 Reading Excel file...');
  const workbook = XLSX.readFile(EXCEL_FILE);
  const worksheet = workbook.Sheets['2024'];
  const data = XLSX.utils.sheet_to_json(worksheet, { 
    header: 1, 
    defval: '',
    raw: false 
  });
  
  // Find "Расходы" row (total expenses)
  const expensesRow = data.find(row => String(row[0] || '').trim() === 'Расходы');
  
  if (!expensesRow) {
    console.error('❌ Row "Расходы" not found in Excel');
    process.exit(1);
  }
  
  console.log('✅ Found "Расходы" row in Excel');
  console.log('');
  
  // Parse header row to find "Итого" column
  const headerRow = data[1];
  let totalColumnIndex = -1;
  for (let i = 0; i < headerRow.length; i++) {
    const header = String(headerRow[i] || '').trim();
    if (header.toLowerCase().includes('итого')) {
      totalColumnIndex = i;
      break;
    }
  }
  
  if (totalColumnIndex === -1) {
    console.error('❌ "Итого" column not found');
    process.exit(1);
  }
  
  // Get total from Excel (from "Итого" column)
  const excelTotalEurFromColumn = parseEurAmount(expensesRow[totalColumnIndex]);
  
  // Also calculate total by summing all months
  let excelTotalEurFromMonths = 0;
  const MONTH_MAPPING = {
    'Февраль': 2, 'Март': 3, 'Апрель': 4, 'Май': 5, 'Июнь': 6,
    'Июль': 7, 'Август': 8, 'Сентябрь': 9, 'Октябрь': 10, 'Ноябрь': 11, 'Декабрь': 12
  };
  
  const monthColumns = {};
  for (let colIndex = 1; colIndex < headerRow.length; colIndex++) {
    const header = String(headerRow[colIndex] || '').trim();
    for (const [monthName, monthNum] of Object.entries(MONTH_MAPPING)) {
      if (header.includes(monthName)) {
        monthColumns[monthNum] = colIndex;
        break;
      }
    }
  }
  
  Object.values(monthColumns).forEach(colIndex => {
    const eurAmount = parseEurAmount(expensesRow[colIndex]);
    if (eurAmount && eurAmount > 0) {
      excelTotalEurFromMonths += eurAmount;
    }
  });
  
  console.log('📊 Excel Totals:');
  if (excelTotalEurFromColumn !== null) {
    console.log(`   Колонка "Итого": ${excelTotalEurFromColumn.toFixed(2)} EUR`);
  }
  console.log(`   Сумма по месяцам: ${excelTotalEurFromMonths.toFixed(2)} EUR`);
  console.log('');
  
  // Get all imported entries from database
  console.log('💾 Loading imported entries from database...');
  const { data: entries, error } = await supabase
    .from('pnl_manual_entries')
    .select('amount_pln, currency_breakdown, month')
    .eq('year', YEAR)
    .eq('entry_type', 'expense');
  
  if (error) {
    console.error(`❌ Error loading entries: ${error.message}`);
    process.exit(1);
  }
  
  console.log(`✅ Loaded ${entries.length} entries from database`);
  console.log('');
  
  // Calculate totals
  let totalPln = 0;
  let totalEur = 0;
  const byMonth = {};
  
  entries.forEach(entry => {
    totalPln += parseFloat(entry.amount_pln || 0);
    
    // Get EUR amount from currency_breakdown
    if (entry.currency_breakdown && entry.currency_breakdown.EUR) {
      totalEur += parseFloat(entry.currency_breakdown.EUR);
    }
    
    // Group by month
    const month = entry.month;
    if (!byMonth[month]) {
      byMonth[month] = { pln: 0, eur: 0, count: 0 };
    }
    byMonth[month].pln += parseFloat(entry.amount_pln || 0);
    if (entry.currency_breakdown && entry.currency_breakdown.EUR) {
      byMonth[month].eur += parseFloat(entry.currency_breakdown.EUR);
    }
    byMonth[month].count++;
  });
  
  console.log('📊 Database Totals:');
  console.log(`   Total EUR: ${totalEur.toFixed(2)} EUR`);
  console.log(`   Total PLN: ${totalPln.toFixed(2)} PLN`);
  console.log('');
  
  // Compare
  console.log('='.repeat(70));
  console.log('📈 COMPARISON:');
  console.log('-'.repeat(70));
  console.log(`Excel Total (сумма по месяцам): ${excelTotalEurFromMonths.toFixed(2)} EUR`);
  console.log(`Database Total:                  ${totalEur.toFixed(2)} EUR`);
  console.log(`Difference:                       ${(totalEur - excelTotalEurFromMonths).toFixed(2)} EUR`);
  console.log('');
  
  const difference = Math.abs(totalEur - excelTotalEurFromMonths);
  const tolerance = 0.01; // Allow 1 cent difference due to rounding
  
  if (difference <= tolerance) {
    console.log('✅ SUCCESS: Totals match perfectly!');
  } else {
    console.log('⚠️  WARNING: Totals do not match!');
    console.log(`   Difference: ${difference.toFixed(2)} EUR`);
  }
  console.log('');
  
  // Check Revenue vs Expenses for net loss
  const revenueRow = data.find(row => String(row[0] || '').trim() === 'Revenue');
  if (revenueRow) {
    const revenueTotal = parseEurAmount(revenueRow[totalColumnIndex]);
    if (revenueTotal !== null) {
      const netLoss = revenueTotal - excelTotalEurFromColumn;
      console.log('💰 NET LOSS CALCULATION:');
      console.log('-'.repeat(70));
      console.log(`Revenue (итого):  ${revenueTotal.toFixed(2)} EUR`);
      console.log(`Expenses (итого): ${excelTotalEurFromColumn !== null ? excelTotalEurFromColumn.toFixed(2) : 'N/A'} EUR`);
      if (excelTotalEurFromColumn !== null) {
        console.log(`Net Loss:         ${netLoss.toFixed(2)} EUR`);
        console.log('');
        if (Math.abs(netLoss - (-9026.00)) < 1) {
          console.log('✅ Net loss matches expected -€9,026.00!');
        } else {
          console.log(`⚠️  Net loss differs from expected -€9,026.00 by ${Math.abs(netLoss - (-9026.00)).toFixed(2)} EUR`);
        }
      }
      console.log('');
    }
  }
  
  // Show breakdown by month
  console.log('📅 Breakdown by Month:');
  console.log('-'.repeat(70));
  const monthNames = {
    1: 'Январь', 2: 'Февраль', 3: 'Март', 4: 'Апрель', 5: 'Май', 6: 'Июнь',
    7: 'Июль', 8: 'Август', 9: 'Сентябрь', 10: 'Октябрь', 11: 'Ноябрь', 12: 'Декабрь'
  };
  
  Object.keys(byMonth).sort((a, b) => parseInt(a) - parseInt(b)).forEach(month => {
    const monthData = byMonth[month];
    const monthName = monthNames[parseInt(month)] || `Month ${month}`;
    console.log(`  ${monthName.padEnd(10)}: ${monthData.count.toString().padStart(3)} entries, ${monthData.eur.toFixed(2).padStart(12)} EUR, ${monthData.pln.toFixed(2).padStart(12)} PLN`);
  });
  console.log('');
  
  // Check which categories are imported but not in "Расходы" row
  console.log('🔍 ANALYSIS:');
  console.log('-'.repeat(70));
  console.log(`Excel "Расходы" row total: ${excelTotalEurFromMonths.toFixed(2)} EUR`);
  console.log(`Imported total:            ${totalEur.toFixed(2)} EUR`);
  console.log(`Difference:                ${(totalEur - excelTotalEurFromMonths).toFixed(2)} EUR`);
  console.log('');
  console.log('💡 The difference might be due to:');
  console.log('   - Categories "На вывод" and "Пользование деньгами" might not be included in "Расходы" row');
  console.log('   - Or there might be rounding differences');
  console.log('');
  
  // Check specific categories
  const { data: entriesByCat } = await supabase
    .from('pnl_manual_entries')
    .select('expense_category_id, currency_breakdown')
    .eq('year', YEAR)
    .eq('entry_type', 'expense');
  
  const ExpenseCategoryService = require('../src/services/pnl/expenseCategoryService');
  const cats = await new ExpenseCategoryService().listCategories();
  const catMap = new Map();
  cats.forEach(c => catMap.set(c.id, c.name));
  
  const specialCats = ['Наши зарплаты', 'Bank Fees']; // "На вывод" -> Наши зарплаты, "Пользование деньгами" -> Bank Fees
  let specialCatsTotal = 0;
  
  entriesByCat.forEach(entry => {
    const catName = catMap.get(entry.expense_category_id);
    if (specialCats.includes(catName)) {
      if (entry.currency_breakdown && entry.currency_breakdown.EUR) {
        specialCatsTotal += parseFloat(entry.currency_breakdown.EUR);
      }
    }
  });
  
  console.log(`Categories "На вывод" + "Пользование деньгами": ${specialCatsTotal.toFixed(2)} EUR`);
  console.log(`If we exclude them: ${(totalEur - specialCatsTotal).toFixed(2)} EUR`);
  console.log(`Difference from Excel: ${Math.abs((totalEur - specialCatsTotal) - excelTotalEurFromMonths).toFixed(2)} EUR`);
  console.log('');
}

main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});

