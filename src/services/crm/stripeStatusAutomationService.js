const CrmStatusAutomationService = require('./statusAutomationService');
const StripeRepository = require('../stripe/repository');
const { convertToPln, toNumber } = require('./statusAutomationUtils');
const { SCHEDULE_PROFILES } = require('./statusCalculator');

class StripeStatusAutomationService extends CrmStatusAutomationService {
  constructor(options = {}) {
    super({
      ...options,
      // Ensure Stripe repository dependency is shared with parent
      stripeRepository: options.stripeRepository || new StripeRepository(),
      // Pass stripeProcessor to parent for currency conversion
      stripeProcessor: options.stripeProcessor
    });

    this.stripeRepository = options.stripeRepository || this.stripeRepository;
    this.stripeProcessor = options.stripeProcessor; // Store for potential future use
  }

  /**
   * Build snapshot with fallback when no active proformas exist.
   */
  async buildDealSnapshot(dealId, deal = null) {
    const baseSnapshot = await super.buildDealSnapshot(dealId, deal);

    // ВАЖНО: Логируем baseSnapshot для диагностики
    this.logger.info('StripeStatusAutomationService.buildDealSnapshot: baseSnapshot received', {
      dealId,
      baseSnapshotTotals: baseSnapshot.totals,
      baseSnapshotStripePaymentsLength: baseSnapshot.stripePayments?.length || 0,
      baseSnapshotPaymentsCount: baseSnapshot.paymentsCount
    });

    // If base snapshot already has active proformas, keep default behaviour
    if (baseSnapshot.proformas.length > 0 && baseSnapshot.totals.expectedAmountPln > 0) {
      this.logger.info('StripeStatusAutomationService.buildDealSnapshot: returning baseSnapshot (has proformas)', {
        dealId,
        totals: baseSnapshot.totals
      });
      return baseSnapshot;
    }

    if (!this.stripeRepository?.isEnabled()) {
      this.logger.info('StripeStatusAutomationService.buildDealSnapshot: returning baseSnapshot (repository disabled)', {
        dealId,
        totals: baseSnapshot.totals
      });
      return baseSnapshot;
    }

    const stripePayments = await this.loadStripePayments(dealId);
    if (!stripePayments.length) {
      // Nothing else we can do, keep original snapshot
      this.logger.info('StripeStatusAutomationService.buildDealSnapshot: returning baseSnapshot (no stripe payments)', {
        dealId,
        totals: baseSnapshot.totals
      });
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
    const expectedAmountPln = await this.estimateExpectedAmount(dealPayload, stripePayments, scheduleType);

    this.logger.info('StripeStatusAutomationService.buildDealSnapshot: calculated values', {
      dealId,
      expectedAmountPln,
      stripePaidPln: stripeTotals.stripePaidPln,
      stripePaymentsCount: stripeTotals.stripePaymentsCount,
      baseSnapshotStripePaidPln: baseSnapshot.totals?.stripePaidPln
    });

    if (!Number.isFinite(expectedAmountPln) || expectedAmountPln <= 0) {
      // still propagate stripe totals for visibility
      // ВАЖНО: Убеждаемся, что stripePaidPln явно установлен в totals
      const finalTotals = {
        ...baseSnapshot.totals,
        stripePaidPln: stripeTotals.stripePaidPln || baseSnapshot.totals?.stripePaidPln || 0,
        totalPaidPln: (stripeTotals.stripePaidPln || baseSnapshot.totals?.stripePaidPln || 0) + (baseSnapshot.totals?.bankPaidPln || 0) + (baseSnapshot.totals?.cashPaidPln || 0)
      };
      const finalPaymentsCount = {
        ...baseSnapshot.paymentsCount,
        stripe: stripeTotals.stripePaymentsCount || baseSnapshot.paymentsCount?.stripe || 0,
        total: (stripeTotals.stripePaymentsCount || baseSnapshot.paymentsCount?.stripe || 0) + (baseSnapshot.paymentsCount?.bank || 0)
      };
      
      this.logger.info('StripeStatusAutomationService.buildDealSnapshot: returning snapshot (expectedAmountPln <= 0)', {
        dealId,
        finalTotals,
        finalPaymentsCount
      });
      
      return {
        ...baseSnapshot,
        stripePayments,
        totals: finalTotals,
        paymentsCount: finalPaymentsCount,
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

  async estimateExpectedAmount(deal, stripePayments, scheduleType) {
    let expected = await this.estimateFromDealValue(deal);

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

      // ВАЖНО: Если expected все еще 0, используем stripePaidPln как минимальное значение
      // Но также пытаемся получить expectedAmount из суммы сделки через convertAmountWithRate
      if (expected <= 0 && deal && deal.value) {
        const dealValue = parseFloat(deal.value || 0);
        if (dealValue > 0) {
          // Если валюта не PLN и нет exchange_rate, используем stripeProcessor для конвертации
          if (deal.currency && deal.currency.toUpperCase() !== 'PLN' && !deal.exchange_rate) {
            if (this.stripeProcessor && this.stripeProcessor.convertAmountWithRate) {
              try {
                const { amountPln } = await this.stripeProcessor.convertAmountWithRate(dealValue, deal.currency);
                expected = amountPln;
              } catch (error) {
                this.logger.warn('Failed to get exchange rate in estimateExpectedAmount fallback', {
                  dealId: deal.id,
                  dealCurrency: deal.currency,
                  error: error.message
                });
              }
            }
          } else {
            // Если валюта PLN или есть exchange_rate, используем обычную конвертацию
            expected = await this.estimateFromDealValue(deal);
          }
        }
      }

      // ВАЖНО: Используем stripePaidPln как минимальное значение, если expected все еще 0
      expected = Math.max(expected || 0, stripeTotals.stripePaidPln);
    }

    return expected;
  }

  async estimateFromDealValue(deal) {
    if (!deal) return 0;
    
    // Если валюта PLN, просто возвращаем значение
    if (!deal.currency || deal.currency.toUpperCase() === 'PLN') {
      const value = toNumber(deal.value);
      return Number.isFinite(value) && value > 0 ? value : 0;
    }
    
    // Если есть exchange_rate, используем его
    if (deal.exchange_rate) {
      const value = convertToPln(deal.value, deal.currency, deal.exchange_rate);
      if (Number.isFinite(value) && value > 0) {
        return value;
      }
    }
    
    // Если нет exchange_rate, но есть stripeProcessor, используем его для получения курса
    if (this.stripeProcessor && this.stripeProcessor.convertAmountWithRate) {
      try {
        const dealValue = parseFloat(deal.value || 0);
        if (dealValue > 0) {
          const { amountPln } = await this.stripeProcessor.convertAmountWithRate(dealValue, deal.currency);
          return amountPln;
        }
      } catch (error) {
        this.logger.warn('Failed to get exchange rate for deal value conversion in estimateFromDealValue', {
          dealId: deal.id,
          dealCurrency: deal.currency,
          error: error.message
        });
      }
    }
    
    // Fallback: возвращаем 0, но это не критично - estimateExpectedAmount использует stripeTotals.stripePaidPln как fallback
    return 0;
  }

  resolveSchedule(deal, proformas, stripePayments) {
    return super.resolveSchedule(deal, proformas, stripePayments);
  }
}

module.exports = StripeStatusAutomationService;

