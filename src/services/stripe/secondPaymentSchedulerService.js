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
   * Найти все задачи-напоминания о втором платеже (сессия создана, но не оплачена)
   * @returns {Promise<Array>} - Массив задач для напоминаний
   */
  async findReminderTasks() {
    try {
      // Получаем все сделки со статусом "Stripe" (invoice_type = 75)
      const invoiceTypeFieldKey = 'ad67729ecfe0345287b71a3b00910e8ba5b3b496';
      const stripeTriggerValue = '75';

      const dealsResult = await this.pipedriveClient.getDeals({
        filter_id: null,
        status: 'all_not_deleted',
        limit: 500,
        start: 0
      });

      if (!dealsResult.success || !dealsResult.deals) {
        return [];
      }

      const reminderTasks = [];
      const today = new Date();
      today.setHours(0, 0, 0, 0);

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

        // Проверяем, что вторая сессия создана
        const payments = await this.repository.listPayments({ dealId: String(deal.id) });
        const restPayment = payments.find(p => 
          (p.payment_type === 'rest' || p.payment_type === 'second' || p.payment_type === 'final')
        );

        if (!restPayment) {
          continue; // Сессия еще не создана
        }

        // Проверяем, что второй платеж не оплачен
        if (restPayment.payment_status === 'paid') {
          continue; // Уже оплачен
        }

        // Получаем URL сессии из Stripe API или из raw_payload
        let sessionUrl = null;
        // Сначала пытаемся получить из raw_payload (быстрее)
        if (restPayment.raw_payload && restPayment.raw_payload.url) {
          sessionUrl = restPayment.raw_payload.url;
        } else {
          // Если нет в raw_payload, получаем из Stripe API
          try {
            const stripeSession = await this.stripeProcessor.stripe.checkout.sessions.retrieve(restPayment.session_id);
            sessionUrl = stripeSession.url || null;
          } catch (error) {
            this.logger.warn('Failed to retrieve session URL from Stripe', {
              dealId: deal.id,
              sessionId: restPayment.session_id,
              error: error.message
            });
          }
        }

        // Получаем данные персоны
        const dealWithRelated = await this.pipedriveClient.getDealWithRelatedData(deal.id);
        const person = dealWithRelated?.person;
        const organization = dealWithRelated?.organization;
        
        const customerEmail = person?.email?.[0]?.value || 
                             person?.email || 
                             organization?.email?.[0]?.value || 
                             organization?.email || 
                             'N/A';
        
        const customerName = person?.name || organization?.name || 'Клиент';

        const dealValue = parseFloat(deal.value) || 0;
        const currency = deal.currency || 'PLN';
        const secondPaymentAmount = dealValue / 2;
        
        const daysUntil = Math.ceil((secondPaymentDate - today) / (1000 * 60 * 60 * 24));

        reminderTasks.push({
          deal,
          dealId: deal.id,
          dealTitle: deal.title,
          customerEmail,
          customerName,
          secondPaymentDate,
          secondPaymentAmount,
          currency,
          daysUntilSecondPayment: daysUntil,
          isDateReached: this.isDateReached(secondPaymentDate),
          sessionId: restPayment.session_id,
          sessionUrl: sessionUrl
        });
      }

      // Сортируем по дате (ближайшие сначала)
      reminderTasks.sort((a, b) => {
        return new Date(a.secondPaymentDate) - new Date(b.secondPaymentDate);
      });

      return reminderTasks;
    } catch (error) {
      this.logger.error('Failed to find reminder tasks', {
        error: error.message
      });
      return [];
    }
  }

  /**
   * Отправить напоминание о втором платеже клиенту
   * @param {Object} task - Задача для напоминания
   * @param {Object} options - Опции отправки
   * @returns {Promise<Object>} - Результат отправки
   */
  async sendReminder(task, options = {}) {
    const { trigger = 'manual', runId = null } = options;
    
    if (!this.stripeProcessor.sendpulseClient) {
      return {
        success: false,
        error: 'SendPulse not available'
      };
    }

    try {
      // Получаем SendPulse ID из персоны
      const dealWithRelated = await this.pipedriveClient.getDealWithRelatedData(task.dealId);
      const person = dealWithRelated?.person;
      const SENDPULSE_ID_FIELD_KEY = 'ff1aa263ac9f0e54e2ae7bec6d7215d027bf1b8c';
      const sendpulseId = person?.[SENDPULSE_ID_FIELD_KEY];

      if (!sendpulseId) {
        this.logger.warn('SendPulse ID not found for deal', { dealId: task.dealId });
        return {
          success: false,
          error: 'SendPulse ID not found'
        };
      }

      // Форматируем дату
      const formatDate = (date) => {
        if (!date) return 'не указана';
        return date.toLocaleDateString('ru-RU', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          timeZone: 'Europe/Warsaw'
        });
      };

      const formatAmount = (amount) => {
        const num = Number(amount);
        if (Number.isNaN(num)) {
          return '0.00';
        }
        return num.toFixed(2);
      };

      // Формируем сообщение
      let message = `Привет! Напоминаю о втором платеже.\n\n`;
      
      if (task.sessionUrl) {
        message += `[Ссылка на оплату](${task.sessionUrl})\n`;
        message += `Ссылка действует 24 часа\n\n`;
      }
      
      message += `Сумма: ${formatAmount(task.secondPaymentAmount)} ${task.currency}\n`;
      message += `Дата платежа: ${formatDate(task.secondPaymentDate)}\n`;

      // Отправляем через SendPulse
      const result = await this.stripeProcessor.sendpulseClient.sendTelegramMessage(sendpulseId, message);

      if (result.success) {
        this.logger.info('Stripe second payment reminder sent successfully', {
          dealId: task.dealId,
          sendpulseId,
          trigger,
          runId
        });
      } else {
        this.logger.warn('Failed to send Stripe second payment reminder', {
          dealId: task.dealId,
          sendpulseId,
          error: result.error
        });
      }

      return result;
    } catch (error) {
      this.logger.error('Error sending Stripe second payment reminder', {
        dealId: task.dealId,
        error: error.message
      });
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Обработать все напоминания о втором платеже
   * @param {Object} options - Опции обработки
   * @param {string} options.trigger - Триггер запуска
   * @param {string} options.runId - ID запуска
   * @returns {Promise<Object>} - Статистика обработки
   */
  async processAllReminders(options = {}) {
    const { trigger = 'manual', runId = null } = options;
    const summary = {
      totalFound: 0,
      sent: 0,
      errors: [],
      skipped: []
    };

    try {
      this.logger.info('Starting Stripe reminder cycle', { trigger, runId });

      const reminderTasks = await this.findReminderTasks();
      summary.totalFound = reminderTasks.length;

      this.logger.info('Found reminder tasks', {
        count: reminderTasks.length,
        trigger,
        runId
      });

      for (const task of reminderTasks) {
        try {
          // Отправляем напоминание только если дата наступила
          if (!task.isDateReached) {
            summary.skipped.push({
              dealId: task.dealId,
              reason: 'date_not_reached'
            });
            continue;
          }

          const result = await this.sendReminder(task, { trigger, runId });
          
          if (result.success) {
            summary.sent++;
          } else {
            summary.errors.push({
              dealId: task.dealId,
              error: result.error || 'Unknown error'
            });
          }
        } catch (error) {
          summary.errors.push({
            dealId: task.dealId,
            error: error.message
          });
        }
      }

      this.logger.info('Stripe reminder cycle completed', {
        trigger,
        runId,
        summary
      });

      return summary;
    } catch (error) {
      this.logger.error('Error in Stripe reminder cycle', {
        trigger,
        runId,
        error: error.message
      });
      summary.errors.push({
        error: error.message
      });
      return summary;
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
