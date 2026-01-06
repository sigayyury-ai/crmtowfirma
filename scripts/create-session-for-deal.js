#!/usr/bin/env node

/**
 * Создание Stripe Checkout Session для конкретной сделки
 * 
 * ВАЖНО: Этот скрипт использует API эндпоинт вместо прямого вызова сервисов
 * API: POST /api/pipedrive/deals/:id/diagnostics/actions/create-stripe-session
 * 
 * Использование:
 *   node scripts/create-session-for-deal.js <dealId> [paymentType] [paymentSchedule] [customAmount]
 * 
 * Примеры:
 *   node scripts/create-session-for-deal.js 1775
 *   node scripts/create-session-for-deal.js 1775 deposit 50/50
 *   node scripts/create-session-for-deal.js 1775 rest 50/50 475
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const axios = require('axios');
const logger = require('../src/utils/logger');

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';
const API_ENDPOINT = '/api/pipedrive/deals';

async function createSessionForDeal(dealId, options = {}) {
  const { paymentType, paymentSchedule, customAmount, sendNotification = true } = options;

  try {
    console.log(`🔍 Создание сессии для Deal #${dealId} через API...\n`);

    const url = `${API_BASE_URL}${API_ENDPOINT}/${dealId}/diagnostics/actions/create-stripe-session`;
    
    const requestBody = {};
    if (paymentType) requestBody.paymentType = paymentType;
    if (paymentSchedule) requestBody.paymentSchedule = paymentSchedule;
    if (customAmount !== undefined) requestBody.customAmount = customAmount;
    requestBody.sendNotification = sendNotification;

    console.log(`   📡 Отправка запроса к API: ${url}`);
    if (Object.keys(requestBody).length > 0) {
      console.log(`   📋 Параметры:`, requestBody);
    }

    const response = await axios.post(url, requestBody, {
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });

    if (response.data && response.data.success) {
      const { session, notification } = response.data;
      
      console.log(`\n✅ Stripe Checkout Session created successfully!`);
      console.log(`📋 Session ID: ${session.id}`);
      console.log(`🔗 Payment URL: ${session.url}`);
      console.log(`💰 Amount: ${session.amount} ${session.currency}`);
      
      if (notification) {
        if (notification.sent) {
          console.log(`📨 Уведомление отправлено`);
        } else if (notification.error) {
          console.log(`⚠️  Уведомление не отправлено: ${notification.error}`);
        }
      }

      return {
        success: true,
        sessionId: session.id,
        sessionUrl: session.url,
        amount: session.amount,
        currency: session.currency
      };
    } else {
      throw new Error(response.data?.error || 'Unknown error from API');
    }
  } catch (error) {
    if (error.response) {
      // API вернул ошибку
      const errorData = error.response.data || {};
      const errorMessage = errorData.error || errorData.message || `HTTP ${error.response.status}`;
      throw new Error(`API Error: ${errorMessage}`);
    } else if (error.request) {
      // Запрос отправлен, но ответа нет
      throw new Error(`API недоступен: ${API_BASE_URL}. Проверьте, что сервер запущен.`);
    } else {
      // Ошибка при настройке запроса
      throw new Error(`Ошибка запроса: ${error.message}`);
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dealId = args[0];

  if (!dealId) {
    console.error('❌ Ошибка: не указан Deal ID');
    console.error('\nИспользование:');
    console.error('  node scripts/create-session-for-deal.js <dealId> [paymentType] [paymentSchedule] [customAmount]');
    console.error('\nПримеры:');
    console.error('  node scripts/create-session-for-deal.js 1775');
    console.error('  node scripts/create-session-for-deal.js 1775 deposit 50/50');
    console.error('  node scripts/create-session-for-deal.js 1775 rest 50/50 475');
    process.exit(1);
  }

  const paymentType = args[1] || null;
  const paymentSchedule = args[2] || null;
  const customAmount = args[3] ? parseFloat(args[3]) : null;

  if (customAmount !== null && isNaN(customAmount)) {
    console.error(`❌ Ошибка: customAmount должно быть числом, получено: ${args[3]}`);
    process.exit(1);
  }

  try {
    const result = await createSessionForDeal(dealId, {
      paymentType,
      paymentSchedule,
      customAmount,
      sendNotification: true
    });

    console.log(`\n✅ Сессия успешно создана для Deal #${dealId}\n`);
    process.exit(0);
  } catch (error) {
    logger.error('Failed to create session', {
      dealId,
      error: error.message,
      stack: error.stack
    });
    console.error(`\n❌ Ошибка: ${error.message}\n`);
    process.exit(1);
  }
}

main();
