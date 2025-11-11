const { getStripeClient } = require('./client');
const logger = require('../../utils/logging/stripe').stripeRequestLogger;

const CACHE = new Map();
const DEFAULT_TTL_SECONDS = parseInt(process.env.STRIPE_RATE_TTL_SEC || '3600', 10);

function getCacheKey(currency, targetCurrency) {
  return `${currency.toUpperCase()}_${targetCurrency.toUpperCase()}`;
}

function isCacheValid(entry) {
  if (!entry) return false;
  const ttl = Number.isFinite(entry.ttl) ? entry.ttl : DEFAULT_TTL_SECONDS;
  return Date.now() - entry.fetchedAt < ttl * 1000;
}

async function fetchExchangeRate(baseCurrency, targetCurrency) {
  const stripe = getStripeClient();
  const response = await stripe.exchangeRates.retrieve(baseCurrency.toLowerCase());
  const rate =
    response?.rates?.[targetCurrency.toLowerCase()] ??
    response?.rates?.[targetCurrency.toUpperCase()];
  if (!rate) {
    throw new Error(`Stripe exchange rate for ${baseCurrency}->${targetCurrency} not available`);
  }
  return Number(rate);
}

async function getRate(baseCurrency, targetCurrency = 'PLN', { ttlSeconds } = {}) {
  const from = baseCurrency.toUpperCase();
  const to = targetCurrency.toUpperCase();
  if (from === to) return 1;

  const cacheKey = getCacheKey(from, to);
  const cacheEntry = CACHE.get(cacheKey);
  if (isCacheValid(cacheEntry)) {
    return cacheEntry.rate;
  }

  try {
    const rate = await fetchExchangeRate(from, to);
    CACHE.set(cacheKey, {
      rate,
      fetchedAt: Date.now(),
      ttl: ttlSeconds || DEFAULT_TTL_SECONDS
    });
    logger.info('Fetched Stripe FX rate', { from, to, rate });
    return rate;
  } catch (error) {
    logger.warn('Failed to fetch Stripe FX rate', {
      from,
      to,
      error: error.message
    });
    return null;
  }
}

function clearCache() {
  CACHE.clear();
}

module.exports = {
  getRate,
  clearCache
};

