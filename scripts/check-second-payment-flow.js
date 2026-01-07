#!/usr/bin/env node

/**
 * Скрипт для проверки флоу вторых платежей:
 * - Создаются ли крон задачи после оплаты первого платежа
 * - Создаются ли автоматические напоминания
 * - Попадает ли сделка в критерии для создания второй сессии
 */

require('dotenv').config();
const SecondPaymentSchedulerService = require('../src/services/stripe/secondPaymentSchedulerService');
const StripeRepository = require('../src/services/stripe/repository');
const PipedriveClient = require('../src/services/pipedrive');
const logger = require('../src/utils/logger');

async function checkSecondPaymentFlow(dealId) {
  console.log(`\n=== Проверка флоу вторых платежей для сделки ${dealId} ===\n`);

  const schedulerService = new SecondPaymentSchedulerService();
  const repository = new StripeRepository();
  const pipedriveClient = new PipedriveClient();

  try {
    // 1. Получаем данные сделки
    console.log('1. Получение данных сделки...');
    const dealResult = await pipedriveClient.getDeal(dealId);
    if (!dealResult.success || !dealResult.deal) {
      console.error(`❌ Сделка ${dealId} не найдена`);
      return;
    }
    const deal = dealResult.deal;
    console.log(`✅ Сделка найдена: ${deal.title}`);
    console.log(`   Expected close date: ${deal.expected_close_date || 'не указана'}`);
    
    // Проверяем invoice_type
    const invoiceTypeFieldKey = 'ad67729ecfe0345287b71a3b00910e8ba5b3b496';
    const invoiceType = deal[invoiceTypeFieldKey];
    console.log(`   Invoice type: ${invoiceType || 'не установлен'} ${invoiceType === '75' ? '(Stripe ✅)' : '(не Stripe ❌)'}`);

    // 2. Проверяем платежи
    console.log('\n2. Проверка платежей...');
    const payments = await repository.listPayments({ dealId: String(dealId) });
    console.log(`   Найдено платежей: ${payments.length}`);

    const depositPayments = payments.filter(p => 
      (p.payment_type === 'deposit' || p.payment_type === 'first') &&
      p.payment_status === 'paid'
    );
    const restPayments = payments.filter(p => 
      (p.payment_type === 'rest' || p.payment_type === 'second' || p.payment_type === 'final')
    );

    console.log(`   Оплаченных deposit платежей: ${depositPayments.length}`);
    console.log(`   Вторых платежей (rest/second): ${restPayments.length}`);

    if (depositPayments.length === 0) {
      console.log('\n⚠️  Первый платеж не оплачен - крон задача не будет создана');
      return;
    }

    // 3. Проверяем график платежей
    console.log('\n3. Проверка графика платежей...');
    const initialSchedule = await schedulerService.getInitialPaymentSchedule(dealId);
    console.log(`   Первичный график из первого платежа: ${initialSchedule.schedule || 'не найден'}`);
    if (initialSchedule.firstPaymentDate) {
      console.log(`   Дата первого платежа: ${initialSchedule.firstPaymentDate.toISOString().split('T')[0]}`);
    }

    const currentSchedule = schedulerService.determinePaymentSchedule(deal);
    console.log(`   Текущий график (на основе expected_close_date): ${currentSchedule.schedule}`);
    console.log(`   Дата второго платежа: ${currentSchedule.secondPaymentDate ? currentSchedule.secondPaymentDate.toISOString().split('T')[0] : 'не определена'}`);
    
    // Важное примечание
    if (initialSchedule.schedule === '100%' && currentSchedule.schedule === '50/50') {
      console.log(`\n   ⚠️  ВНИМАНИЕ: Первый платеж был создан как единый (100%), но текущий график 50/50`);
      console.log(`   Система использует первичный график (100%), поэтому вторая сессия НЕ будет создана автоматически`);
    } else if (initialSchedule.schedule === '50/50' && currentSchedule.schedule === '100%') {
      console.log(`\n   ℹ️  Первый платеж был создан как 50/50, но текущий график 100%`);
      console.log(`   Система использует первичный график (50/50), поэтому вторая сессия БУДЕТ создана автоматически`);
    }

    // 4. Проверяем, попадает ли сделка в findAllUpcomingTasks
    console.log('\n4. Проверка попадания в findAllUpcomingTasks...');
    const upcomingTasks = await schedulerService.findAllUpcomingTasks();
    const dealInUpcoming = upcomingTasks.find(t => t.deal.id === dealId);
    
    if (dealInUpcoming) {
      console.log(`✅ Сделка найдена в upcoming tasks`);
      console.log(`   Дата второго платежа: ${dealInUpcoming.secondPaymentDate.toISOString().split('T')[0]}`);
      console.log(`   Дата наступила: ${dealInUpcoming.isDateReached ? 'да' : 'нет'}`);
    } else {
      console.log(`❌ Сделка НЕ найдена в upcoming tasks`);
      console.log(`   Причины могут быть:`);
      console.log(`   - invoice_type не равен "Stripe" (75)`);
      console.log(`   - Первый платеж не оплачен`);
      console.log(`   - График не 50/50`);
      console.log(`   - Вторая сессия уже создана`);
    }

    // 5. Проверяем, попадает ли сделка в findReminderTasks
    console.log('\n5. Проверка попадания в findReminderTasks (напоминания)...');
    const reminderTasks = await schedulerService.findReminderTasks();
    const dealInReminders = reminderTasks.find(t => t.dealId === dealId);
    
    if (dealInReminders) {
      console.log(`✅ Сделка найдена в reminder tasks`);
      console.log(`   Session ID: ${dealInReminders.sessionId}`);
      console.log(`   Session URL: ${dealInReminders.sessionUrl || 'нет (просрочена)'}`);
      console.log(`   Дата второго платежа: ${dealInReminders.secondPaymentDate.toISOString().split('T')[0]}`);
      console.log(`   Дней до платежа: ${dealInReminders.daysUntilSecondPayment}`);
    } else {
      console.log(`❌ Сделка НЕ найдена в reminder tasks`);
      console.log(`   Причины могут быть:`);
      console.log(`   - Вторая сессия не создана`);
      console.log(`   - Вторая сессия уже оплачена`);
      console.log(`   - Дата второго платежа еще не наступила`);
    }

    // 6. Проверяем, попадает ли сделка в findDealsNeedingSecondPayment
    console.log('\n6. Проверка попадания в findDealsNeedingSecondPayment...');
    const dealsNeedingSecond = await schedulerService.findDealsNeedingSecondPayment();
    const dealNeedsSecond = dealsNeedingSecond.find(d => d.deal.id === dealId);
    
    if (dealNeedsSecond) {
      console.log(`✅ Сделка найдена в deals needing second payment`);
      console.log(`   Дата второго платежа: ${dealNeedsSecond.secondPaymentDate.toISOString().split('T')[0]}`);
      console.log(`   ⚠️  Вторая сессия будет создана при следующем запуске cron (9:00)`);
    } else {
      console.log(`❌ Сделка НЕ найдена в deals needing second payment`);
      console.log(`   Причины могут быть:`);
      console.log(`   - Первый платеж не оплачен`);
      console.log(`   - График не 50/50`);
      console.log(`   - Дата второго платежа еще не наступила`);
      console.log(`   - Вторая сессия уже создана`);
    }

    // 7. Итоговая сводка
    console.log('\n=== ИТОГОВАЯ СВОДКА ===');
    console.log(`Сделка ${dealId}:`);
    console.log(`  - В upcoming tasks: ${dealInUpcoming ? '✅' : '❌'}`);
    console.log(`  - В reminder tasks: ${dealInReminders ? '✅' : '❌'}`);
    console.log(`  - Нужна вторая сессия: ${dealNeedsSecond ? '✅' : '❌'}`);
    
    if (dealNeedsSecond) {
      console.log(`\n⚠️  ВНИМАНИЕ: Вторая сессия будет создана автоматически при следующем запуске cron (9:00 ежедневно)`);
    }
    
    if (dealInReminders) {
      console.log(`\n⚠️  ВНИМАНИЕ: Напоминание будет отправлено автоматически при следующем запуске cron (9:00 ежедневно)`);
    }

  } catch (error) {
    console.error(`❌ Ошибка при проверке: ${error.message}`);
    logger.error('Error checking second payment flow', { dealId, error: error.message });
  }
}

// Запуск скрипта
const dealId = process.argv[2];
if (!dealId) {
  console.error('Использование: node scripts/check-second-payment-flow.js <dealId>');
  process.exit(1);
}

checkSecondPaymentFlow(dealId).catch(error => {
  console.error('Script failed:', error);
  process.exit(1);
});

