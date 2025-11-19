#!/usr/bin/env node

/**
 * Скрипт для удаления Stripe Checkout Sessions для сделки
 * 
 * Использование:
 *   node scripts/delete-stripe-sessions.js <dealId>
 *   node scripts/delete-stripe-sessions.js 1596
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const StripeRepository = require('../src/services/stripe/repository');
const { getStripeClient } = require('../src/services/stripe/client');
const logger = require('../src/utils/logger');

const DEAL_ID = process.argv[2];

if (!DEAL_ID) {
  console.error('❌ Укажите Deal ID');
  console.log('Использование: node scripts/delete-stripe-sessions.js <dealId>');
  process.exit(1);
}

async function deleteSessions() {
  try {
    const repository = new StripeRepository();
    const stripe = getStripeClient();

    if (!repository.isEnabled()) {
      console.error('❌ Supabase не настроен');
      process.exit(1);
    }

    console.log(`🔍 Поиск платежей/сессий для Deal ID: ${DEAL_ID}\n`);

    // Находим все платежи для сделки (сессии хранятся как платежи с session_id)
    const payments = await repository.listPayments({
      dealId: DEAL_ID,
      limit: 100
    });

    // Фильтруем только те, у которых есть session_id (это сессии)
    const sessions = payments.filter(p => p.session_id);

    if (!sessions || sessions.length === 0) {
      console.log('✅ Сессии не найдены');
      return;
    }

    console.log(`📋 Найдено сессий: ${sessions.length}\n`);

    let deleted = 0;
    let errors = 0;

    for (const payment of sessions) {
      try {
        const sessionId = payment.session_id;
        const status = payment.status || 'unknown';
        console.log(`🗑️  Удаление сессии: ${sessionId} (статус: ${status})`);
        
        // Пробуем expire только если сессия еще открыта
        try {
          const session = await stripe.checkout.sessions.retrieve(sessionId);
          if (session.status === 'open') {
            await stripe.checkout.sessions.expire(sessionId);
            console.log(`   ⏰ Сессия истекла в Stripe`);
          } else {
            console.log(`   ℹ️  Сессия уже завершена (${session.status}), пропускаем expire`);
          }
        } catch (stripeError) {
          console.log(`   ⚠️  Не удалось проверить статус в Stripe: ${stripeError.message}`);
        }
        
        // Удаляем из базы данных
        const { error } = await repository.supabase
          .from('stripe_payments')
          .delete()
          .eq('session_id', sessionId);
        
        if (error) {
          throw error;
        }
        
        deleted++;
        console.log(`   ✅ Удалена из базы`);
      } catch (error) {
        errors++;
        console.log(`   ❌ Ошибка: ${error.message}`);
      }
    }

    console.log(`\n✅ Удалено: ${deleted}`);
    if (errors > 0) {
      console.log(`⚠️  Ошибок: ${errors}`);
    }
  } catch (error) {
    logger.error('Ошибка при удалении сессий:', error);
    console.error('❌ Ошибка:', error.message);
    process.exit(1);
  }
}

deleteSessions();

