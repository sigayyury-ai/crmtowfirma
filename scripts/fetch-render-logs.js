#!/usr/bin/env node

/**
 * Скрипт для получения логов с продакшен сервера на Render
 * Использует Render API v1 для получения логов
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
const axios = require('axios');
const readline = require('readline');

const RENDER_API_KEY = process.env.RENDER_API_KEY;
const RENDER_SERVICE_ID = process.env.RENDER_SERVICE_ID;
const RENDER_API_HOST = process.env.RENDER_API_HOST || 'https://api.render.com/v1';

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

// Создаем HTTP клиент для Render API
const renderApi = axios.create({
  baseURL: RENDER_API_HOST,
  headers: {
    'Authorization': `Bearer ${RENDER_API_KEY}`,
    'Content-Type': 'application/json'
  },
  timeout: 30000
});

/**
 * Проверить, доступен ли render-cli с командой logs
 */
function checkRenderCli() {
  const { execSync } = require('child_process');
  const os = require('os');
  const paths = [
    'render-cli',
    '/usr/local/bin/render-cli',
    `${os.homedir()}/Library/Python/3.9/bin/render-cli`,
    `${os.homedir()}/Library/Python/3.10/bin/render-cli`,
    `${os.homedir()}/Library/Python/3.11/bin/render-cli`,
    `${os.homedir()}/Library/Python/3.12/bin/render-cli`,
    `${os.homedir()}/.local/bin/render-cli`
  ];

  for (const cliPath of paths) {
    try {
      // Проверяем, что файл существует и имеет команду logs
      execSync(`${cliPath} logs --help 2>&1 | head -1`, { stdio: 'pipe', timeout: 5000 });
      return cliPath;
    } catch (e) {
      // Пробуем следующий путь
    }
  }
  return null;
}

/**
 * Получить логи сервиса через render-cli
 */
async function fetchLogsViaCli(serviceId, lines = 200, tail = false) {
  const { exec } = require('child_process');
  const { promisify } = require('util');
  const execAsync = promisify(exec);

  const cliPath = checkRenderCli();
  if (!cliPath) {
    throw new Error('render-cli не найден. Установите его: pip install render-cli');
  }

  const env = { ...process.env, RENDER_TOKEN: RENDER_API_KEY };
  const tailFlag = tail ? '--tail' : '';
  const command = `${cliPath} logs ${serviceId} ${tailFlag} --lines ${lines}`;

  try {
    const { stdout, stderr } = await execAsync(command, { env });
    if (stderr && !stderr.includes('Warning')) {
      console.error('⚠️  Предупреждение:', stderr);
    }
    return stdout;
  } catch (error) {
    if (error.stderr) {
      throw new Error(`render-cli ошибка: ${error.stderr}`);
    }
    throw error;
  }
}

/**
 * Получить логи через bash скрипт (fallback)
 */
async function fetchLogsViaBash(serviceId, lines = 200) {
  const { exec } = require('child_process');
  const { promisify } = require('util');
  const path = require('path');
  const execAsync = promisify(exec);

  const scriptPath = path.join(__dirname, 'tail-render-logs.sh');
  const env = { ...process.env };
  
  // Временно переопределяем количество строк через переменную окружения
  const originalLines = process.env.RENDER_LOG_LINES;
  process.env.RENDER_LOG_LINES = lines.toString();

  try {
    const { stdout, stderr } = await execAsync(`bash ${scriptPath}`, { 
      env,
      maxBuffer: 10 * 1024 * 1024 // 10MB
    });
    if (stderr && !stderr.includes('Warning')) {
      console.error('⚠️  Предупреждение:', stderr);
    }
    return stdout;
  } finally {
    if (originalLines) {
      process.env.RENDER_LOG_LINES = originalLines;
    } else {
      delete process.env.RENDER_LOG_LINES;
    }
  }
}

/**
 * Получить логи сервиса
 * Примечание: Render API не предоставляет прямой endpoint для логов приложения
 * Используется render-cli или bash скрипт для получения логов
 */
async function fetchLogs(serviceId, lines = 200) {
  try {
    console.log(`📥 Получение последних ${lines} строк логов для сервиса ${serviceId}...`);
    
    // Сначала пробуем через render-cli
    const cliPath = checkRenderCli();
    if (cliPath) {
      try {
        return await fetchLogsViaCli(serviceId, lines, false);
      } catch (error) {
        console.log('⚠️  render-cli не сработал, пробуем bash скрипт...');
      }
    }
    
    // Fallback на bash скрипт
    return await fetchLogsViaBash(serviceId, lines);
  } catch (error) {
    console.error('❌ Ошибка при получении логов:', error.message);
    console.error('\n💡 Решение:');
    console.error('   1. Просмотр логов через веб-интерфейс:');
    console.error(`      https://dashboard.render.com/web/${options.serviceId}`);
    console.error('   2. Или установите правильную версию render-cli:');
    console.error('      pip3 install --upgrade render-cli');
    console.error('   3. Или используйте bash скрипт (если render-cli поддерживает logs):');
    console.error('      ./scripts/tail-render-logs.sh');
    throw error;
  }
}

/**
 * Стримить логи в реальном времени через render-cli
 */
async function streamLogs(serviceId) {
  console.log(`📡 Стриминг логов для сервиса ${serviceId}...`);
  console.log('   (Нажмите Ctrl+C для остановки)\n');

  const { spawn } = require('child_process');
  const cliPath = checkRenderCli();
  
  if (!cliPath) {
    console.error('❌ render-cli не найден. Установите его: pip install render-cli');
    console.error('   Или используйте bash скрипт: ./scripts/tail-render-logs.sh');
    process.exit(1);
  }

  const env = { ...process.env, RENDER_TOKEN: RENDER_API_KEY };
  const child = spawn(cliPath, ['logs', serviceId, '--tail', '--lines', '200'], {
    env,
    stdio: 'inherit'
  });

  // Обработка Ctrl+C
  process.on('SIGINT', () => {
    console.log('\n\n👋 Остановка стриминга логов...');
    child.kill();
    process.exit(0);
  });

  child.on('error', (error) => {
    console.error('❌ Ошибка при запуске render-cli:', error.message);
    process.exit(1);
  });

  child.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.error(`\n❌ render-cli завершился с кодом ${code}`);
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

  // render-cli возвращает строку с логами
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

/**
 * Получить список сервисов (для справки)
 */
async function listServices() {
  try {
    console.log('📋 Получение списка сервисов...');
    const response = await renderApi.get('/services');
    
    if (response.data && Array.isArray(response.data)) {
      console.log('\nДоступные сервисы:');
      response.data.forEach(item => {
        // Render API возвращает массив объектов с полем service
        const service = item.service || item;
        const name = service.name || 'Без названия';
        const id = service.id || 'N/A';
        const type = service.type || 'unknown';
        const url = service.serviceDetails?.url || service.url || '';
        console.log(`  - ${name} (${type})`);
        console.log(`    ID: ${id}`);
        if (url) {
          console.log(`    URL: ${url}`);
        }
        console.log('');
      });
    } else {
      console.log('Сервисы:', JSON.stringify(response.data, null, 2));
    }
  } catch (error) {
    if (error.response) {
      console.error(`❌ Ошибка API Render: ${error.response.status} ${error.response.statusText}`);
      if (error.response.data) {
        console.error('   Детали:', JSON.stringify(error.response.data, null, 2));
      }
    } else {
      console.error('❌ Ошибка при получении списка сервисов:', error.message);
    }
  }
}

// Главная функция
async function main() {
  console.log('🚀 Render Logs Fetcher\n');
  console.log(`   API Host: ${RENDER_API_HOST}`);
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
    console.error('\n❌ Не удалось получить логи');
    if (error.response?.status === 401) {
      console.error('   Проверьте правильность RENDER_API_KEY');
    } else if (error.response?.status === 404) {
      console.error('   Сервис не найден. Проверьте RENDER_SERVICE_ID');
      console.error('   Для просмотра доступных сервисов запустите: node scripts/fetch-render-logs.js --list-services');
    }
    process.exit(1);
  }
}

// Обработка специальных команд
if (args.includes('--list-services') || args.includes('--help') || args.includes('-h')) {
  if (args.includes('--list-services')) {
    listServices().then(() => process.exit(0));
  } else {
    console.log(`
Использование: node scripts/fetch-render-logs.js [options]

Опции:
  --tail              Стримить логи в реальном времени (как tail -f)
  --lines=N           Количество последних строк логов (по умолчанию: 200)
  --service-id=ID      ID сервиса Render (переопределяет RENDER_SERVICE_ID из .env)
  --output=FILE        Сохранить логи в файл
  --list-services     Показать список доступных сервисов
  --help, -h          Показать эту справку

Переменные окружения (.env):
  RENDER_API_KEY       API ключ Render (обязательно)
  RENDER_SERVICE_ID    ID сервиса Render (обязательно, если не указан --service-id)
  RENDER_API_HOST      API хост Render (по умолчанию: https://api.render.com/v1)

Примеры:
  node scripts/fetch-render-logs.js
  node scripts/fetch-render-logs.js --tail
  node scripts/fetch-render-logs.js --lines=500
  node scripts/fetch-render-logs.js --output=logs/render-logs.txt
  node scripts/fetch-render-logs.js --list-services
`);
    process.exit(0);
  }
} else {
  main().catch(error => {
    console.error('❌ Критическая ошибка:', error);
    process.exit(1);
  });
}

