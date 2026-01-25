#!/usr/bin/env node

/**
 * Скрипт для поиска тестовых продуктов и Stripe платежей в базе данных
 * 
 * Ищет:
 * - Продукты с названиями, содержащими "test", "тест", "TEST_AUTO_", "demo", "sample" и т.д.
 * - Stripe платежи с тестовыми сессиями (cs_test_*)
 * 
 * Использование:
 *   node scripts/find-test-products-and-payments.js
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');

// Паттерны для поиска тестовых данных
const TEST_PATTERNS = {
  products: [
    'test',
    'тест',
    'TEST_AUTO_',
    'demo',
    'демо',
    'sample',
    'пример',
    'проверка',
    'trial',
    'temporary'
  ],
  stripeSessions: /^cs_test_/
};

async function findTestProducts() {
  logger.info('🔍 Поиск тестовых продуктов...');
  
  try {
    // Получаем все продукты
    const { data: products, error } = await supabase
      .from('products')
      .select('id, name, normalized_name, calculation_status, created_at')
      .order('id');

    if (error) {
      logger.error('Ошибка при получении продуктов:', error);
      return [];
    }

    // Фильтруем тестовые продукты
    const testProducts = products.filter(product => {
      const name = (product.name || '').toLowerCase();
      const normalizedName = (product.normalized_name || '').toLowerCase();
      
      return TEST_PATTERNS.products.some(pattern => 
        name.includes(pattern.toLowerCase()) || 
        normalizedName.includes(pattern.toLowerCase())
      );
    });

    logger.info(`Найдено тестовых продуктов: ${testProducts.length}`);
    return testProducts;
  } catch (error) {
    logger.error('Ошибка при поиске тестовых продуктов:', error);
    return [];
  }
}

async function findTestStripePayments() {
  logger.info('🔍 Поиск тестовых Stripe платежей...');
  
  try {
    // Получаем все Stripe платежи (используем * чтобы получить все поля)
    const { data: payments, error } = await supabase
      .from('stripe_payments')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      logger.error('Ошибка при получении Stripe платежей:', error);
      return [];
    }

    // Фильтруем тестовые платежи
    const testPayments = payments.filter(payment => {
      // Проверяем session_id на тестовые сессии (cs_test_*)
      if (payment.session_id && TEST_PATTERNS.stripeSessions.test(payment.session_id)) {
        return true;
      }
      
      // Также проверяем другие поля на наличие тестовых данных
      const customerName = (payment.customer_name || '').toLowerCase();
      const customerEmail = (payment.customer_email || '').toLowerCase();
      const companyName = (payment.company_name || '').toLowerCase();
      
      return TEST_PATTERNS.products.some(pattern => 
        customerName.includes(pattern.toLowerCase()) || 
        customerEmail.includes(pattern.toLowerCase()) ||
        companyName.includes(pattern.toLowerCase())
      );
    });

    logger.info(`Найдено тестовых Stripe платежей: ${testPayments.length}`);
    return testPayments;
  } catch (error) {
    logger.error('Ошибка при поиске тестовых Stripe платежей:', error);
    return [];
  }
}

async function findRelatedData(testProducts, testPayments) {
  logger.info('🔍 Поиск связанных данных...');
  
  const relatedData = {
    productLinks: [],
    paymentProductLinks: [],
    proformaProducts: []
  };

  try {
    // Находим связи продуктов с платежами через product_links (если есть такая таблица)
    if (testProducts.length > 0) {
      const productIds = testProducts.map(p => p.id);
      
      // Проверяем связи через payment_product_links
      const { data: paymentLinks, error: linksError } = await supabase
        .from('payment_product_links')
        .select('id, payment_id, product_id, linked_at')
        .in('product_id', productIds);

      if (!linksError && paymentLinks) {
        relatedData.paymentProductLinks = paymentLinks;
      }

      // Проверяем связи через proforma_products
      const { data: proformaProducts, error: proformaError } = await supabase
        .from('proforma_products')
        .select('id, proforma_id, product_id')
        .in('product_id', productIds);

      if (!proformaError && proformaProducts) {
        relatedData.proformaProducts = proformaProducts;
      }
    }

    // Находим связи Stripe платежей с продуктами
    if (testPayments.length > 0) {
      const paymentIds = testPayments.map(p => p.id);
      
      const { data: stripePaymentLinks, error: stripeLinksError } = await supabase
        .from('payment_product_links')
        .select('id, payment_id, product_id, linked_at')
        .in('payment_id', paymentIds);

      if (!stripeLinksError && stripePaymentLinks) {
        relatedData.paymentProductLinks.push(...stripePaymentLinks);
      }
    }

    return relatedData;
  } catch (error) {
    logger.error('Ошибка при поиске связанных данных:', error);
    return relatedData;
  }
}

function printResults(testProducts, testPayments, relatedData) {
  console.log('\n' + '='.repeat(80));
  console.log('📊 РЕЗУЛЬТАТЫ ПОИСКА ТЕСТОВЫХ ДАННЫХ');
  console.log('='.repeat(80));

  // Тестовые продукты
  console.log('\n📦 ТЕСТОВЫЕ ПРОДУКТЫ:');
  console.log('-'.repeat(80));
  if (testProducts.length === 0) {
    console.log('✅ Тестовых продуктов не найдено');
  } else {
    console.log(`Найдено: ${testProducts.length} продуктов\n`);
    testProducts.forEach((product, index) => {
      console.log(`${index + 1}. ID: ${product.id}`);
      console.log(`   Название: "${product.name || 'Нет названия'}"`);
      console.log(`   Нормализованное: "${product.normalized_name || 'Нет'}"`);
      console.log(`   Статус: ${product.calculation_status || 'N/A'}`);
      console.log(`   Создан: ${product.created_at || 'N/A'}`);
      console.log('');
    });
  }

  // Тестовые Stripe платежи
  console.log('\n💳 ТЕСТОВЫЕ STRIPE ПЛАТЕЖИ:');
  console.log('-'.repeat(80));
  if (testPayments.length === 0) {
    console.log('✅ Тестовых Stripe платежей не найдено');
  } else {
    console.log(`Найдено: ${testPayments.length} платежей\n`);
    testPayments.forEach((payment, index) => {
      console.log(`${index + 1}. ID: ${payment.id}`);
      console.log(`   Session ID: ${payment.session_id || 'N/A'}`);
      console.log(`   Deal ID: ${payment.deal_id || 'N/A'}`);
      console.log(`   Product ID: ${payment.product_id || 'N/A'}`);
      const amount = payment.original_amount || payment.amount || 0;
      const amountPln = payment.amount_pln || 0;
      console.log(`   Сумма: ${amount} ${payment.currency || 'N/A'}`);
      if (amountPln && amountPln !== amount) {
        console.log(`   Сумма в PLN: ${amountPln} PLN`);
      }
      const paymentStatus = payment.payment_status || payment.stripe_payment_status || 'N/A';
      const status = payment.status || 'N/A';
      console.log(`   Статус: ${paymentStatus} (${status})`);
      const customer = payment.customer_name || payment.company_name || payment.customer_email || 'N/A';
      console.log(`   Клиент: ${customer}`);
      console.log(`   Создан: ${payment.created_at || 'N/A'}`);
      console.log('');
    });
  }

  // Связанные данные
  console.log('\n🔗 СВЯЗАННЫЕ ДАННЫЕ:');
  console.log('-'.repeat(80));
  console.log(`Связи платежей с продуктами: ${relatedData.paymentProductLinks.length}`);
  console.log(`Связи продуктов с проформами: ${relatedData.proformaProducts.length}`);

  if (relatedData.paymentProductLinks.length > 0) {
    console.log('\nСвязи payment_product_links:');
    relatedData.paymentProductLinks.slice(0, 10).forEach(link => {
      console.log(`  Payment ID: ${link.payment_id}, Product ID: ${link.product_id}, Linked: ${link.linked_at}`);
    });
    if (relatedData.paymentProductLinks.length > 10) {
      console.log(`  ... и еще ${relatedData.paymentProductLinks.length - 10} связей`);
    }
  }

  if (relatedData.proformaProducts.length > 0) {
    console.log('\nСвязи proforma_products:');
    relatedData.proformaProducts.slice(0, 10).forEach(link => {
      console.log(`  Proforma ID: ${link.proforma_id}, Product ID: ${link.product_id}`);
    });
    if (relatedData.proformaProducts.length > 10) {
      console.log(`  ... и еще ${relatedData.proformaProducts.length - 10} связей`);
    }
  }

  // Итоговая статистика
  console.log('\n' + '='.repeat(80));
  console.log('📈 ИТОГОВАЯ СТАТИСТИКА:');
  console.log('='.repeat(80));
  console.log(`Тестовых продуктов: ${testProducts.length}`);
  console.log(`Тестовых Stripe платежей: ${testPayments.length}`);
  console.log(`Всего тестовых записей: ${testProducts.length + testPayments.length}`);
  console.log('='.repeat(80) + '\n');
}

async function main() {
  try {
    if (!supabase) {
      logger.error('❌ Supabase client is not initialized.');
      process.exit(1);
    }

    console.log('\n🔍 Поиск тестовых продуктов и Stripe платежей в базе данных...\n');

    // Ищем тестовые данные
    const [testProducts, testPayments] = await Promise.all([
      findTestProducts(),
      findTestStripePayments()
    ]);

    // Ищем связанные данные
    const relatedData = await findRelatedData(testProducts, testPayments);

    // Выводим результаты
    printResults(testProducts, testPayments, relatedData);

    // Сохраняем результаты в файл (опционально)
    if (process.argv.includes('--save')) {
      const fs = require('fs');
      const path = require('path');
      const outputPath = path.join(__dirname, '../tmp/test-data-results.json');
      
      const results = {
        timestamp: new Date().toISOString(),
        products: testProducts,
        payments: testPayments,
        relatedData: relatedData
      };

      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
      console.log(`\n💾 Результаты сохранены в: ${outputPath}\n`);
    }

  } catch (error) {
    logger.error('❌ Ошибка при поиске тестовых данных', {
      error: error.message,
      stack: error.stack
    });
    console.error('❌ Ошибка:', error.message);
    process.exit(1);
  }
}

main();

