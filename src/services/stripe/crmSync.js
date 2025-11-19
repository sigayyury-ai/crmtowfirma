const PipedriveClient = require('../pipedrive');
const logger = require('../../utils/logger');

const STAGES = {
  FIRST_PAYMENT_ID: 18,
  SECOND_PAYMENT_ID: 32,
  CAMP_WAITER_ID: 27
};

function normalisePaymentType(value) {
  if (!value) return null;
  const normalised = String(value).trim().toLowerCase();
  if (!normalised) return null;
  switch (normalised) {
    case 'deposit':
    case 'first':
    case 'initial':
      return 'first';
    case 'rest':
    case 'second':
    case 'final':
    case 'balance':
      return 'final';
    default:
      return normalised;
  }
}

/**
 * @param {object} options
 * @param {PipedriveClient} options.pipedriveClient
 * @param {object} options.logger
 */
class StripeCrmSyncService {
  constructor(options = {}) {
    this.pipedriveClient = options.pipedriveClient || new PipedriveClient();
    this.logger = options.logger || logger;
  }

  async updateDealStage(dealId, stageId, context = {}) {
    if (!dealId || !stageId) return;

    try {
      // Проверяем статус сделки перед обновлением стадии
      // Если сделка удалена, не пытаемся обновлять стадию
      const dealResult = await this.pipedriveClient.getDeal(dealId);
      if (!dealResult.success || !dealResult.deal) {
        this.logger.warn('Deal not found, skipping stage update', {
          dealId,
          stageId,
          error: dealResult.error
        });
        return;
      }

      const deal = dealResult.deal;
      // Проверяем, не удалена ли сделка (в Pipedrive удаленные сделки имеют статус 'deleted' или отсутствуют)
      if (deal.status === 'deleted' || deal.deleted) {
        this.logger.warn('Deal is deleted, skipping stage update', {
          dealId,
          stageId
        });
        return;
      }

      await this.pipedriveClient.updateDealStage(dealId, stageId);
      this.logger.info('Updated deal stage via Stripe processor', {
        dealId,
        stageId,
        context
      });
    } catch (error) {
      // Если ошибка связана с удаленной сделкой, логируем как предупреждение, а не ошибку
      if (error.message?.includes('deleted') || error.message?.includes('Entity is deleted')) {
        this.logger.warn('Deal is deleted, skipping stage update', {
          dealId,
          stageId,
          error: error.message
        });
        return;
      }
      
      this.logger.error('Failed to update deal stage from Stripe payment', {
        dealId,
        stageId,
        error: error.message
      });
    }
  }

  async handlePayment(paymentRecord) {
    const dealId = paymentRecord?.deal_id;
    if (!dealId) return;
    await this.updateDealStage(dealId, STAGES.SECOND_PAYMENT_ID, { type: 'payment' });
  }

  async handleFinalPayment(paymentRecord) {
    const dealId = paymentRecord?.deal_id;
    if (!dealId) return;
    await this.updateDealStage(dealId, STAGES.CAMP_WAITER_ID, { type: 'final_payment' });
  }

  async handleRefund(refund) {
    const metadata = refund?.metadata || {};
    const dealId = metadata.deal_id || metadata.dealId || null;
    if (!dealId) {
      this.logger.warn('Stripe refund without deal_id metadata', {
        refundId: refund?.id
      });
      return;
    }

    const paymentType = normalisePaymentType(metadata.payment_type || metadata.paymentType);
    const isFinalFlag = String(metadata.is_final || metadata.isFinal || '').toLowerCase() === 'true';

    let targetStage = STAGES.FIRST_PAYMENT_ID;
    if (paymentType === 'final' || paymentType === 'rest' || paymentType === 'second' || isFinalFlag) {
      targetStage = STAGES.SECOND_PAYMENT_ID;
    }

    await this.updateDealStage(dealId, targetStage, {
      type: 'refund',
      refundId: refund?.id || null,
      paymentType: paymentType || null,
      amount: refund?.amount || null
    });
  }
}

module.exports = {
  StripeCrmSyncService,
  STAGES
};

