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
 * @param {Date|string|number} date - Date value
 * @returns {number|null} Month number (1-12) or null if invalid
 */
function extractMonthFromDate(date) {
  const parsedDate = parseDate(date);
  if (!parsedDate) return null;
  return parsedDate.getMonth() + 1; // getMonth() returns 0-11, we need 1-12
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
   * @param {Array} payments - Array of payment objects
   * @returns {Array} Filtered payments
   */
  filterProcessedPayments(payments) {
    if (!Array.isArray(payments)) return [];
    
    return payments.filter((payment) => {
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

      // Load manual entries for manual categories
      const manualCategories = Array.from(categoriesMap.values())
        .filter(cat => cat.id !== null && cat.management_type === 'manual')
        .map(cat => cat.id);
      
      let manualEntriesMap = new Map();
      if (manualCategories.length > 0) {
        try {
          manualEntriesMap = await this.manualEntryService.getEntriesByCategoriesAndYear(manualCategories, targetYear);
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

      // Filter processed payments
      const processedPayments = this.filterProcessedPayments(allPayments);

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

      // Process automatic payments (only for auto categories)
      nonRefundedPayments.forEach((payment) => {
        const categoryId = payment.income_category_id || null;
        const category = categoriesMap.get(categoryId);
        
        // Skip payments for manual categories (they use manual entries instead)
        if (category && category.management_type === 'manual') {
          return;
        }

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

      // Process manual entries for manual categories
      manualEntriesMap.forEach((monthEntries, categoryId) => {
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
        monthEntries.forEach((entry, month) => {
          const amountPln = toNumber(entry.amount_pln) || 0;
          if (amountPln > 0) {
            categoryMonthlyData[categoryId][month].amountPln += amountPln;
            categoryMonthlyData[categoryId][month].paymentCount += 1; // Count as 1 entry

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

        // Process automatic expense payments (only for auto categories)
        for (const payment of expensePayments) {
          const categoryId = payment.expense_category_id || null;
          const category = expenseCategoriesMap.get(categoryId);
          
          // Skip payments for manual categories (they use manual entries instead)
          if (category && category.management_type === 'manual') {
            logger.debug('Skipping expense payment: manual category', {
              paymentId: payment.id,
              categoryId: categoryId,
              categoryName: category.name
            });
            continue;
          }

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

      // Load manual entries for expense categories
      const manualExpenseCategories = Array.from(expenseCategoriesMap.values())
        .filter(cat => cat.id !== null && cat.management_type === 'manual')
        .map(cat => cat.id);
      
      let manualExpenseEntriesMap = new Map();
      if (manualExpenseCategories.length > 0) {
        try {
          manualExpenseEntriesMap = await this.manualEntryService.getEntriesByCategoriesAndYear(manualExpenseCategories, targetYear, 'expense');
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

