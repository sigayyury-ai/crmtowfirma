#!/usr/bin/env node

/**
 * Ручное удаление проформы для сделки
 * 
 * Использование:
 *   node scripts/manual-delete-proforma.js <dealId>
 * 
 * Пример:
 *   node scripts/manual-delete-proforma.js 2083
 */

require('dotenv').config();
const InvoiceProcessingService = require('../src/services/invoiceProcessing');
const PipedriveClient = require('../src/services/pipedrive');
const logger = require('../src/utils/logger');

async function manualDeleteProforma(dealId) {
  try {
    console.log(`\n🗑️  Ручное удаление проформы для Deal #${dealId}\n`);

    const pipedriveClient = new PipedriveClient();
    const invoiceProcessing = new InvoiceProcessingService();

    // Получаем данные сделки
    const dealResult = await pipedriveClient.getDeal(dealId);
    
    if (!dealResult.success) {
      console.error('❌ Ошибка получения сделки:', dealResult.error);
      process.exit(1);
    }

    const deal = dealResult.deal;
    
    console.log('📋 Данные сделки:');
    console.log(`   ID: ${deal.id}`);
    console.log(`   Название: ${deal.title || 'N/A'}`);
    console.log(`   Invoice Type: ${deal.invoice_type || 'не установлено'}`);
    console.log(`   Invoice Number: ${deal['0598d1168fe79005061aa3710ec45c3e03dbe8a3'] || 'не установлено'}\n`);

    // Запускаем процесс удаления
    console.log('🔄 Запуск процесса удаления...\n');
    
    const result = await invoiceProcessing.handleDealDeletion(deal);
    
    if (result.success) {
      console.log('✅ Удаление выполнено успешно!');
      console.log(`   Обработано проформ: ${result.processed || 0}`);
      
      if (result.processed > 0) {
        console.log('\n📋 Проформы удалены:');
        if (result.removedNumbers && result.removedNumbers.length > 0) {
          result.removedNumbers.forEach(num => {
            console.log(`   - ${num}`);
          });
        }
      }
    } else {
      console.error('❌ Ошибка при удалении:', result.error);
      
      if (result.error === 'No linked proformas found') {
        console.log('\n💡 Возможные причины:');
        console.log('   1. Проформа не связана со сделкой (проверьте pipedrive_deal_id)');
        console.log('   2. Номер проформы не указан в поле Invoice Number');
        console.log('   3. Проформа уже удалена');
      }
      
      process.exit(1);
    }

  } catch (error) {
    logger.error('Неожиданная ошибка:', error);
    console.error('\n❌ Критическая ошибка:', error.message);
    process.exit(1);
  }
}

const args = process.argv.slice(2);
if (args.length < 1) {
  console.error('Использование: node scripts/manual-delete-proforma.js <dealId>');
  console.error('Пример: node scripts/manual-delete-proforma.js 2083');
  process.exit(1);
}

const dealId = parseInt(args[0], 10);
if (isNaN(dealId)) {
  console.error('Deal ID должен быть числом');
  process.exit(1);
}

manualDeleteProforma(dealId);
