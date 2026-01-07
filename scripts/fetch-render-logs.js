#!/usr/bin/env node

/**
 * Скрипт для получения логов с продакшен сервера на Render
 * Использует только Render CLI для получения логов
 * 
 * Использование:
 *   node scripts/fetch-render-logs.js [options]
 * 
 * Опции:
 *   --tail          Стримить логи в реальном времени (как tail -f)
 *   --lines N       Количество последних строк логов (по умолчанию: 200)
 *   --service-id ID  ID сервиса Render (переопределяет RENDER_SERVICE_ID из .env)
 *   --output FILE   Сохранить логи в файл
 */

require('dotenv').config();
const { exec, spawn } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const os = require('os');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Читаем токен напрямую из .env файла
function getRenderApiKey() {
  const envPath = path.resolve(__dirname, '../.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    const match = envContent.match(/^RENDER_API_KEY\s*=\s*(.+)$/m);
    if (match) {
      return match[1].trim().replace(/^["']|["']$/g, '');
    }
  }
  return process.env.RENDER_API_KEY;
}

const RENDER_API_KEY = getRenderApiKey();
const RENDER_SERVICE_ID = process.env.RENDER_SERVICE_ID;

// Парсинг аргументов командной строки
const args = process.argv.slice(2);
const options = {
  tail: args.includes('--tail'),
  lines: parseInt(args.find(arg => arg.startsWith('--lines='))?.split('=')[1] || '200'),
  serviceId: args.find(arg => arg.startsWith('--service-id='))?.split('=')[1] || RENDER_SERVICE_ID,
  output: args.find(arg => arg.startsWith('--output='))?.split('=')[1] || null
};

// Проверка обязательных параметров
if (!RENDER_API_KEY) {
  console.error('❌ Ошибка: RENDER_API_KEY не установлен в .env файле');
  console.error('   Добавьте RENDER_API_KEY=rnd_... в ваш .env файл');
  process.exit(1);
}

if (!options.serviceId) {
  console.error('❌ Ошибка: RENDER_SERVICE_ID не установлен');
  console.error('   Установите RENDER_SERVICE_ID в .env или используйте --service-id=ID');
  process.exit(1);
}

/**
 * Найти путь к render CLI
 */
function findRenderCli() {
  const paths = [
    '/opt/homebrew/bin/render',
    '/usr/local/bin/render',
    `${os.homedir()}/.local/bin/render`,
    `${os.homedir()}/Library/Python/3.9/bin/render`,
    `${os.homedir()}/Library/Python/3.10/bin/render`,
    `${os.homedir()}/Library/Python/3.11/bin/render`,
    `${os.homedir()}/Library/Python/3.12/bin/render`
  ];

  for (const cliPath of paths) {
    try {
      execSync(`${cliPath} --version 2>&1`, { stdio: 'pipe', timeout: 5000 });
      return cliPath;
    } catch (e) {
      // Пробуем следующий путь
    }
  }
  
  // Последняя попытка - через which
  try {
    const whichResult = execSync('which render 2>&1', { stdio: 'pipe', timeout: 5000 });
    const foundPath = whichResult.toString().trim();
    if (foundPath && !foundPath.includes('node_modules')) {
      return foundPath;
    }
  } catch (e) {
    // which не нашел
  }
  
  return null;
}

/**
 * Получить логи сервиса через render CLI
 */
async function fetchLogs(serviceId, lines = 200) {
  const cliPath = findRenderCli();
  if (!cliPath) {
    throw new Error('render CLI не найден. Установите его: pip3 install render-cli');
  }

  // Читаем токен напрямую из .env файла (как в рабочем примере)
  const envPath = path.resolve(__dirname, '../.env');
  const envContent = fs.readFileSync(envPath, 'utf8');
  const match = envContent.match(/^RENDER_API_KEY\s*=\s*(.+)$/m);
  const token = match ? match[1].trim().replace(/^["']|["']$/g, '') : RENDER_API_KEY;
  
  // render-cli может использовать RENDER_TOKEN или RENDER_API_KEY
  // Передаем оба для совместимости
  const env = {
    ...process.env,
    RENDER_TOKEN: token,
    RENDER_API_KEY: token // Некоторые версии render-cli используют RENDER_API_KEY
  };

  // Логируем для отладки (только первые несколько символов токена)
  const tokenPreview = token ? `${token.substring(0, 10)}...` : 'не найден';
  console.log(`🔑 Используется токен: ${tokenPreview}`);

  try {
    const result = execSync(
      `"${cliPath}" logs --resources ${serviceId} --limit ${lines} --output text`,
      { 
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024, // 10MB
        stdio: ['ignore', 'pipe', 'pipe'],
        env: env
      }
    );
    return result;
  } catch (error) {
    const errorOutput = error.stderr ? error.stderr.toString() : error.stdout ? error.stdout.toString() : error.message;
    
    // Проверяем специфичные ошибки авторизации
    if (errorOutput.includes('unauthorized') || errorOutput.includes('401') || errorOutput.includes('authentication')) {
      throw new Error(`Ошибка авторизации Render API. Проверьте RENDER_API_KEY в .env файле. Ошибка: ${errorOutput}`);
    }
    
    if (errorOutput.includes('not found') || errorOutput.includes('404')) {
      throw new Error(`Сервис не найден. Проверьте RENDER_SERVICE_ID. Ошибка: ${errorOutput}`);
    }
    
    throw new Error(errorOutput || error.message);
  }
}

/**
 * Стримить логи в реальном времени через render CLI
 */
async function streamLogs(serviceId) {
  console.log(`📡 Стриминг логов для сервиса ${serviceId}...`);
  console.log('   (Нажмите Ctrl+C для остановки)\n');

  const cliPath = findRenderCli();
  if (!cliPath) {
    console.error('❌ render CLI не найден. Установите его: pip3 install render-cli');
    process.exit(1);
  }

  // Читаем токен напрямую из .env файла для надежности
  const envPath = path.resolve(__dirname, '../.env');
  let token = String(RENDER_API_KEY).trim().replace(/^["']|["']$/g, '');
  
  // Если токен не найден в переменной окружения, читаем из .env
  if (!token && fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    const match = envContent.match(/^RENDER_API_KEY\s*=\s*(.+)$/m);
    if (match) {
      token = match[1].trim().replace(/^["']|["']$/g, '');
    }
  }
  
  if (!token) {
    throw new Error('RENDER_API_KEY не найден. Установите его в .env файле.');
  }
  
  const env = { 
    ...process.env, 
    RENDER_TOKEN: token
  };
  
  const child = spawn(cliPath, ['logs', '--resources', serviceId, '--tail', '--output', 'text'], {
    env,
    stdio: 'inherit',
    shell: false
  });

  // Обработка Ctrl+C
  process.on('SIGINT', () => {
    console.log('\n\n👋 Остановка стриминга логов...');
    child.kill();
    process.exit(0);
  });

  child.on('error', (error) => {
    console.error('❌ Ошибка при запуске render CLI:', error.message);
    process.exit(1);
  });

  child.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.error(`\n❌ render CLI завершился с кодом ${code}`);
      process.exit(code);
    }
  });
}

/**
 * Форматировать и вывести логи
 */
function formatAndOutputLogs(logs, outputFile = null) {
  if (!logs || (typeof logs === 'string' && logs.trim() === '')) {
    console.log('📭 Логи не найдены');
    return;
  }

  const output = typeof logs === 'string' ? logs : JSON.stringify(logs, null, 2);

  if (outputFile) {
    const fs = require('fs');
    fs.writeFileSync(outputFile, output, 'utf8');
    console.log(`✅ Логи сохранены в файл: ${outputFile}`);
  } else {
    console.log('\n' + '='.repeat(80));
    console.log('📋 ЛОГИ СЕРВИСА');
    console.log('='.repeat(80) + '\n');
    process.stdout.write(output);
    if (!output.endsWith('\n')) {
      console.log('');
    }
    console.log('='.repeat(80));
  }
}

// Главная функция
async function main() {
  console.log('🚀 Render Logs Fetcher\n');
  console.log(`   Service ID: ${options.serviceId}`);
  console.log(`   Mode: ${options.tail ? 'Streaming (tail)' : 'One-time fetch'}`);
  console.log(`   Lines: ${options.lines}\n`);

  try {
    if (options.tail) {
      await streamLogs(options.serviceId);
    } else {
      const logs = await fetchLogs(options.serviceId, options.lines);
      formatAndOutputLogs(logs, options.output);
    }
  } catch (error) {
    console.error('\n❌ Не удалось получить логи:', error.message);
    
    // Детальная диагностика ошибок
    if (error.message.includes('не найден') || error.message.includes('render CLI')) {
      console.error('\n💡 Установите render CLI:');
      console.error('   pip3 install render-cli --user');
      console.error('   или');
      console.error('   pip3 install render-cli --break-system-packages');
      console.error('\n   После установки проверьте:');
      console.error('   render-cli --version');
      console.error('   или');
      console.error('   ~/.local/bin/render-cli --version');
    } else if (error.message.includes('401') || error.message.includes('unauthorized') || error.message.includes('авторизации')) {
      console.error('\n💡 Проблема с авторизацией:');
      console.error('   1. Проверьте правильность RENDER_API_KEY в .env файле');
      console.error('   2. Убедитесь, что ключ не истек (создайте новый в Render Dashboard)');
      console.error('   3. Проверьте формат ключа (должен начинаться с rnd_)');
      console.error('\n   Render Dashboard → Account Settings → API Keys');
    } else if (error.message.includes('404') || error.message.includes('not found') || error.message.includes('не найден')) {
      console.error('\n💡 Сервис не найден:');
      console.error('   1. Проверьте правильность RENDER_SERVICE_ID в .env');
      console.error('   2. Или используйте --service-id=ID для указания сервиса');
      console.error('   3. Убедитесь, что API ключ имеет доступ к сервису');
      console.error('\n   Render Dashboard → Ваш сервис → Settings → Service ID');
    } else {
      console.error('\n💡 Общие рекомендации:');
      console.error('   1. Проверьте наличие RENDER_API_KEY и RENDER_SERVICE_ID в .env');
      console.error('   2. Убедитесь, что render-cli установлен и доступен');
      console.error('   3. Проверьте подключение к интернету');
      console.error('   4. См. полную документацию: docs/render-logs-setup.md');
    }
    process.exit(1);
  }
}

// Обработка справки
if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Использование: node scripts/fetch-render-logs.js [options]

Опции:
  --tail              Стримить логи в реальном времени (как tail -f)
  --lines=N           Количество последних строк логов (по умолчанию: 200)
  --service-id=ID      ID сервиса Render (переопределяет RENDER_SERVICE_ID из .env)
  --output=FILE        Сохранить логи в файл
  --help, -h          Показать эту справку

Переменные окружения (.env):
  RENDER_API_KEY       API ключ Render (обязательно)
  RENDER_SERVICE_ID    ID сервиса Render (обязательно, если не указан --service-id)

Примеры:
  node scripts/fetch-render-logs.js
  node scripts/fetch-render-logs.js --tail
  node scripts/fetch-render-logs.js --lines=500
  node scripts/fetch-render-logs.js --output=logs/render-logs.txt
`);
  process.exit(0);
} else {
  main().catch(error => {
    console.error('❌ Критическая ошибка:', error);
    process.exit(1);
  });
}
