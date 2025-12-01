const StripeProcessorService = require('./processor');
const StripeRepository = require('./repository');
const PipedriveClient = require('../pipedrive');
const logger = require('../../utils/logger');

/**
 * Сервис для автоматического создания вторых сессий оплаты для графика 50/50
 * Запускается через cron ежедневно в 9:00
 */
class SecondPaymentSchedulerService {
  constructor(options = {}) {
    this.stripeProcessor = options.stripeProcessor || new StripeProcessorService();
    this.repository = options.repository || new StripeRepository();
    this.pipedriveClient = options.pipedriveClient || new PipedriveClient();
    this.logger = options.logger || logger;
  }

  /**
   * Вычислить дату второго платежа
   * @param {string|Date} expectedCloseDate - Дата начала лагеря (expected_close_date)
   * @returns {Date|null} - Дата второго платежа (expected_close_date - 1 месяц)
   */
  calculateSecondPaymentDate(expectedCloseDate) {
    if (!expectedCloseDate) {
      return null;
    }

    try {
      const closeDate = new Date(expectedCloseDate);
      const secondPaymentDate = new Date(closeDate);
      // Второй платеж за 1 месяц до начала лагеря
      secondPaymentDate.setMonth(secondPaymentDate.getMonth() - 1);
      return secondPaymentDate;
    } catch (error) {
      this.logger.warn('Failed to calculate second payment date', {
        expectedCloseDate,
        error: error.message
      });
      return null;
    }
  }

  /**
   * Определить график платежей на основе expected_close_date
   * @param {Object} deal - Сделка из Pipedrive
   * @returns {Object} - { schedule: '50/50' | '100%', secondPaymentDate: Date | null }
   */
  determinePaymentSchedule(deal) {
    const closeDate = deal.expected_close_date || deal.close_date;
    if (!closeDate) {
      return { schedule: '100%', secondPaymentDate: null };
    }

    try {
      const expectedCloseDate = new Date(closeDate);
      const today = new Date();
      const daysDiff = Math.ceil((expectedCloseDate - today) / (1000 * 60 * 60 * 24));

      if (daysDiff >= 30) {
        const secondPaymentDate = this.calculateSecondPaymentDate(closeDate);
        return { schedule: '50/50', secondPaymentDate };
      } else {
        return { schedule: '100%', secondPaymentDate: null };
      }
    } catch (error) {
      this.logger.warn('Failed to determine payment schedule', {
        dealId: deal.id,
        closeDate,
        error: error.message
      });
      return { schedule: '100%', secondPaymentDate: null };
    }
  }

  /**
   * Проверить, оплачен ли первый платеж
   * @param {string} dealId - ID сделки
   * @returns {Promise<boolean>}
   */
  async isFirstPaymentPaid(dealId) {
    try {
      const payments = await this.repository.listPayments({ dealId: String(dealId) });
      
      const depositPayment = payments.find(p => 
        (p.payment_type === 'deposit' || p.payment_type === 'first') &&
        p.payment_status === 'paid'
      );

      return !!depositPayment;
    } catch (error) {
      this.logger.error('Failed to check first payment status', {
        dealId,
        error: error.message
      });
      return false;
    }
  }

  /**
   * Проверить, существует ли вторая сессия
   * @param {string} dealId - ID сделки
   * @returns {Promise<boolean>}
   */
  async hasSecondPaymentSession(dealId) {
    try {
      const payments = await this.repository.listPayments({ dealId: String(dealId) });
      
      const restPayment = payments.find(p => 
        (p.payment_type === 'rest' || p.payment_type === 'second' || p.payment_type === 'final')
      );

      return !!restPayment;
    } catch (error) {
      this.logger.error('Failed to check second payment session', {
        dealId,
        error: error.message
      });
      return false;
    }
  }

  /**
   * Проверить, наступила ли дата второго платежа
   * @param {Date} date - Дата для проверки
   * @returns {boolean}
   */
  isDateReached(date) {
    if (!date) {
      return false;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const targetDate = new Date(date);
    targetDate.setHours(0, 0, 0, 0);

    return targetDate <= today;
  }

  /**
   * Найти все сделки, требующие вторую сессию (только те, где дата уже наступила)
   * @returns {Promise<Array>} - Массив сделок
   */
  async findDealsNeedingSecondPayment() {
    try {
      // Получаем все сделки со статусом "Stripe" (invoice_type = 75)
      const invoiceTypeFieldKey = 'ad67729ecfe0345287b71a3b00910e8ba5b3b496';
      const stripeTriggerValue = '75';

      const dealsResult = await this.pipedriveClient.getDeals({
        filter_id: null,
        status: 'all_not_deleted',
        limit: 500, // Увеличиваем лимит для получения всех сделок
        start: 0
      });

      if (!dealsResult.success || !dealsResult.deals) {
        return [];
      }

      const eligibleDeals = [];

      for (const deal of dealsResult.deals) {
        // Проверяем, что invoice_type = "Stripe" (75)
        const invoiceType = deal[invoiceTypeFieldKey];
        if (String(invoiceType) !== stripeTriggerValue) {
          continue;
        }

        // Определяем график платежей
        const { schedule, secondPaymentDate } = this.determinePaymentSchedule(deal);
        if (schedule !== '50/50' || !secondPaymentDate) {
          continue;
        }

        // Проверяем, что дата второго платежа наступила
        if (!this.isDateReached(secondPaymentDate)) {
          continue;
        }

        // Проверяем, что первый платеж оплачен
        const firstPaid = await this.isFirstPaymentPaid(deal.id);
        if (!firstPaid) {
          continue;
        }

        // Проверяем, что вторая сессия еще не создана
        const hasSecond = await this.hasSecondPaymentSession(deal.id);
        if (hasSecond) {
          continue;
        }

        eligibleDeals.push({
          deal,
          secondPaymentDate
        });
      }

      return eligibleDeals;
    } catch (error) {
      this.logger.error('Failed to find deals needing second payment', {
        error: error.message
      });
      return [];
    }
  }

  /**
   * Найти все будущие задачи по созданию вторых платежей (включая те, что еще не наступили)
   * @returns {Promise<Array>} - Массив сделок с информацией о будущих задачах
   */
  async findAllUpcomingTasks() {
    try {
      // Получаем все сделки со статусом "Stripe" (invoice_type = 75)
      const invoiceTypeFieldKey = 'ad67729ecfe0345287b71a3b00910e8ba5b3b496';
      const stripeTriggerValue = '75';

      const dealsResult = await this.pipedriveClient.getDeals({
        filter_id: null,
        status: 'all_not_deleted',
        limit: 500, // Увеличиваем лимит для получения всех сделок
        start: 0
      });

      if (!dealsResult.success || !dealsResult.deals) {
        return [];
      }

      const upcomingTasks = [];

      for (const deal of dealsResult.deals) {
        // Проверяем, что invoice_type = "Stripe" (75)
        const invoiceType = deal[invoiceTypeFieldKey];
        if (String(invoiceType) !== stripeTriggerValue) {
          continue;
        }

        // Определяем график платежей
        const { schedule, secondPaymentDate } = this.determinePaymentSchedule(deal);
        if (schedule !== '50/50' || !secondPaymentDate) {
          continue;
        }

        // Проверяем, что первый платеж оплачен
        const firstPaid = await this.isFirstPaymentPaid(deal.id);
        if (!firstPaid) {
          continue;
        }

        // Проверяем, что вторая сессия еще не создана
        const hasSecond = await this.hasSecondPaymentSession(deal.id);
        if (hasSecond) {
          continue;
        }

        upcomingTasks.push({
          deal,
          secondPaymentDate,
          isDateReached: this.isDateReached(secondPaymentDate)
        });
      }

      // Сортируем по дате (ближайшие сначала)
      upcomingTasks.sort((a, b) => {
        return new Date(a.secondPaymentDate) - new Date(b.secondPaymentDate);
      });

      return upcomingTasks;
    } catch (error) {
      this.logger.error('Failed to find upcoming tasks', {
        error: error.message
      });
      return [];
    }
  }

  /**
   * Создать вторую сессию для сделки
   * @param {Object} deal - Сделка
   * @param {Date} secondPaymentDate - Дата второго платежа
   * @returns {Promise<Object>} - Результат создания сессии
   */
  async createSecondPaymentSession(deal, secondPaymentDate) {
    try {
      this.logger.info('Creating second payment session', {
        dealId: deal.id,
        secondPaymentDate: secondPaymentDate.toISOString().split('T')[0]
      });

      const result = await this.stripeProcessor.createCheckoutSessionForDeal(deal, {
        trigger: 'cron_second_payment',
        runId: `second_payment_${Date.now()}`,
        paymentType: 'rest',
        paymentSchedule: '50/50',
        paymentIndex: 2,
        skipNotification: false // Отправляем уведомление
      });

      if (result.success) {
        this.logger.info('Second payment session created successfully', {
          dealId: deal.id,
          sessionId: result.sessionId,
          sessionUrl: result.sessionUrl
        });
      } else {
        this.logger.error('Failed to create second payment session', {
          dealId: deal.id,
          error: result.error
        });
      }

      return result;
    } catch (error) {
      this.logger.error('Error creating second payment session', {
        dealId: deal.id,
        error: error.message
      });
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Обработать все сделки, требующие вторую сессию
   * @returns {Promise<Object>} - Статистика обработки
   */
  async processAllDeals() {
    const summary = {
      totalFound: 0,
      created: 0,
      errors: [],
      skipped: []
    };

    try {
      this.logger.info('Starting second payment scheduler cycle');

      const deals = await this.findDealsNeedingSecondPayment();
      summary.totalFound = deals.length;

      this.logger.info('Found deals needing second payment', {
        count: deals.length
      });

      for (const { deal, secondPaymentDate } of deals) {
        try {
          const result = await this.createSecondPaymentSession(deal, secondPaymentDate);
          
          if (result.success) {
            summary.created++;
          } else {
            summary.errors.push({
              dealId: deal.id,
              error: result.error || 'Unknown error'
            });
          }
        } catch (error) {
          summary.errors.push({
            dealId: deal.id,
            error: error.message
          });
        }
      }

      this.logger.info('Second payment scheduler cycle completed', summary);

      return summary;
    } catch (error) {
      this.logger.error('Error in second payment scheduler cycle', {
        error: error.message
      });
      summary.errors.push({
        error: error.message
      });
      return summary;
    }
  }
}

module.exports = SecondPaymentSchedulerService;
