/**
 * Отладка: откуда берется название "Czarna Stodoła"
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const PaymentRevenueReportService = require('../src/services/vatMargin/paymentRevenueReportService');
const logger = require('../src/utils/logger');

const paymentRevenueReportService = new PaymentRevenueReportService();

async function main() {
  logger.info('=== Отладка названия продукта ===\n');

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

    // Находим stripe_event платежи с product_id = 2
    const stripeEventPayments = payments.filter(p => 
      p.source === 'stripe_event' && p.product_id === 2
    );

    logger.info(`Найдено Stripe Event платежей с product_id = 2: ${stripeEventPayments.length}\n`);

    if (stripeEventPayments.length > 0) {
      const firstPayment = stripeEventPayments[0];
      logger.info('Первый платеж:');
      logger.info(`  stripe_event_key: "${firstPayment.stripe_event_key || 'N/A'}"`);
      logger.info(`  stripe_product_name: "${firstPayment.stripe_product_name || 'N/A'}"`);
      logger.info(`  stripe_crm_product_id: ${firstPayment.stripe_crm_product_id || 'N/A'}`);
      logger.info(`  product_id: ${firstPayment.product_id || 'N/A'}`);
      logger.info(`  source: ${firstPayment.source || 'N/A'}`);
      logger.info('');

      // Проверяем, что будет использоваться при определении productName
      const catalogEntry = productCatalog.byId.get(String(firstPayment.product_id));
      if (catalogEntry) {
        logger.info(`Catalog entry для product_id ${firstPayment.product_id}:`);
        logger.info(`  Name: "${catalogEntry.name}"`);
        logger.info(`  NormalizedName: "${catalogEntry.normalizedName || 'N/A'}"`);
      }
    }

    // Теперь проверяем отчет
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
      
      if (product2.entries && product2.entries.length > 0) {
        logger.info(`\n  Первая запись:`);
        const firstEntry = product2.entries[0];
        if (firstEntry.payments && firstEntry.payments.length > 0) {
          const firstPayment = firstEntry.payments[0];
          logger.info(`    stripe_event_key: "${firstPayment.stripe_event_key || 'N/A'}"`);
          logger.info(`    stripe_product_name: "${firstPayment.stripe_product_name || 'N/A'}"`);
        }
      }
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



