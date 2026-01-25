#!/usr/bin/env node

/**
 * Direct import to database - bypasses management_type check
 * Imports PNL data directly into pnl_manual_entries table
 */

require('dotenv').config();
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
const ExpenseCategoryService = require('../src/services/pnl/expenseCategoryService');
const supabase = require('../src/services/supabaseClient');

const EXCEL_FILE = path.join(__dirname, '../tmp/P&L  2.xlsx');
const YEAR = 2024;
const BACKUP_DIR = path.join(__dirname, '../tmp/pnl-backups');

// Category mapping: Excel category name -> Database category ID
const CATEGORY_MAPPING = {
  'Tools': 33,
  'Sendpulse': 20,
  'Mailchimp': 20,
  'Pipedrive': 20,
  'Make': 20,
  'Music for video': 20,
  'Linkedin helper': 20,
  'Google admin': 20,
  'Works': 29,
  'Other': 37,
  'Cost of house': 35,
  'Food': 44,
  'Transfer': 43,
  'Referal programm': 41,
  'Paid ads': 20,
  'ZUS': 40,
  'Бухгалтерия': 29,
  'Tax / PIT': 38,
  'Tax Vat': 39,
  'Stripe FEE': 21,
  'Возвраты по ВАТ': 45,
  'Возвраты клиентам': 45,
  'На вывод': 36, // Наши зарплаты
  'Пользование деньгами': 21, // Bank Fees
  // 'Расходы' - это общий тотал всех расходов, пропускаем при импорте
};

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

function parseEurAmount(value) {
  if (!value) return null;
  if (typeof value === 'number') return value;
  
  let str = String(value).trim();
  str = str.replace(/€|EUR|EUR\s*/gi, '').trim();
  str = str.replace(/,/g, '');
  const amount = parseFloat(str);
  return isNaN(amount) ? null : amount;
}

function getExchangeRate(exchangeRateRow, monthIndex) {
  if (!exchangeRateRow || monthIndex < 0 || monthIndex >= exchangeRateRow.length) {
    return null;
  }
  const rate = parseFloat(exchangeRateRow[monthIndex]);
  return isNaN(rate) ? null : rate;
}

function convertEurToPln(eurAmount, exchangeRate) {
  if (!eurAmount || !exchangeRate) return 0;
  return Math.round(eurAmount * exchangeRate * 100) / 100;
}

async function createBackup() {
  console.log('💾 Creating backup...');
  
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
  
  const { data: entries, error } = await supabase
    .from('pnl_manual_entries')
    .select('*')
    .eq('year', YEAR)
    .eq('entry_type', 'expense');
  
  if (error) {
    throw new Error(`Failed to create backup: ${error.message}`);
  }
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0] + '_' + 
                    new Date().toISOString().replace(/[:.]/g, '-').split('T')[1].split('.')[0];
  const backupFile = path.join(BACKUP_DIR, `pnl_manual_entries_${YEAR}_${timestamp}.json`);
  
  const backup = {
    year: YEAR,
    createdAt: new Date().toISOString(),
    entryCount: entries.length,
    entries: entries || []
  };
  
  fs.writeFileSync(backupFile, JSON.stringify(backup, null, 2), 'utf8');
  
  console.log(`✅ Backup created: ${backupFile}`);
  console.log(`📊 Backed up ${entries.length} entries\n`);
  
  return backupFile;
}

async function importDirectToDb(entries, force = false) {
  console.log('💾 Importing directly to database...\n');
  
  let imported = 0;
  let updated = 0;
  let errors = 0;
  const importErrors = [];
  
  // Group entries by category and month for batch upsert
  const entriesByKey = new Map();
  
  for (const entry of entries) {
    const key = `${entry.expenseCategoryId}_${entry.year}_${entry.month}`;
    
    if (!entriesByKey.has(key)) {
      entriesByKey.set(key, entry);
    } else {
      // If duplicate, sum amounts
      const existing = entriesByKey.get(key);
      existing.amountPln += entry.amountPln;
      if (existing.currencyBreakdown && entry.currencyBreakdown) {
        existing.currencyBreakdown.EUR = (existing.currencyBreakdown.EUR || 0) + (entry.currencyBreakdown.EUR || 0);
      }
    }
  }
  
  // Convert to array for batch insert
  const entriesToInsert = Array.from(entriesByKey.values()).map(entry => ({
    expense_category_id: entry.expenseCategoryId,
    category_id: null, // null for expense entries
    entry_type: 'expense',
    year: entry.year,
    month: entry.month,
    amount_pln: parseFloat(entry.amountPln.toFixed(2)),
    currency_breakdown: entry.currencyBreakdown || null,
    notes: `Imported from Excel 2024. Original: ${entry.eurAmount.toFixed(2)} EUR @ ${entry.exchangeRate}`
  }));
  
  // Check existing entries if not forcing
  if (!force) {
    const categoryIds = [...new Set(entriesToInsert.map(e => e.expense_category_id))];
    const { data: existingEntries } = await supabase
      .from('pnl_manual_entries')
      .select('expense_category_id, year, month')
      .eq('year', YEAR)
      .eq('entry_type', 'expense')
      .in('expense_category_id', categoryIds);
    
    const existingKeys = new Set(
      (existingEntries || []).map(e => `${e.expense_category_id}_${e.year}_${e.month}`)
    );
    
    // Filter out existing entries
    const newEntries = entriesToInsert.filter(e => {
      const key = `${e.expense_category_id}_${e.year}_${e.month}`;
      return !existingKeys.has(key);
    });
    
    const entriesToUpdate = entriesToInsert.filter(e => {
      const key = `${e.expense_category_id}_${e.year}_${e.month}`;
      return existingKeys.has(key);
    });
    
    console.log(`📊 New entries: ${newEntries.length}`);
    console.log(`📊 Existing entries: ${entriesToUpdate.length} (will be skipped unless --force)`);
    console.log('');
    
    if (newEntries.length === 0 && entriesToUpdate.length > 0) {
      console.log('⚠️  All entries already exist. Use --force to overwrite.');
      return { imported: 0, updated: 0, errors: 0 };
    }
    
    // Insert new entries
    if (newEntries.length > 0) {
      const { error: insertError } = await supabase
        .from('pnl_manual_entries')
        .insert(newEntries);
      
      if (insertError) {
        console.error(`❌ Error inserting entries: ${insertError.message}`);
        errors += newEntries.length;
        importErrors.push(`Batch insert failed: ${insertError.message}`);
      } else {
        imported = newEntries.length;
        console.log(`✅ Inserted ${imported} new entries`);
      }
    }
    
    // Update existing entries if force
    if (force && entriesToUpdate.length > 0) {
      for (const entry of entriesToUpdate) {
        const { error: updateError } = await supabase
          .from('pnl_manual_entries')
          .update({
            amount_pln: entry.amount_pln,
            currency_breakdown: entry.currency_breakdown,
            notes: entry.notes,
            updated_at: new Date().toISOString()
          })
          .eq('expense_category_id', entry.expense_category_id)
          .eq('year', entry.year)
          .eq('month', entry.month)
          .eq('entry_type', 'expense');
        
        if (updateError) {
          errors++;
          importErrors.push(`Update failed for ${entry.year}-${entry.month}: ${updateError.message}`);
        } else {
          updated++;
        }
      }
      
      if (updated > 0) {
        console.log(`✅ Updated ${updated} existing entries`);
      }
    }
  } else {
    // Force mode: delete existing and insert all
    const categoryIds = [...new Set(entriesToInsert.map(e => e.expense_category_id))];
    
    const { error: deleteError } = await supabase
      .from('pnl_manual_entries')
      .delete()
      .eq('year', YEAR)
      .eq('entry_type', 'expense')
      .in('expense_category_id', categoryIds);
    
    if (deleteError) {
      console.error(`❌ Error deleting existing entries: ${deleteError.message}`);
      throw deleteError;
    }
    
    // Insert all entries
    const { error: insertError } = await supabase
      .from('pnl_manual_entries')
      .insert(entriesToInsert);
    
    if (insertError) {
      console.error(`❌ Error inserting entries: ${insertError.message}`);
      throw insertError;
    }
    
    imported = entriesToInsert.length;
    console.log(`✅ Inserted ${imported} entries (force mode)`);
  }
  
  return { imported, updated, errors, importErrors };
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const force = process.argv.includes('--force');
  const skipBackup = process.argv.includes('--skip-backup');
  
  console.log('📊 Direct PNL Import to Database for 2024');
  console.log('='.repeat(70));
  console.log(`Mode: ${dryRun ? 'DRY RUN (preview only)' : 'IMPORT (direct to database)'}`);
  console.log('⚠️  This script bypasses management_type check');
  if (force) {
    console.log('⚠️  FORCE mode: Will overwrite existing entries');
  }
  if (skipBackup) {
    console.log('⚠️  SKIP BACKUP: No backup will be created');
  }
  console.log('');
  
  // Check if file exists
  if (!fs.existsSync(EXCEL_FILE)) {
    console.error(`❌ File not found: ${EXCEL_FILE}`);
    process.exit(1);
  }
  
  // Load categories (for validation only)
  console.log('📋 Loading categories...');
  const expenseCategoryService = new ExpenseCategoryService();
  
  let dbCategories;
  try {
    dbCategories = await expenseCategoryService.listCategories();
    console.log(`✅ Loaded ${dbCategories.length} categories\n`);
  } catch (error) {
    console.error(`❌ Error loading categories: ${error.message}`);
    process.exit(1);
  }
  
  // Create backup (unless dry-run or skip-backup)
  let backupFile = null;
  if (!dryRun && !skipBackup) {
    try {
      backupFile = await createBackup();
    } catch (error) {
      console.error(`❌ Failed to create backup: ${error.message}`);
      console.error('   Import cancelled for safety.');
      process.exit(1);
    }
  }
  
  // Read Excel file
  console.log(`📁 Reading Excel file: ${EXCEL_FILE}\n`);
  let workbook;
  try {
    workbook = XLSX.readFile(EXCEL_FILE);
  } catch (error) {
    console.error(`❌ Error reading Excel file: ${error.message}`);
    process.exit(1);
  }
  
  const sheetName = '2024';
  if (!workbook.SheetNames.includes(sheetName)) {
    console.error(`❌ Sheet "${sheetName}" not found`);
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
  
  // Parse exchange rates
  const exchangeRateRow = data[0];
  const exchangeRates = [];
  for (let i = 1; i < exchangeRateRow.length; i++) {
    const rate = getExchangeRate(exchangeRateRow, i);
    if (rate) {
      exchangeRates[i] = rate;
    }
  }
  
  // Fill missing rates (e.g., February) with next available rate
  for (let i = 1; i < exchangeRates.length; i++) {
    if (!exchangeRates[i]) {
      // Find next available rate
      for (let j = i + 1; j < exchangeRates.length; j++) {
        if (exchangeRates[j]) {
          exchangeRates[i] = exchangeRates[j];
          console.log(`⚠️  No exchange rate for column ${i}, using rate from column ${j}: ${exchangeRates[j]}`);
          break;
        }
      }
    }
  }
  
  // Parse header row
  const headerRow = data[1];
  const monthColumns = {};
  
  for (let colIndex = 1; colIndex < headerRow.length; colIndex++) {
    const header = String(headerRow[colIndex] || '').trim();
    if (!header) continue;
    
    for (const [monthName, monthNum] of Object.entries(MONTH_MAPPING)) {
      if (header.includes(monthName)) {
        monthColumns[monthNum] = colIndex;
        break;
      }
    }
  }
  
  // Parse expense categories
  const entries = [];
  const unmappedCategories = new Set();
  const skippedCategories = new Set();
  
  console.log('📊 Parsing expense data...\n');
  
  for (let rowIndex = 2; rowIndex < data.length; rowIndex++) {
    const row = data[rowIndex];
    const categoryName = String(row[0] || '').trim();
    
    if (!categoryName || categoryName === 'Expenses' || categoryName.toLowerCase() === 'итого' || categoryName === 'Расходы') {
      // 'Расходы' - это общий тотал всех расходов, пропускаем при импорте
      continue;
    }
    
    let categoryId = CATEGORY_MAPPING[categoryName];
    
    if (!categoryId) {
      unmappedCategories.add(categoryName);
      continue;
    }
    
    const category = dbCategories.find(c => c.id === categoryId);
    if (!category) {
      skippedCategories.add(`${categoryName} (category ID ${categoryId} not found)`);
      continue;
    }
    
    // Parse amounts for each month
    for (const [monthNum, colIndex] of Object.entries(monthColumns)) {
      const month = parseInt(monthNum, 10);
      const cellValue = row[colIndex];
      const eurAmount = parseEurAmount(cellValue);
      
      if (eurAmount === null || eurAmount === 0) {
        continue;
      }
      
      const exchangeRate = exchangeRates[colIndex];
      if (!exchangeRate) {
        continue;
      }
      
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
    console.log('⚠️  Unmapped categories:');
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
    if (backupFile) {
      console.log(`💾 Backup created: ${backupFile}`);
    }
    console.log('Run without --dry-run to import data.');
    return;
  }
  
  // Confirm before import
  if (!force) {
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    const answer = await new Promise(resolve => {
      rl.question(`⚠️  Ready to import ${entries.length} entries directly to database. Continue? (yes/no): `, resolve);
    });
    rl.close();
    
    if (answer.toLowerCase() !== 'yes') {
      console.log('❌ Import cancelled by user');
      if (backupFile) {
        console.log(`💾 Backup available at: ${backupFile}`);
      }
      return;
    }
  }
  
  // Import directly to database
  const result = await importDirectToDb(entries, force);
  
  console.log('\n' + '='.repeat(70));
  console.log('📊 Import Results:');
  console.log(`  ✅ Imported: ${result.imported}`);
  console.log(`  🔄 Updated: ${result.updated}`);
  console.log(`  ❌ Errors: ${result.errors}`);
  console.log('');
  
  if (backupFile) {
    console.log(`💾 Backup saved at: ${backupFile}`);
    console.log(`💡 To restore: node scripts/backupPnlManualEntries.js ${YEAR} ${backupFile}`);
    console.log('');
  }
  
  if (result.errors === 0) {
    console.log('✅ Import completed successfully!');
  } else {
    console.log('⚠️  Import completed with errors. Please review the output above.');
    if (result.importErrors && result.importErrors.length > 0) {
      console.log('\nErrors:');
      result.importErrors.forEach(e => console.log(`  - ${e}`));
    }
    if (backupFile) {
      console.log(`\n💾 You can restore from backup: ${backupFile}`);
    }
  }
}

main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});

