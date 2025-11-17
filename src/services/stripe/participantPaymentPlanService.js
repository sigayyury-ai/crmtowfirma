const logger = require('../../utils/logger');
const StripeRepository = require('./repository');

class ParticipantPaymentPlanService {
  constructor(options = {}) {
    this.repository = options.repository || new StripeRepository();
    this.logger = options.logger || logger;
    this.summary = {
      updatedPlans: 0,
      refundsApplied: 0
    };
  }

  getSummary() {
    return this.summary;
  }

  async updatePlanFromSession(paymentRecord, session) {
    this.logger.debug('ParticipantPaymentPlan update placeholder', {
      paymentRecord,
      sessionId: session.id
    });
    this.summary.updatedPlans += 1;
  }

  async applyRefund(refund, convertedAmounts) {
    this.logger.debug('ParticipantPaymentPlan refund placeholder', {
      refundId: refund.id,
      amounts: convertedAmounts
    });
    this.summary.refundsApplied += 1;
  }
}

module.exports = ParticipantPaymentPlanService;

