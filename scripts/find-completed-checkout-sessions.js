#!/usr/bin/env node

/**
 * Скрипт для поиска завершенных Stripe Checkout Sessions
 *
 * Ищет сессии со статусами 'complete' или 'expired'
 * Показывает детальную информацию по каждой сессии
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { getStripeClient } = require('../src/services/stripe/client');
const StripeRepository = require('../src/services/stripe/repository');
const logger = require('../src/utils/logger');

async function findCompletedCheckoutSessions() {
  try {
    const stripe = getStripeClient();
    const repository = new StripeRepository();

    // Фильтр: последние 7 дней
    const sevenDaysAgo = Math.floor((Date.now() - 7 * 24 * 60 * 60 * 1000) / 1000);
    const sevenDaysAgoDate = new Date(sevenDaysAgo * 1000).toISOString().split('T')[0];

    console.log(`🔍 Поиск Stripe Checkout Sessions за последние 7 дней (с ${sevenDaysAgoDate})...\n`);

    let totalSessions = 0;
    let completedSessions = 0;
    let expiredSessions = 0;
    let openSessions = 0;
    let otherSessions = 0;

    const completedSessionsList = [];
    const expiredSessionsList = [];
    const openSessionsList = [];

    // Получаем все сессии через pagination
    let hasMore = true;
    let startingAfter = null;

    while (hasMore) {
      const params = {
        limit: 100,
        expand: ['data.line_items', 'data.customer'],
        created: {
          gte: sevenDaysAgo
        }
      };

      if (startingAfter) {
        params.starting_after = startingAfter;
      }

      const sessions = await stripe.checkout.sessions.list(params);

      for (const session of sessions.data) {
        // Дополнительная проверка на случай если API вернет старые сессии
        if (session.created < sevenDaysAgo) {
          hasMore = false;
          break;
        }

        totalSessions++;

        const status = session.status;
        const paymentStatus = session.payment_status;
        const sessionId = session.id;
        const amount = session.amount_total ? (session.amount_total / 100).toFixed(2) : 'N/A';
        const currency = session.currency?.toUpperCase() || 'N/A';
        const customerEmail = session.customer_details?.email || session.customer_email || 'N/A';
        const created = new Date(session.created * 1000).toISOString().split('T')[0];
        const createdTime = new Date(session.created * 1000).toISOString();

        let statusInfo = '';

        if (status === 'complete' && paymentStatus === 'paid') {
          completedSessions++;
          statusInfo = '✅ COMPLETED (оплачена)';

          completedSessionsList.push({
            sessionId,
            amount,
            currency,
            customerEmail,
            created,
            createdTime,
            paymentStatus
          });
        } else if (status === 'expired') {
          expiredSessions++;
          statusInfo = '⏰ EXPIRED (истекла)';

          expiredSessionsList.push({
            sessionId,
            amount,
            currency,
            customerEmail,
            created,
            createdTime
          });
        } else if (status === 'open') {
          openSessions++;
          statusInfo = '🔄 OPEN (открыта)';

          openSessionsList.push({
            sessionId,
            amount,
            currency,
            customerEmail,
            created,
            createdTime
          });
        } else {
          otherSessions++;
          statusInfo = `❓ ${status} (${paymentStatus})`;
        }

        console.log(`${statusInfo} | ${sessionId} | ${created} | ${amount} ${currency} | ${customerEmail}`);
      }

      hasMore = sessions.has_more;
      if (sessions.data.length > 0) {
        startingAfter = sessions.data[sessions.data.length - 1].id;
      } else {
        hasMore = false;
      }
    }

    console.log(`\n📊 СТАТИСТИКА ЗА ПОСЛЕДНИЕ 7 ДНЕЙ:`);
    console.log(`Всего сессий: ${totalSessions}`);
    console.log(`✅ Завершенных (оплаченных): ${completedSessions}`);
    console.log(`⏰ Истекших: ${expiredSessions}`);
    console.log(`🔄 Открытых: ${openSessions}`);
    console.log(`❓ Других: ${otherSessions}`);

    if (completedSessionsList.length > 0) {
      console.log(`\n🎯 ЗАВЕРШЕННЫЕ СЕССИИ (${completedSessionsList.length}):`);

      // Группируем по email для лучшего обзора
      const byEmail = {};
      completedSessionsList.forEach(session => {
        if (!byEmail[session.customerEmail]) {
          byEmail[session.customerEmail] = [];
        }
        byEmail[session.customerEmail].push(session);
      });

      Object.entries(byEmail).forEach(([email, sessions]) => {
        console.log(`\n👤 ${email}:`);
        sessions.forEach(session => {
          console.log(`   ${session.sessionId} | ${session.created} | ${session.amount} ${session.currency}`);
        });
      });
    }

    if (expiredSessionsList.length > 0) {
      console.log(`\n⏰ ИСТЕКШИЕ СЕССИИ (${expiredSessionsList.length}):`);
      expiredSessionsList.forEach(session => {
        console.log(`   ${session.sessionId} | ${session.created} | ${session.amount} ${session.currency} | ${session.customerEmail}`);
      });
    }

    if (openSessionsList.length > 0) {
      console.log(`\n🔄 ОТКРЫТЫЕ СЕССИИ (${openSessionsList.length}) - ТРЕБУЮТ ВНИМАНИЯ:`);
      openSessionsList.forEach(session => {
        console.log(`   ${session.sessionId} | ${session.created} | ${session.amount} ${session.currency} | ${session.customerEmail}`);
      });
    }

  } catch (error) {
    logger.error('Ошибка при поиске сессий:', error);
    console.error('❌ Ошибка:', error.message);
    process.exit(1);
  }
}

findCompletedCheckoutSessions();
