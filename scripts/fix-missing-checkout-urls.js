require('dotenv').config();

const supabase = require('../src/services/supabaseClient');
const StripeProcessorService = require('../src/services/stripe/processor');
const logger = require('../src/utils/logger');

async function fixMissingCheckoutUrls() {
  if (!supabase) {
    logger.error('Supabase client is not initialized.');
    process.exit(1);
  }

  try {
    logger.info('🔧 Исправляю платежи без checkout_url...');

    // Находим платежи без checkout_url
    const { data: paymentsWithoutUrl, error: findError } = await supabase
      .from('stripe_payments')
      .select('*')
      .is('checkout_url', null)
      .not('session_id', 'is', null)
      .limit(100);

    if (findError) {
      logger.error('Ошибка поиска платежей:', findError);
      return;
    }

    logger.info(`Найдено ${paymentsWithoutUrl?.length || 0} платежей без checkout_url`);

    if (!paymentsWithoutUrl || paymentsWithoutUrl.length === 0) {
      logger.info('✅ Все платежи имеют checkout_url');
      return;
    }

    const stripeProcessor = new StripeProcessorService();
    let fixed = 0;
    let errors = 0;

    for (const payment of paymentsWithoutUrl) {
      try {
        logger.info(`Обрабатываю платеж ${payment.session_id} (Deal: ${payment.deal_id})`);

        // Получаем сессию из Stripe API
        const session = await stripeProcessor.stripe.checkout.sessions.retrieve(payment.session_id);

        if (session && session.url) {
          // Обновляем checkout_url в базе данных
          const { error: updateError } = await supabase
            .from('stripe_payments')
            .update({ checkout_url: session.url })
            .eq('id', payment.id);

          if (updateError) {
            logger.error(`❌ Ошибка обновления checkout_url для ${payment.session_id}:`, updateError);
            errors++;
          } else {
            logger.info(`✅ Обновлен checkout_url для ${payment.session_id}`);
            fixed++;
          }
        } else {
          logger.warn(`⚠️  URL не найден в Stripe для сессии ${payment.session_id}`);
        }

      } catch (sessionError) {
        logger.error(`❌ Ошибка получения сессии ${payment.session_id}:`, sessionError.message);
        errors++;
      }
    }

    logger.info(`🎉 Завершено! Исправлено: ${fixed}, Ошибок: ${errors}`);

  } catch (error) {
    logger.error('❌ Критическая ошибка:', error);
  }
}

fixMissingCheckoutUrls();
