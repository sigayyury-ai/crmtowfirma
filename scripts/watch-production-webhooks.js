#!/usr/bin/env node

/**
 * Мониторинг webhooks от Pipedrive в продакшене (Render)
 * Показывает только важные события, связанные с webhooks
 * 
 * Использование:
 *   node scripts/watch-production-webhooks.js
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { spawn } = require('child_process');

console.log('🔍 Мониторинг Pipedrive Webhooks в продакшене...\n');
console.log('='.repeat(80));
console.log('📋 Отслеживаю:');
console.log('  📥 Входящие webhook запросы');
console.log('  🔍 Обработку webhook данных');
console.log('  ✅ Создание Stripe сессий');
console.log('  📊 Обновления статусов');
console.log('  ⚠️  Ошибки и предупреждения');
console.log('='.repeat(80));
console.log('\n💡 Создайте сделку в Pipedrive сейчас!\n');
console.log('⏳ Ожидаю webhook...\n');

// Запускаем мониторинг логов Render
const logsProcess = spawn('npm', ['run', 'logs:render:tail'], {
  stdio: ['ignore', 'pipe', 'pipe'],
  shell: true,
  cwd: __dirname + '/..'
});

let buffer = '';
let lastWebhookTime = null;
let webhookCount = 0;

// Обработка stdout
logsProcess.stdout.on('data', (data) => {
  buffer += data.toString();
  const lines = buffer.split('\n');
  buffer = lines.pop() || ''; // Оставляем неполную строку в буфере

  for (const line of lines) {
    if (!line.trim()) continue;

    // Фильтруем только важные события
    const isWebhook = /📥|webhook|Webhook|Pipedrive/i.test(line);
    const isDeal = /deal\.|Deal|сделк/i.test(line);
    const isStripe = /Stripe|stripe|checkout|session/i.test(line);
    const isError = /❌|error|Error|⚠️|warn/i.test(line);
    const isSuccess = /✅|success|Success|created|создан/i.test(line);
    const isImportant = isWebhook || isDeal || isStripe || isError || isSuccess;

    if (isImportant) {
      // Определяем время webhook
      const webhookMatch = line.match(/📥.*Webhook|webhook.*получен/i);
      if (webhookMatch) {
        webhookCount++;
        lastWebhookTime = new Date().toLocaleTimeString();
        console.log('\n' + '='.repeat(80));
        console.log(`📥 WEBHOOK #${webhookCount} получен в ${lastWebhookTime}`);
        console.log('='.repeat(80));
      }

      // Форматируем вывод
      let formattedLine = line;
      
      // Выделяем важные части
      if (isError) {
        formattedLine = `❌ ${formattedLine}`;
      } else if (isSuccess) {
        formattedLine = `✅ ${formattedLine}`;
      } else if (isWebhook) {
        formattedLine = `📥 ${formattedLine}`;
      } else if (isStripe) {
        formattedLine = `💳 ${formattedLine}`;
      } else if (isDeal) {
        formattedLine = `📊 ${formattedLine}`;
      }

      console.log(formattedLine);
    }
  }
});

// Обработка stderr
logsProcess.stderr.on('data', (data) => {
  const error = data.toString();
  if (!error.includes('Warning') && !error.includes('Deprecation')) {
    console.error('⚠️  Ошибка:', error);
  }
});

logsProcess.on('error', (error) => {
  console.error('❌ Ошибка запуска мониторинга:', error.message);
  console.error('\n💡 Убедитесь, что:');
  console.error('   - Настроены RENDER_API_KEY и RENDER_SERVICE_ID в .env');
  console.error('   - Установлен render-cli или настроен bash скрипт');
  process.exit(1);
});

logsProcess.on('exit', (code) => {
  if (code !== 0 && code !== null) {
    console.log(`\n⚠️  Процесс завершился с кодом: ${code}`);
  } else {
    console.log('\n👋 Мониторинг остановлен');
  }
});

// Обработка Ctrl+C
process.on('SIGINT', () => {
  console.log('\n\n👋 Остановка мониторинга...');
  if (webhookCount > 0) {
    console.log(`\n📊 Статистика: обработано ${webhookCount} webhook(ов)`);
  }
  logsProcess.kill();
  process.exit(0);
});

// Показываем подсказку каждые 30 секунд
setInterval(() => {
  if (lastWebhookTime) {
    const timeSinceLastWebhook = Math.floor((Date.now() - new Date(lastWebhookTime).getTime()) / 1000);
    if (timeSinceLastWebhook > 30) {
      console.log(`\n⏳ Последний webhook был ${timeSinceLastWebhook} секунд назад...`);
    }
  }
}, 30000);

