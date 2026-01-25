#!/usr/bin/env node

/**
 * Показать историю платежей по сделке
 * 
 * Использование:
 *   node scripts/show-deal-payments.js <dealId>
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const StripeRepository = require('../src/services/stripe/repository');
const PipedriveClient = require('../src/services/pipedrive');
const logger = require('../src/utils/logger');

async function showDealPayments(dealId) {
  try {
    const repository = new StripeRepository();
    const pipedriveClient = new PipedriveClient();

    console.log(`\n${'='.repeat(80)}`);
    console.log(`📋 История платежей для Deal #${dealId}`);
    console.log('='.repeat(80));

    // Получаем данные сделки
    const dealResult = await pipedriveClient.getDeal(dealId);
    if (!dealResult.success || !dealResult.deal) {
      console.log(`❌ Сделка не найдена: ${dealResult.error || 'unknown'}`);
      return;
    }

    const deal = dealResult.deal;
    console.log(`\n📋 Сделка: ${deal.title}`);
    console.log(`   Сумма: ${deal.value} ${deal.currency || 'PLN'}`);
    console.log(`   Статус: ${deal.status || 'N/A'}`);
    console.log(`   Стадия: ${deal.stage?.name || 'N/A'}`);

    // Получаем все платежи
    const payments = await repository.listPayments({ dealId: String(dealId), limit: 100 });
    
    console.log(`\n💰 Всего платежей в базе: ${payments.length}\n`);

    if (payments.length === 0) {
      console.log('   Платежей не найдено');
      return;
    }

    // Группируем по статусу
    const paidPayments = payments.filter(p => p.payment_status === 'paid' || p.status === 'processed');
    const unpaidPayments = payments.filter(p => p.payment_status !== 'paid' && p.status !== 'processed');

    console.log(`   Оплаченных: ${paidPayments.length}`);
    console.log(`   Неоплаченных: ${unpaidPayments.length}\n`);

    // Показываем оплаченные платежи
    if (paidPayments.length > 0) {
      console.log('✅ ОПЛАЧЕННЫЕ ПЛАТЕЖИ:');
      console.log('-'.repeat(80));
      let totalPaid = 0;
      paidPayments.forEach((p, idx) => {
        const amount = parseFloat(p.amount_pln || p.amount || p.original_amount || 0);
        totalPaid += amount;
        const date = p.payment_date || p.created_at || 'N/A';
        console.log(`\n${idx + 1}. Платеж #${p.id || 'N/A'}`);
        console.log(`   Тип: ${p.payment_type || 'unknown'}`);
        console.log(`   Сумма: ${amount.toFixed(2)} ${p.currency || 'EUR'}`);
        if (p.amount_pln) {
          console.log(`   Сумма в PLN: ${parseFloat(p.amount_pln).toFixed(2)} PLN`);
        }
        console.log(`   Статус: ${p.payment_status || p.status || 'unknown'}`);
        console.log(`   Session ID: ${p.session_id || 'N/A'}`);
        console.log(`   Дата: ${date}`);
        if (p.checkout_url) {
          console.log(`   URL: ${p.checkout_url.substring(0, 80)}...`);
        }
      });
      console.log(`\n   ИТОГО ОПЛАЧЕНО: ${totalPaid.toFixed(2)} ${deal.currency || 'EUR'}`);
      console.log(`   ОЖИДАЕМАЯ СУММА: ${parseFloat(deal.value || 0).toFixed(2)} ${deal.currency || 'EUR'}`);
      const paidRatio = parseFloat(deal.value || 0) > 0 ? (totalPaid / parseFloat(deal.value || 0)) * 100 : 0;
      console.log(`   ПРОЦЕНТ ОПЛАТЫ: ${paidRatio.toFixed(2)}%`);
    }

    // Показываем неоплаченные платежи
    if (unpaidPayments.length > 0) {
      console.log(`\n\n⏳ НЕОПЛАЧЕННЫЕ ПЛАТЕЖИ:`);
      console.log('-'.repeat(80));
      unpaidPayments.forEach((p, idx) => {
        const amount = parseFloat(p.amount_pln || p.amount || p.original_amount || 0);
        const date = p.created_at || 'N/A';
        console.log(`\n${idx + 1}. Платеж #${p.id || 'N/A'}`);
        console.log(`   Тип: ${p.payment_type || 'unknown'}`);
        console.log(`   Сумма: ${amount.toFixed(2)} ${p.currency || 'EUR'}`);
        console.log(`   Статус: ${p.payment_status || p.status || 'unknown'}`);
        console.log(`   Session ID: ${p.session_id || 'N/A'}`);
        console.log(`   Дата создания: ${date}`);
        if (p.checkout_url) {
          console.log(`   URL: ${p.checkout_url.substring(0, 80)}...`);
        }
      });
    }

    console.log(`\n${'='.repeat(80)}\n`);

  } catch (error) {
    console.error(`❌ Ошибка: ${error.message}`);
    logger.error('Error showing deal payments', { dealId, error: error.message, stack: error.stack });
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dealId = args[0];

  if (!dealId) {
    console.error('❌ Ошибка: не указан Deal ID');
    console.error('\nИспользование:');
    console.error('  node scripts/show-deal-payments.js <dealId>');
    process.exit(1);
  }

  await showDealPayments(dealId);
}

main();


