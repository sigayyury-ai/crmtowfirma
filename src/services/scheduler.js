const cron = require('node-cron');
const { randomUUID } = require('crypto');
const InvoiceProcessingService = require('./invoiceProcessing');
const StripeProcessorService = require('./stripe/processor');
const logger = require('../utils/logger');

const DEFAULT_TIMEZONE = 'Europe/Warsaw';
const CRON_EXPRESSION = '0 * * * *'; // Каждый час, на отметке hh:00
// Stripe payments теперь обрабатываются через webhooks, polling оставлен только как fallback
// Запускается раз в час вместе с основным циклом для проверки пропущенных событий
const DELETION_CRON_EXPRESSION = '0 2 * * *'; // Раз в сутки в 2:00 ночи (редкий кейс)
const HISTORY_LIMIT = 48; // >= 24 записей (48 = ~2 суток)
const RETRY_DELAY_MINUTES = 15;

class SchedulerService {
  constructor(options = {}) {
    this.invoiceProcessing = options.invoiceProcessingService || new InvoiceProcessingService();
    this.stripeProcessor = options.stripeProcessorService || new StripeProcessorService();
    this.timezone = options.timezone || DEFAULT_TIMEZONE;
    this.cronExpression = options.cronExpression || CRON_EXPRESSION;
    this.retryDelayMinutes = options.retryDelayMinutes || RETRY_DELAY_MINUTES;
    this.historyLimit = options.historyLimit || HISTORY_LIMIT;

    this.isCronScheduled = false;
    this.isProcessing = false;
    this.currentRun = null;
    this.runHistory = [];
    this.cronJob = null;
    this.deletionCronJob = null;
    this.retryTimeout = null;
    this.retryScheduled = false;
    this.nextRetryAt = null;
    this.lastRunAt = null;
    this.lastResult = null;

    logger.info('SchedulerService initialized', {
      timezone: this.timezone,
      cronExpression: this.cronExpression,
      retryDelayMinutes: this.retryDelayMinutes
    });

    if (options.autoStart !== false) {
      this.start();
    }
  }

  start() {
    if (this.isCronScheduled) {
      logger.warn('Scheduler is already scheduled; skipping start');
      return;
    }

    // Основной cron для инвойсов и Stripe платежей (раз в час)
    // Stripe платежи теперь обрабатываются через webhooks, но оставляем fallback polling
    logger.info('Configuring hourly cron job for invoice and Stripe processing (fallback)');
    this.cronJob = cron.schedule(
      this.cronExpression,
      () => {
        this.runCycle({ trigger: 'cron', retryAttempt: 0 }).catch((error) => {
          logger.error('Unexpected error in cron cycle:', error);
        });
      },
      {
        scheduled: true,
        timezone: this.timezone
      }
    );

    this.isCronScheduled = true;
    logger.info('Cron job scheduled successfully', {
      cronExpression: this.cronExpression,
      timezone: this.timezone,
      note: 'Stripe payments are now processed via webhooks, hourly polling is fallback only'
    });

    // Отдельный cron для обработки удалений (раз в сутки в 2:00 ночи)
    // Удаления обрабатываются через webhooks, это только fallback для редких случаев
    logger.info('Configuring daily cron job for deletion processing (fallback)', {
      cronExpression: DELETION_CRON_EXPRESSION,
      timezone: this.timezone
    });
    this.deletionCronJob = cron.schedule(
      DELETION_CRON_EXPRESSION,
      () => {
        this.runDeletionCycle({ trigger: 'cron_deletion', retryAttempt: 0 }).catch((error) => {
          logger.error('Unexpected error in deletion cron cycle:', error);
        });
      },
      {
        scheduled: true,
        timezone: this.timezone
      }
    );

    // Немедленный запуск при старте, чтобы компенсировать возможные пропуски
    setImmediate(() => {
      this.runCycle({ trigger: 'startup', retryAttempt: 0 }).catch((error) => {
        logger.error('Startup invoice processing failed:', error);
      });
    });
  }

  stop() {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
    }

    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout);
      this.retryTimeout = null;
    }

    this.isCronScheduled = false;
    this.retryScheduled = false;
    this.nextRetryAt = null;

    logger.info('Scheduler stopped');
  }

  /**
   * Отдельный цикл для обработки только Stripe платежей (без инвойсов)
   * УДАЛЕНО: Теперь Stripe платежи обрабатываются через webhooks
   * Этот метод оставлен для обратной совместимости, но не используется в cron
   * @deprecated Используйте webhooks для обработки Stripe платежей
   */
  async runStripePaymentsCycle({ trigger = 'manual' }) {
    logger.warn('runStripePaymentsCycle is deprecated - Stripe payments are now processed via webhooks', {
      trigger
    });
    
    const runId = randomUUID();
    logger.info('Stripe payments processing run started (fallback mode)', { trigger, runId });

    try {
      // Обрабатываем только платежи Stripe (без создания новых Checkout Sessions)
      // Checkout Sessions создаются через webhooks
      const stripeResult = await this.stripeProcessor.processPendingPayments({
        trigger,
        runId,
        skipTriggers: true // Пропускаем создание новых Checkout Sessions (они создаются через webhooks)
      });

      // Рефанды для потерянных сделок теперь обрабатываются через webhooks
      // (при изменении статуса на "lost" с reason "Refund")
      // Не вызываем processLostDealRefunds() - это редкий кейс и обрабатывается мгновенно через webhook

      logger.info('Stripe payments processing run completed (fallback)', {
        trigger,
        runId,
        success: stripeResult?.success !== false,
        paymentsProcessed: stripeResult?.summary?.successful || 0
      });

      return {
        success: stripeResult?.success !== false,
        stripe: stripeResult,
        refunds: refundResult
      };
    } catch (error) {
      logger.error('Stripe payments processing failed', {
        trigger,
        runId,
        error: error.message
      });
      return {
        success: false,
        error: error.message
      };
    }
  }

  async runCycle({ trigger = 'manual', retryAttempt = 0 }) {
    if (this.isProcessing) {
      logger.warn('Invoice processing already in progress. Skipping new run.', { trigger });
      this.recordHistoryEntry({
        status: 'skipped',
        trigger,
        retryAttempt,
        message: 'Skipped due to ongoing processing'
      });
      return {
        success: false,
        skipped: true,
        reason: 'processing_in_progress'
      };
    }

    this.isProcessing = true;
    this.retryScheduled = false;
    this.nextRetryAt = null;

    const startedAt = new Date();
    const runId = randomUUID();
    logger.info('Invoice processing run started', { trigger, retryAttempt, runId });

    const entry = {
      id: runId,
      trigger,
      retryAttempt,
      startedAt: startedAt.toISOString(),
      finishedAt: null,
      durationMs: null,
      status: 'running',
      processed: {
        total: 0,
        successful: 0,
        errors: 0,
        deletions: 0
      },
      errors: [],
      message: null
    };
    this.currentRun = entry;

    let invoiceResult;
    let stripeResult;

    try {
      invoiceResult = await this.invoiceProcessing.processPendingInvoices({ trigger });
      
      // Stripe payments: обрабатываем только в cron (раз в час) как fallback для пропущенных webhooks
      // При старте системы пропускаем обработку Stripe, так как:
      // 1. Webhooks обрабатывают платежи в реальном времени
      // 2. Cron раз в час все равно проверит пропущенные платежи
      // 3. При старте все платежи уже обработаны и будут пропущены
      if (trigger !== 'startup') {
        // Stripe payments: обрабатываем только существующие сессии (fallback)
        // Checkout Sessions создаются через webhooks, не через polling
        stripeResult = await this.stripeProcessor.processPendingPayments({
          trigger,
          runId,
          skipTriggers: true // Пропускаем создание новых Checkout Sessions (они создаются через webhooks)
        });
      } else {
        // При старте пропускаем обработку Stripe - webhooks уже обработали все платежи
        stripeResult = {
          success: true,
          summary: { total: 0, successful: 0, errors: 0 },
          skipped: true,
          reason: 'skipped_on_startup',
          note: 'Stripe payments are processed via webhooks, startup processing skipped'
        };
        logger.info('Skipping Stripe processing on startup (webhooks handle payments in real-time)', {
          trigger,
          runId
        });
      }

      // Рефанды для потерянных сделок теперь обрабатываются через webhooks
      // (при изменении статуса на "lost" с reason "Refund")
      // Не вызываем processLostDealRefunds() в polling - это редкий кейс и обрабатывается мгновенно через webhook

      const { combinedSummary, invoiceSummary, stripeSummary } = this.buildCombinedSummary(
        invoiceResult,
        stripeResult
      );
      const combinedSuccess =
        (invoiceResult?.success !== false) && (stripeResult?.success !== false);

      const result = {
        success: combinedSuccess,
        summary: combinedSummary,
        invoice: invoiceResult,
        stripe: stripeResult
      };
      const finishedAt = new Date();
      const durationMs = finishedAt - startedAt;

      entry.finishedAt = finishedAt.toISOString();
      entry.durationMs = durationMs;
      entry.status = combinedSuccess ? 'success' : 'error';
      entry.processed = {
        total: combinedSummary.total,
        successful: combinedSummary.successful,
        errors: combinedSummary.errors,
        deletions: invoiceSummary.deletions || 0,
        stripeTotal: stripeSummary.total
      };
      entry.message = combinedSuccess
        ? `Processed invoices: ${invoiceSummary.successful}, stripe payments: ${stripeSummary.successful}`
        : (invoiceResult?.error || stripeResult?.error || 'Processing failed');
      entry.invoiceSummary = invoiceSummary;
      entry.stripeSummary = stripeSummary;
      entry.errors = [];
      if (Array.isArray(invoiceResult?.results)) {
        entry.errors.push(
          ...invoiceResult.results
            .filter((item) => !item.success)
            .map((item) => item.error || item.message || 'Invoice error')
        );
      }
      if (Array.isArray(stripeResult?.results)) {
        entry.errors.push(
          ...stripeResult.results
            .filter((item) => !item.success)
            .map((item) => item.error || item.message || 'Stripe error')
        );
      }

      this.lastResult = result;
      this.lastRunAt = finishedAt.toISOString();

      if (!combinedSuccess && trigger === 'cron' && retryAttempt === 0) {
        this.scheduleRetry();
      }

      // Извлекаем статистику API вызовов из invoiceResult
      const apiStats = invoiceResult?.stats?.apiCalls || {};
      
      if (!combinedSuccess) {
        logger.error('Invoice processing finished with errors', {
          trigger,
          retryAttempt,
          runId,
          durationMs,
          error: entry.message,
          invoiceSummary,
          stripeSummary,
          apiCalls: apiStats
        });
      } else {
        logger.info('Invoice processing finished successfully', {
          trigger,
          retryAttempt,
          runId,
          durationMs,
          invoiceSummary,
          stripeSummary,
          apiCalls: {
            pipedrive: apiStats.pipedrive || 0,
            wfirma: apiStats.wfirma || 0,
            other: apiStats.other || 0,
            total: apiStats.total || 0
          }
        });
      }

      return result;
    } catch (error) {
      const finishedAt = new Date();
      const durationMs = finishedAt - startedAt;

      entry.finishedAt = finishedAt.toISOString();
      entry.durationMs = durationMs;
      entry.status = 'error';
      entry.message = error.message || 'Unexpected error during invoice processing';
      entry.errors = [error.message || 'Unexpected error'];

      this.lastResult = {
        success: false,
        error: entry.message,
        summary: { successful: 0, errors: 1 },
        results: []
      };
      this.lastRunAt = finishedAt.toISOString();

      logger.error('Invoice processing crashed', {
        trigger,
        retryAttempt,
        runId,
        durationMs,
        error: error.message
      });

      if (trigger === 'cron' && retryAttempt === 0) {
        this.scheduleRetry();
      }

      return this.lastResult;
    } finally {
      this.currentRun = null;
      this.isProcessing = false;
      this.recordHistoryEntry(entry);
    }
  }

  scheduleRetry() {
    if (this.retryScheduled || this.retryTimeout) {
      logger.warn('Retry already scheduled, skipping duplicate retry setup');
      return;
    }

    const delayMs = this.retryDelayMinutes * 60 * 1000;
    const nextRetryAt = new Date(Date.now() + delayMs);
    this.retryScheduled = true;
    this.nextRetryAt = nextRetryAt.toISOString();

    logger.warn('Scheduling retry for invoice processing', {
      delayMinutes: this.retryDelayMinutes,
      nextRetryAt: this.nextRetryAt
    });

    this.retryTimeout = setTimeout(() => {
      this.retryTimeout = null;
      this.runCycle({ trigger: 'retry', retryAttempt: 1 }).catch((error) => {
        logger.error('Retry invoice processing failed with unexpected error:', error);
      });
    }, delayMs);
  }

  recordHistoryEntry(entry) {
    const snapshot = { ...entry };

    if (!snapshot.id) {
      snapshot.id = randomUUID();
    }

    if (!snapshot.startedAt) {
      snapshot.startedAt = new Date().toISOString();
    }

    if (!snapshot.finishedAt && snapshot.status !== 'running') {
      snapshot.finishedAt = new Date().toISOString();
    }

    if (
      typeof snapshot.durationMs !== 'number' &&
      snapshot.finishedAt &&
      snapshot.startedAt
    ) {
      snapshot.durationMs =
        new Date(snapshot.finishedAt).getTime() - new Date(snapshot.startedAt).getTime();
    }

    this.runHistory.push(snapshot);
    while (this.runHistory.length > this.historyLimit) {
      this.runHistory.shift();
    }
  }

  getStatus() {
    const nextRuns = [];

    if (this.cronJob && typeof this.cronJob.nextDates === 'function') {
      try {
        const nextDate = this.cronJob.nextDates();
        if (nextDate) {
          const nextRunDate = Array.isArray(nextDate) ? nextDate[0].toDate() : nextDate.toDate();
          nextRuns.push({
            nextRun: nextRunDate.toISOString()
          });
        }
      } catch (error) {
        logger.debug('Unable to compute next cron run via nextDates:', error.message);
      }
    }

    if (!nextRuns.length) {
      const manualNext = this.computeNextRunFallback();
      if (manualNext) {
        nextRuns.push({ nextRun: manualNext.toISOString() });
      }
    }

    return {
      isScheduled: this.isCronScheduled,
      isProcessing: this.isProcessing,
      lastRunAt: this.lastRunAt,
      nextRun: nextRuns[0]?.nextRun || null,
      retryScheduled: this.retryScheduled,
      nextRetryAt: this.nextRetryAt,
      currentRun: this.currentRun,
      lastResult: this.lastResult,
      historySize: this.runHistory.length,
      timezone: this.timezone,
      cronExpression: this.cronExpression
    };
  }

  getRunHistory() {
    return [...this.runHistory].reverse();
  }

  computeNextRunFallback() {
    const now = new Date();
    const next = new Date(now);
    next.setUTCMinutes(0, 0, 0);
    next.setUTCHours(next.getUTCHours() + 1);
    return next;
  }

  async runManualProcessing(label = 'manual') {
    logger.info('Manual invoice processing requested', { label });
    return this.runCycle({ trigger: label, retryAttempt: 0 });
  }

  /**
   * Отдельный цикл только для обработки удалений (запускается раз в сутки)
   * @param {Object} options - Опции запуска
   * @param {string} options.trigger - Триггер запуска
   * @param {number} options.retryAttempt - Номер попытки повтора
   * @returns {Promise<Object>} - Результат обработки удалений
   */
  async runDeletionCycle({ trigger = 'manual', retryAttempt = 0 }) {
    const runId = randomUUID();
    logger.info('Deletion processing cycle started', { trigger, retryAttempt, runId });

    try {
      const deletionResult = await this.invoiceProcessing.processDeletionRequests();
      
      if (!deletionResult.success) {
        logger.error('Deletion processing finished with errors', {
          trigger,
          retryAttempt,
          runId,
          error: deletionResult.error
        });
      } else {
        logger.info('Deletion processing finished successfully', {
          trigger,
          retryAttempt,
          runId,
          total: deletionResult.total,
          processed: deletionResult.processed,
          errors: deletionResult.errors
        });
      }

      return {
        success: deletionResult.success !== false,
        deletion: deletionResult
      };
    } catch (error) {
      logger.error('Deletion processing crashed', {
        trigger,
        retryAttempt,
        runId,
        error: error.message
      });
      return {
        success: false,
        error: error.message
      };
    }
  }

  normalizeSummary(result = {}) {
    const summary = result?.summary || {};
    return {
      total: summary.total ?? 0,
      successful: summary.successful ?? 0,
      errors: summary.errors ?? 0,
      deletions: summary.deletions ?? 0
    };
  }

  buildCombinedSummary(invoiceResult, stripeResult) {
    const invoiceSummary = this.normalizeSummary(invoiceResult);
    const stripeSummary = this.normalizeSummary(stripeResult);
    return {
      combinedSummary: {
        total: invoiceSummary.total + stripeSummary.total,
        successful: invoiceSummary.successful + stripeSummary.successful,
        errors: invoiceSummary.errors + stripeSummary.errors,
        deletions: invoiceSummary.deletions
      },
      invoiceSummary,
      stripeSummary
    };
  }
}

let sharedScheduler = null;

function getScheduler(options) {
  if (!sharedScheduler) {
    sharedScheduler = new SchedulerService(options);
  }
  return sharedScheduler;
}

module.exports = SchedulerService;
module.exports.getScheduler = getScheduler;
