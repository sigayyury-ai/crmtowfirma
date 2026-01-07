#!/usr/bin/env node

/**
 * Скрипт для проверки, в какой кабинет попадет новая сессия
 * Показывает, какой Stripe ключ используется при создании сессии
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { getStripeClient } = require('../src/services/stripe/client');
const logger = require('../src/utils/logger');

async function testWhichCabinet() {
  console.log('\n🔍 Проверка: в какой кабинет попадет новая сессия\n');
  
  // Проверяем, какой ключ используется для создания сессий
  const stripe = getStripeClient(); // Без type: 'events' - использует PRIMARY
  const apiKey = process.env.STRIPE_API_KEY;
  const eventsKey = process.env.STRIPE_EVENTS_API_KEY;
  
  if (!apiKey) {
    console.error('❌ STRIPE_API_KEY не установлен!');
    process.exit(1);
  }
  
  const apiKeySuffix = apiKey.substring(apiKey.length - 4);
  const eventsKeySuffix = eventsKey ? eventsKey.substring(eventsKey.length - 4) : 'N/A';
  
  console.log('📋 Конфигурация ключей:');
  console.log(`   STRIPE_API_KEY (для платежей): ...${apiKeySuffix}`);
  console.log(`   STRIPE_EVENTS_API_KEY (для отчетов): ...${eventsKeySuffix}`);
  console.log('');
  
  // Определяем кабинет на основе STRIPE_API_KEY
  let cabinetType = 'UNKNOWN';
  let isCorrect = false;
  
  if (apiKeySuffix === '5Cr5') {
    cabinetType = 'PRIMARY (основной кабинет) ✅';
    isCorrect = true;
  } else if (apiKeySuffix === '7UtM') {
    cabinetType = 'EVENTS (Events кабинет) ❌ ОШИБКА!';
    isCorrect = false;
  } else {
    cabinetType = `UNKNOWN (${apiKeySuffix}) ⚠️`;
    isCorrect = false;
  }
  
  console.log('📊 Результат:');
  console.log(`   Кабинет: ${cabinetType}`);
  console.log(`   Правильный ключ: ${isCorrect ? '✅ ДА' : '❌ НЕТ'}`);
  console.log('');
  
  if (!isCorrect) {
    console.log('⚠️  ВНИМАНИЕ: Сессии будут создаваться в неправильном кабинете!');
    console.log('   Исправьте STRIPE_API_KEY в Render Dashboard.');
    console.log('   Должен быть ключ основного кабинета (заканчивается на 5Cr5)');
  } else {
    console.log('✅ Все правильно! Новые сессии будут создаваться в PRIMARY кабинете.');
  }
  
  console.log('');
  console.log('💡 При создании сессии в логах будет видно:');
  console.log('   "🔍 Creating Checkout Session - Key Verification"');
  console.log('   с информацией о том, какой ключ используется.');
  console.log('');
}

testWhichCabinet().catch(error => {
  console.error('\n❌ Ошибка:', error.message);
  process.exit(1);
});

