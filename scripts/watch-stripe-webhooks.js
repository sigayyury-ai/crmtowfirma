#!/usr/bin/env node

/**
 * Live tail скрипт для мониторинга Stripe webhook'ов в реальном времени
 * Фильтрует и подсвечивает строки, связанные со Stripe webhooks и автоматизациями
 * 
 * Использование:
 *   node scripts/watch-stripe-webhooks.js [--deal=1234] [--event=evt_...] [--session=cs_...] [--quiet]
 * 
 * Опции:
 *   --deal=ID        Фильтровать по deal ID
 *   --event=ID       Фильтровать по event ID
 *   --session=ID     Фильтровать по session ID
 *   --quiet          Показывать только ключевые события (без debug логов)
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { spawn } = require('child_process');
const path = require('path');

// Парсинг аргументов
const args = process.argv.slice(2);
const filters = {
  deal: args.find(arg => arg.startsWith('--deal='))?.split('=')[1],
  event: args.find(arg => arg.startsWith('--event='))?.split('=')[1],
  session: args.find(arg => arg.startsWith('--session='))?.split('=')[1],
  quiet: args.includes('--quiet')
};

// ANSI цвета для терминала
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m'
};

// Группировка событий по eventId
const eventGroups = new Map();
let webhookCount = 0;
let lastWebhookTime = null;

function formatTimestamp() {
  return new Date().toLocaleTimeString('ru-RU', { hour12: false });
}

function highlightText(text, color) {
  return `${color}${text}${colors.reset}`;
}

function extractField(line, fieldName) {
  // Ищем JSON поля: "fieldName":"value" или "fieldName":value
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

function matchesFilter(line) {
  if (filters.deal) {
    const dealId = extractField(line, 'dealId') || extractField(line, 'deal_id');
    if (dealId !== filters.deal) return false;
  }
  
  if (filters.event) {
    const eventId = extractField(line, 'eventId') || extractField(line, 'event_id');
    if (eventId && !eventId.includes(filters.event)) return false;
  }
  
  if (filters.session) {
    const sessionId = extractField(line, 'sessionId') || extractField(line, 'session_id');
    if (sessionId && !sessionId.includes(filters.session)) return false;
  }
  
  return true;
}

function shouldShowLine(line) {
  // В quiet режиме показываем только ключевые события
  if (filters.quiet) {
    const isKeyEvent = 
      line.includes('📥 Stripe webhook получен') ||
      line.includes('Stripe webhook signature verification failed') ||
      line.includes('Stripe webhook from Events cabinet ignored') ||
      line.includes('Checkout Session обработан') ||
      line.includes('Обработка Checkout Session') ||
      line.includes('Payment Intent обработан') ||
      line.includes('Уведомление об успешной оплате отправлено') ||
      line.includes('CRM status automation') ||
      line.includes('❌') ||
      line.includes('✅');
    
    if (!isKeyEvent) return false;
  }
  
  // Фильтруем по Stripe-связанным строкам
  const isStripeRelated = 
    line.includes('Stripe') ||
    line.includes('stripe') ||
    line.includes('webhook') ||
    line.includes('checkout') ||
    line.includes('session') ||
    line.includes('payment_intent') ||
    line.includes('charge') ||
    line.includes('refund') ||
    line.includes('invoice') ||
    line.includes('SendPulse') ||
    line.includes('CRM status') ||
    line.includes('dealId') ||
    line.includes('eventId') ||
    line.includes('sessionId');
  
  if (!isStripeRelated) return false;
  
  return matchesFilter(line);
}

function formatLine(line) {
  let formatted = line;
  
  // Извлекаем ключевые поля
  const eventId = extractField(line, 'eventId') || extractField(line, 'event_id') || extractField(line, 'eventId');
  const dealId = extractField(line, 'dealId') || extractField(line, 'deal_id');
  const sessionId = extractField(line, 'sessionId') || extractField(line, 'session_id');
  const eventType = extractField(line, 'eventType') || extractField(line, 'event_type') || extractField(line, 'type');
  
  // Подсветка по типам событий
  if (line.includes('📥 Stripe webhook получен')) {
    webhookCount++;
    lastWebhookTime = formatTimestamp();
    formatted = highlightText(`\n${'='.repeat(80)}`, colors.cyan);
    formatted += highlightText(`\n📥 WEBHOOK #${webhookCount} получен в ${lastWebhookTime}`, colors.bright + colors.cyan);
    if (eventId) formatted += highlightText(` | Event: ${eventId}`, colors.dim);
    if (eventType) formatted += highlightText(` | Type: ${eventType}`, colors.dim);
    if (dealId) formatted += highlightText(` | Deal: ${dealId}`, colors.dim);
    formatted += highlightText(`\n${'='.repeat(80)}`, colors.cyan);
    formatted += '\n' + line;
  } else if (line.includes('signature verification failed')) {
    formatted = highlightText('❌ SIGNATURE VERIFICATION FAILED', colors.red + colors.bright) + '\n' + line;
  } else if (line.includes('Events cabinet ignored')) {
    formatted = highlightText('⚠️  EVENTS CABINET IGNORED', colors.yellow + colors.bright) + '\n' + line;
  } else if (line.includes('resource_missing')) {
    formatted = highlightText('⚠️  RESOURCE MISSING', colors.yellow) + '\n' + line;
  } else if (line.includes('Checkout Session обработан') || line.includes('Payment Intent обработан')) {
    formatted = highlightText('✅ PROCESSED', colors.green) + ' ' + line;
  } else if (line.includes('Уведомление об успешной оплате отправлено')) {
    formatted = highlightText('📧 NOTIFICATION SENT', colors.green) + ' ' + line;
  } else if (line.includes('CRM status automation')) {
    formatted = highlightText('🔄 STATUS AUTOMATION', colors.blue) + ' ' + line;
  } else if (line.includes('❌')) {
    formatted = highlightText(line, colors.red);
  } else if (line.includes('✅')) {
    formatted = highlightText(line, colors.green);
  }
  
  // Подсветка ключевых полей в строке
  if (dealId) {
    formatted = formatted.replace(new RegExp(`(dealId|deal_id)\\s*[:=]\\s*${dealId}`, 'gi'), 
      highlightText(`$1:${dealId}`, colors.magenta));
  }
  if (eventId) {
    formatted = formatted.replace(new RegExp(`(eventId|event_id)\\s*[:=]\\s*${eventId}`, 'gi'),
      highlightText(`$1:${eventId}`, colors.cyan));
  }
  if (sessionId) {
    formatted = formatted.replace(new RegExp(`(sessionId|session_id)\\s*[:=]\\s*${sessionId}`, 'gi'),
      highlightText(`$1:${sessionId}`, colors.blue));
  }
  
  return formatted;
}

function printHeader() {
  console.log(highlightText('🔍 Мониторинг Stripe Webhooks в реальном времени', colors.bright + colors.cyan));
  console.log();
  console.log('📋 Отслеживаю:');
  console.log('  📥 Входящие webhook запросы');
  console.log('  🔐 Верификацию подписи');
  console.log('  💳 Обработку платежей (checkout.session.completed, payment_intent.succeeded)');
  console.log('  🔄 Автоматизацию статусов CRM');
  console.log('  📧 Отправку уведомлений');
  console.log('  ⚠️  Ошибки и предупреждения');
  
  if (filters.deal) {
    console.log(`\n🔍 Фильтр: Deal ID = ${highlightText(filters.deal, colors.magenta)}`);
  }
  if (filters.event) {
    console.log(`🔍 Фильтр: Event ID = ${highlightText(filters.event, colors.cyan)}`);
  }
  if (filters.session) {
    console.log(`🔍 Фильтр: Session ID = ${highlightText(filters.session, colors.blue)}`);
  }
  if (filters.quiet) {
    console.log(`🔍 Режим: ${highlightText('QUIET (только ключевые события)', colors.dim)}`);
  }
  
  console.log('\n' + '='.repeat(80));
  console.log('💡 Создайте платеж в Stripe или дождитесь webhook события\n');
  console.log('⏳ Ожидаю события...\n');
}

async function main() {
  printHeader();
  
  // Проверяем наличие необходимых переменных окружения
  if (!process.env.RENDER_SERVICE_ID) {
    console.error(highlightText('❌ Ошибка: RENDER_SERVICE_ID не установлен в .env', colors.red));
    console.error('   Добавьте RENDER_SERVICE_ID=... в ваш .env файл');
    process.exit(1);
  }
  
  // Запускаем tail логов через fetch-render-logs.js
  const scriptPath = path.resolve(__dirname, 'fetch-render-logs.js');
  const logsProcess = spawn('node', [scriptPath, '--tail'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: path.resolve(__dirname, '..'),
    env: process.env
  });
  
  let buffer = '';
  
  logsProcess.stdout.on('data', (data) => {
    buffer += data.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    
    for (const line of lines) {
      if (!line.trim()) continue;
      
      if (shouldShowLine(line)) {
        const formatted = formatLine(line);
        console.log(formatted);
      }
    }
  });
  
  logsProcess.stderr.on('data', (data) => {
    const error = data.toString();
    if (!error.includes('Warning') && !error.includes('Deprecation')) {
      console.error(highlightText('⚠️  Ошибка:', colors.yellow), error);
    }
  });
  
  logsProcess.on('error', (error) => {
    console.error(highlightText('❌ Ошибка запуска:', colors.red), error.message);
    console.error('\n💡 Убедитесь, что:');
    console.error('   - Настроены RENDER_API_KEY и RENDER_SERVICE_ID в .env');
    console.error('   - Установлен render-cli: pip3 install render-cli');
    process.exit(1);
  });
  
  logsProcess.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.log(`\n⚠️  Процесс завершился с кодом: ${code}`);
    }
  });
  
  // Обработка Ctrl+C
  process.on('SIGINT', () => {
    console.log('\n\n' + highlightText('👋 Остановка мониторинга...', colors.yellow));
    if (webhookCount > 0) {
      console.log(`\n📊 Статистика: обработано ${highlightText(webhookCount.toString(), colors.bright)} webhook(ов)`);
      if (lastWebhookTime) {
        console.log(`   Последний webhook: ${lastWebhookTime}`);
      }
    }
    logsProcess.kill();
    process.exit(0);
  });
}

main().catch(error => {
  console.error(highlightText('❌ Критическая ошибка:', colors.red), error);
  process.exit(1);
});





