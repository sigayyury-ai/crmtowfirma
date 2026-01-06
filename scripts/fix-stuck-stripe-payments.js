require('dotenv').config();

const supabase = require('../src/services/supabaseClient');
const StripeProcessorService = require('../src/services/stripe/processor');
const CrmStatusAutomationService = require('../src/services/crm/statusAutomationService');
const PipedriveClient = require('../src/services/pipedrive');
const logger = require('../src/utils/logger');

async function fixStuckStripePayments() {
  if (!supabase) {
    logger.error('Supabase client is not initialized.');
    process.exit(1);
  }

  try {
    logger.info('🔧 Начинаю исправление застрявших Stripe платежей...');

    const stripeProcessor = new StripeProcessorService();
    const statusAutomation = new CrmStatusAutomationService();
    const pipedrive = new PipedriveClient();

    let totalProcessed = 0;
    let totalFixed = 0;
    let totalErrors = 0;

    // 1. Исправляем платежи без checkout_url (если колонка существует)
    logger.info('📝 Шаг 1: Исправляем checkout_url...');
    try {
      const { data: paymentsWithoutUrl } = await supabase
        .from('stripe_payments')
        .select('id, session_id')
        .is('checkout_url', null)
        .not('session_id', 'is', null)
        .limit(10);

      if (paymentsWithoutUrl && paymentsWithoutUrl.length > 0) {
        logger.info(`Найдено ${paymentsWithoutUrl.length} платежей без checkout_url`);

        for (const payment of paymentsWithoutUrl) {
          try {
            const session = await stripeProcessor.stripe.checkout.sessions.retrieve(payment.session_id);
            if (session?.url) {
              await supabase
                .from('stripe_payments')
                .update({ checkout_url: session.url })
                .eq('id', payment.id);
              logger.info(`✅ Исправлен checkout_url для ${payment.session_id}`);
            }
          } catch (error) {
            logger.warn(`⚠️  Не удалось исправить checkout_url для ${payment.session_id}: ${error.message}`);
          }
        }
      }
    } catch (error) {
      logger.warn(`⚠️  Не удалось проверить checkout_url (колонка может отсутствовать): ${error.message}`);
    }

    // 2. Ищем платежи со статусом "unpaid" и пытаемся их исправить
    logger.info('🔍 Шаг 2: Ищем платежи со статусом unpaid...');

    const { data: unpaidPayments, error: unpaidError } = await supabase
      .from('stripe_payments')
      .select('*')
      .eq('payment_status', 'unpaid')
      .not('deal_id', 'is', null)
      .limit(10);

    if (unpaidError) {
      logger.error('Ошибка поиска unpaid платежей:', unpaidError);
    } else if (unpaidPayments && unpaidPayments.length > 0) {
      logger.info(`Найдено ${unpaidPayments.length} платежей со статусом unpaid`);

      for (const payment of unpaidPayments) {
        totalProcessed++;
        try {
          logger.info(`Обрабатываю unpaid платеж: ${payment.session_id} (Deal: ${payment.deal_id})`);

          // Проверяем статус в Stripe
          const session = await stripeProcessor.stripe.checkout.sessions.retrieve(payment.session_id);

          if (session.payment_status === 'paid') {
            logger.info(`✅ Платеж в Stripe оплачен, исправляем статус в БД`);

            // Обновляем статус в БД
            await stripeProcessor.repository.updatePaymentStatus(payment.session_id, 'paid');

            // Запускаем обработку платежа
            await stripeProcessor.persistSession(session);

            // Обновляем статус сделки
            await statusAutomation.syncDealStage(payment.deal_id, {
              reason: 'fix_unpaid_payment',
              force: true
            });

            // Отправляем уведомление
            const snapshot = await statusAutomation.buildDealSnapshot(payment.deal_id);
            const evaluation = { paymentStatus: 'paid' };
            await statusAutomation.sendPaymentReceivedNotification(payment.deal_id, snapshot, evaluation);

            totalFixed++;
            logger.info(`🎉 Исправлен unpaid платеж для сделки ${payment.deal_id}`);

          } else {
            logger.info(`⚠️  Платеж в Stripe имеет статус: ${session.payment_status}`);
          }

        } catch (error) {
          logger.error(`❌ Ошибка обработки unpaid платежа ${payment.session_id}:`, error.message);
          totalErrors++;
        }
      }
    } else {
      logger.info('✅ Не найдено платежей со статусом unpaid');
    }

    // 3. Проверяем платежи без deal_id - можем ли мы их связать
    logger.info('🔗 Шаг 3: Проверяем платежи без deal_id...');

    const { data: orphanPayments, error: orphanError } = await supabase
      .from('stripe_payments')
      .select('*')
      .is('deal_id', null)
      .eq('payment_status', 'paid')
      .limit(5);

    if (orphanError) {
      logger.error('Ошибка поиска orphan платежей:', orphanError);
    } else if (orphanPayments && orphanPayments.length > 0) {
      logger.info(`Найдено ${orphanPayments.length} оплаченных платежей без deal_id`);
      logger.warn('⚠️  Эти платежи нужно связать с сделками вручную через админку');
    }

    logger.info(`📊 Результаты исправления:`);
    logger.info(`   Обработано: ${totalProcessed}`);
    logger.info(`   Исправлено: ${totalFixed}`);
    logger.info(`   Ошибок: ${totalErrors}`);

    if (totalFixed > 0) {
      logger.info('🎉 Застрявшие платежи успешно исправлены!');
    } else {
      logger.info('ℹ️  Не найдено платежей, требующих исправления');
    }

  } catch (error) {
    logger.error('❌ Критическая ошибка:', error);
  }
}

fixStuckStripePayments();
