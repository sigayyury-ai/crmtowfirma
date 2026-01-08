#!/usr/bin/env node

/**
 * Скрипт для пересылки Stripe webhook событий
 * Использует Stripe API для поиска и пересылки событий
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { getStripeClient } = require('../src/services/stripe/client');
const https = require('https');
const { URL } = require('url');

const WEBHOOK_URL = 'https://invoices.comoon.io/api/webhooks/stripe';

/**
 * Находит событие checkout.session.completed для указанной сессии
 */
async function findCheckoutSessionCompletedEvent(sessionId) {
  const stripe = getStripeClient();
  
  console.log(`🔍 Поиск события checkout.session.completed для сессии: ${sessionId}`);
  
  // Получаем сессию, чтобы узнать время создания
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  const sessionCreated = session.created;
  
  console.log(`📅 Сессия создана: ${new Date(sessionCreated * 1000).toISOString()}`);
  
  // Ищем события checkout.session.completed
  // Обычно они создаются сразу после оплаты
  const events = await stripe.events.list({
    type: 'checkout.session.completed',
    created: {
      gte: sessionCreated - 60, // За минуту до создания сессии
      lte: sessionCreated + 300 // До 5 минут после создания
    },
    limit: 100
  });
  
  // Фильтруем по session_id в metadata
  const matchingEvents = events.data.filter(event => {
    const session = event.data.object;
    return session.id === sessionId;
  });
  
  if (matchingEvents.length === 0) {
    console.log('⚠️  Событие checkout.session.completed не найдено');
    console.log(`   Найдено ${events.data.length} событий типа checkout.session.completed в указанном диапазоне`);
    return null;
  }
  
  const event = matchingEvents[0];
  console.log(`✅ Найдено событие: ${event.id}`);
  console.log(`   Тип: ${event.type}`);
  console.log(`   Создано: ${new Date(event.created * 1000).toISOString()}`);
  
  return event;
}

/**
 * Пересылает webhook событие на указанный URL
 */
async function resendWebhookEvent(event, webhookUrl) {
  return new Promise((resolve, reject) => {
    const url = new URL(webhookUrl);
    
    // Получаем webhook secret для подписи
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      return reject(new Error('STRIPE_WEBHOOK_SECRET не установлен в .env'));
    }
    
    // Создаем подпись для webhook
    const stripe = require('stripe')(process.env.STRIPE_API_KEY);
    const payload = JSON.stringify(event);
    const signature = stripe.webhooks.generateTestHeaderString({
      payload,
      secret: webhookSecret,
      timestamp: Math.floor(Date.now() / 1000)
    });
    
    const options = {
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Stripe-Signature': signature,
        'User-Agent': 'Stripe/1.0 (+https://stripe.com/docs/webhooks)'
      }
    };
    
    console.log(`📤 Пересылка webhook на ${webhookUrl}...`);
    
    const req = https.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          console.log(`✅ Webhook успешно переслан!`);
          console.log(`   Статус: ${res.statusCode}`);
          console.log(`   Ответ: ${data}`);
          resolve({ statusCode: res.statusCode, data });
        } else {
          console.error(`❌ Webhook вернул ошибку: ${res.statusCode}`);
          console.error(`   Ответ: ${data}`);
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });
    
    req.on('error', (error) => {
      console.error('❌ Ошибка при пересылке webhook:');
      console.error(error.message);
      reject(error);
    });
    
    req.write(payload);
    req.end();
  });
}

/**
 * Основная функция
 */
async function main() {
  const args = process.argv.slice(2);
  const sessionId = args[0];
  
  if (!sessionId) {
    console.log(`
📋 Скрипт для пересылки Stripe webhook событий

Использование:
  node scripts/resend-stripe-webhook.js <session_id> [webhook_url]

Примеры:
  node scripts/resend-stripe-webhook.js cs_live_a1AyE4JzGZsg1mrCpq4EkjQSRsJNhSNKNQl2fWFMrANSD1zJ6MKIuN5gGM
  node scripts/resend-stripe-webhook.js cs_live_xxx http://localhost:3000/api/webhooks/stripe

Переменные окружения:
  STRIPE_API_KEY - API ключ Stripe (обязательно)
  STRIPE_WEBHOOK_SECRET - Секрет webhook для подписи (обязательно)
  WEBHOOK_URL - URL webhook endpoint (по умолчанию: ${WEBHOOK_URL})
`);
    process.exit(0);
  }
  
  const webhookUrl = args[1] || process.env.WEBHOOK_URL || WEBHOOK_URL;
  
  try {
    // Находим событие
    const event = await findCheckoutSessionCompletedEvent(sessionId);
    
    if (!event) {
      console.log('\n💡 Совет: Проверьте Stripe Dashboard → Developers → Events для поиска события вручную');
      process.exit(1);
    }
    
    // Пересылаем webhook
    await resendWebhookEvent(event, webhookUrl);
    
    console.log('\n✅ Готово!');
  } catch (error) {
    console.error('\n❌ Ошибка:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error('Критическая ошибка:', error);
    process.exit(1);
  });
}

module.exports = { findCheckoutSessionCompletedEvent, resendWebhookEvent };

