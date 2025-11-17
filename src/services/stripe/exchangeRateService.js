const axios = require('axios');
const logger = require('../../utils/logger');

const CACHE = new Map();
const DEFAULT_TARGET = (process.env.CURRENCY_TARGET || 'PLN').toUpperCase();
const BASE_URL = process.env.CURRENCY_API_URL || 'https://open.er-api.com/v6/latest';
const CACHE_TTL_MS = parseInt(process.env.CURRENCY_CACHE_TTL_MS || '3600000', 10);
const REQUEST_TIMEOUT_MS = parseInt(process.env.CURRENCY_API_TIMEOUT_MS || '8000', 10);

function getCacheEntry(currency) {
  const entry = CACHE.get(currency);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > (entry.ttl || CACHE_TTL_MS)) {
    return null;
  }
  return entry;
}

function storeCache(currency, rates, ttl = CACHE_TTL_MS) {
  CACHE.set(currency, {
    rates,
    timestamp: Date.now(),
    ttl
  });
}

async function fetchRates(currency) {
  const url = `${BASE_URL}/${currency}`;
  const { data } = await axios.get(url, { timeout: REQUEST_TIMEOUT_MS });
  if (data?.result !== 'success' || !data?.rates) {
    throw new Error(`Exchange API returned invalid payload for ${currency}`);
  }
  return data.rates;
}

async function getRate(baseCurrency, targetCurrency = DEFAULT_TARGET) {
  const from = baseCurrency?.toUpperCase();
  const to = targetCurrency?.toUpperCase();
  if (!from || !to) {
    throw new Error('Both baseCurrency and targetCurrency are required');
  }
  if (from === to) return 1;

  const cached = getCacheEntry(from);
  if (cached?.rates?.[to]) {
    return cached.rates[to];
  }

  try {
    const rates = await fetchRates(from);
    if (!Number.isFinite(rates[to])) {
      throw new Error(`Rate ${from}->${to} not found`);
    }
    storeCache(from, rates);
    logger.info('Fetched FX rate', { from, to });
    return rates[to];
  } catch (error) {
    if (cached?.rates?.[to]) {
      logger.warn('Using stale FX rate due to fetch failure', {
        from,
        to,
        error: error.message
      });
      return cached.rates[to];
    }
    logger.error('Failed to fetch FX rate', { from, to, error: error.message });
    throw error;
  }
}

function clearCache() {
  CACHE.clear();
}

module.exports = {
  getRate,
  clearCache
};

