const cron = require('node-cron');
const { randomUUID } = require('crypto');
const InvoiceProcessingService = require('./invoiceProcessing');
const logger = require('../utils/logger');

const DEFAULT_TIMEZONE = 'Europe/Warsaw';
const CRON_EXPRESSION = '0 * * * *'; // Каждый час, на отметке hh:00
const HISTORY_LIMIT = 48; // >= 24 записей (48 = ~2 суток)
const RETRY_DELAY_MINUTES = 15;

class SchedulerService {
  constructor(options = {}) {
    this.invoiceProcessing = options.invoiceProcessingService || new InvoiceProcessingService();
    this.timezone = options.timezone || DEFAULT_TIMEZONE;
    this.cronExpression = options.cronExpression || CRON_EXPRESSION;
    this.retryDelayMinutes = options.retryDelayMinutes || RETRY_DELAY_MINUTES;
    this.historyLimit = options.historyLimit || HISTORY_LIMIT;

    this.isCronScheduled = false;
    this.isProcessing = false;
    this.currentRun = null;
    this.runHistory = [];
    this.cronJob = null;
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

    this.isCronScheduled = true;
    logger.info('Hourly cron job scheduled successfully', {
      cronExpression: this.cronExpression,
      timezone: this.timezone
    });

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

    let result;

    try {
      result = await this.invoiceProcessing.processPendingInvoices();
      const finishedAt = new Date();
      const durationMs = finishedAt - startedAt;

      entry.finishedAt = finishedAt.toISOString();
      entry.durationMs = durationMs;
      entry.status = result.success ? 'success' : 'error';
      entry.processed = {
        total: result.summary?.total ?? result.summary?.successful + result.summary?.errors ?? 0,
        successful: result.summary?.successful ?? 0,
        errors: result.summary?.errors ?? 0,
        deletions: result.summary?.deletions ?? 0
      };
      entry.message = result.success
        ? `Processed ${entry.processed.successful} deals`
        : result.error || 'Processing failed';

      if (Array.isArray(result.results)) {
        entry.errors = result.results
          .filter((item) => !item.success)
          .map((item) => item.error || item.message || 'Unknown error');
      }

      this.lastResult = result;
      this.lastRunAt = finishedAt.toISOString();

      if (!result.success && trigger === 'cron' && retryAttempt === 0) {
        this.scheduleRetry();
      }

      if (!result.success) {
        logger.error('Invoice processing finished with errors', {
          trigger,
          retryAttempt,
          runId,
          durationMs,
          error: entry.message
        });
      } else {
        logger.info('Invoice processing finished successfully', {
          trigger,
          retryAttempt,
          runId,
          durationMs
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
