#!/usr/bin/env node

/**
 * Скрипт для обработки оплаченных сессий из Events кабинета Stripe
 * Проверяет сессии, обрабатывает оплаченные и обновляет статусы сделок в CRM
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const EventsCabinetMonitorService = require('../src/services/stripe/eventsCabinetMonitorService');
const logger = require('../src/utils/logger');

async function processEventsCabinetSessions() {
  console.log('\n🔍 Запуск проверки и обработки сессий из Events кабинета Stripe\n');
  
  const apiKey = process.env.STRIPE_EVENTS_API_KEY;
  if (!apiKey) {
    console.error('❌ STRIPE_EVENTS_API_KEY не установлен!');
    process.exit(1);
  }
  
  const apiKeySuffix = apiKey.substring(apiKey.length - 4);
  console.log(`📋 Используется Events кабинет (ключ заканчивается на: ${apiKeySuffix})\n`);
  
  // Параметры можно настроить через аргументы командной строки
  const args = process.argv.slice(2);
  let hoursBack = 24;
  let limit = 100;
  
  for (const arg of args) {
    if (arg.startsWith('--hours=')) {
      hoursBack = parseInt(arg.split('=')[1], 10);
    }
    if (arg.startsWith('--limit=')) {
      limit = parseInt(arg.split('=')[1], 10);
    }
  }
  
  console.log(`⚙️  Параметры:`);
  console.log(`   - Период проверки: последние ${hoursBack} часов`);
  console.log(`   - Максимум сессий: ${limit}\n`);
  
  try {
    const monitorService = new EventsCabinetMonitorService();
    
    const result = await monitorService.checkAndProcessEventsCabinetSessions({
      trigger: 'manual_script',
      limit,
      hoursBack
    });
    
    console.log('\n📊 РЕЗУЛЬТАТЫ ОБРАБОТКИ:\n');
    console.log('='.repeat(60));
    
    if (result.success !== false) {
      console.log(`✅ Обработано сессий: ${result.processed || 0}`);
      console.log(`⏭️  Пропущено сессий: ${result.skipped || 0}`);
      console.log(`❌ Ошибок: ${result.errors || 0}`);
      console.log(`📋 Всего проверено: ${(result.processed || 0) + (result.skipped || 0) + (result.errors || 0)}`);
      
      if (result.details && result.details.length > 0) {
        console.log('\n📝 Детали обработки:\n');
        const processed = result.details.filter(d => d.status === 'processed');
        const errors = result.details.filter(d => d.status === 'error');
        
        if (processed.length > 0) {
          console.log('✅ Успешно обработано:');
          processed.forEach(detail => {
            console.log(`   - Deal #${detail.dealId} | Session: ${detail.sessionId?.substring(0, 25)}...`);
            if (detail.amount) {
              console.log(`     Сумма: ${detail.amount} ${detail.currency?.toUpperCase() || ''}`);
            }
          });
        }
        
        if (errors.length > 0) {
          console.log('\n❌ Ошибки:');
          errors.forEach(detail => {
            console.log(`   - Deal #${detail.dealId} | Session: ${detail.sessionId?.substring(0, 25)}...`);
            console.log(`     Ошибка: ${detail.error}`);
          });
        }
      }
      
      console.log('\n✅ Проверка завершена успешно!\n');
    } else {
      console.error(`❌ Ошибка при выполнении проверки: ${result.error || 'Неизвестная ошибка'}\n`);
      process.exit(1);
    }
    
  } catch (error) {
    console.error('\n❌ Критическая ошибка:', error.message);
    logger.error('Failed to process Events Cabinet sessions', {
      error: error.message,
      stack: error.stack
    });
    process.exit(1);
  }
}

processEventsCabinetSessions().catch(error => {
  console.error('\n❌ Критическая ошибка:', error.message);
  process.exit(1);
});

