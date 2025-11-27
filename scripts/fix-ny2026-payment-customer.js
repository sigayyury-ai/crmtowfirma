require('dotenv').config();

const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');

async function fixNY2026PaymentCustomer() {
  if (!supabase) {
    logger.error('Supabase client is not initialized.');
    process.exit(1);
  }

  try {
    logger.info('Ищу и исправляю платеж NY2026 с Yury Sihai...\n');

    // Найдем платежи для продукта NY2026 (crm_product_id = 48)
    const { data: payments, error: paymentsError } = await supabase
      .from('stripe_payments')
      .select('*')
      .eq('product_id', '48'); // CRM product ID для NY2026

    if (paymentsError) {
      logger.error('Ошибка при получении платежей:', paymentsError);
      return;
    }

    logger.info(`Найдено платежей для NY2026: ${payments.length}`);

    payments.forEach((p, i) => {
      logger.info(`  ${i + 1}. customer_name: ${p.customer_name}, amount: ${p.original_amount} ${p.currency}`);
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
      logger.info('\nПлатежи с Yury Sihai не найдены');
    }

    // Проверим финальный результат
    const { data: updatedPayments, error: checkError } = await supabase
      .from('stripe_payments')
      .select('customer_name, original_amount, currency')
      .eq('product_id', '48');

    if (!checkError && updatedPayments) {
      logger.info('\nФинальный результат:');
      updatedPayments.forEach((p, i) => {
        logger.info(`  ${i + 1}. customer_name: ${p.customer_name}, amount: ${p.original_amount} ${p.currency}`);
      });
    }

  } catch (err) {
    logger.error('Неожиданная ошибка:', err);
    process.exit(1);
  }
}

fixNY2026PaymentCustomer();
