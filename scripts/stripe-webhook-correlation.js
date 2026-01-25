#!/usr/bin/env node

/**
 * Корреляция событий Stripe и логов Render
 * Сравнивает события из Stripe API с логами обработки webhook'ов
 * 
 * Использование:
 *   node scripts/stripe-webhook-correlation.js [--since=60m] [--types=checkout.session.completed] [--log-lines=1000]
 * 
 * Опции:
 *   --since=TIME     Временной интервал для событий Stripe (например: 60m, 2h, 1d)
 *   --types=TYPES    Список типов событий через запятую
 *   --log-lines=N    Количество строк логов Render для анализа (по умолчанию: 1000)
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { execSync } = require('child_process');
const { getStripeClient } = require('../src/services/stripe/client');

// Парсинг аргументов
const args = process.argv.slice(2);
const options = {
  types: args.find(arg => arg.startsWith('--types='))?.split('=')[1]?.split(',').map(t => t.trim()),
  since: args.find(arg => arg.startsWith('--since='))?.split('=')[1] || '60m',
  logLines: parseInt(args.find(arg => arg.startsWith('--log-lines='))?.split('=')[1] || '1000', 10)
};

function parseSince(sinceStr) {
  if (!sinceStr) return null;
  
  const timestamp = parseInt(sinceStr, 10);
  if (!isNaN(timestamp) && timestamp > 0) {
    return timestamp;
  }
  
  const match = sinceStr.match(/^(\d+)([mhd])$/i);
  if (match) {
    const value = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();
    
    const now = Math.floor(Date.now() / 1000);
    const multipliers = {
      m: 60,
      h: 3600,
      d: 86400
    };
    
    return now - (value * multipliers[unit]);
  }
  
  return null;
}

function extractField(line, fieldName) {
  const patterns = [
    new RegExp(`"${fieldName}"\\s*:\\s*"([^"]+)"`, 'i'),
    new RegExp(`"${fieldName}"\\s*:\\s*([0-9]+)`, 'i'),
    new RegExp(`${fieldName}\\s*[:=]\\s*([a-zA-Z0-9_]+)`, 'i')
  ];
  
  for (const pattern of patterns) {
    const match = line.match(pattern);
    if (match) return match[1];
  }
  return null;
}

async function fetchStripeEvents() {
  console.log('📥 Получение событий из Stripe API...');
  
  const stripe = getStripeClient();
  const params = {
    limit: 100
  };
  
  if (options.types && options.types.length > 0) {
    params.types = options.types;
  }
  
  if (options.since) {
    const sinceTimestamp = parseSince(options.since);
    if (sinceTimestamp) {
      params.created = { gte: sinceTimestamp };
    }
  }
  
  const events = await stripe.events.list(params);
  console.log(`   ✅ Получено ${events.data.length} событий\n`);
  
  return events.data;
}

async function fetchRenderLogs() {
  console.log(`📋 Получение последних ${options.logLines} строк логов Render...`);
  
  try {
    const output = execSync(
      `node scripts/fetch-render-logs.js --lines=${options.logLines}`,
      { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
    );
    console.log(`   ✅ Логи получены\n`);
    return output;
  } catch (error) {
    console.error('   ❌ Ошибка получения логов:', error.message);
    throw error;
  }
}

function analyzeLogs(logs) {
  const lines = logs.split('\n');
  const logEvents = {
    byEventId: new Map(),
    bySessionId: new Map(),
    signatureFailed: new Set(),
    eventsCabinetIgnored: new Set(),
    resourceMissing: new Set()
  };
  
  for (const line of lines) {
    // Извлекаем eventId из логов
    const eventId = extractField(line, 'eventId') || extractField(line, 'event_id');
    const sessionId = extractField(line, 'sessionId') || extractField(line, 'session_id');
    
    if (eventId) {
      if (!logEvents.byEventId.has(eventId)) {
        logEvents.byEventId.set(eventId, {
          seen: false,
          processed: false,
          signatureFailed: false,
          ignored: false,
          resourceMissing: false,
          lines: []
        });
      }
      
      const eventLog = logEvents.byEventId.get(eventId);
      eventLog.seen = true;
      eventLog.lines.push(line.substring(0, 150));
      
      if (line.includes('signature verification failed')) {
        eventLog.signatureFailed = true;
        logEvents.signatureFailed.add(eventId);
      }
      if (line.includes('Events cabinet ignored')) {
        eventLog.ignored = true;
        logEvents.eventsCabinetIgnored.add(eventId);
      }
      if (line.includes('Checkout Session обработан') || line.includes('Payment Intent обработан')) {
        eventLog.processed = true;
      }
      if (line.includes('resource_missing')) {
        eventLog.resourceMissing = true;
        logEvents.resourceMissing.add(eventId);
      }
    }
    
    if (sessionId) {
      if (!logEvents.bySessionId.has(sessionId)) {
        logEvents.bySessionId.set(sessionId, []);
      }
      logEvents.bySessionId.get(sessionId).push(line.substring(0, 150));
    }
  }
  
  return logEvents;
}

function correlateEvents(stripeEvents, logEvents) {
  const correlation = {
    seenInStripe: [],
    seenInLogs: [],
    processed: [],
    signatureFailed: [],
    ignored: [],
    resourceMissing: [],
    notSeen: []
  };
  
  for (const event of stripeEvents) {
    const eventId = event.id;
    const eventLog = logEvents.byEventId.get(eventId);
    
    const correlationItem = {
      eventId: event.id,
      type: event.type,
      created: new Date(event.created * 1000).toISOString(),
      livemode: event.livemode,
      requestId: event.request?.id || 'N/A',
      pendingWebhooks: event.pending_webhooks || 0,
      seenInLogs: !!eventLog,
      processed: eventLog?.processed || false,
      signatureFailed: eventLog?.signatureFailed || false,
      ignored: eventLog?.ignored || false,
      resourceMissing: eventLog?.resourceMissing || false
    };
    
    correlation.seenInStripe.push(correlationItem);
    
    if (eventLog) {
      correlation.seenInLogs.push(correlationItem);
      
      if (correlationItem.processed) {
        correlation.processed.push(correlationItem);
      } else if (correlationItem.signatureFailed) {
        correlation.signatureFailed.push(correlationItem);
      } else if (correlationItem.ignored) {
        correlation.ignored.push(correlationItem);
      } else if (correlationItem.resourceMissing) {
        correlation.resourceMissing.push(correlationItem);
      } else {
        correlation.notSeen.push(correlationItem);
      }
    } else {
      correlation.notSeen.push(correlationItem);
    }
  }
  
  return correlation;
}

function printReport(correlation) {
  console.log('='.repeat(100));
  console.log('📊 КОРРЕЛЯЦИЯ СОБЫТИЙ STRIPE И ЛОГОВ RENDER');
  console.log('='.repeat(100));
  console.log();
  
  console.log(`📥 Событий в Stripe: ${correlation.seenInStripe.length}`);
  console.log(`📋 Событий в логах Render: ${correlation.seenInLogs.length}`);
  console.log(`✅ Успешно обработано: ${correlation.processed.length}`);
  console.log(`🔐 Signature verification failed: ${correlation.signatureFailed.length}`);
  console.log(`⚠️  Events cabinet ignored: ${correlation.ignored.length}`);
  console.log(`⚠️  Resource missing: ${correlation.resourceMissing.length}`);
  console.log(`❌ Не найдено в логах: ${correlation.notSeen.length}`);
  console.log();
  
  if (correlation.processed.length > 0) {
    console.log('✅ УСПЕШНО ОБРАБОТАННЫЕ:');
    correlation.processed.slice(0, 10).forEach(item => {
      console.log(`   ${item.eventId} | ${item.type} | ${item.created}`);
    });
    if (correlation.processed.length > 10) {
      console.log(`   ... и еще ${correlation.processed.length - 10}`);
    }
    console.log();
  }
  
  if (correlation.signatureFailed.length > 0) {
    console.log('🔐 SIGNATURE VERIFICATION FAILED:');
    correlation.signatureFailed.forEach(item => {
      console.log(`   ${item.eventId} | ${item.type} | ${item.created}`);
      console.log(`      Request ID: ${item.requestId}`);
    });
    console.log();
  }
  
  if (correlation.ignored.length > 0) {
    console.log('⚠️  EVENTS CABINET IGNORED:');
    correlation.ignored.forEach(item => {
      console.log(`   ${item.eventId} | ${item.type} | ${item.created}`);
    });
    console.log();
  }
  
  if (correlation.resourceMissing.length > 0) {
    console.log('⚠️  RESOURCE MISSING:');
    correlation.resourceMissing.forEach(item => {
      console.log(`   ${item.eventId} | ${item.type} | ${item.created}`);
    });
    console.log();
  }
  
  if (correlation.notSeen.length > 0) {
    console.log('❌ НЕ НАЙДЕНО В ЛОГАХ RENDER:');
    console.log('   (Webhook не пришел или не был обработан)');
    correlation.notSeen.slice(0, 10).forEach(item => {
      console.log(`   ${item.eventId} | ${item.type} | ${item.created} | Pending: ${item.pendingWebhooks}`);
    });
    if (correlation.notSeen.length > 10) {
      console.log(`   ... и еще ${correlation.notSeen.length - 10}`);
    }
    console.log();
    console.log('💡 Возможные причины:');
    console.log('   - Webhook еще не доставлен (проверьте pending_webhooks)');
    console.log('   - Webhook был отправлен на другой endpoint');
    console.log('   - Webhook был отправлен до начала периода анализа логов');
    console.log('   - Проблемы с сетью или Render сервисом');
    console.log();
  }
  
  // Сводная таблица
  if (correlation.seenInStripe.length > 0) {
    console.log('='.repeat(100));
    console.log('СВОДНАЯ ТАБЛИЦА');
    console.log('='.repeat(100));
    console.log();
    console.log(
      'Event ID'.padEnd(30) + 
      'Type'.padEnd(35) + 
      'Created'.padEnd(25) + 
      'Status'.padEnd(20)
    );
    console.log('-'.repeat(100));
    
    correlation.seenInStripe.slice(0, 20).forEach(item => {
      const eventIdShort = item.eventId.length > 28 ? item.eventId.substring(0, 25) + '...' : item.eventId;
      const typeShort = item.type.length > 33 ? item.type.substring(0, 30) + '...' : item.type;
      
      let status = '❌ Not seen';
      if (item.processed) status = '✅ Processed';
      else if (item.signatureFailed) status = '🔐 Signature failed';
      else if (item.ignored) status = '⚠️  Ignored';
      else if (item.resourceMissing) status = '⚠️  Resource missing';
      else if (item.seenInLogs) status = '📋 Seen (not processed)';
      
      console.log(
        eventIdShort.padEnd(30) + 
        typeShort.padEnd(35) + 
        item.created.substring(0, 19).padEnd(25) + 
        status.padEnd(20)
      );
    });
    
    if (correlation.seenInStripe.length > 20) {
      console.log(`\n... и еще ${correlation.seenInStripe.length - 20} событий`);
    }
  }
  
  console.log();
  console.log('='.repeat(100));
}

async function main() {
  try {
    console.log('🔍 Корреляция событий Stripe и логов Render\n');
    
    if (options.types) {
      console.log(`📋 Типы событий: ${options.types.join(', ')}`);
    }
    console.log(`⏰ Период: ${options.since}`);
    console.log(`📊 Строк логов: ${options.logLines}\n`);
    
    const [stripeEvents, renderLogs] = await Promise.all([
      fetchStripeEvents(),
      fetchRenderLogs()
    ]);
    
    console.log('🔍 Анализ логов...\n');
    const logEvents = analyzeLogs(renderLogs);
    
    console.log('🔗 Корреляция событий...\n');
    const correlation = correlateEvents(stripeEvents, logEvents);
    
    printReport(correlation);
    
  } catch (error) {
    console.error('\n❌ Критическая ошибка:', error.message);
    process.exit(1);
  }
}

main();





