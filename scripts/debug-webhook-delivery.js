#!/usr/bin/env node

/**
 * Диагностика доставки Stripe webhook
 * Проверяет почему webhook не доставляется на сервер
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { getStripeClient } = require('../src/services/stripe/client');
const https = require('https');

const WEBHOOK_URL = 'https://invoices.comoon.io/api/webhooks/stripe';

async function checkEndpointAvailability() {
  return new Promise((resolve, reject) => {
    console.log('1️⃣  Проверка доступности endpoint...');
    console.log('   URL:', WEBHOOK_URL);
    
    const url = new URL(WEBHOOK_URL);
    const options = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname,
      method: 'GET',
      timeout: 10000,
      headers: {
        'User-Agent': 'Stripe-Webhook-Debug/1.0'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode === 200) {
          console.log('   ✅ Endpoint доступен (HTTP', res.statusCode + ')');
          try {
            const json = JSON.parse(data);
            console.log('   Response:', JSON.stringify(json, null, 2));
          } catch (e) {
            console.log('   Response (не JSON):', data.substring(0, 200));
          }
          resolve(true);
        } else {
          console.log('   ⚠️  Endpoint вернул HTTP', res.statusCode);
          console.log('   Response:', data.substring(0, 200));
          resolve(false);
        }
      });
    });

    req.on('error', (error) => {
      console.log('   ❌ Ошибка подключения:', error.message);
      resolve(false);
    });

    req.on('timeout', () => {
      req.destroy();
      console.log('   ❌ Timeout при подключении');
      resolve(false);
    });

    req.end();
  });
}

async function checkStripeWebhookEvents() {
  const stripe = getStripeClient();
  
  console.log('\n2️⃣  Проверка последних webhook событий в Stripe...');
  
  try {
    // Получаем последние события
    const events = await stripe.events.list({
      limit: 20,
      types: ['checkout.session.completed', 'checkout.session.async_payment_succeeded']
    });
    
    console.log('   Найдено событий:', events.data.length);
    console.log();
    
    if (events.data.length === 0) {
      console.log('   ⚠️  События не найдены');
      return;
    }
    
    // Проверяем delivery attempts для каждого события
    for (const event of events.data.slice(0, 5)) {
      console.log(`   📨 Событие: ${event.type}`);
      console.log(`      ID: ${event.id}`);
      console.log(`      Created: ${new Date(event.created * 1000).toISOString()}`);
      console.log(`      Livemode: ${event.livemode}`);
      
      // Проверяем request информацию
      if (event.request) {
        console.log(`      Request ID: ${event.request.id || 'N/A'}`);
        console.log(`      Request URL: ${event.request.url || 'N/A'}`);
        if (!event.request.id) {
          console.log(`      ⚠️  Request ID отсутствует - webhook не был отправлен!`);
        }
      } else {
        console.log(`      ⚠️  Request информация отсутствует - webhook не был отправлен!`);
      }
      
      // Проверяем есть ли delivery attempts через endpoint
      const endpoints = await stripe.webhookEndpoints.list({ limit: 10 });
      const matchingEndpoint = endpoints.data.find(e => e.url === WEBHOOK_URL);
      
      if (matchingEndpoint) {
        try {
          // Пробуем получить delivery attempts (если API поддерживает)
          console.log(`      Endpoint: ${matchingEndpoint.id}`);
        } catch (err) {
          // API может не поддерживать listDeliveryAttempts
        }
      }
      
      console.log();
    }
    
  } catch (error) {
    console.error('   ❌ Ошибка получения событий:', error.message);
  }
}

async function checkWebhookEndpoints() {
  const stripe = getStripeClient();
  
  console.log('3️⃣  Проверка webhook endpoints...');
  
  try {
    const endpoints = await stripe.webhookEndpoints.list({ limit: 10 });
    const matching = endpoints.data.filter(e => e.url === WEBHOOK_URL);
    
    console.log('   Всего endpoints:', endpoints.data.length);
    console.log('   Для URL', WEBHOOK_URL + ':', matching.length);
    console.log();
    
    if (matching.length === 0) {
      console.log('   ⚠️  Endpoints не найдены через API');
      console.log('   Проверьте в Stripe Dashboard - возможно они в другом режиме');
      return;
    }
    
    for (const endpoint of matching) {
      console.log('   Endpoint:', endpoint.id);
      console.log('      Status:', endpoint.status);
      console.log('      Livemode:', endpoint.livemode);
      console.log('      Events:', endpoint.enabled_events.length);
      console.log('      Created:', new Date(endpoint.created * 1000).toISOString());
      
      // Проверяем последние delivery attempts
      try {
        // Stripe API может не поддерживать listDeliveryAttempts напрямую
        // Но можем проверить через events
        console.log('      Проверка доставки через события...');
      } catch (err) {
        console.log('      ⚠️  Не удалось проверить delivery attempts:', err.message);
      }
      console.log();
    }
    
  } catch (error) {
    console.error('   ❌ Ошибка получения endpoints:', error.message);
  }
}

async function checkEnvironment() {
  console.log('4️⃣  Проверка переменных окружения...');
  
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const stripeEventsKey = process.env.STRIPE_EVENTS_API_KEY;
  
  console.log('   Режим: live (только live режим используется)');
  console.log('   STRIPE_EVENTS_API_KEY:', stripeEventsKey ? stripeEventsKey.substring(0, 20) + '...' : 'не установлен');
  console.log('   STRIPE_WEBHOOK_SECRET:', webhookSecret ? webhookSecret.substring(0, 15) + '...' : 'не установлен');
  
  if (!webhookSecret) {
    console.log('   ❌ STRIPE_WEBHOOK_SECRET не установлен!');
  } else {
    console.log('   ✅ STRIPE_WEBHOOK_SECRET установлен');
  }
  
  console.log();
}

async function simulateWebhookRequest() {
  console.log('5️⃣  Симуляция webhook запроса (проверка обработки)...');
  
  // Создаем тестовый payload
  const testPayload = JSON.stringify({
    id: 'evt_test_webhook',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_test_simulation',
        payment_status: 'paid',
        metadata: {
          deal_id: '9999'
        }
      }
    }
  });
  
  // Генерируем подпись (упрощенная версия для теста)
  console.log('   ⚠️  Для полной симуляции нужен реальный signing secret');
  console.log('   Используйте Stripe CLI: stripe listen --forward-to', WEBHOOK_URL);
  console.log();
}

async function main() {
  console.log('=== Диагностика доставки Stripe Webhook ===\n');
  console.log('Webhook URL:', WEBHOOK_URL);
  console.log();
  
  // 1. Проверка доступности
  const isAvailable = await checkEndpointAvailability();
  
  // 2. Проверка событий в Stripe
  await checkStripeWebhookEvents();
  
  // 3. Проверка endpoints
  await checkWebhookEndpoints();
  
  // 4. Проверка окружения
  await checkEnvironment();
  
  // 5. Симуляция
  await simulateWebhookRequest();
  
  // Итоговые рекомендации
  console.log('📋 Рекомендации:');
  console.log();
  
  if (!isAvailable) {
    console.log('   ❌ Endpoint недоступен извне!');
    console.log('   - Проверьте что сервер запущен на Render');
    console.log('   - Проверьте что URL правильный');
    console.log('   - Проверьте firewall/security settings');
    console.log();
  }
  
  console.log('   Для полной диагностики:');
  console.log('   1. Проверьте логи на Render (должны быть запросы от Stripe)');
  console.log('   2. Проверьте Stripe Dashboard → Webhooks → [endpoint] → Recent events');
  console.log('   3. Проверьте что в событиях есть Request ID (значит Stripe пытался отправить)');
  console.log('   4. Если Request ID отсутствует - Stripe не отправлял webhook');
  console.log('   5. Если Request ID есть но нет в логах - проблема с доставкой');
  console.log();
  
  console.log('   Для тестирования используйте Stripe CLI:');
  console.log('   stripe listen --forward-to', WEBHOOK_URL);
  console.log();
}

main().then(() => process.exit(0)).catch(e => {
  console.error('\n❌ Критическая ошибка:', e.message);
  console.error(e.stack);
  process.exit(1);
});

