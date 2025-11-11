const axios = require('axios');

const MINOR_UNIT_CURRENCIES = new Set([
  'BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF'
]);

const DEFAULT_TARGET_CURRENCY = process.env.CURRENCY_TARGET || 'PLN';
const EXCHANGE_API_URL = process.env.CURRENCY_API_URL || 'https://open.er-api.com/v6/latest';
const CACHE_TTL_MS = parseInt(process.env.CURRENCY_CACHE_TTL_MS || '3600000', 10);
const requestTimeoutMs = parseInt(process.env.CURRENCY_API_TIMEOUT_MS || '8000', 10);
const rateCache = new Map();

/**
 * Convert Stripe-style integer amount to decimal representation.
 * @param {number} amount - integer amount (minor units)
 * @param {string} currency - ISO currency code
 * @returns {number}
 */
function fromMinorUnit(amount, currency = 'PLN') {
  if (!Number.isFinite(amount)) return 0;
  const factor = MINOR_UNIT_CURRENCIES.has(currency.toUpperCase()) ? 1 : 100;
  return amount / factor;
}

/**
 * Convert decimal amount to Stripe-style integer amount.
 * @param {number} amount - decimal value
 * @param {string} currency - ISO currency code
 * @returns {number}
 */
function toMinorUnit(amount, currency = 'PLN') {
  if (!Number.isFinite(amount)) return 0;
  const factor = MINOR_UNIT_CURRENCIES.has(currency.toUpperCase()) ? 1 : 100;
  return Math.round(amount * factor);
}

/**
 * Banker's rounding (round half to even) to given precision.
 * @param {number} value
 * @param {number} precision - number of decimal digits (default 2)
 * @returns {number}
 */
function roundBankers(value, precision = 2) {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** precision;
  const scaled = value * factor;
  const scaledFloor = Math.floor(scaled);
  const diff = scaled - scaledFloor;

  if (Math.abs(diff - 0.5) < Number.EPSILON) {
    return (scaledFloor % 2 === 0 ? scaledFloor : scaledFloor + 1) / factor;
  }

  return Math.round(scaled) / factor;
}

/**
 * Normalise currency code to upper-case 3 letter ISO.
 * @param {string} currency
 * @returns {string}
 */
function normaliseCurrency(currency) {
  return typeof currency === 'string' ? currency.trim().toUpperCase() : 'PLN';
}

async function getExchangeRate(baseCurrency, targetCurrency) {
  const cacheKey = baseCurrency;
  const cached = rateCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.rates[targetCurrency];
  }

  try {
    const { data } = await axios.get(`${EXCHANGE_API_URL}/${baseCurrency}`, {
      timeout: requestTimeoutMs
    });

    if (data?.result === 'success' && data?.rates) {
      rateCache.set(cacheKey, {
        rates: data.rates,
        timestamp: Date.now()
      });
      return data.rates[targetCurrency];
    }
  } catch (error) {
    // swallow, conversion will fallback
  }

  return undefined;
}

async function convertCurrency(amount, fromCurrency, toCurrency = DEFAULT_TARGET_CURRENCY) {
  if (!Number.isFinite(amount)) return 0;
  const source = normaliseCurrency(fromCurrency);
  const target = normaliseCurrency(toCurrency);

  if (source === target) return roundBankers(amount);

  const rate = await getExchangeRate(source, target);
  if (!Number.isFinite(rate) || rate <= 0) {
    return 0;
  }

  return roundBankers(amount * rate);
}

module.exports = {
  fromMinorUnit,
  toMinorUnit,
  roundBankers,
  normaliseCurrency,
  convertCurrency
};

