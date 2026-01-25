const supabase = require('../supabaseClient');
const logger = require('../../utils/logger');

/**
 * Service for managing Facebook Ads expenses
 */
class FacebookAdsExpenseService {
  constructor() {
    if (!supabase) {
      logger.warn('Supabase client is not configured. FacebookAdsExpenseService disabled.');
    }
  }

  /**
   * Create or update expense record
   * @param {Object} expense - Expense data
   * @param {string} expense.campaignName - Campaign name
   * @param {string} expense.campaignNameNormalized - Normalized campaign name
   * @param {number} [expense.productId] - Product ID (from mapping)
   * @param {string} expense.reportStartDate - Start date (YYYY-MM-DD)
   * @param {string} expense.reportEndDate - End date (YYYY-MM-DD)
   * @param {number} expense.amountPln - Amount in PLN
   * @param {string} [expense.currency] - Currency (default: PLN)
   * @param {string} [expense.importBatchId] - Import batch ID
   * @returns {Promise<Object>} - Created or updated expense
   */
  async upsertExpense(expense) {
    if (!supabase) {
      throw new Error('Supabase недоступен');
    }

    // Check if expense already exists
    const existing = await this.getExpenseByCampaignAndPeriod(
      expense.campaignNameNormalized,
      expense.reportStartDate,
      expense.reportEndDate
    );

    const expenseData = {
      campaign_name: expense.campaignName,
      campaign_name_normalized: expense.campaignNameNormalized,
      product_id: expense.productId || null,
      report_start_date: expense.reportStartDate,
      report_end_date: expense.reportEndDate,
      amount_pln: expense.amountPln,
      currency: expense.currency || 'PLN',
      import_batch_id: expense.importBatchId || null,
      updated_at: new Date().toISOString()
    };

    if (existing) {
      // Update existing record
      const { data, error } = await supabase
        .from('facebook_ads_expenses')
        .update(expenseData)
        .eq('id', existing.id)
        .select()
        .single();

      if (error) {
        logger.error('Failed to update Facebook Ads expense', {
          error: error.message,
          expense
        });
        throw new Error('Не удалось обновить расход');
      }

      return data;
    } else {
      // Create new record
      const { data, error } = await supabase
        .from('facebook_ads_expenses')
        .insert(expenseData)
        .select()
        .single();

      if (error) {
        logger.error('Failed to create Facebook Ads expense', {
          error: error.message,
          expense
        });
        throw new Error('Не удалось создать расход');
      }

      return data;
    }
  }

  /**
   * Get expense by campaign and period
   * @param {string} campaignNameNormalized - Normalized campaign name
   * @param {string} reportStartDate - Start date
   * @param {string} reportEndDate - End date
   * @returns {Promise<Object|null>} - Expense or null
   */
  async getExpenseByCampaignAndPeriod(campaignNameNormalized, reportStartDate, reportEndDate) {
    if (!supabase) {
      return null;
    }

    const { data, error } = await supabase
      .from('facebook_ads_expenses')
      .select('*')
      .eq('campaign_name_normalized', campaignNameNormalized)
      .eq('report_start_date', reportStartDate)
      .eq('report_end_date', reportEndDate)
      .maybeSingle();

    if (error && error.code !== 'PGRST116') {
      logger.error('Failed to get Facebook Ads expense', {
        error: error.message,
        campaignNameNormalized,
        reportStartDate,
        reportEndDate
      });
      return null;
    }

    return data;
  }

  /**
   * Get expenses by product ID
   * @param {number} productId - Product ID
   * @returns {Promise<Array>} - List of expenses
   */
  async getExpensesByProduct(productId) {
    if (!supabase) {
      return [];
    }

    const { data, error } = await supabase
      .from('facebook_ads_expenses')
      .select('*')
      .eq('product_id', productId)
      .order('report_start_date', { ascending: false });

    if (error) {
      logger.error('Failed to get Facebook Ads expenses by product', {
        error: error.message,
        productId
      });
      return [];
    }

    return data || [];
  }

  /**
   * Update campaign active status
   * @param {string} campaignNameNormalized - Normalized campaign name
   * @param {boolean} isActive - Active status
   * @returns {Promise<boolean>} - Success
   */
  async updateCampaignStatus(campaignNameNormalized, isActive) {
    if (!supabase) {
      throw new Error('Supabase недоступен');
    }

    const { error } = await supabase
      .from('facebook_ads_expenses')
      .update({
        is_campaign_active: isActive,
        updated_at: new Date().toISOString()
      })
      .eq('campaign_name_normalized', campaignNameNormalized);

    if (error) {
      logger.error('Failed to update campaign status', {
        error: error.message,
        campaignNameNormalized,
        isActive
      });
      throw new Error('Не удалось обновить статус кампании');
    }

    return true;
  }
}

module.exports = FacebookAdsExpenseService;


