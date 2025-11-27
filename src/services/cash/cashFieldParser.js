const { PIPEDRIVE_CASH_FIELDS } = require('../../../config/customFields');

const FALLBACKS = {
  amount: ['cash_amount', 'Cash amount', 'cashAmount'],
  expectedDate: ['cash_expected_date', 'Cash expected date', 'cashExpectedDate'],
  receivedAmount: ['cash_received_amount', 'Cash received amount', 'cashReceivedAmount'],
  status: ['cash_status', 'Cash status', 'cashStatus']
};

function normalizeWhitespace(value) {
  return typeof value === 'string' ? value.trim() : value;
}

function parseNumber(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const sanitized = value.replace(/,/g, '.').replace(/[^\d.-]/g, '');
    const parsed = parseFloat(sanitized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (value && typeof value === 'object' && 'value' in value) {
    return parseNumber(value.value);
  }
  return null;
}

function parseDateString(value) {
  if (!value) return null;
  if (typeof value === 'object' && value.value) {
    return parseDateString(value.value);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

function readField(deal, fieldKey, fallbackKeys = []) {
  if (!deal) return undefined;
  const candidates = [];
  if (fieldKey) {
    candidates.push(fieldKey);
  }
  candidates.push(...fallbackKeys);

  for (const candidate of candidates) {
    if (candidate && Object.prototype.hasOwnProperty.call(deal, candidate)) {
      return deal[candidate];
    }
  }
  return undefined;
}

function extractCashFields(deal) {
  const amountRaw = readField(deal, PIPEDRIVE_CASH_FIELDS.cashAmount.key, FALLBACKS.amount);
  const expectedDateRaw = readField(deal, PIPEDRIVE_CASH_FIELDS.cashExpectedDate.key, FALLBACKS.expectedDate);
  const receivedRaw = readField(deal, PIPEDRIVE_CASH_FIELDS.cashReceivedAmount.key, FALLBACKS.receivedAmount);
  const statusRaw = readField(deal, PIPEDRIVE_CASH_FIELDS.cashStatus.key, FALLBACKS.status);

  return {
    amount: parseNumber(amountRaw),
    expectedDate: parseDateString(expectedDateRaw),
    receivedAmount: parseNumber(receivedRaw),
    status: normalizeWhitespace(statusRaw)
  };
}

module.exports = {
  extractCashFields,
  parseNumber,
  parseDateString,
  readField
};
