/**
 * Сервис для мониторинга и обработки сессий из Events кабинета Stripe
 * 
 * Проблема: Сессии, созданные в Events кабинете (из-за неправильной конфигурации),
 * не обрабатываются webhook'ами, так как webhook настроен на основной кабинет.
 * 
 * Решение: Периодически проверяем сессии в Events кабинете с deal_id
 * и обрабатываем их, если они оплачены.
 */

const { getStripeClient } = require('./client');
const StripeProcessorService = require('./processor');
const StripeRepository = require('./repository');
const logger = require('../../utils/logger');

class EventsCabinetMonitorService {
  constructor() {
    this.stripeEvents = getStripeClient({ type: 'events' });
    this.stripeProcessor = new StripeProcessorService();
    this.repository = new StripeRepository();
  }

  /**
   * Проверяет сессии в Events кабинете с deal_id и обрабатывает оплаченные
   * @param {Object} options
   * @param {string} options.trigger - Источник запуска (cron, manual, etc.)
   * @param {number} options.limit - Максимальное количество сессий для проверки
   * @param {number} options.hoursBack - Сколько часов назад проверять (по умолчанию 24)
   */
  async checkAndProcessEventsCabinetSessions(options = {}) {
    const { trigger = 'manual', limit = 100, hoursBack = 24 } = options;
    const runId = `events_cabinet_monitor_${Date.now()}`;

    logger.info('🔍 Starting Events Cabinet sessions check', {
      trigger,
      runId,
      limit,
      hoursBack
    });

    try {
      // Получаем сессии из Events кабинета
      const cutoffTime = Math.floor((Date.now() - hoursBack * 60 * 60 * 1000) / 1000);
      
      const sessions = [];
      let hasMore = true;
      let startingAfter = null;
      const batchLimit = 100;

      while (hasMore && sessions.length < limit) {
        const params = {
          limit: Math.min(batchLimit, limit - sessions.length),
          expand: ['data.customer', 'data.payment_intent']
        };

        if (startingAfter) {
          params.starting_after = startingAfter;
        }

        const response = await this.stripeEvents.checkout.sessions.list(params);
        const batch = response.data.filter(session => {
          // Фильтруем только сессии с deal_id
          const hasDealId = session.metadata?.deal_id;
          // И только те, что созданы не раньше cutoffTime
          const isRecent = session.created >= cutoffTime;
          return hasDealId && isRecent;
        });

        sessions.push(...batch);

        hasMore = response.has_more;
        if (hasMore && response.data.length > 0) {
          startingAfter = response.data[response.data.length - 1].id;
        }

        // Если нашли достаточно сессий или все старые, выходим
        if (sessions.length >= limit || (response.data.length > 0 && response.data[response.data.length - 1].created < cutoffTime)) {
          hasMore = false;
        }
      }

      logger.info(`📊 Found ${sessions.length} sessions with deal_id in Events cabinet`, {
        runId,
        checkedPeriod: `${hoursBack} hours`,
        cutoffTime: new Date(cutoffTime * 1000).toISOString()
      });

      if (sessions.length === 0) {
        logger.info('✅ No sessions with deal_id found in Events cabinet', { runId });
        return {
          success: true,
          processed: 0,
          skipped: 0,
          errors: 0
        };
      }

      // Обрабатываем сессии
      const results = {
        processed: 0,
        skipped: 0,
        errors: 0,
        details: []
      };

      for (const session of sessions) {
        const dealId = session.metadata?.deal_id;
        const sessionId = session.id;
        const paymentStatus = session.payment_status || session.status;

        try {
          // Проверяем, есть ли уже запись в БД
          const existingPayment = await this.repository.findPaymentBySessionId(sessionId);

          if (existingPayment) {
            // Если уже есть в БД, проверяем статус
            if (existingPayment.payment_status === 'paid' && paymentStatus === 'paid') {
              logger.debug(`⏭️  Session ${sessionId} already processed`, {
                dealId,
                sessionId,
                runId
              });
              results.skipped++;
              continue;
            }

            // Если статус изменился, обновляем
            if (existingPayment.payment_status !== paymentStatus && paymentStatus === 'paid') {
              logger.info(`🔄 Updating payment status for session ${sessionId}`, {
                dealId,
                sessionId,
                oldStatus: existingPayment.payment_status,
                newStatus: paymentStatus,
                runId
              });
            }
          }

          // Обрабатываем только оплаченные сессии
          if (paymentStatus === 'paid' || paymentStatus === 'complete') {
            logger.info(`💰 Processing paid session from Events cabinet`, {
              dealId,
              sessionId,
              amount: session.amount_total ? (session.amount_total / 100).toFixed(2) : 'N/A',
              currency: session.currency?.toUpperCase() || 'N/A',
              runId
            });

            // Используем StripeProcessorService для обработки сессии
            // НО используем сессию из Events кабинета
            // ВАЖНО: persistSession использует основной Stripe клиент, но мы передаем сессию из Events кабинета
            // Это нормально, так как сессия уже создана, мы просто обрабатываем её данные
            await this.stripeProcessor.persistSession(session);
            
            // Синхронизируем ожидания по наличным (если функция доступна)
            try {
              const { syncCashExpectationFromStripeSession } = require('../../routes/stripeWebhook');
              if (typeof syncCashExpectationFromStripeSession === 'function') {
                await syncCashExpectationFromStripeSession(session);
              }
            } catch (error) {
              logger.warn('Could not sync cash expectation', {
                dealId,
                sessionId,
                error: error.message
              });
            }

            results.processed++;
            results.details.push({
              dealId,
              sessionId,
              status: 'processed',
              amount: session.amount_total ? (session.amount_total / 100) : null,
              currency: session.currency
            });
          } else {
            logger.debug(`⏭️  Skipping unpaid session ${sessionId}`, {
              dealId,
              sessionId,
              paymentStatus,
              runId
            });
            results.skipped++;
          }
        } catch (error) {
          logger.error(`❌ Error processing session ${sessionId}`, {
            dealId,
            sessionId,
            error: error.message,
            stack: error.stack,
            runId
          });
          results.errors++;
          results.details.push({
            dealId,
            sessionId,
            status: 'error',
            error: error.message
          });
        }
      }

      logger.info('✅ Events Cabinet sessions check completed', {
        runId,
        processed: results.processed,
        skipped: results.skipped,
        errors: results.errors,
        total: sessions.length
      });

      return {
        success: true,
        ...results
      };

    } catch (error) {
      logger.error('❌ Events Cabinet sessions check failed', {
        error: error.message,
        stack: error.stack,
        runId
      });
      return {
        success: false,
        error: error.message,
        processed: 0,
        skipped: 0,
        errors: 0
      };
    }
  }
}

module.exports = EventsCabinetMonitorService;

