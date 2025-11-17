const MINOR_UNIT_CURRENCIES = new Set([
  'BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF'
]);

const DEFAULT_TARGET_CURRENCY = process.env.CURRENCY_TARGET || 'PLN';
const { getRate } = require('../services/stripe/exchangeRateService');

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

async function convertCurrency(amount, fromCurrency, toCurrency = DEFAULT_TARGET_CURRENCY) {
  if (!Number.isFinite(amount)) return 0;
  const source = normaliseCurrency(fromCurrency);
  const target = normaliseCurrency(toCurrency);

  if (source === target) return roundBankers(amount);

  try {
    const rate = await getRate(source, target);
    if (!Number.isFinite(rate) || rate <= 0) {
      return 0;
    }
    return roundBankers(amount * rate);
  } catch (error) {
    return 0;
  }
}

module.exports = {
  fromMinorUnit,
  toMinorUnit,
  roundBankers,
  normaliseCurrency,
  convertCurrency
};

