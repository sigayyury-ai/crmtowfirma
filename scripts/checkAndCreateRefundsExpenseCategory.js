#!/usr/bin/env node

/**
 * Script to check if "Возвраты клиентам" expense category exists, create if not
 */

require('dotenv').config();
const ExpenseCategoryService = require('../src/services/pnl/expenseCategoryService');
const logger = require('../src/utils/logger');

async function main() {
  console.log('🔍 Checking expense categories...\n');

  try {
    const expenseCategoryService = new ExpenseCategoryService();
    const categories = await expenseCategoryService.listCategories();

    console.log(`📊 Found ${categories.length} expense category(ies):\n`);

    categories.forEach((category, index) => {
      console.log(`${index + 1}. Category ID: ${category.id}`);
      console.log(`   Name: ${category.name}`);
      console.log(`   Description: ${category.description || '—'}`);
      console.log(`   Management Type: ${category.management_type || '—'}`);
      console.log('');
    });

    // Check if "Возвраты клиентам" exists
    const refundsCategory = categories.find(cat => 
      cat.name === 'Возвраты клиентам' || 
      cat.name === 'Возвраты' ||
      cat.name.toLowerCase().includes('возврат')
    );

    if (refundsCategory) {
      console.log(`✅ Found refunds category: "${refundsCategory.name}" (ID: ${refundsCategory.id})`);
    } else {
      console.log('❌ Category "Возвраты клиентам" not found');
      console.log('\n💡 You can create it using:');
      console.log('   POST /api/pnl/expense-categories');
      console.log('   Body: { "name": "Возвраты клиентам", "description": "Возвраты денег клиентам", "management_type": "manual" }');
    }

  } catch (error) {
    logger.error('❌ Fatal error:', error);
    console.error('❌ Fatal error:', error.message);
    process.exit(1);
  }
}

main().catch(error => {
  console.error('❌ Unhandled error:', error);
  process.exit(1);
});




