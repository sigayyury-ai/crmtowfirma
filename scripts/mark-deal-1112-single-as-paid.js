#!/usr/bin/env node

/**
 * Пометить single платеж для сделки 1112 как оплаченный
 * 
 * Использование:
 *   node scripts/mark-deal-1112-single-as-paid.js
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const StripeRepository = require('../src/services/stripe/repository');
const logger = require('../src/utils/logger');

const DEAL_ID = 1112;
const SINGLE_SESSION_ID = 'cs_live_a11It5xudp0BqogOQAK7xekv4nzoxNAZOk2Ggzmux1WP0TsYJnO1WWGb2h';

async function markSingleAsPaid() {
  try {
    console.log(`\n🔄 Обновление статуса single платежа для сделки #${DEAL_ID}...\n`);
    console.log('='.repeat(100));

    const repository = new StripeRepository();

    // Находим single платеж
    const payment = await repository.findPaymentBySessionId(SINGLE_SESSION_ID);
    
    if (!payment) {
      throw new Error('Single платеж не найден');
    }

    console.log(`📋 Найден платеж:`);
    console.log(`   ID: ${payment.id}`);
    console.log(`   Session ID: ${payment.session_id}`);
    console.log(`   Тип: ${payment.payment_type}`);
    console.log(`   Текущий статус: ${payment.payment_status || payment.status}`);
    console.log(`   Сумма: ${payment.original_amount} ${payment.currency}\n`);

    // Обновляем статус на paid
    console.log(`🔄 Обновление статуса на 'paid'...\n`);

    const result = await repository.updatePaymentStatus(SINGLE_SESSION_ID, 'paid');

    if (!result) {
      throw new Error('Не удалось обновить статус');
    }

    console.log('✅ Статус платежа обновлен успешно!');
    console.log(`   Новый статус: paid\n`);

    // Проверяем итоговую сумму
    const payments = await repository.listPayments({ dealId: String(DEAL_ID) });
    const paidPayments = payments.filter(p => p.payment_status === 'paid' || p.status === 'processed');
    
    let totalPaid = 0;
    paidPayments.forEach(p => {
      if (p.currency === 'EUR') {
        totalPaid += parseFloat(p.original_amount || p.amount || 0);
      }
    });

    console.log(`💰 ИТОГО ОПЛАЧЕНО: ${totalPaid.toFixed(2)} EUR`);
    console.log(`📊 Оплаченных платежей: ${paidPayments.length}\n`);

    console.log('='.repeat(100));
    console.log('\n✅ Обновление завершено!\n');

  } catch (error) {
    console.error('\n❌ Ошибка:', error.message);
    console.error(error.stack);
    logger.error('Mark single as paid failed', { dealId: DEAL_ID, error: error.message, stack: error.stack });
    process.exit(1);
  }
}

markSingleAsPaid().catch(error => {
  console.error('Script failed:', error);
  process.exit(1);
});





