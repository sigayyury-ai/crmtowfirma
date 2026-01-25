#!/usr/bin/env node

/**
 * Диагностика проблемы с созданием сессии для сделки 2049
 * Проверяет почему крон не обрабатывает эту сделку и почему ручное создание не работает
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { getStripeClient } = require('../src/services/stripe/client');
const StripeRepository = require('../src/services/stripe/repository');
const PipedriveClient = require('../src/services/pipedrive');
const SecondPaymentSchedulerService = require('../src/services/stripe/secondPaymentSchedulerService');
const logger = require('../src/utils/logger');

const DEAL_ID = '2049';

async function debugDeal2049() {
  console.log(`\n🔍 Диагностика сделки ${DEAL_ID}\n`);
  console.log('='.repeat(100));

  try {
    const stripe = getStripeClient();
    const repository = new StripeRepository();
    const pipedriveClient = new PipedriveClient();
    const schedulerService = new SecondPaymentSchedulerService();

    // 1. Проверяем данные сделки
    console.log('\n1️⃣ ДАННЫЕ СДЕЛКИ:');
    console.log('-'.repeat(100));
    const dealResult = await pipedriveClient.getDealWithRelatedData(DEAL_ID);
    if (!dealResult.success || !dealResult.deal) {
      console.log(`   ❌ Сделка не найдена: ${dealResult?.error || 'unknown'}`);
      return;
    }
    const deal = dealResult.deal;
    const person = dealResult.person;
    console.log(`   ✅ Название: ${deal.title}`);
    console.log(`   ✅ Сумма: ${deal.value} ${deal.currency || 'PLN'}`);
    console.log(`   ✅ Статус: ${deal.status || 'N/A'}`);
    console.log(`   ✅ Стадия: ${deal.stage_id || 'N/A'}`);
    console.log(`   ✅ Email: ${person?.email?.[0]?.value || person?.email || 'N/A'}`);
    console.log(`   ✅ Expected Close Date: ${deal.expected_close_date || 'не указана'}`);

    // Проверяем исключения
    const isTestDeal = deal.title && deal.title.includes('TEST_AUTO_');
    const isLostDeal = deal.status === 'lost' || deal.status === 'deleted' || deal.deleted === true;
    const invoiceTypeFieldKey = 'ad67729ecfe0345287b71a3b00910e8ba5b3b496';
    const invoiceType = deal[invoiceTypeFieldKey];
    const isDeleteInvoice = invoiceType === '74' || String(invoiceType).toLowerCase() === 'delete';

    console.log(`\n   🔍 Проверка исключений:`);
    console.log(`      - Тестовая сделка: ${isTestDeal ? '❌ ДА (будет пропущена)' : '✅ НЕТ'}`);
    console.log(`      - Потерянная сделка: ${isLostDeal ? '❌ ДА (будет пропущена)' : '✅ НЕТ'}`);
    console.log(`      - Invoice Type = Delete: ${isDeleteInvoice ? '❌ ДА (будет пропущена)' : '✅ НЕТ'}`);

    // 2. Проверяем платежи в БД
    console.log('\n2️⃣ ПЛАТЕЖИ В БАЗЕ ДАННЫХ:');
    console.log('-'.repeat(100));
    const payments = await repository.listPayments({ dealId: String(DEAL_ID), limit: 100 });
    console.log(`   Всего платежей: ${payments.length}`);
    
    if (payments.length > 0) {
      payments.forEach((p, i) => {
        console.log(`   ${i + 1}. Session ID: ${p.session_id || 'N/A'}`);
        console.log(`      Статус: ${p.status || 'N/A'} / ${p.payment_status || 'N/A'}`);
        console.log(`      Тип: ${p.payment_type || 'N/A'}`);
        console.log(`      Сумма: ${p.original_amount || 0} ${p.currency || 'N/A'}`);
        console.log(`      Создан: ${p.created_at || 'N/A'}`);
      });
    } else {
      console.log(`   ⚠️  Платежей в БД нет`);
    }

    // 3. Проверяем истекшие сессии в Stripe (за последние 7 дней)
    console.log('\n3️⃣ ИСТЕКШИЕ СЕССИИ В STRIPE (последние 7 дней):');
    console.log('-'.repeat(100));
    const sevenDaysAgo = Math.floor((Date.now() - 7 * 24 * 60 * 60 * 1000) / 1000);
    const expiredSessions7Days = await stripe.checkout.sessions.list({
      limit: 100,
      status: 'expired',
      created: { gte: sevenDaysAgo }
    });
    
    const dealExpiredSessions7Days = expiredSessions7Days.data.filter(s => 
      s.metadata?.deal_id === DEAL_ID
    );
    
    console.log(`   Найдено истекших сессий за 7 дней: ${expiredSessions7Days.data.length}`);
    console.log(`   Для сделки ${DEAL_ID}: ${dealExpiredSessions7Days.length}`);
    
    if (dealExpiredSessions7Days.length > 0) {
      dealExpiredSessions7Days.forEach((s, i) => {
        console.log(`   ${i + 1}. Session ID: ${s.id}`);
        console.log(`      Сумма: ${s.amount_total ? (s.amount_total / 100) : 'N/A'} ${s.currency?.toUpperCase() || 'N/A'}`);
        console.log(`      Тип: ${s.metadata?.payment_type || 'N/A'}`);
        console.log(`      Создана: ${new Date(s.created * 1000).toISOString()}`);
        console.log(`      Истекла: ${s.expires_at ? new Date(s.expires_at * 1000).toISOString() : 'N/A'}`);
      });
    } else {
      console.log(`   ⚠️  Нет истекших сессий за последние 7 дней`);
    }

    // 4. Проверяем истекшие сессии в Stripe (ВСЕ, без ограничения по дате)
    console.log('\n4️⃣ ИСТЕКШИЕ СЕССИИ В STRIPE (ВСЕ, без ограничения):');
    console.log('-'.repeat(100));
    let allExpiredSessions = [];
    let hasMore = true;
    let startingAfter = null;
    let checked = 0;
    
    while (hasMore && checked < 1000) { // Ограничиваем до 1000 для безопасности
      const params = {
        limit: 100,
        status: 'expired'
      };
      if (startingAfter) {
        params.starting_after = startingAfter;
      }
      
      const sessions = await stripe.checkout.sessions.list(params);
      const dealSessions = sessions.data.filter(s => s.metadata?.deal_id === DEAL_ID);
      allExpiredSessions.push(...dealSessions);
      
      hasMore = sessions.has_more;
      if (sessions.data.length > 0) {
        startingAfter = sessions.data[sessions.data.length - 1].id;
      } else {
        hasMore = false;
      }
      checked += sessions.data.length;
      
      if (checked >= 1000) {
        console.log(`   ⚠️  Ограничение: проверено 1000 сессий, останавливаемся`);
        break;
      }
    }
    
    console.log(`   Проверено сессий: ${checked}`);
    console.log(`   Найдено истекших сессий для сделки ${DEAL_ID}: ${allExpiredSessions.length}`);
    
    if (allExpiredSessions.length > 0) {
      allExpiredSessions.forEach((s, i) => {
        const createdDate = new Date(s.created * 1000);
        const daysAgo = Math.floor((Date.now() - createdDate.getTime()) / (1000 * 60 * 60 * 24));
        console.log(`   ${i + 1}. Session ID: ${s.id}`);
        console.log(`      Сумма: ${s.amount_total ? (s.amount_total / 100) : 'N/A'} ${s.currency?.toUpperCase() || 'N/A'}`);
        console.log(`      Тип: ${s.metadata?.payment_type || 'N/A'}`);
        console.log(`      Создана: ${createdDate.toISOString()} (${daysAgo} дней назад)`);
        console.log(`      Истекла: ${s.expires_at ? new Date(s.expires_at * 1000).toISOString() : 'N/A'}`);
      });
      console.log(`\n   ⚠️  ПРОБЛЕМА: Есть истекшие сессии, но они старше 7 дней!`);
      console.log(`      Крон ищет только сессии за последние 7 дней.`);
    } else {
      console.log(`   ✅ Нет истекших сессий для этой сделки (сессия никогда не создавалась или все оплачены)`);
    }

    // 5. Проверяем активные сессии в Stripe
    console.log('\n5️⃣ АКТИВНЫЕ СЕССИИ В STRIPE:');
    console.log('-'.repeat(100));
    const activeSessions = await stripe.checkout.sessions.list({
      limit: 100,
      status: 'open'
    });
    
    const dealActiveSessions = activeSessions.data.filter(s => 
      s.metadata?.deal_id === DEAL_ID
    );
    
    console.log(`   Найдено активных сессий: ${activeSessions.data.length}`);
    console.log(`   Для сделки ${DEAL_ID}: ${dealActiveSessions.length}`);
    
    if (dealActiveSessions.length > 0) {
      dealActiveSessions.forEach((s, i) => {
        console.log(`   ${i + 1}. Session ID: ${s.id}`);
        console.log(`      Сумма: ${s.amount_total ? (s.amount_total / 100) : 'N/A'} ${s.currency?.toUpperCase() || 'N/A'}`);
        console.log(`      Тип: ${s.metadata?.payment_type || 'N/A'}`);
        console.log(`      URL: ${s.url || 'N/A'}`);
      });
    } else {
      console.log(`   ✅ Нет активных сессий`);
    }

    // 6. Проверяем метод findExpiredUnpaidSessionsFromStripe
    console.log('\n6️⃣ ПРОВЕРКА findExpiredUnpaidSessionsFromStripe:');
    console.log('-'.repeat(100));
    const expiredUnpaidSessions = await schedulerService.findExpiredUnpaidSessionsFromStripe();
    const dealExpiredUnpaid = expiredUnpaidSessions.filter(s => String(s.dealId) === String(DEAL_ID));
    
    console.log(`   Всего истекших неоплаченных сессий: ${expiredUnpaidSessions.length}`);
    console.log(`   Для сделки ${DEAL_ID}: ${dealExpiredUnpaid.length}`);
    
    if (dealExpiredUnpaid.length > 0) {
      dealExpiredUnpaid.forEach((s, i) => {
        console.log(`   ${i + 1}. Session ID: ${s.sessionId}`);
        console.log(`      Deal ID: ${s.dealId}`);
        console.log(`      Тип: ${s.paymentType || 'N/A'}`);
        console.log(`      Сумма: ${s.amount || 'N/A'} ${s.currency || 'N/A'}`);
      });
    } else {
      console.log(`   ⚠️  Сделка не найдена в списке истекших неоплаченных сессий`);
    }

    // 7. Проверяем метод findExpiredSessionTasks
    console.log('\n7️⃣ ПРОВЕРКА findExpiredSessionTasks:');
    console.log('-'.repeat(100));
    const expiredTasks = await schedulerService.findExpiredSessionTasks();
    const dealTasks = expiredTasks.filter(t => String(t.dealId) === String(DEAL_ID));
    
    console.log(`   Всего задач для пересоздания: ${expiredTasks.length}`);
    console.log(`   Для сделки ${DEAL_ID}: ${dealTasks.length}`);
    
    if (dealTasks.length > 0) {
      dealTasks.forEach((t, i) => {
        console.log(`   ${i + 1}. Deal ID: ${t.dealId}`);
        console.log(`      Тип платежа: ${t.paymentType || 'N/A'}`);
        console.log(`      Сумма: ${t.paymentAmount || 'N/A'} ${t.currency || 'N/A'}`);
        console.log(`      Причина: ${t.reason || 'N/A'}`);
      });
    } else {
      console.log(`   ⚠️  Сделка не попала в задачи для пересоздания`);
    }

    // 8. Итоговая диагностика
    console.log('\n8️⃣ ИТОГОВАЯ ДИАГНОСТИКА:');
    console.log('='.repeat(100));
    
    const reasons = [];
    
    if (isTestDeal) {
      reasons.push('❌ Сделка помечена как тестовая (TEST_AUTO_)');
    }
    if (isLostDeal) {
      reasons.push('❌ Сделка в статусе lost/deleted');
    }
    if (isDeleteInvoice) {
      reasons.push('❌ Invoice Type = Delete');
    }
    if (allExpiredSessions.length === 0) {
      reasons.push('⚠️  Нет истекших сессий в Stripe (сессия никогда не создавалась)');
    } else if (dealExpiredSessions7Days.length === 0) {
      reasons.push('⚠️  Истекшие сессии есть, но они старше 7 дней (крон ищет только за 7 дней)');
    }
    if (dealActiveSessions.length > 0) {
      reasons.push('⚠️  Есть активные сессии (крон не будет пересоздавать)');
    }
    if (dealExpiredUnpaid.length === 0) {
      reasons.push('⚠️  Сделка не найдена в findExpiredUnpaidSessionsFromStripe');
    }
    if (dealTasks.length === 0) {
      reasons.push('⚠️  Сделка не попала в findExpiredSessionTasks');
    }
    
    if (reasons.length === 0) {
      console.log('   ✅ Все проверки пройдены, сделка должна обрабатываться');
    } else {
      console.log('   ПРИЧИНЫ, ПОЧЕМУ СДЕЛКА НЕ ОБРАБАТЫВАЕТСЯ:');
      reasons.forEach((reason, i) => {
        console.log(`   ${i + 1}. ${reason}`);
      });
    }

    // 9. Рекомендации
    console.log('\n9️⃣ РЕКОМЕНДАЦИИ:');
    console.log('='.repeat(100));
    
    if (allExpiredSessions.length > 0 && dealExpiredSessions7Days.length === 0) {
      console.log('   💡 РЕШЕНИЕ: Истекшие сессии старше 7 дней');
      console.log('      - Увеличить период поиска в кроне (изменить sevenDaysAgo)');
      console.log('      - Или создать сессию вручную через скрипт:');
      console.log(`      - node scripts/create-session-for-deal.js ${DEAL_ID}`);
    } else if (allExpiredSessions.length === 0) {
      console.log('   💡 РЕШЕНИЕ: Сессия никогда не создавалась');
      console.log('      - Создать сессию вручную через скрипт:');
      console.log(`      - node scripts/create-session-for-deal.js ${DEAL_ID}`);
    } else if (isTestDeal || isLostDeal || isDeleteInvoice) {
      console.log('   💡 РЕШЕНИЕ: Сделка исключена из обработки');
      console.log('      - Убрать исключения или создать сессию вручную');
    } else {
      console.log('   💡 РЕШЕНИЕ: Проверить другие причины выше');
    }

  } catch (error) {
    console.error('\n❌ Ошибка:', error.message);
    console.error(error.stack);
    logger.error('Ошибка диагностики сделки', { dealId: DEAL_ID, error: error.message, stack: error.stack });
    process.exit(1);
  }
}

debugDeal2049();
