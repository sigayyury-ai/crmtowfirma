require('dotenv').config();

const StripeProcessorService = require('../src/services/stripe/processor');
const logger = require('../src/utils/logger');

async function processMissingStripePayment() {
  const sessionId = 'cs_live_a1DFJnN8YeKzIvoQsOehr8eMLk90sfC1880FTFKIGZBDOwiIzsYD6BLrSa';

  logger.info('🔄 Начинаю обработку пропущенного Stripe платежа', { sessionId });

  try {
    const stripeProcessor = new StripeProcessorService();

    // Получаем сессию из Stripe API
    const session = await stripeProcessor.stripe.checkout.sessions.retrieve(sessionId);

    logger.info('📋 Получена информация о сессии', {
      sessionId: session.id,
      paymentStatus: session.payment_status,
      amount: session.amount_total / 100,
      currency: session.currency,
      dealId: session.metadata?.deal_id,
      customerEmail: session.customer_details?.email
    });

    // Проверяем, не был ли уже обработан платеж
    const existingPayment = await stripeProcessor.repository.findPaymentBySessionId(sessionId);
    if (existingPayment) {
      logger.warn('⚠️  Платеж уже существует в базе данных', {
        sessionId,
        paymentId: existingPayment.id,
        paymentStatus: existingPayment.payment_status
      });
      return existingPayment;
    }

    // Обрабатываем платеж через processor
    logger.info('⚙️  Обрабатываю платеж через StripeProcessor...');

    // Сначала попробуем сохранить платеж напрямую, без checkout_url
    try {
      const paymentData = {
        session_id: session.id,
        deal_id: session.metadata?.deal_id,
        customer_name: session.customer_details?.name || null,
        customer_email: session.customer_details?.email || null,
        original_amount: session.amount_total / 100,
        currency: session.currency,
        payment_status: session.payment_status || 'paid',
        payment_mode: session.mode || null,
        created_at: session.created ? new Date(session.created * 1000).toISOString() : new Date().toISOString(),
        processed_at: new Date().toISOString(),
        raw_payload: session
      };

      // Сохраняем без checkout_url сначала
      const { error: saveError } = await stripeProcessor.repository.supabase
        .from('stripe_payments')
        .insert(paymentData);

      if (saveError) {
        logger.error('❌ Ошибка сохранения платежа', { error: saveError });
        throw saveError;
      }

      logger.info('✅ Платеж сохранен в базу данных (без checkout_url)');

      // Теперь пытаемся обновить checkout_url отдельно
      try {
        await stripeProcessor.repository.supabase
          .from('stripe_payments')
          .update({ checkout_url: session.url || null })
          .eq('session_id', session.id);

        logger.info('✅ Checkout URL обновлен');
      } catch (urlError) {
        logger.warn('⚠️  Не удалось обновить checkout_url, но платеж сохранен', { error: urlError.message });
      }

      // Теперь продолжаем с обычной обработкой
      const result = await stripeProcessor.persistSession(session);
      return result;

    } catch (directSaveError) {
      logger.warn('Прямое сохранение не удалось, пробуем через processor', { error: directSaveError.message });
      const result = await stripeProcessor.persistSession(session);
      return result;
    }

    logger.info('✅ Платеж успешно обработан и сохранен', {
      sessionId,
      dealId: session.metadata?.deal_id,
      result
    });

    // Проверяем, что платеж сохранился в базе
    const savedPayment = await stripeProcessor.repository.findPaymentBySessionId(sessionId);
    if (savedPayment) {
      logger.info('💾 Платеж подтвержден в базе данных', {
        sessionId,
        paymentId: savedPayment.id,
        paymentStatus: savedPayment.payment_status,
        checkoutUrl: savedPayment.checkout_url
      });
    } else {
      logger.error('❌ Платеж не найден в базе данных после обработки');
    }

    return savedPayment;

  } catch (error) {
    logger.error('❌ Ошибка обработки платежа', {
      sessionId,
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

// Запускаем обработку
processMissingStripePayment()
  .then((result) => {
    logger.info('🎉 Обработка завершена успешно', { result });
    process.exit(0);
  })
  .catch((error) => {
    logger.error('💥 Критическая ошибка при обработке платежа', { error: error.message });
    process.exit(1);
  });
