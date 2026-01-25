#!/usr/bin/env node

/**
 * Получение списка последних событий из Stripe API (без Dashboard)
 * 
 * Использование:
 *   node scripts/stripe-list-events.js [--types=checkout.session.completed,payment_intent.succeeded] [--limit=50] [--since=60m]
 * 
 * Опции:
 *   --types=TYPES    Список типов событий через запятую (по умолчанию: все типы)
 *   --limit=N        Максимальное количество событий (по умолчанию: 50)
 *   --since=TIME     Временной интервал (например: 60m, 2h, 1d) или Unix timestamp
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { getStripeClient } = require('../src/services/stripe/client');

// Парсинг аргументов
const args = process.argv.slice(2);
const options = {
  types: args.find(arg => arg.startsWith('--types='))?.split('=')[1]?.split(',').map(t => t.trim()),
  limit: parseInt(args.find(arg => arg.startsWith('--limit='))?.split('=')[1] || '50', 10),
  since: args.find(arg => arg.startsWith('--since='))?.split('=')[1]
};

function parseSince(sinceStr) {
  if (!sinceStr) return null;
  
  // Если это число, считаем это Unix timestamp
  const timestamp = parseInt(sinceStr, 10);
  if (!isNaN(timestamp) && timestamp > 0) {
    return timestamp;
  }
  
  // Парсим строки вида "60m", "2h", "1d"
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

function formatEvent(event) {
  const created = new Date(event.created * 1000).toISOString();
  const livemode = event.livemode ? 'LIVE' : 'TEST';
  const requestId = event.request?.id || 'N/A';
  const pendingWebhooks = event.pending_webhooks || 0;
  
  // Извлекаем deal_id и session_id из metadata если есть
  const dataObject = event.data?.object || {};
  const metadata = dataObject.metadata || {};
  const dealId = metadata.deal_id || metadata.dealId || 'N/A';
  const sessionId = dataObject.id?.startsWith('cs_') ? dataObject.id : 
                    metadata.session_id || metadata.sessionId || 'N/A';
  
  return {
    id: event.id,
    type: event.type,
    created,
    livemode,
    requestId,
    pendingWebhooks,
    dealId,
    sessionId
  };
}

async function main() {
  try {
    console.log('🔍 Получение событий из Stripe API...\n');
    
    const stripe = getStripeClient();
    
    const params = {
      limit: Math.min(Math.max(options.limit, 1), 100) // Ограничиваем от 1 до 100
    };
    
    if (options.types && options.types.length > 0) {
      params.types = options.types;
      console.log(`📋 Типы событий: ${options.types.join(', ')}`);
    }
    
    if (options.since) {
      const sinceTimestamp = parseSince(options.since);
      if (sinceTimestamp) {
        params.created = { gte: sinceTimestamp };
        const sinceDate = new Date(sinceTimestamp * 1000).toISOString();
        console.log(`⏰ События с: ${sinceDate}`);
      } else {
        console.warn(`⚠️  Не удалось распарсить --since=${options.since}, игнорирую`);
      }
    }
    
    console.log(`📊 Лимит: ${params.limit} событий\n`);
    
    const events = await stripe.events.list(params);
    
    if (events.data.length === 0) {
      console.log('📭 События не найдены');
      if (options.types && options.types.length > 0) {
        console.log('\n💡 Попробуйте:');
        console.log('   - Убрать фильтр --types для просмотра всех событий');
        console.log('   - Увеличить --limit');
        console.log('   - Расширить --since (например, --since=7d)');
      }
      return;
    }
    
    console.log(`✅ Найдено событий: ${events.data.length}\n`);
    console.log('='.repeat(100));
    console.log('СОБЫТИЯ STRIPE');
    console.log('='.repeat(100));
    console.log();
    
    // Форматируем вывод в таблицу
    const formattedEvents = events.data.map(formatEvent);
    
    // Заголовок таблицы
    console.log(
      'Event ID'.padEnd(30) + 
      'Type'.padEnd(35) + 
      'Created'.padEnd(25) + 
      'Mode'.padEnd(8) + 
      'Deal'.padEnd(10) + 
      'Session'.padEnd(20)
    );
    console.log('-'.repeat(100));
    
    formattedEvents.forEach(event => {
      const eventIdShort = event.id.length > 28 ? event.id.substring(0, 25) + '...' : event.id;
      const typeShort = event.type.length > 33 ? event.type.substring(0, 30) + '...' : event.type;
      const dealDisplay = event.dealId !== 'N/A' ? `#${event.dealId}` : 'N/A';
      const sessionDisplay = event.sessionId !== 'N/A' && event.sessionId.startsWith('cs_') 
        ? event.sessionId.substring(0, 17) + '...' 
        : event.sessionId !== 'N/A' ? event.sessionId.substring(0, 17) + '...' : 'N/A';
      
      console.log(
        eventIdShort.padEnd(30) + 
        typeShort.padEnd(35) + 
        event.created.substring(0, 19).padEnd(25) + 
        event.livemode.padEnd(8) + 
        dealDisplay.padEnd(10) + 
        sessionDisplay.padEnd(20)
      );
    });
    
    console.log();
    console.log('='.repeat(100));
    
    // Дополнительная информация
    if (formattedEvents.some(e => e.pendingWebhooks > 0)) {
      console.log('\n⚠️  События с pending webhooks:');
      formattedEvents
        .filter(e => e.pendingWebhooks > 0)
        .forEach(e => {
          console.log(`   ${e.id} (${e.type}): ${e.pendingWebhooks} pending`);
        });
    }
    
    // Статистика по типам
    const typeStats = {};
    formattedEvents.forEach(e => {
      typeStats[e.type] = (typeStats[e.type] || 0) + 1;
    });
    
    if (Object.keys(typeStats).length > 1) {
      console.log('\n📊 Статистика по типам:');
      Object.entries(typeStats)
        .sort((a, b) => b[1] - a[1])
        .forEach(([type, count]) => {
          console.log(`   ${type}: ${count}`);
        });
    }
    
    console.log('\n💡 Для детального просмотра события используйте:');
    console.log(`   node scripts/stripe-list-events.js --types=${formattedEvents[0].type} --limit=1`);
    
  } catch (error) {
    console.error('❌ Ошибка получения событий:', error.message);
    
    if (error.message.includes('STRIPE_API_KEY')) {
      console.error('\n💡 Убедитесь, что STRIPE_API_KEY установлен в .env файле');
    } else if (error.message.includes('401') || error.message.includes('unauthorized')) {
      console.error('\n💡 Проверьте правильность STRIPE_API_KEY в .env');
    } else {
      console.error('\n💡 Проверьте:');
      console.error('   - Подключение к интернету');
      console.error('   - Правильность STRIPE_API_KEY');
      console.error('   - Формат параметров командной строки');
    }
    
    process.exit(1);
  }
}

main();





