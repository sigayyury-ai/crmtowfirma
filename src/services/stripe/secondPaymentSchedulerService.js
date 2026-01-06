const StripeProcessorService = require('./processor');
const StripeRepository = require('./repository');
const PipedriveClient = require('../pipedrive');
const logger = require('../../utils/logger');
// Phase 0: Code Review Fixes - New unified services
const PaymentScheduleService = require('./paymentScheduleService');

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
      
      const restPayment = payments.find(p => 
        (p.payment_type === 'rest' || p.payment_type === 'second' || p.payment_type === 'final')
      );

      if (restPayment) {
        return true;
      }

      // Если в базе нет, проверяем в Stripe напрямую
      // Ищем активные или недавно просроченные сессии (за последние 7 дней)
      const now = Math.floor(Date.now() / 1000);
      const sevenDaysAgo = now - (7 * 24 * 60 * 60);

      let hasMore = true;
      let startingAfter = null;
      const limit = 100;

      while (hasMore) {
        const params = {
          limit,
          created: { gte: sevenDaysAgo }
        };

        if (startingAfter) {
          params.starting_after = startingAfter;
        }

        const sessions = await this.stripeProcessor.stripe.checkout.sessions.list(params);

        for (const session of sessions.data) {
          if (session.metadata?.deal_id === String(dealId)) {
            const paymentType = session.metadata?.payment_type || '';
            // Проверяем, что это второй платеж (rest/second/final)
            if (paymentType === 'rest' || paymentType === 'second' || paymentType === 'final') {
              // Если сессия активна (open) или оплачена - считаем, что сессия существует
              // Просроченные неоплаченные сессии не считаем, чтобы можно было создать новую
              if (session.status === 'open' || session.payment_status === 'paid') {
                this.logger.info('Found active or paid second payment session in Stripe', {
                  dealId,
                  sessionId: session.id,
                  status: session.status,
                  paymentStatus: session.payment_status
                });
                return true;
              }
            }
          }
        }

        hasMore = sessions.has_more;
        if (sessions.data.length > 0) {
          startingAfter = sessions.data[sessions.data.length - 1].id;
        } else {
          hasMore = false;
        }

        // Ограничиваем поиск 500 сессиями
        if (sessions.data.length < limit) {
          hasMore = false;
        }
      }

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

      for (const dealId of dealIds) {
        try {
          // Получаем данные сделки
          const dealResult = await this.pipedriveClient.getDeal(dealId);
          if (!dealResult.success || !dealResult.deal) {
            continue;
          }

          const deal = dealResult.deal;

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
          
          this.logger.info('Using initial payment schedule from first payment', {
            dealId: deal.id,
            initialSchedule: initialSchedule.schedule,
            firstPaymentDate: initialSchedule.firstPaymentDate,
            secondPaymentDate: secondPaymentDate ? secondPaymentDate.toISOString().split('T')[0] : null
          });
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

        // Проверяем, что дата второго платежа наступила
        if (!this.isDateReached(secondPaymentDate)) {
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
        } catch (error) {
          this.logger.error('Error processing deal in findDealsNeedingSecondPayment', {
            dealId,
            error: error.message
          });
          continue;
        }
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
              const stripeMode = getStripeMode();
              const sessionId = restPayment.session_id;
              const isTestSession = sessionId.startsWith('cs_test_');
              const isLiveSession = sessionId.startsWith('cs_live_');
              
              // Если режим не совпадает с сессией - пропускаем
              if ((stripeMode === 'live' && isTestSession) || (stripeMode === 'test' && isLiveSession)) {
                this.logger.debug('Skipping session URL retrieval - session from different Stripe mode', {
                  dealId: deal.id,
                  sessionId,
                  stripeMode,
                  sessionType: isTestSession ? 'test' : 'live'
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
      }

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

          // ВАЖНО: Проверяем, есть ли уже активная сессия для этой сделки
          // Если есть активная сессия, не показываем просроченные (они уже обработаны)
          const payments = await this.repository.listPayments({ dealId: String(dealId), limit: 100 });
          
          // Проверяем активные сессии в базе
          const activePayments = payments.filter(p => {
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

          if (activePayments.length > 0) {
            // Проверяем статус сессий в Stripe напрямую, чтобы убедиться, что они действительно активны
            let hasRealActiveSession = false;
            const dealExpiredSessions = expiredSessions.filter(s => String(s.dealId) === String(dealId));
            
            for (const activePayment of activePayments) {
              try {
                // Проверяем режим Stripe перед запросом
                const { getStripeMode } = require('../stripe/client');
                const stripeMode = getStripeMode();
                const sessionId = activePayment.session_id;
                const isTestSession = sessionId.startsWith('cs_test_');
                const isLiveSession = sessionId.startsWith('cs_live_');
                
                // Если режим не совпадает с сессией - пропускаем
                if ((stripeMode === 'live' && isTestSession) || (stripeMode === 'test' && isLiveSession)) {
                  this.logger.debug('Skipping session status check - session from different Stripe mode', {
                    dealId,
                    sessionId,
                    stripeMode,
                    sessionType: isTestSession ? 'test' : 'live'
                  });
                  continue;
                }
                
                const stripeSession = await this.stripeProcessor.stripe.checkout.sessions.retrieve(activePayment.session_id);
                // Если сессия активна (open) или оплачена (complete) - это реальная активная сессия
                if (stripeSession.status === 'open' || stripeSession.payment_status === 'paid') {
                  hasRealActiveSession = true;
                  
                  // Проверяем, что просроченные сессии старше активной
                  const activeCreated = stripeSession.created ? new Date(stripeSession.created * 1000) : new Date(0);
                  const allExpiredOlder = dealExpiredSessions.every(s => {
                    if (!s.expiresAt) return false;
                    const expiredDate = new Date(s.expiresAt * 1000);
                    return expiredDate < activeCreated;
                  });
                  
                  if (allExpiredOlder && dealExpiredSessions.length > 0) {
                    // Все просроченные сессии старше активной - пропускаем их
                    this.logger.info('Skipping expired sessions, active session exists in Stripe', {
                      dealId,
                      activeSessionId: activePayment.session_id,
                      activeSessionStatus: stripeSession.status,
                      activeSessionCreated: activeCreated.toISOString(),
                      expiredSessionsCount: dealExpiredSessions.length
                    });
                    // Устанавливаем флаг, чтобы пропустить всю сделку
                    hasRealActiveSession = true;
                    break;
                  }
                  // Если не все просроченные сессии старше, продолжаем проверку других активных сессий
                  hasRealActiveSession = false;
                  break;
                }
              } catch (error) {
                // Если не удалось получить сессию из Stripe, продолжаем проверку
                this.logger.warn('Failed to check session status in Stripe', {
                  dealId,
                  sessionId: activePayment.session_id,
                  error: error.message
                });
              }
            }
            
            if (hasRealActiveSession) {
              continue;
            }
          }

          // Находим все просроченные сессии для этой сделки
          const dealExpiredSessions = expiredSessions.filter(s => String(s.dealId) === String(dealId));
          if (dealExpiredSessions.length === 0) {
            continue;
          }

          // Определяем график платежей
          const { schedule, secondPaymentDate } = this.determinePaymentSchedule(deal);
          
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

            // Для первого платежа (deposit) - пересоздаем всегда, если просрочена
            if (isDeposit) {
              // Можно пересоздавать сразу
            } 
            // Для второго платежа (rest/second/final) - только если график 50/50, дата наступила и первый оплачен
            else if (isRest) {
              if (schedule !== '50/50' || !secondPaymentDate) {
                continue; // Пропускаем эту сессию
              }

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
            const paymentAmount = expiredSession.amount || (isDeposit ? dealValue / 2 : dealValue / 2);
            
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
      const sevenDaysAgo = now - (7 * 24 * 60 * 60); // Последние 7 дней

      // Получаем просроченные сессии из Stripe
      let hasMore = true;
      let startingAfter = null;
      const limit = 100;

      while (hasMore && expiredSessions.length < 500) {
        const params = {
          limit,
          status: 'expired',
          created: { gte: sevenDaysAgo }
        };

        if (startingAfter) {
          params.starting_after = startingAfter;
        }

        const sessions = await this.stripeProcessor.stripe.checkout.sessions.list(params);

        for (const session of sessions.data) {
          // Фильтруем только неоплаченные сессии с deal_id
          if (session.payment_status !== 'paid' && session.metadata?.deal_id) {
            const paymentType = session.metadata?.payment_type || '';
            // Нас интересуют все типы платежей (deposit, rest, second, final)
            if (paymentType === 'deposit' || paymentType === 'rest' || paymentType === 'second' || paymentType === 'final') {
              expiredSessions.push({
                sessionId: session.id,
                dealId: session.metadata.deal_id,
                paymentType: paymentType,
                paymentSchedule: session.metadata?.payment_schedule || null,
                amount: session.amount_total ? session.amount_total / 100 : null,
                currency: session.currency?.toUpperCase() || 'PLN',
                expiresAt: session.expires_at,
                url: session.url
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
            // Пересоздаем сессию для второго платежа
            result = await this.createSecondPaymentSession(task.deal, task.secondPaymentDate);
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
