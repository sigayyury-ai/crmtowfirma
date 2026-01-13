const supabase = require('../supabaseClient');
const logger = require('../../utils/logger');

/**
 * Service for fetching payment details for PNL report
 */
class PaymentDetailsService {
  constructor() {
    this.supabase = supabase;
  }

  /**
   * Extract month number (1-12) from date
   * Uses UTC to ensure consistent month extraction
   * @param {Date|string|number} date - Date value
   * @returns {number|null} Month number (1-12) or null if invalid
   */
  extractMonthFromDate(date) {
    if (!date) return null;
    const parsedDate = date instanceof Date ? date : new Date(date);
    if (isNaN(parsedDate.getTime())) return null;
    return parsedDate.getUTCMonth() + 1; // getUTCMonth() returns 0-11, we need 1-12
  }

  /**
   * Extract year from date
   * Uses UTC to ensure consistent year extraction
   * @param {Date|string|number} date - Date value
   * @returns {number|null} Year or null if invalid
   */
  extractYearFromDate(date) {
    if (!date) return null;
    const parsedDate = date instanceof Date ? date : new Date(date);
    if (isNaN(parsedDate.getTime())) return null;
    return parsedDate.getUTCFullYear();
  }

  /**
   * Get payments by category and month
   * Fetches payments from both payments and stripe_payments tables
   * @param {number} categoryId - Category ID (null for uncategorized)
   * @param {number} year - Year (e.g., 2025)
   * @param {number} month - Month number (1-12)
   * @returns {Promise<Array>} Array of payment objects with unified structure
   */
  async getPaymentsByCategoryAndMonth(categoryId, year, month) {
    try {
      logger.info('Fetching payments by category and month', {
        categoryId,
        year,
        month
      });

      // Validate inputs
      if (!year || !Number.isFinite(year) || year < 2020 || year > 2030) {
        throw new Error(`Invalid year: ${year}`);
      }
      if (!month || !Number.isFinite(month) || month < 1 || month > 12) {
        throw new Error(`Invalid month: ${month}`);
      }

      // Calculate date range for the month
      const yearStart = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
      const yearEnd = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));

      const payments = [];

      // Fetch bank payments
      try {
        let bankPaymentsQuery = this.supabase
          .from('payments')
          .select(`
            id,
            operation_date,
            amount,
            currency,
            payer_name,
            description,
            income_category_id,
            direction,
            match_status,
            proforma_id
          `)
          .eq('direction', 'in')
          .is('deleted_at', null)
          .gte('operation_date', yearStart.toISOString())
          .lte('operation_date', yearEnd.toISOString());

        // Filter by category
        if (categoryId === null || categoryId === undefined) {
          // Uncategorized payments
          bankPaymentsQuery = bankPaymentsQuery.is('income_category_id', null);
        } else {
          bankPaymentsQuery = bankPaymentsQuery.eq('income_category_id', categoryId);
        }

        const { data: bankPaymentsData, error: bankError } = await bankPaymentsQuery.order('operation_date', { ascending: false });

        if (bankError) {
          logger.error('Error fetching bank payments:', bankError);
          throw new Error(`Failed to fetch bank payments: ${bankError.message}`);
        }

        // Transform bank payments to unified format
        if (Array.isArray(bankPaymentsData)) {
          bankPaymentsData.forEach(payment => {
            const paymentMonth = this.extractMonthFromDate(payment.operation_date);
            const paymentYear = this.extractYearFromDate(payment.operation_date);

            // Double-check month/year match (in case of timezone issues)
            if (paymentMonth === month && paymentYear === year) {
              payments.push({
                id: payment.id,
                source: 'bank',
                date: payment.operation_date,
                amount: payment.amount || 0,
                currency: payment.currency || 'PLN',
                payer: payment.payer_name || 'Не указан',
                description: payment.description || '',
                categoryId: payment.income_category_id || null,
                matchStatus: payment.match_status,
                proformaId: payment.proforma_id
              });
            }
          });
        }
      } catch (bankErr) {
        logger.error('Exception while fetching bank payments:', bankErr);
        // Continue with Stripe payments even if bank payments fail
      }

      // Fetch Stripe payments
      try {
        let stripePaymentsQuery = this.supabase
          .from('stripe_payments')
          .select(`
            id,
            created_at,
            amount,
            currency,
            payer_email,
            description,
            income_category_id,
            stripe_payment_status,
            deal_id
          `)
          .gte('created_at', yearStart.toISOString())
          .lte('created_at', yearEnd.toISOString());

        // Filter by category
        if (categoryId === null || categoryId === undefined) {
          // Uncategorized payments
          stripePaymentsQuery = stripePaymentsQuery.is('income_category_id', null);
        } else {
          stripePaymentsQuery = stripePaymentsQuery.eq('income_category_id', categoryId);
        }

        const { data: stripePaymentsData, error: stripeError } = await stripePaymentsQuery.order('created_at', { ascending: false });

        if (stripeError) {
          logger.error('Error fetching Stripe payments:', stripeError);
          throw new Error(`Failed to fetch Stripe payments: ${stripeError.message}`);
        }

        // Transform Stripe payments to unified format
        if (Array.isArray(stripePaymentsData)) {
          stripePaymentsData.forEach(payment => {
            const paymentMonth = this.extractMonthFromDate(payment.created_at);
            const paymentYear = this.extractYearFromDate(payment.created_at);

            // Double-check month/year match (in case of timezone issues)
            if (paymentMonth === month && paymentYear === year) {
              payments.push({
                id: payment.id,
                source: 'stripe',
                date: payment.created_at,
                amount: payment.amount || 0,
                currency: payment.currency || 'PLN',
                payer: payment.payer_email || 'Не указан',
                description: payment.description || '',
                categoryId: payment.income_category_id || null,
                status: payment.stripe_payment_status,
                dealId: payment.deal_id
              });
            }
          });
        }
      } catch (stripeErr) {
        logger.error('Exception while fetching Stripe payments:', stripeErr);
        // Continue even if Stripe payments fail
      }

      // Sort by date (most recent first)
      payments.sort((a, b) => {
        const dateA = new Date(a.date);
        const dateB = new Date(b.date);
        return dateB - dateA; // Descending order (newest first)
      });

      logger.info('Fetched payments by category and month', {
        categoryId,
        year,
        month,
        count: payments.length
      });

      return payments;
    } catch (error) {
      logger.error('Failed to get payments by category and month:', error);
      throw error;
    }
  }

  /**
   * Unlink payment from category (set income_category_id to NULL)
   * @param {number} paymentId - Payment ID
   * @param {string} source - Payment source ('bank' or 'stripe')
   * @returns {Promise<Object>} Updated payment object
   */
  async unlinkPaymentFromCategory(paymentId, source) {
    try {
      logger.info('Unlinking payment from category', {
        paymentId,
        source
      });

      if (!paymentId || !Number.isFinite(paymentId)) {
        throw new Error(`Invalid payment ID: ${paymentId}`);
      }

      if (source !== 'bank' && source !== 'stripe') {
        throw new Error(`Invalid payment source: ${source}. Must be 'bank' or 'stripe'`);
      }

      const tableName = source === 'bank' ? 'payments' : 'stripe_payments';
      const idField = source === 'bank' ? 'id' : 'id';

      // Update payment: set income_category_id to NULL
      const { data, error } = await this.supabase
        .from(tableName)
        .update({ income_category_id: null })
        .eq(idField, paymentId)
        .select()
        .single();

      if (error) {
        logger.error('Error unlinking payment:', error);
        throw new Error(`Failed to unlink payment: ${error.message}`);
      }

      if (!data) {
        throw new Error(`Payment not found: ${paymentId}`);
      }

      logger.info('Payment unlinked successfully', {
        paymentId,
        source,
        categoryId: null
      });

      return data;
    } catch (error) {
      logger.error('Failed to unlink payment from category:', error);
      throw error;
    }
  }

  /**
   * Get expenses (outgoing payments) by category and month
   * Fetches expenses from payments table with direction='out'
   * @param {number} expenseCategoryId - Expense category ID (null for uncategorized)
   * @param {number} year - Year (e.g., 2025)
   * @param {number} month - Month number (1-12)
   * @returns {Promise<Array>} Array of expense payment objects with unified structure
   */
  async getExpensesByCategoryAndMonth(expenseCategoryId, year, month) {
    try {
      logger.info('Fetching expenses by category and month', {
        expenseCategoryId,
        year,
        month
      });

      // Validate inputs
      if (!year || !Number.isFinite(year) || year < 2020 || year > 2030) {
        throw new Error(`Invalid year: ${year}`);
      }
      if (!month || !Number.isFinite(month) || month < 1 || month > 12) {
        throw new Error(`Invalid month: ${month}`);
      }

      // Calculate date range for the month
      const yearStart = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
      const yearEnd = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));

      const expenses = [];

      // Fetch expense payments (direction='out')
      try {
        let expensesQuery = this.supabase
          .from('payments')
          .select(`
            id,
            operation_date,
            amount,
            currency,
            payer_name,
            description,
            expense_category_id,
            direction,
            match_status,
            proforma_id
          `)
          .eq('direction', 'out')
          .is('deleted_at', null)
          .gte('operation_date', yearStart.toISOString())
          .lte('operation_date', yearEnd.toISOString());

        // Filter by category
        if (expenseCategoryId === null || expenseCategoryId === undefined) {
          // Uncategorized expenses
          expensesQuery = expensesQuery.is('expense_category_id', null);
        } else {
          expensesQuery = expensesQuery.eq('expense_category_id', expenseCategoryId);
        }

        const { data: expensesData, error: expensesError } = await expensesQuery.order('operation_date', { ascending: false });

        if (expensesError) {
          logger.error('Error fetching expenses:', expensesError);
          throw new Error(`Failed to fetch expenses: ${expensesError.message}`);
        }

        // Transform expenses to unified format
        if (Array.isArray(expensesData)) {
          expensesData.forEach(expense => {
            const expenseMonth = this.extractMonthFromDate(expense.operation_date);
            const expenseYear = this.extractYearFromDate(expense.operation_date);

            // Double-check month/year match (in case of timezone issues)
            if (expenseMonth === month && expenseYear === year) {
              expenses.push({
                id: expense.id,
                source: 'bank',
                date: expense.operation_date,
                amount: expense.amount || 0,
                currency: expense.currency || 'PLN',
                payer: expense.payer_name || 'Не указан',
                description: expense.description || '',
                categoryId: expense.expense_category_id || null,
                matchStatus: expense.match_status,
                proformaId: expense.proforma_id
              });
            }
          });
        }
      } catch (expensesErr) {
        logger.error('Exception while fetching expenses:', expensesErr);
        throw expensesErr;
      }

      // Sort by date (most recent first)
      expenses.sort((a, b) => {
        const dateA = new Date(a.date);
        const dateB = new Date(b.date);
        return dateB - dateA; // Descending order (newest first)
      });

      logger.info('Fetched expenses by category and month', {
        expenseCategoryId,
        year,
        month,
        count: expenses.length
      });

      return expenses;
    } catch (error) {
      logger.error('Failed to get expenses by category and month:', error);
      throw error;
    }
  }

  /**
   * Unlink expense from category (set expense_category_id to NULL)
   * @param {number} expenseId - Expense payment ID
   * @returns {Promise<Object>} Updated payment object
   */
  async unlinkExpenseFromCategory(expenseId) {
    try {
      logger.info('Unlinking expense from category', {
        expenseId
      });

      if (!expenseId || !Number.isFinite(expenseId)) {
        throw new Error(`Invalid expense ID: ${expenseId}`);
      }

      // Update payment: set expense_category_id to NULL
      const { data, error } = await this.supabase
        .from('payments')
        .update({ expense_category_id: null })
        .eq('id', expenseId)
        .eq('direction', 'out') // Ensure it's an expense
        .select()
        .single();

      if (error) {
        logger.error('Error unlinking expense:', error);
        throw new Error(`Failed to unlink expense: ${error.message}`);
      }

      if (!data) {
        throw new Error(`Expense not found: ${expenseId}`);
      }

      logger.info('Expense unlinked successfully', {
        expenseId,
        categoryId: null
      });

      return data;
    } catch (error) {
      logger.error('Failed to unlink expense from category:', error);
      throw error;
    }
  }

  /**
   * Mark payment as duplicate (soft delete by setting deleted_at)
   * @param {number} paymentId - Payment ID
   * @param {string} source - Payment source ('bank' or 'stripe')
   * @returns {Promise<Object>} Updated payment object
   */
  async markPaymentAsDuplicate(paymentId, source) {
    try {
      logger.info('Marking payment as duplicate', {
        paymentId,
        source
      });

      if (!paymentId || !Number.isFinite(paymentId)) {
        throw new Error(`Invalid payment ID: ${paymentId}`);
      }

      if (source !== 'bank' && source !== 'stripe') {
        throw new Error(`Invalid payment source: ${source}. Must be 'bank' or 'stripe'`);
      }

      const tableName = source === 'bank' ? 'payments' : 'stripe_payments';
      const idField = source === 'bank' ? 'id' : 'id';

      // Soft delete payment: set deleted_at to current timestamp
      const { data, error } = await this.supabase
        .from(tableName)
        .update({ deleted_at: new Date().toISOString() })
        .eq(idField, paymentId)
        .select()
        .single();

      if (error) {
        logger.error('Error marking payment as duplicate:', error);
        throw new Error(`Failed to mark payment as duplicate: ${error.message}`);
      }

      if (!data) {
        throw new Error(`Payment not found: ${paymentId}`);
      }

      logger.info('Payment marked as duplicate successfully', {
        paymentId,
        source,
        deletedAt: data.deleted_at
      });

      return data;
    } catch (error) {
      logger.error('Failed to mark payment as duplicate:', error);
      throw error;
    }
  }

  /**
   * Mark expense payment as duplicate (soft delete by setting deleted_at)
   * @param {number} expenseId - Expense payment ID
   * @returns {Promise<Object>} Updated payment object
   */
  async markExpenseAsDuplicate(expenseId) {
    try {
      logger.info('Marking expense as duplicate', {
        expenseId
      });

      if (!expenseId || !Number.isFinite(expenseId)) {
        throw new Error(`Invalid expense ID: ${expenseId}`);
      }

      // Soft delete expense payment: set deleted_at to current timestamp
      const { data, error } = await this.supabase
        .from('payments')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', expenseId)
        .eq('direction', 'out') // Ensure it's an expense
        .select()
        .single();

      if (error) {
        logger.error('Error marking expense as duplicate:', error);
        throw new Error(`Failed to mark expense as duplicate: ${error.message}`);
      }

      if (!data) {
        throw new Error(`Expense not found: ${expenseId}`);
      }

      logger.info('Expense marked as duplicate successfully', {
        expenseId,
        deletedAt: data.deleted_at
      });

      return data;
    } catch (error) {
      logger.error('Failed to mark expense as duplicate:', error);
      throw error;
    }
  }

  /**
   * Find duplicate payments/expenses
   * Improved algorithm that:
   * 1. First checks operation_hash for exact duplicates
   * 2. For payments without hash or with different hashes, uses:
   *    - Same payer name (normalized) OR similar description if payer is null
   *    - Same amount (within 0.01 tolerance)
   *    - Same currency
   *    - Same or very close dates (within 7 days)
   *    - Similar description (for payments with null payer_name)
   * @param {number} year - Year to check
   * @param {number} month - Month to check (1-12)
   * @param {string} direction - 'in' for revenue, 'out' for expenses
   * @returns {Promise<Array>} Array of duplicate groups, each containing payment IDs
   */
  async findDuplicates(year, month, direction = 'out') {
    try {
      logger.info('Finding duplicate payments', {
        year,
        month,
        direction
      });

      // Calculate date range for the month
      const yearStart = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
      const yearEnd = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));

      // Fetch all payments for the month (include operation_hash)
      const { data: payments, error } = await this.supabase
        .from('payments')
        .select('id, operation_date, amount, currency, payer_name, description, expense_category_id, income_category_id, deleted_at, operation_hash')
        .eq('direction', direction)
        .is('deleted_at', null) // Only active payments
        .gte('operation_date', yearStart.toISOString())
        .lte('operation_date', yearEnd.toISOString())
        .order('operation_date', { ascending: true });

      if (error) {
        logger.error('Error fetching payments for duplicate check:', error);
        throw new Error(`Failed to fetch payments: ${error.message}`);
      }

      if (!payments || payments.length === 0) {
        return [];
      }

      // Normalize payer name for comparison (remove extra spaces, convert to lowercase)
      const normalizePayerName = (name) => {
        if (!name) return '';
        return name.trim().toLowerCase().replace(/\s+/g, ' ');
      };

      // Normalize description for comparison
      const normalizeDescription = (desc) => {
        if (!desc) return '';
        return desc.trim().toLowerCase().replace(/\s+/g, ' ');
      };

      // Check similarity of descriptions (returns 0-1, where 1 is identical)
      const descriptionSimilarity = (desc1, desc2) => {
        const norm1 = normalizeDescription(desc1);
        const norm2 = normalizeDescription(desc2);
        
        if (norm1 === norm2) return 1;
        
        // Extract meaningful words (length > 3, exclude common words)
        const words1 = norm1.split(/\s+/).filter(w => w.length > 3);
        const words2 = norm2.split(/\s+/).filter(w => w.length > 3);
        
        if (words1.length === 0 || words2.length === 0) return 0;
        
        const commonWords = words1.filter(w => words2.includes(w));
        return commonWords.length / Math.max(words1.length, words2.length);
      };

      // Step 1: Check for exact duplicates by operation_hash
      const hashGroups = new Map();
      const hashDuplicates = [];
      
      for (const payment of payments) {
        if (payment.operation_hash) {
          if (hashGroups.has(payment.operation_hash)) {
            hashDuplicates.push({
              hash: payment.operation_hash,
              payments: [hashGroups.get(payment.operation_hash), payment]
            });
          } else {
            hashGroups.set(payment.operation_hash, payment);
          }
        }
      }

      // Step 2: Group payments by payer + amount + currency (for payments with payer_name)
      // OR by description similarity + amount + currency (for payments without payer_name)
      const groups = new Map();
      
      for (const payment of payments) {
        // Skip if already identified as hash duplicate
        if (payment.operation_hash && hashDuplicates.some(d => d.hash === payment.operation_hash)) {
          continue;
        }

        const normalizedPayer = normalizePayerName(payment.payer_name);
        const hasPayer = normalizedPayer.length > 0;
        
        if (hasPayer) {
          // Group by payer + amount + currency
          const key = `payer:${normalizedPayer}|${payment.amount}|${payment.currency || 'PLN'}`;
          if (!groups.has(key)) {
            groups.set(key, []);
          }
          groups.get(key).push(payment);
        } else {
          // For payments without payer_name, group by amount + currency
          // We'll check description similarity later
          const key = `no_payer:${payment.amount}|${payment.currency || 'PLN'}`;
          if (!groups.has(key)) {
            groups.set(key, []);
          }
          groups.get(key).push(payment);
        }
      }

      // Find groups with duplicates (more than 1 payment)
      const duplicates = [];
      
      for (const [key, group] of groups.entries()) {
        if (group.length > 1) {
          // Check if payments are within 7 days of each other
          const sortedByDate = group.sort((a, b) => 
            new Date(a.operation_date) - new Date(b.operation_date)
          );
          
          // Group by date proximity (within 7 days)
          const dateGroups = [];
          let currentGroup = [sortedByDate[0]];
          
          for (let i = 1; i < sortedByDate.length; i++) {
            const prevDate = new Date(sortedByDate[i - 1].operation_date);
            const currDate = new Date(sortedByDate[i].operation_date);
            const daysDiff = Math.abs((currDate - prevDate) / (1000 * 60 * 60 * 24));
            
            if (daysDiff <= 7) {
              currentGroup.push(sortedByDate[i]);
            } else {
              if (currentGroup.length > 1) {
                dateGroups.push(currentGroup);
              }
              currentGroup = [sortedByDate[i]];
            }
          }
          
          if (currentGroup.length > 1) {
            dateGroups.push(currentGroup);
          }
          
          // Process date groups
          for (const dateGroup of dateGroups) {
            // For payments without payer_name, check description similarity
            if (key.startsWith('no_payer:')) {
              // Only consider duplicates if descriptions are similar (at least 50% similarity)
              const similarGroups = [];
              const processed = new Set();
              
              for (let i = 0; i < dateGroup.length; i++) {
                if (processed.has(dateGroup[i].id)) continue;
                
                const similar = [dateGroup[i]];
                processed.add(dateGroup[i].id);
                
                for (let j = i + 1; j < dateGroup.length; j++) {
                  if (processed.has(dateGroup[j].id)) continue;
                  
                  const similarity = descriptionSimilarity(
                    dateGroup[i].description,
                    dateGroup[j].description
                  );
                  
                  if (similarity >= 0.5) { // At least 50% similarity
                    similar.push(dateGroup[j]);
                    processed.add(dateGroup[j].id);
                  }
                }
                
                if (similar.length > 1) {
                  similarGroups.push(similar);
                }
              }
              
              // Add similar groups as duplicates
              for (const similarGroup of similarGroups) {
                duplicates.push({
                  payer: null,
                  amount: similarGroup[0].amount,
                  currency: similarGroup[0].currency || 'PLN',
                  payments: similarGroup.map(p => ({
                    id: p.id,
                    date: p.operation_date,
                    payer: p.payer_name,
                    description: p.description,
                    amount: p.amount,
                    currency: p.currency || 'PLN',
                    categoryId: direction === 'out' ? p.expense_category_id : p.income_category_id
                  })),
                  count: similarGroup.length
                });
              }
            } else {
              // For payments with payer_name, add as duplicates
              duplicates.push({
                payer: dateGroup[0].payer_name,
                amount: dateGroup[0].amount,
                currency: dateGroup[0].currency || 'PLN',
                payments: dateGroup.map(p => ({
                  id: p.id,
                  date: p.operation_date,
                  payer: p.payer_name,
                  description: p.description,
                  amount: p.amount,
                  currency: p.currency || 'PLN',
                  categoryId: direction === 'out' ? p.expense_category_id : p.income_category_id
                })),
                count: dateGroup.length
              });
            }
          }
        }
      }

      // Add hash duplicates
      for (const hashDup of hashDuplicates) {
        duplicates.push({
          payer: hashDup.payments[0].payer_name,
          amount: hashDup.payments[0].amount,
          currency: hashDup.payments[0].currency || 'PLN',
          payments: hashDup.payments.map(p => ({
            id: p.id,
            date: p.operation_date,
            payer: p.payer_name,
            description: p.description,
            amount: p.amount,
            currency: p.currency || 'PLN',
            categoryId: direction === 'out' ? p.expense_category_id : p.income_category_id
          })),
          count: hashDup.payments.length,
          isExactDuplicate: true // Mark as exact duplicate by hash
        });
      }

      logger.info('Found duplicate groups', {
        year,
        month,
        direction,
        duplicateCount: duplicates.length,
        totalDuplicatePayments: duplicates.reduce((sum, d) => sum + d.count, 0),
        exactHashDuplicates: hashDuplicates.length
      });

      return duplicates;
    } catch (error) {
      logger.error('Failed to find duplicates:', error);
      throw error;
    }
  }
}

module.exports = PaymentDetailsService;

