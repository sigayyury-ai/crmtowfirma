#!/usr/bin/env node

/**
 * Диагностический скрипт для проверки логики пересоздания истекших сессий
 * 
 * Проверяет:
 * 1. Какие истекшие сессии находятся в Stripe
 * 2. Какие задачи создаются в findExpiredSessionTasks
 * 3. Почему некоторые сессии не пересоздаются
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const SecondPaymentSchedulerService = require('../src/services/stripe/secondPaymentSchedulerService');
const StripeRepository = require('../src/services/stripe/repository');
const { getStripeClient } = require('../src/services/stripe/client');
const logger = require('../src/utils/logger');

async function debugExpiredSessions() {
  try {
    const schedulerService = new SecondPaymentSchedulerService();
    const repository = new StripeRepository();
    const stripe = getStripeClient();

    console.log('🔍 Диагностика пересоздания истекших сессий\n');
    console.log('='.repeat(80));

    // 1. Получаем истекшие сессии из Stripe напрямую
    console.log('\n📋 Шаг 1: Получение истекших сессий из Stripe...');
    const expiredSessionsFromStripe = await schedulerService.findExpiredUnpaidSessionsFromStripe();
    console.log(`   Найдено истекших сессий в Stripe: ${expiredSessionsFromStripe.length}`);

    if (expiredSessionsFromStripe.length > 0) {
      console.log('\n   Примеры истекших сессий:');
      expiredSessionsFromStripe.slice(0, 5).forEach(s => {
        console.log(`   - Deal #${s.dealId}, тип: ${s.paymentType}, сумма: ${s.amount} ${s.currency}`);
        console.log(`     Session ID: ${s.sessionId}`);
        console.log(`     Истекла: ${s.expiresAt ? new Date(s.expiresAt * 1000).toISOString() : 'N/A'}`);
      });
    }

    // 2. Получаем задачи из findExpiredSessionTasks
    console.log('\n📋 Шаг 2: Получение задач из findExpiredSessionTasks...');
    const expiredTasks = await schedulerService.findExpiredSessionTasks();
    console.log(`   Найдено задач для пересоздания: ${expiredTasks.length}`);

    if (expiredTasks.length > 0) {
      console.log('\n   Примеры задач:');
      expiredTasks.slice(0, 5).forEach(t => {
        console.log(`   - Deal #${t.dealId}: ${t.dealTitle}`);
        console.log(`     Тип платежа: ${t.paymentType}`);
        console.log(`     Сумма: ${t.paymentAmount} ${t.currency}`);
        console.log(`     Истекшая сессия: ${t.sessionId}`);
        console.log(`     Дней с истечения: ${t.daysExpired}`);
      });
    }

    // 3. Сравниваем результаты
    console.log('\n📊 Шаг 3: Сравнение результатов...');
    const dealIdsFromStripe = [...new Set(expiredSessionsFromStripe.map(s => s.dealId))];
    const dealIdsFromTasks = [...new Set(expiredTasks.map(t => t.dealId))];

    console.log(`   Уникальных сделок с истекшими сессиями в Stripe: ${dealIdsFromStripe.length}`);
    console.log(`   Уникальных сделок в задачах для пересоздания: ${dealIdsFromTasks.length}`);

    const missingDeals = dealIdsFromStripe.filter(id => !dealIdsFromTasks.includes(String(id)));
    const extraDeals = dealIdsFromTasks.filter(id => !dealIdsFromStripe.includes(String(id)));

    if (missingDeals.length > 0) {
      console.log(`\n   ⚠️  Сделки с истекшими сессиями, но БЕЗ задач для пересоздания: ${missingDeals.length}`);
      console.log(`   Deal IDs: ${missingDeals.join(', ')}`);

      // Проверяем каждую сделку детально
      for (const dealId of missingDeals.slice(0, 5)) {
        console.log(`\n   🔍 Анализ Deal #${dealId}:`);
        
        try {
          // Получаем платежи для этой сделки
          const payments = await repository.listPayments({ dealId: String(dealId), limit: 100 });
          console.log(`      Платежей в базе: ${payments.length}`);
          
          const activePayments = payments.filter(p => {
            if (!p.session_id) return false;
            return p.status === 'open' || p.status === 'complete' || 
                   (p.status === 'processed' && p.payment_status === 'unpaid');
          });
          console.log(`      Активных платежей в базе: ${activePayments.length}`);

          // Проверяем статус сессий в Stripe
          for (const payment of activePayments.slice(0, 3)) {
            try {
              const session = await stripe.checkout.sessions.retrieve(payment.session_id);
              console.log(`      Сессия ${payment.session_id}: статус=${session.status}, payment_status=${session.payment_status}`);
            } catch (error) {
              console.log(`      Сессия ${payment.session_id}: ошибка проверки - ${error.message}`);
            }
          }

          // Получаем истекшие сессии для этой сделки
          const dealExpired = expiredSessionsFromStripe.filter(s => String(s.dealId) === String(dealId));
          console.log(`      Истекших сессий для этой сделки: ${dealExpired.length}`);
          dealExpired.forEach(s => {
            console.log(`        - ${s.sessionId}, тип: ${s.paymentType}, истекла: ${s.expiresAt ? new Date(s.expiresAt * 1000).toISOString() : 'N/A'}`);
          });

        } catch (error) {
          console.log(`      Ошибка анализа: ${error.message}`);
        }
      }
    }

    if (extraDeals.length > 0) {
      console.log(`\n   ℹ️  Сделки в задачах, но не в Stripe: ${extraDeals.length}`);
      console.log(`   Deal IDs: ${extraDeals.join(', ')}`);
    }

    // 4. Проверяем cron расписание
    console.log('\n📋 Шаг 4: Проверка cron расписания...');
    console.log('   Cron задача для обработки истекших сессий запускается:');
    console.log('   - Ежедневно в 9:00 утра (Europe/Warsaw)');
    console.log('   - Это может быть недостаточно часто для оперативной обработки');

    // 5. Рекомендации
    console.log('\n📋 Шаг 5: Рекомендации...');
    if (missingDeals.length > 0) {
      console.log('   ⚠️  Обнаружены проблемы:');
      console.log('   1. Некоторые истекшие сессии не попадают в задачи для пересоздания');
      console.log('   2. Возможные причины:');
      console.log('      - Проверка активных сессий слишком строгая');
      console.log('      - Условия фильтрации в findExpiredSessionTasks пропускают сессии');
      console.log('      - Cron задача запускается слишком редко (раз в день)');
    } else {
      console.log('   ✅ Все истекшие сессии найдены в задачах для пересоздания');
    }

    console.log('\n' + '='.repeat(80));
    console.log('✅ Диагностика завершена\n');

  } catch (error) {
    logger.error('Ошибка диагностики', { error: error.message, stack: error.stack });
    console.error('❌ Ошибка:', error.message);
    process.exit(1);
  }
}

debugExpiredSessions();


