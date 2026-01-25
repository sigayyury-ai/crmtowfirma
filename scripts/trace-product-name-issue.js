/**
 * Трассировка проблемы с названием продукта
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const PaymentRevenueReportService = require('../src/services/vatMargin/paymentRevenueReportService');
const logger = require('../src/utils/logger');

// Модифицируем функцию aggregateProducts для отладки
const originalAggregateProducts = PaymentRevenueReportService.prototype.aggregateProducts;

PaymentRevenueReportService.prototype.aggregateProducts = function(...args) {
  const result = originalAggregateProducts.apply(this, args);
  
  // Проверяем продукт ID 2
  const product2 = result.products.find(p => p.product_id === 2);
  if (product2) {
    logger.info(`\n🔍 DEBUG: Product ID 2 in result:`);
    logger.info(`  Name: "${product2.name}"`);
    logger.info(`  Key: ${product2.key}`);
  }
  
  return result;
};

const paymentRevenueReportService = new PaymentRevenueReportService();

async function main() {
  logger.info('=== Трассировка проблемы с названием продукта ===\n');

  try {
    const report = await paymentRevenueReportService.getReport({
      month: 1,
      year: 2026,
      status: 'approved'
    });

    const product2 = report.products.find(p => p.product_id === 2);
    if (product2) {
      logger.info(`\n✅ Финальный результат:`);
      logger.info(`  Name: "${product2.name}"`);
      logger.info(`  Key: ${product2.key}`);
      logger.info(`  Product ID: ${product2.product_id}`);
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



