#!/usr/bin/env node

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');

const AMOUNT = process.argv[2] ? parseFloat(process.argv[2]) : 510.00;
const CURRENCY = process.argv[3] || 'PLN';

async function findPaymentByAmount() {
  if (!supabase) {
    logger.error('Supabase client is not initialized.');
    process.exit(1);
  }

  try {
    logger.info(`\n🔍 Поиск платежа по сумме:`);
    logger.info(`   Сумма: ${AMOUNT} ${CURRENCY}`);
    logger.info('='.repeat(80));

    const amountTolerance = 0.01;

    // 1. Поиск в таблице payments
    logger.info('\n1️⃣ Поиск в таблице payments:');
    logger.info('-'.repeat(50));

    const { data: payments, error: paymentsError } = await supabase
      .from('payments')
      .select(`
        id,
        operation_date,
        description,
        amount,
        currency,
        payer_name,
        source,
        match_status,
        manual_status,
        proforma_id
      `)
      .eq('currency', CURRENCY)
      .order('operation_date', { ascending: false })
      .limit(1000);

    if (paymentsError) {
      logger.error('Ошибка при поиске в payments:', paymentsError);
    } else {
      const matchingPayments = (payments || []).filter(p => {
        const paymentAmount = parseFloat(p.amount) || 0;
        return Math.abs(paymentAmount - AMOUNT) <= amountTolerance;
      });

      if (matchingPayments.length > 0) {
        logger.info(`✅ Найдено ${matchingPayments.length} платежей с суммой ${AMOUNT} ${CURRENCY}:`);
        matchingPayments.forEach((p, i) => {
          logger.info(`\n  ${i + 1}. Платеж ID: ${p.id}`);
          logger.info(`     Плательщик: ${p.payer_name || 'N/A'}`);
          logger.info(`     Сумма: ${p.amount} ${p.currency}`);
          logger.info(`     Дата: ${p.operation_date || 'N/A'}`);
          logger.info(`     Источник: ${p.source || 'N/A'}`);
          logger.info(`     Статус: ${p.manual_status || p.match_status || 'N/A'}`);
          logger.info(`     Proforma ID: ${p.proforma_id || 'N/A'}`);
          logger.info(`     Описание: ${p.description || 'N/A'}`);
        });
      } else {
        logger.info(`❌ Платежи с суммой ${AMOUNT} ${CURRENCY} не найдены в payments`);
      }
    }

    // 2. Поиск в таблице stripe_payments
    logger.info('\n2️⃣ Поиск в таблице stripe_payments:');
    logger.info('-'.repeat(50));

    const { data: stripePayments, error: stripeError } = await supabase
      .from('stripe_payments')
      .select(`
        id,
        session_id,
        customer_name,
        customer_email,
        original_amount,
        amount_pln,
        currency,
        payment_status,
        deal_id,
        product_id,
        created_at,
        processed_at
      `)
      .eq('currency', CURRENCY.toLowerCase())
      .order('created_at', { ascending: false })
      .limit(1000);

    if (stripeError) {
      logger.error('Ошибка при поиске в stripe_payments:', stripeError);
    } else {
      const matchingStripePayments = (stripePayments || []).filter(p => {
        const paymentAmount = parseFloat(p.original_amount) || 0;
        return Math.abs(paymentAmount - AMOUNT) <= amountTolerance;
      });

      if (matchingStripePayments.length > 0) {
        logger.info(`✅ Найдено ${matchingStripePayments.length} Stripe платежей с суммой ${AMOUNT} ${CURRENCY}:`);
        matchingStripePayments.forEach((p, i) => {
          logger.info(`\n  ${i + 1}. Stripe Payment ID: ${p.id}`);
          logger.info(`     Плательщик: ${p.customer_name || 'N/A'}`);
          logger.info(`     Email: ${p.customer_email || 'N/A'}`);
          logger.info(`     Сумма: ${p.original_amount} ${p.currency}`);
          logger.info(`     Сумма PLN: ${p.amount_pln || 'N/A'}`);
          logger.info(`     Статус: ${p.payment_status || 'N/A'}`);
          logger.info(`     Session ID: ${p.session_id || 'N/A'}`);
          logger.info(`     Deal ID: ${p.deal_id || 'N/A'}`);
          logger.info(`     Product ID: ${p.product_id || 'N/A'}`);
          logger.info(`     Создан: ${p.created_at || 'N/A'}`);
          logger.info(`     Обработан: ${p.processed_at || 'N/A'}`);
        });
      } else {
        logger.info(`❌ Stripe платежи с суммой ${AMOUNT} ${CURRENCY} не найдены`);
      }
    }

    logger.info('\n' + '='.repeat(80));

  } catch (err) {
    logger.error('Неожиданная ошибка:', err);
    process.exit(1);
  }
}

findPaymentByAmount()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    logger.error('Необработанная ошибка:', error);
    process.exit(1);
  });
