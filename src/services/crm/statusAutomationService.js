const supabase = require('../supabaseClient');
const logger = require('../../utils/logger');
const PipedriveClient = require('../pipedrive');
const StripeRepository = require('../stripe/repository');
const {
  evaluatePaymentStatus,
  normalizeSchedule,
  STAGE_IDS,
  SCHEDULE_PROFILES
} = require('./statusCalculator');

const SUPPORTED_STAGE_IDS = new Set([STAGE_IDS.FIRST_PAYMENT, STAGE_IDS.SECOND_PAYMENT, STAGE_IDS.CAMP_WAITER]);

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function convertToPln(amount, currency, exchangeRate) {
  const value = toNumber(amount);
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (!currency || currency.toUpperCase() === 'PLN') {
    return value;
  }
  const rate = toNumber(exchangeRate);
  if (Number.isFinite(rate) && rate > 0) {
    return value * rate;
  }
  return 0;
}

function parseRawMetadata(payment) {
  if (!payment) return null;
  const raw = payment.raw_payload;
  if (!raw) return null;
  if (typeof raw === 'object') {
    return raw.metadata || null;
  }
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return parsed.metadata || null;
      }
    } catch (error) {
      logger.warn('Failed to parse raw_payload for stripe payment metadata', {
        paymentId: payment.id,
        error: error.message
      });
    }
  }
  return null;
}

function detectScheduleFromPayments(stripePayments = []) {
  let metadataSchedule = null;
  let hasDeposit = false;
  let hasRest = false;

  for (const payment of stripePayments) {
    const paymentType = (payment.payment_type || '').toLowerCase();
    if (['deposit', 'first', 'initial'].includes(paymentType)) {
      hasDeposit = true;
    }
    if (['rest', 'second', 'final', 'balance'].includes(paymentType)) {
      hasRest = true;
    }
    if (payment.payment_schedule) {
      metadataSchedule = payment.payment_schedule;
      break;
    }
    const metadata = parseRawMetadata(payment);
    if (metadata?.payment_schedule || metadata?.paymentSchedule) {
      metadataSchedule = metadata.payment_schedule || metadata.paymentSchedule;
      break;
    }
  }

  if (metadataSchedule) {
    return normalizeSchedule(metadataSchedule);
  }

  if (hasDeposit && hasRest) {
    return SCHEDULE_PROFILES['50/50'].key;
  }

  if (stripePayments.filter((row) => row.status === 'processed').length >= 2) {
    return SCHEDULE_PROFILES['50/50'].key;
  }

  return null;
}

function estimateScheduleFromDeal(deal, proformas = []) {
  if (!deal) return null;
  const expectedCloseRaw = deal.expected_close_date || deal.expected_close;
  if (!expectedCloseRaw) {
    return null;
  }

  try {
    const expectedCloseDate = new Date(expectedCloseRaw);
    if (Number.isNaN(expectedCloseDate.getTime())) {
      return null;
    }

    let referenceDate = new Date();
    const issuedAt = proformas
      .map((row) => row.issued_at)
      .filter(Boolean)
      .map((value) => new Date(value))
      .filter((date) => !Number.isNaN(date.getTime()))
      .sort((a, b) => a - b)[0];

    if (issuedAt) {
      referenceDate = issuedAt;
    }

    const diffMs = expectedCloseDate.getTime() - referenceDate.getTime();
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays >= 30) {
      return SCHEDULE_PROFILES['50/50'].key;
    }
    return SCHEDULE_PROFILES['100%'].key;
  } catch (error) {
    logger.warn('Failed to estimate schedule from deal dates', {
      dealId: deal.id,
      error: error.message
    });
    return null;
  }
}

class CrmStatusAutomationService {
  constructor(options = {}) {
    this.supabase = options.supabase || supabase;
    this.logger = options.logger || logger;
    this.pipedriveClient = options.pipedriveClient || new PipedriveClient();
    this.stripeRepository = options.stripeRepository || new StripeRepository();
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
}

module.exports = CrmStatusAutomationService;
