#!/usr/bin/env node

/**
 * Подготовка текста сообщения для напоминаний о вторых платежах по проформам
 * Показывает пример сообщения для согласования
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const supabase = require('../src/services/supabaseClient');
const PipedriveClient = require('../src/services/pipedrive');
const InvoiceProcessingService = require('../src/services/invoiceProcessing');
const logger = require('../src/utils/logger');

async function prepareReminderMessage() {
  try {
    const pipedriveClient = new PipedriveClient();
    const invoiceService = new InvoiceProcessingService();

    console.log('📝 Подготовка текста сообщения для напоминаний о вторых платежах...\n');

    // Получаем пример сделки для демонстрации
    const dealsResult = await pipedriveClient.getDeals({
      filter_id: null,
      status: 'open',
      limit: 10,
      start: 0
    });

    if (!dealsResult.success || !dealsResult.deals) {
      console.log('❌ Не удалось получить сделки');
      return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Находим первую подходящую сделку
    let exampleDeal = null;
    let exampleProforma = null;
    let bankAccount = null;

    for (const deal of dealsResult.deals) {
      const closeDate = deal.expected_close_date || deal.close_date;
      if (!closeDate) continue;

      const expectedCloseDate = new Date(closeDate);
      const daysDiff = Math.ceil((expectedCloseDate - today) / (1000 * 60 * 60 * 24));

      if (daysDiff < 30) continue;

      const { data: proformas } = await supabase
        .from('proformas')
        .select('*')
        .eq('pipedrive_deal_id', deal.id)
        .is('deleted_at', null)
        .limit(1);

      if (!proformas || proformas.length === 0) continue;

      exampleDeal = deal;
      exampleProforma = proformas[0];

      // Получаем банковский счет
      const bankAccountResult = await invoiceService.getBankAccountByCurrency(deal.currency || 'PLN');
      if (bankAccountResult.success && bankAccountResult.bankAccount) {
        bankAccount = bankAccountResult.bankAccount;
      }

      break;
    }

    if (!exampleDeal || !exampleProforma) {
      console.log('⚠️  Не найдено подходящих сделок для примера');
      return;
    }

    const dealWithRelated = await pipedriveClient.getDealWithRelatedData(exampleDeal.id);
    const person = dealWithRelated?.person;
    const customerName = person?.name || 'Клиент';
    const proformaNumber = exampleProforma.fullnumber || 'CO-PROF XXX/YYYY';
    const dealValue = parseFloat(exampleDeal.value) || 0;
    const currency = exampleDeal.currency || 'PLN';
    const secondPaymentAmount = dealValue / 2;
    const bankAccountNumber = bankAccount?.number || 'XX XXXX XXXX XXXX XXXX XXXX XXXX';

    // Формируем текст сообщения для согласования
    console.log('='.repeat(100));
    console.log('📋 ПРЕДЛОЖЕНИЕ ТЕКСТА СООБЩЕНИЯ ДЛЯ СОГЛАСОВАНИЯ');
    console.log('='.repeat(100) + '\n');

    const messageText = `🔔 Напоминание о втором платеже

Здравствуйте, ${customerName}!

Напоминаем о необходимости оплаты второго платежа по сделке "${exampleDeal.title}".

📋 Детали оплаты:
• Сумма: ${secondPaymentAmount.toFixed(2)} ${currency}
• Номер проформы: ${proformaNumber}
• Банковский счет: ${bankAccountNumber}

💡 Важно: При переводе обязательно укажите номер проформы "${proformaNumber}" в назначении платежа.

Если у вас возникли вопросы, пожалуйста, свяжитесь с нами.

С уважением,
Команда Comoon`;

    console.log(messageText);
    console.log('\n' + '='.repeat(100));
    console.log('📊 ИНФОРМАЦИЯ ДЛЯ ПРОВЕРКИ:');
    console.log('='.repeat(100));
    console.log(`Deal ID: ${exampleDeal.id}`);
    console.log(`Название сделки: ${exampleDeal.title}`);
    console.log(`Клиент: ${customerName}`);
    console.log(`Проформа: ${proformaNumber}`);
    console.log(`Сумма второго платежа: ${secondPaymentAmount.toFixed(2)} ${currency}`);
    console.log(`Банковский счет:`);
    if (bankAccount) {
      console.log(`  Название: ${bankAccount.name}`);
      console.log(`  Номер: ${bankAccount.number || 'N/A'}`);
      console.log(`  Валюта: ${bankAccount.currency || currency}`);
    } else {
      console.log(`  ⚠️  Не удалось получить данные банковского счета`);
    }

    console.log('\n💡 ВАЖНО:');
    console.log('1. Проверьте, что номер банковского счета корректен');
    console.log('2. Убедитесь, что формат сообщения подходит');
    console.log('3. После согласования текст будет использован для всех напоминаний');

  } catch (error) {
    logger.error('Ошибка:', error);
    console.error('❌ Критическая ошибка:', error.message);
    process.exit(1);
  }
}

prepareReminderMessage();
