const logger = require('../../utils/logger');

/**
 * Expected CSV header columns
 */
const EXPECTED_HEADER = [
  'Название кампании',
  'Валюта',
  'Сумма затрат (PLN)',
  'Дата начала отчетности',
  'Дата окончания отчетности'
];

/**
 * Parse CSV line with comma separator, handling quoted fields
 * @param {string} line - CSV line
 * @returns {Array<string>} - Array of field values
 */
function parseCsvLine(line) {
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

    if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  result.push(current);
  return result;
}

/**
 * Normalize campaign name for matching
 * @param {string} name - Campaign name
 * @returns {string|null} - Normalized name or null
 */
function normalizeCampaignName(name) {
  if (!name) return null;
  const trimmed = name.trim();
  if (!trimmed) return null;

  return trimmed
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s.\-_/]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parse date string (YYYY-MM-DD)
 * @param {string} dateStr - Date string
 * @returns {string|null} - Parsed date or null
 */
function parseDate(dateStr) {
  if (!dateStr) return null;

  const trimmed = dateStr.trim();
  if (!trimmed) return null;

  // Validate format YYYY-MM-DD
  const dateMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!dateMatch) {
    return null;
  }

  const [, year, month, day] = dateMatch;
  const yearNum = parseInt(year, 10);
  const monthNum = parseInt(month, 10);
  const dayNum = parseInt(day, 10);

  // Basic validation
  if (yearNum < 2000 || yearNum > 2100) return null;
  if (monthNum < 1 || monthNum > 12) return null;
  if (dayNum < 1 || dayNum > 31) return null;

  // Validate actual date
  const date = new Date(yearNum, monthNum - 1, dayNum);
  if (
    date.getFullYear() !== yearNum ||
    date.getMonth() !== monthNum - 1 ||
    date.getDate() !== dayNum
  ) {
    return null;
  }

  return trimmed;
}

/**
 * Parse amount (number with optional decimal separator)
 * @param {string} amountStr - Amount string
 * @returns {number|null} - Parsed amount or null
 */
function parseAmount(amountStr) {
  if (!amountStr) return null;

  const cleaned = amountStr
    .replace(/["\s]/g, '')
    .replace(',', '.')
    .trim();

  if (!cleaned) return null;

  const value = parseFloat(cleaned);
  if (Number.isNaN(value) || value < 0) {
    return null;
  }

  return value;
}

/**
 * Find header row and extract column indices
 * @param {Array<string>} lines - CSV lines
 * @returns {Object|null} - Column indices or null
 */
function findHeaderIndices(lines) {
  const logger = require('../../utils/logger');
  
  for (let i = 0; i < Math.min(5, lines.length); i += 1) {
    const line = lines[i].trim();
    if (!line) continue;

    const columns = parseCsvLine(line);
    logger.debug('Facebook Ads CSV: Checking line for header', {
      lineIndex: i,
      line: line.substring(0, 100),
      columnsCount: columns.length,
      columns: columns
    });

    if (columns.length < 5) continue;

    // Check if this looks like a header row
    // Remove quotes and BOM from first column
    // Note: parseCsvLine already removes quotes, but BOM might remain
    const firstColRaw = columns[0] || '';
    const firstCol = firstColRaw
      .replace(/^\uFEFF/, '') // Remove BOM (must be first!)
      .replace(/^["']|["']$/g, '') // Remove quotes (in case they weren't removed)
      .toLowerCase()
      .trim();
    
    logger.debug('Facebook Ads CSV: First column processed', {
      original: firstColRaw,
      originalLength: firstColRaw.length,
      firstCharCode: firstColRaw.charCodeAt(0),
      hasBOM: firstColRaw.charCodeAt(0) === 0xFEFF,
      processed: firstCol
    });

    if (firstCol.includes('название') || firstCol.includes('campaign')) {
      // Find column indices
      const indices = {
        campaignName: -1,
        currency: -1,
        amount: -1,
        startDate: -1,
        endDate: -1
      };

      columns.forEach((col, idx) => {
        // Remove quotes, BOM, and normalize
        const colLower = col
          .replace(/^\uFEFF/, '') // Remove BOM
          .replace(/^["']|["']$/g, '') // Remove quotes
          .toLowerCase()
          .replace(/\s+/g, '') // Remove all spaces for matching
          .trim();
        
        logger.debug('Facebook Ads CSV: Checking column', {
          index: idx,
          original: col,
          normalized: colLower
        });

        if (colLower.includes('название') || colLower.includes('campaign')) {
          indices.campaignName = idx;
        } else if (colLower.includes('валюта') || colLower.includes('currency')) {
          indices.currency = idx;
        } else if (colLower.includes('сумма') || colLower.includes('amount') || colLower.includes('затрат')) {
          indices.amount = idx;
        } else if (colLower.includes('начало') || colLower.includes('start') || colLower.includes('датаначала')) {
          indices.startDate = idx;
        } else if (colLower.includes('окончание') || colLower.includes('end') || colLower.includes('конец') || colLower.includes('датаокончания')) {
          indices.endDate = idx;
        }
      });

      logger.debug('Facebook Ads CSV: Column indices found', {
        indices
      });

      // Check if all required columns found
      if (
        indices.campaignName >= 0 &&
        indices.currency >= 0 &&
        indices.amount >= 0 &&
        indices.startDate >= 0 &&
        indices.endDate >= 0
      ) {
        return { headerRowIndex: i, indices };
      }
    }
  }

  return null;
}

/**
 * Parse Facebook Ads CSV file
 * @param {string} csvContent - CSV file content
 * @returns {Object} - Parsed data with records and errors
 */
function parseFacebookAdsCsv(csvContent) {
  const logger = require('../../utils/logger');
  
  if (!csvContent || typeof csvContent !== 'string') {
    logger.warn('Facebook Ads CSV: Empty or invalid content');
    return {
      records: [],
      errors: [{ row: 0, message: 'CSV content is empty or invalid' }]
    };
  }

  logger.info('Facebook Ads CSV: Starting parse', {
    contentLength: csvContent.length,
    firstChars: csvContent.substring(0, 200)
  });

  const lines = csvContent
    .split(/\r?\n/)
    .map((line) => line.replace(/^\uFEFF/, '')) // Remove BOM
    .filter((line) => line.trim().length > 0);

  logger.info('Facebook Ads CSV: Lines extracted', {
    totalLines: lines.length,
    firstLines: lines.slice(0, 3)
  });

  if (lines.length === 0) {
    logger.warn('Facebook Ads CSV: No lines found after filtering');
    return {
      records: [],
      errors: [{ row: 0, message: 'CSV file is empty' }]
    };
  }

  // Find header row
  const headerInfo = findHeaderIndices(lines);
  if (!headerInfo) {
    logger.warn('Facebook Ads CSV: Header not found', {
      firstLines: lines.slice(0, 5)
    });
    return {
      records: [],
      errors: [{ row: 0, message: 'Could not find valid header row with required columns' }]
    };
  }

  logger.info('Facebook Ads CSV: Header found', {
    headerRowIndex: headerInfo.headerRowIndex,
    indices: headerInfo.indices
  });

  const { headerRowIndex, indices } = headerInfo;
  const records = [];
  const errors = [];

  logger.info('Facebook Ads CSV: Processing data rows', {
    headerRowIndex,
    totalLines: lines.length,
    dataRowsStart: headerRowIndex + 1,
    indices
  });

  // Process data rows (skip header)
  for (let i = headerRowIndex + 1; i < lines.length; i += 1) {
    const line = lines[i];
    const rowNumber = i + 1; // 1-based row number

    try {
      const columns = parseCsvLine(line);

      if (columns.length < 5) {
        logger.debug('Facebook Ads CSV: Row with insufficient columns', {
          row: rowNumber,
          columnsCount: columns.length,
          columns
        });
        errors.push({
          row: rowNumber,
          message: `Insufficient columns (expected 5, got ${columns.length})`
        });
        continue;
      }

      // Extract fields
      const campaignNameRaw = (columns[indices.campaignName] || '').trim();
      const currency = (columns[indices.currency] || '').trim().toUpperCase();
      const amountStr = columns[indices.amount] || '';
      const startDateStr = (columns[indices.startDate] || '').trim();
      const endDateStr = (columns[indices.endDate] || '').trim();

      // Validate campaign name - allow empty but log it
      if (!campaignNameRaw) {
        logger.debug('Facebook Ads CSV: Empty campaign name in row', { row: rowNumber });
        errors.push({
          row: rowNumber,
          message: 'Campaign name is empty - skipping row'
        });
        continue;
      }

      // Remove quotes from campaign name
      const campaignName = campaignNameRaw.replace(/^"|"$/g, '').trim();
      if (!campaignName) {
        errors.push({
          row: rowNumber,
          message: 'Campaign name is empty after removing quotes'
        });
        continue;
      }

      // Normalize campaign name
      const campaignNameNormalized = normalizeCampaignName(campaignName);
      if (!campaignNameNormalized) {
        errors.push({
          row: rowNumber,
          message: 'Failed to normalize campaign name'
        });
        continue;
      }

      // Parse amount
      const amountPln = parseAmount(amountStr);
      if (amountPln === null) {
        errors.push({
          row: rowNumber,
          message: `Invalid amount: ${amountStr}`
        });
        continue;
      }

      // Parse dates
      const reportStartDate = parseDate(startDateStr);
      if (!reportStartDate) {
        errors.push({
          row: rowNumber,
          message: `Invalid start date format: ${startDateStr} (expected YYYY-MM-DD)`
        });
        continue;
      }

      const reportEndDate = parseDate(endDateStr);
      if (!reportEndDate) {
        errors.push({
          row: rowNumber,
          message: `Invalid end date format: ${endDateStr} (expected YYYY-MM-DD)`
        });
        continue;
      }

      // Validate date range
      if (reportStartDate > reportEndDate) {
        errors.push({
          row: rowNumber,
          message: `Start date (${reportStartDate}) is after end date (${reportEndDate})`
        });
        continue;
      }

      // Create record
      records.push({
        campaignName,
        campaignNameNormalized,
        currency: currency || 'PLN',
        amountPln,
        reportStartDate,
        reportEndDate,
        rawLine: line,
        rowNumber
      });
    } catch (error) {
      errors.push({
        row: rowNumber,
        message: `Parse error: ${error.message}`
      });
      logger.warn('Error parsing CSV row', {
        row: rowNumber,
        line,
        error: error.message
      });
    }
  }

  // Handle duplicate campaign names with same period - sum amounts
  const recordMap = new Map();
  records.forEach((record) => {
    const key = `${record.campaignNameNormalized}|${record.reportStartDate}|${record.reportEndDate}`;
    if (recordMap.has(key)) {
      // Sum amounts for duplicates
      const existing = recordMap.get(key);
      existing.amountPln += record.amountPln;
      // Keep the first campaign name (original)
    } else {
      recordMap.set(key, { ...record });
    }
  });

  const deduplicatedRecords = Array.from(recordMap.values());

  logger.info('Facebook Ads CSV: Parse completed', {
    totalRows: lines.length - headerRowIndex - 1,
    validRecords: deduplicatedRecords.length,
    errorsCount: errors.length,
    errors: errors.slice(0, 5) // First 5 errors for debugging
  });

  return {
    records: deduplicatedRecords,
    errors,
    totalRows: lines.length - headerRowIndex - 1,
    processedRows: deduplicatedRecords.length
  };
}

module.exports = {
  parseFacebookAdsCsv,
  normalizeCampaignName,
  parseDate,
  parseAmount
};

