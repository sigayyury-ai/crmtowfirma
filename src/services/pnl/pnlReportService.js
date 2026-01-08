const supabase = require('../supabaseClient');
const logger = require('../../utils/logger');
const StripeRepository = require('../stripe/repository');
const PnlRepository = require('./pnlRepository');
const IncomeCategoryService = require('./incomeCategoryService');
const ExpenseCategoryService = require('./expenseCategoryService');
const ManualEntryService = require('./manualEntryService');
const exchangeRateService = require('../stripe/exchangeRateService');

/**
 * Helper function to convert value to number
 */
function toNumber(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = parseFloat(value.replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Helper function to parse date value
 */
function parseDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  return null;
}

/**
 * Convert amount to PLN using exchange rate
 * @param {number|string} amount - Amount to convert
 * @param {string} currency - Currency code (default: PLN)
 * @param {number|string} exchangeRate - Exchange rate to PLN
 * @returns {number|null} Amount in PLN or null if conversion not possible
 */
function convertToPln(amount, currency, exchangeRate) {
  const numericAmount = toNumber(amount) ?? 0;
  const normalizedCurrency = (currency || 'PLN').toUpperCase();
  const numericRate = toNumber(exchangeRate);

  if (normalizedCurrency === 'PLN') {
    return numericAmount;
  }

  if (numericRate && numericRate > 0) {
    return numericAmount * numericRate;
  }

  return null;
}

/**
 * Extract month number (1-12) from date
 * Uses UTC to ensure consistent month extraction regardless of server timezone
 * @param {Date|string|number} date - Date value
 * @returns {number|null} Month number (1-12) or null if invalid
 */
function extractMonthFromDate(date) {
  const parsedDate = parseDate(date);
  if (!parsedDate) return null;
  // Use getUTCMonth() instead of getMonth() to ensure consistent month extraction
  // since dates in database are stored in UTC and year filtering uses UTC
  return parsedDate.getUTCMonth() + 1; // getUTCMonth() returns 0-11, we need 1-12
}

/**
 * Check if payment is refunded
 * @param {Object} payment - Payment object
 * @param {Set<string>} refundedPaymentIds - Set of refunded payment IDs
 * @returns {boolean} True if payment is refunded
 */
function isPaymentRefunded(payment, refundedPaymentIds) {
  if (!payment) return false;
  
  // Check Stripe payment status
  if (payment.source === 'stripe' && payment.stripe_payment_status === 'refunded') {
    return true;
  }
  
  // Check if payment ID is in refunded set
  if (payment.id && refundedPaymentIds.has(String(payment.id))) {
    return true;
  }
  
  // Check Stripe session ID
  if (payment.stripe_session_id && refundedPaymentIds.has(String(payment.stripe_session_id))) {
    return true;
  }
  
  return false;
}

class PnlReportService {
  constructor() {
    if (!supabase) {
      logger.warn('Supabase client is not configured. PNL report will be unavailable.');
    }
    this.supabase = supabase;
    this.stripeRepository = new StripeRepository();
    this.pnlRepository = new PnlRepository();
    this.incomeCategoryService = new IncomeCategoryService();
    this.expenseCategoryService = new ExpenseCategoryService();
    this.manualEntryService = new ManualEntryService();
  }

  /**
   * Filter processed payments (approved or matched)
   * Also includes refunds (payments with income_category_id = "Возвраты") regardless of match status
   * @param {Array} payments - Array of payment objects
   * @param {Map} categoriesMap - Map of income categories (categoryId -> category)
   * @returns {Array} Filtered payments
   */
  filterProcessedPayments(payments, categoriesMap = null) {
    if (!Array.isArray(payments)) return [];
    
    // Get "Возвраты" category ID if categoriesMap is provided
    let refundsCategoryId = null;
    if (categoriesMap) {
      for (const [id, category] of categoriesMap.entries()) {
        if (category && category.name === 'Возвраты') {
          refundsCategoryId = id;
          break;
        }
      }
    }
    
    return payments.filter((payment) => {
      // Always include refunds (payments with income_category_id = "Возвраты")
      // Refunds are marked as unmatched but should still appear in PNL report
      if (refundsCategoryId !== null && payment.income_category_id === refundsCategoryId) {
        return true;
      }
      
      // Bank payments: must be approved or matched
      if (payment.source === 'bank' || !payment.source) {
        return payment.manual_status === 'approved' || payment.match_status === 'matched';
      }
      
      // Stripe payments: must be paid
      if (payment.source === 'stripe') {
        return payment.stripe_payment_status === 'paid';
      }
      
      return false;
    });
  }

  /**
   * Get monthly revenue for a specific year
   * 
   * Aggregates processed payments (approved/matched bank payments and paid Stripe payments)
   * by month, excluding refunded payments. Converts all amounts to PLN.
   * 
   * @param {number} year - Year (required, validated 2020-2030)
   * @param {boolean} [includeBreakdown=false] - Include currency breakdown in response
   * @returns {Promise<Object>} Monthly revenue data with structure:
   *   {
   *     year: number,
   *     monthly: Array<{month: number, amountPln: number, paymentCount: number, currencyBreakdown?: Object}>,
   *     total: {amountPln: number, paymentCount: number, currencyBreakdown?: Object}
   *   }
   * @throws {Error} If Supabase is not configured or year is invalid
   */
  async getMonthlyRevenue(year, includeBreakdown = false) {
    if (!this.supabase) {
      throw new Error('Supabase client is not configured');
    }

    // Validate year parameter
    if (!Number.isFinite(year) || year < 2020 || year > 2030) {
      throw new Error('Year must be a number between 2020 and 2030');
    }
    
    // Validate includeBreakdown parameter
    if (typeof includeBreakdown !== 'boolean') {
      includeBreakdown = includeBreakdown === 'true' || includeBreakdown === '1' || includeBreakdown === 1;
    }

    const targetYear = year;
    const yearStart = new Date(Date.UTC(targetYear, 0, 1));
    const yearEnd = new Date(Date.UTC(targetYear, 11, 31, 23, 59, 59, 999));

    logger.info('Fetching monthly revenue', { year: targetYear });

    try {
      // Load bank payments
      const bankPaymentsQuery = this.supabase
        .from('payments')
        .select(`
          id,
          operation_date,
          amount,
          currency,
          manual_status,
          match_status,
          proforma_id,
          income_category_id
        `)
        .eq('direction', 'in')
        .gte('operation_date', yearStart.toISOString())
        .lte('operation_date', yearEnd.toISOString())
        .order('operation_date', { ascending: false });

      const { data: bankPaymentsData, error: bankError } = await bankPaymentsQuery.limit(10000);

      if (bankError) {
        logger.error('Supabase error while fetching bank payments:', bankError);
        throw new Error('Не удалось получить банковские платежи из базы');
      }

      const bankPayments = Array.isArray(bankPaymentsData) ? bankPaymentsData : [];

      // Load proformas to get exchange rates for currency conversion
      const proformaIds = [...new Set(bankPayments.map(p => p.proforma_id).filter(Boolean))];
      const proformaMap = new Map();
      
      if (proformaIds.length > 0) {
        try {
          const { data: proformasData, error: proformaError } = await this.supabase
            .from('proformas')
            .select('id, currency, currency_exchange, payments_total_pln')
            .in('id', proformaIds);

          if (!proformaError && Array.isArray(proformasData)) {
            proformasData.forEach((proforma) => {
              if (proforma.id) {
                proformaMap.set(String(proforma.id), proforma);
              }
            });
          }
        } catch (proformaErr) {
          logger.warn('Failed to load proformas for exchange rates', { error: proformaErr.message });
        }
      }

      // Load income categories
      let categoriesMap = new Map();
      try {
        const categories = await this.incomeCategoryService.listCategories();
        categories.forEach(cat => {
          categoriesMap.set(cat.id, cat);
        });
        // Add virtual "Uncategorized" category
        categoriesMap.set(null, { id: null, name: 'Без категории', display_order: 999999, management_type: 'auto' });
      } catch (catError) {
        logger.warn('Failed to load income categories', { error: catError.message });
      }

      // Load manual entries for ALL categories (both auto and manual)
      // For auto categories, manual entries will be added to automatic payments
      // For manual categories, only manual entries will be used
      const allCategories = Array.from(categoriesMap.values())
        .filter(cat => cat.id !== null)
        .map(cat => cat.id);
      
      let manualEntriesMap = new Map();
      if (allCategories.length > 0) {
        try {
          manualEntriesMap = await this.manualEntryService.getEntriesByCategoriesAndYear(allCategories, targetYear);
        } catch (manualError) {
          logger.warn('Failed to load manual entries', { error: manualError.message });
        }
      }

      // Load Stripe payments
      let stripePayments = [];
      let refundedPaymentIds = new Set();
      
      if (this.stripeRepository.isEnabled()) {
        try {
          // Get Stripe payments (no status filter - we'll filter by payment_status='paid' later)
          const stripeData = await this.stripeRepository.listPayments({
            dateFrom: yearStart.toISOString(),
            dateTo: yearEnd.toISOString()
          });

          // Get refunded payments
          const refunds = await this.stripeRepository.listDeletions({
            dateFrom: yearStart.toISOString(),
            dateTo: yearEnd.toISOString(),
            reason: 'deal_lost'
          });
          refunds.forEach((refund) => {
            if (refund.payment_id) {
              refundedPaymentIds.add(String(refund.payment_id));
            }
          });

          const stripeRefunds = await this.stripeRepository.listDeletions({
            dateFrom: yearStart.toISOString(),
            dateTo: yearEnd.toISOString(),
            reason: 'stripe_refund'
          });
          stripeRefunds.forEach((refund) => {
            if (refund.payment_id) {
              refundedPaymentIds.add(String(refund.payment_id));
            }
          });

          // Convert Stripe payments to format
          stripePayments = (stripeData || [])
            .filter((sp) => {
              // Only include paid payments
              if (sp.payment_status !== 'paid') {
                return false;
              }
              // Exclude refunded payments
              if (sp.session_id && refundedPaymentIds.has(String(sp.session_id))) {
                return false;
              }
              
              // IMPORTANT: Filter by created_at (actual payment date) not processed_at (sync date)
              // processed_at is when the payment was synced to database, not when it was paid
              // We need to ensure the payment date (created_at) falls within the target year
              const paymentDate = sp.created_at || null;
              if (!paymentDate) {
                return false; // Skip payments without payment date
              }
              
              const paymentDateObj = new Date(paymentDate);
              const paymentYear = paymentDateObj.getUTCFullYear();
              const paymentMonth = paymentDateObj.getUTCMonth() + 1;
              
              // Only include payments where the actual payment date (created_at) is in the target year
              if (paymentYear !== targetYear) {
                logger.debug('Excluding Stripe payment: payment date year does not match target year', {
                  sessionId: sp.session_id,
                  paymentDate: paymentDate,
                  paymentYear: paymentYear,
                  targetYear: targetYear,
                  processedAt: sp.processed_at
                });
                return false;
              }
              
              // Include all paid payments (including event payments without deal_id)
              // They will be categorized by income_category_id
              return true;
            })
            .map((sp) => {
              // Use created_at (payment date) instead of processed_at (sync date) for PNL reporting
              // processed_at is when the payment was synced to database, not when it was paid
              const paymentDate = sp.created_at || null;
              return {
                id: `stripe_${sp.session_id || sp.id}`,
                operation_date: paymentDate,
                amount: sp.original_amount !== null && sp.original_amount !== undefined
                  ? sp.original_amount
                  : (sp.amount_pln || 0),
                currency: sp.currency || 'PLN',
                manual_status: 'approved',
                match_status: 'matched',
                source: 'stripe',
                stripe_payment_status: sp.payment_status || null,
                stripe_amount_pln: sp.amount_pln || null,
                stripe_session_id: sp.session_id,
                income_category_id: sp.income_category_id || null
              };
            });
        } catch (stripeError) {
          logger.warn('Failed to load Stripe payments', { error: stripeError.message });
        }
      }

      // Combine all payments
      const allPayments = [...bankPayments, ...stripePayments];

      // Filter processed payments (pass categoriesMap to include refunds)
      const processedPayments = this.filterProcessedPayments(allPayments, categoriesMap);

      // Filter out refunded payments
      const nonRefundedPayments = processedPayments.filter((payment) => {
        return !isPaymentRefunded(payment, refundedPaymentIds);
      });

      logger.info('Payment filtering complete', {
        total: allPayments.length,
        processed: processedPayments.length,
        nonRefunded: nonRefundedPayments.length
      });

      // Aggregate by category and month
      const categoryMonthlyData = {}; // { categoryId: { month: { amountPln, paymentCount, currencyBreakdown } } }

      // Process automatic payments for ALL categories
      // For auto categories: payments are the primary source
      // For manual categories: payments are added to manual entries
      nonRefundedPayments.forEach((payment) => {
        const categoryId = payment.income_category_id || null;
        const category = categoriesMap.get(categoryId);
        
        // Process payments for all categories (both auto and manual)
        // Manual entries will be added later and summed with payments

        const month = extractMonthFromDate(payment.operation_date);
        if (!month || month < 1 || month > 12) {
          logger.warn('Invalid month extracted from payment date', {
            paymentId: payment.id,
            date: payment.operation_date
          });
          return;
        }

        const currency = (payment.currency || 'PLN').toUpperCase();
        const originalAmount = toNumber(payment.amount) || 0;

        // Get amount in PLN
        let amountPln = null;
        if (payment.source === 'stripe' && payment.stripe_amount_pln !== null && payment.stripe_amount_pln !== undefined) {
          amountPln = toNumber(payment.stripe_amount_pln);
        } else {
          // For bank payments, try to get PLN amount from proforma first
          const proformaId = payment.proforma_id;
          if (proformaId && proformaMap.has(String(proformaId))) {
            const proforma = proformaMap.get(String(proformaId));
            // Use payments_total_pln from proforma if available
            if (proforma.payments_total_pln !== null && proforma.payments_total_pln !== undefined) {
              amountPln = toNumber(proforma.payments_total_pln);
            } else {
              // Convert using exchange rate from proforma
              amountPln = convertToPln(payment.amount, payment.currency, proforma.currency_exchange);
            }
          } else {
            // No proforma linked, convert using currency
            if (currency === 'PLN') {
              amountPln = toNumber(payment.amount);
            } else {
              // For non-PLN without proforma, we can't convert accurately
              // Skip this payment for now (or use a default rate if needed)
              amountPln = null;
            }
          }
        }

        if (Number.isFinite(amountPln) && amountPln > 0) {
          // Initialize category data if needed
          if (!categoryMonthlyData[categoryId]) {
            categoryMonthlyData[categoryId] = {};
            for (let m = 1; m <= 12; m++) {
              categoryMonthlyData[categoryId][m] = {
                amountPln: 0,
                paymentCount: 0,
                currencyBreakdown: {}
              };
            }
          }

          // Add to category/month
          categoryMonthlyData[categoryId][month].amountPln += amountPln;
          categoryMonthlyData[categoryId][month].paymentCount += 1;
          
          // Track original currency amounts for breakdown
          if (includeBreakdown && originalAmount > 0) {
            if (!categoryMonthlyData[categoryId][month].currencyBreakdown[currency]) {
              categoryMonthlyData[categoryId][month].currencyBreakdown[currency] = 0;
            }
            categoryMonthlyData[categoryId][month].currencyBreakdown[currency] += originalAmount;
          }
        }
      });

      // Process manual entries for ALL categories
      // For auto categories: manual entries are added to automatic payments
      // For manual categories: manual entries replace automatic payments (which were skipped above)
      manualEntriesMap.forEach((monthEntries, categoryId) => {
        const category = categoriesMap.get(categoryId);
        const isManualCategory = category && category.management_type === 'manual';
        
        // Initialize category data if needed
        if (!categoryMonthlyData[categoryId]) {
          categoryMonthlyData[categoryId] = {};
          for (let m = 1; m <= 12; m++) {
            categoryMonthlyData[categoryId][m] = {
              amountPln: 0,
              paymentCount: 0,
              currencyBreakdown: {}
            };
          }
        }

        // Add manual entries to category/month
        // For auto categories: this adds to existing payment data
        // For manual categories: this is the only data (payments were skipped)
        monthEntries.forEach((entry, month) => {
          const amountPln = toNumber(entry.amount_pln) || 0;
          if (amountPln !== 0) { // Allow negative values for refunds
            categoryMonthlyData[categoryId][month].amountPln += amountPln;
            if (!isManualCategory) {
              // For auto categories, count manual entries separately
              categoryMonthlyData[categoryId][month].paymentCount += 1;
            } else {
              // For manual categories, manual entries are the primary source
              categoryMonthlyData[categoryId][month].paymentCount += 1;
            } // Count as 1 entry

            // Add currency breakdown if available
            if (includeBreakdown && entry.currency_breakdown && typeof entry.currency_breakdown === 'object') {
              Object.keys(entry.currency_breakdown).forEach((curr) => {
                const currAmount = toNumber(entry.currency_breakdown[curr]) || 0;
                if (currAmount > 0) {
                  if (!categoryMonthlyData[categoryId][month].currencyBreakdown[curr]) {
                    categoryMonthlyData[categoryId][month].currencyBreakdown[curr] = 0;
                  }
                  categoryMonthlyData[categoryId][month].currencyBreakdown[curr] += currAmount;
                }
              });
            }
          }
        });
      });

      // Build categories array with monthly data
      const categoriesList = Array.from(categoriesMap.values())
        .sort((a, b) => {
          const orderA = a.display_order !== undefined ? a.display_order : 999999;
          const orderB = b.display_order !== undefined ? b.display_order : 999999;
          if (orderA !== orderB) return orderA - orderB;
          return (a.name || '').localeCompare(b.name || '');
        });

      const categories = categoriesList.map(category => {
        const catId = category.id;
        const monthly = [];
        let categoryTotal = 0;
        let categoryPaymentCount = 0;
        const categoryCurrencyBreakdown = {};

        for (let month = 1; month <= 12; month++) {
          const monthData = categoryMonthlyData[catId]?.[month] || {
            amountPln: 0,
            paymentCount: 0,
            currencyBreakdown: {}
          };

          const monthEntry = {
            month,
            amountPln: Math.round(monthData.amountPln * 100) / 100,
            paymentCount: monthData.paymentCount
          };

          if (includeBreakdown && Object.keys(monthData.currencyBreakdown).length > 0) {
            monthEntry.currencyBreakdown = {};
            Object.keys(monthData.currencyBreakdown).forEach((curr) => {
              monthEntry.currencyBreakdown[curr] = Math.round(monthData.currencyBreakdown[curr] * 100) / 100;
            });
          }

          monthly.push(monthEntry);
          categoryTotal += monthData.amountPln;
          categoryPaymentCount += monthData.paymentCount;

          // Aggregate currency breakdown
          if (includeBreakdown && monthData.currencyBreakdown) {
            Object.keys(monthData.currencyBreakdown).forEach((curr) => {
              if (!categoryCurrencyBreakdown[curr]) {
                categoryCurrencyBreakdown[curr] = 0;
              }
              categoryCurrencyBreakdown[curr] += monthData.currencyBreakdown[curr];
            });
          }
        }

        const categoryResult = {
          id: catId,
          name: category.name,
          management_type: category.management_type || 'auto',
          monthly,
          total: {
            amountPln: Math.round(categoryTotal * 100) / 100,
            paymentCount: categoryPaymentCount
          }
        };

        if (includeBreakdown && Object.keys(categoryCurrencyBreakdown).length > 0) {
          Object.keys(categoryCurrencyBreakdown).forEach((curr) => {
            categoryCurrencyBreakdown[curr] = Math.round(categoryCurrencyBreakdown[curr] * 100) / 100;
          });
          categoryResult.total.currencyBreakdown = categoryCurrencyBreakdown;
        }

        return categoryResult;
      });

      // Calculate overall totals
      const totalRevenue = categories.reduce((sum, cat) => sum + cat.total.amountPln, 0);
      const totalPaymentCount = categories.reduce((sum, cat) => sum + cat.total.paymentCount, 0);
      
      // Aggregate overall monthly data (sum across all categories)
      const monthlyData = {};
      for (let month = 1; month <= 12; month++) {
        monthlyData[month] = {
          month,
          amountPln: 0,
          paymentCount: 0,
          currencyBreakdown: {}
        };
      }

      categories.forEach(category => {
        category.monthly.forEach(monthEntry => {
          monthlyData[monthEntry.month].amountPln += monthEntry.amountPln;
          monthlyData[monthEntry.month].paymentCount += monthEntry.paymentCount;
          
          if (includeBreakdown && monthEntry.currencyBreakdown) {
            Object.keys(monthEntry.currencyBreakdown).forEach((curr) => {
              if (!monthlyData[monthEntry.month].currencyBreakdown[curr]) {
                monthlyData[monthEntry.month].currencyBreakdown[curr] = 0;
              }
              monthlyData[monthEntry.month].currencyBreakdown[curr] += monthEntry.currencyBreakdown[curr];
            });
          }
        });
      });

      // Round monthly breakdown
      Object.values(monthlyData).forEach(entry => {
        if (includeBreakdown && entry.currencyBreakdown) {
          Object.keys(entry.currencyBreakdown).forEach((curr) => {
            entry.currencyBreakdown[curr] = Math.round(entry.currencyBreakdown[curr] * 100) / 100;
          });
        }
      });

      const monthlyArray = Object.values(monthlyData);

      logger.info('Monthly revenue aggregation complete', {
        year: targetYear,
        totalRevenue,
        totalPaymentCount,
        categoriesCount: categories.length
      });

      const response = {
        year: targetYear,
        monthly: monthlyArray,
        categories: categories,
        total: {
          amountPln: Math.round(totalRevenue * 100) / 100,
          paymentCount: totalPaymentCount
        }
      };

      // Add total currency breakdown if requested
      if (includeBreakdown) {
        const totalBreakdown = {};
        monthlyArray.forEach((entry) => {
          if (entry.currencyBreakdown) {
            Object.keys(entry.currencyBreakdown).forEach((curr) => {
              if (!totalBreakdown[curr]) {
                totalBreakdown[curr] = 0;
              }
              totalBreakdown[curr] += entry.currencyBreakdown[curr];
            });
          }
        });
        
        // Round breakdown totals
        Object.keys(totalBreakdown).forEach((curr) => {
          totalBreakdown[curr] = Math.round(totalBreakdown[curr] * 100) / 100;
        });
        
        response.total.currencyBreakdown = totalBreakdown;
      }

      // Load expense categories and expenses
      let expenseCategoriesMap = new Map();
      let expenseCategories = [];
      let expenseMonthlyData = {}; // { categoryId: { month: { amountPln, paymentCount, currencyBreakdown } } }
      
      try {
        expenseCategories = await this.expenseCategoryService.listCategories();
        expenseCategories.forEach(cat => {
          expenseCategoriesMap.set(cat.id, cat);
        });
        // Add virtual "Uncategorized" category for expenses
        expenseCategoriesMap.set(null, { id: null, name: 'Без категории', display_order: 999999, management_type: 'auto' });
      } catch (expenseCatError) {
        logger.warn('Failed to load expense categories', { error: expenseCatError.message });
      }

      // Load expense payments (direction = 'out')
      const expensePaymentsQuery = this.supabase
        .from('payments')
        .select(`
          id,
          operation_date,
          amount,
          currency,
          expense_category_id
        `)
        .eq('direction', 'out')
        .gte('operation_date', yearStart.toISOString())
        .lte('operation_date', yearEnd.toISOString())
        .order('operation_date', { ascending: false });

      const { data: expensePaymentsData, error: expenseError } = await expensePaymentsQuery.limit(10000);

      if (expenseError) {
        logger.warn('Failed to load expense payments', { error: expenseError.message });
      } else {
        const expensePayments = Array.isArray(expensePaymentsData) ? expensePaymentsData : [];

        // Process all expense payments (including both auto and manual categories)
        // Show ALL payments with direction='out' in PNL report
        for (const payment of expensePayments) {
          const categoryId = payment.expense_category_id || null;
          const category = expenseCategoriesMap.get(categoryId);

          const month = extractMonthFromDate(payment.operation_date);
          if (!month || month < 1 || month > 12) {
            logger.debug('Skipping expense payment: invalid month', {
              paymentId: payment.id,
              operationDate: payment.operation_date,
              categoryId: categoryId
            });
            continue;
          }

          const currency = (payment.currency || 'PLN').toUpperCase();
          const originalAmount = toNumber(payment.amount) || 0;
          
          // For expenses, amount is negative, but we store it as positive in database
          // Convert to PLN (assume PLN if no currency specified)
          let amountPln = null;
          if (currency === 'PLN') {
            amountPln = Math.abs(toNumber(payment.amount) || 0);
          } else {
            // For non-PLN expenses, fetch exchange rate and convert
            try {
              const exchangeRate = await exchangeRateService.getRate(currency, 'PLN');
              if (exchangeRate && exchangeRate > 0) {
                amountPln = Math.abs(originalAmount) * exchangeRate;
              } else {
                logger.warn('Invalid exchange rate for expense payment', {
                  paymentId: payment.id,
                  currency: currency,
                  exchangeRate: exchangeRate
                });
                amountPln = null;
              }
            } catch (error) {
              logger.warn('Failed to fetch exchange rate for expense payment', {
                paymentId: payment.id,
                currency: currency,
                error: error.message
              });
              amountPln = null;
            }
          }

          if (Number.isFinite(amountPln) && amountPln > 0) {
            // Initialize category data if needed
            if (!expenseMonthlyData[categoryId]) {
              expenseMonthlyData[categoryId] = {};
              for (let m = 1; m <= 12; m++) {
                expenseMonthlyData[categoryId][m] = {
                  amountPln: 0,
                  paymentCount: 0,
                  currencyBreakdown: {}
                };
              }
            }

            // Add to category/month
            expenseMonthlyData[categoryId][month].amountPln += amountPln;
            expenseMonthlyData[categoryId][month].paymentCount += 1;
            
            logger.debug('Added expense payment to PNL report', {
              paymentId: payment.id,
              categoryId: categoryId,
              month: month,
              amountPln: amountPln,
              currency: currency
            });
            
            // Track original currency amounts for breakdown
            if (includeBreakdown && originalAmount > 0) {
              if (!expenseMonthlyData[categoryId][month].currencyBreakdown[currency]) {
                expenseMonthlyData[categoryId][month].currencyBreakdown[currency] = 0;
              }
              expenseMonthlyData[categoryId][month].currencyBreakdown[currency] += Math.abs(originalAmount);
            }
          }
        }
      }

      // Load manual entries for ALL expense categories (both auto and manual)
      // For auto categories, manual entries will be added to automatic payments
      // For manual categories, only manual entries will be used
      const allExpenseCategories = Array.from(expenseCategoriesMap.values())
        .filter(cat => cat.id !== null)
        .map(cat => cat.id);
      
      let manualExpenseEntriesMap = new Map();
      if (allExpenseCategories.length > 0) {
        try {
          manualExpenseEntriesMap = await this.manualEntryService.getEntriesByCategoriesAndYear(allExpenseCategories, targetYear, 'expense');
        } catch (manualError) {
          logger.warn('Failed to load manual expense entries', { error: manualError.message });
        }
      }

      // Process manual entries for expense categories
      manualExpenseEntriesMap.forEach((monthEntries, categoryId) => {
        // Initialize category data if needed
        if (!expenseMonthlyData[categoryId]) {
          expenseMonthlyData[categoryId] = {};
          for (let m = 1; m <= 12; m++) {
            expenseMonthlyData[categoryId][m] = {
              amountPln: 0,
              paymentCount: 0,
              currencyBreakdown: {}
            };
          }
        }

        // Add manual entries to category/month
        monthEntries.forEach((entry, month) => {
          const amountPln = toNumber(entry.amount_pln) || 0;
          if (amountPln > 0) {
            expenseMonthlyData[categoryId][month].amountPln += amountPln;
            expenseMonthlyData[categoryId][month].paymentCount += 1;

            // Add currency breakdown if available
            if (includeBreakdown && entry.currency_breakdown && typeof entry.currency_breakdown === 'object') {
              Object.keys(entry.currency_breakdown).forEach((curr) => {
                const currAmount = toNumber(entry.currency_breakdown[curr]) || 0;
                if (currAmount > 0) {
                  if (!expenseMonthlyData[categoryId][month].currencyBreakdown[curr]) {
                    expenseMonthlyData[categoryId][month].currencyBreakdown[curr] = 0;
                  }
                  expenseMonthlyData[categoryId][month].currencyBreakdown[curr] += currAmount;
                }
              });
            }
          }
        });
      });

      // Build expense categories array with monthly data
      const expenseCategoriesList = Array.from(expenseCategoriesMap.values())
        .sort((a, b) => {
          const orderA = a.display_order !== undefined ? a.display_order : 999999;
          const orderB = b.display_order !== undefined ? b.display_order : 999999;
          if (orderA !== orderB) return orderA - orderB;
          return (a.name || '').localeCompare(b.name || '');
        });

      const expenses = expenseCategoriesList.map(category => {
        const catId = category.id;
        const monthly = [];
        let categoryTotal = 0;
        let categoryPaymentCount = 0;
        const categoryCurrencyBreakdown = {};

        for (let month = 1; month <= 12; month++) {
          const monthData = expenseMonthlyData[catId]?.[month] || {
            amountPln: 0,
            paymentCount: 0,
            currencyBreakdown: {}
          };

          const monthEntry = {
            month,
            amountPln: Math.round(monthData.amountPln * 100) / 100,
            paymentCount: monthData.paymentCount
          };

          if (includeBreakdown && Object.keys(monthData.currencyBreakdown).length > 0) {
            monthEntry.currencyBreakdown = {};
            Object.keys(monthData.currencyBreakdown).forEach((curr) => {
              monthEntry.currencyBreakdown[curr] = Math.round(monthData.currencyBreakdown[curr] * 100) / 100;
            });
          }

          monthly.push(monthEntry);
          categoryTotal += monthData.amountPln;
          categoryPaymentCount += monthData.paymentCount;

          // Aggregate currency breakdown
          if (includeBreakdown && monthData.currencyBreakdown) {
            Object.keys(monthData.currencyBreakdown).forEach((curr) => {
              if (!categoryCurrencyBreakdown[curr]) {
                categoryCurrencyBreakdown[curr] = 0;
              }
              categoryCurrencyBreakdown[curr] += monthData.currencyBreakdown[curr];
            });
          }
        }

        const categoryResult = {
          id: catId,
          name: category.name,
          management_type: category.management_type || 'auto',
          monthly,
          total: {
            amountPln: Math.round(categoryTotal * 100) / 100,
            paymentCount: categoryPaymentCount
          }
        };

        if (includeBreakdown && Object.keys(categoryCurrencyBreakdown).length > 0) {
          Object.keys(categoryCurrencyBreakdown).forEach((curr) => {
            categoryCurrencyBreakdown[curr] = Math.round(categoryCurrencyBreakdown[curr] * 100) / 100;
          });
          categoryResult.total.currencyBreakdown = categoryCurrencyBreakdown;
        }

        return categoryResult;
      });

      // Calculate expense totals
      const totalExpenses = expenses.reduce((sum, cat) => sum + cat.total.amountPln, 0);
      const totalExpensePaymentCount = expenses.reduce((sum, cat) => sum + cat.total.paymentCount, 0);

      // Add expenses to response
      response.expenses = expenses;
      response.expensesTotal = {
        amountPln: Math.round(totalExpenses * 100) / 100,
        paymentCount: totalExpensePaymentCount
      };

      // Calculate profit/loss (Доход / Убыток) for each month
      // Profit/Loss = Revenue - Expenses for each month
      const profitLossMonthly = [];
      for (let month = 1; month <= 12; month++) {
        // Get revenue for this month
        const monthRevenueEntry = monthlyArray.find(m => m.month === month);
        const monthRevenue = monthRevenueEntry?.amountPln || 0;

        // Get expenses for this month
        const monthExpenseTotal = expenses.reduce((sum, cat) => {
          const monthEntry = cat.monthly?.find(m => m.month === month);
          return sum + (monthEntry?.amountPln || 0);
        }, 0);

        // Calculate profit/loss
        const profitLoss = monthRevenue - monthExpenseTotal;

        profitLossMonthly.push({
          month,
          amountPln: Math.round(profitLoss * 100) / 100
        });
      }

      // Calculate total profit/loss for the year
      const totalProfitLoss = totalRevenue - totalExpenses;

      // Add profit/loss to response
      response.profitLoss = {
        monthly: profitLossMonthly,
        total: {
          amountPln: Math.round(totalProfitLoss * 100) / 100
        }
      };

      // Calculate balance (Баланс) - cumulative running total
      // Balance for month N = Balance for month (N-1) + Profit/Loss for month N
      // Start from 0 at the beginning of the year
      // 
      // Example:
      //   January: profitLoss = +1000 → balance = 0 + 1000 = 1000
      //   February: profitLoss = -500 → balance = 1000 + (-500) = 500
      //   March: profitLoss = -200 → balance = 500 + (-200) = 300
      // 
      // If profitLoss is negative (loss), it correctly subtracts from balance:
      //   runningBalance += (-500) is equivalent to runningBalance -= 500
      const balanceMonthly = [];
      let runningBalance = 0; // Start from 0 at the beginning of the year

      // Find the first month with data (to avoid starting balance from 0 when there's no data)
      const firstMonthWithData = profitLossMonthly.find(p => p.amountPln !== 0)?.month || 1;

      for (let month = 1; month <= 12; month++) {
        const profitLossEntry = profitLossMonthly.find(p => p.month === month);
        const profitLossAmount = profitLossEntry?.amountPln || 0;

        // Only add to balance if we have data for this month or if it's after the first month with data
        // This ensures that if data starts from February (like 2024), balance starts from February
        if (month >= firstMonthWithData) {
          // Add profit/loss to running balance
          // If profitLossAmount is negative (loss), it will subtract from balance
          // If profitLossAmount is positive (profit), it will add to balance
          runningBalance += profitLossAmount;
        }

        balanceMonthly.push({
          month,
          amountPln: Math.round(runningBalance * 100) / 100
        });
      }

      // Total balance at the end of the year equals cumulative profit/loss
      const totalBalance = runningBalance;

      // Add balance to response
      response.balance = {
        monthly: balanceMonthly,
        total: {
          amountPln: Math.round(totalBalance * 100) / 100
        }
      };

      // Calculate ROI (Return on Investment) for each month
      // ROI = ((Revenue - Expenses) / Expenses) × 100% = (Profit/Loss / Expenses) × 100%
      // If expenses = 0, ROI is undefined (cannot divide by zero)
      const roiMonthly = [];
      for (let month = 1; month <= 12; month++) {
        // Get revenue for this month
        const monthRevenueEntry = monthlyArray.find(m => m.month === month);
        const monthRevenue = monthRevenueEntry?.amountPln || 0;

        // Get expenses for this month
        const monthExpenseTotal = expenses.reduce((sum, cat) => {
          const monthEntry = cat.monthly?.find(m => m.month === month);
          return sum + (monthEntry?.amountPln || 0);
        }, 0);

        // Calculate ROI
        let roi = null; // null means ROI cannot be calculated (no expenses)
        if (monthExpenseTotal > 0) {
          const profitLoss = monthRevenue - monthExpenseTotal;
          roi = (profitLoss / monthExpenseTotal) * 100;
          roi = Math.round(roi * 100) / 100; // Round to 2 decimal places
        }

        roiMonthly.push({
          month,
          roi: roi // null if expenses = 0, otherwise percentage value
        });
      }

      // Calculate total ROI for the year
      let totalROI = null;
      if (totalExpenses > 0) {
        totalROI = (totalProfitLoss / totalExpenses) * 100;
        totalROI = Math.round(totalROI * 100) / 100;
      }

      // Add ROI to response
      response.roi = {
        monthly: roiMonthly,
        total: {
          roi: totalROI // null if total expenses = 0, otherwise percentage value
        }
      };

      // Calculate EBITDA (Earnings Before Interest, Taxes, Depreciation, and Amortization)
      // EBITDA = Revenue - Operating Expenses (excluding Interest, Taxes, Depreciation, Amortization)
      // 
      // Note: We have data for Taxes (categories: "Налоги" ID:38, "ВАТ" ID:39, "ЗУС" ID:40)
      // But we don't have separate categories for Interest, Depreciation, Amortization
      // So we calculate: EBITDA = Revenue - Expenses (excluding Taxes)
      // 
      // Find tax category IDs
      const taxCategoryIds = new Set();
      expenseCategories.forEach(cat => {
        const catName = (cat.name || '').toUpperCase();
        if (catName === 'НАЛОГИ' || catName === 'ВАТ' || catName === 'ЗУС' || 
            catName.includes('TAX') || catName.includes('PIT') || catName.includes('CIT')) {
          taxCategoryIds.add(cat.id);
        }
      });

      const ebitdaMonthly = [];
      for (let month = 1; month <= 12; month++) {
        // Get revenue for this month
        const monthRevenueEntry = monthlyArray.find(m => m.month === month);
        const monthRevenue = monthRevenueEntry?.amountPln || 0;

        // Get operating expenses for this month (excluding taxes)
        const monthOperatingExpenses = expenses.reduce((sum, cat) => {
          // Skip tax categories
          if (taxCategoryIds.has(cat.id)) {
            return sum;
          }
          const monthEntry = cat.monthly?.find(m => m.month === month);
          return sum + (monthEntry?.amountPln || 0);
        }, 0);

        // Calculate EBITDA
        const ebitda = monthRevenue - monthOperatingExpenses;

        ebitdaMonthly.push({
          month,
          amountPln: Math.round(ebitda * 100) / 100
        });
      }

      // Calculate total EBITDA for the year
      const totalOperatingExpenses = expenses.reduce((sum, cat) => {
        // Skip tax categories
        if (taxCategoryIds.has(cat.id)) {
          return sum;
        }
        return sum + (cat.total?.amountPln || 0);
      }, 0);
      const totalEBITDA = totalRevenue - totalOperatingExpenses;

      // Add EBITDA to response
      response.ebitda = {
        monthly: ebitdaMonthly,
        total: {
          amountPln: Math.round(totalEBITDA * 100) / 100
        }
      };

      logger.info('Returning PNL report response', {
        year: targetYear,
        hasResponse: !!response,
        responseKeys: response ? Object.keys(response) : [],
        responseType: typeof response
      });

      return response;
    } catch (error) {
      logger.error('Error in getMonthlyRevenue', { error: error.message, stack: error.stack });
      throw error;
    }
  }
}

module.exports = PnlReportService;

