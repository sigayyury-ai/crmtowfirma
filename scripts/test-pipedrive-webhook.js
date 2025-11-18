#!/usr/bin/env node

/**
 * Тестовый скрипт для отправки mock Pipedrive webhook событий на локальный сервер.
 * Позволяет тестировать обработку webhook'ов без реальных изменений в Pipedrive.
 *
 * Использование:
 *   node scripts/test-pipedrive-webhook.js stripeTrigger
 *   node scripts/test-pipedrive-webhook.js proformaTrigger
 *   node scripts/test-pipedrive-webhook.js refundTrigger
 *   node scripts/test-pipedrive-webhook.js deleteTrigger
 *
 * Можно указать другой URL через переменную окружения:
 *   WEBHOOK_URL=http://localhost:3000/api/webhooks/pipedrive \
 *   node scripts/test-pipedrive-webhook.js stripeTrigger
 */

const axios = require('axios');

const WEBHOOK_URL = process.env.WEBHOOK_URL || 'https://invoices.comoon.io/api/webhooks/pipedrive';
const INVOICE_TYPE_FIELD_KEY = process.env.PIPEDRIVE_INVOICE_TYPE_FIELD_KEY || 'ad67729ecfe0345287b71a3b00910e8ba5b3b496';

const testEvents = {
  stripeTrigger: {
    event: 'updated.deal',
    current: {
      id: 1600,
      title: 'Test Deal - Stripe',
      status: 'open',
      [INVOICE_TYPE_FIELD_KEY]: '75' // Stripe trigger
    },
    previous: {
      id: 1600,
      title: 'Test Deal - Stripe',
      status: 'open',
      [INVOICE_TYPE_FIELD_KEY]: null
    }
  },
  proformaTrigger: {
    event: 'updated.deal',
    current: {
      id: 1600,
      title: 'Test Deal - Proforma',
      status: 'open',
      [INVOICE_TYPE_FIELD_KEY]: '70' // Proforma trigger
    },
    previous: {
      id: 1600,
      title: 'Test Deal - Proforma',
      status: 'open',
      [INVOICE_TYPE_FIELD_KEY]: null
    }
  },
  refundTrigger: {
    event: 'updated.deal',
    current: {
      id: 1600,
      title: 'Test Deal - Refund',
      status: 'lost',
      lost_reason: 'Refund'
    },
    previous: {
      id: 1600,
      title: 'Test Deal - Refund',
      status: 'open',
      lost_reason: null
    }
  },
  deleteTrigger: {
    event: 'updated.deal',
    current: {
      id: 1600,
      title: 'Test Deal - Delete',
      status: 'open',
      [INVOICE_TYPE_FIELD_KEY]: '74' // Delete trigger
    },
    previous: {
      id: 1600,
      title: 'Test Deal - Delete',
      status: 'open',
      [INVOICE_TYPE_FIELD_KEY]: '70' // Was Proforma
    }
  }
};

async function testWebhook(eventName, eventData) {
  try {
    console.log(`\n🧪 Testing: ${eventName}`);
    console.log(`📤 Sending to: ${WEBHOOK_URL}`);
    console.log(`📋 Event: ${eventData.event}`);
    console.log(`🆔 Deal ID: ${eventData.current.id}`);
    
    if (eventData.current[INVOICE_TYPE_FIELD_KEY]) {
      console.log(`📝 Invoice Type: ${eventData.current[INVOICE_TYPE_FIELD_KEY]}`);
    }
    if (eventData.current.status === 'lost') {
      console.log(`❌ Status: lost (reason: ${eventData.current.lost_reason})`);
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
      console.error(`   No response received. Is the server running?`);
      console.error(`   URL: ${WEBHOOK_URL}`);
    } else {
      console.error(`   ${error.message}`);
    }
    throw error;
  }
}

async function main() {
  const eventName = process.argv[2];
  
  if (!eventName) {
    console.log('Usage: node scripts/test-pipedrive-webhook.js <eventName>');
    console.log('\nAvailable events:');
    Object.keys(testEvents).forEach(name => {
      console.log(`  - ${name}`);
    });
    console.log('\nExamples:');
    console.log('  node scripts/test-pipedrive-webhook.js stripeTrigger');
    console.log('  node scripts/test-pipedrive-webhook.js proformaTrigger');
    console.log('  node scripts/test-pipedrive-webhook.js refundTrigger');
    console.log('  node scripts/test-pipedrive-webhook.js deleteTrigger');
    process.exit(1);
  }
  
  if (!testEvents[eventName]) {
    console.error(`\n❌ Unknown event: ${eventName}`);
    console.log('\nAvailable events:', Object.keys(testEvents).join(', '));
    process.exit(1);
  }
  
  try {
    await testWebhook(eventName, testEvents[eventName]);
    console.log('\n✅ Test completed');
  } catch (error) {
    console.error('\n❌ Test failed');
    process.exit(1);
  }
}

main().catch(console.error);

