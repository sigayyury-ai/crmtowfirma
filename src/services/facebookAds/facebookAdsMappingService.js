const supabase = require('../supabaseClient');
const logger = require('../../utils/logger');

/**
 * Service for managing Facebook Ads campaign to product mappings
 */
class FacebookAdsMappingService {
  constructor() {
    if (!supabase) {
      logger.warn('Supabase client is not configured. FacebookAdsMappingService disabled.');
    }
  }

  /**
   * Normalize campaign name for matching
   * @param {string} name - Campaign name
   * @returns {string|null} - Normalized name or null
   */
  normalizeCampaignName(name) {
    if (!name) return null;
    return name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\p{L}\p{N}\s.\-_/]/gu, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Create a new mapping
   * @param {Object} params
   * @param {string} params.campaignName - Original campaign name
   * @param {number} params.productId - Product ID
   * @param {string} [params.createdBy] - User identifier
   * @returns {Promise<Object>} - Created mapping
   */
  async createMapping({ campaignName, productId, createdBy = null }) {
    if (!supabase) {
      throw new Error('Supabase недоступен');
    }

    const normalizedName = this.normalizeCampaignName(campaignName);
    if (!normalizedName) {
      throw new Error('Название кампании не может быть пустым');
    }

    // Check if mapping already exists
    const existing = await this.getMappingByCampaign(campaignName, productId);
    if (existing) {
      throw new Error('Маппинг уже существует');
    }

    const { data, error } = await supabase
      .from('facebook_ads_campaign_mappings')
      .insert({
        campaign_name: campaignName,
        campaign_name_normalized: normalizedName,
        product_id: productId,
        created_by: createdBy
      })
      .select(`
        *,
        product:product_id (
          id,
          name,
          normalized_name
        )
      `)
      .single();

    if (error) {
      logger.error('Failed to create Facebook Ads mapping', {
        error: error.message,
        campaignName,
        productId
      });
      throw new Error('Не удалось создать маппинг');
    }

    logger.info('Facebook Ads: Mapping created successfully', {
      mappingId: data.id,
      campaignName: data.campaign_name,
      productId: data.product_id,
      hasProduct: !!data.product
    });

    // Update all existing expenses with this campaign name to link them to the product
    await this.updateExpensesForMapping(normalizedName, productId);

    return data;
  }

  /**
   * Update Facebook Ads expenses with product_id based on mapping
   * @param {string} normalizedCampaignName - Normalized campaign name
   * @param {number} productId - Product ID to link
   * @param {boolean} [forceUpdate=false] - If true, update even if product_id is already set
   * @returns {Promise<void>}
   */
  async updateExpensesForMapping(normalizedCampaignName, productId, forceUpdate = false) {
    if (!supabase || !normalizedCampaignName || !productId) {
      return;
    }

    let query = supabase
      .from('facebook_ads_expenses')
      .update({ product_id: productId })
      .eq('campaign_name_normalized', normalizedCampaignName);

    // Only update expenses that don't have product_id yet, unless forceUpdate is true
    if (!forceUpdate) {
      query = query.is('product_id', null);
    }

    const { data, error } = await query.select('id');

    if (error) {
      logger.error('Failed to update Facebook Ads expenses for mapping', {
        error: error.message,
        normalizedCampaignName,
        productId
      });
    } else {
      logger.info('Facebook Ads: Updated expenses for mapping', {
        normalizedCampaignName,
        productId,
        updatedCount: data?.length || 0
      });
    }
  }

  /**
   * Get mapping by campaign name
   * @param {string} campaignName - Campaign name
   * @param {number} [productId] - Optional product ID filter
   * @returns {Promise<Object|null>} - Mapping or null
   */
  async getMappingByCampaign(campaignName, productId = null) {
    if (!supabase) {
      return null;
    }

    const normalizedName = this.normalizeCampaignName(campaignName);
    if (!normalizedName) {
      return null;
    }

    let query = supabase
      .from('facebook_ads_campaign_mappings')
      .select('*')
      .eq('campaign_name_normalized', normalizedName);

    if (productId) {
      query = query.eq('product_id', productId);
    }

    const { data, error } = await query.maybeSingle();

    if (error && error.code !== 'PGRST116') {
      logger.error('Failed to get Facebook Ads mapping', {
        error: error.message,
        campaignName
      });
      return null;
    }

    return data;
  }

  /**
   * Get all mappings
   * @param {Object} [filters] - Optional filters
   * @param {number} [filters.productId] - Filter by product ID
   * @returns {Promise<Array>} - List of mappings
   */
  async getAllMappings(filters = {}) {
    if (!supabase) {
      return [];
    }

    let query = supabase
      .from('facebook_ads_campaign_mappings')
      .select(`
        *,
        product:product_id (
          id,
          name,
          normalized_name
        )
      `)
      .order('created_at', { ascending: false });

    if (filters.productId) {
      query = query.eq('product_id', filters.productId);
    }

    const { data, error } = await query;

    if (error) {
      logger.error('Failed to get Facebook Ads mappings', {
        error: error.message
      });
      return [];
    }

    return data || [];
  }

  /**
   * Update mapping
   * @param {string} mappingId - Mapping ID
   * @param {Object} updates - Fields to update
   * @param {number} [updates.productId] - New product ID
   * @returns {Promise<Object>} - Updated mapping
   */
  async updateMapping(mappingId, updates) {
    if (!supabase) {
      throw new Error('Supabase недоступен');
    }

    const updateData = {
      updated_at: new Date().toISOString()
    };

    if (updates.productId !== undefined) {
      updateData.product_id = updates.productId;
    }

    const { data, error } = await supabase
      .from('facebook_ads_campaign_mappings')
      .update(updateData)
      .eq('id', mappingId)
      .select(`
        *,
        product:product_id (
          id,
          name,
          normalized_name
        )
      `)
      .single();

    if (error) {
      logger.error('Failed to update Facebook Ads mapping', {
        error: error.message,
        mappingId
      });
      throw new Error('Не удалось обновить маппинг');
    }

    logger.info('Facebook Ads: Mapping updated', {
      mappingId: data.id,
      productId: data.product_id
    });

    // Get the normalized campaign name from the mapping
    const { data: mappingData } = await supabase
      .from('facebook_ads_campaign_mappings')
      .select('campaign_name_normalized')
      .eq('id', mappingId)
      .single();

    if (mappingData && mappingData.campaign_name_normalized && updates.productId !== undefined) {
      // Update all existing expenses with this campaign name
      await this.updateExpensesForMapping(mappingData.campaign_name_normalized, updates.productId);
    }

    return data;
  }

  /**
   * Delete mapping
   * @param {string} mappingId - Mapping ID
   * @returns {Promise<boolean>} - Success
   */
  async deleteMapping(mappingId) {
    if (!supabase) {
      throw new Error('Supabase недоступен');
    }

    // Get the normalized campaign name before deleting
    const { data: mappingData } = await supabase
      .from('facebook_ads_campaign_mappings')
      .select('campaign_name_normalized')
      .eq('id', mappingId)
      .single();

    const { error } = await supabase
      .from('facebook_ads_campaign_mappings')
      .delete()
      .eq('id', mappingId);

    if (error) {
      logger.error('Failed to delete Facebook Ads mapping', {
        error: error.message,
        mappingId
      });
      throw new Error('Не удалось удалить маппинг');
    }

    // Unlink expenses from product when mapping is deleted
    if (mappingData && mappingData.campaign_name_normalized) {
      const { error: updateError } = await supabase
        .from('facebook_ads_expenses')
        .update({ product_id: null })
        .eq('campaign_name_normalized', mappingData.campaign_name_normalized);

      if (updateError) {
        logger.error('Failed to unlink Facebook Ads expenses after mapping deletion', {
          error: updateError.message,
          normalizedCampaignName: mappingData.campaign_name_normalized
        });
      } else {
        logger.info('Facebook Ads: Unlinked expenses after mapping deletion', {
          normalizedCampaignName: mappingData.campaign_name_normalized
        });
      }
    }

    return true;
  }

  /**
   * Suggest products for a campaign name based on normalized name matching
   * @param {string} campaignName - Campaign name
   * @param {number} [limit] - Maximum number of suggestions
   * @returns {Promise<Array>} - List of suggested products with relevance score
   */
  async suggestProducts(campaignName, limit = 5) {
    if (!supabase) {
      return [];
    }

    const normalizedName = this.normalizeCampaignName(campaignName);
    if (!normalizedName) {
      return [];
    }

    // Remove common prefixes for better matching
    const nameWithoutPrefix = normalizedName
      .replace(/^(camp|event|coliving)\s*\/?\s*/i, '')
      .trim();

    // Get all products
    const { data: products, error } = await supabase
      .from('products')
      .select('id, name, normalized_name')
      .not('normalized_name', 'is', null);

    if (error) {
      logger.error('Failed to get products for suggestions', {
        error: error.message
      });
      return [];
    }

    if (!products || products.length === 0) {
      return [];
    }

    // Score products by similarity
    const suggestions = products
      .map((product) => {
        const productNormalized = (product.normalized_name || '').toLowerCase().trim();
        if (!productNormalized) return null;

        let score = 0;

        // Exact match
        if (normalizedName === productNormalized || nameWithoutPrefix === productNormalized) {
          score = 100;
        }
        // Campaign name contains product name
        else if (normalizedName.includes(productNormalized) || nameWithoutPrefix.includes(productNormalized)) {
          score = 80;
        }
        // Product name contains campaign name (without prefix)
        else if (productNormalized.includes(nameWithoutPrefix) && nameWithoutPrefix.length > 3) {
          score = 70;
        }
        // Partial match (words)
        else {
          const campaignWords = nameWithoutPrefix.split(/\s+/).filter(w => w.length > 2);
          const productWords = productNormalized.split(/\s+/).filter(w => w.length > 2);
          const matchingWords = campaignWords.filter(w => productWords.includes(w));
          if (matchingWords.length > 0) {
            score = 50 + (matchingWords.length * 10);
          }
        }

        if (score > 0) {
          return {
            productId: product.id,
            productName: product.name,
            normalizedName: product.normalized_name,
            score
          };
        }

        return null;
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return suggestions;
  }

  /**
   * Get unmapped campaigns (campaigns with expenses but no mapping)
   * @returns {Promise<Array>} - List of unmapped campaigns with expense totals
   */
  async getUnmappedCampaigns() {
    if (!supabase) {
      logger.warn('Supabase not available for getUnmappedCampaigns');
      return [];
    }

    logger.info('Facebook Ads: Getting unmapped campaigns');

    // Get all distinct campaigns from expenses
    const { data: expenses, error: expensesError } = await supabase
      .from('facebook_ads_expenses')
      .select('campaign_name, campaign_name_normalized, amount_pln');

    if (expensesError) {
      logger.error('Failed to get unmapped campaigns', {
        error: expensesError.message
      });
      return [];
    }

    logger.info('Facebook Ads: Expenses loaded', {
      expensesCount: expenses?.length || 0
    });

    if (!expenses || expenses.length === 0) {
      logger.info('Facebook Ads: No expenses found');
      return [];
    }

    // Get all mapped campaign names
    const { data: mappings, error: mappingsError } = await supabase
      .from('facebook_ads_campaign_mappings')
      .select('campaign_name_normalized');

    if (mappingsError) {
      logger.error('Failed to get mappings for unmapped check', {
        error: mappingsError.message
      });
      // Continue anyway - assume no mappings if error
    }

    const mappedNames = new Set((mappings || []).map(m => m.campaign_name_normalized));
    logger.info('Facebook Ads: Mappings loaded', {
      mappingsCount: mappedNames.size,
      mappedNames: Array.from(mappedNames).slice(0, 5)
    });

    // Group expenses by campaign and filter unmapped
    const campaignMap = new Map();
    (expenses || []).forEach(expense => {
      const normalizedName = expense.campaign_name_normalized;
      if (!normalizedName) {
        logger.warn('Facebook Ads: Expense without normalized name', {
          expense
        });
        return;
      }

      if (!mappedNames.has(normalizedName)) {
        const key = normalizedName;
        if (!campaignMap.has(key)) {
          campaignMap.set(key, {
            campaign_name: expense.campaign_name,
            campaign_name_normalized: normalizedName,
            total_amount_pln: 0
          });
        }
        campaignMap.get(key).total_amount_pln += parseFloat(expense.amount_pln || 0);
      }
    });

    const result = Array.from(campaignMap.values())
      .sort((a, b) => b.total_amount_pln - a.total_amount_pln);

    logger.info('Facebook Ads: Unmapped campaigns result', {
      unmappedCount: result.length,
      totalExpenses: expenses.length,
      mappedCount: mappedNames.size
    });

    return result;
  }
}

// Export normalizeCampaignName as static method for use in API routes
FacebookAdsMappingService.normalizeCampaignName = function(name) {
  const instance = new FacebookAdsMappingService();
  return instance.normalizeCampaignName(name);
};

module.exports = FacebookAdsMappingService;

