require('dotenv').config();

const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');

async function fixStripePaymentsDeal1626() {
  if (!supabase) {
    logger.error('Supabase client is not initialized.');
    process.exit(1);
  }

  try {
    logger.info('Ищу и исправляю Stripe платежи для deal 1626...\n');

    // Найдем все платежи для deal 1626
    const { data: payments, error: paymentsError } = await supabase
      .from('stripe_payments')
      .select('*')
      .eq('deal_id', '1626');

    if (paymentsError) {
      logger.error('Ошибка при получении платежей:', paymentsError);
      return;
    }

    logger.info(`Найдено платежей для deal 1626: ${payments.length}`);

    if (payments.length === 0) {
      logger.info('Нет платежей для исправления.');
      return;
    }

    // Покажем текущие платежи
    payments.forEach((p, i) => {
      logger.info(`  ${i + 1}. ${p.payment_type}: ${p.customer_name} - ${p.original_amount} ${p.currency} (${p.status})`);
    });

    // Найдем платежи с Yury Sihai
    const yuryPayments = payments.filter(p => p.customer_name && p.customer_name.toLowerCase().includes('yury'));

    if (yuryPayments.length > 0) {
      logger.info(`\nНайдено ${yuryPayments.length} платежей с Yury Sihai, обновляю на Anton Komissarov...`);

      for (const payment of yuryPayments) {
        const { error: updateError } = await supabase
          .from('stripe_payments')
          .update({
            customer_name: 'Anton Komissarov',
            updated_at: new Date().toISOString()
          })
          .eq('id', payment.id);

        if (updateError) {
          logger.error(`Ошибка при обновлении платежа ${payment.id}:`, updateError);
        } else {
          logger.info(`✅ Обновлен платеж ${payment.id}: Yury Sihai → Anton Komissarov`);
        }
      }
    } else {
      logger.info('\nВсе платежи уже имеют правильного плательщика Anton Komissarov');
    }

    // Проверим финальный результат
    const { data: updatedPayments, error: checkError } = await supabase
      .from('stripe_payments')
      .select('customer_name, payment_type, original_amount, currency')
      .eq('deal_id', '1626');

    if (!checkError && updatedPayments) {
      logger.info('\nФинальный результат:');
      updatedPayments.forEach((p, i) => {
        logger.info(`  ${i + 1}. ${p.payment_type}: ${p.customer_name} - ${p.original_amount} ${p.currency}`);
      });
    }

  } catch (err) {
    logger.error('Неожиданная ошибка:', err);
    process.exit(1);
  }
}

fixStripePaymentsDeal1626();
