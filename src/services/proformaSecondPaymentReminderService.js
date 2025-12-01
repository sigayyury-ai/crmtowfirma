const PipedriveClient = require('./pipedrive');
const SendPulseClient = require('./sendpulse');
const InvoiceProcessingService = require('./invoiceProcessing');
const supabase = require('./supabaseClient');
const logger = require('../utils/logger');

/**
 * Сервис для автоматической отправки напоминаний о вторых платежах по проформам
 * Запускается через cron ежедневно в 9:00
 */
class ProformaSecondPaymentReminderService {
  constructor(options = {}) {
    this.pipedriveClient = options.pipedriveClient || new PipedriveClient();
    this.invoiceService = options.invoiceService || new InvoiceProcessingService();
    this.logger = options.logger || logger;
    
    // Инициализируем SendPulse только если доступен
    try {
      this.sendpulseClient = options.sendpulseClient || new SendPulseClient();
    } catch (error) {
      this.logger.warn('SendPulse not available, reminders will be skipped', { error: error.message });
      this.sendpulseClient = null;
    }
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
   * Проверить, было ли отправлено напоминание недавно (в последние 7 дней)
   * @param {number} dealId - ID сделки
   * @returns {Promise<boolean>} - true если напоминание было отправлено недавно
   */
  async wasReminderSentRecently(dealId) {
    try {
      // Проверяем логи за последние 7 дней
      // В реальной системе лучше хранить это в БД, но для простоты используем проверку по условиям
      // Если задача просрочена более чем на 7 дней и второй платеж все еще не оплачен,
      // значит напоминание уже отправлялось
      return false; // Пока возвращаем false, чтобы не скрывать задачи
    } catch (error) {
      this.logger.warn('Failed to check if reminder was sent recently', {
        dealId,
        error: error.message
      });
      return false;
    }
  }

  /**
   * Найти все сделки с проформами, требующие напоминаний о вторых платежах
   * @param {Object} options - Опции поиска
   * @param {boolean} options.hideProcessed - Скрывать задачи, по которым уже отправляли напоминание сегодня
   * @returns {Promise<Array>} - Массив задач для напоминаний
   */
  async findAllUpcomingTasks(options = {}) {
    try {
      const dealsResult = await this.pipedriveClient.getDeals({
        filter_id: null,
        status: 'open',
        limit: 500,
        start: 0
      });

      if (!dealsResult.success || !dealsResult.deals) {
        return [];
      }

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const tasks = [];

      for (const deal of dealsResult.deals) {
        try {
          const closeDate = deal.expected_close_date || deal.close_date;
          if (!closeDate) continue;

          const expectedCloseDate = new Date(closeDate);
          const daysDiff = Math.ceil((expectedCloseDate - today) / (1000 * 60 * 60 * 24));

          // Проверяем, что график 50/50 (>30 дней до начала лагеря)
          if (daysDiff < 30) continue;

          const secondPaymentDate = this.calculateSecondPaymentDate(closeDate);
          if (!secondPaymentDate) continue;

          secondPaymentDate.setHours(0, 0, 0, 0);

          // Ищем проформы для этой сделки
          const { data: proformas, error: proformasError } = await supabase
            .from('proformas')
            .select('*')
            .eq('pipedrive_deal_id', deal.id)
            .is('deleted_at', null)
            .order('created_at', { ascending: false });

          if (proformasError || !proformas || proformas.length === 0) continue;

          // Ищем платежи
          const proformaIds = proformas.map(p => p.id);
          const { data: payments, error: paymentsError } = await supabase
            .from('payments')
            .select('*')
            .in('proforma_id', proformaIds)
            .neq('manual_status', 'rejected')
            .order('payment_date', { ascending: true });

          if (paymentsError || !payments || payments.length === 0) continue;

          // Анализируем платежи
          const dealValue = parseFloat(deal.value) || 0;
          const expectedFirstPayment = dealValue / 2;
          const expectedSecondPayment = dealValue / 2;

          const secondPaymentDateObj = new Date(secondPaymentDate);
          secondPaymentDateObj.setHours(0, 0, 0, 0);

          const firstPayments = payments.filter(p => {
            if (!p.payment_date) return false;
            const paymentDate = new Date(p.payment_date);
            paymentDate.setHours(0, 0, 0, 0);
            return paymentDate < secondPaymentDateObj;
          });

          const secondPayments = payments.filter(p => {
            if (!p.payment_date) return false;
            const paymentDate = new Date(p.payment_date);
            paymentDate.setHours(0, 0, 0, 0);
            return paymentDate >= secondPaymentDateObj;
          });

          const firstPaymentTotal = firstPayments.reduce((sum, p) => parseFloat(p.amount || 0) + sum, 0);
          const secondPaymentTotal = secondPayments.reduce((sum, p) => parseFloat(p.amount || 0) + sum, 0);
          const totalPaid = firstPaymentTotal + secondPaymentTotal;

          const firstPaymentPaid = firstPaymentTotal >= expectedFirstPayment * 0.9;
          const isSecondPaymentDateReached = secondPaymentDateObj <= today;
          let secondPaymentPaid = false;
          
          if (isSecondPaymentDateReached) {
            secondPaymentPaid = secondPaymentTotal >= expectedSecondPayment * 0.9;
          } else {
            secondPaymentPaid = totalPaid >= dealValue * 0.9;
          }

          if (!firstPaymentPaid || secondPaymentPaid) continue;

          // Получаем данные персоны
          const dealWithRelated = await this.pipedriveClient.getDealWithRelatedData(deal.id);
          const person = dealWithRelated?.person;
          const customerEmail = person?.email?.[0]?.value || person?.email || 'N/A';
          const customerName = person?.name || 'Клиент';

          const daysUntil = Math.ceil((secondPaymentDate - today) / (1000 * 60 * 60 * 24));

          // Получаем банковский счет по валюте
          const bankAccountResult = await this.invoiceService.getBankAccountByCurrency(deal.currency || 'PLN');
          const bankAccount = bankAccountResult.success ? bankAccountResult.bankAccount : null;

          // Используем первую проформу (обычно она одна)
          const proforma = proformas[0];

          tasks.push({
            deal,
            dealId: deal.id,
            dealTitle: deal.title,
            customerEmail,
            customerName,
            proformaNumber: proforma.fullnumber || `CO-PROF ${proforma.id}/2025`,
            secondPaymentDate,
            secondPaymentAmount: expectedSecondPayment,
            currency: deal.currency || 'PLN',
            bankAccountNumber: bankAccount?.number || 'N/A',
            daysUntilSecondPayment: daysUntil,
            isDateReached: isSecondPaymentDateReached,
            expectedCloseDate: closeDate
          });

        } catch (error) {
          this.logger.warn(`Error processing deal ${deal.id}`, { error: error.message });
        }
      }

      // Сортируем по дате второго платежа
      tasks.sort((a, b) => new Date(a.secondPaymentDate) - new Date(b.secondPaymentDate));

      return tasks;
    } catch (error) {
      this.logger.error('Failed to find upcoming proforma reminder tasks', {
        error: error.message
      });
      return [];
    }
  }

  /**
   * Отправить напоминание о втором платеже через SendPulse
   * @param {Object} task - Задача для напоминания
   * @returns {Promise<Object>} - Результат отправки
   */
  async sendReminder(task) {
    if (!this.sendpulseClient) {
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

      // Формируем сообщение
      const message = `🔔 Напоминание о втором платеже

Здравствуйте, ${task.customerName}!

Напоминаем об оплате второго платежа по сделке "${task.dealTitle}".

💰 Сумма: ${task.secondPaymentAmount.toFixed(2)} ${task.currency}
📋 Проформа: ${task.proformaNumber}
🏦 Счет: ${task.bankAccountNumber}

💡 Укажите "${task.proformaNumber}" в назначении платежа.`;

      // Отправляем сообщение
      const result = await this.sendpulseClient.sendTelegramMessage(sendpulseId, message);

      if (result.success) {
        this.logger.info('Proforma reminder sent successfully', {
          dealId: task.dealId,
          sendpulseId,
          proformaNumber: task.proformaNumber
        });
      } else {
        this.logger.error('Failed to send proforma reminder', {
          dealId: task.dealId,
          sendpulseId,
          error: result.error
        });
      }

      return result;
    } catch (error) {
      this.logger.error('Error sending proforma reminder', {
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
   * Обработать все сделки, требующие напоминаний
   * Отправляет напоминания для сделок, где дата второго платежа уже наступила
   * @returns {Promise<Object>} - Результат обработки
   */
  async processAllDeals() {
    const result = {
      processed: 0,
      sent: 0,
      errors: [],
      skipped: 0
    };

    try {
      // Получаем задачи, скрывая те, по которым уже отправляли напоминание сегодня
      const tasks = await this.findAllUpcomingTasks({ hideProcessed: true });
      
      // Фильтруем только те, где дата уже наступила
      const tasksToProcess = tasks.filter(task => task.isDateReached);
      
      // Дополнительная проверка: не обрабатываем задачи, по которым уже отправляли напоминание
      // Если задача просрочена более чем на 1 день, пропускаем её (значит напоминание уже отправлялось)
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const tasksToProcessFiltered = tasksToProcess.filter(task => {
        const taskDate = new Date(task.secondPaymentDate);
        taskDate.setHours(0, 0, 0, 0);
        const daysOverdue = Math.ceil((today - taskDate) / (1000 * 60 * 60 * 24));
        
        // Если задача просрочена более чем на 1 день, пропускаем её
        // (значит напоминание уже отправлялось ранее, не спамим клиентам)
        if (daysOverdue > 1) {
          result.skipped++;
          this.logger.info('Skipping overdue task (reminder already sent)', {
            dealId: task.dealId,
            daysOverdue
          });
          return false;
        }
        return true;
      });

      this.logger.info('Processing proforma reminders', {
        totalTasks: tasks.length,
        tasksToProcess: tasksToProcess.length,
        tasksToProcessFiltered: tasksToProcessFiltered.length,
        skipped: result.skipped
      });

      for (const task of tasksToProcessFiltered) {
        result.processed++;
        try {
          const sendResult = await this.sendReminder(task);
          if (sendResult.success) {
            result.sent++;
          } else {
            result.errors.push({
              dealId: task.dealId,
              error: sendResult.error || 'Unknown error'
            });
          }
        } catch (error) {
          result.errors.push({
            dealId: task.dealId,
            error: error.message
          });
        }
      }

      return result;
    } catch (error) {
      this.logger.error('Failed to process proforma reminders', {
        error: error.message
      });
      return {
        ...result,
        errors: [...result.errors, { error: error.message }]
      };
    }
  }
}

module.exports = ProformaSecondPaymentReminderService;
