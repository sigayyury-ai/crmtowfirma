#!/usr/bin/env node

/**
 * Запуск cron задачи для создания вторых платежей
 * Реальный запуск (не dry run) - будут созданы Stripe сессии
 * 
 * Использование:
 *   node scripts/run-second-payment-cron.js
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const SecondPaymentSchedulerService = require('../src/services/stripe/secondPaymentSchedulerService');
const logger = require('../src/utils/logger');

async function runSecondPaymentCron() {
  try {
    console.log('\n🚀 ЗАПУСК CRON ЗАДАЧИ: Создание вторых платежей\n');
    console.log('='.repeat(100));
    console.log('⚠️  ВНИМАНИЕ: Это РЕАЛЬНЫЙ запуск - будут созданы Stripe сессии!\n');

    const schedulerService = new SecondPaymentSchedulerService();

    console.log('📋 Поиск сделок, которым нужен второй платеж...\n');

    const result = await schedulerService.processAllDeals();

    console.log('\n' + '='.repeat(100));
    console.log('\n📊 РЕЗУЛЬТАТЫ:\n');
    console.log(`   Всего найдено сделок: ${result.totalFound}`);
    console.log(`   ✅ Создано сессий: ${result.created}`);
    console.log(`   ⏸️  Пропущено: ${result.skipped?.length || 0}`);
    console.log(`   ❌ Ошибок: ${result.errors?.length || 0}`);

    if (result.errors && result.errors.length > 0) {
      console.log('\n❌ Ошибки:');
      result.errors.forEach((error, index) => {
        console.log(`   ${index + 1}. Deal #${error.dealId || 'N/A'}: ${error.error}`);
      });
    }

    if (result.skipped && result.skipped.length > 0) {
      console.log('\n⏸️  Пропущенные сделки:');
      result.skipped.forEach((skip, index) => {
        console.log(`   ${index + 1}. Deal #${skip.dealId || 'N/A'}: ${skip.reason || 'Unknown reason'}`);
      });
    }

    console.log('\n' + '='.repeat(100));
    console.log('\n✅ Cron задача завершена!\n');

  } catch (error) {
    console.error('\n❌ Ошибка:', error.message);
    console.error(error.stack);
    logger.error('Second payment cron failed', { error: error.message, stack: error.stack });
    process.exit(1);
  }
}

runSecondPaymentCron().catch(error => {
  console.error('Script failed:', error);
  process.exit(1);
});

