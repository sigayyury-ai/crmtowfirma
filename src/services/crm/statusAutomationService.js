const supabase = require('../supabaseClient');
const logger = require('../../utils/logger');
const PipedriveClient = require('../pipedrive');
const StripeRepository = require('../stripe/repository');
const SendPulseClient = require('../sendpulse');
const {
  evaluatePaymentStatus,
  normalizeSchedule,
  STAGE_IDS,
  SCHEDULE_PROFILES
} = require('./statusCalculator');
const {
  toNumber,
  convertToPln,
  parseRawMetadata,
  detectScheduleFromPayments,
  estimateScheduleFromDeal
} = require('./statusAutomationUtils');

const SUPPORTED_STAGE_IDS = new Set([STAGE_IDS.FIRST_PAYMENT, STAGE_IDS.SECOND_PAYMENT, STAGE_IDS.CAMP_WAITER]);

class CrmStatusAutomationService {
  constructor(options = {}) {
    this.supabase = options.supabase || supabase;
    this.logger = options.logger || logger;
    this.pipedriveClient = options.pipedriveClient || new PipedriveClient();
    this.stripeRepository = options.stripeRepository || new StripeRepository();
    
    // Инициализируем SendPulse клиент (опционально)
    try {
      this.sendpulseClient = options.sendpulseClient || new SendPulseClient();
    } catch (error) {
      this.logger.warn('SendPulse not available for payment notifications', { error: error.message });
      this.sendpulseClient = null;
    }
    
    // Ключ поля SendPulse ID в Pipedrive
    this.SENDPULSE_ID_FIELD_KEY = 'ff1aa263ac9f0e54e2ae7bec6d7215d027bf1b8c';
  }

  isEnabled() {
    return !!this.supabase;
  }

  async loadProformas(dealId) {
    if (!this.isEnabled()) {
      throw new Error('Supabase client is not configured – cannot load proformas');
    }

    const { data, error } = await this.supabase
      .from('proformas')
      .select(`
        id,
        fullnumber,
        total,
        currency,
        currency_exchange,
        payments_total,
        payments_total_pln,
        payments_total_cash,
        payments_total_cash_pln,
        payments_count,
        issued_at,
        status
      `)
      .eq('pipedrive_deal_id', String(dealId))
      .eq('status', 'active');

    if (error) {
      this.logger.error('Failed to load proformas for CRM status automation', {
        dealId,
        error: error.message
      });
      throw error;
    }

    return data || [];
  }

  async loadStripePayments(dealId) {
    if (!this.stripeRepository.isEnabled()) {
      return [];
    }

    try {
      const payments = await this.stripeRepository.listPayments({
        dealId: String(dealId),
        limit: 500
      });
      return payments || [];
    } catch (error) {
      this.logger.error('Failed to load stripe payments for CRM status automation', {
        dealId,
        error: error.message
      });
      return [];
    }
  }

  sumProformaTotals(proformas = []) {
    return proformas.reduce(
      (acc, row) => {
        const expected = convertToPln(row.total, row.currency, row.currency_exchange);
        const bankPaid = toNumber(row.payments_total_pln);
        const cashPaid = toNumber(row.payments_total_cash_pln);
        const bankCount = toNumber(row.payments_count);

        acc.expectedAmountPln += expected || 0;
        acc.bankPaidPln += Number.isFinite(bankPaid) ? bankPaid : 0;
        acc.cashPaidPln += Number.isFinite(cashPaid) ? cashPaid : 0;
        acc.bankPaymentsCount += Number.isFinite(bankCount) ? bankCount : 0;

        return acc;
      },
      {
        expectedAmountPln: 0,
        bankPaidPln: 0,
        cashPaidPln: 0,
        bankPaymentsCount: 0
      }
    );
  }

  sumStripeTotals(payments = []) {
    const processed = payments.filter(
      (row) => row && row.status === 'processed' && (!row.payment_status || row.payment_status === 'paid')
    );

    return {
      stripePaidPln: processed.reduce((acc, row) => acc + (toNumber(row.amount_pln) || 0), 0),
      stripePaymentsCount: processed.length,
      processed
    };
  }

  resolveSchedule(deal, proformas, stripePayments) {
    const scheduleFromPayments = detectScheduleFromPayments(stripePayments);
    if (scheduleFromPayments) {
      return scheduleFromPayments;
    }
    const scheduleFromDeal = estimateScheduleFromDeal(deal, proformas);
    if (scheduleFromDeal) {
      return scheduleFromDeal;
    }
    return SCHEDULE_PROFILES['100%'].key;
  }

  async buildDealSnapshot(dealId, deal = null) {
    if (!dealId) {
      throw new Error('dealId is required for buildDealSnapshot');
    }

    const proformas = await this.loadProformas(dealId);
    if (proformas.length === 0) {
      return {
        dealId,
        proformas: [],
        stripePayments: [],
        totals: {
          expectedAmountPln: 0,
          bankPaidPln: 0,
          cashPaidPln: 0,
          stripePaidPln: 0,
          totalPaidPln: 0
        },
        paymentsCount: {
          bank: 0,
          stripe: 0,
          total: 0
        },
        scheduleType: SCHEDULE_PROFILES['100%'].key
      };
    }

    const stripePayments = await this.loadStripePayments(dealId);
    const proformaTotals = this.sumProformaTotals(proformas);
    const stripeTotals = this.sumStripeTotals(stripePayments);

    const totals = {
      expectedAmountPln: proformaTotals.expectedAmountPln,
      bankPaidPln: proformaTotals.bankPaidPln,
      cashPaidPln: proformaTotals.cashPaidPln,
      stripePaidPln: stripeTotals.stripePaidPln
    };
    totals.totalPaidPln = totals.bankPaidPln + totals.cashPaidPln + totals.stripePaidPln;

    const paymentsCount = {
      bank: proformaTotals.bankPaymentsCount,
      stripe: stripeTotals.stripePaymentsCount,
      total: proformaTotals.bankPaymentsCount + stripeTotals.stripePaymentsCount
    };

    const scheduleType = this.resolveSchedule(deal, proformas, stripePayments);

    return {
      dealId,
      proformas,
      stripePayments,
      totals,
      paymentsCount,
      scheduleType
    };
  }

  shouldUpdateStage(currentStageId, targetStageId, { force = false } = {}) {
    if (!SUPPORTED_STAGE_IDS.has(targetStageId)) {
      return { canUpdate: false, reason: 'Target stage is not supported for automation' };
    }

    if (force) {
      return { canUpdate: true };
    }

    if (!SUPPORTED_STAGE_IDS.has(currentStageId)) {
      return { canUpdate: false, reason: 'Deal is in a custom stage; automation skipped' };
    }

    if (currentStageId === targetStageId) {
      return { canUpdate: false, reason: 'Stage already matches target' };
    }

    const order = [STAGE_IDS.FIRST_PAYMENT, STAGE_IDS.SECOND_PAYMENT, STAGE_IDS.CAMP_WAITER];
    const currentIndex = order.indexOf(currentStageId);
    const targetIndex = order.indexOf(targetStageId);

    if (currentIndex === -1 || targetIndex === -1) {
      return { canUpdate: false, reason: 'Stage order undefined' };
    }

    if (targetIndex < currentIndex) {
      return { canUpdate: false, reason: 'Automation does not downgrade stages without force flag' };
    }

    return { canUpdate: true };
  }

  async syncDealStage(dealId, options = {}) {
    const normalizedDealId = String(dealId).trim();
    if (!normalizedDealId) {
      throw new Error('dealId is required to sync CRM status');
    }

    const dealResult = await this.pipedriveClient.getDeal(normalizedDealId);
    if (!dealResult.success || !dealResult.deal) {
      throw new Error(`Failed to load Pipedrive deal #${normalizedDealId}`);
    }

    const snapshot = await this.buildDealSnapshot(normalizedDealId, dealResult.deal);
    if (snapshot.proformas.length === 0 || snapshot.totals.expectedAmountPln <= 0) {
      return {
        updated: false,
        reason: 'Нет активных проформ или сумма проформ = 0',
        dealId: normalizedDealId,
        snapshot
      };
    }

    let evaluation;
    try {
      evaluation = evaluatePaymentStatus({
        expectedAmountPln: snapshot.totals.expectedAmountPln,
        paidAmountPln: snapshot.totals.totalPaidPln,
        scheduleType: snapshot.scheduleType,
        manualPaymentsCount: snapshot.paymentsCount.total
      });
    } catch (error) {
      this.logger.error('Failed to evaluate payment status', {
        dealId: normalizedDealId,
        error: error.message
      });
      throw error;
    }

    const currentStageId = dealResult.deal.stage_id;
    const updateDecision = this.shouldUpdateStage(currentStageId, evaluation.targetStageId, {
      force: options.force === true
    });

    if (!updateDecision.canUpdate) {
      this.logger.info('CRM status automation: stage unchanged', {
        dealId: normalizedDealId,
        currentStageId,
        targetStageId: evaluation.targetStageId,
        reason: updateDecision.reason,
        scheduleType: evaluation.scheduleType,
        paidPercent: Math.round(evaluation.paidRatio * 100)
      });
      return {
        updated: false,
        reason: updateDecision.reason,
        dealId: normalizedDealId,
        evaluation,
        snapshot,
        currentStageId
      };
    }

    try {
      await this.pipedriveClient.updateDealStage(normalizedDealId, evaluation.targetStageId);
      this.logger.info('CRM status automation: stage updated', {
        dealId: normalizedDealId,
        from: currentStageId,
        to: evaluation.targetStageId,
        scheduleType: evaluation.scheduleType,
        paidPercent: Math.round(evaluation.paidRatio * 100)
      });
      
      // Отправляем уведомление о получении платежа через SendPulse
      await this.sendPaymentReceivedNotification(normalizedDealId, snapshot, evaluation);
    } catch (error) {
      this.logger.error('Failed to update Pipedrive stage during CRM automation', {
        dealId: normalizedDealId,
        targetStageId: evaluation.targetStageId,
        error: error.message
      });
      throw error;
    }

    return {
      updated: true,
      dealId: normalizedDealId,
      previousStageId: currentStageId,
      nextStageId: evaluation.targetStageId,
      evaluation,
      snapshot
    };
  }

  /**
   * Отправить уведомление о получении платежа через SendPulse
   * @param {string} dealId - ID сделки
   * @param {Object} snapshot - Снимок данных сделки
   * @param {Object} evaluation - Результат оценки статуса платежа
   * @returns {Promise<Object>} - Результат отправки
   */
  async sendPaymentReceivedNotification(dealId, snapshot, evaluation) {
    if (!this.sendpulseClient) {
      return { success: false, error: 'SendPulse not available' };
    }

    try {
      // Получаем данные сделки и персоны
      const dealResult = await this.pipedriveClient.getDealWithRelatedData(dealId);
      if (!dealResult || !dealResult.person) {
        this.logger.warn('Failed to get deal/person data for payment notification', { dealId });
        return { success: false, error: 'Deal or person not found' };
      }

      const person = dealResult.person;
      const deal = dealResult.deal || {};
      const sendpulseId = person[this.SENDPULSE_ID_FIELD_KEY];

      if (!sendpulseId) {
        this.logger.debug('SendPulse ID not found for person, skipping payment notification', { dealId });
        return { success: false, error: 'SendPulse ID not found' };
      }

    // Формируем информацию о платеже
    const paidAmount = snapshot.totals.totalPaidPln || 0;
    const expectedAmount = snapshot.totals.expectedAmountPln || 0;
    const paidPercent = expectedAmount > 0 ? Math.round((paidAmount / expectedAmount) * 100) : 0;
    
    const message = '✅ Твой платеж получен, спасибо!';

      // Отправляем сообщение
      const result = await this.sendpulseClient.sendTelegramMessage(sendpulseId, message);

      if (result.success) {
        this.logger.info('Payment received notification sent via SendPulse', {
          dealId,
          sendpulseId,
          paidAmount,
          paidPercent
        });
      } else {
        this.logger.warn('Failed to send payment received notification', {
          dealId,
          sendpulseId,
          error: result.error
        });
      }

      return result;
    } catch (error) {
      this.logger.error('Error sending payment received notification', {
        dealId,
        error: error.message
      });
      return {
        success: false,
        error: error.message
      };
    }
  }
}

module.exports = CrmStatusAutomationService;
