#!/usr/bin/env node

/**
 * Детальная диагностика фильтров для истекших сессий
 * Проверяет, почему не создаются новые сессии для проблемных сделок
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const SecondPaymentSchedulerService = require('../src/services/stripe/secondPaymentSchedulerService');
const StripeRepository = require('../src/services/stripe/repository');
const PipedriveClient = require('../src/services/pipedrive');
const { getStripeClient } = require('../src/services/stripe/client');
const logger = require('../src/utils/logger');

const DEAL_IDS = [1968, 1735, 1769, 1732];

async function debugDeal(dealId, schedulerService, repository, pipedriveClient, stripe) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`🔍 ДИАГНОСТИКА Deal #${dealId}`);
  console.log('='.repeat(80));

  try {
    // 1. Получаем данные сделки
    const dealResult = await pipedriveClient.getDealWithRelatedData(dealId);
    if (!dealResult.success || !dealResult.deal) {
      console.log(`❌ Не удалось получить данные сделки`);
      return;
    }

    const deal = dealResult.deal;
    console.log(`\n📋 Сделка: ${deal.title || 'N/A'}`);
    console.log(`   Статус: ${deal.status || 'N/A'}`);
    console.log(`   Стадия: ${deal.stage?.name || 'N/A'} (ID: ${deal.stage_id || 'N/A'})`);
    console.log(`   Сумма: ${deal.value || 0} ${deal.currency || 'PLN'}`);
    console.log(`   Пайплайн: ${deal.pipeline?.name || 'N/A'} (ID: ${deal.pipeline_id || 'N/A'})`);

    // 2. Проверяем истекшие сессии из Stripe
    console.log(`\n🔍 Шаг 1: Поиск истекших сессий в Stripe`);
    const expiredSessions = await schedulerService.findExpiredUnpaidSessionsFromStripe();
    const dealExpiredSessions = expiredSessions.filter(s => String(s.dealId) === String(dealId));
    console.log(`   Найдено истекших сессий для этой сделки: ${dealExpiredSessions.length}`);
    
    if (dealExpiredSessions.length > 0) {
      dealExpiredSessions.forEach(s => {
        console.log(`   - ${s.sessionId}`);
        console.log(`     Тип: ${s.paymentType}, Сумма: ${s.amount} ${s.currency}`);
        console.log(`     Истекла: ${s.expiresAt ? new Date(s.expiresAt * 1000).toISOString() : 'N/A'}`);
      });
    } else {
      console.log(`   ⚠️  Истекших сессий не найдено в Stripe для этой сделки`);
      return;
    }

    // 3. Проверяем платежи в базе
    console.log(`\n🔍 Шаг 2: Проверка платежей в базе данных`);
    const payments = await repository.listPayments({ dealId: String(dealId), limit: 100 });
    console.log(`   Всего платежей в базе: ${payments.length}`);
    
    if (payments.length > 0) {
      payments.forEach(p => {
        const isPaid = p.payment_status === 'paid' || p.status === 'processed';
        console.log(`   - ${p.session_id || p.id}`);
        console.log(`     Статус в БД: ${p.status || 'N/A'}, payment_status: ${p.payment_status || 'N/A'}`);
        console.log(`     Тип: ${p.payment_type || 'N/A'}, Оплачено: ${isPaid ? '✅' : '❌'}`);
        console.log(`     Сумма: ${p.amount_pln || p.amount || 0} PLN`);
      });
    }

    // 4. Проверяем активные сессии (фильтр из findExpiredSessionTasks)
    console.log(`\n🔍 Шаг 3: Проверка фильтра активных сессий`);
    const activePayments = payments.filter(p => {
      if (!p.session_id) return false;
      if (p.status === 'open' || p.status === 'complete') {
        return true;
      }
      if (p.status === 'processed' && p.payment_status === 'unpaid') {
        return true;
      }
      return false;
    });
    console.log(`   Активных платежей по фильтру: ${activePayments.length}`);

    if (activePayments.length > 0) {
      console.log(`   ⚠️  Есть активные платежи - проверяем их статус в Stripe:`);
      let hasRealActiveSession = false;
      
      for (const activePayment of activePayments) {
        try {
          const sessionId = activePayment.session_id;
          const isTestSession = sessionId.startsWith('cs_test_');
          
          if (isTestSession) {
            console.log(`     - ${sessionId}: пропущена (test сессия)`);
            continue;
          }
          
          const stripeSession = await stripe.checkout.sessions.retrieve(sessionId);
          console.log(`     - ${sessionId}: статус в Stripe: ${stripeSession.status}, payment_status: ${stripeSession.payment_status}`);
          
          if (stripeSession.status === 'open' || stripeSession.payment_status === 'paid') {
            hasRealActiveSession = true;
            console.log(`       ✅ Это реальная активная сессия`);
            
            // Проверяем, что истекшие сессии старше активной
            const activeCreated = stripeSession.created ? new Date(stripeSession.created * 1000) : new Date(0);
            const allExpiredOlder = dealExpiredSessions.every(s => {
              if (!s.expiresAt) return false;
              const expiredDate = new Date(s.expiresAt * 1000);
              return expiredDate < activeCreated;
            });
            
            console.log(`       Активная создана: ${activeCreated.toISOString()}`);
            console.log(`       Все истекшие старше активной: ${allExpiredOlder ? '✅' : '❌'}`);
            
            if (allExpiredOlder && dealExpiredSessions.length > 0) {
              console.log(`       ⚠️  ВСЕ ИСТЕКШИЕ СЕССИИ СТАРШЕ АКТИВНОЙ - СДЕЛКА БУДЕТ ПРОПУЩЕНА`);
              return;
            }
          }
        } catch (error) {
          console.log(`     - ${activePayment.session_id}: ошибка проверки - ${error.message}`);
        }
      }
      
      if (hasRealActiveSession) {
        console.log(`   ⚠️  Найдена реальная активная сессия - сделка будет пропущена`);
        return;
      }
    }

    // 5. Проверяем график платежей
    console.log(`\n🔍 Шаг 4: Проверка графика платежей`);
    const { schedule, secondPaymentDate } = schedulerService.determinePaymentSchedule(deal);
    console.log(`   График: ${schedule}`);
    if (secondPaymentDate) {
      console.log(`   Дата второго платежа: ${secondPaymentDate.toISOString()}`);
      const isDateReached = schedulerService.isDateReached(secondPaymentDate);
      console.log(`   Дата наступила: ${isDateReached ? '✅' : '❌'}`);
    }

    // 6. Проверяем оплату первого платежа
    console.log(`\n🔍 Шаг 5: Проверка оплаты первого платежа`);
    const firstPaid = await schedulerService.isFirstPaymentPaid(dealId);
    console.log(`   Первый платеж оплачен: ${firstPaid ? '✅' : '❌'}`);
    
    // Проверяем оплаченные платежи детально
    const paidPayments = payments.filter(p => 
      p.payment_status === 'paid' || p.status === 'processed'
    );
    console.log(`   Оплаченных платежей: ${paidPayments.length}`);
    paidPayments.forEach(p => {
      console.log(`     - ${p.session_id || p.id}: ${p.payment_type || 'N/A'}, ${p.amount_pln || p.amount || 0} PLN`);
    });

    // 7. Проверяем второй платеж (для rest сессий)
    console.log(`\n🔍 Шаг 6: Проверка второго платежа (для rest сессий)`);
    const paidSecondPayment = payments.find(p => 
      (p.payment_type === 'rest' || p.payment_type === 'second' || p.payment_type === 'final') &&
      (p.payment_status === 'paid' || p.status === 'processed')
    );
    
    if (paidSecondPayment) {
      console.log(`   ⚠️  Второй платеж УЖЕ ОПЛАЧЕН - rest сессии не будут пересозданы`);
      console.log(`     Оплаченный платеж: ${paidSecondPayment.session_id || paidSecondPayment.id}`);
    } else {
      console.log(`   ✅ Второй платеж не оплачен - можно пересоздавать rest сессии`);
    }

    // 8. Группируем истекшие сессии по типу
    console.log(`\n🔍 Шаг 7: Группировка истекших сессий по типу`);
    const sessionsByType = new Map();
    for (const expiredSession of dealExpiredSessions) {
      let paymentType = expiredSession.paymentType || 'unknown';
      if (paymentType === 'second' || paymentType === 'final') {
        paymentType = 'rest';
      }
      
      if (!sessionsByType.has(paymentType)) {
        sessionsByType.set(paymentType, []);
      }
      sessionsByType.get(paymentType).push(expiredSession);
    }
    
    console.log(`   Типы истекших сессий: ${Array.from(sessionsByType.keys()).join(', ')}`);
    
    // 9. Проверяем условия для каждого типа
    for (const [paymentType, sessions] of sessionsByType.entries()) {
      console.log(`\n   📋 Тип: ${paymentType} (${sessions.length} сессий)`);
      
      const isDeposit = paymentType === 'deposit';
      const isRest = paymentType === 'rest';
      
      if (isDeposit) {
        console.log(`     ✅ Deposit - можно пересоздавать всегда`);
      } else if (isRest) {
        console.log(`     Проверка условий для rest:`);
        console.log(`       - График 50/50: ${schedule === '50/50' ? '✅' : '❌'}`);
        console.log(`       - Дата второго платежа: ${secondPaymentDate ? '✅' : '❌'}`);
        console.log(`       - Дата наступила: ${secondPaymentDate && schedulerService.isDateReached(secondPaymentDate) ? '✅' : '❌'}`);
        console.log(`       - Первый платеж оплачен: ${firstPaid ? '✅' : '❌'}`);
        console.log(`       - Второй платеж НЕ оплачен: ${!paidSecondPayment ? '✅' : '❌'}`);
        
        if (schedule !== '50/50' || !secondPaymentDate) {
          console.log(`       ⚠️  УСЛОВИЕ НЕ ВЫПОЛНЕНО: график не 50/50 или нет даты`);
        } else if (!firstPaid) {
          console.log(`       ⚠️  УСЛОВИЕ НЕ ВЫПОЛНЕНО: первый платеж не оплачен`);
        } else if (!schedulerService.isDateReached(secondPaymentDate)) {
          console.log(`       ⚠️  УСЛОВИЕ НЕ ВЫПОЛНЕНО: дата второго платежа еще не наступила`);
        } else if (paidSecondPayment) {
          console.log(`       ⚠️  УСЛОВИЕ НЕ ВЫПОЛНЕНО: второй платеж уже оплачен`);
        } else {
          console.log(`       ✅ ВСЕ УСЛОВИЯ ВЫПОЛНЕНЫ - можно пересоздавать`);
        }
      }
    }

    // 10. Проверяем, что вернет findExpiredSessionTasks
    console.log(`\n🔍 Шаг 8: Результат findExpiredSessionTasks`);
    const tasks = await schedulerService.findExpiredSessionTasks();
    const dealTasks = tasks.filter(t => String(t.dealId) === String(dealId));
    console.log(`   Найдено задач для этой сделки: ${dealTasks.length}`);
    
    if (dealTasks.length > 0) {
      dealTasks.forEach(t => {
        console.log(`     - Тип: ${t.paymentType}, Сессия: ${t.sessionId}`);
      });
    } else {
      console.log(`   ⚠️  ЗАДАЧ НЕ НАЙДЕНО - это объясняет, почему не создаются новые сессии`);
    }

  } catch (error) {
    logger.error(`Ошибка диагностики Deal #${dealId}`, {
      dealId,
      error: error.message,
      stack: error.stack
    });
    console.log(`❌ Ошибка: ${error.message}`);
  }
}

async function main() {
  console.log('🔍 Детальная диагностика фильтров для истекших сессий\n');
  console.log(`Проверяем сделки: ${DEAL_IDS.join(', ')}\n`);

  const schedulerService = new SecondPaymentSchedulerService();
  const repository = new StripeRepository();
  const pipedriveClient = new PipedriveClient();
  const stripe = getStripeClient();

  for (const dealId of DEAL_IDS) {
    await debugDeal(dealId, schedulerService, repository, pipedriveClient, stripe);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log(`\n\n${'='.repeat(80)}`);
  console.log('✅ Диагностика завершена');
  console.log('='.repeat(80));
}

main().catch((error) => {
  logger.error('Script failed', { error: error.message, stack: error.stack });
  console.error('❌ Критическая ошибка:', error.message);
  process.exit(1);
});



