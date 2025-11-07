const crypto = require('crypto');
const { normalizeWhitespace, normalizeName } = require('../../utils/normalize');

const HEADER_MARKER = '#Data operacji;#Opis operacji;#Rachunek;#Kategoria;#Kwota;';
const PROFORMA_REGEX = /(CO-?PROF\s*\d+\/?\d{4})/i;

function splitCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        i += 1; // skip escaped quote
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ';' && !inQuotes) {
      result.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  result.push(current);
  return result;
}

function parseAmount(raw) {
  if (!raw) {
    return { amount: 0, currency: null, direction: 'in' };
  }

  const cleaned = raw.replace(/\u00A0/g, ' ').trim();
  const match = cleaned.match(/([\-0-9 ,]+)\s*([A-Z]{3})/);

  if (!match) {
    return { amount: 0, currency: null, direction: 'in' };
  }

  const numericPart = match[1].replace(/\s+/g, '').replace(',', '.');
  const currency = match[2];
  const value = parseFloat(numericPart);

  if (Number.isNaN(value)) {
    return { amount: 0, currency, direction: 'in' };
  }

  return {
    amount: Math.abs(value),
    currency,
    direction: value >= 0 ? 'in' : 'out'
  };
}

const ADDRESS_STOP_WORDS = new Set([
  'UL', 'UL.', 'ULICA', 'ULICY', 'ULICZNA',
  'PRZELEW', 'PROSPEKT', 'PR', 'PR.',
  'STR', 'STR.', 'ST', 'ST.', 'STREET',
  'AV', 'AV.', 'AVENUE', 'AVE', 'AVE.',
  'PL', 'PL.', 'PLAC', 'PLZ', 'PLZ.'
]);

function extractPayer(description) {
  if (!description) return null;
  const trimmed = normalizeWhitespace(description);
  if (!trimmed) return null;

  const parts = trimmed.split(',');
  const firstPart = normalizeWhitespace((parts[0] || trimmed).replace(/PRZELEW.*$/i, '').trim());

  if (!firstPart) return null;

  const tokens = firstPart.split(/\s+/);
  const nameTokens = [];

  for (const token of tokens) {
    if (!token) continue;
    const upper = token.toUpperCase();
    const stripped = upper.replace(/[^\p{L}]/gu, '');

    if (ADDRESS_STOP_WORDS.has(upper) || ADDRESS_STOP_WORDS.has(stripped)) {
      break;
    }

    if (/[0-9]/.test(token)) {
      break;
    }

    if (/^[A-Z]{2,}\.$/.test(upper) && ADDRESS_STOP_WORDS.has(upper.slice(0, -1))) {
      break;
    }

    nameTokens.push(token);
  }

  if (nameTokens.length === 0) {
    return firstPart;
  }

  return normalizeWhitespace(nameTokens.join(' '));
}

function parseBankStatement(content) {
  if (!content) {
    return [];
  }

  const lines = content
    .split(/\r?\n/)
    .map((line) => line.replace(/^\uFEFF/, ''));

  let headerIndex = lines.findIndex((line) => line.trim().startsWith(HEADER_MARKER));

  if (headerIndex === -1) {
    return [];
  }

  const dataLines = lines.slice(headerIndex + 1).filter((line) => line.trim().length > 0);

  const records = [];

  for (const rawLine of dataLines) {
    const columns = splitCsvLine(rawLine);

    if (columns.length < 5) {
      continue;
    }

    const [operationDateRaw, descriptionRaw, accountRaw, categoryRaw, amountRaw] = columns;
    if (!operationDateRaw || !descriptionRaw) {
      continue;
    }

    const { amount, currency, direction } = parseAmount(amountRaw);

    const description = descriptionRaw.replace(/^"|"$/g, '').trim();
    const account = accountRaw.replace(/^"|"$/g, '').trim();
    const category = categoryRaw.replace(/^"|"$/g, '').trim();

    const payer = extractPayer(description);
    const normalizedPayer = payer ? normalizeName(payer) : null;

    const proformaMatch = description.match(PROFORMA_REGEX);
    const proformaFullnumber = proformaMatch
      ? proformaMatch[1].replace(/\s+/g, ' ').replace('CO PROF', 'CO-PROF').toUpperCase()
      : null;

    const record = {
      operation_date: operationDateRaw.trim(),
      description,
      account,
      category,
      amount,
      currency,
      direction,
      amount_raw: amountRaw.trim(),
      payer_name: payer,
      payer_normalized_name: normalizedPayer,
      proforma_fullnumber: proformaFullnumber,
      operation_hash: crypto.createHash('sha256').update(rawLine).digest('hex'),
      raw_line: rawLine
    };

    records.push(record);
  }

  return records;
}

module.exports = {
  parseBankStatement,
  extractPayerName: extractPayer
};

