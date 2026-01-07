const Stripe = require('stripe');
const { logStripeError, logStripeResponse } = require('../../utils/logging/stripe');
const logger = require('../../utils/logger');
const { name: pkgName, version: pkgVersion } = require('../../../package.json');

const stripeInstances = new Map();

function getStripeMode() {
  // Всегда live режим, test режим не используется
  return 'live';
}

function resolveNumber(value, fallback) {
  if (!value && value !== 0) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function resolveStripeApiKey(options = {}) {
  if (options.apiKey) {
    return options.apiKey;
  }

  const mode = getStripeMode();

  // Всегда используем STRIPE_EVENTS_API_KEY (live ключ)
  // Test режим не используется
  if (options.type === 'events' || mode === 'live') {
    const eventsKey = process.env.STRIPE_EVENTS_API_KEY;
    if (!eventsKey) {
      throw new Error('STRIPE_EVENTS_API_KEY is not set. Add it to .env');
    }
    
    const isTestKey = eventsKey.startsWith('sk_test');
    if (isTestKey) {
      logger.warn('STRIPE_EVENTS_API_KEY looks like test key but should be live key');
    }
    
    return eventsKey;
  }

  // Fallback на STRIPE_API_KEY если STRIPE_EVENTS_API_KEY не задан
  const apiKey = process.env.STRIPE_API_KEY;
  if (!apiKey) {
    throw new Error('STRIPE_API_KEY is not set. Add it to .env');
  }

  const isTestKey = apiKey.startsWith('sk_test');
  if (isTestKey) {
    logger.warn('STRIPE_API_KEY looks like test key but should be live key');
  }

  return apiKey;
}

function attachLoggingHooks(stripe) {
  const sender = stripe?._requestSender;
  if (!sender || typeof sender._makeRequest !== 'function' || sender._withLogging) {
    return;
  }

  const originalMakeRequest = sender._makeRequest.bind(sender);
  sender._makeRequest = async function patchedRequest(method, host, path, data, auth, options) {
    const startedAt = Date.now();
    try {
      const response = await originalMakeRequest(method, host, path, data, auth, options);
      logStripeResponse('Stripe request completed', {
        method,
        path,
        durationMs: Date.now() - startedAt,
        requestId: response?._requestId,
        livemode: true
      });
      return response;
    } catch (error) {
      const errorContext = {
        method,
        path,
        durationMs: Date.now() - startedAt,
        livemode: true,
        // Дополнительная диагностика
        errorName: error.name,
        errorStack: error.stack ? error.stack.split('\n').slice(0, 3).join('\n') : undefined,
        // Проверяем, это ли connection error
        isConnectionError: error.message?.includes('connection') || error.message?.includes('timeout') || error.message?.includes('ECONNREFUSED') || error.message?.includes('ENOTFOUND')
      };
      
      logStripeError(error, errorContext);
      
      // Дополнительное логирование для connection errors
      if (errorContext.isConnectionError) {
        logger.error('Stripe connection error detected', {
          method,
          path,
          durationMs: errorContext.durationMs,
          errorMessage: error.message,
          errorType: error.type,
          errorCode: error.code,
          suggestion: 'This may be a temporary network issue. Check Stripe API status and Render network connectivity.'
        });
      }
      
      throw error;
    }
  };

  sender._withLogging = true;
}

function createStripeClient(options = {}) {
  const apiKey = resolveStripeApiKey(options);
  const stripe = new Stripe(apiKey, {
    apiVersion: process.env.STRIPE_API_VERSION || '2024-04-10',
    timeout: resolveNumber(process.env.STRIPE_TIMEOUT_MS, 30000), // Увеличено до 30 секунд
    maxNetworkRetries: resolveNumber(process.env.STRIPE_MAX_NETWORK_RETRIES, 3), // Увеличено до 3 попыток
    appInfo: {
      name: pkgName || 'pipedrive-wfirma-integration',
      version: pkgVersion || '0.0.0',
      url: 'https://github.com/sigayyury-ai/crmtowfirma'
    }
  });

  attachLoggingHooks(stripe);
  const mode = getStripeMode();
  logger.info('Stripe client initialised', {
    mode,
    apiVersion: stripe.getApiField('version'),
    keyType: options.type || 'default'
  });
  return stripe;
}

/**
 * Проверяет можно ли получить сессию (только live сессии)
 * @param {string} sessionId - ID сессии
 * @returns {boolean} - всегда true, работаем только с live сессиями
 */
function canRetrieveSession(sessionId) {
  if (!sessionId || typeof sessionId !== 'string') {
    return false;
  }
  
  // Всегда работаем только с live сессиями, test сессии игнорируем
  const isTestSession = sessionId.startsWith('cs_test_');
  if (isTestSession) {
    return false;
  }
  
  // Все остальные сессии разрешаем (live или старые форматы)
  return true;
}

function getStripeClient(options = {}) {
  const mode = getStripeMode();
  const apiKey = resolveStripeApiKey(options);
  const cacheKey = `${mode}:${options.type || 'default'}:${apiKey}`;
  if (!stripeInstances.has(cacheKey)) {
    stripeInstances.set(cacheKey, createStripeClient(options));
  }
  return stripeInstances.get(cacheKey);
}

module.exports = {
  getStripeClient,
  getStripeMode,
  resolveStripeApiKey,
  canRetrieveSession
};

