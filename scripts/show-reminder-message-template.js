#!/usr/bin/env node

/**
 * Показывает шаблон сообщения для напоминаний о вторых платежах по проформам
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const InvoiceProcessingService = require('../src/services/invoiceProcessing');
const logger = require('../src/utils/logger');

async function showMessageTemplate() {
  try {
    const invoiceService = new InvoiceProcessingService();

    console.log('📝 ШАБЛОН СООБЩЕНИЯ ДЛЯ НАПОМИНАНИЙ О ВТОРЫХ ПЛАТЕЖАХ\n');
    console.log('='.repeat(100) + '\n');

    // Примеры данных из реальных сделок
    const example = {
      dealId: 1611,
      dealTitle: 'Заявка от Сергей',
      customerName: 'Siergiej Żarkiewicz',
      proformaNumber: 'CO-PROF 145/2025',
      secondPaymentAmount: 1211.50,
      currency: 'PLN',
      secondPaymentDate: '2025-12-02'
    };

    // Получаем банковские счета для разных валют
    const bankAccounts = {};
    for (const currency of ['PLN', 'EUR']) {
      const result = await invoiceService.getBankAccountByCurrency(currency);
      if (result.success && result.bankAccount) {
        bankAccounts[currency] = result.bankAccount;
      }
    }

    console.log('📋 СОГЛАСОВАННЫЙ ТЕКСТ СООБЩЕНИЯ:\n');

    const bankAccount = bankAccounts[example.currency] || { number: 'XX XXXX XXXX XXXX XXXX XXXX XXXX' };

    const message = `🔔 Напоминание о втором платеже

Здравствуйте, ${example.customerName}!

Напоминаем об оплате второго платежа по сделке "${example.dealTitle}".

💰 Сумма: ${example.secondPaymentAmount.toFixed(2)} ${example.currency}
📋 Проформа: ${example.proformaNumber}
🏦 Счет: ${bankAccount.number || 'N/A'}

💡 Укажите "${example.proformaNumber}" в назначении платежа.`;

    console.log(message);

    console.log('\n\n' + '='.repeat(100));
    console.log('📊 ИНФОРМАЦИЯ О БАНКОВСКИХ СЧЕТАХ:');
    console.log('='.repeat(100));
    
    for (const [currency, account] of Object.entries(bankAccounts)) {
      console.log(`\n${currency}:`);
      console.log(`  Название: ${account.name || 'N/A'}`);
      console.log(`  Номер: ${account.number || 'N/A'}`);
      console.log(`  Банк: ${account.bankName || 'N/A'}`);
    }

    console.log('\n\n💡 После согласования этот текст будет использован для всех напоминаний');

  } catch (error) {
    logger.error('Ошибка:', error);
    console.error('❌ Критическая ошибка:', error.message);
    process.exit(1);
  }
}

showMessageTemplate();