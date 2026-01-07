#!/usr/bin/env node

/**
 * Создание Stripe Webhook Endpoint через API
 * 
 * Автоматически создает webhook endpoint в Stripe Dashboard
 * с правильным URL и всеми необходимыми событиями
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { getStripeClient } = require('../src/services/stripe/client');
const logger = require('../src/utils/logger');

const WEBHOOK_URL = 'https://invoices.comoon.io/api/webhooks/stripe';
const WEBHOOK_DESCRIPTION = 'Обработка платежей для CRM - production';

// Все события которые нужно обрабатывать
const ENABLED_EVENTS = [
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'checkout.session.expired',
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
  'payment_intent.created',
  'charge.refunded',
  'charge.updated',
  'charge.succeeded',
  'invoice.sent'
];

async function main() {
  // Всегда live режим
  const stripeMode = 'live';
  const stripe = getStripeClient();
  
  console.log('=== Создание Stripe Webhook Endpoint ===\n');
  console.log(`Stripe Mode: ${stripeMode}`);
  console.log(`Webhook URL: ${WEBHOOK_URL}`);
  console.log();
  
  // Проверяем существующие endpoints
  console.log('1️⃣  Проверка существующих endpoints...');
  try {
    const existingEndpoints = await stripe.webhookEndpoints.list({ limit: 100 });
    const matchingEndpoint = existingEndpoints.data.find(e => e.url === WEBHOOK_URL);
    
    if (matchingEndpoint) {
      console.log(`   ⚠️  Endpoint уже существует!`);
      console.log(`   ID: ${matchingEndpoint.id}`);
      console.log(`   Status: ${matchingEndpoint.status}`);
      console.log(`   Created: ${new Date(matchingEndpoint.created * 1000).toISOString()}`);
      console.log(`   Enabled events: ${matchingEndpoint.enabled_events.length}`);
      console.log();
      
      // Проверяем что все события включены
      const missingEvents = ENABLED_EVENTS.filter(e => !matchingEndpoint.enabled_events.includes(e));
      if (missingEvents.length > 0) {
        console.log(`   ⚠️  Отсутствуют события: ${missingEvents.join(', ')}`);
        console.log(`   Нужно обновить endpoint в Stripe Dashboard вручную`);
      } else {
        console.log(`   ✅ Все необходимые события включены`);
      }
      
      // Показываем signing secret hint
      console.log();
      console.log('   Signing secret можно получить в Stripe Dashboard:');
      console.log(`   Developers → Webhooks → ${matchingEndpoint.id} → Signing secret`);
      
      process.exit(0);
    } else {
      console.log(`   ✅ Endpoint не найден, создаем новый...`);
    }
    console.log();
  } catch (error) {
    console.error(`   ❌ Ошибка проверки endpoints: ${error.message}`);
    process.exit(1);
  }
  
  // Создаем endpoint
  console.log('2️⃣  Создание webhook endpoint...');
  try {
    const endpoint = await stripe.webhookEndpoints.create({
      url: WEBHOOK_URL,
      description: WEBHOOK_DESCRIPTION,
      enabled_events: ENABLED_EVENTS,
      api_version: process.env.STRIPE_API_VERSION || '2024-04-10'
    });
    
    console.log(`   ✅ Endpoint создан успешно!`);
    console.log();
    console.log('   📋 Информация о endpoint:');
    console.log(`      ID: ${endpoint.id}`);
    console.log(`      URL: ${endpoint.url}`);
    console.log(`      Status: ${endpoint.status}`);
    console.log(`      Livemode: ${endpoint.livemode}`);
    console.log(`      Enabled events: ${endpoint.enabled_events.length}`);
    console.log(`      Created: ${new Date(endpoint.created * 1000).toISOString()}`);
    console.log();
    
    // Получаем signing secret
    console.log('3️⃣  Получение signing secret...');
    try {
      // Signing secret доступен только при создании endpoint
      // После создания нужно получать через Dashboard или API
      const secret = endpoint.secret;
      
      if (secret) {
        console.log(`   ✅ Signing secret получен!`);
        console.log();
        console.log('   📝 Обновите STRIPE_WEBHOOK_SECRET в Render Dashboard:');
        console.log(`      ${secret}`);
        console.log();
        console.log('   ⚠️  ВАЖНО: Сохраните этот secret! Он показывается только один раз.');
      } else {
        console.log(`   ⚠️  Signing secret не доступен через API после создания`);
        console.log(`   Получите его в Stripe Dashboard:`);
        console.log(`   Developers → Webhooks → ${endpoint.id} → Signing secret`);
      }
    } catch (secretError) {
      console.log(`   ⚠️  Не удалось получить signing secret: ${secretError.message}`);
      console.log(`   Получите его в Stripe Dashboard:`);
      console.log(`   Developers → Webhooks → ${endpoint.id} → Signing secret`);
    }
    
    console.log();
    console.log('✅ Webhook endpoint успешно создан!');
    console.log();
    console.log('📋 Следующие шаги:');
    console.log('   1. Получите signing secret из Stripe Dashboard (если не показан выше)');
    console.log('   2. Обновите STRIPE_WEBHOOK_SECRET в Render Dashboard');
    console.log('   3. Перезапустите сервис на Render');
    console.log('   4. Проверьте работу: создайте тестовый платеж');
    console.log('   5. Проверьте логи: должно быть "📥 Stripe webhook получен"');
    
  } catch (error) {
    console.error(`   ❌ Ошибка создания endpoint: ${error.message}`);
    if (error.code === 'resource_already_exists') {
      console.error(`   Endpoint с таким URL уже существует`);
      console.error(`   Проверьте в Stripe Dashboard → Webhooks`);
    }
    process.exit(1);
  }
}

main().then(() => process.exit(0)).catch(e => {
  console.error('\n❌ Критическая ошибка:', e.message);
  console.error(e.stack);
  process.exit(1);
});

