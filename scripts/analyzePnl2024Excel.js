#!/usr/bin/env node

/**
 * Script to analyze PNL Excel file for 2024 and help match categories
 */

require('dotenv').config();
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
const ExpenseCategoryService = require('../src/services/pnl/expenseCategoryService');
const IncomeCategoryService = require('../src/services/pnl/incomeCategoryService');

const EXCEL_FILE = path.join(__dirname, '../tmp/P&L  2.xlsx');

async function main() {
  console.log('📊 Analyzing PNL Excel file for 2024');
  console.log('='.repeat(70));
  
  // Check if file exists
  if (!fs.existsSync(EXCEL_FILE)) {
    console.error(`❌ File not found: ${EXCEL_FILE}`);
    process.exit(1);
  }
  
  console.log(`\n📁 Reading file: ${EXCEL_FILE}\n`);
  
  // Read Excel file
  let workbook;
  try {
    workbook = XLSX.readFile(EXCEL_FILE);
  } catch (error) {
    console.error(`❌ Error reading Excel file: ${error.message}`);
    process.exit(1);
  }
  
  // List all sheet names
  console.log('📋 Available sheets:');
  workbook.SheetNames.forEach((name, index) => {
    console.log(`  ${index + 1}. ${name}`);
  });
  
  // Analyze each sheet
  console.log('\n' + '='.repeat(70));
  for (const sheetName of workbook.SheetNames) {
    console.log(`\n📄 Sheet: "${sheetName}"`);
    console.log('-'.repeat(70));
    
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet, { 
      header: 1, 
      defval: '',
      raw: false 
    });
    
    if (data.length === 0) {
      console.log('  (empty sheet)');
      continue;
    }
    
    // Show first 20 rows to understand structure
    console.log(`\n  First ${Math.min(20, data.length)} rows:`);
    data.slice(0, 20).forEach((row, index) => {
      const rowStr = row.map(cell => {
        const str = String(cell || '').trim();
        return str.length > 30 ? str.substring(0, 27) + '...' : str.padEnd(30);
      }).join(' | ');
      console.log(`  ${String(index + 1).padStart(3)}: ${rowStr}`);
    });
    
    if (data.length > 20) {
      console.log(`  ... (${data.length - 20} more rows)`);
    }
    
    // Try to detect structure
    console.log(`\n  Structure analysis:`);
    console.log(`    Total rows: ${data.length}`);
    console.log(`    Max columns: ${Math.max(...data.map(row => row.length))}`);
    
    // Try to find header row (first row with text in multiple columns)
    let headerRowIndex = -1;
    for (let i = 0; i < Math.min(10, data.length); i++) {
      const nonEmptyCells = data[i].filter(cell => String(cell || '').trim().length > 0).length;
      if (nonEmptyCells >= 3) {
        headerRowIndex = i;
        break;
      }
    }
    
    if (headerRowIndex >= 0) {
      console.log(`    Header row: ${headerRowIndex + 1}`);
      const headers = data[headerRowIndex].map(h => String(h || '').trim()).filter(h => h);
      console.log(`    Headers found: ${headers.join(', ')}`);
    }
    
    // Try to detect categories (rows that might be category names)
    const potentialCategories = [];
    for (let i = headerRowIndex + 1; i < Math.min(headerRowIndex + 50, data.length); i++) {
      const firstCell = String(data[i][0] || '').trim();
      if (firstCell.length > 0 && 
          firstCell.length < 100 && 
          !/^\d+$/.test(firstCell) && // not just numbers
          !/^\d{1,2}\/\d{1,2}\/\d{4}/.test(firstCell)) { // not a date
        potentialCategories.push({
          row: i + 1,
          name: firstCell,
          rowData: data[i]
        });
      }
    }
    
    if (potentialCategories.length > 0) {
      console.log(`\n  Potential categories found (first 20):`);
      potentialCategories.slice(0, 20).forEach(cat => {
        console.log(`    Row ${cat.row}: "${cat.name}"`);
      });
      if (potentialCategories.length > 20) {
        console.log(`    ... (${potentialCategories.length - 20} more)`);
      }
    }
  }
  
  // Load categories from database
  console.log('\n' + '='.repeat(70));
  console.log('\n💾 Categories in database:');
  console.log('-'.repeat(70));
  
  try {
    const expenseCategoryService = new ExpenseCategoryService();
    const incomeCategoryService = new IncomeCategoryService();
    
    const expenseCategories = await expenseCategoryService.listCategories();
    const incomeCategories = await incomeCategoryService.listCategories();
    
    console.log('\n💰 EXPENSE CATEGORIES:');
    expenseCategories.forEach(cat => {
      console.log(`  ID: ${cat.id.toString().padStart(3)} | ${cat.name.padEnd(40)} | ${cat.management_type || 'auto'}`);
    });
    
    console.log('\n💵 INCOME CATEGORIES:');
    incomeCategories.forEach(cat => {
      console.log(`  ID: ${cat.id.toString().padStart(3)} | ${cat.name.padEnd(40)} | ${cat.management_type || 'auto'}`);
    });
    
    console.log(`\n✅ Found ${expenseCategories.length} expense categories and ${incomeCategories.length} income categories`);
    
  } catch (error) {
    console.error(`❌ Error loading categories: ${error.message}`);
  }
  
  console.log('\n' + '='.repeat(70));
  console.log('\n💡 Next steps:');
  console.log('  1. Review the Excel structure above');
  console.log('  2. Identify which sheet contains the PNL data for 2024');
  console.log('  3. Identify which columns contain categories and amounts');
  console.log('  4. Create a mapping between Excel categories and database categories');
  console.log('  5. Run import script with the mapping\n');
}

main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});


