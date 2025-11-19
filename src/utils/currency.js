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
 * Map of currency names to ISO currency codes
 */
const CURRENCY_NAME_TO_CODE = {
  'polish zloty': 'PLN',
  'zloty': 'PLN',
  'euro': 'EUR',
  'us dollar': 'USD',
  'dollar': 'USD',
  'british pound': 'GBP',
  'pound': 'GBP',
  'swiss franc': 'CHF',
  'japanese yen': 'JPY',
  'yen': 'JPY',
  'australian dollar': 'AUD',
  'canadian dollar': 'CAD',
  'chinese yuan': 'CNY',
  'yuan': 'CNY',
  'russian ruble': 'RUB',
  'ruble': 'RUB',
  'ukrainian hryvnia': 'UAH',
  'hryvnia': 'UAH',
  'czech koruna': 'CZK',
  'koruna': 'CZK',
  'swedish krona': 'SEK',
  'krona': 'SEK',
  'norwegian krone': 'NOK',
  'krone': 'NOK',
  'danish krone': 'DKK',
  'hungarian forint': 'HUF',
  'forint': 'HUF',
  'romanian leu': 'RON',
  'leu': 'RON',
  'bulgarian lev': 'BGN',
  'lev': 'BGN',
  'croatian kuna': 'HRK',
  'kuna': 'HRK',
  'turkish lira': 'TRY',
  'lira': 'TRY'
};

/**
 * Normalise currency code to upper-case 3 letter ISO.
 * Handles both currency codes (e.g., "PLN", "EUR") and full names (e.g., "Polish Zloty", "Euro").
 * @param {string} currency
 * @returns {string} - ISO currency code in uppercase (e.g., "PLN", "EUR")
 */
function normaliseCurrency(currency) {
  if (typeof currency !== 'string') return 'PLN';
  
  const trimmed = currency.trim();
  if (!trimmed) return 'PLN';
  
  // If it's already a 3-letter code (uppercase or lowercase), return uppercase
  if (/^[A-Z]{3}$/i.test(trimmed)) {
    return trimmed.toUpperCase();
  }
  
  // Try to map full currency name to code
  const lowerName = trimmed.toLowerCase();
  
  // Exact match first
  if (CURRENCY_NAME_TO_CODE[lowerName]) {
    return CURRENCY_NAME_TO_CODE[lowerName];
  }
  
  // Check if it contains known currency names (more flexible matching)
  for (const [name, code] of Object.entries(CURRENCY_NAME_TO_CODE)) {
    // Check if the currency name contains the key or vice versa
    if (lowerName.includes(name) || name.includes(lowerName)) {
      return code;
    }
    // Also check word boundaries for better matching
    const nameWords = name.split(' ');
    const currencyWords = lowerName.split(' ');
    if (nameWords.length > 0 && currencyWords.some(word => nameWords.includes(word))) {
      return code;
    }
  }
  
  // Special case: "POLISH ZLOTY" → "PLN"
  if (lowerName.includes('polish') && lowerName.includes('zloty')) {
    return 'PLN';
  }
  
  // If we can't map it, try to extract 3-letter code from the string
  const codeMatch = trimmed.match(/\b([A-Z]{3})\b/i);
  if (codeMatch) {
    return codeMatch[1].toUpperCase();
  }
  
  // Default to PLN if we can't determine
  return 'PLN';
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

