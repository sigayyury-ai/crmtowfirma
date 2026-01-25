#!/usr/bin/env node

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const DealDiagnosticsService = require('../src/services/dealDiagnosticsService');
const logger = require('../src/utils/logger');

const DEAL_ID = process.argv[2] || process.env.DEAL_ID;

if (!DEAL_ID) {
  console.error('❌ Usage: node scripts/diagnose-deal.js <dealId>');
  console.error('   Or set DEAL_ID environment variable');
  process.exit(1);
}

async function diagnoseDeal() {
  console.log(`\n🔍 Диагностика сделки #${DEAL_ID}\n`);
  console.log('='.repeat(80));
  
  try {
    const diagnosticsService = new DealDiagnosticsService();
    const result = await diagnosticsService.getDealDiagnostics(DEAL_ID);
    
    // Выводим результат в читаемом формате
    console.log('\n📊 РЕЗУЛЬТАТ ДИАГНОСТИКИ\n');
    console.log(JSON.stringify(result, null, 2));
    
    // Дополнительная информация в консоль
    if (result.success) {
      console.log('\n✅ Диагностика успешно завершена');
      
      if (result.dealInfo) {
        console.log(`\n📋 Информация о сделке:`);
        console.log(`   ID: ${result.dealInfo.id}`);
        console.log(`   Название: ${result.dealInfo.title || 'N/A'}`);
        console.log(`   Сумма: ${result.dealInfo.value || 'N/A'} ${result.dealInfo.currency || 'N/A'}`);
        console.log(`   Статус: ${result.dealInfo.stageName || 'N/A'} (ID: ${result.dealInfo.stageId || 'N/A'})`);
      }
      
      if (result.summary) {
        console.log(`\n💰 Сводка по платежам:`);
        console.log(`   Всего оплачено: ${result.summary.totalPaid || 0} PLN`);
        console.log(`   Остаток: ${result.summary.remaining || 0} ${result.summary.dealCurrency || ''}`);
        console.log(`   Прогресс оплаты: ${result.summary.paymentProgress || 0}%`);
      }
      
      if (result.issues && result.issues.length > 0) {
        console.log(`\n⚠️  Обнаружено проблем: ${result.issues.length}`);
        result.issues.forEach((issue, index) => {
          console.log(`   ${index + 1}. [${issue.severity.toUpperCase()}] ${issue.message}`);
        });
      } else {
        console.log(`\n✅ Проблем не обнаружено`);
      }
    } else {
      console.log(`\n❌ Ошибка диагностики: ${result.error || 'Unknown error'}`);
    }
    
  } catch (error) {
    logger.error('Ошибка при выполнении диагностики:', error);
    console.error('\n❌ Критическая ошибка:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

diagnoseDeal()
  .then(() => {
    console.log('\n' + '='.repeat(80));
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Необработанная ошибка:', error);
    process.exit(1);
  });





