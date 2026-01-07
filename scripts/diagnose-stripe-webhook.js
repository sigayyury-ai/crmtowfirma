#!/usr/bin/env node

/**
 * Диагностика проблем с Stripe webhook
 * 
 * Проверяет:
 * 1. Webhook события в Stripe для конкретной сессии
 * 2. Настройки webhook endpoint
 * 3. Попытки доставки webhook
 * 4. Логи на сервере (если доступны)
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { getStripeClient } = require('../src/services/stripe/client');
const StripeRepository = require('../src/services/stripe/repository');

async function main() {
  const args = process.argv.slice(2);
  const sessionId = args[0] || 'cs_live_a1hydWDFGyA6PMUUjyYWeCMp9iwauQuITYfiFvKe9SY00Jxek2FOIai0k7';
  const dealId = args[1] || '1696';
  
  const stripe = getStripeClient();
  const repo = new StripeRepository();
  
  console.log('=== Диагностика Stripe Webhook ===\n');
  console.log(`Session ID: ${sessionId}`);
  console.log(`Deal ID: ${dealId}`);
  console.log(`Stripe Mode: ${process.env.STRIPE_MODE || 'test'}`);
  console.log();
  
  // 1. Проверяем сессию в Stripe
  console.log('1️⃣  Проверка сессии в Stripe...');
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['payment_intent', 'line_items']
    });
    
    console.log('   ✅ Сессия найдена');
    console.log('   Payment Status:', session.payment_status);
    console.log('   Status:', session.status);
    console.log('   Created:', new Date(session.created * 1000).toISOString());
    console.log('   Metadata deal_id:', session.metadata?.deal_id);
    console.log();
  } catch (error) {
    console.error('   ❌ Ошибка получения сессии:', error.message);
    process.exit(1);
  }
  
  // 2. Проверяем webhook события для этой сессии
  console.log('2️⃣  Поиск webhook событий в Stripe...');
  let sessionEvents = [];
  let endpoints = null;
  try {
    const events = await stripe.events.list({
      limit: 100,
      types: [
        'checkout.session.completed',
        'checkout.session.async_payment_succeeded',
        'checkout.session.async_payment_failed',
        'payment_intent.succeeded',
        'charge.succeeded'
      ]
    });
    
    sessionEvents = events.data.filter(e => {
      const data = e.data?.object;
      return data?.id === sessionId || 
             data?.session === sessionId ||
             (data?.metadata && data.metadata.deal_id === String(dealId));
    });
    
    console.log(`   Найдено событий: ${sessionEvents.length}`);
    
    if (sessionEvents.length === 0) {
      console.log('   ⚠️  Webhook события не найдены!');
      console.log('   Возможные причины:');
      console.log('     - Webhook не был отправлен Stripe');
      console.log('     - События были удалены (Stripe хранит события ограниченное время)');
      console.log('     - Неправильный фильтр поиска');
    } else {
      for (const e of sessionEvents) {
        console.log(`\n   📨 Событие: ${e.type}`);
        console.log(`      ID: ${e.id}`);
        console.log(`      Created: ${new Date(e.created * 1000).toISOString()}`);
        console.log(`      Livemode: ${e.livemode}`);
        
        // Проверяем попытки доставки
        if (e.request) {
          console.log(`      Request ID: ${e.request.id}`);
          console.log(`      Request URL: ${e.request.url || 'N/A'}`);
        }
      }
    }
    console.log();
  } catch (error) {
    console.error('   ❌ Ошибка получения событий:', error.message);
  }
  
  // 3. Проверяем webhook endpoints в Stripe
  console.log('3️⃣  Проверка webhook endpoints в Stripe...');
  try {
    endpoints = await stripe.webhookEndpoints.list({ limit: 10 });
    
    console.log(`   Найдено endpoints: ${endpoints.data.length}`);
    
    const productionUrl = 'https://invoices.comoon.io/api/webhooks/stripe';
    const matchingEndpoint = endpoints.data.find(e => e.url === productionUrl);
    
    if (matchingEndpoint) {
      console.log(`   ✅ Найден endpoint для production: ${productionUrl}`);
      console.log(`      ID: ${matchingEndpoint.id}`);
      console.log(`      Status: ${matchingEndpoint.status}`);
      console.log(`      Enabled events: ${matchingEndpoint.enabled_events.length}`);
      console.log(`      Created: ${new Date(matchingEndpoint.created * 1000).toISOString()}`);
      
      // Проверяем последние попытки доставки
      if (matchingEndpoint.id) {
        try {
          const deliveryAttempts = await stripe.webhookEndpoints.listDeliveryAttempts(matchingEndpoint.id, { limit: 5 });
          console.log(`      Последние попытки доставки: ${deliveryAttempts.data.length}`);
          
          for (const attempt of deliveryAttempts.data.slice(0, 3)) {
            console.log(`        - ${new Date(attempt.created * 1000).toISOString()}: ${attempt.status} (${attempt.response_status_code || 'N/A'})`);
          }
        } catch (err) {
          console.log(`      ⚠️  Не удалось получить попытки доставки: ${err.message}`);
        }
      }
    } else {
      console.log(`   ⚠️  Endpoint для production не найден: ${productionUrl}`);
      console.log('   Доступные endpoints:');
      for (const e of endpoints.data) {
        console.log(`      - ${e.url} (${e.status})`);
      }
    }
    console.log();
  } catch (error) {
    console.error('   ❌ Ошибка получения endpoints:', error.message);
  }
  
  // 4. Проверяем платеж в базе данных
  console.log('4️⃣  Проверка платежа в базе данных...');
  try {
    const payment = await repo.findPaymentBySessionId(sessionId);
    
    if (payment) {
      console.log('   ✅ Платеж найден в базе');
      console.log('   Status:', payment.payment_status);
      console.log('   Created:', payment.created_at);
      console.log('   Processed:', payment.processed_at || 'N/A');
    } else {
      console.log('   ⚠️  Платеж НЕ найден в базе');
      console.log('   Это значит webhook не обработался или не был получен');
    }
    console.log();
  } catch (error) {
    console.error('   ❌ Ошибка проверки базы:', error.message);
  }
  
  // 5. Проверяем настройки окружения
  console.log('5️⃣  Проверка настроек окружения...');
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (webhookSecret) {
    console.log('   ✅ STRIPE_WEBHOOK_SECRET настроен');
    console.log('   Начинается с:', webhookSecret.substring(0, 10) + '...');
    console.log('   Длина:', webhookSecret.length);
  } else {
    console.log('   ❌ STRIPE_WEBHOOK_SECRET НЕ настроен!');
    console.log('   Это критическая ошибка - webhook не будет работать');
  }
  console.log();
  
  // 6. Рекомендации
  console.log('📋 Рекомендации:');
  
  const payment = await repo.findPaymentBySessionId(sessionId);
  
  if (sessionEvents && sessionEvents.length === 0) {
    console.log('   - Webhook события не найдены. Проверь Stripe Dashboard → Events');
    console.log('   - Возможно события были удалены (Stripe хранит их ограниченное время)');
  }
  
  if (!payment) {
    console.log('   - Платеж не обработан. Нужно обработать вручную через persistSession');
  }
  
  if (!webhookSecret) {
    console.log('   - КРИТИЧНО: Настрой STRIPE_WEBHOOK_SECRET в Render Dashboard');
  }
  
  const matchingEndpoint = endpoints?.data?.find(e => e.url === productionUrl);
  if (!matchingEndpoint) {
    console.log('   - ⚠️  КРИТИЧНО: Webhook endpoint для production НЕ НАЙДЕН в Stripe!');
    console.log('   - Нужно создать endpoint в Stripe Dashboard → Developers → Webhooks');
    console.log('   - URL: https://invoices.comoon.io/api/webhooks/stripe');
    console.log('   - События: checkout.session.completed, checkout.session.async_payment_succeeded, etc.');
  }
  
  console.log();
}

main().then(() => process.exit(0)).catch(e => {
  console.error('❌ Критическая ошибка:', e.message);
  console.error(e.stack);
  process.exit(1);
});

