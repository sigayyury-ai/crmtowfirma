const cron = require('node-cron');
const { randomUUID } = require('crypto');
const InvoiceProcessingService = require('./invoiceProcessing');
const StripeProcessorService = require('./stripe/processor');
const logger = require('../utils/logger');

const DEFAULT_TIMEZONE = 'Europe/Warsaw';
const CRON_EXPRESSION = '0 * * * *'; // Каждый час, на отметке hh:00
const STRIPE_PAYMENTS_CRON_EXPRESSION = '*/15 * * * *'; // Каждые 15 минут для обработки Stripe платежей
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
    this.isStripePaymentsCronScheduled = false;
    this.isProcessing = false;
    this.isStripePaymentsProcessing = false;
    this.currentRun = null;
    this.runHistory = [];
    this.cronJob = null;
    this.stripePaymentsCronJob = null;
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

    // Основной cron для инвойсов (раз в час)
    logger.info('Configuring hourly cron job for invoice processing');
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

    // Отдельный cron для Stripe платежей (каждые 15 минут) - для быстрого обновления статусов
    logger.info('Configuring frequent cron job for Stripe payments processing');
    this.stripePaymentsCronJob = cron.schedule(
      STRIPE_PAYMENTS_CRON_EXPRESSION,
      () => {
        this.runStripePaymentsCycle({ trigger: 'stripe_payments_cron' }).catch((error) => {
          logger.error('Unexpected error in Stripe payments cron cycle:', error);
        });
      },
      {
        scheduled: true,
        timezone: this.timezone
      }
    );

    this.isCronScheduled = true;
    this.isStripePaymentsCronScheduled = true;
    logger.info('Cron jobs scheduled successfully', {
      invoiceCronExpression: this.cronExpression,
      stripePaymentsCronExpression: STRIPE_PAYMENTS_CRON_EXPRESSION,
      timezone: this.timezone
    });

    // Немедленный запуск при старте, чтобы компенсировать возможные пропуски
    setImmediate(() => {
      this.runCycle({ trigger: 'startup', retryAttempt: 0 }).catch((error) => {
        logger.error('Startup invoice processing failed:', error);
      });
      // Также запускаем обработку Stripe платежей при старте
      this.runStripePaymentsCycle({ trigger: 'startup' }).catch((error) => {
        logger.error('Startup Stripe payments processing failed:', error);
      });
    });
  }

  stop() {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
    }

    if (this.stripePaymentsCronJob) {
      this.stripePaymentsCronJob.stop();
      this.stripePaymentsCronJob = null;
    }

    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout);
      this.retryTimeout = null;
    }

    this.isCronScheduled = false;
    this.isStripePaymentsCronScheduled = false;
    this.retryScheduled = false;
    this.nextRetryAt = null;

    logger.info('Scheduler stopped');
  }

  /**
   * Отдельный цикл для обработки только Stripe платежей (без инвойсов)
   * Запускается чаще (каждые 15 минут) для быстрого обновления статусов и задач
   */
  async runStripePaymentsCycle({ trigger = 'manual' }) {
    if (this.isStripePaymentsProcessing) {
      logger.warn('Stripe payments processing already in progress. Skipping new run.', { trigger });
      return {
        success: false,
        skipped: true,
        reason: 'processing_in_progress'
      };
    }

    this.isStripePaymentsProcessing = true;
    const runId = randomUUID();
    logger.info('Stripe payments processing run started', { trigger, runId });

    try {
      // Обрабатываем только платежи Stripe (без создания новых Checkout Sessions)
      // Checkout Sessions создаются в основном цикле раз в час
      const stripeResult = await this.stripeProcessor.processPendingPayments({
        trigger,
        runId,
        skipTriggers: true // Пропускаем создание новых Checkout Sessions
      });

      // Обрабатываем рефанды для потерянных сделок
      let refundResult = null;
      try {
        refundResult = await this.stripeProcessor.processLostDealRefunds({
          trigger,
          runId
        });
        if (refundResult && refundResult.summary) {
          logger.info('Lost deal refunds processed', {
            trigger,
            runId,
            refundsCreated: refundResult.summary.refundsCreated,
            totalDeals: refundResult.summary.totalDeals
          });
        }
      } catch (refundError) {
        logger.error('Failed to process lost deal refunds', {
          trigger,
          runId,
          error: refundError.message
        });
      }

      logger.info('Stripe payments processing run completed', {
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
    } finally {
      this.isStripePaymentsProcessing = false;
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
      invoiceResult = await this.invoiceProcessing.processPendingInvoices();
      stripeResult = await this.stripeProcessor.processPendingPayments({
        trigger,
        runId
      });

      // Process refunds for lost deals
      let refundResult = null;
      try {
        refundResult = await this.stripeProcessor.processLostDealRefunds({
          trigger,
          runId
        });
        if (refundResult && refundResult.summary) {
          logger.info('Lost deal refunds processed', {
            trigger,
            runId,
            refundsCreated: refundResult.summary.refundsCreated,
            totalDeals: refundResult.summary.totalDeals
          });
        }
      } catch (refundError) {
        logger.error('Failed to process lost deal refunds', {
          trigger,
          runId,
          error: refundError.message
        });
        // Don't fail the entire cycle if refund processing fails
      }

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

      if (!combinedSuccess) {
        logger.error('Invoice processing finished with errors', {
          trigger,
          retryAttempt,
          runId,
          durationMs,
          error: entry.message,
          stripeSummary
        });
      } else {
        logger.info('Invoice processing finished successfully', {
          trigger,
          retryAttempt,
          runId,
          durationMs,
          invoiceSummary,
          stripeSummary
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
