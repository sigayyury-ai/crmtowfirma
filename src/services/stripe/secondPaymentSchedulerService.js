const StripeProcessorService = require('./processor');
const StripeRepository = require('./repository');
const PipedriveClient = require('../pipedrive');
const logger = require('../../utils/logger');
const supabase = require('../supabaseClient');
// Phase 0: Code Review Fixes - New unified services
const PaymentScheduleService = require('./paymentScheduleService');
const PaymentStateAnalyzer = require('./paymentStateAnalyzer');

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
    this.paymentStateAnalyzer = options.paymentStateAnalyzer || new PaymentStateAnalyzer({ repository: this.repository });
    this.sentCache = new Set(); // in-memory защита от повторной отправки внутри одного процесса
  }

  /**
   * Вычислить дату второго платежа (Phase 0: Code Review Fixes - использует PaymentScheduleService)
   * @param {string|Date} expectedCloseDate - Дата начала лагеря (expected_close_date)
   * @returns {Date|null} - Дата второго платежа (expected_close_date - 1 месяц)
   */
  calculateSecondPaymentDate(expectedCloseDate) {
    return PaymentScheduleService.calculateSecondPaymentDate(expectedCloseDate);
  }

  /**
   * Определить график платежей на основе expected_close_date (Phase 0: Code Review Fixes)
   * @param {Object} deal - Сделка из Pipedrive
   * @returns {Object} - { schedule: '50/50' | '100%', secondPaymentDate: Date | null, daysDiff: number | null }
   */
  determinePaymentSchedule(deal) {
    return PaymentScheduleService.determineScheduleFromDeal(deal);
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
   * Получить первичный график платежей из первого оплаченного платежа
   * Используется для определения необходимости второго платежа, даже если текущий график изменился
   * @param {string} dealId - ID сделки
   * @returns {Promise<Object>} - { schedule: '50/50' | '100%' | null, firstPaymentDate: Date | null }
   */
  async getInitialPaymentSchedule(dealId) {
    try {
      const payments = await this.repository.listPayments({ dealId: String(dealId) });
      
      // Ищем первый оплаченный платеж (deposit или single) по дате создания
      const firstPayment = payments
        .filter(p => 
          (p.payment_type === 'deposit' || p.payment_type === 'first' || p.payment_type === 'single') &&
          p.payment_status === 'paid'
        )
        .sort((a, b) => {
          const dateA = a.created_at ? new Date(a.created_at) : new Date(0);
          const dateB = b.created_at ? new Date(b.created_at) : new Date(0);
          return dateA - dateB;
        })[0];

      if (firstPayment && firstPayment.payment_schedule) {
        return {
          schedule: firstPayment.payment_schedule,
          firstPaymentDate: firstPayment.created_at ? new Date(firstPayment.created_at) : null
        };
      }

      return {
        schedule: null,
        firstPaymentDate: null
      };
    } catch (error) {
      this.logger.error('Failed to get initial payment schedule', {
        dealId,
        error: error.message
      });
      return {
        schedule: null,
        firstPaymentDate: null
      };
    }
  }

  /**
   * Проверить, существует ли вторая сессия
   * Проверяет как в базе данных, так и в Stripe напрямую (на случай, если сессии нет в базе)
   * @param {string} dealId - ID сделки
   * @returns {Promise<boolean>}
   */
  async hasSecondPaymentSession(dealId) {
    try {
      // Сначала проверяем в базе данных
      const payments = await this.repository.listPayments({ dealId: String(dealId) });
      
      const restPayments = payments.filter(p => 
        (p.payment_type === 'rest' || p.payment_type === 'second' || p.payment_type === 'final')
      );

      if (restPayments.length === 0) {
        return false;
      }

      // Проверяем каждую rest сессию - активна ли она (создана менее 24 часов назад)
      const now = new Date();
      const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      for (const restPayment of restPayments) {
        // Если платеж оплачен - сессия не нужна
        if (restPayment.payment_status === 'paid' || restPayment.status === 'processed') {
          continue;
        }

        // Если есть session_id - проверяем, когда была создана сессия
        if (restPayment.session_id) {
          const sessionCreatedAt = restPayment.created_at ? new Date(restPayment.created_at) : null;
          
          // Если сессия создана менее 24 часов назад - она еще активна
          if (sessionCreatedAt && sessionCreatedAt > twentyFourHoursAgo) {
            // Дополнительно проверяем в Stripe, не истекла ли сессия
            try {
              const stripeSession = await this.stripeProcessor.stripe.checkout.sessions.retrieve(restPayment.session_id);
              
              // Если сессия активна (open) или оплачена - она еще активна
              if (stripeSession.status === 'open' || stripeSession.payment_status === 'paid') {
                this.logger.info('Found active second payment session', {
                  dealId,
                  sessionId: restPayment.session_id,
                  status: stripeSession.status,
                  paymentStatus: stripeSession.payment_status,
                  createdAt: sessionCreatedAt.toISOString(),
                  isWithin24Hours: true
                });
                return true;
              }
              
              // Если сессия истекла (expired) или завершена без оплаты - она неактивна
              if (stripeSession.status === 'expired' || (stripeSession.status === 'complete' && stripeSession.payment_status !== 'paid')) {
                this.logger.debug('Second payment session expired or completed without payment', {
                  dealId,
                  sessionId: restPayment.session_id,
                  status: stripeSession.status,
                  paymentStatus: stripeSession.payment_status
                });
                continue; // Проверяем следующую сессию
              }
            } catch (error) {
              // Если сессия не найдена в Stripe - она истекла или удалена
              if (error.code === 'resource_missing') {
                this.logger.debug('Second payment session not found in Stripe (expired or deleted)', {
                  dealId,
                  sessionId: restPayment.session_id
                });
                continue; // Проверяем следующую сессию
              }
              // Другие ошибки - логируем, но продолжаем проверку
              this.logger.warn('Error checking session in Stripe', {
                dealId,
                sessionId: restPayment.session_id,
                error: error.message
              });
            }
          } else {
            // Сессия создана более 24 часов назад - проверяем в Stripe, не истекла ли она
            try {
              const stripeSession = await this.stripeProcessor.stripe.checkout.sessions.retrieve(restPayment.session_id);
              
              // Если сессия все еще активна (open) - она активна
              if (stripeSession.status === 'open') {
                this.logger.info('Found active second payment session (older than 24h but still open in Stripe)', {
                  dealId,
                  sessionId: restPayment.session_id,
                  status: stripeSession.status,
                  createdAt: sessionCreatedAt ? sessionCreatedAt.toISOString() : 'N/A'
                });
                return true;
              }
            } catch (error) {
              // Если сессия не найдена - она истекла
              if (error.code === 'resource_missing') {
                this.logger.debug('Second payment session expired (not found in Stripe)', {
                  dealId,
                  sessionId: restPayment.session_id
                });
                continue;
              }
            }
          }
        } else {
          // Если нет session_id, но есть запись в БД - считаем, что сессия неактивна
          // (возможно, это старая запись или ошибка)
          this.logger.debug('Rest payment without session_id found', {
            dealId,
            paymentId: restPayment.id
          });
        }
      }

      // Если дошли сюда - нет активных rest сессий
      return false;
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
      // ВАЖНО: Ищем сделки по оплаченным deposit платежам с графиком 50/50,
      // а не по invoice_type, так как invoice_type сбрасывается после обработки первого платежа
      const allPayments = await this.repository.listPayments({ limit: 1000 });
      
      // Находим все оплаченные deposit платежи с графиком 50/50
      const depositPayments = allPayments.filter(p => 
        (p.payment_type === 'deposit' || p.payment_type === 'first') &&
        p.payment_status === 'paid' &&
        p.payment_schedule === '50/50' &&
        p.deal_id
      );

      if (depositPayments.length === 0) {
        return [];
      }

      // Получаем уникальные deal_id
      const dealIds = [...new Set(depositPayments.map(p => p.deal_id))];

      this.logger.info('Found deals with paid deposit payments (50/50)', {
        depositPaymentsCount: depositPayments.length,
        uniqueDealIds: dealIds.length
      });

      const eligibleDeals = [];
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      for (const dealId of dealIds) {
        try {
          // Получаем данные сделки
          const dealResult = await this.pipedriveClient.getDeal(dealId);
          if (!dealResult.success || !dealResult.deal) {
            continue;
          }

          const deal = dealResult.deal;

          // ПЕРВЫЙ ДОВОД: Проверяем дату второго платежа (за 30 дней до окончания кемпа) и полную оплату
          const campEndDate = deal.expected_close_date || deal.close_date;
          if (!campEndDate) {
            this.logger.debug('Skipping deal - no camp end date', { dealId: deal.id });
            continue;
          }

          // Вычисляем дату второго платежа (за 30 дней до окончания кемпа = expected_close_date - 1 месяц)
          const initialSchedule = await this.getInitialPaymentSchedule(deal.id);
          let secondPaymentDate = null;
          
          if (initialSchedule.schedule === '50/50' && campEndDate) {
            secondPaymentDate = this.calculateSecondPaymentDate(campEndDate);
          } else {
            const currentSchedule = this.determinePaymentSchedule(deal);
            secondPaymentDate = currentSchedule.secondPaymentDate;
          }

          // Если график не 50/50 или дата второго платежа не определена - пропускаем
          if (!secondPaymentDate) {
            this.logger.debug('Skipping deal - no second payment date (schedule is not 50/50)', {
              dealId: deal.id,
              initialSchedule: initialSchedule.schedule
            });
            continue;
          }

          const secondPaymentDateObj = new Date(secondPaymentDate);
          secondPaymentDateObj.setHours(0, 0, 0, 0);

          // ВАЖНО: Проверяем, наступила ли дата второго платежа (за 30 дней до окончания кемпа)
          // Второй платеж выставляется за 30 дней до даты закрытия сделки
          const isSecondPaymentDateReached = secondPaymentDateObj <= today;
          if (!isSecondPaymentDateReached) {
            this.logger.debug('Skipping deal - second payment date not reached (30 days before camp end)', {
              dealId: deal.id,
              campEndDate: new Date(campEndDate).toISOString().split('T')[0],
              secondPaymentDate: secondPaymentDateObj.toISOString().split('T')[0],
              today: today.toISOString().split('T')[0]
            });
            continue;
          }

          // Проверяем, оплачена ли вся сумма сделки
          const dealValue = parseFloat(deal.value) || 0;
          if (dealValue <= 0) {
            this.logger.debug('Skipping deal - no deal value', { dealId: deal.id });
            continue;
          }

          // Получаем все платежи для этой сделки
          const dealPayments = await this.repository.listPayments({ dealId: String(dealId) });
          const paidPayments = dealPayments.filter(p => p.payment_status === 'paid' || p.status === 'processed');

          // ВАЖНО: Считаем оплаченную сумму ТОЛЬКО в валюте сделки из CRM
          // Суммируем только платежи, где валюта платежа совпадает с валютой сделки
          const dealCurrency = deal.currency || 'PLN';
          let totalPaidInDealCurrency = 0;
          
          for (const payment of paidPayments) {
            // Суммируем только платежи в валюте сделки
            if (payment.currency === dealCurrency) {
              // Используем original_amount (сумма в оригинальной валюте платежа)
              // Если валюта совпадает с валютой сделки, это и есть нужная сумма
              const amount = parseFloat(payment.original_amount || payment.amount || 0);
              totalPaidInDealCurrency += amount;
            }
            // Платежи в других валютах игнорируем - они не должны влиять на проверку оплаты
            // Если нужна конвертация, это должно быть сделано отдельно и явно
          }

          // Проверяем, оплачена ли вся сумма (с учетом погрешности 95%)
          const isFullyPaid = totalPaidInDealCurrency >= dealValue * 0.95;
          if (isFullyPaid) {
            this.logger.debug('Skipping deal - fully paid', {
              dealId: deal.id,
              dealValue,
              totalPaid: totalPaidInDealCurrency,
              currency: deal.currency
            });
            continue;
          }

          // ВТОРОЙ ДОВОД: Проверяем, нет ли активных rest сессий (чтобы не было дублей)
          const hasSecond = await this.hasSecondPaymentSession(deal.id);
          if (hasSecond) {
            this.logger.debug('Skipping deal - already has active rest session', { dealId: deal.id });
            continue;
          }

          this.logger.info('Deal needs second payment', {
            dealId: deal.id,
            dealTitle: deal.title,
            campEndDate: new Date(campEndDate).toISOString().split('T')[0],
            secondPaymentDate: secondPaymentDateObj.toISOString().split('T')[0],
            dealValue,
            totalPaid: totalPaidInDealCurrency,
            currency: deal.currency
          });

          eligibleDeals.push({
            deal,
            secondPaymentDate: secondPaymentDateObj
          });
        } catch (error) {
          this.logger.error('Error processing deal in findDealsNeedingSecondPayment', {
            dealId,
            error: error.message
          });
          continue;
        }
      }

      this.logger.info('Found deals needing second payment', {
        count: eligibleDeals.length
      });

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

        // Проверяем, что первый платеж оплачен
        const firstPaid = await this.isFirstPaymentPaid(deal.id);
        if (!firstPaid) {
          continue;
        }

        // ВАЖНО: Используем первичный график из первого платежа, а не текущий график
        // Это исправляет проблему, когда график "изменился" с 50/50 на 100% из-за того,
        // что до лагеря осталось меньше 30 дней, но первый платеж был создан с графиком 50/50
        const initialSchedule = await this.getInitialPaymentSchedule(deal.id);
        
        let schedule = null;
        let secondPaymentDate = null;

        // Если есть первичный график 50/50 из первого платежа - используем его
        if (initialSchedule.schedule === '50/50') {
          schedule = '50/50';
          // Вычисляем дату второго платежа на основе expected_close_date
          const closeDate = deal.expected_close_date || deal.close_date;
          if (closeDate) {
            secondPaymentDate = this.calculateSecondPaymentDate(closeDate);
          }
        } else {
          // Если первичного графика нет, используем текущий график (fallback)
          const currentSchedule = this.determinePaymentSchedule(deal);
          schedule = currentSchedule.schedule;
          secondPaymentDate = currentSchedule.secondPaymentDate;
        }

        // Проверяем, что график 50/50 и дата второго платежа определена
        if (schedule !== '50/50' || !secondPaymentDate) {
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

        // Отправляем уведомление клиенту (так как создание через cron, а не webhook)
        // В webhook уведомление отправляется после создания всех сессий, но здесь только одна сессия
        try {
          const notificationResult = await this.stripeProcessor.sendPaymentNotificationForDeal(deal.id, {
            paymentSchedule: '50/50',
            sessions: [{
              id: result.sessionId,
              url: result.sessionUrl,
              type: 'rest',
              amount: result.amount
            }],
            currency: result.currency,
            totalAmount: parseFloat(deal.value) || 0
          });

          if (notificationResult.success) {
            this.logger.info('Payment notification sent successfully', {
              dealId: deal.id,
              sessionId: result.sessionId
            });
          } else {
            this.logger.warn('Failed to send payment notification', {
              dealId: deal.id,
              sessionId: result.sessionId,
              error: notificationResult.error
            });
          }
        } catch (notifyError) {
          this.logger.error('Error sending payment notification', {
            dealId: deal.id,
            sessionId: result.sessionId,
            error: notifyError.message
          });
          // Не прерываем выполнение, если уведомление не отправилось
        }

        // Логируем, что задача-напоминание будет доступна в cron
        this.logger.info('✅ Reminder task will be available in cron queue', {
          dealId: deal.id,
          sessionId: result.sessionId,
          secondPaymentDate: secondPaymentDate.toISOString().split('T')[0],
          note: 'Task will appear in /api/second-payment-scheduler/upcoming-tasks via findReminderTasks() after date is reached'
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
   * Ищем по платежам в базе данных И в Stripe напрямую (для просроченных сессий)
   * @returns {Promise<Array>} - Массив задач для напоминаний
   */
  async findReminderTasks() {
    try {
      // Получаем все неоплаченные вторые платежи из базы данных
      const allPayments = await this.repository.listPayments({});
      
      // Фильтруем только вторые платежи (rest/second/final), которые не оплачены
      const unpaidSecondPayments = allPayments.filter(p => 
        (p.payment_type === 'rest' || p.payment_type === 'second' || p.payment_type === 'final') &&
        p.payment_status !== 'paid' &&
        p.deal_id // Должен быть deal_id
      );

      // Также ищем просроченные сессии в Stripe напрямую (которые могут не быть в базе)
      const expiredSessionsFromStripe = await this.findExpiredUnpaidSessionsFromStripe();

      // Объединяем deal_id из базы и из Stripe
      const dealIdsFromDb = [...new Set(unpaidSecondPayments.map(p => p.deal_id))];
      const dealIdsFromStripe = [...new Set(expiredSessionsFromStripe.map(s => s.dealId))];
      const allDealIds = [...new Set([...dealIdsFromDb, ...dealIdsFromStripe])];

      if (allDealIds.length === 0) {
        return [];
      }

      const reminderTasks = [];
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Для каждой сделки проверяем условия
      for (const dealId of allDealIds) {
        try {
          // Получаем данные сделки из Pipedrive
          const dealResult = await this.pipedriveClient.getDeal(dealId);
          if (!dealResult.success || !dealResult.deal) {
            continue;
          }

          const deal = dealResult.deal;

          // ВАЖНО: Используем первичный график из первого платежа, а не текущий график
          const initialSchedule = await this.getInitialPaymentSchedule(deal.id);
          
          let schedule = null;
          let secondPaymentDate = null;

          // Если есть первичный график 50/50 из первого платежа - используем его
          if (initialSchedule.schedule === '50/50') {
            schedule = '50/50';
            // Вычисляем дату второго платежа на основе expected_close_date
            const closeDate = deal.expected_close_date || deal.close_date;
            if (closeDate) {
              secondPaymentDate = this.calculateSecondPaymentDate(closeDate);
            }
          } else {
            // Если первичного графика нет, используем текущий график (fallback)
            const currentSchedule = this.determinePaymentSchedule(deal);
            schedule = currentSchedule.schedule;
            secondPaymentDate = currentSchedule.secondPaymentDate;
          }

          if (schedule !== '50/50' || !secondPaymentDate) {
            continue;
          }

          // Проверяем, что дата второго платежа наступила
          if (!this.isDateReached(secondPaymentDate)) {
            continue;
          }

          // Проверяем, что первый платеж оплачен
          const firstPaid = await this.isFirstPaymentPaid(dealId);
          if (!firstPaid) {
            continue;
          }

          // Получаем вторую сессию для этой сделки
          // Сначала ищем в базе данных
          const payments = await this.repository.listPayments({ dealId: String(dealId) });
          
          // КРИТИЧЕСКИ ВАЖНО: Проверяем, есть ли уже ОПЛАЧЕННЫЙ второй платеж
          // ВАЖНО: Проверяем не только статус, но и СУММУ (как в проформах)
          const dealValueForCheck = parseFloat(deal.value) || 0;
          const currencyForCheck = deal.currency || 'PLN';
          const expectedSecondPayment = dealValueForCheck / 2; // Для графика 50/50
          
          // Находим все оплаченные вторые платежи
          const paidSecondPayments = payments.filter(p => 
            (p.payment_type === 'rest' || p.payment_type === 'second' || p.payment_type === 'final') &&
            p.payment_status === 'paid'
          );
          
          // Суммируем все оплаченные вторые платежи
          const paidSecondPaymentTotal = paidSecondPayments.reduce((sum, p) => {
            const amount = parseFloat(p.original_amount || p.amount || 0);
            return sum + amount;
          }, 0);
          
          // Проверяем что оплачено >= 90% от ожидаемой суммы (как в проформах)
          const secondPaymentPaid = paidSecondPaymentTotal >= expectedSecondPayment * 0.9;
          
          if (secondPaymentPaid) {
            this.logger.info('Skipping reminder task - second payment already paid', {
              dealId,
              expectedSecondPayment: expectedSecondPayment,
              paidSecondPaymentTotal: paidSecondPaymentTotal,
              paidSecondPaymentsCount: paidSecondPayments.length,
              paidSecondPayments: paidSecondPayments.map(p => ({
                id: p.id,
                sessionId: p.session_id,
                amount: p.original_amount || p.amount,
                currency: p.currency
              })),
              currency: currencyForCheck
            });
            continue; // Второй платеж уже оплачен, не нужно напоминание
          }

          // КРИТИЧЕСКИ ВАЖНО: Проверяем, не отправляли ли уже напоминание для этой сделки и даты второго платежа
          // Защита от дубликатов работает постоянно (не только на один день), так как cron работает раз в день
          const alreadySent = await this.wasReminderSentEver(dealId, secondPaymentDate);
          if (alreadySent) {
            this.logger.info('Skipping reminder task - reminder already sent for this deal and second payment date', {
              dealId,
              secondPaymentDate: this.normalizeDate(secondPaymentDate)
            });
            continue; // Напоминание уже было отправлено ранее для этой комбинации
          }
          
          // ВАЖНО: Проверяем, есть ли уже активная сессия для этой сделки
          // Если есть активная сессия, не показываем просроченные (они уже обработаны)
          const hasActiveSession = payments.some(p => {
            if (!p.session_id) return false;
            // Проверяем статус в базе
            if (p.status === 'open' || p.status === 'complete') {
              return true;
            }
            // Если статус 'processed', но payment_status 'unpaid' - это может быть активная сессия
            if (p.status === 'processed' && p.payment_status === 'unpaid') {
              return true;
            }
            return false;
          });

          if (hasActiveSession) {
            // Проверяем, что активная сессия создана недавно (после просроченной)
            const activePayments = payments.filter(p => 
              p.session_id && 
              (p.status === 'open' || p.status === 'complete' || (p.status === 'processed' && p.payment_status === 'unpaid'))
            );
            
            if (activePayments.length > 0) {
              // Сортируем по дате создания и берем самую новую
              activePayments.sort((a, b) => {
                const dateA = a.created_at ? new Date(a.created_at) : new Date(0);
                const dateB = b.created_at ? new Date(b.created_at) : new Date(0);
                return dateB - dateA;
              });
              
              const newestActivePayment = activePayments[0];
              const newestActiveDate = newestActivePayment.created_at ? new Date(newestActivePayment.created_at) : new Date(0);
              
              // Если активная сессия создана недавно (за последние 7 дней), пропускаем просроченные
              const sevenDaysAgo = new Date();
              sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
              
              if (newestActiveDate > sevenDaysAgo) {
                // Активная сессия создана недавно - пропускаем просроченные
                this.logger.info('Skipping expired sessions for reminder, active session exists', {
                  dealId,
                  activeSessionId: newestActivePayment.session_id,
                  activeSessionCreated: newestActiveDate.toISOString()
                });
                continue;
              }
            }
          }
          
          let restPayment = payments.find(p => 
            (p.payment_type === 'rest' || p.payment_type === 'second' || p.payment_type === 'final') &&
            p.payment_status !== 'paid'
          );

          // Если не нашли в базе, ищем в просроченных сессиях из Stripe
          let expiredSession = null;
          if (!restPayment) {
            const expiredSessions = await this.findExpiredUnpaidSessionsFromStripe();
            expiredSession = expiredSessions.find(s => String(s.dealId) === String(dealId));
            
            if (expiredSession) {
              // КРИТИЧЕСКИ ВАЖНО: Проверяем оплату ЕЩЕ РАЗ перед добавлением просроченной сессии
              // Платеж мог быть оплачен через другую сессию после того, как эта просрочилась
              const paymentsCheck = await this.repository.listPayments({ dealId: String(dealId) });
              const paidSecondPaymentCheck = paymentsCheck.find(p => 
                (p.payment_type === 'rest' || p.payment_type === 'second' || p.payment_type === 'final') &&
                p.payment_status === 'paid'
              );
              
              if (paidSecondPaymentCheck) {
                this.logger.info('Skipping expired session - second payment already paid via another session', {
                  dealId,
                  expiredSessionId: expiredSession.sessionId,
                  paidPaymentId: paidSecondPaymentCheck.id,
                  paidSessionId: paidSecondPaymentCheck.session_id,
                  paidAmount: paidSecondPaymentCheck.original_amount || paidSecondPaymentCheck.amount,
                  paidAt: paidSecondPaymentCheck.processed_at || paidSecondPaymentCheck.created_at
                });
                continue; // Второй платеж уже оплачен через другую сессию
              }
              
              // Создаем объект, похожий на restPayment для единообразия
              restPayment = {
                session_id: expiredSession.sessionId,
                payment_type: expiredSession.paymentType,
                payment_status: 'unpaid',
                payment_schedule: expiredSession.paymentSchedule,
                original_amount: expiredSession.amount,
                currency: expiredSession.currency,
                raw_payload: {
                  url: expiredSession.url
                }
              };
              this.logger.info('Found expired session from Stripe for reminder task', {
                dealId,
                sessionId: expiredSession.sessionId
              });
            }
          }

          if (!restPayment) {
            continue; // Сессия оплачена или не найдена
          }

          // Получаем URL сессии
          let sessionUrl = null;
          // Сначала пытаемся получить из raw_payload (быстрее)
          if (restPayment.raw_payload && restPayment.raw_payload.url) {
            sessionUrl = restPayment.raw_payload.url;
          } else if (expiredSession && expiredSession.url) {
            sessionUrl = expiredSession.url;
          } else {
            // Если нет в raw_payload, получаем из Stripe API
            try {
              // Проверяем режим Stripe перед запросом
              const { getStripeMode } = require('../stripe/client');
              const sessionId = restPayment.session_id;
              const isTestSession = sessionId.startsWith('cs_test_');
              
              // Всегда live режим, пропускаем test сессии
              if (isTestSession) {
                this.logger.debug('Skipping session URL retrieval - test session (only live mode used)', {
                  dealId: deal.id,
                  sessionId
                });
                sessionUrl = null;
              } else {
                const stripeSession = await this.stripeProcessor.stripe.checkout.sessions.retrieve(restPayment.session_id);
                sessionUrl = stripeSession.url || null;
              }
            } catch (error) {
              this.logger.warn('Failed to retrieve session URL from Stripe', {
                dealId: deal.id,
                sessionId: restPayment.session_id,
                error: error.message
              });
            }
          }
          
          // Если сессия просрочена, URL будет null - это нормально
          if (!sessionUrl && expiredSession) {
            this.logger.info('Expired session has no active URL, will need to recreate', {
              dealId,
              sessionId: restPayment.session_id
            });
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
        } catch (error) {
          this.logger.warn('Error processing deal for reminder task', {
            dealId,
            error: error.message
          });
          continue;
        }
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
   * Нормализовать дату в строку формата YYYY-MM-DD
   * @param {Date|string} value - Дата для нормализации
   * @returns {string|null} - Нормализованная дата или null
   */
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

  /**
   * Получить ключ кеша для напоминания
   * @param {number} dealId - ID сделки
   * @param {Date|string} secondPaymentDate - Дата второго платежа
   * @returns {string|null} - Ключ кеша или null
   */
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
   * @param {Date|string} secondPaymentDate - Дата второго платежа
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
        .from('stripe_reminder_logs')
        .select('id')
        .match({
          deal_id: dealId,
          second_payment_date: secondPaymentDateStr
        })
        .limit(1);

      if (error) {
        this.logger.warn('Failed to check Stripe reminder log in Supabase', {
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
      this.logger.warn('Failed to check if Stripe reminder was sent ever', {
        dealId,
        error: error.message
      });
      return false;
    }
  }

  /**
   * Сохранить запись об отправленном напоминании или создании сессии в базу данных
   * @param {Object} logData - Данные для логирования
   * @param {number} logData.dealId - ID сделки
   * @param {Date|string} logData.secondPaymentDate - Дата второго платежа
   * @param {string} logData.sessionId - ID Stripe checkout session
   * @param {string} logData.sendpulseId - ID контакта в SendPulse
   * @param {string} logData.trigger - Источник запуска
   * @param {string} logData.runId - Run ID
   * @param {string} logData.actionType - Тип действия: 'session_created' или 'reminder_sent'
   */
  async persistReminderLog({ dealId, secondPaymentDate, sessionId, sendpulseId, trigger, runId, actionType = 'reminder_sent' }) {
    const cacheKey = this.getReminderCacheKey(dealId, secondPaymentDate);
    if (cacheKey) {
      this.sentCache.add(cacheKey);
    }

    if (!supabase) {
      this.logger.warn('Supabase not available, cannot persist Stripe reminder log', { dealId });
      return;
    }

    try {
      const todayStr = this.normalizeDate(new Date());
      const secondPaymentDateStr = this.normalizeDate(secondPaymentDate);
      if (!todayStr || !secondPaymentDateStr) {
        this.logger.warn('Invalid dates for Stripe reminder log', {
          dealId,
          secondPaymentDate,
          todayStr,
          secondPaymentDateStr
        });
        return;
      }

      const payload = {
        deal_id: dealId,
        second_payment_date: secondPaymentDateStr,
        session_id: sessionId || null,
        sent_date: todayStr,
        run_id: runId || null,
        trigger_source: trigger || null,
        sendpulse_id: sendpulseId || null,
        action_type: actionType || 'reminder_sent'
      };

      const { error } = await supabase.from('stripe_reminder_logs').insert(payload);
      if (error) {
        if (error.code === '23505') {
          // Unique constraint violation - это нормально, означает что напоминание уже было записано
          this.logger.info('Stripe reminder already recorded', {
            dealId,
            secondPaymentDate: secondPaymentDateStr
          });
        } else {
          this.logger.warn('Failed to store Stripe reminder log', {
            dealId,
            error: error.message,
            errorCode: error.code
          });
        }
      } else {
        this.logger.debug('Stripe reminder log persisted successfully', {
          dealId,
          secondPaymentDate: secondPaymentDateStr,
          sessionId
        });
      }
    } catch (error) {
      this.logger.warn('Failed to persist Stripe reminder log', {
        dealId,
        error: error.message
      });
    }
  }

  /**
   * Отправить напоминание о втором платеже клиенту
   * @param {Object} task - Задача для напоминания
   * @param {Object} options - Опции отправки
   * @returns {Promise<Object>} - Результат отправки
   */
  async sendReminder(task, options = {}) {
    const { trigger = 'manual', runId = null, isRecreated = false } = options;
    
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

      // Определяем тип платежа
      const isDeposit = task.paymentType === 'deposit';
      const isRest = task.paymentType === 'rest' || task.paymentType === 'second' || task.paymentType === 'final';
      
      // Формируем сообщение
      let message = '';
      
      if (isRecreated) {
        message = `Привет! Предыдущая ссылка на оплату истекла, создал новую.\n\n`;
      } else {
        if (isDeposit) {
          message = `Привет! Напоминаю о первом платеже.\n\n`;
        } else {
          message = `Привет! Напоминаю о втором платеже.\n\n`;
        }
      }
      
      if (task.sessionUrl) {
        message += `[Ссылка на оплату](${task.sessionUrl})\n`;
        message += `Ссылка действует 24 часа\n\n`;
      } else if (isRecreated) {
        message += `⚠️ Новая ссылка создана, но не получена. Пожалуйста, свяжитесь с нами.\n\n`;
      }
      
      // Используем paymentAmount для обоих типов платежей
      const amount = task.paymentAmount || task.secondPaymentAmount || 0;
      message += `Сумма: ${formatAmount(amount)} ${task.currency}\n`;
      
      // Для второго платежа добавляем дату
      if (isRest && task.secondPaymentDate) {
        message += `Дата платежа: ${formatDate(task.secondPaymentDate)}\n`;
      }

      // ВАЖНО: Проверяем статус сделки перед отправкой уведомления
      // Если сделка закрыта как "lost", не отправляем уведомления
      try {
        const dealResult = await this.pipedriveClient.getDeal(task.dealId);
        if (dealResult.success && dealResult.deal) {
          const dealStatus = dealResult.deal.status;
          if (dealStatus === 'lost') {
            this.logger.warn('⚠️  Сделка закрыта как потерянная, уведомление не отправляется', {
              dealId: task.dealId,
              status: dealStatus,
              lostReason: dealResult.deal.lost_reason || 'не указан'
            });
            return { success: false, error: 'Deal is lost, notifications disabled' };
          }
        }
      } catch (error) {
        this.logger.warn('Failed to check deal status before sending reminder', {
          dealId: task.dealId,
          error: error.message
        });
        // Продолжаем отправку, если не удалось проверить статус
      }

      // Отправляем через SendPulse
      const result = await this.stripeProcessor.sendpulseClient.sendTelegramMessage(sendpulseId, message);
      
      // Phase 9: Update SendPulse contact custom field with deal_id (Phase 0: Code Review Fixes)
      if (result.success) {
        try {
          await this.stripeProcessor.sendpulseClient.updateContactCustomField(sendpulseId, {
            deal_id: String(task.deal.id)
          });
          this.logger.debug('SendPulse contact deal_id updated', {
            dealId: task.deal.id,
            sendpulseId
          });
        } catch (error) {
          this.logger.warn('Failed to update SendPulse contact deal_id', {
            dealId: task.deal.id,
            sendpulseId,
            error: error.message
          });
          // Не прерываем выполнение, если обновление deal_id не удалось
        }

        // Сохраняем запись об отправленном напоминании в базу данных
        await this.persistReminderLog({
          dealId: task.dealId,
          secondPaymentDate: task.secondPaymentDate,
          sessionId: task.sessionId || null,
          sendpulseId: sendpulseId,
          trigger: trigger,
          runId: runId,
          actionType: 'reminder_sent'
        });
      }

      if (result.success) {
        this.logger.info('Stripe second payment reminder sent successfully', {
          dealId: task.dealId,
          sendpulseId,
          trigger,
          runId,
          sessionId: task.sessionId
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
   * Найти все просроченные неоплаченные сессии для задач cron
   * @returns {Promise<Array>} - Массив задач для пересоздания сессий
   */
  async findExpiredSessionTasks() {
    try {
      const expiredSessions = await this.findExpiredUnpaidSessionsFromStripe();
      if (expiredSessions.length === 0) {
        return [];
      }

      const tasks = [];
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Группируем по deal_id
      const dealIds = [...new Set(expiredSessions.map(s => s.dealId))];

      for (const dealId of dealIds) {
        try {
          // Получаем данные сделки
          const dealResult = await this.pipedriveClient.getDeal(dealId);
          if (!dealResult.success || !dealResult.deal) {
            continue;
          }

          const deal = dealResult.deal;

          // ИСКЛЮЧАЕМ тестовые сделки TEST_AUTO_
          if (deal.title && deal.title.includes('TEST_AUTO_')) {
            this.logger.debug('Skipping test deal in expired sessions', {
              dealId: deal.id,
              dealTitle: deal.title
            });
            continue;
          }

          // ИСКЛЮЧАЕМ сделки в статусе "lost" - не нужно пересоздавать сессии для потерянных сделок
          if (deal.status === 'lost' || deal.status === 'deleted' || deal.deleted === true) {
            this.logger.debug('Skipping lost/deleted deal in expired sessions', {
              dealId: deal.id,
              dealTitle: deal.title,
              status: deal.status,
              lostReason: deal.lost_reason || 'не указан'
            });
            continue;
          }

          // ИСКЛЮЧАЕМ сделки с invoice_type = "Delete" (74) - не нужно пересоздавать сессии для удаленных сделок
          const invoiceTypeFieldKey = 'ad67729ecfe0345287b71a3b00910e8ba5b3b496';
          if (deal[invoiceTypeFieldKey]) {
            const invoiceType = String(deal[invoiceTypeFieldKey]).trim();
            if (invoiceType === '74' || invoiceType.toLowerCase() === 'delete') {
              this.logger.debug('Skipping deal with invoice_type = Delete in expired sessions', {
                dealId: deal.id,
                dealTitle: deal.title,
                invoiceType
              });
              continue;
            }
          }

          // Получаем платежи для проверки активных сессий
          const payments = await this.repository.listPayments({ dealId: String(dealId), limit: 100 });
          
          // Находим все просроченные сессии для этой сделки
          const dealExpiredSessions = expiredSessions.filter(s => String(s.dealId) === String(dealId));
          if (dealExpiredSessions.length === 0) {
            continue;
          }

          // ВАЖНО: Проверяем активные сессии напрямую в Stripe API, а не только в БД
          // В БД может быть запись с status: 'open', но в Stripe сессия уже истекла
          // Также в Stripe может быть активная сессия, которой нет в БД
          let hasActiveSessionInStripe = false;
          try {
            // Получаем все открытые сессии за последние 7 дней и фильтруем по deal_id
            const sevenDaysAgo = Math.floor((Date.now() - 7 * 24 * 60 * 60 * 1000) / 1000);
            const allOpenSessions = await this.stripeProcessor.stripe.checkout.sessions.list({
              limit: 100,
              status: 'open',
              created: { gte: sevenDaysAgo }
            });
            
            // Фильтруем по deal_id в metadata
            const stripeSessionsWithDealId = allOpenSessions.data.filter(s => 
              s.metadata?.deal_id === String(dealId)
            );
            
            // Проверяем статус каждой сессии
            for (const stripeSession of stripeSessionsWithDealId) {
              const isTestSession = stripeSession.id.startsWith('cs_test_');
              if (isTestSession) continue;
              
              // Только открытые (open) сессии считаются активными
              if (stripeSession.status === 'open') {
                hasActiveSessionInStripe = true;
                this.logger.debug('Found active open session in Stripe', {
                  dealId,
                  sessionId: stripeSession.id,
                  paymentType: stripeSession.metadata?.payment_type,
                  status: stripeSession.status
                });
                break; // Нашли активную сессию, достаточно
              }
            }
            
            // Если не нашли через metadata, делаем более широкий поиск (медленнее)
            if (!hasActiveSessionInStripe) {
              const sevenDaysAgo = Math.floor((Date.now() - 7 * 24 * 60 * 60 * 1000) / 1000);
              const allRecentSessions = await this.stripeProcessor.stripe.checkout.sessions.list({
                limit: 100,
                created: { gte: sevenDaysAgo },
                status: 'open'
              });
              
              // Фильтруем по deal_id в metadata
              const dealSessions = allRecentSessions.data.filter(s => 
                s.metadata?.deal_id === String(dealId)
              );
              
              if (dealSessions.length > 0) {
                hasActiveSessionInStripe = true;
                this.logger.debug('Found active open session in Stripe (via broader search)', {
                  dealId,
                  sessionId: dealSessions[0].id,
                  paymentType: dealSessions[0].metadata?.payment_type,
                  status: dealSessions[0].status
                });
              }
            }
          } catch (error) {
            this.logger.warn('Failed to check active sessions in Stripe API', {
              dealId,
              error: error.message
            });
            // Продолжаем обработку в случае ошибки
          }
          
          // Также проверяем сессии из БД, которые помечены как 'open'
          // ВАЖНО: Проверяем их реальный статус в Stripe, так как в БД может быть устаревшая информация
          const activeOpenPayments = payments.filter(p => {
            if (!p.session_id) return false;
            // Только открытые сессии считаются активными для блокировки пересоздания
            return p.status === 'open' || (p.status === 'processed' && p.payment_status === 'unpaid');
          });

          // Проверяем реальный статус в Stripe для сессий из БД
          if (activeOpenPayments.length > 0 && !hasActiveSessionInStripe) {
            for (const activePayment of activeOpenPayments) {
              try {
                const sessionId = activePayment.session_id;
                const isTestSession = sessionId.startsWith('cs_test_');
                
                if (isTestSession) {
                  continue;
                }
                
                const stripeSession = await this.stripeProcessor.stripe.checkout.sessions.retrieve(sessionId);
                
                // Проверяем только ОТКРЫТЫЕ (open) сессии как активные
                if (stripeSession.status === 'open') {
                  hasActiveSessionInStripe = true;
                  this.logger.debug('Found active open session in Stripe (from DB)', {
                    dealId,
                    sessionId: activePayment.session_id,
                    paymentType: stripeSession.metadata?.payment_type || activePayment.payment_type,
                    status: stripeSession.status
                  });
                  break; // Нашли активную сессию, достаточно
                }
              } catch (error) {
                this.logger.warn('Failed to check session status in Stripe', {
                  dealId,
                  sessionId: activePayment.session_id,
                  error: error.message
                });
              }
            }
          }
          
          // Если есть активная сессия в Stripe, логируем для отладки
          if (hasActiveSessionInStripe) {
            this.logger.info('Active open session found in Stripe, expired sessions will be filtered by type', {
              dealId,
              expiredSessionsCount: dealExpiredSessions.length,
              note: 'Expired sessions of different payment types will still be processed'
            });
          }

          // Определяем график платежей
          const { schedule, secondPaymentDate } = this.determinePaymentSchedule(deal);
          
          // ВАЖНО: Проверяем, полностью ли оплачена сделка
          // Если сделка полностью оплачена, не пересоздаем истекшие сессии
          // (они могли быть ошибочными или на неправильные суммы)
          try {
            const dealValue = parseFloat(deal.value) || 0;
            
            // Проверяем общую сумму оплаченных платежей
            const paidPayments = payments.filter(p => p.payment_status === 'paid' || p.status === 'processed');
            let totalPaid = 0;
            for (const payment of paidPayments) {
              // Используем amount_pln если есть, иначе amount
              const amount = parseFloat(payment.amount_pln || payment.amount || 0);
              totalPaid += amount;
            }
            
            // Если оплачено >= суммы сделки (с учетом небольшой погрешности 95%),
            // считаем сделку полностью оплаченной
            const isFullyPaidByAmount = dealValue > 0 && totalPaid >= dealValue * 0.95;
            
            // Также проверяем через PaymentStateAnalyzer для графика платежей
            const paymentSchedule = PaymentScheduleService.determineSchedule(deal);
            const isFullyPaidBySchedule = await this.paymentStateAnalyzer.isDealFullyPaid(dealId, paymentSchedule);
            
            // Сделка полностью оплачена, если оплачено по сумме ИЛИ по графику
            const isFullyPaid = isFullyPaidByAmount || isFullyPaidBySchedule;
            
            if (isFullyPaid) {
              this.logger.info('Skipping expired sessions for fully paid deal', {
                dealId,
                dealTitle: deal.title,
                dealValue: dealValue,
                totalPaid: totalPaid,
                paidRatio: dealValue > 0 ? (totalPaid / dealValue * 100).toFixed(2) + '%' : 'N/A',
                isFullyPaidByAmount,
                isFullyPaidBySchedule,
                schedule: schedule,
                expiredSessionsCount: dealExpiredSessions.length,
                note: 'Deal is fully paid, expired sessions are likely erroneous and should not be recreated'
              });
              continue; // Пропускаем всю сделку, если она полностью оплачена
            }
          } catch (error) {
            this.logger.warn('Failed to check if deal is fully paid, continuing with expired session processing', {
              dealId,
              error: error.message
            });
            // Продолжаем обработку в случае ошибки проверки
          }
          
          // Группируем сессии по типу платежа, чтобы обработать только одну сессию каждого типа
          // Это предотвращает дубликаты напоминаний, если для одной сделки есть несколько просроченных сессий
          // (например, если первая сессия создалась автоматически, но уведомление не отправилось,
          // а потом создали вторую сессию вручную)
          const sessionsByType = new Map();
          for (const expiredSession of dealExpiredSessions) {
            // Нормализуем тип платежа (rest/second/final считаются одним типом)
            let paymentType = expiredSession.paymentType || 'unknown';
            if (paymentType === 'second' || paymentType === 'final') {
              paymentType = 'rest';
            }
            
            if (!sessionsByType.has(paymentType)) {
              sessionsByType.set(paymentType, []);
            }
            sessionsByType.get(paymentType).push(expiredSession);
          }
          
          // Для каждого типа платежа обрабатываем только одну сессию (самую новую по expiresAt)
          for (const [paymentType, sessions] of sessionsByType.entries()) {
            // Сортируем по expiresAt (самая новая первая) и берем только первую
            const sortedSessions = sessions.sort((a, b) => {
              const aExpires = a.expiresAt || 0;
              const bExpires = b.expiresAt || 0;
              return bExpires - aExpires; // Сортируем по убыванию (новая первая)
            });
            
            const expiredSession = sortedSessions[0];
            
            // Логируем, если было несколько сессий одного типа
            if (sortedSessions.length > 1) {
              this.logger.info('Multiple expired sessions of same type found, processing only the newest', {
                dealId,
                paymentType,
                totalSessions: sortedSessions.length,
                selectedSessionId: expiredSession.sessionId,
                selectedExpiresAt: expiredSession.expiresAt ? new Date(expiredSession.expiresAt * 1000).toISOString() : 'N/A',
                skippedSessions: sortedSessions.slice(1).map(s => ({
                  sessionId: s.sessionId,
                  expiresAt: s.expiresAt ? new Date(s.expiresAt * 1000).toISOString() : 'N/A'
                }))
              });
            }
            
            const isDeposit = expiredSession.paymentType === 'deposit';
            const isRest = expiredSession.paymentType === 'rest' || 
                          expiredSession.paymentType === 'second' || 
                          expiredSession.paymentType === 'final';
            const isSingle = expiredSession.paymentType === 'single';

            // Для первого платежа (deposit) - проверяем, нет ли активной deposit сессии
            if (isDeposit) {
              // ВАЖНО: Проверяем активные deposit сессии напрямую в Stripe API
              let hasActiveDepositSession = false;
              
              try {
                // Получаем все открытые сессии за последние 7 дней и фильтруем по deal_id
                const sevenDaysAgo = Math.floor((Date.now() - 7 * 24 * 60 * 60 * 1000) / 1000);
                const allOpenSessions = await this.stripeProcessor.stripe.checkout.sessions.list({
                  limit: 100,
                  status: 'open',
                  created: { gte: sevenDaysAgo }
                });
                
                // Фильтруем по deal_id в metadata
                const stripeSessionsWithDealId = allOpenSessions.data.filter(s => 
                  s.metadata?.deal_id === String(dealId)
                );
                
                // Ищем активные deposit сессии
                for (const stripeSession of stripeSessionsWithDealId) {
                  const isTestSession = stripeSession.id.startsWith('cs_test_');
                  if (isTestSession) continue;
                  
                  const paymentType = stripeSession.metadata?.payment_type;
                  if (paymentType === 'deposit' && stripeSession.status === 'open') {
                    // Есть активная открытая deposit сессия
                    const activeCreated = stripeSession.created ? new Date(stripeSession.created * 1000) : new Date(0);
                    const expiredDate = expiredSession.expiresAt ? new Date(expiredSession.expiresAt * 1000) : new Date(0);
                    
                    if (expiredDate < activeCreated) {
                      // Истекшая сессия старше активной - пропускаем
                      this.logger.info('Skipping expired deposit session, active deposit session exists', {
                        dealId,
                        expiredSessionId: expiredSession.sessionId,
                        activeSessionId: stripeSession.id,
                        expiredDate: expiredDate.toISOString(),
                        activeCreated: activeCreated.toISOString()
                      });
                      hasActiveDepositSession = true;
                      break;
                    }
                  }
                }
                
                // Если не нашли через metadata, проверяем сессии из БД
                if (!hasActiveDepositSession) {
                  const activeDepositPayments = payments.filter(p => {
                    if (!p.session_id || p.payment_type !== 'deposit') return false;
                    return p.status === 'open' || (p.status === 'processed' && p.payment_status === 'unpaid');
                  });
                  
                  for (const activeDepositPayment of activeDepositPayments) {
                    try {
                      const sessionId = activeDepositPayment.session_id;
                      const isTestSession = sessionId.startsWith('cs_test_');
                      if (isTestSession) continue;
                      
                      const stripeSession = await this.stripeProcessor.stripe.checkout.sessions.retrieve(sessionId);
                      if (stripeSession.status === 'open') {
                        // Есть активная открытая deposit сессия
                        const activeCreated = stripeSession.created ? new Date(stripeSession.created * 1000) : new Date(0);
                        const expiredDate = expiredSession.expiresAt ? new Date(expiredSession.expiresAt * 1000) : new Date(0);
                        
                        if (expiredDate < activeCreated) {
                          // Истекшая сессия старше активной - пропускаем
                          this.logger.info('Skipping expired deposit session, active deposit session exists', {
                            dealId,
                            expiredSessionId: expiredSession.sessionId,
                            activeSessionId: activeDepositPayment.session_id,
                            expiredDate: expiredDate.toISOString(),
                            activeCreated: activeCreated.toISOString()
                          });
                          hasActiveDepositSession = true;
                          break;
                        }
                      }
                    } catch (error) {
                      this.logger.warn('Failed to check active deposit session status', {
                        dealId,
                        sessionId: activeDepositPayment.session_id,
                        error: error.message
                      });
                    }
                  }
                }
              } catch (error) {
                this.logger.warn('Failed to check active deposit sessions in Stripe', {
                  dealId,
                  error: error.message
                });
                // Продолжаем обработку в случае ошибки
              }
              
              if (hasActiveDepositSession) {
                continue; // Есть активная deposit сессия, не пересоздаем
              }
              // Если нет активной deposit сессии, можно пересоздавать
            } 
            // Для второго платежа (rest/second/final) - проверяем условия
            else if (isRest) {
              // КРИТИЧЕСКИ ВАЖНО: Проверяем, есть ли уже ОПЛАЧЕННЫЙ второй платеж
              // Если второй платеж уже оплачен, не пересоздаем просроченную сессию
              // Используем переменную payments, которая уже объявлена выше в этом методе
              const paidSecondPayment = payments.find(p => 
                (p.payment_type === 'rest' || p.payment_type === 'second' || p.payment_type === 'final') &&
                (p.payment_status === 'paid' || p.status === 'processed')
              );
              
              if (paidSecondPayment) {
                this.logger.info('Skipping expired session recreation - second payment already paid', {
                  dealId,
                  expiredSessionId: expiredSession.sessionId,
                  paidPaymentId: paidSecondPayment.id,
                  paidSessionId: paidSecondPayment.session_id,
                  paidAmount: paidSecondPayment.original_amount || paidSecondPayment.amount,
                  paidCurrency: paidSecondPayment.currency,
                  paidAt: paidSecondPayment.processed_at || paidSecondPayment.created_at
                });
                continue; // Второй платеж уже оплачен, не пересоздаем просроченную сессию
              }
              
              // Если график 100%, но есть истекшая rest сессия - это означает, что график изменился
              // В этом случае нужно создать single сессию вместо rest
              if (schedule === '100%') {
                this.logger.info('Expired rest session found for 100% schedule - will create single session instead', {
                  dealId,
                  expiredSessionId: expiredSession.sessionId,
                  schedule,
                  note: 'Schedule changed from 50/50 to 100%, single session will be created in processExpiredSessions'
                });
                // Продолжаем обработку - в processExpiredSessions будет создана single сессия
              } else if (schedule !== '50/50' || !secondPaymentDate) {
                continue; // Пропускаем эту сессию (неизвестный график или нет даты)
              } else {
                // График 50/50 - проверяем стандартные условия
                // Проверяем, что первый платеж оплачен
                const firstPaid = await this.isFirstPaymentPaid(dealId);
                if (!firstPaid) {
                  continue; // Пропускаем эту сессию
                }

                // Проверяем, что дата второго платежа наступила
                // Вторую сессию нужно выставлять только в день согласно графику платежей
                if (!this.isDateReached(secondPaymentDate)) {
                  continue; // Пропускаем эту сессию
                }
              }
            } 
            // Для единого платежа (single) - проверяем, нет ли активной single сессии
            else if (isSingle) {
              // ВАЖНО: Проверяем активные single сессии напрямую в Stripe API
              let hasActiveSingleSession = false;
              
              try {
                // Получаем все открытые сессии за последние 7 дней и фильтруем по deal_id
                const sevenDaysAgo = Math.floor((Date.now() - 7 * 24 * 60 * 60 * 1000) / 1000);
                const allOpenSessions = await this.stripeProcessor.stripe.checkout.sessions.list({
                  limit: 100,
                  status: 'open',
                  created: { gte: sevenDaysAgo }
                });
                
                // Фильтруем по deal_id в metadata
                const stripeSessionsWithDealId = allOpenSessions.data.filter(s => 
                  s.metadata?.deal_id === String(dealId)
                );
                
                // Ищем активные single сессии
                for (const stripeSession of stripeSessionsWithDealId) {
                  const isTestSession = stripeSession.id.startsWith('cs_test_');
                  if (isTestSession) continue;
                  
                  const paymentType = stripeSession.metadata?.payment_type;
                  if (paymentType === 'single' && stripeSession.status === 'open') {
                    // Есть активная открытая single сессия
                    const activeCreated = stripeSession.created ? new Date(stripeSession.created * 1000) : new Date(0);
                    const expiredDate = expiredSession.expiresAt ? new Date(expiredSession.expiresAt * 1000) : new Date(0);
                    
                    if (expiredDate < activeCreated) {
                      // Истекшая сессия старше активной - пропускаем
                      this.logger.info('Skipping expired single session, active single session exists', {
                        dealId,
                        expiredSessionId: expiredSession.sessionId,
                        activeSessionId: stripeSession.id,
                        expiredDate: expiredDate.toISOString(),
                        activeCreated: activeCreated.toISOString()
                      });
                      hasActiveSingleSession = true;
                      break;
                    }
                  }
                }
                
                // Если не нашли через metadata, проверяем сессии из БД
                if (!hasActiveSingleSession) {
                  const activeSinglePayments = payments.filter(p => {
                    if (!p.session_id || p.payment_type !== 'single') return false;
                    return p.status === 'open' || (p.status === 'processed' && p.payment_status === 'unpaid');
                  });
                  
                  for (const activeSinglePayment of activeSinglePayments) {
                    try {
                      const sessionId = activeSinglePayment.session_id;
                      const isTestSession = sessionId.startsWith('cs_test_');
                      if (isTestSession) continue;
                      
                      const stripeSession = await this.stripeProcessor.stripe.checkout.sessions.retrieve(sessionId);
                      if (stripeSession.status === 'open') {
                        // Есть активная открытая single сессия
                        const activeCreated = stripeSession.created ? new Date(stripeSession.created * 1000) : new Date(0);
                        const expiredDate = expiredSession.expiresAt ? new Date(expiredSession.expiresAt * 1000) : new Date(0);
                        
                        if (expiredDate < activeCreated) {
                          // Истекшая сессия старше активной - пропускаем
                          this.logger.info('Skipping expired single session, active single session exists', {
                            dealId,
                            expiredSessionId: expiredSession.sessionId,
                            activeSessionId: activeSinglePayment.session_id,
                            expiredDate: expiredDate.toISOString(),
                            activeCreated: activeCreated.toISOString()
                          });
                          hasActiveSingleSession = true;
                          break;
                        }
                      }
                    } catch (error) {
                      this.logger.warn('Failed to check active single session status', {
                        dealId,
                        sessionId: activeSinglePayment.session_id,
                        error: error.message
                      });
                    }
                  }
                }
              } catch (error) {
                this.logger.warn('Failed to check active single sessions in Stripe', {
                  dealId,
                  error: error.message
                });
                // Продолжаем обработку в случае ошибки
              }
              
              if (hasActiveSingleSession) {
                continue; // Есть активная single сессия, не пересоздаем
              }
              // Если нет активной single сессии, можно пересоздавать
            } else {
              continue; // Неизвестный тип платежа
            }

            // Получаем данные персоны (один раз для всех сессий сделки)
            const dealWithRelated = await this.pipedriveClient.getDealWithRelatedData(dealId);
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
            
            const daysExpired = expiredSession.expiresAt 
              ? Math.floor((today - new Date(expiredSession.expiresAt * 1000)) / (1000 * 60 * 60 * 24))
              : 0;

            // Для deposit используем сумму из сессии или половину от deal value
            // Для rest используем половину от deal value
            // Для single используем полную сумму сделки
            const paymentAmount = expiredSession.amount || 
                                 (isSingle ? dealValue : 
                                  (isDeposit ? dealValue / 2 : dealValue / 2));
            
            const task = {
              deal,
              dealId: deal.id,
              dealTitle: deal.title,
              customerEmail,
              customerName,
              paymentType: expiredSession.paymentType,
              paymentAmount,
              currency,
              sessionId: expiredSession.sessionId,
              sessionUrl: null, // Просроченная сессия не имеет активного URL
              isExpired: true,
              daysExpired: daysExpired
            };

            // Для второго платежа добавляем информацию о дате и сумму
            if (isRest && secondPaymentDate) {
              const daysUntil = Math.ceil((secondPaymentDate - today) / (1000 * 60 * 60 * 24));
              task.secondPaymentDate = secondPaymentDate;
              task.secondPaymentAmount = paymentAmount; // Для rest используем paymentAmount как secondPaymentAmount
              task.daysUntilSecondPayment = daysUntil;
              task.isDateReached = this.isDateReached(secondPaymentDate);
            }

            tasks.push(task);
          }
        } catch (error) {
          this.logger.warn('Error processing deal for expired session task', {
            dealId,
            error: error.message
          });
          continue;
        }
      }

      return tasks;
    } catch (error) {
      this.logger.error('Failed to find expired session tasks', {
        error: error.message
      });
      return [];
    }
  }

  /**
   * Найти просроченные неоплаченные сессии в Stripe напрямую
   * Это нужно для случаев, когда сессии просрочены, но не были сохранены в базу
   * @returns {Promise<Array>} - Массив просроченных сессий с информацией о сделках
   */
  async findExpiredUnpaidSessionsFromStripe() {
    try {
      const expiredSessions = [];
      const now = Math.floor(Date.now() / 1000);
      const thirtyDaysAgo = now - (30 * 24 * 60 * 60); // Последние 30 дней (увеличено с 7 для поиска более старых истекших сессий)

      // Получаем просроченные сессии из Stripe
      let hasMore = true;
      let startingAfter = null;
      const limit = 100;

      while (hasMore && expiredSessions.length < 500) {
        const params = {
          limit,
          status: 'expired',
          created: { gte: thirtyDaysAgo }
        };

        if (startingAfter) {
          params.starting_after = startingAfter;
        }

        const sessions = await this.stripeProcessor.stripe.checkout.sessions.list(params);

        for (const session of sessions.data) {
          // Фильтруем только неоплаченные сессии с deal_id
          if (session.payment_status !== 'paid' && session.metadata?.deal_id) {
            // ИСКЛЮЧАЕМ тестовые сделки TEST_AUTO_ по email
            const customerEmail = session.customer_details?.email || session.customer_email || '';
            const isTestEmail = customerEmail.includes('test_deposit_') || 
                               customerEmail.includes('test_rest_') || 
                               customerEmail.includes('test_') && customerEmail.includes('@example.com');
            
            if (isTestEmail) {
              this.logger.debug('Skipping test session', {
                sessionId: session.id,
                dealId: session.metadata.deal_id,
                customerEmail
              });
              continue;
            }

            const paymentType = session.metadata?.payment_type || '';
            // Нас интересуют все типы платежей (deposit, rest, second, final, single)
            if (paymentType === 'deposit' || paymentType === 'rest' || paymentType === 'second' || paymentType === 'final' || paymentType === 'single') {
              expiredSessions.push({
                sessionId: session.id,
                dealId: session.metadata.deal_id,
                paymentType: paymentType,
                paymentSchedule: session.metadata?.payment_schedule || null,
                amount: session.amount_total ? session.amount_total / 100 : null,
                currency: session.currency?.toUpperCase() || 'PLN',
                expiresAt: session.expires_at,
                url: session.url,
                customerEmail: customerEmail
              });
            }
          }
        }

        hasMore = sessions.has_more;
        if (sessions.data.length > 0) {
          startingAfter = sessions.data[sessions.data.length - 1].id;
        } else {
          hasMore = false;
        }
      }

      this.logger.info('Found expired unpaid sessions from Stripe', {
        count: expiredSessions.length
      });

      return expiredSessions;
    } catch (error) {
      this.logger.error('Failed to find expired sessions from Stripe', {
        error: error.message
      });
      return [];
    }
  }

  /**
   * Обработать просроченные сессии: пересоздать и отправить уведомление
   * @param {Object} options - Опции обработки
   * @param {string} options.trigger - Триггер запуска
   * @param {string} options.runId - ID запуска
   * @returns {Promise<Object>} - Статистика обработки
   */
  async processExpiredSessions(options = {}) {
    const { trigger = 'manual', runId = null } = options;
    const summary = {
      totalFound: 0,
      recreated: 0,
      errors: [],
      skipped: []
    };

    try {
      this.logger.info('Starting expired sessions processing cycle', { trigger, runId });

      const expiredTasks = await this.findExpiredSessionTasks();
      summary.totalFound = expiredTasks.length;

      this.logger.info('Found expired session tasks', {
        count: expiredTasks.length,
        trigger,
        runId
      });

      // Группируем задачи по dealId, чтобы не создавать дубликаты для одной сделки
      // Если график стал 100%, обрабатываем только single, пропускаем deposit
      const processedDeals = new Map(); // Map<dealId, { processedTypes: Set, currentSchedule: string }>
      
      for (const task of expiredTasks) {
        try {
          // Для второго платежа (rest/second/final) используем первичный график из первого платежа
          // Для первого платежа (deposit) используем текущий график
          let currentSchedule = null;
          let secondPaymentDate = null;
          
          if (task.paymentType === 'rest' || task.paymentType === 'second' || task.paymentType === 'final') {
            // Для второго платежа используем первичный график
            const initialSchedule = await this.getInitialPaymentSchedule(task.dealId);
            if (initialSchedule.schedule === '50/50') {
              currentSchedule = '50/50';
              const closeDate = task.deal.expected_close_date || task.deal.close_date;
              if (closeDate) {
                secondPaymentDate = this.calculateSecondPaymentDate(closeDate);
              }
            } else {
              // Если первичного графика нет, используем текущий график (fallback)
              const currentScheduleObj = this.determinePaymentSchedule(task.deal);
              currentSchedule = currentScheduleObj.schedule;
              secondPaymentDate = currentScheduleObj.secondPaymentDate;
            }
          } else {
            // Для первого платежа (deposit) используем текущий график
            const currentScheduleObj = this.determinePaymentSchedule(task.deal);
            currentSchedule = currentScheduleObj.schedule;
            secondPaymentDate = currentScheduleObj.secondPaymentDate;
          }
          
          // Проверяем, не обработали ли мы уже эту сделку
          if (processedDeals.has(task.dealId)) {
            const dealInfo = processedDeals.get(task.dealId);
            
            // Если график 100%, обрабатываем только single, пропускаем deposit
            if (currentSchedule === '100%' && task.paymentType === 'deposit') {
              this.logger.info('Skipping deposit session for 100% schedule', {
                dealId: task.dealId,
                paymentType: task.paymentType,
                currentSchedule,
                note: 'Will process single session instead'
              });
              summary.skipped.push({
                dealId: task.dealId,
                paymentType: task.paymentType,
                reason: 'Schedule changed to 100%, single session will be processed'
              });
              continue;
            }
            
            // Если уже обработали этот тип платежа для этой сделки, пропускаем
            if (dealInfo.processedTypes.has(task.paymentType)) {
              this.logger.info('Skipping duplicate expired session task', {
                dealId: task.dealId,
                paymentType: task.paymentType,
                note: 'Already processed this payment type for this deal'
              });
              summary.skipped.push({
                dealId: task.dealId,
                paymentType: task.paymentType,
                reason: 'Duplicate payment type for this deal'
              });
              continue;
            }
            
            dealInfo.processedTypes.add(task.paymentType);
          } else {
            processedDeals.set(task.dealId, {
              processedTypes: new Set([task.paymentType]),
              currentSchedule
            });
          }
          
          // ВАЖНО: Проверяем, полностью ли оплачена сделка перед пересозданием сессии
          // Если сделка уже полностью оплачена, не пересоздаем сессию и не отправляем уведомление
          const dealPayments = await this.repository.listPayments({ dealId: String(task.dealId) });
          const paidPayments = dealPayments.filter(p => p.payment_status === 'paid' || p.status === 'processed');
          
          const dealCurrency = task.deal.currency || 'PLN';
          let totalPaidInDealCurrency = 0;
          for (const payment of paidPayments) {
            if (payment.currency === dealCurrency) {
              totalPaidInDealCurrency += parseFloat(payment.original_amount || payment.amount || 0);
            }
          }

          const dealValue = parseFloat(task.deal.value) || 0;
          const FINAL_THRESHOLD = 0.95;
          const paidRatio = dealValue > 0 ? totalPaidInDealCurrency / dealValue : 0;
          
          if (paidRatio >= FINAL_THRESHOLD) {
            this.logger.info('Skipping expired session recreation - deal is fully paid', {
              dealId: task.dealId,
              dealValue,
              totalPaid: totalPaidInDealCurrency,
              currency: dealCurrency,
              paidRatio: (paidRatio * 100).toFixed(2) + '%',
              paymentType: task.paymentType,
              note: 'Deal is fully paid, no need to recreate expired session'
            });
            summary.skipped.push({
              dealId: task.dealId,
              paymentType: task.paymentType,
              reason: 'deal_fully_paid',
              dealValue,
              totalPaid: totalPaidInDealCurrency
            });
            continue;
          }

          let result;
          
          // Определяем тип платежа и пересоздаем соответствующую сессию
          if (task.paymentType === 'deposit') {
            // Если график изменился на 100%, создаем single сессию вместо deposit
            if (currentSchedule === '100%') {
              this.logger.info('Payment schedule changed to 100%, creating single session instead of deposit', {
                dealId: task.dealId,
                oldSchedule: '50/50',
                newSchedule: '100%'
              });
              result = await this.stripeProcessor.createCheckoutSessionForDeal(task.deal, {
                trigger: 'cron_expired_session',
                runId: runId || `expired_single_${Date.now()}`,
                paymentType: 'single',
                paymentSchedule: '100%'
              });
            } else {
              // График все еще 50/50, пересоздаем deposit сессию
              result = await this.stripeProcessor.createCheckoutSessionForDeal(task.deal, {
                trigger: 'cron_expired_session',
                runId: runId || `expired_deposit_${Date.now()}`,
                paymentType: 'deposit',
                paymentSchedule: '50/50',
                paymentIndex: 1
              });
            }
          } else if (task.paymentType === 'rest' || task.paymentType === 'second' || task.paymentType === 'final') {
            // Если график изменился на 100%, создаем single сессию вместо rest
            if (currentSchedule === '100%') {
              this.logger.info('Payment schedule changed to 100%, creating single session instead of rest', {
                dealId: task.dealId,
                oldSchedule: '50/50',
                newSchedule: '100%',
                expiredSessionId: task.sessionId
              });
              result = await this.stripeProcessor.createCheckoutSessionForDeal(task.deal, {
                trigger: 'cron_expired_session',
                runId: runId || `expired_single_${Date.now()}`,
                paymentType: 'single',
                paymentSchedule: '100%'
              });
            } else {
              // График все еще 50/50, пересоздаем rest сессию
              result = await this.createSecondPaymentSession(task.deal, task.secondPaymentDate);
            }
          } else {
            summary.errors.push({
              dealId: task.dealId,
              error: `Unknown payment type: ${task.paymentType}`
            });
            continue;
          }
          
          if (result.success) {
            // Для пересозданных сессий используем sendPaymentNotificationForDeal
            // чтобы правильно показать скидку и общую сумму
            const sessions = [{
              id: result.sessionId,
              url: result.sessionUrl,
              amount: result.amount,
              type: task.paymentType === 'deposit' ? 'deposit' : 'rest'
            }];
            
            // Определяем актуальный график платежей на основе текущей даты
            const { schedule: paymentSchedule } = this.determinePaymentSchedule(task.deal);
            
            // Получаем правильную общую сумму из deal.value (уже включает скидку)
            // или из result.totalAmount (который должен быть sumPrice со скидкой)
            const dealValue = parseFloat(task.deal.value) || 0;
            const totalAmount = result.totalAmount || dealValue;
            
            // Отправляем уведомление через sendPaymentNotificationForDeal
            // который правильно рассчитывает скидку и показывает общую сумму
            const notificationResult = await this.stripeProcessor.sendPaymentNotificationForDeal(task.dealId, {
              paymentSchedule,
              sessions,
              currency: task.currency,
              totalAmount: totalAmount
            });
            
            if (notificationResult.success) {
              summary.recreated++;
              this.logger.info('Expired session recreated and notification sent', {
                dealId: task.dealId,
                paymentType: task.paymentType,
                oldSessionId: task.sessionId,
                newSessionId: result.sessionId
              });
            } else {
              summary.errors.push({
                dealId: task.dealId,
                error: `Failed to send notification: ${notificationResult.error}`
              });
            }
          } else {
            summary.errors.push({
              dealId: task.dealId,
              error: result.error || 'Failed to recreate session'
            });
          }
        } catch (error) {
          summary.errors.push({
            dealId: task.dealId,
            error: error.message
          });
        }
      }

      this.logger.info('Expired sessions processing cycle completed', {
        trigger,
        runId,
        summary
      });

      return summary;
    } catch (error) {
      this.logger.error('Error in expired sessions processing cycle', {
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

          // КРИТИЧЕСКИ ВАЖНО: Проверяем оплату второго платежа ПЕРЕД отправкой
          // Платеж мог быть оплачен после создания задачи
          // Проверяем ВСЕ платежи для этой сделки, а не только task.sessionId
          // ВАЖНО: Проверяем не только статус, но и СУММЫ (как в проформах)
          const payments = await this.repository.listPayments({ dealId: String(task.dealId) });
          
          // Получаем данные сделки для расчета ожидаемой суммы
          const dealResult = await this.pipedriveClient.getDeal(task.dealId);
          if (!dealResult.success || !dealResult.deal) {
            summary.skipped.push({
              dealId: task.dealId,
              reason: 'deal_not_found'
            });
            continue;
          }
          
          const deal = dealResult.deal;
          const dealValue = parseFloat(deal.value) || 0;
          const currency = deal.currency || 'PLN';
          const expectedSecondPayment = dealValue / 2; // Для графика 50/50
          
          // ВАЖНО: Сначала проверяем, полностью ли оплачена вся сделка
          // Если сделка уже полностью оплачена (через депозиты или другие платежи), не отправляем напоминание
          const paidPayments = payments.filter(p => p.payment_status === 'paid' || p.status === 'processed');
          let totalPaidInDealCurrency = 0;
          for (const payment of paidPayments) {
            if (payment.currency === currency) {
              totalPaidInDealCurrency += parseFloat(payment.original_amount || payment.amount || 0);
            }
          }

          const FINAL_THRESHOLD = 0.95;
          const paidRatio = dealValue > 0 ? totalPaidInDealCurrency / dealValue : 0;
          
          if (paidRatio >= FINAL_THRESHOLD) {
            this.logger.info('Skipping reminder - deal is fully paid', {
              dealId: task.dealId,
              dealValue,
              totalPaid: totalPaidInDealCurrency,
              currency,
              paidRatio: (paidRatio * 100).toFixed(2) + '%',
              note: 'Deal is fully paid, no need to send reminder about unpaid rest session'
            });
            summary.skipped.push({
              dealId: task.dealId,
              reason: 'deal_fully_paid',
              dealValue,
              totalPaid: totalPaidInDealCurrency
            });
            continue;
          }
          
          // Проверка 1: В базе данных - проверяем СУММУ оплаченных вторых платежей
          const paidSecondPayments = payments.filter(p => 
            (p.payment_type === 'rest' || p.payment_type === 'second' || p.payment_type === 'final') &&
            p.payment_status === 'paid'
          );
          
          // Суммируем все оплаченные вторые платежи
          const paidSecondPaymentTotal = paidSecondPayments.reduce((sum, p) => {
            const amount = parseFloat(p.original_amount || p.amount || 0);
            return sum + amount;
          }, 0);
          
          // Проверяем что оплачено >= 90% от ожидаемой суммы (как в проформах)
          const secondPaymentPaid = paidSecondPaymentTotal >= expectedSecondPayment * 0.9;
          
          if (secondPaymentPaid) {
            this.logger.info('Skipping reminder - second payment already paid (checked before sending)', {
              dealId: task.dealId,
              expectedSecondPayment: expectedSecondPayment,
              paidSecondPaymentTotal: paidSecondPaymentTotal,
              paidSecondPaymentsCount: paidSecondPayments.length,
              paidSecondPayments: paidSecondPayments.map(p => ({
                id: p.id,
                sessionId: p.session_id,
                amount: p.original_amount || p.amount,
                currency: p.currency
              })),
              currency: currency,
              taskSessionId: task.sessionId
            });
            summary.skipped.push({
              dealId: task.dealId,
              reason: 'second_payment_already_paid',
              expectedAmount: expectedSecondPayment,
              paidAmount: paidSecondPaymentTotal
            });
            continue;
          }
          
          // Проверка 2: Если не нашли достаточную сумму в базе, проверяем ВСЕ сессии через Stripe API
          // (на случай если webhook еще не обработался и статус не обновлен)
          // ВАЖНО: Проверяем не только task.sessionId, а ВСЕ сессии для сделки!
          const allSessionsForDeal = payments.filter(p => p.session_id).map(p => p.session_id);
          
          // Также добавляем sessionId из задачи, если его еще нет в списке
          if (task.sessionId && !allSessionsForDeal.includes(task.sessionId)) {
            allSessionsForDeal.push(task.sessionId);
          }
          
          // Проверяем каждую сессию в Stripe и суммируем оплаченные вторые платежи
          let stripePaidSecondPaymentTotal = 0;
          const stripePaidSessions = [];
          
          for (const sessionId of allSessionsForDeal) {
            try {
              const isTestSession = sessionId.startsWith('cs_test_');
              if (isTestSession) continue;
              
              const stripeSession = await this.stripeProcessor.stripe.checkout.sessions.retrieve(sessionId);
              
              // Проверяем что это второй платеж (rest/second/final) и он оплачен
              const paymentType = stripeSession.metadata?.payment_type;
              const isSecondPayment = paymentType === 'rest' || paymentType === 'second' || paymentType === 'final';
              
              if (isSecondPayment && stripeSession.payment_status === 'paid') {
                const sessionAmount = stripeSession.amount_total ? (stripeSession.amount_total / 100) : 0;
                stripePaidSecondPaymentTotal += sessionAmount;
                stripePaidSessions.push({
                  sessionId: sessionId,
                  amount: sessionAmount,
                  currency: stripeSession.currency?.toUpperCase() || currency
                });
              }
            } catch (error) {
              // Если не удалось проверить сессию, продолжаем
              this.logger.debug('Failed to check session in Stripe API', {
                dealId: task.dealId,
                sessionId: sessionId,
                error: error.message
              });
            }
          }
          
          // Проверяем общую сумму (база + Stripe)
          const totalPaidSecondPayment = paidSecondPaymentTotal + stripePaidSecondPaymentTotal;
          const isSecondPaymentFullyPaid = totalPaidSecondPayment >= expectedSecondPayment * 0.9;
          
          if (isSecondPaymentFullyPaid) {
            this.logger.warn('Payment is paid in Stripe but not fully reflected in database - webhook delay?', {
              dealId: task.dealId,
              expectedSecondPayment: expectedSecondPayment,
              paidInDatabase: paidSecondPaymentTotal,
              paidInStripe: stripePaidSecondPaymentTotal,
              totalPaid: totalPaidSecondPayment,
              stripePaidSessions: stripePaidSessions
            });
            
            this.logger.info('Skipping reminder - second payment already paid (checked via Stripe API)', {
              dealId: task.dealId,
              expectedSecondPayment: expectedSecondPayment,
              totalPaidSecondPayment: totalPaidSecondPayment,
              paidInDatabase: paidSecondPaymentTotal,
              paidInStripe: stripePaidSecondPaymentTotal,
              taskSessionId: task.sessionId
            });
            summary.skipped.push({
              dealId: task.dealId,
              reason: 'second_payment_already_paid_in_stripe',
              expectedAmount: expectedSecondPayment,
              paidAmount: totalPaidSecondPayment
            });
            continue;
          }
          
          // Если сумма недостаточна, логируем для отладки
          if (paidSecondPaymentTotal > 0 || stripePaidSecondPaymentTotal > 0) {
            this.logger.debug('Second payment partially paid, but not enough for reminder skip', {
              dealId: task.dealId,
              expectedSecondPayment: expectedSecondPayment,
              paidInDatabase: paidSecondPaymentTotal,
              paidInStripe: stripePaidSecondPaymentTotal,
              totalPaid: totalPaidSecondPayment,
              threshold: expectedSecondPayment * 0.9
            });
          }

          // КРИТИЧЕСКИ ВАЖНО: Проверяем историю напоминаний перед отправкой
          // Защита от дубликатов работает постоянно (не только на один день)
          const alreadySent = await this.wasReminderSentEver(task.dealId, task.secondPaymentDate);
          if (alreadySent) {
            this.logger.info('Skipping reminder - already sent for this deal and second payment date', {
              dealId: task.dealId,
              secondPaymentDate: this.normalizeDate(task.secondPaymentDate),
              taskSessionId: task.sessionId
            });
            summary.skipped.push({
              dealId: task.dealId,
              reason: 'reminder_already_sent'
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
            
            // Сохраняем запись о создании сессии в таблицу stripe_reminder_logs
            // Это позволяет отслеживать историю всех действий (создание сессии + напоминания)
            try {
              const dealWithRelated = await this.pipedriveClient.getDealWithRelatedData(deal.id);
              const person = dealWithRelated?.person;
              const SENDPULSE_ID_FIELD_KEY = 'ff1aa263ac9f0e54e2ae7bec6d7215d027bf1b8c';
              const sendpulseId = person?.[SENDPULSE_ID_FIELD_KEY] || null;
              
              await this.persistReminderLog({
                dealId: deal.id,
                secondPaymentDate: secondPaymentDate,
                sessionId: result.sessionId || null,
                sendpulseId: sendpulseId,
                trigger: 'cron_second_payment',
                runId: null, // run_id может быть null для создания сессии (UUID генерируется в scheduler)
                actionType: 'session_created'
              });
              
              this.logger.debug('Session creation logged to stripe_reminder_logs', {
                dealId: deal.id,
                sessionId: result.sessionId
              });
            } catch (logError) {
              // Не критично, если не удалось записать в лог
              this.logger.warn('Failed to log session creation to stripe_reminder_logs', {
                dealId: deal.id,
                error: logError.message
              });
            }
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
