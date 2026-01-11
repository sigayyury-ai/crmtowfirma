#!/usr/bin/env node

/**
 * Скрипт для отметки всех платежей сделки 1685 как оплаченных
 * Использование: node scripts/mark-deal-1685-payments-paid.js
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const supabase = require('../src/services/supabaseClient');
const StripeRepository = require('../src/services/stripe/repository');
const logger = require('../src/utils/logger');

const DEAL_ID = '1685';

async function markPaymentsAsPaid() {
  try {
    if (!supabase) {
      console.error('❌ Supabase client is not configured');
      process.exit(1);
    }

    const stripeRepository = new StripeRepository();

    console.log(`\n🔍 Поиск платежей для сделки ${DEAL_ID}...\n`);

    // Получаем все платежи для сделки
    const payments = await stripeRepository.listPayments({ dealId: DEAL_ID });

    if (!payments || payments.length === 0) {
      console.log('❌ Платежи не найдены');
      return;
    }

    console.log(`📊 Найдено платежей: ${payments.length}\n`);

    let updated = 0;
    let alreadyPaid = 0;

    for (const payment of payments) {
      const sessionId = payment.session_id;
      const currentStatus = payment.payment_status;
      const paymentType = payment.payment_type || 'unknown';
      const amount = payment.amount || 0;
      const currency = payment.currency || 'PLN';

      console.log(`   Сессия: ${sessionId}`);
      console.log(`   Тип: ${paymentType}`);
      console.log(`   Сумма: ${amount} ${currency}`);
      console.log(`   Текущий статус: ${currentStatus}`);

      if (currentStatus === 'paid') {
        console.log(`   ✅ Уже помечен как оплаченный\n`);
        alreadyPaid++;
        continue;
      }

      // Обновляем статус на 'paid'
      const success = await stripeRepository.updatePaymentStatus(sessionId, 'paid');

      if (success) {
        console.log(`   ✅ Статус обновлен на 'paid'\n`);
        updated++;
      } else {
        console.log(`   ❌ Ошибка при обновлении статуса\n`);
      }
    }

    console.log('='.repeat(80));
    console.log('📊 РЕЗУЛЬТАТЫ:');
    console.log('='.repeat(80));
    console.log(`   Всего платежей: ${payments.length}`);
    console.log(`   Обновлено: ${updated}`);
    console.log(`   Уже были оплачены: ${alreadyPaid}`);
    console.log('='.repeat(80) + '\n');

    if (updated > 0) {
      console.log('✅ Платежи успешно обновлены!');
    } else {
      console.log('ℹ️  Все платежи уже были помечены как оплаченные');
    }

  } catch (error) {
    logger.error('Error marking payments as paid', { dealId: DEAL_ID, error: error.message, stack: error.stack });
    console.error(`\n❌ Ошибка: ${error.message}`);
    if (error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
    process.exit(1);
  }
}

markPaymentsAsPaid().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});




