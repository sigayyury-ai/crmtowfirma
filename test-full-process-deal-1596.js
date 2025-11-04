require('dotenv').config();
const InvoiceProcessingService = require('./src/services/invoiceProcessing');
const PipedriveClient = require('./src/services/pipedrive');
const logger = require('./src/utils/logger');

async function testFullProcess() {
  try {
    console.log('=== Тест полного процесса обработки сделки 1596 ===\n');
    
    // 1. Инициализируем сервисы
    console.log('1. Инициализируем сервисы...');
    const invoiceProcessing = new InvoiceProcessingService();
    const pipedriveClient = new PipedriveClient();
    console.log('   ✅ Сервисы инициализированы\n');
    
    // 2. Получаем данные сделки 1596
    console.log('2. Получаем данные сделки 1596 из Pipedrive...');
    const dealResult = await pipedriveClient.getDealWithRelatedData(1596);
    
    if (!dealResult.success) {
      console.error('   ❌ Ошибка при получении данных сделки:', dealResult.error);
      process.exit(1);
    }
    
    console.log('   ✅ Сделка получена:', dealResult.deal.title);
    console.log('   Персона:', dealResult.person?.name || 'N/A');
    console.log('   Организация:', dealResult.organization?.name || 'N/A');
    console.log('');
    
    // 2.5. Устанавливаем тип инвойса "Proforma" (70) если не установлен
    const INVOICE_TYPE_FIELD_KEY = 'ad67729ecfe0345287b71a3b00910e8ba5b3b496';
    const PROFORMA_TYPE_VALUE = 70;
    
    if (!dealResult.deal[INVOICE_TYPE_FIELD_KEY] || dealResult.deal[INVOICE_TYPE_FIELD_KEY] !== PROFORMA_TYPE_VALUE) {
      console.log('2.5. Устанавливаем тип инвойса "Proforma" в сделке...');
      const updateResult = await pipedriveClient.updateDeal(1596, {
        [INVOICE_TYPE_FIELD_KEY]: PROFORMA_TYPE_VALUE
      });
      
      if (updateResult.success) {
        console.log('   ✅ Тип инвойса установлен: Proforma');
        // Обновляем данные сделки
        dealResult.deal[INVOICE_TYPE_FIELD_KEY] = PROFORMA_TYPE_VALUE;
      } else {
        console.log('   ⚠️  Не удалось установить тип инвойса:', updateResult.error);
        console.log('   Продолжаем тест...');
      }
      console.log('');
    }
    
    // 3. Запускаем процесс обработки сделки
    console.log('3. Запускаем процесс обработки сделки...');
    console.log('   Это включает:');
    console.log('   - Создание/поиск контрагента в wFirma');
    console.log('   - Создание проформы в wFirma');
    console.log('   - Отправка Telegram уведомления через SendPulse (если есть SendPulse ID)');
    console.log('   - Создание задач в Pipedrive для проверки платежей');
    console.log('   - Отправка проформы по email');
    console.log('');
    
    const result = await invoiceProcessing.processDealInvoice(
      dealResult.deal,
      dealResult.person,
      dealResult.organization
    );
    
    // 4. Выводим результаты
    console.log('4. Результаты обработки:');
    console.log('');
    
    if (result.success) {
      console.log('   ✅ Процесс выполнен успешно!');
      console.log('');
      
      if (result.invoiceId) {
        console.log('   📄 Проформа:');
        console.log(`      ID: ${result.invoiceId}`);
        console.log(`      Номер: ${result.invoiceNumber || 'N/A'}`);
        console.log(`      Сумма: ${result.amount || 'N/A'} ${result.currency || 'N/A'}`);
        console.log('');
      }
      
      if (result.tasks) {
        console.log('   📋 Задачи в Pipedrive:');
        console.log(`      Создано: ${result.tasks.tasksCreated || 0}`);
        console.log(`      Ошибок: ${result.tasks.tasksFailed || 0}`);
        if (result.tasks.tasks && result.tasks.tasks.length > 0) {
          result.tasks.tasks.forEach((task, index) => {
            if (task.success) {
              console.log(`      Задача ${index + 1}: ✅ ${task.subject}`);
              console.log(`         ID: ${task.taskId}, Срок: ${task.dueDate}`);
            } else {
              console.log(`      Задача ${index + 1}: ❌ ${task.subject}`);
              console.log(`         Ошибка: ${task.error}`);
            }
          });
        }
        console.log('');
      }
      
      if (result.telegramNotification) {
        console.log('   📱 Telegram уведомление:');
        if (result.telegramNotification.success) {
          console.log(`      ✅ Отправлено успешно (Message ID: ${result.telegramNotification.messageId || 'N/A'})`);
        } else {
          console.log(`      ❌ Ошибка отправки: ${result.telegramNotification.error}`);
        }
        console.log('');
      }
      
      if (result.emailSent) {
        console.log('   📧 Email:');
        console.log(`      ✅ Проформа отправлена по email`);
        console.log('');
      }
      
      console.log('   📊 Детали:');
      console.log(`      Сделка ID: ${result.dealId || 1596}`);
      console.log(`      Контрагент: ${result.contractorName || 'N/A'}`);
      console.log('');
      
    } else {
      console.log('   ❌ Процесс завершился с ошибкой:');
      console.log(`      ${result.error}`);
      console.log('');
      
      if (result.details) {
        console.log('   Детали ошибки:');
        console.log(JSON.stringify(result.details, null, 2));
        console.log('');
      }
    }
    
    console.log('=== Тест завершен ===');
    
  } catch (error) {
    console.error('\n❌ Критическая ошибка:', error);
    console.error(error.stack);
    process.exit(1);
  }
}

testFullProcess();

