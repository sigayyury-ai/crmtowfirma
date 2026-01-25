#!/usr/bin/env node

/**
 * Расширенная проверка базы данных на наличие тестовых данных
 * 
 * Проверяет все таблицы на наличие тестовых записей:
 * - products
 * - stripe_payments
 * - payments
 * - proformas
 * - proforma_products
 * - payment_product_links
 * - stripe_event_items
 * - cash_payments
 * - и другие связанные таблицы
 * 
 * Использование:
 *   node scripts/verify-test-data-cleanup.js
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');

// Расширенные паттерны для поиска тестовых данных
const TEST_PATTERNS = [
  'test',
  'тест',
  'TEST_AUTO_',
  'demo',
  'демо',
  'sample',
  'пример',
  'проверка',
  'trial',
  'temporary',
  'example.com',
  'test_',
  'cs_test_'
];

function isTestData(value) {
  if (!value) return false;
  const lowerValue = String(value).toLowerCase();
  return TEST_PATTERNS.some(pattern => lowerValue.includes(pattern.toLowerCase()));
}

async function checkTable(tableName, fields, description) {
  try {
    logger.info(`Проверка таблицы: ${tableName}...`);
    
    const { data, error } = await supabase
      .from(tableName)
      .select(fields.join(', '))
      .limit(10000); // Ограничение для больших таблиц

    if (error) {
      logger.warn(`Ошибка при проверке ${tableName}: ${error.message}`);
      return { table: tableName, count: 0, items: [], error: error.message };
    }

    const testItems = [];
    
    if (data && data.length > 0) {
      for (const item of data) {
        let isTest = false;
        const matchedFields = [];
        
        for (const field of fields) {
          const value = item[field];
          if (isTestData(value)) {
            isTest = true;
            matchedFields.push({ field, value });
          }
        }
        
        if (isTest) {
          testItems.push({
            id: item.id || item.session_id || 'N/A',
            matchedFields,
            ...item
          });
        }
      }
    }

    return {
      table: tableName,
      description,
      total: data?.length || 0,
      testCount: testItems.length,
      items: testItems.slice(0, 20) // Показываем первые 20
    };
  } catch (error) {
    logger.error(`Ошибка при проверке ${tableName}:`, error);
    return { table: tableName, count: 0, items: [], error: error.message };
  }
}

async function checkProducts() {
  return await checkTable(
    'products',
    ['name', 'normalized_name'],
    'Продукты'
  );
}

async function checkStripePayments() {
  return await checkTable(
    'stripe_payments',
    ['session_id', 'customer_name', 'customer_email', 'company_name', 'deal_id'],
    'Stripe платежи'
  );
}

async function checkPayments() {
  return await checkTable(
    'payments',
    ['payer_name', 'description', 'proforma_fullnumber'],
    'Банковские платежи'
  );
}

async function checkProformas() {
  return await checkTable(
    'proformas',
    ['fullnumber', 'buyer_name', 'buyer_email'],
    'Проформы'
  );
}

async function checkProformaProducts() {
  try {
    const { data, error } = await supabase
      .from('proforma_products')
      .select('id, proforma_id, product_id, name')
      .limit(10000);

    if (error) {
      return { table: 'proforma_products', total: 0, testCount: 0, items: [], error: error.message };
    }

    // Проверяем по имени продукта
    const testItems = [];
    for (const item of data || []) {
      if (isTestData(item.name)) {
        testItems.push(item);
      }
    }

    return {
      table: 'proforma_products',
      description: 'Связи проформ с продуктами',
      total: data?.length || 0,
      testCount: testItems.length,
      items: testItems.slice(0, 20)
    };
  } catch (error) {
    return { table: 'proforma_products', total: 0, testCount: 0, items: [], error: error.message };
  }
}

async function checkPaymentProductLinks() {
  return await checkTable(
    'payment_product_links',
    ['linked_by'],
    'Связи платежей с продуктами'
  );
}

async function checkStripeEventItems() {
  return await checkTable(
    'stripe_event_items',
    ['session_id', 'customer_email', 'customer_name', 'event_key', 'event_label'],
    'Stripe event items'
  );
}

async function checkCashPayments() {
  return await checkTable(
    'cash_payments',
    ['note', 'created_by', 'confirmed_by'],
    'Наличные платежи'
  );
}

async function checkStripeEventSummary() {
  return await checkTable(
    'stripe_event_summary',
    ['event_key', 'event_label'],
    'Stripe event summary'
  );
}

async function checkStripeEventParticipants() {
  return await checkTable(
    'stripe_event_participants',
    ['email', 'display_name'],
    'Stripe event participants'
  );
}

async function checkDealsInStripePayments() {
  try {
    // Проверяем deal_id в stripe_payments на наличие тестовых сделок
    const { data, error } = await supabase
      .from('stripe_payments')
      .select('deal_id, session_id, customer_email')
      .not('deal_id', 'is', null)
      .limit(10000);

    if (error) {
      return { table: 'stripe_payments.deal_id', total: 0, testCount: 0, items: [], error: error.message };
    }

    // Проверяем на тестовые deal_id (обычно это числа, но можем проверить паттерны)
    const testDealIds = new Set();
    const testItems = [];

    for (const item of data || []) {
      const dealId = String(item.deal_id);
      // Проверяем на известные тестовые deal_id или паттерны
      if (isTestData(item.customer_email) || isTestData(item.session_id)) {
        testDealIds.add(dealId);
        testItems.push({
          deal_id: dealId,
          session_id: item.session_id,
          customer_email: item.customer_email
        });
      }
    }

    return {
      table: 'stripe_payments.deal_id',
      description: 'Deal ID в Stripe платежах (проверка на тестовые)',
      total: data?.length || 0,
      testCount: testItems.length,
      items: testItems.slice(0, 20)
    };
  } catch (error) {
    return { table: 'stripe_payments.deal_id', total: 0, testCount: 0, items: [], error: error.message };
  }
}

function printResults(results) {
  console.log('\n' + '='.repeat(80));
  console.log('🔍 РАСШИРЕННАЯ ПРОВЕРКА БАЗЫ ДАННЫХ НА ТЕСТОВЫЕ ДАННЫЕ');
  console.log('='.repeat(80));

  let totalTestItems = 0;
  let tablesWithTests = 0;

  for (const result of results) {
    if (result.error) {
      console.log(`\n⚠️  ${result.description || result.table}:`);
      console.log(`   Ошибка: ${result.error}`);
      continue;
    }

    const hasTests = result.testCount > 0;
    const icon = hasTests ? '❌' : '✅';
    
    console.log(`\n${icon} ${result.description || result.table}:`);
    console.log(`   Всего записей: ${result.total}`);
    console.log(`   Тестовых записей: ${result.testCount}`);

    if (hasTests) {
      tablesWithTests++;
      totalTestItems += result.testCount;
      
      console.log(`   Примеры тестовых записей:`);
      result.items.slice(0, 5).forEach((item, index) => {
        console.log(`     ${index + 1}. ID: ${item.id || 'N/A'}`);
        if (item.matchedFields) {
          item.matchedFields.forEach(mf => {
            console.log(`        ${mf.field}: "${String(mf.value).substring(0, 50)}"`);
          });
        } else {
          // Показываем ключевые поля
          const keyFields = ['session_id', 'customer_email', 'name', 'deal_id', 'fullnumber'];
          keyFields.forEach(field => {
            if (item[field]) {
              console.log(`        ${field}: ${String(item[field]).substring(0, 50)}`);
            }
          });
        }
      });
      if (result.testCount > 5) {
        console.log(`     ... и еще ${result.testCount - 5} записей`);
      }
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('📊 ИТОГОВАЯ СТАТИСТИКА');
  console.log('='.repeat(80));
  console.log(`Таблиц с тестовыми данными: ${tablesWithTests}`);
  console.log(`Всего тестовых записей найдено: ${totalTestItems}`);
  
  if (totalTestItems === 0) {
    console.log('\n✅ Отлично! Тестовых данных не найдено. База данных чистая.');
  } else {
    console.log('\n⚠️  Обнаружены тестовые данные в базе!');
    console.log('   Рекомендуется удалить их с помощью скрипта delete-test-products-and-payments.js');
  }
  console.log('='.repeat(80) + '\n');
}

async function main() {
  try {
    if (!supabase) {
      logger.error('❌ Supabase client is not initialized.');
      process.exit(1);
    }

    console.log('\n🔍 Начинаем расширенную проверку базы данных...\n');

    // Проверяем все таблицы параллельно
    const results = await Promise.all([
      checkProducts(),
      checkStripePayments(),
      checkPayments(),
      checkProformas(),
      checkProformaProducts(),
      checkPaymentProductLinks(),
      checkStripeEventItems(),
      checkCashPayments(),
      checkStripeEventSummary(),
      checkStripeEventParticipants(),
      checkDealsInStripePayments()
    ]);

    // Выводим результаты
    printResults(results);

  } catch (error) {
    logger.error('❌ Критическая ошибка при проверке базы данных', {
      error: error.message,
      stack: error.stack
    });
    console.error('❌ Критическая ошибка:', error.message);
    process.exit(1);
  }
}

main();






