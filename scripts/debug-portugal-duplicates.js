/**
 * Отладка дубликатов Coliving / Portugal
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const PaymentRevenueReportService = require('../src/services/vatMargin/paymentRevenueReportService');
const logger = require('../src/utils/logger');

const paymentRevenueReportService = new PaymentRevenueReportService();

function normalizeProductKey(name) {
  if (!name) return 'без названия';
  return String(name)
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s.\-_/]/gu, '')
    .replace(/\s+/g, ' ')
    .trim() || 'без названия';
}

async function main() {
  logger.info('=== Отладка дубликатов Coliving / Portugal ===\n');

  try {
    const dateFrom = new Date('2026-01-01T00:00:00.000Z');
    const dateTo = new Date('2026-01-31T23:59:59.999Z');
    
    const productCatalog = await paymentRevenueReportService.loadProductCatalog();
    const payments = await paymentRevenueReportService.loadPayments({
      dateFrom,
      dateTo,
      statusScope: 'approved',
      productCatalog
    });

    // Находим платежи с Portugal
    const portugalPayments = payments.filter(p => {
      const name = (p.stripe_product_name || p.product_name || '').toLowerCase();
      return name.includes('portugal');
    });

    logger.info(`Найдено платежей с Portugal: ${portugalPayments.length}\n`);

    if (portugalPayments.length > 0) {
      logger.info('Детали платежей:');
      portugalPayments.forEach((p, i) => {
        logger.info(`  ${i + 1}. Product: "${p.stripe_product_name || p.product_name || 'N/A'}"`);
        logger.info(`     Product ID: ${p.product_id || 'NULL'}`);
        logger.info(`     Source: ${p.source || 'N/A'}`);
        logger.info(`     Stripe Product ID: ${p.stripe_product_id || 'N/A'}`);
        logger.info(`     CRM Product ID: ${p.stripe_crm_product_id || 'N/A'}`);
        logger.info(`     Stripe Event Key: ${p.stripe_event_key || 'N/A'}`);
        logger.info('');
      });

      // Симулируем группировку как в aggregateProducts
      const productMap = new Map();
      
      portugalPayments.forEach(payment => {
        let productId = payment.product_id || null;
        let productName = payment.stripe_product_name || payment.product_name || 'Мероприятие';
        let productKey = null;

        // Определяем ключ продукта
        if (productId) {
          productKey = `id:${productId}`;
        } else if (payment.stripe_product_id) {
          productKey = `stripe:${payment.stripe_product_id}`;
        } else {
          const normalized = normalizeProductKey(productName);
          productKey = `key:${normalized}`;
        }

        if (!productMap.has(productKey)) {
          productMap.set(productKey, {
            key: productKey,
            name: productName,
            product_id: productId,
            source: payment.source || 'unknown',
            normalizedName: normalizeProductKey(productName)
          });
        }
      });

      logger.info('\nГруппы продуктов ДО объединения:');
      for (const [key, group] of productMap.entries()) {
        logger.info(`  Ключ: ${key}`);
        logger.info(`    Название: "${group.name}"`);
        logger.info(`    Product ID: ${group.product_id || 'NULL'}`);
        logger.info(`    Источник: ${group.source}`);
        logger.info(`    Нормализованное название: "${group.normalizedName}"`);
        logger.info('');
      }

      // Симулируем объединение
      const normalizedNameMap = new Map();
      const mergedProductMap = new Map();
      
      for (const [key, group] of productMap.entries()) {
        const normalizedName = group.normalizedName;
        const existingKey = normalizedNameMap.get(normalizedName);
        
        if (existingKey && existingKey !== key) {
          logger.info(`⚠️  Найдено дубликат! Ключ "${key}" объединяется с "${existingKey}"`);
          logger.info(`    Название: "${group.name}" -> "${mergedProductMap.get(existingKey).name}"`);
          logger.info(`    Нормализованное: "${normalizedName}"`);
        } else {
          normalizedNameMap.set(normalizedName, key);
          mergedProductMap.set(key, group);
        }
      }

      logger.info('\nГруппы продуктов ПОСЛЕ объединения:');
      for (const [key, group] of mergedProductMap.entries()) {
        logger.info(`  Ключ: ${key}`);
        logger.info(`    Название: "${group.name}"`);
        logger.info(`    Product ID: ${group.product_id || 'NULL'}`);
        logger.info(`    Источник: ${group.source}`);
        logger.info('');
      }
    }

    // Проверяем отчет
    logger.info('\n=== Проверка отчета ===');
    const report = await paymentRevenueReportService.getReport({
      month: 1,
      year: 2026,
      status: 'approved'
    });

    const portugalProducts = report.products.filter(p => 
      p.name && p.name.toLowerCase().includes('portugal')
    );

    logger.info(`Продуктов с Portugal в отчете: ${portugalProducts.length}`);
    portugalProducts.forEach((p, i) => {
      logger.info(`  ${i + 1}. "${p.name}" (ключ: ${p.key}, ID: ${p.product_id || 'NULL'}, источник: ${p.source})`);
      logger.info(`     Нормализованное название: "${normalizeProductKey(p.name)}"`);
    });

  } catch (error) {
    logger.error(`❌ Ошибка: ${error.message}`);
    logger.error(`Stack: ${error.stack}`);
  }
}

if (require.main === module) {
  main().then(() => {
    process.exit(0);
  }).catch((error) => {
    logger.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { main };



