#!/usr/bin/env node

/**
 * Скрипт для мониторинга входящих Pipedrive webhooks в реальном времени
 * 
 * Использование:
 *   node scripts/monitor-webhooks.js
 * 
 * Показывает все логи, связанные с webhooks от Pipedrive
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { spawn } = require('child_process');
const path = require('path');

console.log('🔍 Мониторинг Pipedrive Webhooks...\n');
console.log('Ожидаю входящие webhooks...\n');
console.log('Создайте сделку в Pipedrive, чтобы увидеть webhook\n');
console.log('='.repeat(80));

// Если логи пишутся в файл, мониторим файл
// Иначе мониторим stdout процесса (если запущен через PM2 или другой менеджер)

// Вариант 1: Мониторинг через PM2 logs (если используется PM2)
const usePm2 = process.argv.includes('--pm2');

if (usePm2) {
  console.log('📋 Используется PM2 для мониторинга логов\n');
  const pm2 = spawn('pm2', ['logs', '--lines', '100', '--nostream'], {
    stdio: 'inherit',
    shell: true
  });
  
  pm2.on('error', (error) => {
    console.error('❌ Ошибка запуска PM2:', error.message);
    console.log('\n💡 Попробуйте запустить без --pm2 флага');
    process.exit(1);
  });
} else {
  // Вариант 2: Мониторинг через логи приложения
  // Если логи пишутся в файлы, можно использовать tail -f
  console.log('📋 Мониторинг через логи приложения\n');
  console.log('💡 Для просмотра логов Render используйте:');
  console.log('   npm run logs:render:tail\n');
  console.log('💡 Или проверьте логи в консоли, где запущен сервер\n');
  
  // Показываем последние логи, связанные с webhooks
  const { exec } = require('child_process');
  
  // Проверяем, есть ли файлы логов
  const logFiles = [
    path.join(__dirname, '../logs/app.log'),
    path.join(__dirname, '../logs/error.log'),
    path.join(__dirname, '../logs/combined.log')
  ];
  
  console.log('📊 Последние webhook события:\n');
  
  // Показываем последние 20 строк с webhook
  exec('tail -n 50 logs/*.log 2>/dev/null | grep -i "webhook\\|pipedrive" | tail -20 || echo "Логи не найдены"', (error, stdout, stderr) => {
    if (stdout) {
      console.log(stdout);
    }
    if (stderr && !stderr.includes('No such file')) {
      console.error(stderr);
    }
    
    console.log('\n' + '='.repeat(80));
    console.log('⏳ Ожидаю новый webhook...');
    console.log('💡 Создайте сделку в Pipedrive сейчас\n');
    
    // Если есть доступ к логам через файлы, мониторим их
    const fs = require('fs');
    let foundLogFile = null;
    
    for (const logFile of logFiles) {
      if (fs.existsSync(logFile)) {
        foundLogFile = logFile;
        break;
      }
    }
    
    if (foundLogFile) {
      console.log(`📁 Мониторинг файла: ${foundLogFile}\n`);
      const tail = spawn('tail', ['-f', foundLogFile], {
        stdio: 'inherit'
      });
      
      tail.on('error', (error) => {
        console.error('❌ Ошибка мониторинга:', error.message);
      });
      
      process.on('SIGINT', () => {
        console.log('\n\n👋 Остановка мониторинга...');
        tail.kill();
        process.exit(0);
      });
    } else {
      console.log('⚠️  Файлы логов не найдены');
      console.log('💡 Убедитесь, что сервер запущен и логи пишутся\n');
      console.log('💡 Или используйте: npm run logs:render:tail\n');
    }
  });
}

process.on('SIGINT', () => {
  console.log('\n\n👋 Остановка мониторинга...');
  process.exit(0);
});

