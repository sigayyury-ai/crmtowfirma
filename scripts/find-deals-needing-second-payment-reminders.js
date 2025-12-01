#!/usr/bin/env node

/**
 * Найти все сделки, для которых нужно создать напоминания о вторых платежах
 * Это сделки с графиком 50/50, где первый платеж оплачен, а второй еще не создан
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const StripeRepository = require('../src/services/stripe/repository');
const PipedriveClient = require('../src/services/pipedrive');
const SecondPaymentSchedulerService = require('../src/services/stripe/secondPaymentSchedulerService');
const logger = require('../src/utils/logger');

async function findDealsNeedingReminders() {
  try {
    const repository = new StripeRepository();
    const pipedriveClient = new PipedriveClient();
    const schedulerService = new SecondPaymentSchedulerService();

    console.log('🔍 Поиск сделок, требующих напоминания о вторых платежах...\n');

    // Используем метод из сервиса для поиска всех будущих задач
    const upcomingTasks = await schedulerService.findAllUpcomingTasks();

    console.log(`📋 Найдено сделок с графиком 50/50: ${upcomingTasks.length}\n`);

    if (upcomingTasks.length === 0) {
      console.log('✅ Нет сделок, требующих напоминания о вторых платежах');
      return;
    }

    // Группируем по статусу
    const overdue = [];
    const soon = [];
    const upcoming = [];

    for (const { deal, secondPaymentDate, isDateReached } of upcomingTasks) {
      const daysUntil = Math.ceil((secondPaymentDate - new Date()) / (1000 * 60 * 60 * 24));
      
      // Получаем полные данные сделки
      const dealWithRelated = await pipedriveClient.getDealWithRelatedData(deal.id);
      const person = dealWithRelated?.person;
      const customerEmail = person?.email?.[0]?.value || person?.email || 'N/A';

      const dealValue = parseFloat(deal.value) || 0;
      const currency = deal.currency || 'PLN';
      const secondPaymentAmount = dealValue / 2;

      const taskInfo = {
        dealId: deal.id,
        dealTitle: deal.title,
        customerEmail,
        expectedCloseDate: deal.expected_close_date || deal.close_date,
        secondPaymentDate: secondPaymentDate.toISOString().split('T')[0],
        secondPaymentAmount,
        currency,
        daysUntilSecondPayment: daysUntil,
        isDateReached
      };

      if (daysUntil < 0) {
        overdue.push(taskInfo);
      } else if (daysUntil <= 3) {
        soon.push(taskInfo);
      } else {
        upcoming.push(taskInfo);
      }
    }

    // Выводим результаты
    console.log('='.repeat(100));
    console.log('📊 РЕЗУЛЬТАТЫ ПОИСКА');
    console.log('='.repeat(100) + '\n');

    console.log(`🔴 ПРОСРОЧЕНО (дата уже прошла): ${overdue.length}`);
    if (overdue.length > 0) {
      overdue.forEach((task, index) => {
        console.log(`\n${index + 1}. Deal #${task.dealId}: ${task.dealTitle}`);
        console.log(`   📧 Клиент: ${task.customerEmail}`);
        console.log(`   💰 Сумма второго платежа: ${task.secondPaymentAmount.toFixed(2)} ${task.currency}`);
        console.log(`   📅 Дата второго платежа: ${task.secondPaymentDate} (просрочено на ${Math.abs(task.daysUntilSecondPayment)} дн.)`);
        console.log(`   📅 Начало лагеря: ${task.expectedCloseDate || 'N/A'}`);
        console.log(`   🔗 Сделка: https://comoon.pipedrive.com/deal/${task.dealId}`);
      });
    }

    console.log(`\n🟠 СКОРО (≤3 дня): ${soon.length}`);
    if (soon.length > 0) {
      soon.forEach((task, index) => {
        console.log(`\n${index + 1}. Deal #${task.dealId}: ${task.dealTitle}`);
        console.log(`   📧 Клиент: ${task.customerEmail}`);
        console.log(`   💰 Сумма второго платежа: ${task.secondPaymentAmount.toFixed(2)} ${task.currency}`);
        console.log(`   📅 Дата второго платежа: ${task.secondPaymentDate} (через ${task.daysUntilSecondPayment} дн.)`);
        console.log(`   📅 Начало лагеря: ${task.expectedCloseDate || 'N/A'}`);
        console.log(`   🔗 Сделка: https://comoon.pipedrive.com/deal/${task.dealId}`);
      });
    }

    console.log(`\n🔵 БУДУЩИЕ (>3 дня): ${upcoming.length}`);
    if (upcoming.length > 0) {
      upcoming.forEach((task, index) => {
        console.log(`\n${index + 1}. Deal #${task.dealId}: ${task.dealTitle}`);
        console.log(`   📧 Клиент: ${task.customerEmail}`);
        console.log(`   💰 Сумма второго платежа: ${task.secondPaymentAmount.toFixed(2)} ${task.currency}`);
        console.log(`   📅 Дата второго платежа: ${task.secondPaymentDate} (через ${task.daysUntilSecondPayment} дн.)`);
        console.log(`   📅 Начало лагеря: ${task.expectedCloseDate || 'N/A'}`);
        console.log(`   🔗 Сделка: https://comoon.pipedrive.com/deal/${task.dealId}`);
      });
    }

    console.log('\n' + '='.repeat(100));
    console.log('📝 ИТОГОВАЯ СВОДКА');
    console.log('='.repeat(100));
    console.log(`Всего сделок, требующих напоминания: ${upcomingTasks.length}`);
    console.log(`  🔴 Просрочено: ${overdue.length}`);
    console.log(`  🟠 Скоро (≤3 дня): ${soon.length}`);
    console.log(`  🔵 Будущие (>3 дня): ${upcoming.length}`);

    console.log('\n💡 РЕКОМЕНДАЦИИ:');
    if (overdue.length > 0) {
      console.log(`\n⚠️  СРОЧНО: ${overdue.length} сделок с просроченной датой второго платежа!`);
      console.log('   Нужно немедленно создать сессии для этих сделок.');
    }
    if (soon.length > 0) {
      console.log(`\n📅 В ближайшие дни: ${soon.length} сделок требуют внимания`);
      console.log('   Рекомендуется создать сессии заранее.');
    }
    if (upcoming.length > 0) {
      console.log(`\n✅ Запланировано: ${upcoming.length} сделок в будущем`);
      console.log('   Эти сделки будут обработаны автоматически через cron.');
    }

  } catch (error) {
    logger.error('Ошибка при поиске сделок:', error);
    console.error('❌ Критическая ошибка:', error.message);
    process.exit(1);
  }
}

findDealsNeedingReminders();
