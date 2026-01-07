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

  // Для events используем STRIPE_EVENTS_API_KEY (отдельный кабинет COMOON Events)
  if (options.type === 'events') {
    const eventsKey = process.env.STRIPE_EVENTS_API_KEY;
    if (!eventsKey) {
      throw new Error('STRIPE_EVENTS_API_KEY is not set. Add it to .env');
    }
    
    return eventsKey;
  }

  // Для обычных платежей используем STRIPE_API_KEY (основной кабинет)
  // ВАЖНО: НЕ используем STRIPE_EVENTS_API_KEY для создания платежей!
  const apiKey = process.env.STRIPE_API_KEY;
  if (!apiKey) {
    throw new Error('STRIPE_API_KEY is not set. Add it to .env');
  }
  
  // Проверяем, что не перепутали ключи (Events ключ не должен быть в STRIPE_API_KEY)
  const eventsKey = process.env.STRIPE_EVENTS_API_KEY;
  if (eventsKey && apiKey === eventsKey) {
    logger.error('❌ КРИТИЧЕСКАЯ ОШИБКА: STRIPE_API_KEY и STRIPE_EVENTS_API_KEY одинаковые!', {
      hint: 'STRIPE_API_KEY должен быть ключом ОСНОВНОГО кабинета, а STRIPE_EVENTS_API_KEY - ключом Events кабинета',
      apiKeyPrefix: apiKey.substring(0, 20) + '...',
      eventsKeyPrefix: eventsKey.substring(0, 20) + '...',
      action: 'Проверьте настройки в Render Dashboard. STRIPE_API_KEY должен указывать на ОСНОВНОЙ кабинет, НЕ на Events кабинет!'
    });
  }
  
  // ВАЖНО: Events кабинет имеет ключ, заканчивающийся на ...7UtM
  // Основной кабинет имеет ключ, заканчивающийся на ...5Cr5
  // Если STRIPE_API_KEY заканчивается на 7UtM, это означает, что используется Events кабинет вместо основного!
  if (apiKey.endsWith('7UtM')) {
    logger.error('❌ КРИТИЧЕСКАЯ ОШИБКА: STRIPE_API_KEY указывает на Events кабинет!', {
      apiKeySuffix: '...7UtM',
      expectedSuffix: '...5Cr5',
      hint: 'Ключ, заканчивающийся на 7UtM, принадлежит Events кабинету. STRIPE_API_KEY должен быть ключом ОСНОВНОГО кабинета (заканчивается на 5Cr5)!',
      action: 'Исправьте STRIPE_API_KEY в Render Dashboard. Используйте ключ ОСНОВНОГО кабинета (заканчивается на 5Cr5), НЕ Events кабинета (7UtM)!'
    });
  }
  
  // Проверяем, что используется правильный ключ основного кабинета
  if (!apiKey.endsWith('5Cr5') && !apiKey.endsWith('7UtM')) {
    logger.warn('⚠️  STRIPE_API_KEY имеет неожиданный суффикс', {
      apiKeySuffix: apiKey.substring(apiKey.length - 4),
      expectedSuffix: '5Cr5',
      hint: 'Ожидается, что ключ основного кабинета заканчивается на 5Cr5. Если это не так, проверьте настройки в Render Dashboard.'
    });
  }
  
  // Логируем, какой ключ используется (только префикс для безопасности)
  logger.info('Using Stripe API key for payments', {
    apiKeyPrefix: apiKey.substring(0, 20) + '...',
    keyType: apiKey.startsWith('sk_live_') ? 'live' : apiKey.startsWith('sk_test_') ? 'test' : 'unknown',
    accountType: 'PRIMARY',
    note: 'This key should be from PRIMARY Stripe account, NOT Events account'
  });

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
  const accountType = options.type === 'events' ? 'EVENTS' : 'PRIMARY';
  const apiKeySuffix = apiKey.substring(apiKey.length - 4);
  
  // Детальное логирование для диагностики
  logger.info(`Creating Stripe client for ${accountType} account`, {
    accountType,
    apiKeyPrefix: apiKey.substring(0, 20) + '...',
    apiKeySuffix,
    expectedSuffix: accountType === 'EVENTS' ? '7UtM' : '5Cr5',
    isCorrectSuffix: accountType === 'EVENTS' 
      ? apiKeySuffix === '7UtM' 
      : apiKeySuffix === '5Cr5',
    envVar: accountType === 'EVENTS' ? 'STRIPE_EVENTS_API_KEY' : 'STRIPE_API_KEY',
    note: accountType === 'PRIMARY' 
      ? 'This client is used for creating payments, customers, and checkout sessions'
      : 'This client is used ONLY for event reports, NOT for payments'
  });
  
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
    accountType,
    apiKeySuffix,
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

