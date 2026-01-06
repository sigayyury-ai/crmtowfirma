require('dotenv').config();

const StripeProcessorService = require('../src/services/stripe/processor');
const supabase = require('../src/services/supabaseClient');
const CrmStatusAutomationService = require('../src/services/crm/statusAutomationService');
const logger = require('../src/utils/logger');

async function processRecentStripeSessions() {
  try {
    logger.info('🔍 Проверяю оплаченные сессии в Stripe за последние 2 дня...');

    const stripeProcessor = new StripeProcessorService();
    const statusAutomation = new CrmStatusAutomationService();

    // Вычисляем дату 2 дня назад
    const twoDaysAgo = Math.floor((Date.now() - 2 * 24 * 60 * 60 * 1000) / 1000);

    // Получаем все Checkout Sessions за последние 2 дня
    const sessions = await stripeProcessor.stripe.checkout.sessions.list({
      limit: 100,
      created: { gte: twoDaysAgo },
      expand: ['data.payment_intent']
    });

    logger.info(`Найдено сессий в Stripe: ${sessions.data.length}`);

    // Фильтруем только оплаченные сессии с deal_id
    const paidSessions = sessions.data.filter(session => {
      return session.payment_status === 'paid' && 
             session.metadata?.deal_id;
    });

    logger.info(`Оплаченных сессий с deal_id: ${paidSessions.length}`);

    let processed = 0;
    let missing = 0;
    let needsUpdate = 0;
    let errors = 0;

    for (const session of paidSessions) {
      const dealId = session.metadata.deal_id;
      const sessionId = session.id;

      try {
        // Проверяем, есть ли платеж в базе данных
        const { data: payment } = await supabase
          .from('stripe_payments')
          .select('*')
          .eq('session_id', sessionId)
          .single();

        if (!payment) {
          logger.info(`\n⚠️  Платеж не найден в БД: ${sessionId} (Deal: ${dealId})`);
          logger.info(`   Обрабатываю платеж...`);
          
          // Обрабатываем платеж
          await stripeProcessor.persistSession(session);
          missing++;
          processed++;
          
          logger.info(`   ✅ Платеж обработан и сохранен`);
        }

        // Проверяем статус сделки и отправляем уведомление
        logger.info(`   ⚙️  Проверяю статус сделки ${dealId}...`);
        
        const syncResult = await statusAutomation.syncDealStage(dealId, {
          reason: 'recent_payment_check',
          force: false
        });

        if (syncResult && syncResult.updated) {
          logger.info(`   ✅ Статус сделки обновлен`);
          needsUpdate++;
        }

        // Отправляем уведомление
        try {
          const snapshot = await statusAutomation.buildDealSnapshot(dealId);
          const evaluation = { paymentStatus: 'paid' };

          const notificationResult = await statusAutomation.sendPaymentReceivedNotification(
            dealId,
            snapshot,
            evaluation
          );

          if (notificationResult && notificationResult.success) {
            logger.info(`   ✅ Уведомление отправлено`);
          }
        } catch (notificationError) {
          logger.warn(`   ⚠️  Ошибка отправки уведомления: ${notificationError.message}`);
        }

        if (payment) {
          processed++;
        }

      } catch (error) {
        logger.error(`❌ Ошибка обработки сессии ${sessionId}:`, error.message);
        errors++;
      }
    }

    logger.info(`\n📊 ИТОГОВЫЕ РЕЗУЛЬТАТЫ:`);
    logger.info(`   Всего оплаченных сессий: ${paidSessions.length}`);
    logger.info(`   Обработано: ${processed}`);
    logger.info(`   Добавлено в БД: ${missing}`);
    logger.info(`   Статусов обновлено: ${needsUpdate}`);
    logger.info(`   Ошибок: ${errors}`);

    if (processed === paidSessions.length && errors === 0) {
      logger.info(`\n✅ Все сессии обработаны успешно!`);
    }

  } catch (error) {
    logger.error('❌ Критическая ошибка:', error);
  }
}

processRecentStripeSessions();
