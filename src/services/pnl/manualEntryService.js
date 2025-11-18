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
      if (!Number.isFinite(amountPln) || amountPln < 0) {
        throw new Error('amountPln must be a non-negative number');
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

      // Use appropriate conflict resolution based on entry type
      // For revenue: conflict on category_id, year, month
      // For expense: conflict on expense_category_id, year, month
      const conflictColumns = isExpense 
        ? 'expense_category_id,year,month' 
        : 'category_id,year,month';

      const { data, error } = await supabase
        .from(this.tableName)
        .upsert(upsertData, {
          onConflict: conflictColumns
        })
        .select()
        .single();

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
      const entriesMap = new Map();
      (data || []).forEach(entry => {
        const catId = isExpense ? entry.expense_category_id : entry.category_id;
        const month = entry.month;
        
        if (!entriesMap.has(catId)) {
          entriesMap.set(catId, new Map());
        }
        entriesMap.get(catId).set(month, entry);
      });

      return entriesMap;
    } catch (error) {
      logger.error('Failed to get manual entries by categories:', error);
      throw error;
    }
  }
}

module.exports = ManualEntryService;

