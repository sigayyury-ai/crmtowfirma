#!/usr/bin/env node

/**
 * Script to import PNL data from Excel/CSV format
 * Converts EUR to PLN using monthly exchange rates
 * Maps old categories to new system categories
 */

require('dotenv').config();
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const fs = require('fs');
const path = require('path');

const supabase = require('../src/services/supabaseClient');
const ExpenseCategoryService = require('../src/services/pnl/expenseCategoryService');
const IncomeCategoryService = require('../src/services/pnl/incomeCategoryService');
const logger = require('../src/utils/logger');

const argv = yargs(hideBin(process.argv))
  .option('file', {
    type: 'string',
    description: 'Path to CSV/JSON file with PNL data'
  })
  .option('year', {
    type: 'number',
    default: 2025,
    description: 'Year for the data'
  })
  .option('dry-run', {
    type: 'boolean',
    default: false,
    description: 'Preview changes without applying them'
  })
  .help()
  .argv;

// Exchange rates by year (EUR to PLN)
const EXCHANGE_RATES_BY_YEAR = {
  2024: {
    2: 4.30,  // February
    3: 4.30,  // March
    4: 4.30,  // April
    5: 4.29,  // May
    6: 4.29,  // June
    7: 4.26,  // July
    8: 4.27,  // August
    9: 4.29,  // September
    10: 4.32, // October
    11: 4.25, // November
    12: 4.25  // December (using Nov rate as fallback)
  },
  2025: {
    1: 4.23,  // January
    2: 4.23,  // February
    3: 4.15,  // March
    4: 4.21,  // April
    5: 4.22,  // May
    6: 4.22,  // June
    7: 4.22   // July
  }
};

function getExchangeRates(year) {
  return EXCHANGE_RATES_BY_YEAR[year] || {};
}

// Category mapping (old name -> new category ID/name)
// This will be filled in as we go through categories together
const EXPENSE_CATEGORY_MAPPING = {
  // 2025 categories
  'Tools': 33, // Tools -> Tools (ID: 33) ✅
  'Starlink': 37, // Starlink -> Other (ID: 37) ✅ (will be summed with Other)
  'Works': 29, // Works -> Услуги/Работы (ID: 29) ✅ (will be summed with Бухгалтерия)
  'Other': 37, // Other -> Other (ID: 37) ✅ (will be summed with Starlink)
  'Cost of house': 35, // Cost of house -> Аренда домов (ID: 35) ✅
  'Food': 44, // Food -> Продукты и бытовые вещи (ID: 44) ✅
  'Transfer': 43, // Transfer -> Логистика (ID: 43) ✅
  'Referal programm': 41, // Referal programm -> Referal programm (ID: 41) ✅
  'Paid ads': 20, // Paid ads -> Marketing & Advertising (ID: 20) ✅
  'ZUS': 40, // ZUS -> ЗУС (ID: 40) ✅
  'Бухгалтерия': 29, // Бухгалтерия -> Услуги/Работы (ID: 29) ✅ (will be summed with Works)
  'Налоги / PIT': 38, // Налоги / PIT -> Налоги (ID: 38) ✅
  'Tax / PIT': 38, // Tax / PIT -> Налоги (ID: 38) ✅ (2024 variant)
  'Налоги ВАТ': 39, // Налоги ВАТ -> ВАТ (ID: 39) ✅
  'Tax Vat': 39, // Tax Vat -> ВАТ (ID: 39) ✅ (2024 variant)
  'Stripe FEE': 21, // Stripe FEE -> Bank Fees (ID: 21) ✅
  'Возвраты клиентам': 45, // Возвраты клиентам -> Возвраты клиентам (ID: 45) ✅
  'На вывод': 36, // На вывод -> Salary (ID: 36) ✅
  'Пользование деньгами': 37, // Пользование деньгами -> Other (ID: 37) ✅ (interest/fees)
  // Note: 'Возвраты по ВАТ' will be handled specially as income (tax refunds)
};

const INCOME_CATEGORY_MAPPING = {
  // 2025 categories
  'Предоплаты от клиентов': 2, // Предоплаты от клиентов -> На счет (ID: 2) ✅ (will be summed with Revolut, Stripe)
  'Prepaid at client': 2, // Prepaid at client -> На счет (ID: 2) ✅ (2024 variant)
  'Revolut': 2, // Revolut -> На счет (ID: 2) ✅ (will be summed with Предоплаты от клиентов, Stripe)
  'Stripe': 2, // Stripe -> На счет (ID: 2) ✅ (will be summed with Предоплаты от клиентов, Revolut)
  'Stripe transaction': 2, // Stripe transaction -> На счет (ID: 2) ✅ (2024 variant)
  'Оплаты наличкой': 1, // Оплаты наличкой -> Наличные (ID: 1) ✅
  'Paid by cash': 1, // Paid by cash -> Наличные (ID: 1) ✅ (2024 variant)
  // Note: 'Revenue' is not mapped - it's a total row, not a category
};

/**
 * Convert EUR amount to PLN using monthly exchange rate
 */
function convertEurToPln(amountEur, month, year) {
  const rates = getExchangeRates(year);
  const rate = rates[month];
  if (!rate) {
    logger.warn(`No exchange rate for year ${year}, month ${month}, using 4.25`);
    return amountEur * 4.25;
  }
  return amountEur * rate;
}

/**
 * Load categories from database
 */
async function loadCategories() {
  const expenseCategoryService = new ExpenseCategoryService();
  const incomeCategoryService = new IncomeCategoryService();
  
  const expenseCategories = await expenseCategoryService.listCategories();
  const incomeCategories = await incomeCategoryService.listCategories();
  
  return {
    expenses: expenseCategories,
    income: incomeCategories
  };
}

/**
 * Display categories for mapping
 */
function displayCategories(categories) {
  console.log('\n📋 Available categories:');
  categories.forEach((cat, index) => {
    console.log(`   ${index + 1}. ID: ${cat.id}, Name: "${cat.name}"`);
  });
}

/**
 * Parse data from the image description
 * This is a helper to structure the data we see
 */
function parseImageData(year) {
  if (year === 2024) {
    // 2024 data: February to December (no January)
    return {
      year: 2024,
      months: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], // February to December
      exchangeRates: getExchangeRates(2024),
      expenses: {
        'Tools': { 2: 51.15, 3: 71.15, 4: 71.15, 5: 71.15, 6: 71.15, 7: 191.85, 8: 110.23, 9: 156.67, 10: 119.16, 11: 148.98, 12: 186.34 },
        'Works': { 2: 1147.99, 3: 0.00, 4: 0.00, 5: 90.70, 6: 0.00, 7: 35.00, 8: 2959.74, 9: 0.00, 10: 0.00, 11: 324.07, 12: 263.53 },
        'Other': { 2: 126.48, 3: 152.72, 4: 348.84, 5: 224.19, 6: 0.00, 7: 516.20, 8: 0.00, 9: 110.00, 10: 888.17, 11: -4.81, 12: 721.08 }, // Subtracted "Пользование деньгами": Oct: 1118.17-230=888.17, Nov: 434.19-439=-4.81, Dec: 1157.08-436=721.08
        'Cost of house': { 2: 0.00, 3: 0.00, 4: 1418.60, 5: 8236.56, 6: 6148.48, 7: 9659.29, 8: 6545.36, 9: 7994.00, 10: 3973.38, 11: 5281.32, 12: 10988.24 },
        'Food': { 2: 0.00, 3: 0.00, 4: 422.33, 5: 0.00, 6: 167.83, 7: 1395.00, 8: 425.59, 9: 419.62, 10: 235.43, 11: 458.50, 12: 1704.24 },
        'Transfer': { 2: 0.00, 3: 0.00, 4: 150.00, 5: 0.00, 6: 100.00, 7: 534.97, 8: 562.91, 9: 286.00, 10: 1033.80, 11: 2911.19, 12: 1160.00 },
        'Referal programm': { 2: 0.00, 3: 0.00, 4: 62.79, 5: 0.00, 6: 0.00, 7: 75.00, 8: 78.00, 9: 78.00, 10: 0.00, 11: 156.00, 12: 0.00 },
        'Paid ads': { 2: 0.00, 3: 746.00, 4: 528.11, 5: 703.00, 6: 2249.00, 7: 2626.92, 8: 1808.00, 9: 3554.00, 10: 3373.00, 11: 3265.00, 12: 1507.25 },
        'ZUS': { 2: 0.00, 3: 0.00, 4: 0.00, 5: 91.86, 6: 124.71, 7: 250.58, 8: 252.35, 9: 251.76, 10: 250.58, 11: 124.42, 12: 252.94 },
        'Бухгалтерия': { 2: 0.00, 3: 0.00, 4: 0.00, 5: 130.70, 6: 90.91, 7: 146.39, 8: 159.15, 9: 158.78, 10: 119.35, 11: 122.80, 12: 227.06 },
        'Tax / PIT': { 2: 0.00, 3: 0.00, 4: 38.60, 5: 111.00, 6: 236.13, 7: 236.13, 8: 624.65, 9: 270.73, 10: 803.50, 11: 1390.74, 12: 458.10 },
        'Tax Vat': { 2: 0.00, 3: 0.00, 4: 0.00, 5: 0.00, 6: 0.00, 7: 0.00, 8: 486.15, 9: 253.63, 10: 296.27, 11: 827.31, 12: 586.12 },
        'Stripe FEE': { 2: 0.00, 3: 16.17, 4: 0.00, 5: 0.00, 6: 0.00, 7: 0.00, 8: 0.00, 9: 67.32, 10: 134.54, 11: 286.94, 12: 0.00 },
        'Возвраты по ВАТ': { 2: 0.00, 3: 0.00, 4: 0.00, 5: 0.00, 6: 0.00, 7: 0.00, 8: 232.86, 9: 0.00, 10: 0.00, 11: 0.00, 12: 0.00 }, // Will be converted to income
        'Возвраты клиентам': { 2: 0.00, 3: 0.00, 4: 0.00, 5: 0.00, 6: 0.00, 7: 0.00, 8: 0.00, 9: 373.37, 10: 360.00, 11: 2912.40, 12: 1619.00 },
        'На вывод': { 2: 0.00, 3: 0.00, 4: 0.00, 5: 0.00, 6: 0.00, 7: 0.00, 8: 0.00, 9: 0.00, 10: 2331.00, 11: 2314.81, 12: 2352.94 },
        'Пользование деньгами': { 2: 0.00, 3: 0.00, 4: 0.00, 5: 0.00, 6: 0.00, 7: 0.00, 8: 0.00, 9: 0.00, 10: 230.00, 11: 439.00, 12: 436.00 }
      },
      income: {
        // Revenue row (32) shows totals: Apr:2340, May:1373, Jun:5712, Jul:19342.66, Aug:10467.53, Sep:18737, Oct:19429, Nov:17093, Dec:23027
        // Prepaid at client (28): Oct:12217
        // Revolut (29): Aug:500, Oct:275, Nov:708
        // Stripe transaction (30): Sep:348, Oct:277, Nov:1261
        // Paid by cash (31): Jul:11369, Aug:6618, Sep:12287, Oct:6660, Nov:5318, Dec:17455
        // Calculate Prepaid at client as Revenue - other categories for each month
        'Prepaid at client': { 
          2: 0.00, 3: 0.00, 
          4: 740.00,   // Apr: user specified 740.00 (not 2340 from Revenue)
          5: 1373.00,  // May: 1373 (Revenue) - 0 (others) = 1373
          6: 3187.36,  // Jun: user specified 3187.36 (not 5712 from Revenue)
          7: 7973.66,  // Jul: 19342.66 (Revenue) - 11369 (Paid by cash) = 7973.66
          8: 3349.53,  // Aug: 10467.53 (Revenue) - 500 (Revolut) - 6618 (Paid by cash) = 3349.53
          9: 6102.00,  // Sep: 18737 (Revenue) - 348 (Stripe) - 12287 (Paid by cash) = 6102
          10: 12217.00, // Oct: 19429 (Revenue) - 275 (Revolut) - 277 (Stripe) - 6660 (Paid by cash) = 12217
          11: 9806.00,  // Nov: 17093 (Revenue) - 708 (Revolut) - 1261 (Stripe) - 5318 (Paid by cash) = 9806
          12: 5572.00   // Dec: 23027 (Revenue) - 17455 (Paid by cash) = 5572
        },
        'Revolut': { 2: 0.00, 3: 0.00, 4: 0.00, 5: 0.00, 6: 0.00, 7: 0.00, 8: 500.00, 9: 0.00, 10: 275.00, 11: 708.00, 12: 0.00 },
        'Stripe transaction': { 2: 0.00, 3: 0.00, 4: 0.00, 5: 0.00, 6: 0.00, 7: 0.00, 8: 0.00, 9: 348.00, 10: 277.00, 11: 1261.00, 12: 0.00 },
        'Paid by cash': { 2: 0.00, 3: 0.00, 4: 0.00, 5: 0.00, 6: 0.00, 7: 11369.00, 8: 6618.00, 9: 12287.00, 10: 6660.00, 11: 5318.00, 12: 17455.00 }
      }
    };
  }
  
  // 2025 data: January to July
  const data = {
    year: 2025,
    months: [1, 2, 3, 4, 5, 6, 7], // January to July
    exchangeRates: getExchangeRates(2025),
    expenses: {
      'Tools': { 1: 342.37, 2: 305.50, 3: 347.09, 4: 250.45, 5: 207.77, 6: 255.30, 7: 230.93 },
      'Starlink': { 1: 72.00, 2: 72.00, 3: 72.00, 4: 75.53, 5: 75.36, 6: 72.00, 7: 92.89 },
      'Works': { 1: 167.85, 2: 758.87, 3: 1887.47, 4: 1425.18, 5: 1421.80, 6: 1771.80, 7: 1421.80 },
      'Other': { 1: 45.88, 2: 852.13, 3: 167.85, 4: 344.31, 5: 897.63, 6: 376.64, 7: 1271.46 },
      'Cost of house': { 1: 4081.09, 2: 5960.37, 3: 7562.41, 4: 3989.55, 5: 13006.40, 6: 12991.31, 7: 500.00 },
      'Food': { 1: 0.00, 2: 0.00, 3: 180.00, 4: 0.00, 5: 593.13, 6: 100.00, 7: 300.00 },
      'Transfer': { 1: 1445.20, 2: 2144.80, 3: 1098.31, 4: 0.00, 5: 973.70, 6: 1359.50, 7: 1897.05 },
      'Referal programm': { 1: 0.00, 2: 0.00, 3: 246.00, 4: 0.00, 5: 0.00, 6: 0.00, 7: 0.00 },
      'Paid ads': { 1: 1743.94, 2: 1591.10, 3: 2611.11, 4: 2021.00, 5: 314.22, 6: 1872.00, 7: 1702.37 },
      'ZUS': { 1: 254.14, 2: 490.54, 3: 500.00, 4: 950.62, 5: 1247.11, 6: 505.00, 7: 464.69 },
      'Бухгалтерия': { 1: 195.98, 2: 129.08, 3: 155.42, 4: 213.78, 5: 125.91, 6: 102.00, 7: 87.44 },
      'Налоги / PIT': { 1: 193.62, 2: -578.25, 3: -510.60, 4: 489.55, 5: 153.32, 6: 289.00, 7: 318.00 },
      'Налоги ВАТ': { 1: 0.00, 2: 0.00, 3: 363.13, 4: 1302.85, 5: 1012.56, 6: 242.00, 7: 1536.00 },
      'Stripe FEE': { 1: 0.00, 2: 0.00, 3: 0.00, 4: 3.00, 5: 1.11, 6: 1.13, 7: 1.13 },
      'Возвраты клиентам': { 1: 0.00, 2: 0.00, 3: 340.00, 4: 0.00, 5: 0.00, 6: 700.00, 7: 0.00 },
      'На вывод': { 1: 0.00, 2: 0.00, 3: 0.00, 4: 1425.18, 5: 1659.00, 6: 9670.00, 7: 2369.67 }
    },
    income: {
      'Предоплаты от клиентов': { 1: 3612.77, 2: 8687.23, 3: 15630.12, 4: 18223.99, 5: 10814.22, 6: 20909.95, 7: 20972.75 },
      'Revolut': { 1: 0.00, 2: 0.00, 3: 0.00, 4: 0.00, 5: 0.00, 6: 400.00, 7: 0.00 },
      'Stripe': { 1: 0.00, 2: 0.00, 3: 0.00, 4: 0.00, 5: 0.00, 6: 38.87, 7: 392.69 },
      'Оплаты наличкой': { 1: 749.27, 2: 8899.00, 3: 6093.00, 4: 1034.38, 5: 3060.00, 6: 2356.00, 7: 0.00 }
    }
  };
  
  return data;
}

async function main() {
  console.log('📊 PNL Data Import Tool');
  console.log('='.repeat(50));
  console.log(`Year: ${argv.year}`);
  console.log(`Mode: ${argv.dryRun ? 'DRY RUN (preview only)' : 'IMPORT (will save to database)'}`);
  console.log('');

  if (!supabase) {
    console.error('❌ Supabase client is not configured');
    process.exit(1);
  }

  // Load categories
  console.log('📋 Loading categories from database...');
  const categories = await loadCategories();
  
  console.log(`✅ Loaded ${categories.expenses.length} expense categories`);
  console.log(`✅ Loaded ${categories.income.length} income categories`);
  console.log('');

  // Parse data from image
  const pnlData = parseImageData(argv.year);
  
  console.log('📊 Parsed PNL data:');
  console.log(`   Months: ${pnlData.months.join(', ')}`);
  console.log(`   Expense categories: ${Object.keys(pnlData.expenses).length}`);
  console.log(`   Income categories: ${Object.keys(pnlData.income).length}`);
  console.log('');

  // Display expense categories for mapping
  console.log('='.repeat(50));
  console.log('🔍 EXPENSE CATEGORIES MAPPING');
  console.log('='.repeat(50));
  displayCategories(categories.expenses);
  console.log('\n📝 Old expense categories from PNL:');
  Object.keys(pnlData.expenses).forEach((oldName, index) => {
    console.log(`   ${index + 1}. "${oldName}"`);
  });
  console.log('\n💡 We will map these one by one together.');
  console.log('');

  // Display income categories for mapping
  console.log('='.repeat(50));
  console.log('🔍 INCOME CATEGORIES MAPPING');
  console.log('='.repeat(50));
  displayCategories(categories.income);
  console.log('\n📝 Old income categories from PNL:');
  Object.keys(pnlData.income).forEach((oldName, index) => {
    console.log(`   ${index + 1}. "${oldName}"`);
  });
  console.log('\n💡 We will map these one by one together.');
  console.log('');

  console.log('✅ All categories mapped! Starting import...');
  console.log('');

  // Check which categories are manual (required for manual entries)
  const expenseCategoryMap = new Map();
  categories.expenses.forEach(cat => {
    expenseCategoryMap.set(cat.id, cat);
  });

  const incomeCategoryMap = new Map();
  categories.income.forEach(cat => {
    incomeCategoryMap.set(cat.id, cat);
  });

  // Note: We're importing directly to database, so we don't need to change management_type
  // The pnlReportService will load manual entries for ALL categories (both auto and manual)
  console.log('\n💡 Importing directly to database - no need to change category types');

  // Initialize income aggregated for tax refunds
  const incomeAggregated = {}; // { categoryId: { month: totalAmountEur } }
  
  // Aggregate expense data by category and month (sum values that map to same category)
  // Also handle negative tax values as income (tax refunds -> "Возвраты от сервисов")
  const expenseAggregated = {}; // { categoryId: { month: totalAmountEur } }
  const TAX_REFUNDS_CATEGORY_ID = 5; // "Возвраты от сервисов"
  
  Object.keys(pnlData.expenses).forEach(oldCategoryName => {
    const newCategoryId = EXPENSE_CATEGORY_MAPPING[oldCategoryName];
    if (!newCategoryId) {
      console.warn(`⚠️  Warning: No mapping found for expense category "${oldCategoryName}"`);
      return;
    }

    const category = expenseCategoryMap.get(newCategoryId);
    if (!category) {
      console.warn(`⚠️  Warning: Category ID ${newCategoryId} not found in database`);
      return;
    }

    // No longer checking management_type - we import directly to database

    if (!expenseAggregated[newCategoryId]) {
      expenseAggregated[newCategoryId] = {};
    }

    const monthlyData = pnlData.expenses[oldCategoryName];
    Object.keys(monthlyData).forEach(monthStr => {
      const month = parseInt(monthStr, 10);
      const amountEur = monthlyData[month] || 0;
      
      // Special handling for tax refunds: negative values go to income category "Возвраты от сервисов"
      if (oldCategoryName === 'Налоги / PIT' && amountEur < 0) {
        // Verify that the tax refunds category exists
        const taxRefundsCategory = incomeCategoryMap.get(TAX_REFUNDS_CATEGORY_ID);
        if (!taxRefundsCategory) {
          console.warn(`⚠️  Warning: Tax refunds category (ID: ${TAX_REFUNDS_CATEGORY_ID}) not found. Skipping tax refund for month ${month}.`);
          return;
        }
        // Add to income aggregated data as positive value
        if (!incomeAggregated[TAX_REFUNDS_CATEGORY_ID]) {
          incomeAggregated[TAX_REFUNDS_CATEGORY_ID] = {};
        }
        if (!incomeAggregated[TAX_REFUNDS_CATEGORY_ID][month]) {
          incomeAggregated[TAX_REFUNDS_CATEGORY_ID][month] = 0;
        }
        incomeAggregated[TAX_REFUNDS_CATEGORY_ID][month] += Math.abs(amountEur);
        return; // Skip adding to expense aggregated
      }
      
      // Special handling for VAT refunds: "Возвраты по ВАТ" go to income category "Возвраты от сервисов"
      if (oldCategoryName === 'Возвраты по ВАТ' && amountEur > 0) {
        // Verify that the tax refunds category exists
        const taxRefundsCategory = incomeCategoryMap.get(TAX_REFUNDS_CATEGORY_ID);
        if (!taxRefundsCategory) {
          console.warn(`⚠️  Warning: Tax refunds category (ID: ${TAX_REFUNDS_CATEGORY_ID}) not found. Skipping VAT refund for month ${month}.`);
          return;
        }
        // Add to income aggregated data
        if (!incomeAggregated[TAX_REFUNDS_CATEGORY_ID]) {
          incomeAggregated[TAX_REFUNDS_CATEGORY_ID] = {};
        }
        if (!incomeAggregated[TAX_REFUNDS_CATEGORY_ID][month]) {
          incomeAggregated[TAX_REFUNDS_CATEGORY_ID][month] = 0;
        }
        incomeAggregated[TAX_REFUNDS_CATEGORY_ID][month] += amountEur;
        return; // Skip adding to expense aggregated
      }
      
      // Special handling for "Пользование деньгами": skip it (credit interest, not an expense)
      if (oldCategoryName === 'Пользование деньгами') {
        return; // Skip importing this category
      }
      
      if (!expenseAggregated[newCategoryId][month]) {
        expenseAggregated[newCategoryId][month] = 0;
      }
      
      expenseAggregated[newCategoryId][month] += amountEur;
    });
  });

  // Aggregate income data by category and month (sum values that map to same category)
  // Note: incomeAggregated was already initialized above for tax refunds
  Object.keys(pnlData.income).forEach(oldCategoryName => {
    const newCategoryId = INCOME_CATEGORY_MAPPING[oldCategoryName];
    if (!newCategoryId) {
      console.warn(`⚠️  Warning: No mapping found for income category "${oldCategoryName}"`);
      return;
    }

    const category = incomeCategoryMap.get(newCategoryId);
    if (!category) {
      console.warn(`⚠️  Warning: Category ID ${newCategoryId} not found in database`);
      return;
    }

    // No longer checking management_type - we import directly to database

    if (!incomeAggregated[newCategoryId]) {
      incomeAggregated[newCategoryId] = {};
    }

    const monthlyData = pnlData.income[oldCategoryName];
    Object.keys(monthlyData).forEach(monthStr => {
      const month = parseInt(monthStr, 10);
      const amountEur = monthlyData[month] || 0;
      
      if (!incomeAggregated[newCategoryId][month]) {
        incomeAggregated[newCategoryId][month] = 0;
      }
      
      incomeAggregated[newCategoryId][month] += amountEur;
    });
  });

  // Display aggregated data
  console.log('📊 Aggregated Expense Data (EUR):');
  Object.keys(expenseAggregated).forEach(categoryId => {
    const category = expenseCategoryMap.get(parseInt(categoryId, 10));
    console.log(`\n   ${category.name} (ID: ${categoryId}):`);
    Object.keys(expenseAggregated[categoryId]).forEach(monthStr => {
      const month = parseInt(monthStr, 10);
      const amountEur = expenseAggregated[categoryId][month];
      const amountPln = convertEurToPln(amountEur, month, argv.year);
      console.log(`      Month ${month}: ${amountEur.toFixed(2)} EUR = ${amountPln.toFixed(2)} PLN`);
    });
  });

  console.log('\n📊 Aggregated Income Data (EUR):');
  Object.keys(incomeAggregated).forEach(categoryId => {
    const category = incomeCategoryMap.get(parseInt(categoryId, 10));
    console.log(`\n   ${category.name} (ID: ${categoryId}):`);
    Object.keys(incomeAggregated[categoryId]).forEach(monthStr => {
      const month = parseInt(monthStr, 10);
      const amountEur = incomeAggregated[categoryId][month];
      const amountPln = convertEurToPln(amountEur, month, argv.year);
      console.log(`      Month ${month}: ${amountEur.toFixed(2)} EUR = ${amountPln.toFixed(2)} PLN`);
    });
  });

  if (argv.dryRun) {
    console.log('\n💡 This was a dry run. Use --no-dry-run to import data.');
    return;
  }

  // Import data directly to database (bypassing management_type check)
  console.log('\n📥 Importing data directly to database...');
  let importedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  /**
   * Direct upsert to pnl_manual_entries table (bypasses management_type validation)
   */
  async function directUpsertEntry(entryData) {
    const { categoryId, expenseCategoryId, entryType, year, month, amountPln, currencyBreakdown, notes } = entryData;
    
    // Check if entry exists
    let existingQuery = supabase
      .from('pnl_manual_entries')
      .select('id')
      .eq('year', year)
      .eq('month', month)
      .eq('entry_type', entryType);

    if (entryType === 'expense') {
      existingQuery = existingQuery.eq('expense_category_id', expenseCategoryId).is('category_id', null);
    } else {
      existingQuery = existingQuery.eq('category_id', categoryId).is('expense_category_id', null);
    }

    const { data: existingEntry, error: fetchError } = await existingQuery.maybeSingle();

    if (fetchError && fetchError.code !== 'PGRST116') {
      throw fetchError;
    }

    const upsertData = {
      entry_type: entryType,
      year,
      month,
      amount_pln: parseFloat(amountPln.toFixed(2)),
      currency_breakdown: currencyBreakdown || null,
      notes: notes?.trim() || null,
      updated_at: new Date().toISOString()
    };

    if (entryType === 'expense') {
      upsertData.expense_category_id = expenseCategoryId;
      upsertData.category_id = null;
    } else {
      upsertData.category_id = categoryId;
      upsertData.expense_category_id = null;
    }

    let resultData;
    let resultError;

    if (existingEntry) {
      // Update existing entry
      const { data, error } = await supabase
        .from('pnl_manual_entries')
        .update(upsertData)
        .eq('id', existingEntry.id)
        .select()
        .single();
      resultData = data;
      resultError = error;
    } else {
      // Insert new entry
      const { data, error } = await supabase
        .from('pnl_manual_entries')
        .insert(upsertData)
        .select()
        .single();
      resultData = data;
      resultError = error;
    }

    if (resultError) {
      throw resultError;
    }

    return resultData;
  }

  // Import expenses
  for (const categoryIdStr of Object.keys(expenseAggregated)) {
    const categoryId = parseInt(categoryIdStr, 10);
    const monthlyData = expenseAggregated[categoryIdStr];

    for (const monthStr of Object.keys(monthlyData)) {
      const month = parseInt(monthStr, 10);
      const amountEur = monthlyData[month];
      
      if (amountEur === 0 || amountEur === null || amountEur === undefined) {
        skippedCount++;
        continue;
      }

      const amountPln = convertEurToPln(amountEur, month, argv.year);
      const rates = getExchangeRates(argv.year);
      const rate = rates[month] || 4.25;

      try {
        await directUpsertEntry({
          expenseCategoryId: categoryId,
          entryType: 'expense',
          year: argv.year,
          month: month,
          amountPln: amountPln,
          currencyBreakdown: { EUR: amountEur },
          notes: `Imported from old PNL (${amountEur.toFixed(2)} EUR @ ${rate})`
        });
        importedCount++;
        console.log(`   ✅ Expense: Category ${categoryId}, Month ${month}: ${amountPln.toFixed(2)} PLN`);
      } catch (error) {
        errorCount++;
        console.error(`   ❌ Error importing expense Category ${categoryId}, Month ${month}:`, error.message);
      }
    }
  }

  // Import income
  for (const categoryIdStr of Object.keys(incomeAggregated)) {
    const categoryId = parseInt(categoryIdStr, 10);
    const monthlyData = incomeAggregated[categoryIdStr];

    for (const monthStr of Object.keys(monthlyData)) {
      const month = parseInt(monthStr, 10);
      const amountEur = monthlyData[month];
      
      if (amountEur === 0 || amountEur === null || amountEur === undefined) {
        skippedCount++;
        continue;
      }

      const amountPln = convertEurToPln(amountEur, month, argv.year);
      const rates = getExchangeRates(argv.year);
      const rate = rates[month] || 4.25;

      try {
        await directUpsertEntry({
          categoryId: categoryId,
          entryType: 'revenue',
          year: argv.year,
          month: month,
          amountPln: amountPln,
          currencyBreakdown: { EUR: amountEur },
          notes: `Imported from old PNL (${amountEur.toFixed(2)} EUR @ ${rate})`
        });
        importedCount++;
        console.log(`   ✅ Income: Category ${categoryId}, Month ${month}: ${amountPln.toFixed(2)} PLN`);
      } catch (error) {
        errorCount++;
        console.error(`   ❌ Error importing income Category ${categoryId}, Month ${month}:`, error.message);
      }
    }
  }

  console.log('\n' + '='.repeat(50));
  console.log('📊 Import Summary:');
  console.log(`   ✅ Imported: ${importedCount} entries`);
  console.log(`   ⏭️  Skipped: ${skippedCount} entries (zero amounts)`);
  console.log(`   ❌ Errors: ${errorCount} entries`);
  console.log('='.repeat(50));

  // No need to restore management types - we imported directly to database
  // Categories remain in their original state (auto/manual)
  // The pnlReportService will load manual entries for ALL categories
}

main().catch(error => {
  logger.error('❌ Fatal error:', error);
  console.error('❌ Fatal error:', error.message);
  process.exit(1);
});

