const crypto = require('crypto');
const { normalizeWhitespace, normalizeName } = require('../../utils/normalize');

const HEADER_MARKER = '#Data operacji;#Opis operacji;#Rachunek;#Kategoria;#Kwota;';
const REVOLUT_HEADER_MARKER = 'Date started (UTC),Date completed (UTC),ID,Type,State,Description';
// Marker for old bank format (ING Bank Śląski or similar)
// Format: date,date,description,payer,account,amount,balance,row_number
const OLD_BANK_HEADER_PATTERN = /^\d{4}-\d{2}-\d{2},\d{2}-\d{2}-\d{4},/; // First line starts with dates
// Улучшенное регулярное выражение для поиска номеров проформ
// Поддерживает: CO-PROF 123/2025, CO PROF 123/2025, CO-PROF123/2025 и т.д.
const PROFORMA_REGEX = /(CO-?\s*PROF\s*\d+\s*\/\s*\d{4})/i;

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
  
  // Try to match format with decimal separator (comma or dot)
  // Pattern: optional minus, digits with optional spaces, comma or dot, 1-2 decimals, currency code
  let match = cleaned.match(/^([\-]?)\s*([0-9\s]+)[,\.]([0-9]{1,2})\s*([A-Z]{3})$/);
  
  if (!match) {
    // Try format without decimal separator (integer amounts)
    match = cleaned.match(/^([\-]?)\s*([0-9\s]+)\s+([A-Z]{3})$/);
    if (match) {
      const sign = match[1];
      const integerPart = match[2].replace(/\s+/g, '');
      const currency = match[3];
      const numericString = (sign === '-' ? '-' : '') + integerPart;
      const value = parseFloat(numericString);
      
      if (!Number.isNaN(value)) {
        return {
          amount: Math.abs(value),
          currency,
          direction: value < 0 ? 'out' : 'in'
        };
      }
    }
    
    // Fallback to original regex
    const fallbackMatch = cleaned.match(/([\-0-9 ,]+)\s*([A-Z]{3})/);
    if (!fallbackMatch) {
      return { amount: 0, currency: null, direction: 'in' };
    }
    
    // Remove all spaces and replace comma with dot
    const numericPart = fallbackMatch[1].replace(/\s+/g, '').replace(',', '.');
    const currency = fallbackMatch[2];
    const value = parseFloat(numericPart);
    
    if (Number.isNaN(value)) {
      return { amount: 0, currency, direction: 'in' };
    }
    
    return {
      amount: Math.abs(value),
      currency,
      direction: value < 0 ? 'out' : 'in'
    };
  }

  // Extract parts from match (with decimal separator)
  const sign = match[1]; // '-' or empty
  const integerPart = match[2].replace(/\s+/g, ''); // Remove spaces from integer part
  const decimalPart = match[3]; // 1-2 digits
  const currency = match[4];
  
  // Construct numeric value: sign + integer + '.' + decimal (pad to 2 digits if needed)
  const paddedDecimal = decimalPart.length === 1 ? decimalPart + '0' : decimalPart;
  const numericString = (sign === '-' ? '-' : '') + integerPart + '.' + paddedDecimal;
  const value = parseFloat(numericString);

  if (Number.isNaN(value)) {
    return { amount: 0, currency, direction: 'in' };
  }

  // Determine direction: negative value = expense (out), positive = income (in)
  const direction = value < 0 ? 'out' : 'in';

  return {
    amount: Math.abs(value),
    currency,
    direction
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

function parseRevolutStatement(content) {
  if (!content) {
    return [];
  }

  const lines = content
    .split(/\r?\n/)
    .map((line) => line.replace(/^\uFEFF/, ''));

  // Find header line
  const headerIndex = lines.findIndex((line) => 
    line.includes('Date started (UTC)') && line.includes('Type') && line.includes('Description')
  );

  if (headerIndex === -1) {
    return [];
  }

  // Parse header to get column indices
  const headerLine = lines[headerIndex];
  const headerColumns = headerLine.split(',').map(col => col.trim());
  
  const colIndices = {
    dateCompleted: headerColumns.indexOf('Date completed (UTC)'),
    type: headerColumns.indexOf('Type'),
    state: headerColumns.indexOf('State'),
    description: headerColumns.indexOf('Description'),
    payer: headerColumns.indexOf('Payer'),
    paymentCurrency: headerColumns.indexOf('Payment currency'),
    amount: headerColumns.indexOf('Amount'),
    totalAmount: headerColumns.indexOf('Total amount'),
    fee: headerColumns.indexOf('Fee'),
    account: headerColumns.indexOf('Account'),
    id: headerColumns.indexOf('ID')
  };

  const records = [];
  const dataLines = lines.slice(headerIndex + 1).filter((line) => line.trim().length > 0);

  for (const rawLine of dataLines) {
    if (!rawLine.trim()) continue;

    // Parse CSV line with comma separator, handling quoted fields
    const columns = parseCsvLine(rawLine, ',');
    
    if (columns.length < Math.max(...Object.values(colIndices).filter(v => v >= 0)) + 1) {
      continue;
    }

    const type = columns[colIndices.type]?.trim();
    const state = columns[colIndices.state]?.trim();
    
    // Only process CARD_PAYMENT transactions that are COMPLETED
    if (type !== 'CARD_PAYMENT' || state !== 'COMPLETED') {
      continue;
    }

    const dateCompleted = columns[colIndices.dateCompleted]?.trim();
    const description = columns[colIndices.description]?.trim() || '';
    const payer = columns[colIndices.payer]?.trim() || '';
    const paymentCurrency = columns[colIndices.paymentCurrency]?.trim() || 'EUR';
    const amountStr = columns[colIndices.amount]?.trim() || columns[colIndices.totalAmount]?.trim() || '0';
    const feeStr = columns[colIndices.fee]?.trim() || '0';
    const account = columns[colIndices.account]?.trim() || '';
    const transactionId = columns[colIndices.id]?.trim() || '';

    // Parse amount (already negative for expenses in Revolut format)
    const amountValue = parseFloat(amountStr);
    if (isNaN(amountValue)) {
      continue;
    }

    // All amounts in Revolut export are negative for expenses
    const amount = Math.abs(amountValue);
    const direction = 'out'; // All CARD_PAYMENT are expenses

    // Parse fee if present
    const feeValue = parseFloat(feeStr) || 0;
    const totalAmount = amount + Math.abs(feeValue);

    // Extract payer name if not provided
    let payerName = payer || extractPayer(description) || 'Unknown';

    // Create operation hash from transaction ID and date
    const operationHash = crypto.createHash('sha256')
      .update(`${transactionId}-${dateCompleted}-${amountStr}-${description}`)
      .digest('hex');

    const record = {
      operation_date: dateCompleted,
      description: description || 'Card payment',
      account: account || 'Revolut Card',
      category: null, // Revolut format doesn't have category column
      amount: totalAmount, // Include fee in total
      currency: paymentCurrency,
      direction,
      amount_raw: amountStr,
      payer_name: payerName,
      payer_normalized_name: normalizeName(payerName),
      proforma_fullnumber: null, // Extract if found in description
      operation_hash: operationHash,
      raw_line: rawLine
    };

    // Try to extract proforma number from description
    const proformaMatch = description.match(PROFORMA_REGEX);
    if (proformaMatch) {
      record.proforma_fullnumber = proformaMatch[1]
        .replace(/\s+/g, ' ')
        .replace('CO PROF', 'CO-PROF')
        .toUpperCase();
    }

    records.push(record);
  }

  return records;
}

// Helper function to parse CSV line with comma separator
function parseCsvLine(line, separator = ',') {
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

    if (char === separator && !inQuotes) {
      result.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  result.push(current);
  return result;
}

function parseOldBankStatement(content) {
  if (!content) {
    return [];
  }

  const lines = content
    .split(/\r?\n/)
    .map((line) => line.replace(/^\uFEFF/, ''))
    .filter((line) => line.trim().length > 0);

  if (lines.length === 0) {
    return [];
  }

  // First line contains account info and currency
  // Format: date,date,account_number,name,address,currency,balance,balance,row_number
  const headerLine = lines[0];
  const headerColumns = parseCsvLine(headerLine, ',');
  
  // Extract currency from header (usually column 5 or 6)
  let currency = 'PLN'; // default
  for (let i = 0; i < headerColumns.length; i++) {
    const col = headerColumns[i]?.trim().toUpperCase();
    if (col && ['PLN', 'EUR', 'USD', 'GBP'].includes(col)) {
      currency = col;
      break;
    }
  }

  const records = [];
  
  // Process data lines (skip header)
  for (let i = 1; i < lines.length; i++) {
    const rawLine = lines[i];
    if (!rawLine.trim()) continue;

    const columns = parseCsvLine(rawLine, ',');
    
    // Need at least 6 columns: date, date, description, payer, account, amount, balance, row_number
    if (columns.length < 6) {
      continue;
    }

    const operationDateRaw = columns[0]?.trim();
    const valueDateRaw = columns[1]?.trim();
    const descriptionRaw = columns[2]?.trim() || '';
    const payerRaw = columns[3]?.trim() || '';
    const accountRaw = columns[4]?.trim() || '';
    const amountRaw = columns[5]?.trim() || '';
    // columns[6] = balance after operation
    // columns[7] = row number

    if (!operationDateRaw || !amountRaw) {
      continue;
    }

    // Note: In this format, column 4 (index 4) contains account number for transfers
    // For card payments, it's usually empty, so we use description to identify card transactions

    // Parse date from DD-MM-YYYY format
    let operationDate = null;
    try {
      const dateMatch = operationDateRaw.match(/^(\d{2})-(\d{2})-(\d{4})$/);
      if (dateMatch) {
        const [, day, month, year] = dateMatch;
        operationDate = `${year}-${month}-${day}`;
      } else {
        // Try YYYY-MM-DD format
        const dateObj = new Date(operationDateRaw);
        if (!isNaN(dateObj.getTime())) {
          operationDate = dateObj.toISOString().split('T')[0];
        }
      }
    } catch (e) {
      // Skip if date parsing fails
      continue;
    }

    // Parse amount (format: "-1,49" or "17000,00" with comma as decimal separator)
    let amount = 0;
    let direction = 'in';
    
    try {
      // Remove quotes and spaces, replace comma with dot
      const amountCleaned = amountRaw.replace(/["\s]/g, '').replace(',', '.');
      const amountValue = parseFloat(amountCleaned);
      
      if (!isNaN(amountValue)) {
        amount = Math.abs(amountValue);
        direction = amountValue < 0 ? 'out' : 'in';
      } else {
        continue; // Skip if amount can't be parsed
      }
    } catch (e) {
      continue; // Skip if amount parsing fails
    }

    // Clean description (remove quotes)
    const description = descriptionRaw.replace(/^"|"$/g, '').trim() || 'Transaction';
    
    // IMPORTANT: Override direction for tax and government payments
    // These are ALWAYS expenses (out), even if amount sign suggests otherwise
    // Tax payment patterns (Polish institutions)
    const taxPaymentPatterns = [
      /URZĄD\s+SKARBOWY/i,           // Tax office
      /ZAKŁAD\s+UBEZPIECZEŃ/i,        // Social insurance institution (ZUS)
      /ZUS/i,                         // ZUS abbreviation
      /PRZELEW\s+ZEWNĘTRZNY\s+DO\s+ZUS/i,  // Transfer to ZUS
      /PRZELEW\s+PODATKOWY/i,        // Tax transfer
      /CIT-8/i,                       // Corporate income tax
      /PIT/i,                         // Personal income tax
      /VAT/i,                         // VAT
      /SKARBOWY/i,                    // Tax (skarbowy)
      /PODATEK/i,                     // Tax (podatek)
      /UBEZPIECZENIA/i,               // Insurance (social)
      /SKŁADKA/i,                     // Contribution (social insurance)
    ];
    
    const descriptionUpper = description.toUpperCase();
    const payerUpper = (payerRaw.replace(/^"|"$/g, '').trim() || '').toUpperCase();
    const isTaxPayment = taxPaymentPatterns.some(pattern => 
      pattern.test(descriptionUpper) || pattern.test(payerUpper)
    );
    
    // If it's a tax/government payment, force direction to 'out' (expense)
    if (isTaxPayment) {
      direction = 'out';
    }
    
    // Extract payer name
    // For this format, payer column (index 3) may contain:
    // - Full company name with address (for transfers)
    // - Person name (for salary/contracts)
    // - Empty (for card payments)
    let payer = payerRaw.replace(/^"|"$/g, '').trim();
    
    // If payer contains company name with address, extract company name
    if (payer && /SPÓŁKA|SP\.\s*Z\s*O\.O\.|SP\.\s*Z\s*OGRANICZONĄ/i.test(payer)) {
      // Extract company name (usually before "UL." or address)
      const companyMatch = payer.match(/^([^,]+?)(?:\s+UL\.|,|$)/i);
      if (companyMatch) {
        payer = companyMatch[1].trim();
      } else {
        // Take first part before comma or address
        payer = payer.split(/UL\.|,\s*\d/)[0].trim();
      }
    } else if (!payer || payer.length > 100 || /UL\.|ULICA|GDAŃSK|WARSZAWA/i.test(payer)) {
      // If payer is empty or looks like an address, try to extract from description
      payer = extractPayer(description) || payer || null;
    }
    
    // Clean payer name (remove address parts if present)
    if (payer) {
      // Remove common address patterns
      payer = payer.replace(/UL\.\s*[A-Z].*$/i, '').trim();
      payer = payer.replace(/\d{2}-\d{3}\s+[A-Z].*$/i, '').trim(); // Postal codes
      payer = payer.replace(/\s+ELIXIR.*$/i, '').trim(); // Remove ELIXIR date suffix
      payer = payer.split(',')[0].trim(); // Take first part before comma
      
      // If payer is still too long or contains numbers, try to extract from description
      if (payer.length > 80 || /\d{4}-\d{2}-\d{2}/.test(payer)) {
        const descPayer = extractPayer(description);
        if (descPayer && descPayer.length < payer.length) {
          payer = descPayer;
        }
      }
    }
    
    const normalizedPayer = payer ? normalizeName(payer) : null;

    // Extract account
    // Column 4 contains account number for transfers, empty for card payments
    let account = accountRaw.replace(/^"|"$/g, '').trim();
    
    // If account is empty, try to identify from description
    if (!account) {
      // Check if it's a card payment
      if (/VB DEBIT|KARTĄ|KARTA|BLIK/i.test(description)) {
        account = 'Card Payment';
      } else {
        account = 'Unknown Account';
      }
    }

    // Create operation hash
    const operationHash = crypto.createHash('sha256')
      .update(`${operationDate}-${amountRaw}-${description}-${account}`)
      .digest('hex');

    // Try to extract proforma number from description
    const proformaMatch = description.match(PROFORMA_REGEX);
    const proformaFullnumber = proformaMatch
      ? proformaMatch[1].replace(/\s+/g, ' ').replace('CO PROF', 'CO-PROF').toUpperCase()
      : null;

    const record = {
      operation_date: operationDate,
      description,
      account,
      category: null, // Old format doesn't have category
      amount,
      currency,
      direction,
      amount_raw: amountRaw,
      payer_name: payer,
      payer_normalized_name: normalizedPayer,
      proforma_fullnumber: proformaFullnumber,
      operation_hash: operationHash,
      raw_line: rawLine
    };

    records.push(record);
  }

  return records;
}

function parseBankStatement(content) {
  if (!content) {
    return [];
  }

  const lines = content
    .split(/\r?\n/)
    .map((line) => line.replace(/^\uFEFF/, ''));

  // Check if it's Revolut/Wise format first
  const isRevolutFormat = lines.some((line) => 
    line.includes('Date started (UTC)') && line.includes('Type') && line.includes('Description')
  );

  if (isRevolutFormat) {
    return parseRevolutStatement(content);
  }

  // Check if it's old bank format (ING Bank Śląski or similar)
  // Format: first line starts with dates in format YYYY-MM-DD,DD-MM-YYYY
  const isOldBankFormat = lines.length > 0 && OLD_BANK_HEADER_PATTERN.test(lines[0]);

  if (isOldBankFormat) {
    return parseOldBankStatement(content);
  }

  // Otherwise, try mBank format
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

    const { amount, currency, direction: amountDirection } = parseAmount(amountRaw);

    const description = descriptionRaw.replace(/^"|"$/g, '').trim();
    const account = accountRaw.replace(/^"|"$/g, '').trim();
    const category = categoryRaw.replace(/^"|"$/g, '').trim();
    
    // PRIMARY RULE: Sign of amount is the main criterion
    // Negative amount (-) = expense (out), Positive amount (+) = income (in)
    let direction = amountDirection; // Start with direction from amount sign
    let directionSource = 'amount'; // Track what determined the direction
    
    // IMPORTANT: Check for tax and government payments FIRST
    // These are ALWAYS expenses (out), regardless of amount sign or category
    const taxPaymentPatterns = [
      /URZĄD\s+SKARBOWY/i,           // Tax office
      /ZAKŁAD\s+UBEZPIECZEŃ/i,        // Social insurance institution (ZUS)
      /ZUS/i,                         // ZUS abbreviation
      /PRZELEW\s+ZEWNĘTRZNY\s+DO\s+ZUS/i,  // Transfer to ZUS
      /PRZELEW\s+PODATKOWY/i,        // Tax transfer
      /CIT-8/i,                       // Corporate income tax
      /PIT/i,                         // Personal income tax
      /VAT/i,                         // VAT
      /SKARBOWY/i,                    // Tax (skarbowy)
      /PODATEK/i,                     // Tax (podatek)
      /UBEZPIECZENIA/i,               // Insurance (social)
      /SKŁADKA/i,                     // Contribution (social insurance)
    ];
    
    const descriptionUpper = description.toUpperCase();
    const isTaxPayment = taxPaymentPatterns.some(pattern => pattern.test(descriptionUpper));
    
    // If it's a tax/government payment, force direction to 'out' (expense)
    if (isTaxPayment) {
      direction = 'out';
      directionSource = 'tax_payment_pattern';
    }
    
    // Check category column (can override amount sign in special cases)
    // Category column may contain: "WYCHODZĄCY" / "WYCHODZACY" (outgoing) or "PRZYCHODZĄCY" / "PRZYCHODZACY" (incoming)
    // BUT: Don't override if it's already identified as tax payment
    if (category && directionSource !== 'tax_payment_pattern') {
      const categoryUpper = category.toUpperCase();
      if (categoryUpper.includes('WYCHODZĄCY') || categoryUpper.includes('WYCHODZACY')) {
        direction = 'out';
        directionSource = 'category';
      } else if (categoryUpper.includes('PRZYCHODZĄCY') || categoryUpper.includes('PRZYCHODZACY')) {
        direction = 'in';
        directionSource = 'category';
      }
    }
    
    // Check description for refund/return patterns
    // Need to distinguish between:
    // 1. Refunds TO clients (we return money) = expense (out)
    // 2. Refunds FROM services (they return money to us) = income (in)
    if (description) {
      const descUpper = description.toUpperCase().trim();
      
      const hasRefundKeyword = descUpper.includes('ZVROT') ||
                                descUpper.includes('ZWROT') ||
                                descUpper.includes('REFUND') ||
                                descUpper.includes('RETURN') ||
                                descUpper.includes('REVERSAL') ||
                                descUpper.includes('REVERSJA') ||
                                descUpper.includes('ANULOWANIE') ||
                                descUpper.includes('CANCEL');
      
      if (hasRefundKeyword) {
        // Check if it's a refund FROM a service (income)
        // Patterns that indicate refund FROM service TO us:
        const serviceRefundPatterns = [
          /ZWROT\s+ZAKUPU/i,           // "ZWROT ZAKUPU" - refund of purchase
          /ZWROT.*\.(COM|PL|NET|EU)/i,  // "ZWROT rentalcars.com" - service domain
          /RENTALCARS/i,                // rentalcars.com
          /BOOKING/i,                   // booking.com
          /AIRBNB/i,                    // airbnb.com
          /EXPEDIA/i,                   // expedia.com
          /HOTELS/i,                    // hotels.com
          /PAYPAL/i,                    // PayPal refunds
          /STRIPE/i                     // Stripe refunds
        ];
        
        const isServiceRefund = serviceRefundPatterns.some(pattern => pattern.test(descUpper));
        
        // Check if it's a refund TO a client (expense)
        // Patterns that indicate refund TO client FROM us:
        const clientRefundPatterns = [
          /ZWROT\s+CO-?\s*PROF/i,                    // "ZWROT CO-PROF" - refund with proforma number
          /ZWROT.*PRZELEW\s+ZEWN[ĘE]TRZNY\s+WYCHODZ[ĄA]CY/i, // "ZWROT ... PRZELEW ZEWNĘTRZNY WYCHODZĄCY"
          /ZWROT.*\d{4}\s*WARSZAWA/i,                // "ZWROT ... WARSZAWA" - client address
          /ZWROT.*UL\s+[A-Z]/i,                      // "ZWROT ... UL ..." - client street address
        ];
        
        const isClientRefund = clientRefundPatterns.some(pattern => pattern.test(descUpper));
        
        // Also check if description contains a person name (likely a client)
        const hasPersonName = /^[A-ZĄĆĘŁŃÓŚŹŻ]{2,}\s+[A-ZĄĆĘŁŃÓŚŹŻ]{2,}/.test(descUpper.split(',')[0]);
        
        if (isServiceRefund) {
          // Refund FROM service TO us = income (in)
          direction = 'in';
          directionSource = 'description_refund_from_service';
        } else if (isClientRefund || (hasPersonName && !isServiceRefund)) {
          // Refund TO client FROM us = expense (out)
          direction = 'out';
          directionSource = 'description_refund_to_client';
        } else {
          // Default: if we can't determine, keep original direction from amount sign
          // But log a warning for manual review
          direction = amountDirection;
          directionSource = 'description_refund_unknown';
        }
      }
    }
    
    // EXCEPTION: Some banks show incoming payments with negative sign in CSV
    // Only apply name pattern logic if:
    // 1. Amount sign says "out" (negative)
    // 2. Category doesn't specify direction
    // 3. It's not a refund pattern (already handled above)
    // 4. Description starts with person name pattern
    // 5. Description doesn't contain expense keywords
    if (directionSource === 'amount' && amountDirection === 'out' && description && !description.toUpperCase().includes('ZWROT')) {
      const descUpper = description.toUpperCase().trim();
      
      // Check if description starts with what looks like a person name (2-3 words, all caps, no numbers)
      const namePattern = /^[A-ZĄĆĘŁŃÓŚŹŻ]{2,}\s+[A-ZĄĆĘŁŃÓŚŹŻ]{2,}(\s+[A-ZĄĆĘŁŃÓŚŹŻ]{2,})?(\s|,|$)/;
      
      // Exclude common expense patterns
      const isExpensePattern = descUpper.includes('PRZELEW WYCHODZĄCY') || 
                                descUpper.includes('PRZELEW WYCHODZACY') ||
                                descUpper.includes('ZAKUP') ||
                                descUpper.includes('OPŁATA') ||
                                descUpper.includes('PŁATNOŚĆ') ||
                                descUpper.includes('KARTA') ||
                                descUpper.includes('BLIK');
      
      // Only override if it looks like a person name AND no expense patterns AND not already handled as refund
      if (namePattern.test(descUpper) && !isExpensePattern && directionSource === 'amount') {
        // This might be an incoming payment shown with negative sign by the bank
        // But ONLY if amount is negative - if amount is positive, it's definitely income
        direction = 'in';
        directionSource = 'description_name_exception';
      }
    }
    
    // Final safety check: if category explicitly says direction, trust it over amount sign
    // This handles cases where bank shows wrong sign in CSV
    if (category && directionSource === 'category') {
      // Category is already applied above, keep it
    }

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

