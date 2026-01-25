/**
 * Проверка исправленных сделок в отчете за январь 2026
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const PaymentRevenueReportService = require('../src/services/vatMargin/paymentRevenueReportService');
const logger = require('../src/utils/logger');

const paymentRevenueReportService = new PaymentRevenueReportService();

const DEALS_TO_CHECK = [
  { dealId: '1849', expectedProduct: 'SKI France' },
  { dealId: '1714', expectedProduct: 'Single Spain' },
  { dealId: '1775', expectedProduct: 'Coliving / Bali' }
];

async function main() {
  logger.info('=== Проверка исправленных сделок в отчете за январь 2026 ===\n');

  try {
    const report = await paymentRevenueReportService.getReport({
      month: 1,
      year: 2026,
      status: 'approved'
    });

    if (!report || !report.products) {
      logger.error('Отчет не получен или не содержит продуктов');
      return;
    }

    logger.info(`Найдено продуктов в отчете: ${report.products.length}\n`);

    // Ищем платежи для каждой сделки
    for (const { dealId, expectedProduct } of DEALS_TO_CHECK) {
      logger.info(`Проверка Deal #${dealId} (ожидаемый продукт: "${expectedProduct}")...`);

      let found = false;
      for (const productGroup of report.products) {
        // Проверяем entries в каждом продукте
        if (productGroup.entries && Array.isArray(productGroup.entries)) {
          for (const entry of productGroup.entries) {
            const proforma = entry.proforma;
            const dealIdFromProforma = proforma?.pipedrive_deal_id;
            
            if (dealIdFromProforma === dealId) {
              found = true;
              const actualProductName = productGroup.name || 'Без названия';
              const amountPln = entry.totals?.pln_total || 0;
              const payerNames = entry.payer_names || [];
              
              logger.info(`   ✅ Найден в продукте: "${actualProductName}"`);
              logger.info(`      Сумма: ${amountPln} PLN`);
              logger.info(`      Плательщики: ${payerNames.join(', ') || 'N/A'}`);
              
              if (actualProductName !== expectedProduct) {
                logger.warn(`      ⚠️  Несоответствие! Ожидался "${expectedProduct}", получен "${actualProductName}"`);
              } else {
                logger.info(`      ✅ Название продукта совпадает`);
              }
              
              if (amountPln === 0) {
                logger.warn(`      ⚠️  Сумма равна 0 PLN!`);
              }
              
              break;
            }
          }
        }
      }

      if (!found) {
        logger.warn(`   ⚠️  Deal #${dealId} не найден в отчете`);
      }
      
      logger.info('');
    }

    // Показываем все продукты с их названиями
    logger.info('Все продукты в отчете:');
    report.products.forEach((product, i) => {
      const productName = product.name || 'Без названия';
      const plnTotal = product.totals?.pln_total || 0;
      const paymentsCount = product.totals?.payments_count || 0;
      logger.info(`   ${i + 1}. "${productName}": ${plnTotal} PLN, ${paymentsCount} платежей`);
    });

    logger.info('\n✅ Проверка завершена');

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



