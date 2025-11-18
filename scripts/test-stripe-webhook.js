#!/usr/bin/env node
/**
 * Тестовый скрипт для проверки Stripe webhook endpoint
 * 
 * Использование:
 *   node scripts/test-stripe-webhook.js [event-type]
 * 
 * Примеры:
 *   node scripts/test-stripe-webhook.js checkout.session.completed
 *   node scripts/test-stripe-webhook.js payment_intent.succeeded
 *   node scripts/test-stripe-webhook.js charge.refunded
 */

const axios = require('axios');
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const { URL } = require('url');

const WEBHOOK_URL = process.env.WEBHOOK_URL || 'http://localhost:3000/api/webhooks/stripe';
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || null;

// Mock события Stripe для тестирования
const mockEvents = {
  'checkout.session.completed': {
    id: 'evt_test_webhook',
    object: 'event',
    api_version: '2024-04-10',
    created: Math.floor(Date.now() / 1000),
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_test_1234567890',
        object: 'checkout.session',
        payment_status: 'paid',
        status: 'complete',
        customer_email: 'test@example.com',
        amount_total: 10000, // 100.00 PLN
        currency: 'pln',
        metadata: {
          deal_id: '1600', // Замените на реальный deal_id для теста
          product_id: 'prod_test_123'
        },
        payment_intent: 'pi_test_1234567890',
        line_items: {
          data: [{
            price: {
              id: 'price_test_123',
              unit_amount: 10000,
              currency: 'pln'
            },
            quantity: 1,
            description: 'Test Product'
          }]
        }
      }
    }
  },
  'checkout.session.async_payment_succeeded': {
    id: 'evt_test_webhook_async',
    object: 'event',
    api_version: '2024-04-10',
    created: Math.floor(Date.now() / 1000),
    type: 'checkout.session.async_payment_succeeded',
    data: {
      object: {
        id: 'cs_test_async_1234567890',
        object: 'checkout.session',
        payment_status: 'paid',
        status: 'complete',
        customer_email: 'test@example.com',
        amount_total: 10000,
        currency: 'pln',
        metadata: {
          deal_id: '1600',
          product_id: 'prod_test_123'
        },
        payment_intent: 'pi_test_async_1234567890'
      }
    }
  },
  'payment_intent.succeeded': {
    id: 'evt_test_webhook_pi',
    object: 'event',
    api_version: '2024-04-10',
    created: Math.floor(Date.now() / 1000),
    type: 'payment_intent.succeeded',
    data: {
      object: {
        id: 'pi_test_1234567890',
        object: 'payment_intent',
        status: 'succeeded',
        amount: 10000,
        currency: 'pln',
        metadata: {
          deal_id: '1600',
          session_id: 'cs_test_1234567890'
        }
      }
    }
  },
  'charge.refunded': {
    id: 'evt_test_webhook_refund',
    object: 'event',
    api_version: '2024-04-10',
    created: Math.floor(Date.now() / 1000),
    type: 'charge.refunded',
    data: {
      object: {
        id: 'ch_test_refund_1234567890',
        object: 'charge',
        amount: 10000,
        amount_refunded: 5000,
        currency: 'pln',
        payment_intent: 'pi_test_1234567890',
        refunds: {
          object: 'list',
          data: [{
            id: 're_test_1234567890',
            object: 'refund',
            amount: 5000,
            currency: 'pln',
            status: 'succeeded',
            payment_intent: 'pi_test_1234567890',
            charge: 'ch_test_refund_1234567890'
          }]
        },
        metadata: {
          deal_id: '1600'
        }
      }
    }
  }
};

/**
 * Создает подпись Stripe webhook (упрощенная версия для тестирования)
 */
function createStripeSignature(payload, secret) {
  if (!secret) {
    return null;
  }
  
  const timestamp = Math.floor(Date.now() / 1000);
  const signedPayload = `${timestamp}.${payload}`;
  const signature = crypto
    .createHmac('sha256', secret)
    .update(signedPayload, 'utf8')
    .digest('hex');
  
  return `t=${timestamp},v1=${signature}`;
}

/**
 * Отправляет тестовый webhook
 */
async function sendTestWebhook(eventType) {
  const event = mockEvents[eventType];
  
  if (!event) {
    console.error(`❌ Неизвестный тип события: ${eventType}`);
    console.log(`\nДоступные типы событий:`);
    Object.keys(mockEvents).forEach(type => {
      console.log(`  - ${type}`);
    });
    process.exit(1);
  }

  console.log(`\n🧪 Тестирование webhook: ${eventType}`);
  console.log(`📍 URL: ${WEBHOOK_URL}`);
  console.log(`🔑 Webhook Secret: ${WEBHOOK_SECRET ? '✅ Настроен' : '⚠️  Не настроен (будет пропущена проверка подписи)'}`);
  console.log(`\n📦 Данные события:`);
  console.log(JSON.stringify(event, null, 2));

  const payload = JSON.stringify(event);
  const signature = createStripeSignature(payload, WEBHOOK_SECRET);

  const headers = {
    'Content-Type': 'application/json'
  };

  if (signature) {
    headers['stripe-signature'] = signature;
  }

  try {
    console.log(`\n🚀 Отправка запроса...`);
    
    // Используем встроенный http/https модуль для отправки raw body
    // express.raw() ожидает Buffer, поэтому используем нативный подход
    return new Promise((resolve, reject) => {
      const url = new URL(WEBHOOK_URL);
      const isHttps = url.protocol === 'https:';
      const client = isHttps ? https : http;
      
      const requestOptions = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname,
        method: 'POST',
        headers: {
          ...headers,
          'Content-Length': Buffer.byteLength(payload)
        }
      };

      const req = client.request(requestOptions, (res) => {
        let responseData = '';
        
        res.on('data', (chunk) => {
          responseData += chunk.toString();
        });
        
        res.on('end', () => {
          console.log(`\n📊 Результат:`);
          console.log(`   Status: ${res.statusCode} ${res.statusMessage}`);
          
          let parsedResponse;
          try {
            parsedResponse = JSON.parse(responseData);
            console.log(`   Response:`, JSON.stringify(parsedResponse, null, 2));
          } catch (e) {
            console.log(`   Response (raw):`, responseData);
            parsedResponse = { raw: responseData };
          }

          if (res.statusCode === 200) {
            console.log(`\n✅ Webhook успешно обработан!`);
            resolve(true);
          } else {
            console.log(`\n⚠️  Webhook вернул статус ${res.statusCode}`);
            resolve(false);
          }
        });
      });

      req.on('error', (error) => {
        console.error(`\n❌ Ошибка при отправке webhook:`);
        console.error(`   Ошибка сети: ${error.message}`);
        console.error(`   Убедитесь, что сервер запущен на ${WEBHOOK_URL}`);
        resolve(false);
      });

      // Отправляем payload как Buffer (raw body)
      req.write(Buffer.from(payload, 'utf8'));
      req.end();
    });
  } catch (error) {
    console.error(`\n❌ Ошибка при отправке webhook:`);
    console.error(`   Ошибка: ${error.message}`);
    return false;
  }
}

/**
 * Проверяет доступность endpoint
 */
async function checkEndpoint() {
  try {
    // Пробуем отправить GET запрос (должен вернуть 405 Method Not Allowed)
    const response = await axios.get(WEBHOOK_URL.replace('/webhooks/stripe', '/health'), {
      validateStatus: () => true
    });
    console.log(`✅ Сервер доступен (health check: ${response.status})`);
    return true;
  } catch (error) {
    console.error(`❌ Сервер недоступен: ${error.message}`);
    console.error(`   Убедитесь, что сервер запущен: npm run dev`);
    return false;
  }
}

// Main
async function main() {
  const eventType = process.argv[2] || 'checkout.session.completed';

  console.log(`\n🔍 Тестирование Stripe Webhook`);
  console.log(`═══════════════════════════════════════`);

  // Проверка доступности сервера
  const serverAvailable = await checkEndpoint();
  if (!serverAvailable) {
    process.exit(1);
  }

  // Отправка тестового webhook
  const success = await sendTestWebhook(eventType);

  console.log(`\n═══════════════════════════════════════`);
  if (success) {
    console.log(`✅ Тест завершен успешно`);
    console.log(`\n💡 Проверьте логи сервера для деталей обработки`);
    process.exit(0);
  } else {
    console.log(`❌ Тест завершен с ошибками`);
    process.exit(1);
  }
}

// Запуск
if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { sendTestWebhook, checkEndpoint };

