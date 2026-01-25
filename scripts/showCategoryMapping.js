#!/usr/bin/env node

/**
 * Script to show current category mapping and help with coordination
 */

require('dotenv').config();
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
const ExpenseCategoryService = require('../src/services/pnl/expenseCategoryService');

const EXCEL_FILE = path.join(__dirname, '../tmp/P&L  2.xlsx');

// Current mapping
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

async function main() {
  console.log('📋 Category Mapping for PNL 2024 Import');
  console.log('='.repeat(70));
  console.log('');
  
  // Load categories from database
  const expenseCategoryService = new ExpenseCategoryService();
  const dbCategories = await expenseCategoryService.listCategories();
  
  // Create category map
  const categoryMap = new Map();
  dbCategories.forEach(cat => {
    categoryMap.set(cat.id, cat);
  });
  
  // Read Excel categories
  const workbook = XLSX.readFile(EXCEL_FILE);
  const worksheet = workbook.Sheets['2024'];
  const data = XLSX.utils.sheet_to_json(worksheet, { 
    header: 1, 
    defval: '',
    raw: false 
  });
  
  const excelCategories = [];
  for (let rowIndex = 2; rowIndex < data.length; rowIndex++) {
    const row = data[rowIndex];
    const categoryName = String(row[0] || '').trim();
    
    if (!categoryName || categoryName === 'Expenses' || categoryName.toLowerCase() === 'итого' || categoryName === 'Расходы') {
      // 'Расходы' - это общий тотал всех расходов, пропускаем
      continue;
    }
    
    // Skip revenue categories
    const revenueCategories = [
      'Prepaid at client', 'Revolut', 'Stripe transaction', 
      'Paid by cash', 'Revenue', 'Доход/Убыток', 'Balance', 'ROI'
    ];
    if (revenueCategories.includes(categoryName)) {
      continue;
    }
    
    excelCategories.push(categoryName);
  }
  
  console.log('📊 MAPPING STATUS:');
  console.log('-'.repeat(70));
  console.log('');
  
  const mapped = [];
  const unmapped = [];
  
  excelCategories.forEach(catName => {
    const categoryId = CATEGORY_MAPPING[catName];
    if (categoryId) {
      const dbCategory = categoryMap.get(categoryId);
      mapped.push({
        excel: catName,
        dbId: categoryId,
        dbName: dbCategory ? dbCategory.name : `ID ${categoryId} (not found)`,
        type: dbCategory ? dbCategory.management_type : 'unknown'
      });
    } else {
      unmapped.push(catName);
    }
  });
  
  console.log('✅ MAPPED CATEGORIES (' + mapped.length + '):');
  console.log('');
  mapped.forEach((m, index) => {
    console.log(`  ${(index + 1).toString().padStart(2)}. "${m.excel}"`);
    console.log(`     → ID: ${m.dbId.toString().padStart(2)} | ${m.dbName.padEnd(40)} | ${m.type}`);
    console.log('');
  });
  
  if (unmapped.length > 0) {
    console.log('❌ UNMAPPED CATEGORIES (' + unmapped.length + ') - ТРЕБУЕТ СОГЛАСОВАНИЯ:');
    console.log('');
    unmapped.forEach((cat, index) => {
      console.log(`  ${(index + 1).toString().padStart(2)}. "${cat}"`);
    });
    console.log('');
    console.log('💡 Эти категории нужно маппить на существующие категории или создать новые.');
    console.log('   Отредактируйте файл tmp/PNL_2024_CATEGORY_MAPPING.md и сообщите о решениях.');
  }
  
  console.log('='.repeat(70));
  console.log('');
  console.log('📄 Полный документ для согласования: tmp/PNL_2024_CATEGORY_MAPPING.md');
  console.log('');
  console.log('💡 После согласования маппинг будет обновлен в скриптах импорта.');
}

main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});

