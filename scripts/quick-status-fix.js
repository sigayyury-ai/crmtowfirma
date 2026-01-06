require('dotenv').config();

const supabase = require('../src/services/supabaseClient');
const CrmStatusAutomationService = require('../src/services/crm/statusAutomationService');
const logger = require('../src/utils/logger');

async function quickStatusFix() {
  if (!supabase) {
    logger.error('Supabase client is not initialized.');
    process.exit(1);
  }

  const dealIds = process.argv.slice(2); // Получаем deal_id из аргументов командной строки

  if (dealIds.length === 0) {
    logger.info('💡 Использование: node scripts/quick-status-fix.js DEAL_ID [DEAL_ID ...]');
    logger.info('Пример: node scripts/quick-status-fix.js 1849 1850 1851');
    process.exit(0);
  }

  try {
    logger.info(`🔄 Исправляю статус для ${dealIds.length} сделок...`);

    const statusAutomation = new CrmStatusAutomationService();
    let processed = 0;
    let updated = 0;
    let notifications = 0;

    for (const dealId of dealIds) {
      try {
        logger.info(`\n⚙️  Обрабатываю сделку ${dealId}...`);

        // Синхронизируем статус
        const syncResult = await statusAutomation.syncDealStage(dealId, {
          reason: 'manual_status_fix',
          force: true
        });

        if (syncResult && syncResult.updated) {
          logger.info(`✅ Статус сделки ${dealId} обновлен`);
          updated++;
        } else {
          logger.info(`ℹ️  Статус сделки ${dealId} не требует обновления`);
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
            logger.info(`✅ Уведомление для сделки ${dealId} отправлено`);
            notifications++;
          }
        } catch (notificationError) {
          logger.warn(`⚠️  Не удалось отправить уведомление для ${dealId}: ${notificationError.message}`);
        }

        processed++;

      } catch (error) {
        logger.error(`❌ Ошибка обработки сделки ${dealId}:`, error.message);
      }
    }

    logger.info(`\n📊 РЕЗУЛЬТАТЫ:`);
    logger.info(`   Обработано: ${processed}`);
    logger.info(`   Статусов обновлено: ${updated}`);
    logger.info(`   Уведомлений отправлено: ${notifications}`);

  } catch (error) {
    logger.error('❌ Критическая ошибка:', error);
  }
}

quickStatusFix();
