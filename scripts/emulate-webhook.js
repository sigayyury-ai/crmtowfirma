#!/usr/bin/env node

/**
 * Скрипт для эмуляции webhook'ов от Pipedrive на localhost
 * Использование:
 *   node scripts/emulate-webhook.js stripe <dealId>
 *   node scripts/emulate-webhook.js proforma <dealId>
 *   node scripts/emulate-webhook.js lost <dealId> [reason]
 *   node scripts/emulate-webhook.js delete <dealId>
 */

const axios = require('axios');

const WEBHOOK_URL = process.env.WEBHOOK_URL || 'http://localhost:3000/api/webhooks/pipedrive';
const DEFAULT_DEAL_ID = process.env.DEAL_ID || '1596';

// Шаблоны webhook'ов для разных сценариев
const webhookTemplates = {
  stripe: (dealId) => ({
    'Deal ID': dealId,
    'Deal_id': dealId,
    'Deal_stage_id': '18',
    'Deal stage': 'First payment',
    'Deal_status': 'open',
    'Invoice': '75', // Stripe
    'Invoice type': '75',
    'Deal value': '1000',
    'Deal currency': 'PLN',
    'Contact id': '863',
    'Person ID': '863',
    'Organisation_id': '126',
    'Organization ID': '126',
    'Expected close date': new Date(Date.now() + 35 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 35 дней от сегодня
    'Deal_close_date': new Date(Date.now() + 35 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  }),

  proforma: (dealId) => ({
    'Deal ID': dealId,
    'Deal_id': dealId,
    'Deal_stage_id': '18',
    'Deal stage': 'First payment',
    'Deal_status': 'open',
    'Invoice': '70', // Proforma
    'Invoice type': '70',
    'Deal value': '1000',
    'Deal currency': 'PLN',
    'Contact id': '863',
    'Person ID': '863',
    'Organisation_id': '126',
    'Organization ID': '126',
    'Expected close date': new Date(Date.now() + 35 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  }),

  lost: (dealId, reason = 'No seats') => ({
    'Deal ID': dealId,
    'Deal_id': dealId,
    'Deal_stage_id': '18',
    'Deal stage': 'First payment',
    'Deal_status': 'lost',
    'Deal_lost_reason': reason,
    'Deal_close_date': new Date().toISOString().split('T')[0],
    'Deal value': '1000',
    'Deal currency': 'PLN',
    'Contact id': '863',
    'Person ID': '863'
  }),

  delete: (dealId) => ({
    'Deal ID': dealId,
    'Deal_id': dealId,
    'Invoice': 'Delete',
    'Invoice type': 'Delete',
    'Deal_status': 'open',
    'Deal_stage_id': '18'
  }),

  refund: (dealId) => ({
    'Deal ID': dealId,
    'Deal_id': dealId,
    'Deal_status': 'lost',
    'Deal_lost_reason': 'Refund',
    'Deal_close_date': new Date().toISOString().split('T')[0],
    'Deal value': '1000',
    'Deal currency': 'PLN'
  })
};

async function sendWebhook(type, dealId, ...args) {
  const template = webhookTemplates[type];
  if (!template) {
    console.error(`❌ Неизвестный тип webhook: ${type}`);
    console.log(`Доступные типы: ${Object.keys(webhookTemplates).join(', ')}`);
    process.exit(1);
  }

  const webhookData = template(dealId, ...args);

  console.log(`📤 Отправка webhook типа "${type}" для Deal ${dealId}...`);
  console.log(`📋 URL: ${WEBHOOK_URL}`);
  console.log(`📦 Данные:`, JSON.stringify(webhookData, null, 2));

  try {
    const response = await axios.post(WEBHOOK_URL, webhookData, {
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Pipedrive Webhooks'
      },
      timeout: 30000
    });

    console.log(`✅ Webhook отправлен успешно!`);
    console.log(`📊 Статус: ${response.status}`);
    console.log(`📄 Ответ:`, JSON.stringify(response.data, null, 2));
  } catch (error) {
    console.error(`❌ Ошибка отправки webhook:`);
    if (error.response) {
      console.error(`   Статус: ${error.response.status}`);
      console.error(`   Данные:`, JSON.stringify(error.response.data, null, 2));
    } else if (error.request) {
      console.error(`   Запрос не отправлен. Проверьте, что сервер запущен на ${WEBHOOK_URL}`);
    } else {
      console.error(`   Ошибка: ${error.message}`);
    }
    process.exit(1);
  }
}

// Парсинг аргументов командной строки
const args = process.argv.slice(2);
const type = args[0];
const dealId = args[1] || DEFAULT_DEAL_ID;
const extraArgs = args.slice(2);

if (!type) {
  console.log(`
📋 Эмулятор webhook'ов от Pipedrive

Использование:
  node scripts/emulate-webhook.js <тип> [dealId] [дополнительные параметры]

Типы webhook'ов:
  stripe <dealId>              - Эмуляция webhook для создания Stripe платежа (invoice_type = 75)
  proforma <dealId>            - Эмуляция webhook для создания проформы (invoice_type = 70)
  lost <dealId> [reason]       - Эмуляция webhook для удаления проформы (status = lost)
  delete <dealId>              - Эмуляция webhook для удаления проформы (invoice_type = Delete)
  refund <dealId>              - Эмуляция webhook для рефанда (status = lost, reason = Refund)

Примеры:
  node scripts/emulate-webhook.js stripe 1596
  node scripts/emulate-webhook.js proforma 1596
  node scripts/emulate-webhook.js lost 1596 "No seats"
  node scripts/emulate-webhook.js delete 1596
  node scripts/emulate-webhook.js refund 1596

Переменные окружения:
  WEBHOOK_URL - URL webhook endpoint (по умолчанию: http://localhost:3000/api/webhooks/pipedrive)
  DEAL_ID     - ID сделки по умолчанию (по умолчанию: 1596)
`);
  process.exit(0);
}

sendWebhook(type, dealId, ...extraArgs).catch(error => {
  console.error('❌ Неожиданная ошибка:', error);
  process.exit(1);
});

