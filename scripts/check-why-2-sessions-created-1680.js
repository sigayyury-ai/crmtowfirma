require('dotenv').config();

const StripeRepository = require('../src/services/stripe/repository');
const SecondPaymentSchedulerService = require('../src/services/stripe/secondPaymentSchedulerService');
const StripeProcessorService = require('../src/services/stripe/processor');
const PipedriveClient = require('../src/services/pipedrive');
const logger = require('../src/utils/logger');

/**
 * Проверка, почему для сделки 1680 создалось 2 сессии типа rest
 * Проверяет логику hasSecondPaymentSession и createSecondPaymentSession
 */

async function checkWhy2SessionsCreated() {
  const dealId = 1680;

  console.log('='.repeat(80));
  console.log(`🔍 ПРОВЕРКА: ПОЧЕМУ СОЗДАЛОСЬ 2 СЕССИИ REST ДЛЯ СДЕЛКИ ${dealId}`);
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

    // 1. Получаем сделку
    console.log('\n📋 1. ИНФОРМАЦИЯ О СДЕЛКЕ');
    console.log('-'.repeat(80));
    const dealResult = await pipedriveClient.getDeal(dealId);
    if (!dealResult.success || !dealResult.deal) {
      console.log(`❌ Сделка ${dealId} не найдена`);
      return;
    }
    const deal = dealResult.deal;
    console.log(`Название: ${deal.title}`);
    console.log(`Статус: ${deal.status}`);

    // 2. Проверяем hasSecondPaymentSession
    console.log('\n📊 2. ПРОВЕРКА hasSecondPaymentSession');
    console.log('-'.repeat(80));
    const hasSecond = await scheduler.hasSecondPaymentSession(dealId);
    console.log(`hasSecondPaymentSession вернул: ${hasSecond}`);
    
    if (hasSecond) {
      console.log('✅ Метод считает, что вторая сессия уже есть');
    } else {
      console.log('❌ Метод считает, что второй сессии НЕТ (может создать дубликат!)');
    }

    // 3. Проверяем все сессии для сделки в Stripe
    console.log('\n📊 3. ВСЕ СЕССИИ ДЛЯ СДЕЛКИ 1680 В STRIPE');
    console.log('-'.repeat(80));
    
    try {
      const allStripeSessions = await stripeProcessor.stripe.checkout.sessions.list({
        limit: 100
      });
      
      const dealSessions = allStripeSessions.data.filter(s => 
        (s.metadata?.deal_id === String(dealId) || s.metadata?.dealId === String(dealId)) &&
        (s.metadata?.payment_type === 'rest' || s.metadata?.payment_type === 'second' || s.metadata?.payment_type === 'final')
      );
      
      console.log(`Всего сессий типа rest/second/final для сделки ${dealId}: ${dealSessions.length}`);
      
      if (dealSessions.length > 1) {
        console.log(`\n⚠️  ПРОБЛЕМА: Найдено ${dealSessions.length} сессий второго платежа!`);
        console.log(`    Должна быть только 1!`);
      }
      
      dealSessions.forEach((s, i) => {
        const expired = s.expires_at && s.expires_at < Math.floor(Date.now() / 1000);
        const paid = s.payment_status === 'paid';
        const active = s.status === 'open';
        
        console.log(`\n  Сессия ${i + 1}:`);
        console.log(`    ID: ${s.id}`);
        console.log(`    Тип: ${s.metadata?.payment_type}`);
        console.log(`    Статус: ${s.status}`);
        console.log(`    Оплата: ${s.payment_status}`);
        console.log(`    Просрочена: ${expired ? 'ДА' : 'НЕТ'}`);
        console.log(`    Активна: ${active ? 'ДА' : 'НЕТ'}`);
        console.log(`    Создана: ${new Date(s.created * 1000).toISOString()}`);
        if (s.expires_at) {
          console.log(`    Истекает: ${new Date(s.expires_at * 1000).toISOString()}`);
        }
        
        // Проверяем, должна ли hasSecondPaymentSession найти эту сессию
        if (s.status === 'open' || s.payment_status === 'paid') {
          console.log(`    ✅ Должна быть найдена hasSecondPaymentSession (status=open или paid)`);
        } else {
          console.log(`    ⚠️  НЕ будет найдена hasSecondPaymentSession (status=${s.status}, payment_status=${s.payment_status})`);
        }
      });

      // 4. Симулируем проверку hasSecondPaymentSession
      console.log('\n📊 4. СИМУЛЯЦИЯ hasSecondPaymentSession');
      console.log('-'.repeat(80));
      
      let foundActiveOrPaid = false;
      let hasMore = true;
      let startingAfter = null;
      const limit = 100;
      
      while (hasMore && !foundActiveOrPaid) {
        const params = {
          limit,
          metadata: { deal_id: String(dealId) }
        };
        
        if (startingAfter) {
          params.starting_after = startingAfter;
        }
        
        const sessions = await stripeProcessor.stripe.checkout.sessions.list(params);
        
        for (const session of sessions.data) {
          const paymentType = session.metadata?.payment_type || '';
          if (paymentType === 'rest' || paymentType === 'second' || paymentType === 'final') {
            if (session.status === 'open' || session.payment_status === 'paid') {
              foundActiveOrPaid = true;
              console.log(`✅ Найдена активная/оплаченная сессия: ${session.id}`);
              console.log(`    Статус: ${session.status}, Оплата: ${session.payment_status}`);
              break;
            }
          }
        }
        
        hasMore = sessions.has_more;
        if (sessions.data.length > 0) {
          startingAfter = sessions.data[sessions.data.length - 1].id;
        } else {
          hasMore = false;
        }
      }
      
      if (!foundActiveOrPaid) {
        console.log(`❌ Активных/оплаченных сессий не найдено`);
        console.log(`    Это означает, что hasSecondPaymentSession вернет false`);
        console.log(`    И может быть создана новая сессия, даже если есть просроченные!`);
      }

      // 5. Проверяем, когда были созданы сессии
      console.log('\n📊 5. АНАЛИЗ ВРЕМЕНИ СОЗДАНИЯ СЕССИЙ');
      console.log('-'.repeat(80));
      
      if (dealSessions.length >= 2) {
        const sorted = dealSessions.sort((a, b) => a.created - b.created);
        console.log(`Первая сессия создана: ${new Date(sorted[0].created * 1000).toISOString()}`);
        console.log(`Вторая сессия создана: ${new Date(sorted[1].created * 1000).toISOString()}`);
        
        const timeDiff = sorted[1].created - sorted[0].created;
        const minutesDiff = Math.floor(timeDiff / 60);
        const secondsDiff = timeDiff % 60;
        
        console.log(`Разница во времени: ${minutesDiff} минут ${secondsDiff} секунд`);
        
        if (timeDiff < 300) { // Меньше 5 минут
          console.log(`\n⚠️  Сессии созданы почти одновременно!`);
          console.log(`    Возможные причины:`);
          console.log(`    1. Cron запустился дважды`);
          console.log(`    2. hasSecondPaymentSession не успел найти первую сессию`);
          console.log(`    3. Race condition - две сессии создались параллельно`);
        }
      }

      // 6. Проверяем логику создания сессий
      console.log('\n📊 6. ЛОГИКА СОЗДАНИЯ СЕССИЙ');
      console.log('-'.repeat(80));
      console.log('Метод hasSecondPaymentSession проверяет только:');
      console.log('  - status === "open"');
      console.log('  - payment_status === "paid"');
      console.log('Проблема: если сессия просрочена (expired), она НЕ считается существующей!');
      console.log('Результат: может быть создана новая сессия, даже если есть просроченная!');

    } catch (error) {
      console.log(`❌ Ошибка при проверке сессий: ${error.message}`);
    }

  } catch (error) {
    console.error('❌ Ошибка:', error);
    logger.error('Error checking why 2 sessions created', { error: error.message, stack: error.stack });
  }
}

checkWhy2SessionsCreated()
  .then(() => {
    console.log('\n✅ Проверка завершена');
    process.exit(0);
  })
  .catch(error => {
    console.error('❌ Критическая ошибка:', error);
    process.exit(1);
  });
