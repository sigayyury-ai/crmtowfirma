require('dotenv').config();

const StripeRepository = require('../src/services/stripe/repository');
const SecondPaymentSchedulerService = require('../src/services/stripe/secondPaymentSchedulerService');
const StripeProcessorService = require('../src/services/stripe/processor');
const PipedriveClient = require('../src/services/pipedrive');
const logger = require('../src/utils/logger');

/**
 * Поиск дубликатов в findReminderTasks
 * Проверяет, может ли метод вернуть несколько задач для одной сделки
 */

async function findDuplicateReminders() {
  const dealId = 1680;

  console.log('='.repeat(80));
  console.log(`🔍 ПОИСК ДУБЛИКАТОВ В findReminderTasks`);
  console.log('='.repeat(80));

  try {
    const repository = new StripeRepository();
    const pipedriveClient = new PipedriveClient();
    const stripeProcessor = new StripeProcessorService({ mode: 'live' });
    const scheduler = new SecondPaymentSchedulerService({
      repository,
      pipedriveClient,
      stripeProcessor
    });

    // Симулируем логику findReminderTasks
    console.log('\n📊 СИМУЛЯЦИЯ ЛОГИКИ findReminderTasks');
    console.log('-'.repeat(80));

    // 1. Получаем все неоплаченные вторые платежи из базы
    const allPayments = await repository.listPayments({});
    const unpaidSecondPayments = allPayments.filter(p => 
      (p.payment_type === 'rest' || p.payment_type === 'second' || p.payment_type === 'final') &&
      p.payment_status !== 'paid' &&
      p.deal_id
    );

    console.log(`Неоплаченных вторых платежей в базе: ${unpaidSecondPayments.length}`);
    const dealPayments = unpaidSecondPayments.filter(p => String(p.deal_id) === String(dealId));
    console.log(`Для сделки ${dealId}: ${dealPayments.length}`);
    if (dealPayments.length > 1) {
      console.log(`⚠️  ПРОБЛЕМА: В базе ${dealPayments.length} неоплаченных вторых платежей для одной сделки!`);
    }

    // 2. Получаем просроченные сессии из Stripe (ПЕРВЫЙ ВЫЗОВ)
    console.log('\nПервый вызов findExpiredUnpaidSessionsFromStripe()...');
    const expiredSessionsFromStripe1 = await scheduler.findExpiredUnpaidSessionsFromStripe();
    const dealExpired1 = expiredSessionsFromStripe1.filter(s => String(s.dealId) === String(dealId));
    console.log(`Просроченных сессий для сделки ${dealId}: ${dealExpired1.length}`);
    dealExpired1.forEach((s, i) => {
      console.log(`  ${i + 1}. ${s.sessionId} | Тип: ${s.paymentType}`);
    });

    // 3. Объединяем deal_ids
    const dealIdsFromDb = [...new Set(unpaidSecondPayments.map(p => p.deal_id))];
    const dealIdsFromStripe = [...new Set(expiredSessionsFromStripe1.map(s => s.dealId))];
    const allDealIds = [...new Set([...dealIdsFromDb, ...dealIdsFromStripe])];

    console.log(`\nDeal IDs для обработки: ${allDealIds.length}`);
    if (allDealIds.includes(String(dealId))) {
      console.log(`✅ Сделка ${dealId} будет обработана`);
    }

    // 4. Симулируем цикл для сделки 1680
    if (allDealIds.includes(String(dealId))) {
      console.log(`\n📊 СИМУЛЯЦИЯ ОБРАБОТКИ СДЕЛКИ ${dealId}`);
      console.log('-'.repeat(80));

      // Получаем платежи для сделки
      const payments = await repository.listPayments({ dealId: String(dealId) });
      let restPayment = payments.find(p => 
        (p.payment_type === 'rest' || p.payment_type === 'second' || p.payment_type === 'final') &&
        p.payment_status !== 'paid'
      );

      console.log(`Найдено в базе: ${restPayment ? 'ДА' : 'НЕТ'}`);
      if (restPayment) {
        console.log(`  Session ID: ${restPayment.session_id}`);
      }

      // ВТОРОЙ ВЫЗОВ findExpiredUnpaidSessionsFromStripe (внутри цикла!)
      if (!restPayment) {
        console.log('\n⚠️  ВНИМАНИЕ: Второй вызов findExpiredUnpaidSessionsFromStripe() внутри цикла!');
        const expiredSessionsFromStripe2 = await scheduler.findExpiredUnpaidSessionsFromStripe();
        const dealExpired2 = expiredSessionsFromStripe2.filter(s => String(s.dealId) === String(dealId));
        console.log(`Просроченных сессий для сделки ${dealId} (второй вызов): ${dealExpired2.length}`);
        
        if (dealExpired2.length > 0) {
          const expiredSession = dealExpired2.find(s => String(s.dealId) === String(dealId));
          if (expiredSession) {
            console.log(`  Найдена сессия: ${expiredSession.sessionId} | Тип: ${expiredSession.paymentType}`);
            restPayment = {
              session_id: expiredSession.sessionId,
              payment_type: expiredSession.paymentType
            };
          }
        }
      }

      // Проверяем, сколько задач будет создано
      if (restPayment) {
        console.log(`\n✅ Будет создана 1 задача для сессии: ${restPayment.session_id}`);
      } else {
        console.log(`\n⚠️  Задача НЕ будет создана (сессия не найдена)`);
      }
    }

    // 5. Проверяем реальный результат findReminderTasks
    console.log('\n📊 РЕАЛЬНЫЙ РЕЗУЛЬТАТ findReminderTasks');
    console.log('-'.repeat(80));
    
    const reminderTasks = await scheduler.findReminderTasks();
    const dealTasks = reminderTasks.filter(t => String(t.dealId) === String(dealId));
    
    console.log(`Всего задач: ${reminderTasks.length}`);
    console.log(`Задач для сделки ${dealId}: ${dealTasks.length}`);
    
    if (dealTasks.length > 1) {
      console.log(`\n⚠️  НАЙДЕНО ДУБЛИКАТОВ: ${dealTasks.length} задач для одной сделки!`);
      dealTasks.forEach((t, i) => {
        console.log(`\n  Задача ${i + 1}:`);
        console.log(`    Session ID: ${t.sessionId}`);
        console.log(`    Session URL: ${t.sessionUrl || 'N/A'}`);
      });
    } else if (dealTasks.length === 1) {
      console.log(`\n✅ Найдена 1 задача (дубликатов нет)`);
      console.log(`    Session ID: ${dealTasks[0].sessionId}`);
    } else {
      console.log(`\n⚠️  Задач не найдено`);
    }

    // 6. Проверяем, может ли быть проблема с несколькими сессиями в базе
    console.log('\n📊 ПРОВЕРКА: МОЖЕТ ЛИ БЫТЬ НЕСКОЛЬКО СЕССИЙ В БАЗЕ');
    console.log('-'.repeat(80));
    
    const paymentsForDeal = await repository.listPayments({ dealId: String(dealId) });
    const allRestPayments = paymentsForDeal.filter(p => 
      (p.payment_type === 'rest' || p.payment_type === 'second' || p.payment_type === 'final') &&
      p.payment_status !== 'paid'
    );
    
    console.log(`Неоплаченных вторых платежей в базе для сделки ${dealId}: ${allRestPayments.length}`);
    
    if (allRestPayments.length > 1) {
      console.log(`\n⚠️  ПРОБЛЕМА: В базе ${allRestPayments.length} неоплаченных вторых платежей!`);
      console.log(`    Но findReminderTasks использует только первый (find), не все!`);
      console.log(`    Это НЕ должно создавать дубликаты, но может быть проблемой.`);
      allRestPayments.forEach((p, i) => {
        console.log(`    ${i + 1}. Session ID: ${p.session_id}, Тип: ${p.payment_type}`);
      });
    }

  } catch (error) {
    console.error('❌ Ошибка:', error);
    logger.error('Error finding duplicate reminders', { error: error.message, stack: error.stack });
  }
}

findDuplicateReminders()
  .then(() => {
    console.log('\n✅ Анализ завершен');
    process.exit(0);
  })
  .catch(error => {
    console.error('❌ Критическая ошибка:', error);
    process.exit(1);
  });
