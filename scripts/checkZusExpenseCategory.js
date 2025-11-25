#!/usr/bin/env node

/**
 * Проверка категорий расходов, связанных с ЗУС
 */

require('dotenv').config();

const supabase = require('../src/services/supabaseClient');
const ExpenseCategoryService = require('../src/services/pnl/expenseCategoryService');
const PnlReportService = require('../src/services/pnl/pnlReportService');

if (!supabase) {
  console.error('❌ Supabase client is not configured.');
  process.exit(1);
}

const YEAR = 2025;
const START_MONTH = 8; // Август

async function main() {
  console.log('🔍 Поиск категорий расходов, связанных с ЗУС\n');
  console.log('='.repeat(80));

  const expenseCategoryService = new ExpenseCategoryService();
  const pnlService = new PnlReportService();

  try {
    // Получаем все категории расходов
    const expenseCategories = await expenseCategoryService.listCategories();
    
    console.log('\n📋 Все категории расходов:');
    console.log('-'.repeat(80));
    expenseCategories.forEach((cat) => {
      console.log(`  ID: ${cat.id}, Название: "${cat.name}"`);
    });

    // Получаем данные PNL за год
    const pnl = await pnlService.getMonthlyRevenue(YEAR, false);
    const expensesFromReport = Array.isArray(pnl.expenses) ? pnl.expenses : [];

    console.log('\n\n💰 Расходы по категориям (август-декабрь 2025):');
    console.log('-'.repeat(80));

    // Фильтруем только месяцы с августа
    const filteredExpenses = expensesFromReport.map((exp) => {
      const filteredMonthly = (exp.monthly || []).filter((m) => m.month >= START_MONTH && m.month <= 12);
      const filteredTotal = filteredMonthly.reduce((sum, m) => sum + (m.amountPln || 0), 0);
      return {
        ...exp,
        monthly: filteredMonthly,
        total: {
          ...exp.total,
          amountPln: filteredTotal
        }
      };
    });

    // Ищем категории, связанные с ЗУС
    const zusKeywords = ['zus', 'зус', 'здоров', 'health', 'ubezpieczen', 'social'];
    const zusCategories = [];

    filteredExpenses.forEach((exp) => {
      const catName = (exp.name || '').toLowerCase();
      const amount = Number(exp.total?.amountPln || 0);
      
      if (amount > 0) {
        const isZus = zusKeywords.some(keyword => catName.includes(keyword));
        if (isZus) {
          zusCategories.push({
            id: exp.id,
            name: exp.name,
            amount: amount
          });
        }
        
        console.log(`  • "${exp.name}" (ID: ${exp.id}): ${amount.toFixed(2).replace('.', ',')} PLN`);
        if (isZus) {
          console.log(`    ⚠️  ПОХОЖЕ НА ЗУС!`);
        }
      }
    });

    console.log('\n\n🎯 Категории, которые могут быть ЗУС:');
    console.log('-'.repeat(80));
    if (zusCategories.length > 0) {
      zusCategories.forEach((cat) => {
        console.log(`  • "${cat.name}" (ID: ${cat.id}): ${cat.amount.toFixed(2).replace('.', ',')} PLN`);
      });
    } else {
      console.log('  ❌ Не найдено категорий с ключевыми словами ЗУС');
      console.log('\n  Проверьте категории вручную выше - возможно название написано по-другому.');
    }

    // Проверяем текущую логику в скрипте
    console.log('\n\n🔧 Текущая логика определения ЗУС в скрипте:');
    console.log('-'.repeat(80));
    console.log('  Проверка: name.toLowerCase().includes("zus")');
    console.log('  Это означает, что категория должна содержать слово "zus" (регистр не важен)');
    
    // Проверяем каждую категорию
    const nameById = new Map();
    expenseCategories.forEach((cat) => {
      if (cat && cat.id != null) {
        nameById.set(cat.id, (cat.name || '').trim());
      }
    });

    filteredExpenses.forEach((exp) => {
      const catId = exp.id;
      const catNameRaw = nameById.get(catId) || exp.name || '';
      const name = (catNameRaw || '').toLowerCase();
      const amount = Number(exp.total?.amountPln || 0);
      
      if (amount > 0) {
        const wouldMatch = name.includes('zus');
        if (wouldMatch) {
          console.log(`\n  ✅ "${catNameRaw}" - СООТВЕТСТВУЕТ (amount: ${amount.toFixed(2).replace('.', ',')} PLN)`);
        } else if (name.includes('зус')) {
          console.log(`\n  ⚠️  "${catNameRaw}" - содержит "зус" но не "zus" (amount: ${amount.toFixed(2).replace('.', ',')} PLN)`);
          console.log(`     Нужно добавить проверку на кириллицу!`);
        }
      }
    });

  } catch (error) {
    console.error('❌ Ошибка:', error.message || error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}


