require('dotenv').config();

const StripeRepository = require('../src/services/stripe/repository');
const SecondPaymentSchedulerService = require('../src/services/stripe/secondPaymentSchedulerService');
const StripeProcessorService = require('../src/services/stripe/processor');
const PipedriveClient = require('../src/services/pipedrive');
const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');

/**
 * Отладка напоминаний Stripe для сделки 1680
 * Проверяет, что возвращает findReminderTasks и почему может быть дублирование
 */

async function debugStripeReminders1680() {
  const dealId = 1680;

  console.log('='.repeat(80));
  console.log(`🔍 ОТЛАДКА STRIPE REMINDERS ДЛЯ СДЕЛКИ ${dealId}`);
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

    // 1. Проверяем, что есть в базе для этой сделки
    console.log('\n📊 1. ПЛАТЕЖИ В БАЗЕ ДАННЫХ');
    console.log('-'.repeat(80));
    
    const allPayments = await repository.listPayments({});
    const dealPayments = allPayments.filter(p => String(p.deal_id) === String(dealId));
    
    console.log(`Всего платежей в базе: ${allPayments.length}`);
    console.log(`Платежей для сделки ${dealId}: ${dealPayments.length}`);
    
    if (dealPayments.length > 0) {
      dealPayments.forEach((p, i) => {
        console.log(`\n  Платеж ${i + 1}:`);
        console.log(`    ID: ${p.id}`);
        console.log(`    Session ID: ${p.session_id}`);
        console.log(`    Тип: ${p.payment_type}`);
        console.log(`    Статус: ${p.payment_status}`);
        console.log(`    Сумма: ${p.amount} ${p.currency}`);
        console.log(`    Создан: ${p.created_at}`);
      });
    }

    // Фильтруем неоплаченные вторые платежи
    const unpaidSecondPayments = allPayments.filter(p => 
      (p.payment_type === 'rest' || p.payment_type === 'second' || p.payment_type === 'final') &&
      p.payment_status !== 'paid' &&
      p.deal_id
    );

    const dealUnpaidSecond = unpaidSecondPayments.filter(p => String(p.deal_id) === String(dealId));
    
    console.log(`\nНеоплаченных вторых платежей для сделки ${dealId}: ${dealUnpaidSecond.length}`);
    if (dealUnpaidSecond.length > 1) {
      console.log(`\n⚠️  ВНИМАНИЕ: Найдено ${dealUnpaidSecond.length} неоплаченных вторых платежей для одной сделки!`);
      dealUnpaidSecond.forEach((p, i) => {
        console.log(`    ${i + 1}. Session ID: ${p.session_id}, Тип: ${p.payment_type}, Статус: ${p.payment_status}`);
      });
    }

    // 2. Проверяем просроченные сессии в Stripe
    console.log('\n📊 2. ПРОСРОЧЕННЫЕ СЕССИИ В STRIPE');
    console.log('-'.repeat(80));
    
    const expiredSessionsFromStripe = await scheduler.findExpiredUnpaidSessionsFromStripe();
    const dealExpiredSessions = expiredSessionsFromStripe.filter(s => String(s.dealId) === String(dealId));
    
    console.log(`Всего просроченных сессий в Stripe: ${expiredSessionsFromStripe.length}`);
    console.log(`Просроченных сессий для сделки ${dealId}: ${dealExpiredSessions.length}`);
    
    const depositSessions = dealExpiredSessions.filter(s => s.paymentType === 'deposit');
    const restSessions = dealExpiredSessions.filter(s => s.paymentType === 'rest' || s.paymentType === 'second' || s.paymentType === 'final');
    
    console.log(`  - Типа deposit (первый платеж): ${depositSessions.length}`);
    console.log(`  - Типа rest/second/final (второй платеж): ${restSessions.length}`);
    
    if (dealExpiredSessions.length > 0) {
      console.log(`\nВсе сессии для сделки ${dealId}:`);
      dealExpiredSessions.forEach((s, i) => {
        console.log(`\n  Сессия ${i + 1}:`);
        console.log(`    Session ID: ${s.sessionId}`);
        console.log(`    Тип: ${s.paymentType}`);
        console.log(`    График: ${s.paymentSchedule}`);
        console.log(`    Сумма: ${s.amount} ${s.currency}`);
        console.log(`    Просрочена: ${s.expiresAt ? new Date(s.expiresAt * 1000).toISOString() : 'N/A'}`);
      });
    }

    // 2.1 Проверяем ВСЕ сессии для сделки 1680 в Stripe (не только просроченные)
    console.log('\n📊 2.1 ВСЕ СЕССИИ ДЛЯ СДЕЛКИ 1680 В STRIPE (прямой запрос)');
    console.log('-'.repeat(80));
    
    try {
      // Получаем все сессии для этой сделки напрямую из Stripe
      const allStripeSessions = await stripeProcessor.stripe.checkout.sessions.list({
        limit: 100
      });
      
      const dealSessions = allStripeSessions.data.filter(s => 
        s.metadata?.deal_id === String(dealId) || 
        s.metadata?.dealId === String(dealId)
      );
      
      console.log(`Всего сессий для сделки ${dealId} в Stripe: ${dealSessions.length}`);
      
      if (dealSessions.length > 0) {
        const byType = {};
        dealSessions.forEach(s => {
          const type = s.metadata?.payment_type || 'unknown';
          if (!byType[type]) byType[type] = [];
          byType[type].push(s);
        });
        
        Object.entries(byType).forEach(([type, sessions]) => {
          console.log(`\n  Тип ${type}: ${sessions.length} сессий`);
          sessions.slice(0, 3).forEach((s, i) => {
            const expired = s.expires_at && s.expires_at < Math.floor(Date.now() / 1000);
            const paid = s.payment_status === 'paid';
            console.log(`    ${i + 1}. ${s.id} | Статус: ${s.status} | Оплата: ${s.payment_status} | Просрочена: ${expired ? 'ДА' : 'НЕТ'}`);
          });
          if (sessions.length > 3) {
            console.log(`    ... и еще ${sessions.length - 3} сессий`);
          }
        });
        
        // Ищем сессии типа rest/second/final
        const secondPaymentSessions = dealSessions.filter(s => {
          const type = s.metadata?.payment_type || '';
          return type === 'rest' || type === 'second' || type === 'final';
        });
        
        console.log(`\n⚠️  Сессий второго платежа (rest/second/final): ${secondPaymentSessions.length}`);
        if (secondPaymentSessions.length > 0) {
          secondPaymentSessions.forEach((s, i) => {
            const expired = s.expires_at && s.expires_at < Math.floor(Date.now() / 1000);
            const paid = s.payment_status === 'paid';
            console.log(`\n  Сессия второго платежа ${i + 1}:`);
            console.log(`    ID: ${s.id}`);
            console.log(`    Тип: ${s.metadata?.payment_type}`);
            console.log(`    Статус: ${s.status}`);
            console.log(`    Оплата: ${s.payment_status}`);
            console.log(`    Просрочена: ${expired ? 'ДА' : 'НЕТ'}`);
            console.log(`    Создана: ${new Date(s.created * 1000).toISOString()}`);
            if (s.expires_at) {
              console.log(`    Истекает: ${new Date(s.expires_at * 1000).toISOString()}`);
            }
          });
        }
      }
    } catch (error) {
      console.log(`❌ Ошибка при получении сессий из Stripe: ${error.message}`);
    }

    // 3. Проверяем, что возвращает findReminderTasks
    console.log('\n📊 3. ЗАДАЧИ ДЛЯ НАПОМИНАНИЙ (findReminderTasks)');
    console.log('-'.repeat(80));
    
    const reminderTasks = await scheduler.findReminderTasks();
    const dealReminderTasks = reminderTasks.filter(t => String(t.dealId) === String(dealId));
    
    console.log(`Всего задач для напоминаний: ${reminderTasks.length}`);
    console.log(`Задач для сделки ${dealId}: ${dealReminderTasks.length}`);
    
    if (dealReminderTasks.length > 1) {
      console.log(`\n⚠️  ВНИМАНИЕ: Найдено ${dealReminderTasks.length} задач для одной сделки!`);
      dealReminderTasks.forEach((t, i) => {
        console.log(`\n  Задача ${i + 1}:`);
        console.log(`    Deal ID: ${t.dealId}`);
        console.log(`    Session ID: ${t.sessionId}`);
        console.log(`    Session URL: ${t.sessionUrl || 'N/A'}`);
        console.log(`    Дата платежа: ${t.secondPaymentDate}`);
        console.log(`    Дата наступила: ${t.isDateReached}`);
        console.log(`    Сумма: ${t.secondPaymentAmount} ${t.currency}`);
      });
    } else if (dealReminderTasks.length === 1) {
      console.log(`\n✅ Найдена 1 задача для сделки ${dealId}:`);
      const task = dealReminderTasks[0];
      console.log(`    Session ID: ${task.sessionId}`);
      console.log(`    Session URL: ${task.sessionUrl || 'N/A'}`);
      console.log(`    Дата платежа: ${task.secondPaymentDate}`);
      console.log(`    Дата наступила: ${task.isDateReached}`);
    } else {
      console.log(`\n⚠️  Задач для сделки ${dealId} не найдено`);
    }

    // 4. Проверяем, сколько раз вызывается findExpiredUnpaidSessionsFromStripe
    console.log('\n📊 4. АНАЛИЗ ЛОГИКИ findReminderTasks');
    console.log('-'.repeat(80));
    
    const dealIdsFromDb = [...new Set(unpaidSecondPayments.map(p => p.deal_id))];
    const dealIdsFromStripe = [...new Set(expiredSessionsFromStripe.map(s => s.dealId))];
    const allDealIds = [...new Set([...dealIdsFromDb, ...dealIdsFromStripe])];
    
    console.log(`Deal IDs из базы: ${dealIdsFromDb.length} (${dealIdsFromDb.includes(String(dealId)) ? 'включает 1680' : 'не включает 1680'})`);
    console.log(`Deal IDs из Stripe: ${dealIdsFromStripe.length} (${dealIdsFromStripe.includes(String(dealId)) ? 'включает 1680' : 'не включает 1680'})`);
    console.log(`Всего уникальных Deal IDs: ${allDealIds.length}`);
    
    if (allDealIds.includes(String(dealId))) {
      console.log(`\n✅ Сделка ${dealId} есть в списке для обработки`);
      
      // Проверяем, сколько неоплаченных платежей для этой сделки
      const paymentsForDeal = await repository.listPayments({ dealId: String(dealId) });
      const restPayments = paymentsForDeal.filter(p => 
        (p.payment_type === 'rest' || p.payment_type === 'second' || p.payment_type === 'final') &&
        p.payment_status !== 'paid'
      );
      
      console.log(`\nНеоплаченных вторых платежей в базе для сделки ${dealId}: ${restPayments.length}`);
      if (restPayments.length > 1) {
        console.log(`\n⚠️  ПРОБЛЕМА: В базе ${restPayments.length} неоплаченных вторых платежей!`);
        console.log(`    Но findReminderTasks использует только первый (find), не все!`);
        restPayments.forEach((p, i) => {
          console.log(`    ${i + 1}. Session ID: ${p.session_id}, Тип: ${p.payment_type}`);
        });
      }
    } else {
      console.log(`\n⚠️  Сделка ${dealId} НЕ в списке для обработки`);
    }

    // 5. Проверяем, может ли cron запускаться дважды
    console.log('\n📊 5. ПРОВЕРКА CRON');
    console.log('-'.repeat(80));
    console.log('Cron выражение: 0 9 * * * (ежедневно в 9:00)');
    console.log('Проверьте логи приложения на наличие нескольких запусков в один день');

  } catch (error) {
    console.error('❌ Ошибка при отладке:', error);
    logger.error('Error debugging Stripe reminders', { error: error.message, stack: error.stack });
  }
}

debugStripeReminders1680()
  .then(() => {
    console.log('\n✅ Отладка завершена');
    process.exit(0);
  })
  .catch(error => {
    console.error('❌ Критическая ошибка:', error);
    process.exit(1);
  });
