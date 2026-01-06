#!/usr/bin/env node

/**
 * Простой скрипт для мониторинга webhooks через Render логи
 * 
 * Использование:
 *   node scripts/watch-webhook.js
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { spawn } = require('child_process');

console.log('🔍 Мониторинг Pipedrive Webhooks через Render...\n');
console.log('Ожидаю входящие webhooks...\n');
console.log('💡 Создайте сделку в Pipedrive сейчас!\n');
console.log('='.repeat(80));
console.log('');

// Используем существующий скрипт для получения логов Render
const logsProcess = spawn('npm', ['run', 'logs:render:tail'], {
  stdio: 'inherit',
  shell: true,
  cwd: __dirname + '/..'
});

logsProcess.on('error', (error) => {
  console.error('❌ Ошибка запуска мониторинга:', error.message);
  console.log('\n💡 Убедитесь, что настроены переменные окружения для Render API');
  process.exit(1);
});

logsProcess.on('exit', (code) => {
  if (code !== 0 && code !== null) {
    console.log(`\n⚠️  Процесс завершился с кодом: ${code}`);
  }
});

process.on('SIGINT', () => {
  console.log('\n\n👋 Остановка мониторинга...');
  logsProcess.kill();
  process.exit(0);
});

