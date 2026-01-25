#!/usr/bin/env node

/**
 * Script to help setup category mapping and temporarily change management_type
 * for importing 2024 PNL data
 */

require('dotenv').config();
const ExpenseCategoryService = require('../src/services/pnl/expenseCategoryService');

// Category mapping: Excel category name -> Database category ID
// This will be used for import
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
  'На вывод': 36, // Наши зарплаты
  'Пользование деньгами': 21, // Bank Fees
  // 'Расходы' - это общий тотал всех расходов, пропускаем при импорте
  // Revenue categories (not expenses, skip these)
  // 'Revenue': null,
  // 'Stripe transaction': null,
  // 'Paid by cash': null,
  // 'Revolut': null,
  // 'Prepaid at client': null,
};

async function main() {
  const action = process.argv[2] || 'show';
  
  console.log('🔧 PNL 2024 Category Setup');
  console.log('='.repeat(70));
  console.log('');
  
  const expenseCategoryService = new ExpenseCategoryService();
  const categories = await expenseCategoryService.listCategories();
  
  // Get unique category IDs that need to be changed to manual
  const categoryIdsToChange = [...new Set(Object.values(CATEGORY_MAPPING))];
  
  if (action === 'show') {
    console.log('📋 Current category mapping:');
    console.log('-'.repeat(70));
    Object.entries(CATEGORY_MAPPING).forEach(([excelName, dbId]) => {
      const category = categories.find(c => c.id === dbId);
      const name = category ? category.name : `ID ${dbId} (not found)`;
      const type = category ? category.management_type : 'unknown';
      console.log(`  "${excelName}" → ${name} (ID: ${dbId}, type: ${type})`);
    });
    console.log('');
    
    console.log('📊 Categories that need management_type="manual":');
    console.log('-'.repeat(70));
    const categoriesToChange = categoryIdsToChange
      .map(id => categories.find(c => c.id === id))
      .filter(c => c);
    
    categoriesToChange.forEach(cat => {
      const needsChange = cat.management_type !== 'manual';
      console.log(`  ${cat.id.toString().padStart(3)} | ${cat.name.padEnd(40)} | ${cat.management_type || 'auto'} ${needsChange ? '→ manual' : '(already manual)'}`);
    });
    console.log('');
    
    console.log('💡 Usage:');
    console.log('  node scripts/setupPnl2024Categories.js change    # Change categories to manual');
    console.log('  node scripts/setupPnl2024Categories.js restore     # Restore original types');
    console.log('  node scripts/setupPnl2024Categories.js show        # Show current mapping');
    
  } else if (action === 'change') {
    console.log('🔄 Changing categories to management_type="manual"...');
    console.log('');
    
    let changed = 0;
    let alreadyManual = 0;
    let errors = 0;
    
    for (const categoryId of categoryIdsToChange) {
      const category = categories.find(c => c.id === categoryId);
      if (!category) {
        console.log(`⚠️  Category ID ${categoryId} not found, skipping`);
        errors++;
        continue;
      }
      
      if (category.management_type === 'manual') {
        console.log(`⏭️  ${category.name} (ID: ${categoryId}): already manual`);
        alreadyManual++;
        continue;
      }
      
      try {
        await expenseCategoryService.updateCategory(categoryId, {
          management_type: 'manual'
        });
        console.log(`✅ ${category.name} (ID: ${categoryId}): changed to manual`);
        changed++;
      } catch (error) {
        console.error(`❌ Error changing ${category.name} (ID: ${categoryId}): ${error.message}`);
        errors++;
      }
    }
    
    console.log('');
    console.log('📊 Results:');
    console.log(`  ✅ Changed: ${changed}`);
    console.log(`  ⏭️  Already manual: ${alreadyManual}`);
    console.log(`  ❌ Errors: ${errors}`);
    console.log('');
    console.log('💡 Now you can run: node scripts/importPnl2024FromExcel.js');
    
  } else if (action === 'restore') {
    console.log('🔄 Restoring categories to management_type="auto"...');
    console.log('');
    
    let restored = 0;
    let alreadyAuto = 0;
    let errors = 0;
    
    for (const categoryId of categoryIdsToChange) {
      const category = categories.find(c => c.id === categoryId);
      if (!category) {
        console.log(`⚠️  Category ID ${categoryId} not found, skipping`);
        errors++;
        continue;
      }
      
      if (category.management_type === 'auto') {
        console.log(`⏭️  ${category.name} (ID: ${categoryId}): already auto`);
        alreadyAuto++;
        continue;
      }
      
      try {
        await expenseCategoryService.updateCategory(categoryId, {
          management_type: 'auto'
        });
        console.log(`✅ ${category.name} (ID: ${categoryId}): restored to auto`);
        restored++;
      } catch (error) {
        console.error(`❌ Error restoring ${category.name} (ID: ${categoryId}): ${error.message}`);
        errors++;
      }
    }
    
    console.log('');
    console.log('📊 Results:');
    console.log(`  ✅ Restored: ${restored}`);
    console.log(`  ⏭️  Already auto: ${alreadyAuto}`);
    console.log(`  ❌ Errors: ${errors}`);
    
  } else {
    console.error(`❌ Unknown action: ${action}`);
    console.log('Available actions: show, change, restore');
    process.exit(1);
  }
}

main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});

