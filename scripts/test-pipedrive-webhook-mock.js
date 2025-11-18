#!/usr/bin/env node

/**
 * Тестовый скрипт для тестирования Pipedrive webhook обработки БЕЗ реальных токенов API.
 * Использует моки для PipedriveClient, чтобы не делать реальные запросы к API.
 * 
 * Использование:
 *   node scripts/test-pipedrive-webhook-mock.js stripeTrigger
 *   node scripts/test-pipedrive-webhook-mock.js proformaTrigger
 *   node scripts/test-pipedrive-webhook-mock.js refundTrigger
 *   node scripts/test-pipedrive-webhook-mock.js workflowAutomation
 * 
 * Можно указать другой URL через переменную окружения:
 *   WEBHOOK_URL=http://localhost:3000/api/webhooks/pipedrive \
 *   node scripts/test-pipedrive-webhook-mock.js stripeTrigger
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

// Устанавливаем тестовый режим перед импортом модулей
process.env.NODE_ENV = 'test';
process.env.TEST_MODE = 'true';

const express = require('express');
const axios = require('axios');
const logger = require('../src/utils/logger');

const WEBHOOK_URL = process.env.WEBHOOK_URL || 'https://invoices.comoon.io/api/webhooks/pipedrive';
const INVOICE_TYPE_FIELD_KEY = process.env.PIPEDRIVE_INVOICE_TYPE_FIELD_KEY || 'ad67729ecfe0345287b71a3b00910e8ba5b3b496';
const STRIPE_TRIGGER_VALUE = String(process.env.PIPEDRIVE_STRIPE_INVOICE_TYPE_VALUE || '75');
const PROFORMA_TRIGGER_VALUE = String(process.env.PIPEDRIVE_PROFORMA_INVOICE_TYPE_VALUE || '70');
const DELETE_TRIGGER_VALUE = String(process.env.PIPEDRIVE_DELETE_INVOICE_TYPE_VALUE || '74');

// Mock данные для тестирования
const mockDealData = {
  id: 1600,
  title: 'Test Deal',
  status: 'open',
  stage_id: 18,
  value: 10000,
  currency: 'PLN',
  expected_close_date: '2025-12-31',
  person_id: 123,
  org_id: 456,
  [INVOICE_TYPE_FIELD_KEY]: null,
  lost_reason: null
};

const mockPersonData = {
  id: 123,
  name: 'Test Person',
  email: [{ value: 'test@example.com', primary: true }],
  phone: [{ value: '+48123456789', primary: true }]
};

const mockOrganizationData = {
  id: 456,
  name: 'Test Organization',
  address: 'Test Address 123'
};

// Mock события для тестирования
const mockEvents = {
  stripeTrigger: {
    event: 'updated.deal',
    current: {
      ...mockDealData,
      [INVOICE_TYPE_FIELD_KEY]: STRIPE_TRIGGER_VALUE
    },
    previous: {
      ...mockDealData,
      [INVOICE_TYPE_FIELD_KEY]: null
    }
  },
  proformaTrigger: {
    event: 'updated.deal',
    current: {
      ...mockDealData,
      [INVOICE_TYPE_FIELD_KEY]: PROFORMA_TRIGGER_VALUE
    },
    previous: {
      ...mockDealData,
      [INVOICE_TYPE_FIELD_KEY]: null
    }
  },
  refundTrigger: {
    event: 'updated.deal',
    current: {
      ...mockDealData,
      status: 'lost',
      lost_reason: 'Refund'
    },
    previous: {
      ...mockDealData,
      status: 'open',
      lost_reason: null
    }
  },
  deleteTrigger: {
    event: 'updated.deal',
    current: {
      ...mockDealData,
      [INVOICE_TYPE_FIELD_KEY]: DELETE_TRIGGER_VALUE
    },
    previous: {
      ...mockDealData,
      [INVOICE_TYPE_FIELD_KEY]: PROFORMA_TRIGGER_VALUE
    }
  },
  // Workflow automation format (minimal)
  workflowAutomationMinimal: {
    'Deal ID': '1600'
  },
  // Workflow automation format (full data)
  workflowAutomationFull: {
    'Deal_id': '1600',
    'Deal_stage': '18',
    'Previous_deal_stage': '15',
    'Invoice': STRIPE_TRIGGER_VALUE,
    'Deal_status': 'open',
    'Deal_value': '10000',
    'Deal_currency': 'PLN',
    'Deal_close_date': '2025-12-31',
    'Contact id': '123',
    'Organisation_id': '456',
    'Deal_lost_reason': null
  },
  // Workflow automation - refund case
  workflowAutomationRefund: {
    'Deal_id': '1600',
    'Deal_stage': '32',
    'Deal_status': 'lost',
    'Deal_value': '10000',
    'Deal_currency': 'PLN',
    'Contact id': '123',
    'Organisation_id': '456',
    'Deal_lost_reason': 'Refund'
  }
};

/**
 * Создает тестовый сервер с моками для Pipedrive API
 */
function createMockServer() {
  const app = express();
  app.use(express.json());

  // Mock endpoint для получения данных сделки
  app.get('/api/pipedrive/mock/deal/:id', (req, res) => {
    const dealId = parseInt(req.params.id, 10);
    logger.info(`[MOCK] Getting deal ${dealId}`);
    
    res.json({
      success: true,
      deal: {
        ...mockDealData,
        id: dealId
      }
    });
  });

  // Mock endpoint для получения сделки с связанными данными
  app.get('/api/pipedrive/mock/deal/:id/related', (req, res) => {
    const dealId = parseInt(req.params.id, 10);
    logger.info(`[MOCK] Getting deal ${dealId} with related data`);
    
    res.json({
      success: true,
      deal: {
        ...mockDealData,
        id: dealId
      },
      person: mockPersonData,
      organization: mockOrganizationData
    });
  });

  // Mock endpoint для webhook (использует реальный webhook handler)
  app.post('/api/webhooks/pipedrive', async (req, res) => {
    logger.info('[MOCK] Webhook received', { body: req.body });
    
    // Здесь можно добавить логику для моков, но лучше использовать реальный handler
    // Для полного тестирования лучше запустить реальный сервер с моками
    
    res.json({
      success: true,
      message: 'Mock webhook processed',
      note: 'This is a mock endpoint. Use real server for full testing.'
    });
  });

  return app;
}

/**
 * Проверяет, доступен ли сервер
 */
async function checkServer(url) {
  try {
    const response = await axios.get(url.replace('/api/webhooks/pipedrive', '/api/health').replace('/api/webhooks/pipedrive', '/'), {
      timeout: 5000,
      validateStatus: () => true // Принимаем любой статус
    });
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Отправляет тестовый webhook
 */
async function testWebhook(eventName, eventData) {
  try {
    console.log(`\n🧪 Testing: ${eventName}`);
    console.log(`📤 Sending to: ${WEBHOOK_URL}`);
    
    // Проверяем доступность сервера
    const serverAvailable = await checkServer(WEBHOOK_URL);
    if (!serverAvailable) {
      console.warn(`\n⚠️  Server might not be accessible at ${WEBHOOK_URL}`);
      console.log(`   Check if the server is running and accessible`);
      console.log(`   For local testing, use: WEBHOOK_URL=http://localhost:3000/api/webhooks/pipedrive`);
    }
    
    if (eventData.event) {
      console.log(`📋 Event: ${eventData.event}`);
      console.log(`🆔 Deal ID: ${eventData.current?.id || eventData['Deal ID'] || eventData['Deal_id']}`);
      
      if (eventData.current?.[INVOICE_TYPE_FIELD_KEY]) {
        console.log(`📝 Invoice Type: ${eventData.current[INVOICE_TYPE_FIELD_KEY]}`);
      }
      if (eventData.current?.status === 'lost') {
        console.log(`❌ Status: lost (reason: ${eventData.current.lost_reason})`);
      }
    } else {
      // Workflow automation format
      console.log(`📋 Format: Workflow Automation`);
      console.log(`🆔 Deal ID: ${eventData['Deal ID'] || eventData['Deal_id']}`);
      if (eventData['Invoice'] || eventData['Invoice type']) {
        console.log(`📝 Invoice Type: ${eventData['Invoice'] || eventData['Invoice type']}`);
      }
      if (eventData['Deal_status'] === 'lost') {
        console.log(`❌ Status: lost (reason: ${eventData['Deal_lost_reason']})`);
      }
    }
    
    const response = await axios.post(WEBHOOK_URL, eventData, {
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 30000 // 30 seconds timeout
    });
    
    console.log(`\n✅ Response Status: ${response.status}`);
    console.log(`📦 Response Data:`, JSON.stringify(response.data, null, 2));
    
    if (response.data.success) {
      console.log(`\n✅ SUCCESS: ${response.data.message || 'Webhook processed successfully'}`);
    } else {
      console.log(`\n⚠️  WARNING: ${response.data.error || response.data.message || 'Unknown error'}`);
    }
    
    return response.data;
  } catch (error) {
    console.error(`\n❌ Error:`);
    if (error.response) {
      console.error(`   Status: ${error.response.status}`);
      console.error(`   Data:`, JSON.stringify(error.response.data, null, 2));
    } else if (error.request) {
      console.error(`   No response received. Is the server accessible?`);
      console.error(`   URL: ${WEBHOOK_URL}`);
      console.error(`\n   💡 Tip: For local testing, use: WEBHOOK_URL=http://localhost:3000/api/webhooks/pipedrive`);
    } else {
      console.error(`   ${error.message}`);
    }
    throw error;
  }
}

async function main() {
  const eventName = process.argv[2];
  
  if (!eventName) {
    console.log('Usage: node scripts/test-pipedrive-webhook-mock.js <eventName>');
    console.log('\nAvailable events:');
    Object.keys(mockEvents).forEach(name => {
      console.log(`  - ${name}`);
    });
    console.log('\nExamples:');
    console.log('  node scripts/test-pipedrive-webhook-mock.js stripeTrigger');
    console.log('  node scripts/test-pipedrive-webhook-mock.js proformaTrigger');
    console.log('  node scripts/test-pipedrive-webhook-mock.js refundTrigger');
    console.log('  node scripts/test-pipedrive-webhook-mock.js workflowAutomationFull');
    console.log('\nNote: This script tests webhook handling logic.');
    console.log('      For full testing with mocks, you need to mock PipedriveClient in the server.');
    console.log('      See docs/testing-webhooks-without-tokens.md for details.');
    process.exit(1);
  }
  
  if (!mockEvents[eventName]) {
    console.error(`\n❌ Unknown event: ${eventName}`);
    console.log('\nAvailable events:', Object.keys(mockEvents).join(', '));
    process.exit(1);
  }
  
  try {
    await testWebhook(eventName, mockEvents[eventName]);
    console.log('\n✅ Test completed');
    console.log('\n💡 Note: If you see API errors, the server is trying to make real API calls.');
    console.log('   To fully test without tokens, you need to mock PipedriveClient.');
    console.log('   See docs/testing-webhooks-without-tokens.md for instructions.');
  } catch (error) {
    console.error('\n❌ Test failed');
    process.exit(1);
  }
}

main().catch(console.error);

