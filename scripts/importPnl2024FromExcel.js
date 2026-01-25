#!/usr/bin/env node

/**
 * Script to import PNL data from Excel file for 2024
 * Handles category mapping and currency conversion
 */

require('dotenv').config();
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
const ExpenseCategoryService = require('../src/services/pnl/expenseCategoryService');
const ManualEntryService = require('../src/services/pnl/manualEntryService');

const EXCEL_FILE = path.join(__dirname, '../tmp/P&L  2.xlsx');
const YEAR = 2024;

// Category mapping: Excel category name -> Database category ID
// This mapping needs to be configured based on the analysis
const CATEGORY_MAPPING = {
  'Tools': 33, // Tools
  'Sendpulse': 20, // Marketing & Advertising
  'Mailchimp': 20, // Marketing & Advertising
  'Pipedrive': 20, // Marketing & Advertising
  'Make': 20, // Marketing & Advertising
  'Music for video': 20, // Marketing & Advertising
  'Linkedin helper': 20, // Marketing & Advertising
  'Google admin': 20, // Marketing & Advertising
  'Works': 29, // Услуги/Работы
  'Other': 37, // Other
  'Cost of house': 35, // Аренда домов
  'Food': 44, // Продукты и бытовые вещи
  'Transfer': 43, // Логистика
  'Referal programm': 41, // Referal programm
  'Paid ads': 20, // Marketing & Advertising
  'ZUS': 40, // ЗУС
  'Бухгалтерия': 29, // Услуги/Работы
  'Tax / PIT': 38, // Налоги
  'Tax Vat': 39, // ВАТ
  'Stripe FEE': 21, // Bank Fees
  'Возвраты по ВАТ': 45, // Возвраты клиентам
  'Возвраты клиентам': 45, // Возвраты клиентам
  // Revenue categories (not expenses, skip these):
  // 'Revenue': null,
  // 'Stripe transaction': null,
  // 'Paid by cash': null,
  // 'Revolut': null,
  // 'Prepaid at client': null,
  // 'На вывод': null,
  // 'Пользование деньгами': null,
  // 'Доход/Убыток': null,
  // 'Balance': null,
  // 'ROI': null,
};

// Month name mapping: Excel month name -> month number (1-12)
const MONTH_MAPPING = {
  'Январь': 1,
  'Февраль': 2,
  'Март': 3,
  'Апрель': 4,
  'Май': 5,
  'Июнь': 6,
  'Июль': 7,
  'Август': 8,
  'Сентябрь': 9,
  'Октябрь': 10,
  'Ноябрь': 11,
  'Декабрь': 12,
};

/**
 * Parse EUR amount from cell value
 * @param {string|number} value - Cell value (e.g., "€ 1,248.98" or 1248.98)
 * @returns {number|null} Parsed amount in EUR or null if invalid
 */
function parseEurAmount(value) {
  if (!value) return null;
  
  // If it's already a number
  if (typeof value === 'number') {
    return value;
  }
  
  // Convert to string and clean
  let str = String(value).trim();
  
  // Remove currency symbols and spaces
  str = str.replace(/€|EUR|EUR\s*/gi, '').trim();
  
  // Remove thousand separators (commas)
  str = str.replace(/,/g, '');
  
  // Parse as float
  const amount = parseFloat(str);
  
  if (isNaN(amount)) {
    return null;
  }
  
  return amount;
}

/**
 * Get exchange rate for a month
 * @param {Array} exchangeRateRow - First row with exchange rates
 * @param {number} monthIndex - Column index for the month (0-based)
 * @returns {number|null} Exchange rate or null if not found
 */
function getExchangeRate(exchangeRateRow, monthIndex) {
  if (!exchangeRateRow || monthIndex < 0 || monthIndex >= exchangeRateRow.length) {
    return null;
  }
  
  const rate = parseFloat(exchangeRateRow[monthIndex]);
  return isNaN(rate) ? null : rate;
}

/**
 * Convert EUR to PLN
 * @param {number} eurAmount - Amount in EUR
 * @param {number} exchangeRate - Exchange rate (EUR to PLN)
 * @returns {number} Amount in PLN
 */
function convertEurToPln(eurAmount, exchangeRate) {
  if (!eurAmount || !exchangeRate) return 0;
  return Math.round(eurAmount * exchangeRate * 100) / 100; // Round to 2 decimals
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const force = process.argv.includes('--force');
  
  console.log('📊 Importing PNL data from Excel for 2024');
  console.log('='.repeat(70));
  console.log(`Mode: ${dryRun ? 'DRY RUN (preview only)' : 'IMPORT (will update database)'}`);
  if (force) {
    console.log('⚠️  FORCE mode: Will overwrite existing entries');
  }
  console.log('');
  
  // Check if file exists
  if (!fs.existsSync(EXCEL_FILE)) {
    console.error(`❌ File not found: ${EXCEL_FILE}`);
    process.exit(1);
  }
  
  // Load categories from database
  console.log('📋 Loading categories from database...');
  const expenseCategoryService = new ExpenseCategoryService();
  const manualEntryService = new ManualEntryService();
  
  let dbCategories;
  try {
    dbCategories = await expenseCategoryService.listCategories();
    console.log(`✅ Loaded ${dbCategories.length} expense categories\n`);
  } catch (error) {
    console.error(`❌ Error loading categories: ${error.message}`);
    process.exit(1);
  }
  
  // Create category name to ID map
  const categoryNameToId = {};
  dbCategories.forEach(cat => {
    categoryNameToId[cat.name.toLowerCase()] = cat.id;
  });
  
  // Read Excel file
  console.log(`📁 Reading Excel file: ${EXCEL_FILE}\n`);
  let workbook;
  try {
    workbook = XLSX.readFile(EXCEL_FILE);
  } catch (error) {
    console.error(`❌ Error reading Excel file: ${error.message}`);
    process.exit(1);
  }
  
  // Get the 2024 sheet
  const sheetName = '2024';
  if (!workbook.SheetNames.includes(sheetName)) {
    console.error(`❌ Sheet "${sheetName}" not found in Excel file`);
    console.log(`Available sheets: ${workbook.SheetNames.join(', ')}`);
    process.exit(1);
  }
  
  const worksheet = workbook.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(worksheet, { 
    header: 1, 
    defval: '',
    raw: false 
  });
  
  if (data.length < 3) {
    console.error('❌ Excel file does not have enough rows');
    process.exit(1);
  }
  
  // Parse exchange rates from first row
  const exchangeRateRow = data[0];
  console.log('💱 Exchange rates found:');
  const exchangeRates = [];
  for (let i = 1; i < exchangeRateRow.length; i++) {
    const rate = getExchangeRate(exchangeRateRow, i);
    if (rate) {
      exchangeRates[i] = rate;
      const monthName = data[1][i] || `Month ${i}`;
      console.log(`  ${monthName}: ${rate}`);
    }
  }
  console.log('');
  
  // Parse header row (row 2, index 1)
  const headerRow = data[1];
  const monthColumns = {}; // Map month number to column index
  
  for (let colIndex = 1; colIndex < headerRow.length; colIndex++) {
    const header = String(headerRow[colIndex] || '').trim();
    if (!header) continue;
    
    // Try to find month number from header name
    for (const [monthName, monthNum] of Object.entries(MONTH_MAPPING)) {
      if (header.includes(monthName)) {
        monthColumns[monthNum] = colIndex;
        break;
      }
    }
  }
  
  console.log('📅 Month columns mapping:');
  Object.entries(monthColumns).sort((a, b) => a[0] - b[0]).forEach(([month, col]) => {
    console.log(`  Month ${month}: Column ${col} (${headerRow[col]})`);
  });
  console.log('');
  
  // Parse expense categories (starting from row 3, index 2)
  const entries = [];
  const unmappedCategories = new Set();
  const skippedCategories = new Set();
  
  console.log('📊 Parsing expense data...\n');
  
  for (let rowIndex = 2; rowIndex < data.length; rowIndex++) {
    const row = data[rowIndex];
    const categoryName = String(row[0] || '').trim();
    
    if (!categoryName || categoryName === 'Expenses' || categoryName.toLowerCase() === 'итого') {
      continue;
    }
    
    // Find category ID
    let categoryId = CATEGORY_MAPPING[categoryName];
    
    if (!categoryId) {
      // Try to find by name match (case-insensitive)
      const lowerName = categoryName.toLowerCase();
      if (categoryNameToId[lowerName]) {
        categoryId = categoryNameToId[lowerName];
      } else {
        unmappedCategories.add(categoryName);
        continue;
      }
    }
    
    // Check if category exists and is manual
    const category = dbCategories.find(c => c.id === categoryId);
    if (!category) {
      skippedCategories.add(`${categoryName} (category ID ${categoryId} not found)`);
      continue;
    }
    
    if (category.management_type !== 'manual') {
      console.log(`⚠️  Skipping "${categoryName}": category "${category.name}" is not manual (type: ${category.management_type})`);
      skippedCategories.add(`${categoryName} (category is not manual)`);
      continue;
    }
    
    // Parse amounts for each month
    for (const [monthNum, colIndex] of Object.entries(monthColumns)) {
      const month = parseInt(monthNum, 10);
      const cellValue = row[colIndex];
      const eurAmount = parseEurAmount(cellValue);
      
      if (eurAmount === null || eurAmount === 0) {
        continue; // Skip empty or zero amounts
      }
      
      // Get exchange rate for this month
      const exchangeRate = exchangeRates[colIndex];
      if (!exchangeRate) {
        console.log(`⚠️  No exchange rate for month ${month}, column ${colIndex}`);
        continue;
      }
      
      // Convert to PLN
      const amountPln = convertEurToPln(eurAmount, exchangeRate);
      
      entries.push({
        expenseCategoryId: categoryId,
        categoryName: categoryName,
        year: YEAR,
        month: month,
        amountPln: amountPln,
        eurAmount: eurAmount,
        exchangeRate: exchangeRate,
        currencyBreakdown: {
          EUR: eurAmount
        }
      });
    }
  }
  
  // Show summary
  console.log('📈 Import Summary:');
  console.log('-'.repeat(70));
  console.log(`Total entries to import: ${entries.length}`);
  console.log(`Categories processed: ${new Set(entries.map(e => e.categoryName)).size}`);
  console.log(`Unmapped categories: ${unmappedCategories.size}`);
  console.log(`Skipped categories: ${skippedCategories.size}`);
  console.log('');
  
  if (unmappedCategories.size > 0) {
    console.log('⚠️  Unmapped categories (need to add to CATEGORY_MAPPING):');
    Array.from(unmappedCategories).sort().forEach(cat => {
      console.log(`  - "${cat}"`);
    });
    console.log('');
  }
  
  if (skippedCategories.size > 0) {
    console.log('⚠️  Skipped categories:');
    Array.from(skippedCategories).sort().forEach(cat => {
      console.log(`  - ${cat}`);
    });
    console.log('');
  }
  
  // Group by category for display
  const byCategory = {};
  entries.forEach(entry => {
    if (!byCategory[entry.categoryName]) {
      byCategory[entry.categoryName] = [];
    }
    byCategory[entry.categoryName].push(entry);
  });
  
  console.log('📋 Entries by category:');
  Object.keys(byCategory).sort().forEach(catName => {
    const catEntries = byCategory[catName];
    const totalPln = catEntries.reduce((sum, e) => sum + e.amountPln, 0);
    const totalEur = catEntries.reduce((sum, e) => sum + e.eurAmount, 0);
    console.log(`  ${catName}: ${catEntries.length} entries, ${totalEur.toFixed(2)} EUR, ${totalPln.toFixed(2)} PLN`);
  });
  console.log('');
  
  if (dryRun) {
    console.log('✅ DRY RUN complete. No data was imported.');
    console.log('Run without --dry-run to import data.');
    return;
  }
  
  // Import entries
  console.log('💾 Importing entries...\n');
  let imported = 0;
  let updated = 0;
  let errors = 0;
  
  for (const entry of entries) {
    try {
      // Check if entry already exists
      const existing = await manualEntryService.getEntry(
        entry.expenseCategoryId,
        entry.year,
        entry.month,
        'expense'
      );
      
      if (existing && !force) {
        console.log(`⏭️  Skipping ${entry.categoryName} ${entry.year}-${entry.month}: entry already exists (use --force to overwrite)`);
        continue;
      }
      
      // Upsert entry
      await manualEntryService.upsertEntry({
        expenseCategoryId: entry.expenseCategoryId,
        entryType: 'expense',
        year: entry.year,
        month: entry.month,
        amountPln: entry.amountPln,
        currencyBreakdown: entry.currencyBreakdown,
        notes: `Imported from Excel 2024. Original: ${entry.eurAmount.toFixed(2)} EUR @ ${entry.exchangeRate}`
      });
      
      if (existing) {
        updated++;
        console.log(`✅ Updated: ${entry.categoryName} ${entry.year}-${entry.month}: ${entry.amountPln.toFixed(2)} PLN`);
      } else {
        imported++;
        console.log(`✅ Imported: ${entry.categoryName} ${entry.year}-${entry.month}: ${entry.amountPln.toFixed(2)} PLN`);
      }
    } catch (error) {
      errors++;
      console.error(`❌ Error importing ${entry.categoryName} ${entry.year}-${entry.month}: ${error.message}`);
    }
  }
  
  console.log('\n' + '='.repeat(70));
  console.log('📊 Import Results:');
  console.log(`  ✅ Imported: ${imported}`);
  console.log(`  🔄 Updated: ${updated}`);
  console.log(`  ❌ Errors: ${errors}`);
  console.log(`  ⏭️  Skipped: ${entries.length - imported - updated - errors}`);
  console.log('');
  
  if (errors === 0) {
    console.log('✅ Import completed successfully!');
  } else {
    console.log('⚠️  Import completed with errors. Please review the output above.');
  }
}

main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});

