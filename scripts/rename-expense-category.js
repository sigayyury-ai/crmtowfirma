#!/usr/bin/env node

/**
 * Script to rename an expense category
 * Usage: node scripts/rename-expense-category.js <old-name> <new-name>
 * Example: node scripts/rename-expense-category.js "Планируемые расходы" "Расходы наличными"
 */

require('dotenv').config();
const supabase = require('../src/services/supabaseClient');
const ExpenseCategoryService = require('../src/services/pnl/expenseCategoryService');

const expenseCategoryService = new ExpenseCategoryService();

async function renameCategory(oldName, newName) {
  try {
    console.log(`Поиск категории: "${oldName}"...`);
    
    // Get all categories
    const categories = await expenseCategoryService.listCategories();
    
    // Find category by name
    const category = categories.find(cat => cat.name === oldName);
    
    if (!category) {
      console.error(`❌ Категория "${oldName}" не найдена.`);
      console.log('\nДоступные категории:');
      categories.forEach(cat => {
        console.log(`  - ID: ${cat.id}, Название: "${cat.name}"`);
      });
      process.exit(1);
    }
    
    console.log(`✅ Найдена категория: ID=${category.id}, Название="${category.name}"`);
    console.log(`Переименование в: "${newName}"...`);
    
    // Update category
    const updated = await expenseCategoryService.updateCategory(category.id, {
      name: newName
    });
    
    console.log(`✅ Категория успешно переименована!`);
    console.log(`   Старое название: "${oldName}"`);
    console.log(`   Новое название: "${newName}"`);
    console.log(`   ID: ${updated.id}`);
    
  } catch (error) {
    console.error('❌ Ошибка при переименовании категории:', error.message);
    if (error.message.includes('already exists') || error.message.includes('duplicate')) {
      console.error('   Категория с таким названием уже существует!');
    }
    process.exit(1);
  }
}

// Parse command line arguments
const oldName = process.argv[2];
const newName = process.argv[3];

if (!oldName || !newName) {
  console.error('Использование: node scripts/rename-expense-category.js <старое-название> <новое-название>');
  console.error('Пример: node scripts/rename-expense-category.js "Планируемые расходы" "Расходы наличными"');
  process.exit(1);
}

renameCategory(oldName, newName);


