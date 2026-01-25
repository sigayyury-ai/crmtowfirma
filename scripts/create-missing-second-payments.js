#!/usr/bin/env node

/**
 * Скрипт для создания отсутствующих вторых платежей
 * Использует обновленную логику планировщика, которая учитывает первичный график
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const SecondPaymentSchedulerService = require('../src/services/stripe/secondPaymentSchedulerService');
const logger = require('../src/utils/logger');

async function createMissingSecondPayments() {
  try {
    console.log('🚀 Запуск создания отсутствующих вторых платежей...\n');

    const scheduler = new SecondPaymentSchedulerService();

    // Используем обновленный метод, который учитывает первичный график
    const deals = await scheduler.findDealsNeedingSecondPayment();

    console.log(`📊 Найдено ${deals.length} сделок, требующих создания второго платежа\n`);

    if (deals.length === 0) {
      console.log('✅ Все вторые платежи уже созданы или не требуются');
      return;
    }

    const results = {
      created: [],
      errors: []
    };

    for (const { deal, secondPaymentDate } of deals) {
      try {
        console.log(`\n📝 Обработка Deal #${deal.id}: ${deal.title}`);
        console.log(`   Клиент: ${deal.person?.name || 'N/A'}`);
        console.log(`   Дата второго платежа: ${secondPaymentDate.toISOString().split('T')[0]}`);

        const result = await scheduler.createSecondPaymentSession(deal, secondPaymentDate);

        if (result.success) {
          console.log(`   ✅ Второй платеж создан успешно!`);
          console.log(`   Session ID: ${result.sessionId}`);
          console.log(`   Session URL: ${result.sessionUrl}`);
          results.created.push({
            dealId: deal.id,
            dealTitle: deal.title,
            sessionId: result.sessionId,
            sessionUrl: result.sessionUrl
          });
        } else {
          console.log(`   ❌ Ошибка: ${result.error || 'Unknown error'}`);
          results.errors.push({
            dealId: deal.id,
            dealTitle: deal.title,
            error: result.error || 'Unknown error'
          });
        }
      } catch (error) {
        console.log(`   ❌ Критическая ошибка: ${error.message}`);
        results.errors.push({
          dealId: deal.id,
          dealTitle: deal.title,
          error: error.message
        });
      }
    }

    console.log(`\n\n📊 Итоги:`);
    console.log(`   ✅ Создано: ${results.created.length}`);
    console.log(`   ❌ Ошибок: ${results.errors.length}`);

    if (results.created.length > 0) {
      console.log(`\n✅ Успешно созданные платежи:`);
      results.created.forEach((item, index) => {
        console.log(`   ${index + 1}. Deal #${item.dealId}: ${item.dealTitle}`);
        console.log(`      Session: ${item.sessionId}`);
      });
    }

    if (results.errors.length > 0) {
      console.log(`\n❌ Ошибки:`);
      results.errors.forEach((item, index) => {
        console.log(`   ${index + 1}. Deal #${item.dealId}: ${item.dealTitle}`);
        console.log(`      Ошибка: ${item.error}`);
      });
    }

    return results;

  } catch (error) {
    logger.error('Ошибка при создании отсутствующих вторых платежей:', error);
    console.error('❌ Критическая ошибка:', error.message);
    process.exit(1);
  }
}

createMissingSecondPayments().catch((error) => {
  console.error('Script failed:', error);
  process.exit(1);
});





