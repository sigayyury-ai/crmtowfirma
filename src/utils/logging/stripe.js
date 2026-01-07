const { format } = require('util');
const baseLogger = require('../logger');

const REDACTION_PLACEHOLDER = '[REDACTED]';
const SENSITIVE_KEYS = new Set([
  'card',
  'number',
  'cvc',
  'exp_month',
  'exp_year',
  'api_key',
  'token',
  'secret',
  'password'
]);

/**
 * Redact sensitive values from Stripe payload.
 * @param {object} payload
 * @returns {object}
 */
function redactPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return payload;
  }

  if (Array.isArray(payload)) {
    return payload.map((item) => redactPayload(item));
  }

  return Object.entries(payload).reduce((acc, [key, value]) => {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      acc[key] = REDACTION_PLACEHOLDER;
      return acc;
    }

    if (key.toLowerCase().includes('email')) {
      acc[key] = maskEmail(value);
      return acc;
    }

    if (key.toLowerCase().includes('phone')) {
      acc[key] = maskPhone(value);
      return acc;
    }

    if (typeof value === 'object' && value !== null) {
      acc[key] = redactPayload(value);
      return acc;
    }

    acc[key] = value;
    return acc;
  }, {});
}

function maskEmail(value) {
  if (typeof value !== 'string') return value;
  const [local = '', domain = ''] = value.split('@');
  if (!local || !domain) {
    return REDACTION_PLACEHOLDER;
  }
  const maskedLocal = local.length <= 2
    ? `${local[0] || ''}*`
    : `${local[0]}***${local[local.length - 1]}`;
  return `${maskedLocal}@${domain}`;
}

function maskPhone(value) {
  if (typeof value !== 'string') return value;
  const digits = value.replace(/\D/g, '');
  if (digits.length < 4) return REDACTION_PLACEHOLDER;
  return `${digits.slice(0, 2)}****${digits.slice(-2)}`;
}

const stripeRequestLogger = baseLogger.child({ context: 'stripe' });

function logStripeError(error, context = {}) {
  const payload = {
    message: error.message,
    type: error.type,
    code: error.code,
    requestId: error.requestId,
    statusCode: error.statusCode,
    // Дополнительная диагностика для connection errors
    rawError: error.raw ? {
      message: error.raw.message,
      type: error.raw.type,
      code: error.raw.code,
      statusCode: error.raw.statusCode
    } : null,
    // Информация о сетевых ошибках
    networkError: error.raw?.message?.includes('connection') || error.raw?.message?.includes('timeout') || error.raw?.message?.includes('ECONNREFUSED') || error.raw?.message?.includes('ENOTFOUND') ? true : undefined,
    ...context
  };
  stripeRequestLogger.error(payload);
}

function logStripeResponse(message, data = {}) {
  stripeRequestLogger.info({
    message,
    ...data
  });
}

function logStripeEvent(event) {
  stripeRequestLogger.debug({
    type: 'stripe_event',
    eventId: event?.id,
    eventType: event?.type,
    created: event?.created,
    payload: redactPayload(event)
  });
}

function formatStripeErrorForLog(error) {
  return format('[StripeError] %s (%s) %o', error.message, error.type, {
    requestId: error.requestId,
    code: error.code,
    statusCode: error.statusCode
  });
}

module.exports = {
  stripeRequestLogger,
  logStripeError,
  logStripeResponse,
  logStripeEvent,
  formatStripeErrorForLog,
  redactPayload
};






