const supabase = require('../supabaseClient');
const logger = require('../../utils/logger');

/**
 * Service for managing manual entries in PNL report
 */
class ManualEntryService {
  constructor() {
    this.tableName = 'pnl_manual_entries';
  }

  /**
   * Get manual entries for a category and year
   * @param {number} categoryId - Category ID (for revenue) or expense category ID (for expense)
   * @param {number} year - Year (2020-2030)
   * @param {string} [entryType='revenue'] - Entry type: 'revenue' or 'expense'
   * @returns {Promise<Array>} Array of manual entry objects
   */
  async getEntriesByCategoryAndYear(categoryId, year, entryType = 'revenue') {
    try {
      // Validate year
      if (!Number.isFinite(year) || year < 2020 || year > 2030) {
        throw new Error('Year must be a number between 2020 and 2030');
      }

      const isExpense = entryType === 'expense';
      const categoryField = isExpense ? 'expense_category_id' : 'category_id';

      const { data, error } = await supabase
        .from(this.tableName)
        .select('*')
        .eq(categoryField, categoryId)
        .eq('year', year)
        .eq('entry_type', entryType)
        .order('month', { ascending: true });

      if (error) {
        logger.error('Error getting manual entries:', error);
        throw error;
      }

      return data || [];
    } catch (error) {
      logger.error('Failed to get manual entries:', error);
      throw error;
    }
  }

  /**
   * Get a single manual entry by category, year, and month
   * @param {number} categoryId - Category ID (for revenue) or expense category ID (for expense)
   * @param {number} year - Year (2020-2030)
   * @param {number} month - Month (1-12)
   * @param {string} [entryType='revenue'] - Entry type: 'revenue' or 'expense'
   * @returns {Promise<Object|null>} Manual entry object or null if not found
   */
  async getEntry(categoryId, year, month, entryType = 'revenue') {
    try {
      // Validate inputs
      if (!Number.isFinite(year) || year < 2020 || year > 2030) {
        throw new Error('Year must be a number between 2020 and 2030');
      }
      if (!Number.isFinite(month) || month < 1 || month > 12) {
        throw new Error('Month must be a number between 1 and 12');
      }

      const isExpense = entryType === 'expense';
      const categoryField = isExpense ? 'expense_category_id' : 'category_id';

      const { data, error } = await supabase
        .from(this.tableName)
        .select('*')
        .eq(categoryField, categoryId)
        .eq('year', year)
        .eq('month', month)
        .eq('entry_type', entryType)
        .maybeSingle();

      if (error) {
        if (error.code === 'PGRST116') {
          return null;
        }
        logger.error('Error getting manual entry:', error);
        throw error;
      }

      return data;
    } catch (error) {
      logger.error('Failed to get manual entry:', error);
      throw error;
    }
  }

  /**
   * Create or update a manual entry (upsert)
   * @param {Object} entryData - Entry data
   * @param {number} [entryData.categoryId] - Revenue category ID (for revenue entries)
   * @param {number} [entryData.expenseCategoryId] - Expense category ID (for expense entries)
   * @param {string} [entryData.entryType='revenue'] - Entry type: 'revenue' or 'expense'
   * @param {number} entryData.year - Year (2020-2030)
   * @param {number} entryData.month - Month (1-12)
   * @param {number} entryData.amountPln - Amount in PLN (>= 0)
   * @param {Object} [entryData.currencyBreakdown] - Optional currency breakdown
   * @param {string} [entryData.notes] - Optional notes
   * @returns {Promise<Object>} Created/updated entry object
   */
  async upsertEntry(entryData) {
    try {
      const { categoryId, expenseCategoryId, entryType = 'revenue', year, month, amountPln, currencyBreakdown, notes } = entryData;

      // Validate inputs
      const isExpense = entryType === 'expense';
      const finalCategoryId = isExpense ? expenseCategoryId : categoryId;

      if (!Number.isFinite(finalCategoryId) || finalCategoryId <= 0) {
        throw new Error(`${isExpense ? 'expenseCategoryId' : 'categoryId'} must be a positive number`);
      }
      if (!Number.isFinite(year) || year < 2020 || year > 2030) {
        throw new Error('Year must be a number between 2020 and 2030');
      }
      if (!Number.isFinite(month) || month < 1 || month > 12) {
        throw new Error('Month must be a number between 1 and 12');
      }
      // Allow negative values for expenses (e.g., tax refunds), but require non-negative for revenue
      if (entryType === 'revenue' && (!Number.isFinite(amountPln) || amountPln < 0)) {
        throw new Error('amountPln must be a non-negative number for revenue entries');
      }
      if (entryType === 'expense' && !Number.isFinite(amountPln)) {
        throw new Error('amountPln must be a valid number for expense entries (negative values allowed for refunds)');
      }
      if (entryType !== 'revenue' && entryType !== 'expense') {
        throw new Error('entryType must be either "revenue" or "expense"');
      }

      // Verify category exists and is manual type
      const categoryTable = isExpense ? 'pnl_expense_categories' : 'pnl_revenue_categories';
      const { data: category, error: categoryError } = await supabase
        .from(categoryTable)
        .select('id, management_type')
        .eq('id', finalCategoryId)
        .single();

      if (categoryError || !category) {
        throw new Error('Category not found');
      }

      if (category.management_type !== 'manual') {
        throw new Error('Manual entries can only be created for categories with management_type="manual"');
      }

      // Prepare upsert data
      const upsertData = {
        entry_type: entryType,
        year,
        month,
        amount_pln: parseFloat(amountPln.toFixed(2)),
        currency_breakdown: currencyBreakdown || null,
        notes: notes?.trim() || null
      };

      if (isExpense) {
        upsertData.expense_category_id = finalCategoryId;
        upsertData.category_id = null;
      } else {
        upsertData.category_id = finalCategoryId;
        upsertData.expense_category_id = null;
      }

      // Check if entry already exists (because partial unique indexes don't work with onConflict in Supabase)
      const existingEntry = await this.getEntry(finalCategoryId, year, month, entryType);
      
      let data, error;
      if (existingEntry) {
        // Update existing entry
        const { data: updateData, error: updateError } = await supabase
          .from(this.tableName)
          .update(upsertData)
          .eq('id', existingEntry.id)
          .select()
          .single();
        data = updateData;
        error = updateError;
      } else {
        // Insert new entry
        const { data: insertData, error: insertError } = await supabase
          .from(this.tableName)
          .insert(upsertData)
          .select()
          .single();
        data = insertData;
        error = insertError;
      }

      if (error) {
        logger.error('Error upserting manual entry:', error);
        throw error;
      }

      logger.info(`Upserted manual entry: ${entryType} category=${finalCategoryId}, year=${year}, month=${month}, amount=${amountPln}`);
      return data;
    } catch (error) {
      logger.error('Failed to upsert manual entry:', error);
      throw error;
    }
  }

  /**
   * Delete a manual entry
   * @param {number} categoryId - Category ID (for revenue) or expense category ID (for expense)
   * @param {number} year - Year (2020-2030)
   * @param {number} month - Month (1-12)
   * @param {string} [entryType='revenue'] - Entry type: 'revenue' or 'expense'
   * @returns {Promise<Object>} Deletion result
   */
  async deleteEntry(categoryId, year, month, entryType = 'revenue') {
    try {
      // Validate inputs
      if (!Number.isFinite(year) || year < 2020 || year > 2030) {
        throw new Error('Year must be a number between 2020 and 2030');
      }
      if (!Number.isFinite(month) || month < 1 || month > 12) {
        throw new Error('Month must be a number between 1 and 12');
      }

      const isExpense = entryType === 'expense';
      const categoryField = isExpense ? 'expense_category_id' : 'category_id';

      const { error } = await supabase
        .from(this.tableName)
        .delete()
        .eq(categoryField, categoryId)
        .eq('year', year)
        .eq('month', month)
        .eq('entry_type', entryType);

      if (error) {
        logger.error('Error deleting manual entry:', error);
        throw error;
      }

      logger.info(`Deleted manual entry: ${entryType} category=${categoryId}, year=${year}, month=${month}`);
      return { success: true, message: 'Manual entry deleted successfully' };
    } catch (error) {
      logger.error('Failed to delete manual entry:', error);
      throw error;
    }
  }

  /**
   * Get all manual entries for multiple categories and a year
   * @param {Array<number>} categoryIds - Array of category IDs (revenue or expense)
   * @param {number} year - Year (2020-2030)
   * @param {string} [entryType='revenue'] - Entry type: 'revenue' or 'expense'
   * @returns {Promise<Map>} Map of categoryId -> month -> entry
   */
  async getEntriesByCategoriesAndYear(categoryIds, year, entryType = 'revenue') {
    try {
      if (!Array.isArray(categoryIds) || categoryIds.length === 0) {
        return new Map();
      }

      // Validate year
      if (!Number.isFinite(year) || year < 2020 || year > 2030) {
        throw new Error('Year must be a number between 2020 and 2030');
      }

      const isExpense = entryType === 'expense';
      const categoryField = isExpense ? 'expense_category_id' : 'category_id';

      const { data, error } = await supabase
        .from(this.tableName)
        .select('*')
        .in(categoryField, categoryIds)
        .eq('year', year)
        .eq('entry_type', entryType)
        .order(categoryField, { ascending: true })
        .order('month', { ascending: true });

      if (error) {
        logger.error('Error getting manual entries by categories:', error);
        throw error;
      }

      // Organize by category and month
      // For both expenses and revenue: store arrays of entries (allows multiple entries per category/month)
      const entriesMap = new Map();
      (data || []).forEach(entry => {
        const catId = isExpense ? entry.expense_category_id : entry.category_id;
        const month = entry.month;
        
        if (!entriesMap.has(catId)) {
          entriesMap.set(catId, new Map());
        }
        
        const monthMap = entriesMap.get(catId);
        // For both expenses and revenue: store array of entries (allows multiple)
        if (!monthMap.has(month)) {
          monthMap.set(month, []);
        }
        monthMap.get(month).push(entry);
      });

      return entriesMap;
    } catch (error) {
      logger.error('Failed to get manual entries by categories:', error);
      throw error;
    }
  }

  /**
   * Create a new manual entry (always inserts, no upsert for expenses)
   * For expense entries, this allows multiple entries per category/month
   * @param {Object} entryData - Entry data
   * @param {number} [entryData.categoryId] - Revenue category ID (for revenue entries)
   * @param {number} [entryData.expenseCategoryId] - Expense category ID (for expense entries)
   * @param {string} [entryData.entryType='revenue'] - Entry type: 'revenue' or 'expense'
   * @param {number} entryData.year - Year (2020-2030)
   * @param {number} entryData.month - Month (1-12)
   * @param {number} entryData.amountPln - Amount in PLN (must be > 0)
   * @param {Object} [entryData.currencyBreakdown] - Optional currency breakdown
   * @param {string} [entryData.notes] - Optional notes
   * @returns {Promise<Object>} Created entry object
   */
  async createEntry(entryData) {
    try {
      const { categoryId, expenseCategoryId, entryType = 'revenue', year, month, amountPln, currencyBreakdown, notes } = entryData;

      // Validate inputs
      const isExpense = entryType === 'expense';
      const finalCategoryId = isExpense ? expenseCategoryId : categoryId;

      if (!Number.isFinite(finalCategoryId) || finalCategoryId <= 0) {
        throw new Error(`${isExpense ? 'expenseCategoryId' : 'categoryId'} must be a positive number`);
      }
      if (!Number.isFinite(year) || year < 2020 || year > 2030) {
        throw new Error('Year must be a number between 2020 and 2030');
      }
      if (!Number.isFinite(month) || month < 1 || month > 12) {
        throw new Error('Month must be a number between 1 and 12');
      }
      if (!Number.isFinite(amountPln) || amountPln <= 0) {
        throw new Error('amountPln must be a positive number (greater than zero)');
      }
      if (entryType !== 'revenue' && entryType !== 'expense') {
        throw new Error('entryType must be either "revenue" or "expense"');
      }

      // Verify category exists and is manual type
      const categoryTable = isExpense ? 'pnl_expense_categories' : 'pnl_revenue_categories';
      const { data: category, error: categoryError } = await supabase
        .from(categoryTable)
        .select('id, management_type')
        .eq('id', finalCategoryId)
        .single();

      if (categoryError || !category) {
        throw new Error('Category not found');
      }

      if (category.management_type !== 'manual') {
        throw new Error('Manual entries can only be created for categories with management_type="manual"');
      }

      // Prepare insert data
      // Convert amountPln to number first, then format to 2 decimal places
      const numericAmount = Number(amountPln);
      if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
        throw new Error(`Invalid amountPln value: ${amountPln} (converted to: ${numericAmount})`);
      }
      const insertData = {
        entry_type: entryType,
        year,
        month,
        amount_pln: parseFloat(numericAmount.toFixed(2)),
        currency_breakdown: currencyBreakdown || null,
        notes: notes?.trim() || null
      };

      if (isExpense) {
        insertData.expense_category_id = finalCategoryId;
        insertData.category_id = null;
      } else {
        insertData.category_id = finalCategoryId;
        insertData.expense_category_id = null;
      }

      // Always insert (no upsert check for expenses)
      logger.info('Inserting manual entry:', {
        table: this.tableName,
        insertData,
        entryType,
        finalCategoryId
      });
      
      const { data, error } = await supabase
        .from(this.tableName)
        .insert(insertData)
        .select();

      if (error) {
        logger.error('Error creating manual entry:', {
          error: error.message,
          code: error.code,
          details: error.details,
          hint: error.hint,
          insertData
        });
        throw error;
      }

      if (!data || data.length === 0) {
        const errorMsg = 'Insert succeeded but no data returned';
        logger.error(errorMsg, { insertData });
        throw new Error(errorMsg);
      }

      const insertedEntry = data[0];

      logger.info(`Created manual entry: ${entryType} category=${finalCategoryId}, year=${year}, month=${month}, amount=${amountPln}`);
      return insertedEntry;
    } catch (error) {
      logger.error('Failed to create manual entry:', error);
      throw error;
    }
  }

  /**
   * Get all manual entries for a specific category and month
   * Returns array of all entries (allows multiple entries per category/month for expenses)
   * @param {number} categoryId - Category ID (for revenue) or expense category ID (for expense)
   * @param {number} year - Year (2020-2030)
   * @param {number} month - Month (1-12)
   * @param {string} [entryType='revenue'] - Entry type: 'revenue' or 'expense'
   * @returns {Promise<Array>} Array of manual entry objects
   */
  async getEntriesByCategoryMonth(categoryId, year, month, entryType = 'revenue') {
    try {
      // Validate inputs
      if (!Number.isFinite(year) || year < 2020 || year > 2030) {
        throw new Error('Year must be a number between 2020 and 2030');
      }
      if (!Number.isFinite(month) || month < 1 || month > 12) {
        throw new Error('Month must be a number between 1 and 12');
      }

      const isExpense = entryType === 'expense';
      const categoryField = isExpense ? 'expense_category_id' : 'category_id';

      const { data, error } = await supabase
        .from(this.tableName)
        .select('*')
        .eq(categoryField, categoryId)
        .eq('year', year)
        .eq('month', month)
        .eq('entry_type', entryType)
        .order('created_at', { ascending: true });

      if (error) {
        logger.error('Error getting manual entries by category/month:', error);
        throw error;
      }

      return data || [];
    } catch (error) {
      logger.error('Failed to get manual entries by category/month:', error);
      throw error;
    }
  }

  /**
   * Get a single manual entry by ID
   * @param {number} id - Entry ID
   * @returns {Promise<Object|null>} Manual entry object or null if not found
   */
  async getEntryById(id) {
    try {
      if (!Number.isFinite(id) || id <= 0) {
        throw new Error('Entry ID must be a positive number');
      }

      const { data, error } = await supabase
        .from(this.tableName)
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (error) {
        if (error.code === 'PGRST116') {
          return null;
        }
        logger.error('Error getting manual entry by ID:', error);
        throw error;
      }

      return data;
    } catch (error) {
      logger.error('Failed to get manual entry by ID:', error);
      throw error;
    }
  }

  /**
   * Update a manual entry by ID
   * @param {number} id - Entry ID
   * @param {Object} updateData - Update data
   * @param {number} [updateData.amountPln] - Updated amount in PLN (must be > 0)
   * @param {string} [updateData.notes] - Updated notes
   * @returns {Promise<Object>} Updated entry object
   */
  async updateEntryById(id, updateData) {
    try {
      if (!Number.isFinite(id) || id <= 0) {
        throw new Error('Entry ID must be a positive number');
      }

      const { amountPln, notes } = updateData;

      // Validate amount if provided
      if (amountPln !== undefined) {
        if (!Number.isFinite(amountPln) || amountPln <= 0) {
          throw new Error('amountPln must be a positive number (greater than zero)');
        }
      }

      // Prepare update data
      const updateFields = {};
      if (amountPln !== undefined) {
        updateFields.amount_pln = parseFloat(amountPln.toFixed(2));
      }
      if (notes !== undefined) {
        updateFields.notes = notes?.trim() || null;
      }

      if (Object.keys(updateFields).length === 0) {
        throw new Error('No fields to update');
      }

      const { data, error } = await supabase
        .from(this.tableName)
        .update(updateFields)
        .eq('id', id)
        .select()
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          throw new Error('Entry not found');
        }
        logger.error('Error updating manual entry:', error);
        throw error;
      }

      logger.info(`Updated manual entry: id=${id}`);
      return data;
    } catch (error) {
      logger.error('Failed to update manual entry:', error);
      throw error;
    }
  }

  /**
   * Delete a manual entry by ID
   * @param {number} id - Entry ID
   * @returns {Promise<Object>} Deletion result
   */
  async deleteEntryById(id) {
    try {
      if (!Number.isFinite(id) || id <= 0) {
        throw new Error('Entry ID must be a positive number');
      }

      const { error } = await supabase
        .from(this.tableName)
        .delete()
        .eq('id', id);

      if (error) {
        logger.error('Error deleting manual entry:', error);
        throw error;
      }

      logger.info(`Deleted manual entry: id=${id}`);
      return { success: true, message: 'Manual entry deleted successfully' };
    } catch (error) {
      logger.error('Failed to delete manual entry:', error);
      throw error;
    }
  }

  /**
   * Get all expense entries for a year (for insights calculations)
   * @param {number} year - Year (2020-2030)
   * @param {string} [asOfDate] - Optional ISO 8601 date string for historical filtering
   * @returns {Promise<Array>} Array of expense entry objects
   */
  async getExpenses(year, asOfDate = null) {
    try {
      // Validate year
      if (!Number.isFinite(year) || year < 2020 || year > 2030) {
        throw new Error('Year must be a number between 2020 and 2030');
      }

      // Validate asOfDate if provided
      if (asOfDate) {
        const date = new Date(asOfDate);
        if (isNaN(date.getTime())) {
          throw new Error('Invalid asOfDate format. Expected ISO 8601 date string.');
        }
        if (date > new Date()) {
          throw new Error('asOfDate cannot be in the future');
        }
      }

      let query = supabase
        .from(this.tableName)
        .select('*')
        .eq('year', year)
        .eq('entry_type', 'expense')
        .order('month', { ascending: true })
        .order('created_at', { ascending: true });

      // Apply historical date filtering if provided
      if (asOfDate) {
        const asOfDateObj = new Date(asOfDate);
        const asOfDateISO = asOfDateObj.toISOString();
        // Filter: created_at <= asOfDate AND (updated_at IS NULL OR updated_at <= asOfDate)
        query = query
          .lte('created_at', asOfDateISO)
          .or(`updated_at.is.null,updated_at.lte.${asOfDateISO}`);
      }

      const { data, error } = await query;

      if (error) {
        logger.error('Error getting expenses:', error);
        throw error;
      }

      return data || [];
    } catch (error) {
      logger.error('Failed to get expenses:', error);
      throw error;
    }
  }
}

module.exports = ManualEntryService;

