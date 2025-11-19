const supabase = require('../supabaseClient');
const logger = require('../../utils/logger');

class PnlRepository {
  constructor() {
    this.supabase = supabase;
    if (!this.supabase) {
      logger.warn('Supabase client is not configured. PnlRepository will be disabled.');
    }
  }

  isEnabled() {
    return !!this.supabase;
  }

  /**
   * Store aggregated monthly revenue data in pnl_data table
   * @param {Object} data - Monthly revenue data
   * @param {number} data.amount - Revenue amount in PLN
   * @param {number} data.month - Month number (1-12)
   * @param {number} data.year - Year (optional, for future use)
   * @returns {Promise<Object|null>} Created record or null
   */
  async upsertMonthlyRevenue({ amount, month, year = null }) {
    if (!this.isEnabled()) return null;

    const payload = {
      amount: Number(amount) || 0,
      month: Number(month) || 1,
      updated_at: new Date().toISOString()
    };

    try {
      const { data, error } = await this.supabase
        .from('pnl_data')
        .upsert(payload, { onConflict: 'month' })
        .select()
        .maybeSingle();

      if (error) {
        logger.error('Failed to upsert monthly revenue', { error, payload });
        return null;
      }

      return data;
    } catch (err) {
      logger.error('Exception while upserting monthly revenue', { error: err.message, payload });
      return null;
    }
  }

  /**
   * Get monthly revenue data for a specific month
   * @param {number} month - Month number (1-12)
   * @returns {Promise<Object|null>} Monthly revenue record or null
   */
  async getMonthlyRevenue(month) {
    if (!this.isEnabled()) return null;

    try {
      const { data, error } = await this.supabase
        .from('pnl_data')
        .select('*')
        .eq('month', Number(month))
        .maybeSingle();

      if (error) {
        logger.error('Failed to get monthly revenue', { error, month });
        return null;
      }

      return data;
    } catch (err) {
      logger.error('Exception while getting monthly revenue', { error: err.message, month });
      return null;
    }
  }
}

module.exports = PnlRepository;



