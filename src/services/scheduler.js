const cron = require('node-cron');
const { randomUUID } = require('crypto');
const InvoiceProcessingService = require('./invoiceProcessing');
const StripeProcessorService = require('./stripe/processor');
const SecondPaymentSchedulerService = require('./stripe/secondPaymentSchedulerService');
const ProformaSecondPaymentReminderService = require('./proformaSecondPaymentReminderService');
const StripeEventAggregationService = require('./stripe/eventAggregationService');
const EventsCabinetMonitorService = require('./stripe/eventsCabinetMonitorService');
const GoogleMeetReminderService = require('./googleCalendar/googleMeetReminderService');
const MqlSyncService = require('./analytics/mqlSyncService');
const StripePaymentTestRunner = require('../../tests/integration/stripe-payment/testRunner');
const logger = require('../utils/logger');
const { getMonitor } = require('./pipedriveRateLimitMonitor');
const PipedriveClient = require('./pipedrive');

const DEFAULT_TIMEZONE = 'Europe/Warsaw';
const CRON_EXPRESSION = '0 * * * *'; // Каждый час, на отметке hh:00
// Stripe payments теперь обрабатываются через webhooks, polling оставлен только как fallback
// Запускается раз в час вместе с основным циклом для проверки пропущенных событий
const DELETION_CRON_EXPRESSION = '0 2 * * *'; // Раз в сутки в 2:00 ночи (редкий кейс)
const SECOND_PAYMENT_CRON_EXPRESSION = '0 9 * * *'; // Ежедневно в 9:00 утра для создания вторых платежей
const EXPIRED_SESSIONS_CRON_EXPRESSION = '0 */4 * * *'; // Каждые 4 часа для обработки истекших сессий
const STRIPE_EVENTS_AGGREGATION_CRON_EXPRESSION = '10 * * * *'; // каждый час в hh:10
const GOOGLE_MEET_CALENDAR_SCAN_CRON_EXPRESSION = '0 8 * * *'; // Ежедневно в 8:00 утра для сканирования календаря
const GOOGLE_MEET_REMINDER_PROCESS_CRON_EXPRESSION = '*/5 * * * *'; // Каждые 5 минут для обработки напоминаний
const MQL_SYNC_CRON_EXPRESSION = '0 10 * * 1'; // Еженедельно в понедельник в 10:00 утра для обновления MQL аналитики
const STRIPE_PAYMENT_TESTS_CRON_EXPRESSION = '0 3 * * *'; // Ежедневно в 3:00 ночи для запуска автотестов Stripe платежей
const EVENTS_CABINET_MONITOR_CRON_EXPRESSION = '*/30 * * * *'; // Каждые 30 минут для проверки сессий в Events кабинете
const HISTORY_LIMIT = 48; // >= 24 записей (48 = ~2 суток)
const RETRY_DELAY_MINUTES = 15;

class SchedulerService {
  constructor(options = {}) {
    this.invoiceProcessing = options.invoiceProcessingService || new InvoiceProcessingService();
    this.stripeProcessor = options.stripeProcessorService || new StripeProcessorService();
    this.secondPaymentScheduler = options.secondPaymentSchedulerService || new SecondPaymentSchedulerService();
    this.proformaReminderService = options.proformaReminderService || new ProformaSecondPaymentReminderService();
    this.stripeEventAggregationService =
      options.stripeEventAggregationService || new StripeEventAggregationService();
    this.eventsCabinetMonitorService =
      options.eventsCabinetMonitorService || new EventsCabinetMonitorService();
    
    // Initialize Google Meet Reminder Service (may fail if credentials not configured)
    try {
      this.googleMeetReminderService = options.googleMeetReminderService || new GoogleMeetReminderService();
      logger.info('Google Meet Reminder Service initialized successfully');
    } catch (error) {
      logger.warn('Google Meet Reminder Service not available', { 
        error: error.message,
        stack: error.stack 
      });
      this.googleMeetReminderService = null;
    }
    
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
    this.secondPaymentCronJob = null;
    this.stripeEventsCronJob = null;
    this.googleMeetCalendarScanCronJob = null;
    this.googleMeetReminderProcessCronJob = null;
    this.mqlSyncCronJob = null;
    this.stripePaymentTestsCronJob = null;
    this.eventsCabinetMonitorCronJob = null;
    this.expiredSessionsCronJob = null;
    this.retryTimeout = null;
    
    // Инициализируем MQL Sync Service
    try {
      this.mqlSyncService = options.mqlSyncService || new MqlSyncService();
      logger.info('MQL Sync Service initialized successfully');
    } catch (error) {
      logger.warn('MQL Sync Service not available', { 
        error: error.message,
        stack: error.stack 
      });
      this.mqlSyncService = null;
    }
    
    // Инициализируем Stripe Payment Test Runner
    try {
      this.stripePaymentTestRunner = options.stripePaymentTestRunner || new StripePaymentTestRunner();
      logger.info('Stripe Payment Test Runner initialized successfully');
    } catch (error) {
      logger.warn('Stripe Payment Test Runner not available', { 
        error: error.message,
        stack: error.stack 
      });
      this.stripePaymentTestRunner = null;
    }
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

    // Cron для автоматического создания вторых платежей (ежедневно в 9:00)
    logger.info('Configuring daily cron job for second payment sessions', {
      cronExpression: SECOND_PAYMENT_CRON_EXPRESSION,
      timezone: this.timezone
    });
    this.secondPaymentCronJob = cron.schedule(
      SECOND_PAYMENT_CRON_EXPRESSION,
      () => {
        this.runSecondPaymentCycle({ trigger: 'cron_second_payment', retryAttempt: 0 }).catch((error) => {
          logger.error('Unexpected error in second payment cycle:', error);
        });
        // Также запускаем напоминания по проформам в то же время
        this.runProformaReminderCycle({ trigger: 'cron_proforma_reminder' }).catch((error) => {
          logger.error('Unexpected error in proforma reminder cycle:', error);
        });
        // Также запускаем напоминания по Stripe платежам в то же время
        this.runStripeReminderCycle({ trigger: 'cron_stripe_reminder' }).catch((error) => {
          logger.error('Unexpected error in Stripe reminder cycle:', error);
        });
      },
      {
        scheduled: true,
        timezone: this.timezone
      }
    );

    // Отдельный cron для обработки истекших сессий (каждые 4 часа)
    logger.info('Configuring cron job for expired sessions processing', {
      cronExpression: EXPIRED_SESSIONS_CRON_EXPRESSION,
      timezone: this.timezone
    });
    this.expiredSessionsCronJob = cron.schedule(
      EXPIRED_SESSIONS_CRON_EXPRESSION,
      () => {
        // Обрабатываем просроченные сессии (пересоздание и уведомления)
        this.runExpiredSessionsCycle({ trigger: 'cron_expired_sessions' }).catch((error) => {
          logger.error('Unexpected error in expired sessions cycle:', error);
        });
      },
      {
        scheduled: true,
        timezone: this.timezone
      }
    );

    // Cron для агрегации Stripe мероприятий (ежечасно)
    logger.info('Configuring cron job for Stripe events aggregation', {
      cronExpression: STRIPE_EVENTS_AGGREGATION_CRON_EXPRESSION,
      timezone: this.timezone
    });
    this.stripeEventsCronJob = cron.schedule(
      STRIPE_EVENTS_AGGREGATION_CRON_EXPRESSION,
      () => {
        this.runStripeEventAggregation({ trigger: 'cron_stripe_events' }).catch((error) => {
          logger.error('Unexpected error in Stripe events aggregation cron:', error);
        });
      },
      {
        scheduled: true,
        timezone: this.timezone
      }
    );

    // Cron для ежедневного сканирования Google Calendar (ежедневно в 8:00)
    if (this.googleMeetReminderService) {
      logger.info('Configuring daily cron job for Google Meet calendar scan', {
        cronExpression: GOOGLE_MEET_CALENDAR_SCAN_CRON_EXPRESSION,
        timezone: this.timezone
      });
      this.googleMeetCalendarScanCronJob = cron.schedule(
        GOOGLE_MEET_CALENDAR_SCAN_CRON_EXPRESSION,
        () => {
          this.runGoogleMeetCalendarScan({ trigger: 'cron_calendar_scan' }).catch((error) => {
            logger.error('Unexpected error in Google Meet calendar scan:', error);
          });
        },
        {
          scheduled: true,
          timezone: this.timezone
        }
      );
      let nextRunCalendarScan = 'N/A';
      if (this.googleMeetCalendarScanCronJob && typeof this.googleMeetCalendarScanCronJob.nextDates === 'function') {
        try {
          const nextDate = this.googleMeetCalendarScanCronJob.nextDates();
          if (nextDate) {
            const nextRunDate = Array.isArray(nextDate) ? nextDate[0].toDate() : nextDate.toDate();
            nextRunCalendarScan = nextRunDate.toISOString();
          }
        } catch (error) {
          logger.debug('Unable to compute next calendar scan run:', error.message);
        }
      }
      logger.info('Google Meet calendar scan cron job registered successfully', {
        cronExpression: GOOGLE_MEET_CALENDAR_SCAN_CRON_EXPRESSION,
        timezone: this.timezone,
        nextRun: nextRunCalendarScan
      });

      // Cron для обработки запланированных напоминаний (каждые 5 минут)
      logger.info('Configuring cron job for Google Meet reminder processing', {
        cronExpression: GOOGLE_MEET_REMINDER_PROCESS_CRON_EXPRESSION,
        timezone: this.timezone
      });
      this.googleMeetReminderProcessCronJob = cron.schedule(
        GOOGLE_MEET_REMINDER_PROCESS_CRON_EXPRESSION,
        () => {
          this.runGoogleMeetReminderProcessing({ trigger: 'cron_reminder_process' }).catch((error) => {
            logger.error('Unexpected error in Google Meet reminder processing:', error);
          });
        },
        {
          scheduled: true,
          timezone: this.timezone
        }
      );
      let nextRunReminderProcess = 'N/A';
      if (this.googleMeetReminderProcessCronJob && typeof this.googleMeetReminderProcessCronJob.nextDates === 'function') {
        try {
          const nextDate = this.googleMeetReminderProcessCronJob.nextDates();
          if (nextDate) {
            const nextRunDate = Array.isArray(nextDate) ? nextDate[0].toDate() : nextDate.toDate();
            nextRunReminderProcess = nextRunDate.toISOString();
          }
        } catch (error) {
          logger.debug('Unable to compute next reminder processing run:', error.message);
        }
      }
      logger.info('Google Meet reminder processing cron job registered successfully', {
        cronExpression: GOOGLE_MEET_REMINDER_PROCESS_CRON_EXPRESSION,
        timezone: this.timezone,
        nextRun: nextRunReminderProcess
      });
    } else {
      logger.warn('Google Meet Reminder Service not available, skipping cron job setup');
    }

    // Cron для обновления MQL аналитики (еженедельно в понедельник в 10:00)
    if (this.mqlSyncService) {
      logger.info('Configuring weekly cron job for MQL analytics sync', {
        cronExpression: MQL_SYNC_CRON_EXPRESSION,
        timezone: this.timezone
      });
      this.mqlSyncCronJob = cron.schedule(
        MQL_SYNC_CRON_EXPRESSION,
        () => {
          this.runMqlSyncCycle({ trigger: 'cron_mql_sync' }).catch((error) => {
            logger.error('Unexpected error in MQL sync cycle:', error);
          });
        },
        {
          scheduled: true,
          timezone: this.timezone
        }
      );
      let nextRunMqlSync = 'N/A';
      if (this.mqlSyncCronJob && typeof this.mqlSyncCronJob.nextDates === 'function') {
        try {
          const nextDate = this.mqlSyncCronJob.nextDates();
          if (nextDate) {
            const nextRunDate = Array.isArray(nextDate) ? nextDate[0].toDate() : nextDate.toDate();
            nextRunMqlSync = nextRunDate.toISOString();
          }
        } catch (error) {
          logger.debug('Unable to compute next MQL sync run:', error.message);
        }
      }
      logger.info('MQL sync cron job registered successfully', {
        cronExpression: MQL_SYNC_CRON_EXPRESSION,
        timezone: this.timezone,
        nextRun: nextRunMqlSync
      });
    } else {
      logger.warn('MQL Sync Service not available, skipping cron job setup');
    }

    // Cron для автотестов Stripe платежей (ежедневно в 3:00 ночи)
    if (this.stripePaymentTestRunner) {
      logger.info('Configuring daily cron job for Stripe payment auto-tests', {
        cronExpression: STRIPE_PAYMENT_TESTS_CRON_EXPRESSION,
        timezone: this.timezone
      });
      this.stripePaymentTestsCronJob = cron.schedule(
        STRIPE_PAYMENT_TESTS_CRON_EXPRESSION,
        () => {
          this.runStripePaymentTestsCycle({ trigger: 'cron_stripe_payment_tests' }).catch((error) => {
            logger.error('Unexpected error in Stripe payment tests cycle:', error);
          });
        },
        {
          scheduled: true,
          timezone: this.timezone
        }
      );
      let nextRunTests = 'N/A';
      if (this.stripePaymentTestsCronJob && typeof this.stripePaymentTestsCronJob.nextDates === 'function') {
        try {
          const nextDate = this.stripePaymentTestsCronJob.nextDates();
          if (nextDate) {
            const nextRunDate = Array.isArray(nextDate) ? nextDate[0].toDate() : nextDate.toDate();
            nextRunTests = nextRunDate.toISOString();
          }
        } catch (error) {
          logger.debug('Unable to compute next tests run:', error.message);
        }
      }
      logger.info('Stripe payment tests cron job registered successfully', {
        cronExpression: STRIPE_PAYMENT_TESTS_CRON_EXPRESSION,
        timezone: this.timezone,
        nextRun: nextRunTests
      });
    } else {
      logger.warn('Stripe Payment Test Runner not available, skipping cron job setup');
    }

    // Cron для мониторинга сессий в Events кабинете (каждые 30 минут)
    logger.info('Configuring cron job for Events Cabinet sessions monitoring', {
      cronExpression: EVENTS_CABINET_MONITOR_CRON_EXPRESSION,
      timezone: this.timezone,
      note: 'Monitors sessions with deal_id in Events cabinet that may not be processed by webhooks'
    });
    this.eventsCabinetMonitorCronJob = cron.schedule(
      EVENTS_CABINET_MONITOR_CRON_EXPRESSION,
      () => {
        this.runEventsCabinetMonitor({ trigger: 'cron_events_cabinet_monitor' }).catch((error) => {
          logger.error('Unexpected error in Events Cabinet monitor:', error);
        });
      },
      {
        scheduled: true,
        timezone: this.timezone
      }
    );
    logger.info('Events Cabinet monitor cron job registered successfully', {
      cronExpression: EVENTS_CABINET_MONITOR_CRON_EXPRESSION,
      timezone: this.timezone
    });

    // Немедленный запуск при старте, чтобы компенсировать возможные пропуски
    setImmediate(() => {
      this.runCycle({ trigger: 'startup', retryAttempt: 0 }).catch((error) => {
        logger.error('Startup invoice processing failed:', error);
      });
      this.runStripeEventAggregation({ trigger: 'startup' }).catch((error) => {
        logger.error('Startup Stripe events aggregation failed:', error);
      });
      // Запускаем проверку Events кабинета с небольшой задержкой, чтобы не перегружать при старте
      setTimeout(() => {
        this.runEventsCabinetMonitor({ trigger: 'startup' }).catch((error) => {
          logger.error('Startup Events Cabinet monitor failed:', error);
        });
      }, 10000); // 10 секунд задержка
    });
  }

  stop() {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
    }
    if (this.stripeEventsCronJob) {
      this.stripeEventsCronJob.stop();
      this.stripeEventsCronJob = null;
    }
    if (this.googleMeetCalendarScanCronJob) {
      this.googleMeetCalendarScanCronJob.stop();
      this.googleMeetCalendarScanCronJob = null;
    }
    if (this.googleMeetReminderProcessCronJob) {
      this.googleMeetReminderProcessCronJob.stop();
      this.googleMeetReminderProcessCronJob = null;
    }
    if (this.mqlSyncCronJob) {
      this.mqlSyncCronJob.stop();
      this.mqlSyncCronJob = null;
    }
    if (this.stripePaymentTestsCronJob) {
      this.stripePaymentTestsCronJob.stop();
      this.stripePaymentTestsCronJob = null;
    }
    if (this.eventsCabinetMonitorCronJob) {
      this.eventsCabinetMonitorCronJob.stop();
      this.eventsCabinetMonitorCronJob = null;
    }
    if (this.expiredSessionsCronJob) {
      this.expiredSessionsCronJob.stop();
      this.expiredSessionsCronJob = null;
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

  async runStripeEventAggregation({ trigger = 'manual' } = {}) {
    if (!this.stripeEventAggregationService) {
      logger.warn('Stripe event aggregation service not configured; skipping');
      return;
    }
    try {
      logger.info('Stripe events aggregation started', { trigger });
      await this.stripeEventAggregationService.aggregateAll();
      logger.info('Stripe events aggregation finished', { trigger });
    } catch (error) {
      logger.error('Stripe events aggregation failed', {
        trigger,
        error: error.message
      });
    }
  }

  async runEventsCabinetMonitor({ trigger = 'manual' } = {}) {
    if (!this.eventsCabinetMonitorService) {
      logger.warn('Events Cabinet Monitor service not configured; skipping');
      return;
    }
    try {
      logger.info('Events Cabinet monitor started', { trigger });
      const result = await this.eventsCabinetMonitorService.checkAndProcessEventsCabinetSessions({
        trigger,
        limit: 100,
        hoursBack: 24 // Проверяем последние 24 часа
      });
      logger.info('Events Cabinet monitor finished', {
        trigger,
        processed: result.processed || 0,
        skipped: result.skipped || 0,
        errors: result.errors || 0
      });
      return result;
    } catch (error) {
      logger.error('Events Cabinet monitor failed', {
        trigger,
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
        
        // Проверяем и исправляем статусы сделок, где оба платежа оплачены, но статус не обновлен
        // Это исправляет случаи, когда webhook не пришел или пришел с ошибкой
        try {
          await this.stripeProcessor.verifyAndFixDealStatuses({ limit: 50 });
        } catch (error) {
          logger.warn('Failed to verify deal statuses', { error: error.message });
        }
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
        // Извлекаем детали ошибок из результатов
        const stripeErrorDetails = Array.isArray(stripeResult?.results)
          ? stripeResult.results
              .filter((item) => !item.success)
              .slice(0, 10)
              .map((item) => ({
                sessionId: item.sessionId,
                dealId: item.dealId,
                error: item.error
              }))
          : [];
        
        const invoiceErrorDetails = Array.isArray(invoiceResult?.results)
          ? invoiceResult.results
              .filter((item) => !item.success)
              .slice(0, 10)
              .map((item) => ({
                dealId: item.dealId,
                error: item.error || item.message
              }))
          : [];

        logger.error('Invoice processing finished with errors', {
          trigger,
          retryAttempt,
          runId,
          durationMs,
          error: entry.message,
          invoiceSummary,
          stripeSummary,
          apiCalls: apiStats,
          stripeErrorDetails: stripeErrorDetails.length > 0 ? stripeErrorDetails : undefined,
          invoiceErrorDetails: invoiceErrorDetails.length > 0 ? invoiceErrorDetails : undefined
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
   * Запустить цикл обработки просроченных сессий
   * @param {Object} options - Опции запуска
   * @param {string} options.trigger - Триггер запуска
   * @returns {Promise<Object>} - Результат обработки
   */
  async runExpiredSessionsCycle({ trigger = 'manual' }) {
    const runId = randomUUID();
    logger.info('Expired sessions cycle started', { trigger, runId });

    try {
      const result = await this.secondPaymentScheduler.processExpiredSessions({ trigger, runId });
      if (result.errors.length > 0) {
        logger.error('Expired sessions processing finished with errors', {
          trigger,
          runId,
          summary: result
        });
      } else {
        logger.info('Expired sessions processing finished successfully', {
          trigger,
          runId,
          summary: result
        });
      }
      return { success: result.errors.length === 0, summary: result };
    } catch (error) {
      logger.error('Expired sessions processing crashed', {
        trigger,
        runId,
        error: error.message
      });
      return { success: false, error: error.message };
    }
  }

  /**
   * Запустить цикл обработки напоминаний по Stripe платежам
   * @param {Object} options - Опции запуска
   * @param {string} options.trigger - Триггер запуска
   * @returns {Promise<Object>} - Результат обработки
   */
  async runStripeReminderCycle({ trigger = 'manual' }) {
    const runId = randomUUID();
    logger.info('Stripe reminder cycle started', { trigger, runId });

    try {
      const result = await this.secondPaymentScheduler.processAllReminders({ trigger, runId });
      if (result.errors.length > 0) {
        logger.error('Stripe reminder processing finished with errors', {
          trigger,
          runId,
          summary: result
        });
      } else {
        logger.info('Stripe reminder processing finished successfully', {
          trigger,
          runId,
          summary: result
        });
      }
      return { success: result.errors.length === 0, summary: result };
    } catch (error) {
      logger.error('Stripe reminder processing crashed', {
        trigger,
        runId,
        error: error.message
      });
      return { success: false, error: error.message };
    }
  }

  /**
   * Запустить цикл обработки напоминаний по проформам
   * @param {Object} options - Опции запуска
   * @param {string} options.trigger - Триггер запуска
   * @returns {Promise<Object>} - Результат обработки
   */
  async runProformaReminderCycle({ trigger = 'manual' }) {
    const runId = randomUUID();
    logger.info('Proforma reminder cycle started', { trigger, runId });

    try {
      const result = await this.proformaReminderService.processAllDeals({ trigger, runId });
      if (result.errors.length > 0) {
        logger.error('Proforma reminder processing finished with errors', {
          trigger,
          runId,
          summary: result
        });
      } else {
        logger.info('Proforma reminder processing finished successfully', {
          trigger,
          runId,
          summary: result
        });
      }
      return { success: result.errors.length === 0, summary: result };
    } catch (error) {
      logger.error('Error in proforma reminder cycle:', {
        error: error.message,
        stack: error.stack,
        trigger,
        runId
      });
      return { success: false, error: error.message };
    }
  }

  /**
   * Run Google Meet calendar scan cycle
   * Scans Google Calendar for upcoming Google Meet events and creates reminder tasks
   * @param {Object} options - Options with trigger
   * @returns {Promise<Object>} - Result of scan
   */
  async runGoogleMeetCalendarScan({ trigger = 'manual' }) {
    if (!this.googleMeetReminderService) {
      logger.warn('Google Meet Reminder Service not available, skipping calendar scan');
      return { success: false, error: 'Service not available' };
    }

    const runId = randomUUID();
    logger.info('Google Meet calendar scan cycle started', { trigger, runId });

    try {
      const result = await this.googleMeetReminderService.dailyCalendarScan({ trigger, runId });
      
      if (result.success) {
        logger.info('Google Meet calendar scan finished successfully', {
          trigger,
          runId,
          summary: result
        });
      } else {
        logger.error('Google Meet calendar scan finished with errors', {
          trigger,
          runId,
          error: result.error
        });
      }
      
      return result;
    } catch (error) {
      logger.error('Error in Google Meet calendar scan cycle:', {
        error: error.message,
        stack: error.stack,
        trigger,
        runId
      });
      return { success: false, error: error.message };
    }
  }

  /**
   * Run Google Meet reminder processing cycle
   * Processes scheduled reminders and sends notifications via SendPulse
   * @param {Object} options - Options with trigger
   * @returns {Promise<Object>} - Result of processing
   */
  async runGoogleMeetReminderProcessing({ trigger = 'manual' }) {
    if (!this.googleMeetReminderService) {
      logger.warn('Google Meet Reminder Service not available, skipping reminder processing');
      return { success: false, error: 'Service not available' };
    }

    const runId = randomUUID();
    logger.debug('Google Meet reminder processing cycle started', { trigger, runId });

    try {
      const result = await this.googleMeetReminderService.processScheduledReminders({ trigger, runId });
      
      if (result.success && result.sent > 0) {
        logger.info('Google Meet reminder processing finished successfully', {
          trigger,
          runId,
          summary: result
        });
      } else if (result.success) {
        logger.debug('Google Meet reminder processing completed (no reminders to send)', {
          trigger,
          runId,
          summary: result
        });
      } else {
        logger.error('Google Meet reminder processing finished with errors', {
          trigger,
          runId,
          error: result.error
        });
      }
      
      return result;
    } catch (error) {
      logger.error('Error in Google Meet reminder processing cycle:', {
        error: error.message,
        stack: error.stack,
        trigger,
        runId
      });
      return { success: false, error: error.message };
    }
  }

  /**
   * Run MQL analytics sync cycle
   * Updates marketing analytics data from Pipedrive and SendPulse
   * @param {Object} options - Options with trigger
   * @returns {Promise<Object>} - Result of sync
   */
  async runStripePaymentTestsCycle({ trigger = 'manual' }) {
    const runId = randomUUID();
    logger.info('Stripe payment auto-tests cycle started', { trigger, runId });

    try {
      if (!this.stripePaymentTestRunner) {
        throw new Error('Stripe Payment Test Runner not available');
      }

      const testResults = await this.stripePaymentTestRunner.runTestSuite({
        cleanupAfterRun: true
      });

      logger.info('Stripe payment auto-tests cycle completed', {
        trigger,
        runId,
        summary: testResults.summary,
        duration: testResults.duration
      });

      return {
        success: testResults.summary.failed === 0,
        testResults
      };
    } catch (error) {
      logger.error('Stripe payment auto-tests cycle failed', {
        trigger,
        runId,
        error: error.message,
        stack: error.stack
      });
      return {
        success: false,
        error: error.message
      };
    }
  }

  async runMqlSyncCycle({ trigger = 'manual' }) {
    if (!this.mqlSyncService) {
      logger.warn('MQL Sync Service not available, skipping MQL sync');
      return { success: false, error: 'Service not available' };
    }

    const runId = randomUUID();
    logger.info('MQL analytics sync cycle started', { trigger, runId });

    try {
      // Определяем годы для синхронизации (текущий год и предыдущий)
      const now = new Date();
      const currentYear = now.getUTCFullYear();
      const years = [currentYear - 1, currentYear];

      let totalSynced = 0;
      const results = [];

      for (const year of years) {
        logger.info('Running MQL sync for year', { year, trigger, runId, currentMonthOnly: year === currentYear });
        try {
          // Для текущего года обновляем только текущий месяц, для прошлого - полная синхронизация
          await this.mqlSyncService.run({ year, currentMonthOnly: year === currentYear });
          totalSynced++;
          results.push({ year, success: true, currentMonthOnly: year === currentYear });
        } catch (error) {
          logger.error('MQL sync failed for year', {
            year,
            error: error.message,
            stack: error.stack,
            trigger,
            runId
          });
          results.push({ year, success: false, error: error.message });
        }
      }

      logger.info('MQL analytics sync cycle finished', {
        trigger,
        runId,
        totalSynced,
        results
      });

      return {
        success: totalSynced > 0,
        totalSynced,
        results
      };
    } catch (error) {
      logger.error('Error in MQL sync cycle:', {
        error: error.message,
        stack: error.stack,
        trigger,
        runId
      });
      return { success: false, error: error.message };
    }
  }

  /**
   * Отдельный цикл только для обработки удалений (запускается раз в сутки)
   * @param {Object} options - Опции запуска
   * @param {string} options.trigger - Триггер запуска
   * @param {number} options.retryAttempt - Номер попытки повтора
   * @returns {Promise<Object>} - Результат обработки удалений
   */
  async runSecondPaymentCycle({ trigger = 'manual', retryAttempt = 0 }) {
    const runId = randomUUID();
    const startTime = Date.now();

    logger.info('Starting second payment cycle', {
      trigger,
      runId,
      retryAttempt
    });

    try {
      const result = await this.secondPaymentScheduler.processAllDeals();

      const duration = Date.now() - startTime;
      logger.info('Second payment cycle completed', {
        trigger,
        runId,
        duration: `${duration}ms`,
        result
      });

      return {
        success: true,
        runId,
        result,
        duration
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('Second payment cycle failed', {
        trigger,
        runId,
        duration: `${duration}ms`,
        error: error.message
      });

      return {
        success: false,
        runId,
        error: error.message,
        duration
      };
    }
  }

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
