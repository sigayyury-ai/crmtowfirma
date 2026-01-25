/**
 * Проверка Stripe платежей в отчете за январь 2026
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const PaymentRevenueReportService = require('../src/services/vatMargin/paymentRevenueReportService');
const logger = require('../src/utils/logger');

const paymentRevenueReportService = new PaymentRevenueReportService();

const DEALS_TO_CHECK = [
  { dealId: '1849', expectedProduct: 'SKI France', expectedPayer: 'Gor Artashevich Davlyatshin' },
  { dealId: '1714', expectedProduct: 'Single Spain', expectedPayer: 'Olga Nechasna' },
  { dealId: '1775', expectedProduct: 'Coliving / Bali', expectedPayer: 'Aliaksandr Turchyniak' }
];

async function main() {
  logger.info('=== Проверка Stripe платежей в отчете за январь 2026 ===\n');

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
    for (const { dealId, expectedProduct, expectedPayer } of DEALS_TO_CHECK) {
      logger.info(`Проверка Deal #${dealId} (ожидаемый продукт: "${expectedProduct}")...`);

      let found = false;
      for (const productGroup of report.products) {
        const productName = productGroup.name || 'Без названия';
        
        // Проверяем entries в каждом продукте
        if (productGroup.entries && Array.isArray(productGroup.entries)) {
          for (const entry of productGroup.entries) {
            // Проверяем stripe_deal_id в aggregate
            const stripeDealId = entry.stripe_deal_id || null;
            const payerNames = entry.payer_names || [];
            const amountPln = entry.totals?.pln_total || 0;
            
            if (stripeDealId === dealId || String(stripeDealId) === String(dealId)) {
              found = true;
              
              logger.info(`   ✅ Найден в продукте: "${productName}"`);
              logger.info(`      Сумма: ${amountPln} PLN`);
              logger.info(`      Плательщики: ${payerNames.join(', ') || 'N/A'}`);
              logger.info(`      Stripe Deal ID: ${stripeDealId}`);
              
              if (productName !== expectedProduct) {
                logger.warn(`      ⚠️  Несоответствие! Ожидался "${expectedProduct}", получен "${productName}"`);
              } else {
                logger.info(`      ✅ Название продукта совпадает`);
              }
              
              if (amountPln === 0) {
                logger.warn(`      ⚠️  Сумма равна 0 PLN!`);
              }
              
              // Проверяем, есть ли ожидаемый плательщик
              const payerFound = payerNames.some(name => 
                name && name.toLowerCase().includes(expectedPayer.toLowerCase())
              );
              
              if (!payerFound && expectedPayer) {
                logger.warn(`      ⚠️  Ожидаемый плательщик "${expectedPayer}" не найден в списке`);
              } else if (payerFound) {
                logger.info(`      ✅ Плательщик "${expectedPayer}" найден`);
              }
              
              break;
            }
          }
        }
      }

      if (!found) {
        logger.warn(`   ⚠️  Deal #${dealId} не найден в отчете`);
        
        // Показываем все продукты с их deal_id для отладки
        logger.info(`   Доступные продукты и их deal_id:`);
        for (const productGroup of report.products) {
          if (productGroup.entries && Array.isArray(productGroup.entries)) {
            for (const entry of productGroup.entries) {
              const stripeDealId = entry.stripe_deal_id || null;
              if (stripeDealId) {
                logger.info(`      "${productGroup.name}": Deal #${stripeDealId}`);
              }
            }
          }
        }
      }
      
      logger.info('');
    }

    // Показываем все продукты с их названиями и количеством платежей
    logger.info('Все продукты в отчете:');
    report.products.forEach((product, i) => {
      const productName = product.name || 'Без названия';
      const plnTotal = product.totals?.pln_total || 0;
      const paymentsCount = product.totals?.payments_count || 0;
      const entriesCount = product.entries?.length || 0;
      logger.info(`   ${i + 1}. "${productName}": ${plnTotal} PLN, ${paymentsCount} платежей, ${entriesCount} записей`);
      
      // Показываем deal_id для каждой записи
      if (product.entries && Array.isArray(product.entries)) {
        product.entries.forEach((entry, j) => {
          const stripeDealId = entry.stripe_deal_id || null;
          const payerNames = entry.payer_names || [];
          if (stripeDealId) {
            logger.info(`      ${j + 1}. Deal #${stripeDealId}, Плательщики: ${payerNames.join(', ') || 'N/A'}`);
          }
        });
      }
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



