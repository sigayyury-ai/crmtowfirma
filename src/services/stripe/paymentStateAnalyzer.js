const logger = require('../../utils/logger');
const StripeRepository = require('./repository');
const { getStripeClient } = require('./client');

/**
 * PaymentStateAnalyzer
 * 
 * Унифицированный сервис для анализа состояния платежей для сделки.
 * Заменяет сложную логику проверки существующих платежей в processor.js и pipedriveWebhook.js
 * 
 * @see docs/stripe-payment-logic-code-review.md - раздел "Сложная логика проверки существующих платежей"
 */
class PaymentStateAnalyzer {
  constructor(options = {}) {
    this.repository = options.repository || new StripeRepository();
    this.stripe = options.stripe || getStripeClient();
    this.logger = options.logger || logger;
  }

  /**
   * Проанализировать состояние платежей для сделки
   * 
   * @param {string} dealId - ID сделки
   * @param {Object} schedule - Результат PaymentScheduleService.determineSchedule()
   * @param {Object} options - Дополнительные опции
   * @param {boolean} options.checkStripeSessions - Проверять сессии в Stripe API (default: false, медленно)
   * @returns {Promise<Object>} - Анализ состояния платежей
   */
  async analyzePaymentState(dealId, schedule, options = {}) {
    const { checkStripeSessions = false } = options;

    // 1. Получить платежи из БД
    const payments = await this.repository.listPayments({
      dealId: String(dealId),
      limit: 100
    });

    // 2. Получить сессии из Stripe (опционально, медленно)
    let stripeSessions = [];
    if (checkStripeSessions) {
      try {
        // ВАЖНО: Stripe API не поддерживает фильтрацию по metadata напрямую
        // Получаем все открытые и истекшие сессии за последние 30 дней и фильтруем вручную
        const thirtyDaysAgo = Math.floor((Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000);
        
        // Получаем открытые сессии
        const openSessions = await this.stripe.checkout.sessions.list({
          limit: 100,
          status: 'open',
          created: { gte: thirtyDaysAgo }
        });
        
        // Получаем истекшие сессии
        const expiredSessions = await this.stripe.checkout.sessions.list({
          limit: 100,
          status: 'expired',
          created: { gte: thirtyDaysAgo }
        });
        
        // Объединяем и фильтруем по deal_id
        const allSessions = [...(openSessions.data || []), ...(expiredSessions.data || [])];
        stripeSessions = allSessions.filter(s => 
          s.metadata?.deal_id === String(dealId)
        );
      } catch (error) {
        this.logger.warn('Failed to fetch Stripe sessions for analysis', {
          dealId,
          error: error.message
        });
      }
    }

    // 3. Анализ каждого типа платежа
    const deposit = this._analyzePaymentType(payments, stripeSessions, 'deposit');
    const rest = this._analyzePaymentType(payments, stripeSessions, 'rest');
    const single = this._analyzePaymentType(payments, stripeSessions, 'single');

    // 4. Определить, какие платежи нужно создать
    const needsDeposit = this._needsDeposit(schedule, deposit, rest, single);
    const needsRest = this._needsRest(schedule, deposit, rest, single);
    const needsSingle = this._needsSingle(schedule, deposit, rest, single);

    const analysis = {
      deposit,
      rest,
      single,
      needsDeposit,
      needsRest,
      needsSingle,
      schedule: schedule.schedule,
      secondPaymentDate: schedule.secondPaymentDate,
      summary: {
        totalPayments: payments.length,
        paidPayments: payments.filter(p => p.payment_status === 'paid').length,
        unpaidPayments: payments.filter(p => p.payment_status === 'unpaid').length,
        activeSessions: payments.filter(p => p.payment_status === 'unpaid').length
      }
    };

    this.logger.debug('Payment state analysis completed', {
      dealId,
      analysis: {
        schedule: analysis.schedule,
        needsDeposit: analysis.needsDeposit,
        needsRest: analysis.needsRest,
        needsSingle: analysis.needsSingle,
        depositPaid: deposit.paid,
        restPaid: rest.paid,
        singlePaid: single.paid
      }
    });

    return analysis;
  }

  /**
   * Проанализировать конкретный тип платежа
   * 
   * @private
   */
  _analyzePaymentType(payments, stripeSessions, type) {
    // Найти платеж в БД
    const payment = payments.find(p => this._isPaymentType(p, type));

    // Найти сессию в Stripe
    const session = stripeSessions.find(s => 
      s.metadata?.payment_type === type || 
      s.metadata?.paymentType === type
    );

    // Определить статусы
    const exists = !!payment || !!session;
    const paid = payment?.payment_status === 'paid' || 
                 session?.payment_status === 'paid' ||
                 session?.payment_status === 'complete';
    const active = this._isActive(payment, session);
    const expired = session?.status === 'expired' || 
                   session?.expires_at && new Date(session.expires_at * 1000) < new Date();
    const canceled = session?.status === 'canceled';

    return {
      exists,
      paid,
      active,
      expired,
      canceled,
      payment, // Ссылка на объект платежа из БД
      session   // Ссылка на объект сессии из Stripe
    };
  }

  /**
   * Проверить, является ли платеж указанным типом
   * 
   * @private
   */
  _isPaymentType(payment, type) {
    if (!payment) return false;

    const paymentType = payment.payment_type?.toLowerCase();

    switch (type) {
      case 'deposit':
        return paymentType === 'deposit' || paymentType === 'first';
      case 'rest':
        return paymentType === 'rest' || 
               paymentType === 'second' || 
               paymentType === 'final';
      case 'single':
        return paymentType === 'single' || 
               paymentType === 'payment' || 
               !paymentType; // Пустой тип считается single
      default:
        return false;
    }
  }

  /**
   * Проверить, активна ли сессия
   * 
   * @private
   */
  _isActive(payment, session) {
    if (payment && payment.payment_status === 'unpaid') {
      return true;
    }

    if (session) {
      return session.status === 'open' || 
             session.status === 'complete' ||
             (session.payment_status !== 'paid' && session.status !== 'expired' && session.status !== 'canceled');
    }

    return false;
  }

  /**
   * Определить, нужен ли deposit платеж
   * 
   * @private
   */
  _needsDeposit(schedule, deposit, rest, single) {
    // Если график 100%, deposit не нужен
    if (schedule.schedule === '100%') {
      return false;
    }

    // Если график 50/50 и deposit не существует или не оплачен
    if (schedule.schedule === '50/50') {
      return !deposit.exists || (!deposit.paid && deposit.expired);
    }

    return false;
  }

  /**
   * Определить, нужен ли rest платеж
   * 
   * @private
   */
  _needsRest(schedule, deposit, rest, single) {
    // Если график 100%, rest не нужен (нужен single)
    if (schedule.schedule === '100%') {
      return false;
    }

    // Если график 50/50
    if (schedule.schedule === '50/50') {
      // Rest нужен, если:
      // 1. Deposit оплачен
      // 2. Rest не существует или истек
      // 3. Дата второго платежа наступила
      const depositPaid = deposit.paid;
      const restMissing = !rest.exists || rest.expired;
      const dateReached = schedule.secondPaymentDate && 
                         new Date(schedule.secondPaymentDate) <= new Date();

      return depositPaid && restMissing && dateReached;
    }

    return false;
  }

  /**
   * Определить, нужен ли single платеж
   * 
   * @private
   */
  _needsSingle(schedule, deposit, rest, single) {
    // Если график 50/50, single не нужен
    if (schedule.schedule === '50/50') {
      return false;
    }

    // Если график 100%
    if (schedule.schedule === '100%') {
      // Single нужен, если:
      // 1. Single не существует или истек
      // 2. ИЛИ есть deposit, но нет rest (график изменился)
      // ВАЖНО: single.expired может быть false, если checkStripeSessions = false
      // Поэтому проверяем также, что single не оплачен
      const singleMissing = !single.exists || single.expired;
      const singleNotPaid = !single.paid;
      const hasDepositButNoRest = deposit.exists && !rest.exists;

      // Single нужен, если его нет/истек И он не оплачен
      return (singleMissing && singleNotPaid) || hasDepositButNoRest;
    }

    return false;
  }

  /**
   * Получить все deposit платежи для сделки
   * 
   * @param {string} dealId - ID сделки
   * @returns {Promise<Array>} - Массив deposit платежей
   */
  async getDepositPayments(dealId) {
    const payments = await this.repository.listPayments({
      dealId: String(dealId),
      limit: 100
    });

    return payments.filter(p => 
      (p.payment_type === 'deposit' || p.payment_type === 'first') &&
      p.payment_status === 'paid'
    );
  }

  /**
   * Получить все rest платежи для сделки
   * 
   * @param {string} dealId - ID сделки
   * @returns {Promise<Array>} - Массив rest платежей
   */
  async getRestPayments(dealId) {
    const payments = await this.repository.listPayments({
      dealId: String(dealId),
      limit: 100
    });

    return payments.filter(p => 
      (p.payment_type === 'rest' || p.payment_type === 'second' || p.payment_type === 'final') &&
      p.payment_status === 'paid'
    );
  }

  /**
   * Проверить, полностью ли оплачена сделка
   * 
   * @param {string} dealId - ID сделки
   * @param {Object} schedule - Результат PaymentScheduleService.determineSchedule()
   * @returns {Promise<boolean>} - true если сделка полностью оплачена
   */
  async isDealFullyPaid(dealId, schedule) {
    const analysis = await this.analyzePaymentState(dealId, schedule);

    if (schedule.schedule === '50/50') {
      return analysis.deposit.paid && analysis.rest.paid;
    } else {
      return analysis.single.paid;
    }
  }
}

module.exports = PaymentStateAnalyzer;

