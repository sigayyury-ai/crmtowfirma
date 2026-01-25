#!/usr/bin/env node

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');

const SURNAME = process.argv[2] || 'JIUJIANGSHIHERANDIANZISHANGWUYOUXIANGONGS';
const AMOUNT = process.argv[3] ? parseFloat(process.argv[3]) : 510.00;
const CURRENCY = process.argv[4] || 'PLN';

async function findPaymentBySurname() {
  if (!supabase) {
    logger.error('Supabase client is not initialized.');
    process.exit(1);
  }

  try {
    logger.info(`\n🔍 Поиск платежа:`);
    logger.info(`   Фамилия: ${SURNAME}`);
    logger.info(`   Сумма: ${AMOUNT} ${CURRENCY}`);
    logger.info('='.repeat(80));

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
      .ilike('payer_name', `%${SURNAME}%`)
      .eq('currency', CURRENCY)
      .order('operation_date', { ascending: false });

    if (paymentsError) {
      logger.error('Ошибка при поиске в payments:', paymentsError);
    } else {
      logger.info(`Найдено ${payments?.length || 0} платежей по фамилии`);
      
      // Фильтруем по сумме (с учетом небольшой погрешности)
      const amountTolerance = 0.01;
      const matchingPayments = (payments || []).filter(p => {
        const paymentAmount = parseFloat(p.amount) || 0;
        return Math.abs(paymentAmount - AMOUNT) <= amountTolerance;
      });

      if (matchingPayments.length > 0) {
        logger.info(`✅ Найдено ${matchingPayments.length} платежей с суммой ${AMOUNT} ${CURRENCY}:`);
        matchingPayments.forEach((p, i) => {
          logger.info(`\n  ${i + 1}. Платеж ID: ${p.id}`);
          logger.info(`     Плательщик: ${p.payer_name}`);
          logger.info(`     Сумма: ${p.amount} ${p.currency}`);
          logger.info(`     Дата: ${p.operation_date || 'N/A'}`);
          logger.info(`     Источник: ${p.source || 'N/A'}`);
          logger.info(`     Статус: ${p.manual_status || p.match_status || 'N/A'}`);
          logger.info(`     Proforma ID: ${p.proforma_id || 'N/A'}`);
          logger.info(`     Описание: ${p.description || 'N/A'}`);
        });
      } else {
        logger.info(`❌ Платежи с суммой ${AMOUNT} ${CURRENCY} не найдены`);
        if (payments && payments.length > 0) {
          logger.info(`\n   Найдены платежи с другими суммами:`);
          payments.slice(0, 10).forEach((p, i) => {
            logger.info(`     ${i + 1}. ${p.amount} ${p.currency} | ${p.operation_date} | ${p.payer_name}`);
          });
        }
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
      .ilike('customer_name', `%${SURNAME}%`)
      .eq('currency', CURRENCY.toLowerCase())
      .order('created_at', { ascending: false });

    if (stripeError) {
      logger.error('Ошибка при поиске в stripe_payments:', stripeError);
    } else {
      logger.info(`Найдено ${stripePayments?.length || 0} Stripe платежей по фамилии`);
      
      // Фильтруем по сумме (используем original_amount)
      const amountTolerance = 0.01;
      const matchingStripePayments = (stripePayments || []).filter(p => {
        const paymentAmount = parseFloat(p.original_amount) || 0;
        // original_amount уже в единицах валюты (не в центах)
        return Math.abs(paymentAmount - AMOUNT) <= amountTolerance;
      });

      if (matchingStripePayments.length > 0) {
        logger.info(`✅ Найдено ${matchingStripePayments.length} Stripe платежей с суммой ${AMOUNT} ${CURRENCY}:`);
        matchingStripePayments.forEach((p, i) => {
          logger.info(`\n  ${i + 1}. Stripe Payment ID: ${p.id}`);
          logger.info(`     Плательщик: ${p.customer_name}`);
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
        if (stripePayments && stripePayments.length > 0) {
          logger.info(`\n   Найдены Stripe платежи с другими суммами:`);
          stripePayments.slice(0, 10).forEach((p, i) => {
            logger.info(`     ${i + 1}. ${p.original_amount} ${p.currency} | ${p.created_at} | ${p.customer_name}`);
          });
        }
      }
    }

    // 3. Поиск без учета суммы (только по фамилии)
    logger.info('\n3️⃣ Все платежи по фамилии (без фильтра по сумме):');
    logger.info('-'.repeat(50));

    const allPaymentsByName = [
      ...(payments || []).map(p => ({ ...p, table: 'payments' })),
      ...(stripePayments || []).map(p => ({ ...p, table: 'stripe_payments', payer_name: p.customer_name }))
    ];

    if (allPaymentsByName.length > 0) {
      logger.info(`Всего найдено ${allPaymentsByName.length} платежей по фамилии "${SURNAME}":`);
      allPaymentsByName.forEach((p, i) => {
        const amount = p.amount || p.original_amount || 0;
        logger.info(`  ${i + 1}. [${p.table}] ${amount} ${p.currency || 'N/A'} | ${p.operation_date || p.created_at || 'N/A'} | ${p.payer_name || p.customer_name}`);
      });
    } else {
      logger.info(`❌ Платежи по фамилии "${SURNAME}" не найдены`);
    }

    logger.info('\n' + '='.repeat(80));

  } catch (err) {
    logger.error('Неожиданная ошибка:', err);
    process.exit(1);
  }
}

findPaymentBySurname()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    logger.error('Необработанная ошибка:', error);
    process.exit(1);
  });
