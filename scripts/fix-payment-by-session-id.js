require('dotenv').config();

const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');

async function fixPaymentBySessionId() {
  if (!supabase) {
    logger.error('Supabase client is not initialized.');
    process.exit(1);
  }

  try {
    logger.info('Ищу платеж по session_id и исправляю customer_name...\n');

    const sessionId = 'cs_live_a1AbN7qadrSs4ZKAYVmtmRyCzngeyRaUk8PTuHUkb91UPc98SUHYjoVpxx';

    // Найдем платеж по session_id
    const { data: payment, error: paymentError } = await supabase
      .from('stripe_payments')
      .select('*')
      .eq('session_id', sessionId)
      .single();

    if (paymentError || !payment) {
      logger.error('Платеж не найден:', paymentError);
      return;
    }

    logger.info(`Найден платеж:`);
    logger.info(`  ID: ${payment.id}`);
    logger.info(`  customer_name: ${payment.customer_name}`);
    logger.info(`  amount: ${payment.original_amount} ${payment.currency}`);
    logger.info(`  product_id: ${payment.product_id}`);

    // Обновим customer_name
    const { error: updateError } = await supabase
      .from('stripe_payments')
      .update({
        customer_name: 'Anton Komissarov',
        updated_at: new Date().toISOString()
      })
      .eq('id', payment.id);

    if (updateError) {
      logger.error('Ошибка при обновлении:', updateError);
    } else {
      logger.info('✅ customer_name обновлен: Yury Sihai → Anton Komissarov');
    }

    // Проверим результат
    const { data: updatedPayment, error: checkError } = await supabase
      .from('stripe_payments')
      .select('customer_name')
      .eq('session_id', sessionId)
      .single();

    if (!checkError && updatedPayment) {
      logger.info(`\nПроверка: customer_name = ${updatedPayment.customer_name}`);
    }

  } catch (err) {
    logger.error('Неожиданная ошибка:', err);
    process.exit(1);
  }
}

fixPaymentBySessionId();
