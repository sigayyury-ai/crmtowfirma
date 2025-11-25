#!/usr/bin/env node

/**
 * Script to check income categories in the system
 */

require('dotenv').config();
const IncomeCategoryService = require('../src/services/pnl/incomeCategoryService');
const logger = require('../src/utils/logger');

async function main() {
  console.log('🔍 Checking income categories...\n');

  try {
    const incomeCategoryService = new IncomeCategoryService();
    const categories = await incomeCategoryService.listCategories();

    if (!categories || categories.length === 0) {
      console.log('❌ No income categories found');
      return;
    }

    console.log(`📊 Found ${categories.length} income category(ies):\n`);

    categories.forEach((category, index) => {
      console.log(`${index + 1}. Category ID: ${category.id}`);
      console.log(`   Name: ${category.name}`);
      console.log(`   Description: ${category.description || '—'}`);
      console.log(`   Management Type: ${category.management_type || '—'}`);
      console.log(`   Display Order: ${category.display_order !== null && category.display_order !== undefined ? category.display_order : '—'}`);
      console.log('');
    });

    console.log('💡 Note: Payments matched to proformas should have an income category');
    console.log('   If they don\'t have one, they will appear in "Без категории" (Uncategorized)');

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




