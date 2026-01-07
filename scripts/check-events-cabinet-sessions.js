#!/usr/bin/env node

/**
 * Скрипт для проверки Checkout Sessions в Events кабинете Stripe
 * Показывает, какие сессии созданы и к каким сделкам они относятся
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { getStripeClient } = require('../src/services/stripe/client');
const logger = require('../src/utils/logger');

async function checkEventsCabinetSessions() {
  console.log('\n🔍 Проверка Checkout Sessions в Events кабинете Stripe\n');
  
  // Используем Events кабинет
  const stripe = getStripeClient({ type: 'events' });
  
  const apiKey = process.env.STRIPE_EVENTS_API_KEY;
  if (!apiKey) {
    console.error('❌ STRIPE_EVENTS_API_KEY не установлен!');
    process.exit(1);
  }
  
  const apiKeySuffix = apiKey.substring(apiKey.length - 4);
  console.log(`📋 Используется Events кабинет (ключ заканчивается на: ${apiKeySuffix})\n`);
  
  try {
    // Получаем список всех Checkout Sessions
    console.log('📥 Загружаем Checkout Sessions из Events кабинета...\n');
    
    const sessions = [];
    let hasMore = true;
    let startingAfter = null;
    const limit = 100;
    
    while (hasMore) {
      const params = {
        limit,
        expand: ['data.customer', 'data.payment_intent']
      };
      
      if (startingAfter) {
        params.starting_after = startingAfter;
      }
      
      const response = await stripe.checkout.sessions.list(params);
      sessions.push(...response.data);
      
      hasMore = response.has_more;
      if (hasMore && response.data.length > 0) {
        startingAfter = response.data[response.data.length - 1].id;
      }
      
      console.log(`   Загружено ${sessions.length} сессий...`);
    }
    
    console.log(`\n✅ Всего найдено сессий: ${sessions.length}\n`);
    
    if (sessions.length === 0) {
      console.log('✅ В Events кабинете нет Checkout Sessions');
      return;
    }
    
    // Анализируем сессии
    const sessionsByDeal = new Map();
    const sessionsWithMetadata = [];
    
    for (const session of sessions) {
      const dealId = session.metadata?.deal_id;
      const paymentType = session.metadata?.payment_type;
      const paymentSchedule = session.metadata?.payment_schedule;
      const created = new Date(session.created * 1000).toISOString();
      const status = session.payment_status || session.status;
      const amount = session.amount_total ? (session.amount_total / 100).toFixed(2) : 'N/A';
      const currency = session.currency?.toUpperCase() || 'N/A';
      
      sessionsWithMetadata.push({
        sessionId: session.id,
        dealId: dealId || 'N/A',
        paymentType: paymentType || 'N/A',
        paymentSchedule: paymentSchedule || 'N/A',
        status,
        amount,
        currency,
        created,
        customerEmail: session.customer_details?.email || session.customer_email || 'N/A',
        url: session.url || 'N/A'
      });
      
      if (dealId) {
        if (!sessionsByDeal.has(dealId)) {
          sessionsByDeal.set(dealId, []);
        }
        sessionsByDeal.get(dealId).push(session);
      }
    }
    
    // Группируем по сделкам
    console.log('📊 Сессии по сделкам:\n');
    console.log('='.repeat(100));
    
    const sortedDeals = Array.from(sessionsByDeal.entries()).sort((a, b) => {
      const aLatest = Math.max(...a[1].map(s => s.created));
      const bLatest = Math.max(...b[1].map(s => s.created));
      return bLatest - aLatest; // Сначала самые новые
    });
    
    for (const [dealId, dealSessions] of sortedDeals) {
      console.log(`\n📋 Deal #${dealId} (${dealSessions.length} сессий):`);
      
      for (const session of dealSessions.sort((a, b) => b.created - a.created)) {
        const created = new Date(session.created * 1000).toISOString();
        const status = session.payment_status || session.status;
        const amount = session.amount_total ? (session.amount_total / 100).toFixed(2) : 'N/A';
        const currency = session.currency?.toUpperCase() || 'N/A';
        const paymentType = session.metadata?.payment_type || 'N/A';
        const paymentSchedule = session.metadata?.payment_schedule || 'N/A';
        
        console.log(`   - ${session.id.substring(0, 25)}...`);
        console.log(`     Тип: ${paymentType} | График: ${paymentSchedule}`);
        console.log(`     Сумма: ${amount} ${currency} | Статус: ${status}`);
        console.log(`     Создано: ${created}`);
        if (session.customer_details?.email || session.customer_email) {
          console.log(`     Email: ${session.customer_details?.email || session.customer_email}`);
        }
      }
    }
    
    // Сессии без deal_id
    const sessionsWithoutDeal = sessionsWithMetadata.filter(s => s.dealId === 'N/A');
    if (sessionsWithoutDeal.length > 0) {
      console.log(`\n\n⚠️  Сессии без deal_id (${sessionsWithoutDeal.length}):\n`);
      for (const session of sessionsWithoutDeal) {
        console.log(`   - ${session.sessionId.substring(0, 25)}...`);
        console.log(`     Статус: ${session.status} | Сумма: ${session.amount} ${session.currency}`);
        console.log(`     Создано: ${session.created}`);
      }
    }
    
    // Статистика
    console.log('\n\n📈 Статистика:\n');
    console.log(`   Всего сессий: ${sessions.length}`);
    console.log(`   С привязкой к сделкам: ${sessionsByDeal.size} сделок`);
    console.log(`   Без привязки к сделкам: ${sessionsWithoutDeal.length}`);
    
    const byStatus = {};
    for (const session of sessions) {
      const status = session.payment_status || session.status || 'unknown';
      byStatus[status] = (byStatus[status] || 0) + 1;
    }
    
    console.log('\n   По статусам:');
    for (const [status, count] of Object.entries(byStatus)) {
      console.log(`     ${status}: ${count}`);
    }
    
    const byPaymentType = {};
    for (const session of sessions) {
      const type = session.metadata?.payment_type || 'unknown';
      byPaymentType[type] = (byPaymentType[type] || 0) + 1;
    }
    
    console.log('\n   По типам платежей:');
    for (const [type, count] of Object.entries(byPaymentType)) {
      console.log(`     ${type}: ${count}`);
    }
    
    // Самые свежие сессии
    console.log('\n\n🕐 Последние 10 сессий:\n');
    const recentSessions = sessionsWithMetadata
      .sort((a, b) => new Date(b.created) - new Date(a.created))
      .slice(0, 10);
    
    for (const session of recentSessions) {
      console.log(`   ${session.created} | Deal #${session.dealId} | ${session.sessionId.substring(0, 25)}... | ${session.amount} ${session.currency} | ${session.status}`);
    }
    
  } catch (error) {
    console.error('\n❌ Ошибка при получении сессий:', error.message);
    logger.error('Failed to check Events cabinet sessions', {
      error: error.message,
      stack: error.stack
    });
    process.exit(1);
  }
}

checkEventsCabinetSessions().catch(error => {
  console.error('\n❌ Критическая ошибка:', error.message);
  process.exit(1);
});

