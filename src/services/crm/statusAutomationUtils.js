const logger = require('../../utils/logger');
const { normalizeSchedule, SCHEDULE_PROFILES } = require('./statusCalculator');

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

module.exports = {
  toNumber,
  convertToPln,
  parseRawMetadata,
  detectScheduleFromPayments,
  estimateScheduleFromDeal
};

