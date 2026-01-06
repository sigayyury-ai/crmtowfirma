require('dotenv').config();

const supabase = require('../src/services/supabaseClient');
const CrmStatusAutomationService = require('../src/services/crm/statusAutomationService');
const PipedriveClient = require('../src/services/pipedrive');
const logger = require('../src/utils/logger');

async function processLinkedPayments() {
  if (!supabase) {
    logger.error('Supabase client is not initialized.');
    process.exit(1);
  }

  try {
    logger.info('🔄 Обрабатываю недавно связанные платежи...');

    const statusAutomation = new CrmStatusAutomationService();
    const pipedrive = new PipedriveClient();

    // Находим платежи, которые были недавно связаны с deal_id
    // (предполагаем, что они были связаны в последние 24 часа)
    const yesterday = new Date();
    yesterday.setHours(yesterday.getHours() - 24);

    const { data: recentlyLinkedPayments, error } = await supabase
      .from('stripe_payments')
      .select('*')
      .not('deal_id', 'is', null)
      .eq('payment_status', 'paid')
      .gte('updated_at', yesterday.toISOString())
      .order('updated_at', { ascending: false })
      .limit(50);

    if (error) {
      logger.error('Ошибка получения недавно связанных платежей:', error);
      return;
    }

    if (!recentlyLinkedPayments || recentlyLinkedPayments.length === 0) {
      logger.info('ℹ️  Не найдено недавно связанных платежей');
      logger.info('💡 Если вы только что связали платежи, подождите несколько минут и запустите скрипт снова');
      return;
    }

    logger.info(`Найдено ${recentlyLinkedPayments.length} недавно связанных платежей`);

    let processed = 0;
    let statusUpdated = 0;
    let notificationsSent = 0;
    let errors = 0;

    for (const payment of recentlyLinkedPayments) {
      try {
        logger.info(`\n⚙️  Обрабатываю платеж ${payment.session_id} для сделки ${payment.deal_id}`);

        // Проверяем, существует ли сделка в Pipedrive
        const deal = await pipedrive.getDeal(payment.deal_id);
        if (!deal) {
          logger.warn(`⚠️  Сделка ${payment.deal_id} не найдена в Pipedrive`);
          continue;
        }

        logger.info(`✅ Сделка найдена: "${deal.title}" (статус: ${deal.status})`);

        // Запускаем автоматизацию статуса
        const syncResult = await statusAutomation.syncDealStage(payment.deal_id, {
          reason: 'linked_payment_processed',
          force: false // Не принудительно, пусть логика сама решит
        });

        if (syncResult && syncResult.updated) {
          logger.info(`✅ Статус сделки обновлен`);
          statusUpdated++;
        } else {
          logger.info(`ℹ️  Статус сделки не требует обновления`);
        }

        // Отправляем уведомление о платеже
        try {
          const snapshot = await statusAutomation.buildDealSnapshot(payment.deal_id);
          const evaluation = { paymentStatus: 'paid' };

          const notificationResult = await statusAutomation.sendPaymentReceivedNotification(
            payment.deal_id,
            snapshot,
            evaluation
          );

          if (notificationResult && notificationResult.success) {
            logger.info(`✅ Уведомление отправлено`);
            notificationsSent++;
          } else {
            logger.warn(`⚠️  Не удалось отправить уведомление`);
          }
        } catch (notificationError) {
          logger.warn(`⚠️  Ошибка отправки уведомления: ${notificationError.message}`);
        }

        processed++;

      } catch (paymentError) {
        logger.error(`❌ Ошибка обработки платежа ${payment.session_id}:`, paymentError.message);
        errors++;
      }
    }

    logger.info(`\n📊 ИТОГИ ОБРАБОТКИ:`);
    logger.info(`   Обработано платежей: ${processed}`);
    logger.info(`   Статусов обновлено: ${statusUpdated}`);
    logger.info(`   Уведомлений отправлено: ${notificationsSent}`);
    logger.info(`   Ошибок: ${errors}`);

    if (processed > 0) {
      logger.info(`\n🎉 Связывание платежей завершено успешно!`);
    }

  } catch (error) {
    logger.error('❌ Критическая ошибка:', error);
  }
}

processLinkedPayments();
