const Stripe = require('stripe');
const { logStripeError, logStripeResponse } = require('../../utils/logging/stripe');
const logger = require('../../utils/logger');
const { name: pkgName, version: pkgVersion } = require('../../../package.json');

const stripeInstances = new Map();

function getStripeMode() {
  return (process.env.STRIPE_MODE || 'live').toLowerCase();
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

  // В режиме live используем STRIPE_EVENTS_API_KEY (live ключ)
  // В режиме test используем STRIPE_API_KEY (test ключ)
  if (mode === 'live' || options.type === 'events') {
    const eventsKey = process.env.STRIPE_EVENTS_API_KEY;
    if (!eventsKey) {
      throw new Error('STRIPE_EVENTS_API_KEY is not set. Add it to .env');
    }
    
    const isTestKey = eventsKey.startsWith('sk_test');
    if (mode === 'live' && isTestKey) {
      logger.warn('STRIPE_EVENTS_API_KEY looks like test key but STRIPE_MODE=live');
    }
    
    return eventsKey;
  }

  const apiKey = process.env.STRIPE_API_KEY;
  if (!apiKey) {
    throw new Error('STRIPE_API_KEY is not set. Add it to .env');
  }

  const isLiveKey = apiKey.startsWith('sk_live');

  if (mode === 'test' && isLiveKey) {
    logger.warn('Stripe client configured in test mode but provided key looks like live');
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
        livemode: getStripeMode() !== 'test'
      });
      return response;
    } catch (error) {
      logStripeError(error, {
        method,
        path,
        durationMs: Date.now() - startedAt,
        livemode: getStripeMode() !== 'test'
      });
      throw error;
    }
  };

  sender._withLogging = true;
}

function createStripeClient(options = {}) {
  const apiKey = resolveStripeApiKey(options);
  const stripe = new Stripe(apiKey, {
    apiVersion: process.env.STRIPE_API_VERSION || '2024-04-10',
    timeout: resolveNumber(process.env.STRIPE_TIMEOUT_MS, 12000),
    maxNetworkRetries: resolveNumber(process.env.STRIPE_MAX_NETWORK_RETRIES, 1),
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
  getStripeClient
};

