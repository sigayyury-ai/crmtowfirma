const cron = require('node-cron');
const InvoiceProcessingService = require('./invoiceProcessing');
const logger = require('../utils/logger');

class SchedulerService {
  constructor() {
    this.invoiceProcessing = new InvoiceProcessingService();
    this.isRunning = false;
    this.jobs = [];
    
    logger.info('SchedulerService initialized');
  }

  /**
   * Запустить планировщик задач
   */
  start() {
    if (this.isRunning) {
      logger.warn('Scheduler is already running');
      return;
    }

    logger.info('Starting invoice processing scheduler...');

    // Задача 1: 9:00 утра (Europe/Warsaw)
    const job1 = cron.schedule('0 9 * * *', async () => {
      await this.runInvoiceProcessing('morning');
    }, {
      scheduled: false,
      timezone: 'Europe/Warsaw'
    });

    // Задача 2: 13:00 (Europe/Warsaw)
    const job2 = cron.schedule('0 13 * * *', async () => {
      await this.runInvoiceProcessing('afternoon');
    }, {
      scheduled: false,
      timezone: 'Europe/Warsaw'
    });

    // Задача 3: 18:00 (Europe/Warsaw)
    const job3 = cron.schedule('0 18 * * *', async () => {
      await this.runInvoiceProcessing('evening');
    }, {
      scheduled: false,
      timezone: 'Europe/Warsaw'
    });

    // Сохраняем ссылки на задачи
    this.jobs = [job1, job2, job3];

    // Запускаем все задачи
    this.jobs.forEach((job, index) => {
      job.start();
      logger.info(`Cron job ${index + 1} started`);
    });

    this.isRunning = true;
    logger.info('Invoice processing scheduler started successfully');
    logger.info('Schedule: 9:00, 13:00, 18:00 (Europe/Warsaw timezone)');
  }

  /**
   * Остановить планировщик задач
   */
  stop() {
    if (!this.isRunning) {
      logger.warn('Scheduler is not running');
      return;
    }

    logger.info('Stopping invoice processing scheduler...');

    this.jobs.forEach((job, index) => {
      job.stop();
      logger.info(`Cron job ${index + 1} stopped`);
    });

    this.jobs = [];
    this.isRunning = false;
    logger.info('Invoice processing scheduler stopped');
  }

  /**
   * Запустить обработку счетов
   * @param {string} period - Период выполнения (morning/afternoon/evening)
   */
  async runInvoiceProcessing(period) {
    const startTime = new Date();
    logger.info(`Starting ${period} invoice processing at ${startTime.toISOString()}`);

    try {
      const result = await this.invoiceProcessing.processPendingInvoices();

      const endTime = new Date();
      const duration = endTime - startTime;

      if (result.success) {
        logger.info(`${period} invoice processing completed successfully in ${duration}ms`);
        logger.info(`Summary: ${result.summary.successful} successful, ${result.summary.errors} errors`);
        
        // Логируем детали результатов
        result.results.forEach(r => {
          if (r.success) {
            logger.info(`✅ Deal ${r.dealId}: ${r.message}`);
          } else {
            logger.error(`❌ Deal ${r.dealId}: ${r.error}`);
          }
        });
        
        return result;
      } else {
        logger.error(`${period} invoice processing failed: ${result.error}`);
        return result;
      }

    } catch (error) {
      const endTime = new Date();
      const duration = endTime - startTime;
      logger.error(`${period} invoice processing crashed after ${duration}ms:`, error);
      return {
        success: false,
        error: error.message,
        summary: { successful: 0, errors: 1 },
        results: []
      };
    }
  }

  /**
   * Получить статус планировщика
   * @returns {Object} - Статус планировщика
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      jobsCount: this.jobs.length,
      schedule: [
        { time: '09:00', period: 'morning', timezone: 'Europe/Warsaw' },
        { time: '13:00', period: 'afternoon', timezone: 'Europe/Warsaw' },
        { time: '18:00', period: 'evening', timezone: 'Europe/Warsaw' }
      ],
      nextRuns: this.getNextRunTimes()
    };
  }

  /**
   * Получить время следующих запусков
   * @returns {Array} - Массив времени следующих запусков
   */
  getNextRunTimes() {
    const now = new Date();
    const times = ['09:00', '13:00', '18:00'];
    const nextRuns = [];

    times.forEach(time => {
      const [hours, minutes] = time.split(':').map(Number);
      const nextRun = new Date(now);
      nextRun.setHours(hours, minutes, 0, 0);

      // Если время уже прошло сегодня, планируем на завтра
      if (nextRun <= now) {
        nextRun.setDate(nextRun.getDate() + 1);
      }

      nextRuns.push({
        time: time,
        nextRun: nextRun.toISOString(),
        inHours: Math.round((nextRun - now) / (1000 * 60 * 60) * 100) / 100
      });
    });

    return nextRuns.sort((a, b) => new Date(a.nextRun) - new Date(b.nextRun));
  }

  /**
   * Запустить обработку счетов вручную (для тестирования)
   * @param {string} period - Период выполнения
   * @returns {Promise<Object>} - Результат обработки
   */
  async runManualProcessing(period = 'manual') {
    logger.info(`Starting manual ${period} invoice processing...`);
    return await this.runInvoiceProcessing(period);
  }
}

module.exports = SchedulerService;
