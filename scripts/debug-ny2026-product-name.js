/**
 * Отладка: откуда берется название "Czarna Stodoła" для продукта ID 2
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const PaymentRevenueReportService = require('../src/services/vatMargin/paymentRevenueReportService');
const logger = require('../src/utils/logger');

const paymentRevenueReportService = new PaymentRevenueReportService();

async function main() {
  logger.info('=== Отладка названия продукта для NY2026 ===\n');

  try {
    // Загружаем платежи напрямую
    const dateFrom = new Date('2026-01-01T00:00:00.000Z');
    const dateTo = new Date('2026-01-31T23:59:59.999Z');
    
    const productCatalog = await paymentRevenueReportService.loadProductCatalog();
    const payments = await paymentRevenueReportService.loadPayments({
      dateFrom,
      dateTo,
      statusScope: 'approved',
      productCatalog
    });

    // Находим stripe_event платежи с event_key NY2026
    const ny2026Payments = payments.filter(p => 
      p.source === 'stripe_event' && 
      (p.stripe_event_key === 'NY2026' || p.stripe_product_name?.includes('NY2026'))
    );

    logger.info(`Найдено Stripe Event платежей с NY2026: ${ny2026Payments.length}\n`);

    if (ny2026Payments.length > 0) {
      const firstPayment = ny2026Payments[0];
      logger.info('Первый платеж NY2026:');
      logger.info(`  stripe_event_key: ${firstPayment.stripe_event_key || 'N/A'}`);
      logger.info(`  stripe_product_name: ${firstPayment.stripe_product_name || 'N/A'}`);
      logger.info(`  stripe_crm_product_id: ${firstPayment.stripe_crm_product_id || 'N/A'}`);
      logger.info(`  product_id: ${firstPayment.product_id || 'N/A'}`);
      logger.info(`  source: ${firstPayment.source || 'N/A'}`);
      logger.info('');

      // Проверяем каталог продуктов
      logger.info('Проверка каталога продуктов:');
      const catalogEntryById = productCatalog.byId.get('2');
      if (catalogEntryById) {
        logger.info(`  Product ID 2 в каталоге: "${catalogEntryById.name}"`);
      } else {
        logger.info('  Product ID 2 не найден в каталоге byId');
      }

      const catalogEntryByName = productCatalog.byNormalizedName.get('ny2026');
      if (catalogEntryByName) {
        logger.info(`  "ny2026" в каталоге: "${catalogEntryByName.name}" (ID: ${catalogEntryByName.id})`);
      } else {
        logger.info('  "ny2026" не найден в каталоге byNormalizedName');
      }
    }

    // Теперь проверяем, что возвращает getReport
    logger.info('\n=== Проверка отчета ===');
    const report = await paymentRevenueReportService.getReport({
      month: 1,
      year: 2026,
      status: 'approved'
    });

    const product2 = report.products.find(p => p.product_id === 2);
    if (product2) {
      logger.info(`Продукт ID 2 в отчете:`);
      logger.info(`  Name: "${product2.name}"`);
      logger.info(`  Key: ${product2.key}`);
      logger.info(`  Product ID: ${product2.product_id}`);
      logger.info(`  Source: ${product2.source}`);
      logger.info(`  Entries: ${product2.entries?.length || 0}`);
      
      if (product2.entries && product2.entries.length > 0) {
        logger.info('\n  Первая запись:');
        const firstEntry = product2.entries[0];
        logger.info(`    stripe_product_name: ${firstEntry.payments?.[0]?.stripe_product_name || 'N/A'}`);
        logger.info(`    stripe_event_key: ${firstEntry.payments?.[0]?.stripe_event_key || 'N/A'}`);
      }
    } else {
      logger.warn('Продукт ID 2 не найден в отчете');
    }

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



