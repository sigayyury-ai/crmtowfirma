#!/usr/bin/env node

/**
 * Script to list all expense and income categories for mapping
 */

require('dotenv').config();
const ExpenseCategoryService = require('../src/services/pnl/expenseCategoryService');
const IncomeCategoryService = require('../src/services/pnl/incomeCategoryService');

async function main() {
  console.log('📋 Categories for Mapping');
  console.log('='.repeat(50));
  
  try {
    // Create service instances
    const expenseCategoryService = new ExpenseCategoryService();
    const incomeCategoryService = new IncomeCategoryService();
    
    // Load expense categories
    const expenseCategories = await expenseCategoryService.listCategories();
    console.log('\n💰 EXPENSE CATEGORIES:');
    console.log('-'.repeat(50));
    expenseCategories.forEach(cat => {
      console.log(`  ID: ${cat.id.toString().padStart(2, ' ')} | ${cat.name.padEnd(30, ' ')} | ${cat.management_type || 'auto'}`);
    });
    
    // Load income categories
    const incomeCategories = await incomeCategoryService.listCategories();
    console.log('\n💵 INCOME CATEGORIES:');
    console.log('-'.repeat(50));
    incomeCategories.forEach(cat => {
      console.log(`  ID: ${cat.id.toString().padStart(2, ' ')} | ${cat.name.padEnd(30, ' ')} | ${cat.management_type || 'auto'}`);
    });
    
    console.log('\n✅ Done!');
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

main();

