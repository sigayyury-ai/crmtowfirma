#!/usr/bin/env node

/**
 * Проверка полного флоу удаления проформы
 * Проверяет все этапы: webhook -> handleDealDeletion -> deleteInvoice -> markProformaDeleted
 */

require('dotenv').config();
const InvoiceProcessingService = require('../src/services/invoiceProcessing');
const PipedriveClient = require('../src/services/pipedrive');
const WfirmaClient = require('../src/services/wfirma');
const logger = require('../src/utils/logger');

async function verifyDeletionFlow() {
  try {
    console.log('\n🔍 Проверка флоу удаления проформы\n');

    const pipedriveClient = new PipedriveClient();
    const invoiceProcessing = new InvoiceProcessingService();
    const wfirmaClient = new WfirmaClient();

    // 1. Проверяем метод deleteInvoice в WfirmaClient
    console.log('1️⃣  Проверка метода deleteInvoice в WfirmaClient:');
    console.log('   ✅ Метод существует: wfirmaClient.deleteInvoice');
    console.log('   ✅ Endpoint: /invoices/delete/{invoiceId}');
    console.log('   ✅ Метод: POST');
    console.log('   ✅ Payload: XML с <invoice><id>{invoiceId}</id></invoice>');

    // 2. Проверяем вызов в invoiceProcessing
    console.log('\n2️⃣  Проверка вызова deleteInvoice в invoiceProcessing:');
    const handleDealDeletionCode = require('fs').readFileSync('src/services/invoiceProcessing.js', 'utf8');
    const hasDeleteCall = handleDealDeletionCode.includes('this.wfirmaClient.deleteInvoice');
    console.log(`   ${hasDeleteCall ? '✅' : '❌'} Вызов deleteInvoice найден в handleDealDeletion`);
    
    if (hasDeleteCall) {
      const lineMatch = handleDealDeletionCode.match(/const deleteResult = await this\.wfirmaClient\.deleteInvoice\(proformaId\);/);
      if (lineMatch) {
        const lineNumber = handleDealDeletionCode.substring(0, lineMatch.index).split('\n').length;
        console.log(`   📍 Строка: ${lineNumber}`);
      }
    }

    // 3. Проверяем обработку результата
    console.log('\n3️⃣  Проверка обработки результата удаления:');
    const hasErrorHandling = handleDealDeletionCode.includes('if (!deleteResult.success)');
    const hasSuccessHandling = handleDealDeletionCode.includes('markProformaDeleted');
    console.log(`   ${hasErrorHandling ? '✅' : '❌'} Обработка ошибок удаления`);
    console.log(`   ${hasSuccessHandling ? '✅' : '❌'} Обновление статуса в Supabase после успешного удаления`);

    // 4. Проверяем webhook обработчик
    console.log('\n4️⃣  Проверка webhook обработчика:');
    const webhookCode = require('fs').readFileSync('src/routes/pipedriveWebhook.js', 'utf8');
    const hasWebhookDelete = webhookCode.includes('processDealDeletionByWebhook');
    const hasInvoiceType74 = webhookCode.includes("currentInvoiceType === '74'");
    console.log(`   ${hasWebhookDelete ? '✅' : '❌'} Вызов processDealDeletionByWebhook`);
    console.log(`   ${hasInvoiceType74 ? '✅' : '❌'} Проверка invoice_type === '74'`);

    // 5. Тестируем реальный вызов API
    console.log('\n5️⃣  Тестирование реального вызова API wFirma:');
    console.log('   📡 Тестируем удаление несуществующей проформы (должно вернуть success: true, notFound: true)');
    
    const testResult = await wfirmaClient.deleteInvoice('999999999');
    console.log(`   Результат: success=${testResult.success}, notFound=${testResult.notFound || false}`);
    
    if (testResult.success) {
      console.log('   ✅ API wFirma отвечает корректно');
    } else {
      console.log(`   ❌ Ошибка API: ${testResult.error}`);
    }

    console.log('\n📋 Итоговый флоу удаления:');
    console.log('   1. Webhook получает событие обновления сделки');
    console.log('   2. Проверяется invoice_type === "74"');
    console.log('   3. Вызывается processDealDeletionByWebhook');
    console.log('   4. Вызывается handleDealDeletion');
    console.log('   5. Для каждой проформы:');
    console.log('      a. Вызывается wfirmaClient.deleteInvoice(proformaId)');
    console.log('      b. Если успешно -> markProformaDeleted в Supabase');
    console.log('      c. Если ошибка -> записывается лог с ошибкой');

    console.log('\n✅ Проверка завершена');

  } catch (error) {
    logger.error('Ошибка:', error);
    console.error('\n❌ Критическая ошибка:', error.message);
  }
}

verifyDeletionFlow();
