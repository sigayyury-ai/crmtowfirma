#!/usr/bin/env node

/**
 * Dry run для поиска истекших Stripe сессий на сегодня
 * Показывает, какие сессии будут найдены и обработаны, но не создает новые сессии
 * 
 * Использование:
 *   node scripts/dry-run-expired-sessions.js
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const SecondPaymentSchedulerService = require('../src/services/stripe/secondPaymentSchedulerService');
const logger = require('../src/utils/logger');

async function dryRunExpiredSessions() {
  try {
    console.log('\n🔍 DRY RUN: Поиск истекших Stripe сессий на сегодня\n');
    console.log('='.repeat(100));

    const schedulerService = new SecondPaymentSchedulerService();

    console.log('📋 Поиск задач для истекших сессий...\n');

    const expiredTasks = await schedulerService.findExpiredSessionTasks();

    console.log(`\n✅ Найдено задач: ${expiredTasks.length}\n`);

    if (expiredTasks.length === 0) {
      console.log('✅ Нет истекших сессий для обработки\n');
      return;
    }

    console.log('='.repeat(100));
    console.log('\n📋 ДЕТАЛЬНАЯ ИНФОРМАЦИЯ ПО ЗАДАЧАМ:\n');

    expiredTasks.forEach((task, index) => {
      console.log(`${index + 1}. Deal #${task.dealId}: ${task.dealTitle || 'N/A'}`);
      console.log(`   📧 Email: ${task.customerEmail || 'N/A'}`);
      console.log(`   💰 Сумма сделки: ${task.dealValue} ${task.currency}`);
      console.log(`   📅 Дата закрытия: ${task.expectedCloseDate || 'N/A'}`);
      console.log(`   📅 Дата второго платежа: ${task.secondPaymentDate || 'N/A'}`);
      console.log(`   📊 График: ${task.paymentSchedule || 'N/A'}`);
      console.log(`   🔗 Session ID: ${task.sessionId || 'N/A'}`);
      console.log(`   💳 Тип платежа: ${task.paymentType || 'N/A'}`);
      console.log(`   💰 Сумма платежа: ${task.paymentAmount || 'N/A'} ${task.currency}`);
      
      if (task.daysExpired !== undefined) {
        console.log(`   ⏰ Дней с истечения: ${task.daysExpired}`);
      }
      
      if (task.reason) {
        console.log(`   📝 Причина: ${task.reason}`);
      }
      
      console.log('');
    });

    console.log('='.repeat(100));
    console.log('\n📊 СВОДКА:\n');
    console.log(`   Всего задач: ${expiredTasks.length}`);
    
    const byType = {};
    expiredTasks.forEach(task => {
      const type = task.paymentType || 'unknown';
      byType[type] = (byType[type] || 0) + 1;
    });
    
    console.log(`   По типам платежей:`);
    Object.entries(byType).forEach(([type, count]) => {
      console.log(`     - ${type}: ${count}`);
    });

    console.log('\n' + '='.repeat(100));
    console.log('\n✅ Dry run завершен!\n');
    console.log('💡 Это был dry run - никакие сессии не были созданы\n');

  } catch (error) {
    console.error('\n❌ Ошибка:', error.message);
    console.error(error.stack);
    logger.error('Dry run expired sessions failed', { error: error.message, stack: error.stack });
    process.exit(1);
  }
}

dryRunExpiredSessions().catch(error => {
  console.error('Script failed:', error);
  process.exit(1);
});

