const CrmStatusAutomationService = require('./statusAutomationService');
const StripeRepository = require('../stripe/repository');
const { convertToPln, toNumber } = require('./statusAutomationUtils');
const { SCHEDULE_PROFILES } = require('./statusCalculator');

class StripeStatusAutomationService extends CrmStatusAutomationService {
  constructor(options = {}) {
    super({
      ...options,
      // Ensure Stripe repository dependency is shared with parent
      stripeRepository: options.stripeRepository || new StripeRepository()
    });

    this.stripeRepository = options.stripeRepository || this.stripeRepository;
  }

  /**
   * Build snapshot with fallback when no active proformas exist.
   */
  async buildDealSnapshot(dealId, deal = null) {
    const baseSnapshot = await super.buildDealSnapshot(dealId, deal);

    // If base snapshot already has active proformas, keep default behaviour
    if (baseSnapshot.proformas.length > 0 && baseSnapshot.totals.expectedAmountPln > 0) {
      return baseSnapshot;
    }

    if (!this.stripeRepository?.isEnabled()) {
      return baseSnapshot;
    }

    const stripePayments = await this.loadStripePayments(dealId);
    if (!stripePayments.length) {
      // Nothing else we can do, keep original snapshot
      return { ...baseSnapshot, stripePayments };
    }

    let dealPayload = deal;
    if (!dealPayload) {
      try {
        const dealResult = await this.pipedriveClient.getDeal(dealId);
        if (dealResult?.deal) {
          dealPayload = dealResult.deal;
        }
      } catch (error) {
        this.logger.warn('StripeStatusAutomationService: failed to load deal for fallback snapshot', {
          dealId,
          error: error.message
        });
      }
    }

    const scheduleType = super.resolveSchedule(dealPayload, [], stripePayments);
    const stripeTotals = this.sumStripeTotals(stripePayments);
    const expectedAmountPln = this.estimateExpectedAmount(dealPayload, stripePayments, scheduleType);

    if (!Number.isFinite(expectedAmountPln) || expectedAmountPln <= 0) {
      // still propagate stripe totals for visibility
      return {
        ...baseSnapshot,
        stripePayments,
        totals: {
          ...baseSnapshot.totals,
          stripePaidPln: stripeTotals.stripePaidPln,
          totalPaidPln: stripeTotals.stripePaidPln
        },
        paymentsCount: {
          ...baseSnapshot.paymentsCount,
          stripe: stripeTotals.stripePaymentsCount,
          total: stripeTotals.stripePaymentsCount
        },
        scheduleType
      };
    }

    const syntheticProforma = this.buildSyntheticProforma(dealPayload, dealId, expectedAmountPln);

    return {
      dealId,
      proformas: [syntheticProforma],
      stripePayments,
      totals: {
        expectedAmountPln,
        bankPaidPln: 0,
        cashPaidPln: 0,
        stripePaidPln: stripeTotals.stripePaidPln,
        totalPaidPln: stripeTotals.stripePaidPln
      },
      paymentsCount: {
        bank: 0,
        stripe: stripeTotals.stripePaymentsCount,
        total: stripeTotals.stripePaymentsCount
      },
      scheduleType
    };
  }

  buildSyntheticProforma(deal, dealId, amountPln) {
    const title = deal?.title || `Deal #${dealId}`;
    return {
      id: `virtual-${dealId}`,
      fullnumber: `STRIPE-${dealId}`,
      total: amountPln,
      currency: 'PLN',
      currency_exchange: 1,
      payments_total: amountPln,
      payments_total_pln: amountPln,
      payments_total_cash: 0,
      payments_total_cash_pln: 0,
      payments_count: 0,
      issued_at: deal?.add_time || new Date().toISOString(),
      status: 'virtual',
      title
    };
  }

  estimateExpectedAmount(deal, stripePayments, scheduleType) {
    let expected = this.estimateFromDealValue(deal);

    if ((!Number.isFinite(expected) || expected <= 0) && stripePayments.length) {
      const stripeTotals = this.sumStripeTotals(stripePayments);
      const profile = SCHEDULE_PROFILES[scheduleType] || SCHEDULE_PROFILES['100%'];
      const depositPayment = stripePayments.find((payment) => {
        const type = (payment.payment_type || '').toLowerCase();
        return ['deposit', 'first', 'initial'].includes(type);
      });

      if (depositPayment && profile.depositRatio > 0 && profile.depositRatio < 1) {
        expected = Math.max(expected || 0, (toNumber(depositPayment.amount_pln) || 0) / profile.depositRatio);
      }

      expected = Math.max(expected || 0, stripeTotals.stripePaidPln);
    }

    return expected;
  }

  estimateFromDealValue(deal) {
    if (!deal) return 0;
    const value = convertToPln(deal.value, deal.currency, deal.exchange_rate);
    if (Number.isFinite(value) && value > 0) {
      return value;
    }
    return 0;
  }

  resolveSchedule(deal, proformas, stripePayments) {
    return super.resolveSchedule(deal, proformas, stripePayments);
  }
}

module.exports = StripeStatusAutomationService;

