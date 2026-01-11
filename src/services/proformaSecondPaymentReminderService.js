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
    this.sentCache = new Set(); // in-memory защита от повторной отправки внутри одного процесса
    
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

  normalizeDate(value) {
    if (!value) {
      return null;
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return null;
    }

    date.setHours(0, 0, 0, 0);
    return date.toISOString().split('T')[0];
  }

  getReminderCacheKey(dealId, secondPaymentDate) {
    const normalizedDate = this.normalizeDate(secondPaymentDate);
    if (!normalizedDate) {
      return null;
    }
    return `${dealId}:${normalizedDate}`;
  }

  /**
   * Проверка, отправлялось ли напоминание когда-либо для этой сделки и даты второго платежа
   * @param {number} dealId - ID сделки
   * @param {Date} secondPaymentDate - Дата второго платежа
   * @returns {Promise<boolean>} - true если напоминание уже отправлялось
   */
  async wasReminderSentEver(dealId, secondPaymentDate) {
    try {
      const cacheKey = this.getReminderCacheKey(dealId, secondPaymentDate);
      if (cacheKey && this.sentCache.has(cacheKey)) {
        return true;
      }

      if (!supabase || !cacheKey) {
        return false;
      }

      const secondPaymentDateStr = this.normalizeDate(secondPaymentDate);
      if (!secondPaymentDateStr) {
        return false;
      }

      // Проверяем, было ли отправлено напоминание когда-либо для этой сделки и даты второго платежа
      const { data, error } = await supabase
        .from('proforma_reminder_logs')
        .select('id')
        .match({
          deal_id: dealId,
          second_payment_date: secondPaymentDateStr
        })
        .limit(1);

      if (error) {
        this.logger.warn('Failed to check reminder log in Supabase', {
          dealId,
          error: error.message
        });
        return false;
      }

      if (Array.isArray(data) && data.length > 0) {
        this.sentCache.add(cacheKey);
        return true;
      }

      return false;
    } catch (error) {
      this.logger.warn('Failed to check if reminder was sent ever', {
        dealId,
        error: error.message
      });
      return false;
    }
  }

  /**
   * Проверка на повторную отправку в текущий день.
   * Сначала смотрим локальный кэш (для защиты внутри процесса), затем Supabase.
   */
  async wasReminderSentRecently(dealId, secondPaymentDate) {
    try {
      const cacheKey = this.getReminderCacheKey(dealId, secondPaymentDate);
      if (cacheKey && this.sentCache.has(cacheKey)) {
        return true;
      }

      if (!supabase || !cacheKey) {
        return false;
      }

      const todayStr = this.normalizeDate(new Date());
      const secondPaymentDateStr = this.normalizeDate(secondPaymentDate);
      if (!todayStr || !secondPaymentDateStr) {
        return false;
      }

      const { data, error } = await supabase
        .from('proforma_reminder_logs')
        .select('id')
        .match({
          deal_id: dealId,
          second_payment_date: secondPaymentDateStr,
          sent_date: todayStr
        })
        .limit(1);

      if (error) {
        this.logger.warn('Failed to check reminder log in Supabase', {
          dealId,
          error: error.message
        });
        return false;
      }

      if (Array.isArray(data) && data.length > 0) {
        this.sentCache.add(cacheKey);
        return true;
      }

      return false;
    } catch (error) {
      this.logger.warn('Failed to check if reminder was sent recently', {
        dealId,
        error: error.message
      });
      return false;
    }
  }

  async recordReminderSent({ dealId, secondPaymentDate, sendpulseId, proformaNumber, trigger, runId }) {
    const cacheKey = this.getReminderCacheKey(dealId, secondPaymentDate);
    if (cacheKey) {
      this.sentCache.add(cacheKey);
    }

    if (!supabase) {
      return;
    }

    try {
      const todayStr = this.normalizeDate(new Date());
      const secondPaymentDateStr = this.normalizeDate(secondPaymentDate);
      if (!todayStr || !secondPaymentDateStr) {
        return;
      }

      const payload = {
        deal_id: dealId,
        second_payment_date: secondPaymentDateStr,
        sent_date: todayStr,
        run_id: runId || null,
        trigger_source: trigger || null,
        sendpulse_id: sendpulseId || null,
        proforma_number: proformaNumber || null
      };

      const { error } = await supabase.from('proforma_reminder_logs').insert(payload);
      if (error) {
        if (error.code === '23505') {
          this.logger.info('Proforma reminder already recorded for today', {
            dealId,
            secondPaymentDate: secondPaymentDateStr
          });
        } else {
          this.logger.warn('Failed to store proforma reminder log', {
            dealId,
            error: error.message
          });
        }
      }
    } catch (error) {
      this.logger.warn('Failed to persist proforma reminder log', {
        dealId,
        error: error.message
      });
    }
  }

  /**
   * Найти все сделки с проформами, требующие напоминаний о вторых платежах
   * @param {Object} options - Опции поиска
   * @param {boolean} options.hideProcessed - Скрывать задачи, по которым уже отправляли напоминание (любое время)
   * @returns {Promise<Array>} - Массив задач для напоминаний
   */
  async findAllUpcomingTasks(options = {}) {
    const { hideProcessed = false } = options;
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
          // Пропускаем удаленные сделки
          if (deal.deleted === true || deal.status === 'deleted') {
            this.logger.debug('Skipping deleted deal', {
              dealId: deal.id,
              deleted: deal.deleted,
              status: deal.status
            });
            continue;
          }

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

          // Если hideProcessed=true, проверяем, не отправляли ли уже напоминание для этой сделки
          if (hideProcessed) {
            const alreadySent = await this.wasReminderSentEver(deal.id, secondPaymentDate);
            if (alreadySent) {
              this.logger.debug('Skipping task - reminder already sent', {
                dealId: deal.id,
                secondPaymentDate: this.normalizeDate(secondPaymentDate)
              });
              continue;
            }
          }

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
  async sendReminder(task, options = {}) {
    const { trigger = 'manual', runId = null } = options;
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
      // Берем только имя (первое слово) из customerName
      const customerFullName = task.customerName || 'Клиент';
      const customerName = customerFullName.split(' ')[0];
      
      const message = `Напоминание о втором платеже

Здравствуйте, ${customerName}!

Напоминаем об оплате второго платежа по сделке "${task.dealTitle}".

Сумма: ${task.secondPaymentAmount.toFixed(2)} ${task.currency}
Проформа: ${task.proformaNumber}
Счет: ${task.bankAccountNumber}

Укажите "${task.proformaNumber}" в назначении платежа.`;

      // Отправляем сообщение
      const result = await this.sendpulseClient.sendTelegramMessage(sendpulseId, message);

      if (result.success) {
        this.logger.info('Proforma reminder sent successfully', {
          dealId: task.dealId,
          sendpulseId,
          proformaNumber: task.proformaNumber,
          trigger,
          runId
        });

        await this.recordReminderSent({
          dealId: task.dealId,
          secondPaymentDate: task.secondPaymentDate,
          sendpulseId,
          proformaNumber: task.proformaNumber,
          trigger,
          runId
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
  async processAllDeals({ trigger = 'manual', runId = null } = {}) {
    const result = {
      processed: 0,
      sent: 0,
      errors: [],
      skipped: 0,
      skippedDuplicates: 0
    };

    try {
      // Получаем задачи, скрывая те, по которым уже отправляли напоминание сегодня
      const tasks = await this.findAllUpcomingTasks({ hideProcessed: true });
      
      // Фильтруем только те, где дата уже наступила
      const tasksToProcess = tasks.filter(task => task.isDateReached);
      
      // Фильтруем задачи - проверка оплаты и дубликатов будет в цикле ниже
      const tasksToProcessFiltered = tasksToProcess;

      this.logger.info('Processing proforma reminders', {
        totalTasks: tasks.length,
        tasksToProcess: tasksToProcess.length,
        tasksToProcessFiltered: tasksToProcessFiltered.length,
        skipped: result.skipped
      });

      for (const task of tasksToProcessFiltered) {
        result.processed++;
        try {
          // КРИТИЧЕСКИ ВАЖНО: Проверяем оплату второго платежа ПЕРЕД отправкой
          // Платеж мог быть добавлен после создания задачи
          const dealResult = await this.pipedriveClient.getDeal(task.dealId);
          if (!dealResult.success || !dealResult.deal) {
            result.skipped++;
            result.errors.push({
              dealId: task.dealId,
              error: 'Deal not found'
            });
            continue;
          }

          const deal = dealResult.deal;
          
          // Пропускаем удаленные сделки
          if (deal.deleted === true || deal.status === 'deleted') {
            result.skipped++;
            this.logger.info('Skipping proforma reminder - deal is deleted', {
              dealId: task.dealId,
              deleted: deal.deleted,
              status: deal.status
            });
            continue;
          }
          const dealValue = parseFloat(deal.value) || 0;
          const expectedSecondPayment = dealValue / 2;

          // Получаем актуальные данные о платежах
          const { data: proformas } = await supabase
            .from('proformas')
            .select('*')
            .eq('pipedrive_deal_id', task.dealId)
            .is('deleted_at', null);

          if (!proformas || proformas.length === 0) {
            result.skipped++;
            continue;
          }

          const proformaIds = proformas.map(p => p.id);
          const { data: payments } = await supabase
            .from('payments')
            .select('*')
            .in('proforma_id', proformaIds)
            .neq('manual_status', 'rejected')
            .order('payment_date', { ascending: true });

          if (!payments || payments.length === 0) {
            result.skipped++;
            continue;
          }

          // Проверяем оплату второго платежа
          const secondPaymentDateObj = new Date(task.secondPaymentDate);
          secondPaymentDateObj.setHours(0, 0, 0, 0);
          const today = new Date();
          today.setHours(0, 0, 0, 0);

          const secondPayments = payments.filter(p => {
            if (!p.payment_date) return false;
            const paymentDate = new Date(p.payment_date);
            paymentDate.setHours(0, 0, 0, 0);
            return paymentDate >= secondPaymentDateObj;
          });

          const secondPaymentTotal = secondPayments.reduce((sum, p) => parseFloat(p.amount || 0) + sum, 0);
          const isSecondPaymentDateReached = secondPaymentDateObj <= today;
          let secondPaymentPaid = false;

          if (isSecondPaymentDateReached) {
            secondPaymentPaid = secondPaymentTotal >= expectedSecondPayment * 0.9;
          } else {
            const firstPayments = payments.filter(p => {
              if (!p.payment_date) return false;
              const paymentDate = new Date(p.payment_date);
              paymentDate.setHours(0, 0, 0, 0);
              return paymentDate < secondPaymentDateObj;
            });
            const firstPaymentTotal = firstPayments.reduce((sum, p) => parseFloat(p.amount || 0) + sum, 0);
            const totalPaid = firstPaymentTotal + secondPaymentTotal;
            secondPaymentPaid = totalPaid >= dealValue * 0.9;
          }

          // Если второй платеж оплачен, пропускаем задачу
          if (secondPaymentPaid) {
            result.skipped++;
            this.logger.info('Skipping proforma reminder - second payment already paid', {
              dealId: task.dealId,
              secondPaymentTotal: secondPaymentTotal.toFixed(2),
              expectedSecondPayment: expectedSecondPayment.toFixed(2),
              secondPaymentDate: this.normalizeDate(task.secondPaymentDate)
            });
            continue;
          }

          // Проверяем, не отправляли ли уже напоминание
          const alreadySent = await this.wasReminderSentEver(task.dealId, task.secondPaymentDate);
          if (alreadySent) {
            result.skipped++;
            result.skippedDuplicates++;
            this.logger.info('Skipping proforma reminder (already sent)', {
              dealId: task.dealId,
              secondPaymentDate: this.normalizeDate(task.secondPaymentDate)
            });
            continue;
          }

          const sendResult = await this.sendReminder(task, { trigger, runId });
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
