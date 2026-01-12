#!/usr/bin/env node

/**
 * Диагностика сделки 1732
 * Показывает:
 * - Сумму в CRM
 * - Сколько было оплачено
 * - Дата закрытия сделки
 * - Все платежи
 * 
 * Использование:
 *   node scripts/diagnose-deal-1732.js
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const PipedriveClient = require('../src/services/pipedrive');
const StripeRepository = require('../src/services/stripe/repository');
const logger = require('../src/utils/logger');

const DEAL_ID = 1732;

async function diagnoseDeal() {
  try {
    console.log(`\n🔍 ДИАГНОСТИКА СДЕЛКИ #${DEAL_ID}\n`);
    console.log('='.repeat(100));

    const pipedriveClient = new PipedriveClient();
    const repository = new StripeRepository();

    // Получаем данные сделки из CRM
    console.log('📋 Получение данных из CRM...\n');
    const dealResult = await pipedriveClient.getDeal(DEAL_ID);
    
    if (!dealResult.success || !dealResult.deal) {
      throw new Error('Сделка не найдена в CRM');
    }

    const deal = dealResult.deal;

    console.log('📊 ДАННЫЕ ИЗ CRM:');
    console.log(`   ID: ${deal.id}`);
    console.log(`   Название: ${deal.title || 'N/A'}`);
    console.log(`   Сумма: ${deal.value || 0} ${deal.currency || 'PLN'}`);
    console.log(`   Валюта: ${deal.currency || 'PLN'}`);
    console.log(`   Статус: ${deal.status || 'N/A'}`);
    console.log(`   Дата закрытия (close_date): ${deal.close_date || 'N/A'}`);
    console.log(`   Ожидаемая дата закрытия (expected_close_date): ${deal.expected_close_date || 'N/A'}`);
    console.log(`   Дата создания: ${deal.add_time || 'N/A'}`);
    console.log('');

    // Получаем все платежи из базы данных
    console.log('💳 Получение платежей из базы данных...\n');
    const payments = await repository.listPayments({ dealId: String(DEAL_ID) });

    console.log(`✅ Найдено платежей: ${payments.length}\n`);

    if (payments.length === 0) {
      console.log('⚠️  Платежей не найдено\n');
    } else {
      console.log('📋 ПЛАТЕЖИ В БД:\n');
      
      const dealCurrency = deal.currency || 'PLN';
      let totalPaidInDealCurrency = 0;
      let totalPaidPln = 0;

      payments.forEach((payment, index) => {
        const amount = parseFloat(payment.original_amount || payment.amount || 0);
        const amountPln = parseFloat(payment.amount_pln || 0);
        const status = payment.payment_status || payment.status || 'unknown';
        const isPaid = status === 'paid' || status === 'processed';

        // Считаем только оплаченные платежи
        if (isPaid) {
          if (payment.currency === dealCurrency) {
            totalPaidInDealCurrency += amount;
          }
          totalPaidPln += amountPln;
        }

        console.log(`${index + 1}. ${payment.payment_type || 'unknown'}`);
        console.log(`   ID: ${payment.id}`);
        console.log(`   Session ID: ${payment.session_id || 'N/A'}`);
        console.log(`   Статус: ${status}`);
        console.log(`   Валюта: ${payment.currency || 'N/A'}`);
        console.log(`   Сумма (original_amount): ${amount} ${payment.currency || ''}`);
        console.log(`   Сумма (amount_pln): ${amountPln} PLN`);
        console.log(`   Создан: ${payment.created_at || 'N/A'}`);
        console.log(`   Обработан: ${payment.processed_at || 'N/A'}`);
        console.log('');
      });

      console.log('💰 ИТОГО ОПЛАЧЕНО:');
      console.log(`   В валюте сделки (${dealCurrency}): ${totalPaidInDealCurrency.toFixed(2)}`);
      console.log(`   В PLN: ${totalPaidPln.toFixed(2)}`);
      console.log('');

      // Сравнение с суммой в CRM
      const dealValue = parseFloat(deal.value) || 0;
      const paidRatio = dealValue > 0 ? (totalPaidInDealCurrency / dealValue) * 100 : 0;
      
      console.log('📊 СРАВНЕНИЕ:');
      console.log(`   Сумма в CRM: ${dealValue} ${dealCurrency}`);
      console.log(`   Оплачено: ${totalPaidInDealCurrency.toFixed(2)} ${dealCurrency}`);
      console.log(`   Процент оплаты: ${paidRatio.toFixed(2)}%`);
      
      if (paidRatio >= 95) {
        console.log(`   ✅ Сделка полностью оплачена`);
      } else if (paidRatio >= 50) {
        console.log(`   ⚠️  Сделка частично оплачена`);
      } else {
        console.log(`   ❌ Сделка оплачена менее чем на 50%`);
      }
      console.log('');
    }

    // Информация о датах
    console.log('📅 ДАТЫ:');
    if (deal.expected_close_date) {
      const expectedCloseDate = new Date(deal.expected_close_date);
      const today = new Date();
      const daysUntil = Math.ceil((expectedCloseDate - today) / (1000 * 60 * 60 * 24));
      
      console.log(`   Ожидаемая дата закрытия: ${deal.expected_close_date}`);
      console.log(`   Дней до закрытия: ${daysUntil}`);
    }
    if (deal.close_date) {
      console.log(`   Фактическая дата закрытия: ${deal.close_date}`);
    }
    console.log('');

    console.log('='.repeat(100));
    console.log('\n✅ Диагностика завершена!\n');

  } catch (error) {
    console.error('\n❌ Ошибка:', error.message);
    console.error(error.stack);
    logger.error('Diagnose deal failed', { dealId: DEAL_ID, error: error.message, stack: error.stack });
    process.exit(1);
  }
}

diagnoseDeal().catch(error => {
  console.error('Script failed:', error);
  process.exit(1);
});

