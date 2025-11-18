const supabase = require('../supabaseClient');
const logger = require('../../utils/logger');
const openAIService = require('../ai/openAIService');
const ExpenseCategoryService = require('./expenseCategoryService');

// Create instance
const expenseCategoryService = new ExpenseCategoryService();

/**
 * Service for managing expense category mappings
 * Used for automatic category detection when importing CSV files
 */
class ExpenseCategoryMappingService {
  constructor() {
    this.tableName = 'expense_category_mappings';
  }

  /**
   * List all mappings, optionally filtered by category
   * @param {number} [expenseCategoryId] - Optional category ID filter
   * @returns {Promise<Array>} Array of mapping objects
   */
  async listMappings(expenseCategoryId = null) {
    try {
      let query = supabase
        .from(this.tableName)
        .select('*')
        .order('priority', { ascending: false })
        .order('created_at', { ascending: false });

      if (expenseCategoryId) {
        query = query.eq('expense_category_id', expenseCategoryId);
      }

      const { data, error } = await query;

      if (error) {
        logger.error('Error listing expense category mappings:', error);
        throw error;
      }

      return data || [];
    } catch (error) {
      logger.error('Failed to list expense category mappings:', error);
      throw error;
    }
  }

  /**
   * Get a single mapping by ID
   * @param {number} id - Mapping ID
   * @returns {Promise<Object|null>} Mapping object or null if not found
   */
  async getMappingById(id) {
    try {
      const { data, error } = await supabase
        .from(this.tableName)
        .select('*')
        .eq('id', id)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return null;
        }
        logger.error('Error getting expense category mapping by ID:', error);
        throw error;
      }

      return data;
    } catch (error) {
      logger.error('Failed to get expense category mapping by ID:', error);
      throw error;
    }
  }

  /**
   * Create a new mapping
   * @param {Object} mappingData - Mapping data
   * @param {string} mappingData.pattern_type - Pattern type ('category', 'description', 'payer')
   * @param {string} mappingData.pattern_value - Pattern value to match
   * @param {number} mappingData.expense_category_id - Expense category ID
   * @param {number} [mappingData.priority] - Priority (default: 0)
   * @returns {Promise<Object>} Created mapping object
   */
  async createMapping(mappingData) {
    try {
      const { pattern_type, pattern_value, expense_category_id, priority = 0 } = mappingData;

      // Validate inputs
      if (!pattern_type || !['category', 'description', 'payer'].includes(pattern_type)) {
        throw new Error('pattern_type must be one of: category, description, payer');
      }

      if (!pattern_value || typeof pattern_value !== 'string' || pattern_value.trim().length === 0) {
        throw new Error('pattern_value is required and must be a non-empty string');
      }

      if (!Number.isFinite(expense_category_id) || expense_category_id <= 0) {
        throw new Error('expense_category_id must be a positive number');
      }

      // Verify category exists
      const { data: category, error: categoryError } = await supabase
        .from('pnl_expense_categories')
        .select('id')
        .eq('id', expense_category_id)
        .single();

      if (categoryError || !category) {
        throw new Error('Expense category not found');
      }

      const insertData = {
        pattern_type,
        pattern_value: pattern_value.trim(),
        expense_category_id,
        priority: Number.isFinite(priority) ? priority : 0
      };

      const { data, error } = await supabase
        .from(this.tableName)
        .insert(insertData)
        .select()
        .single();

      if (error) {
        if (error.code === '23505') {
          throw new Error('Mapping with this pattern_type and pattern_value already exists');
        }
        logger.error('Error creating expense category mapping:', error);
        throw error;
      }

      logger.info(`Created expense category mapping: ${pattern_type}=${pattern_value} -> category ${expense_category_id}`);
      return data;
    } catch (error) {
      logger.error('Failed to create expense category mapping:', error);
      throw error;
    }
  }

  /**
   * Update an existing mapping
   * @param {number} id - Mapping ID
   * @param {Object} mappingData - Updated mapping data
   * @returns {Promise<Object>} Updated mapping object
   */
  async updateMapping(id, mappingData) {
    try {
      const existing = await this.getMappingById(id);
      if (!existing) {
        throw new Error('Mapping not found');
      }

      const updateData = {};

      if (mappingData.pattern_type !== undefined) {
        if (!['category', 'description', 'payer'].includes(mappingData.pattern_type)) {
          throw new Error('pattern_type must be one of: category, description, payer');
        }
        updateData.pattern_type = mappingData.pattern_type;
      }

      if (mappingData.pattern_value !== undefined) {
        if (typeof mappingData.pattern_value !== 'string' || mappingData.pattern_value.trim().length === 0) {
          throw new Error('pattern_value must be a non-empty string');
        }
        updateData.pattern_value = mappingData.pattern_value.trim();
      }

      if (mappingData.expense_category_id !== undefined) {
        if (!Number.isFinite(mappingData.expense_category_id) || mappingData.expense_category_id <= 0) {
          throw new Error('expense_category_id must be a positive number');
        }
        updateData.expense_category_id = mappingData.expense_category_id;
      }

      if (mappingData.priority !== undefined) {
        updateData.priority = Number.isFinite(mappingData.priority) ? mappingData.priority : 0;
      }

      if (Object.keys(updateData).length === 0) {
        return existing;
      }

      const { data, error } = await supabase
        .from(this.tableName)
        .update(updateData)
        .eq('id', id)
        .select()
        .single();

      if (error) {
        if (error.code === '23505') {
          throw new Error('Mapping with this pattern_type and pattern_value already exists');
        }
        logger.error('Error updating expense category mapping:', error);
        throw error;
      }

      logger.info(`Updated expense category mapping: ID ${id}`);
      return data;
    } catch (error) {
      logger.error('Failed to update expense category mapping:', error);
      throw error;
    }
  }

  /**
   * Delete a mapping
   * @param {number} id - Mapping ID
   * @returns {Promise<Object>} Deletion result
   */
  async deleteMapping(id) {
    try {
      const existing = await this.getMappingById(id);
      if (!existing) {
        throw new Error('Mapping not found');
      }

      const { error } = await supabase
        .from(this.tableName)
        .delete()
        .eq('id', id);

      if (error) {
        logger.error('Error deleting expense category mapping:', error);
        throw error;
      }

      logger.info(`Deleted expense category mapping: ID ${id}`);
      return { success: true, message: 'Mapping deleted successfully' };
    } catch (error) {
      logger.error('Failed to delete expense category mapping:', error);
      throw error;
    }
  }

  /**
   * Find category for a payment record based on mappings
   * @param {Object} paymentRecord - Payment record with category, description, payer_name
   * @returns {Promise<number|null>} Expense category ID or null if not found
   */
  async findCategoryForPayment(paymentRecord) {
    try {
      const result = await this.findCategorySuggestions(paymentRecord);
      // Return the best match (highest confidence) if available
      return result && result.length > 0 ? result[0].categoryId : null;
    } catch (error) {
      logger.error('Failed to find category for payment:', error);
      return null;
    }
  }

  /**
   * Find category suggestions for a payment record with confidence scores
   * @param {Object} paymentRecord - Payment record with category, description, payer_name
   * @param {number} [limit=3] - Maximum number of suggestions to return
   * @returns {Promise<Array>} Array of suggestions with { categoryId, confidence, patternType, patternValue, matchDetails }
   */
  async findCategorySuggestions(paymentRecord, limit = 3) {
    try {
      const { category, description, payer_name } = paymentRecord;
      const suggestions = [];

      // Load all mappings ordered by priority (higher priority first)
      const { data: mappings, error } = await supabase
        .from(this.tableName)
        .select('*')
        .order('priority', { ascending: false });

      if (error) {
        logger.error('Error loading expense category mappings:', error);
        return [];
      }

      if (!mappings || mappings.length === 0) {
        logger.debug('No expense category mappings found');
        return [];
      }

      logger.debug(`Loaded ${mappings.length} expense category mappings`, {
        sampleMappings: mappings.slice(0, 5).map(m => ({
          id: m.id,
          pattern_type: m.pattern_type,
          pattern_value: m.pattern_value,
          category_id: m.expense_category_id,
          priority: m.priority
        }))
      });

      // Normalize text helper function
      // Keep special characters but normalize spaces and case
      const normalizeText = (text) => {
        if (!text) return '';
        return text.toLowerCase()
          .trim()
          .replace(/\s+/g, ' '); // Replace multiple spaces with single space
        // Don't remove special characters - they might be important for matching
      };

      // Try to match by priority order
      for (const mapping of mappings) {
        const { pattern_type, pattern_value, expense_category_id, priority } = mapping;
        const patternNormalized = normalizeText(pattern_value);
        let confidence = 0;
        let matchDetails = '';

        // Match by category from CSV (exact match = 100%)
        if (pattern_type === 'category' && category) {
          const categoryNormalized = normalizeText(category);
          if (categoryNormalized === patternNormalized) {
            confidence = 100;
            matchDetails = `Точное совпадение категории: "${category}"`;
            suggestions.push({
              categoryId: expense_category_id,
              confidence,
              patternType: pattern_type,
              patternValue: pattern_value,
              priority: priority || 0,
              matchDetails
            });
            continue;
          }
        }

        // Match by description (improved matching)
        if (pattern_type === 'description' && description) {
          const descNormalized = normalizeText(description);
          
          // Log matching attempts for debugging
          logger.debug('Matching description pattern', {
            pattern: pattern_value,
            patternNormalized,
            description: description.substring(0, 100),
            descNormalized: descNormalized.substring(0, 100),
            categoryId: expense_category_id
          });
          
          // Exact match = 100%
          if (descNormalized === patternNormalized) {
            confidence = 100;
            matchDetails = `Точное совпадение описания: "${pattern_value}"`;
            logger.info('Exact description match found', {
              pattern: pattern_value,
              description: description.substring(0, 50),
              categoryId: expense_category_id
            });
            suggestions.push({
              categoryId: expense_category_id,
              confidence,
              patternType: pattern_type,
              patternValue: pattern_value,
              priority: priority || 0,
              matchDetails
            });
            continue;
          }
          
          // Check if pattern is at the start of description (higher confidence)
          if (descNormalized.startsWith(patternNormalized)) {
            const matchLength = patternNormalized.length;
            const descLength = descNormalized.length;
            const matchRatio = matchLength / Math.max(descLength, 1);
            
            // Higher confidence for start matches: 85-95%
            confidence = Math.round(85 + (matchRatio * 10));
            confidence = Math.min(confidence, 95);
            
            logger.info('Start match found in description', {
              pattern: pattern_value,
              description: description.substring(0, 50),
              confidence,
              categoryId: expense_category_id
            });
            
            matchDetails = `Совпадение в начале описания: "${pattern_value}" найдено в "${description.substring(0, 50)}${description.length > 50 ? '...' : ''}"`;
            suggestions.push({
              categoryId: expense_category_id,
              confidence,
              patternType: pattern_type,
              patternValue: pattern_value,
              priority: priority || 0,
              matchDetails
            });
            continue;
          }
          
          // Partial match anywhere in description
          if (descNormalized.includes(patternNormalized)) {
            const matchLength = patternNormalized.length;
            const descLength = descNormalized.length;
            const matchRatio = matchLength / Math.max(descLength, 1);
            
            // Base confidence: 70-90% depending on match ratio
            confidence = Math.round(70 + (matchRatio * 20));
            confidence = Math.min(confidence, 90); // Cap at 90% for partial matches
            
            logger.info('Partial match found in description', {
              pattern: pattern_value,
              description: description.substring(0, 50),
              confidence,
              categoryId: expense_category_id
            });
            
            matchDetails = `Совпадение в описании: "${pattern_value}" найдено в "${description.substring(0, 50)}${description.length > 50 ? '...' : ''}"`;
            suggestions.push({
              categoryId: expense_category_id,
              confidence,
              patternType: pattern_type,
              patternValue: pattern_value,
              priority: priority || 0,
              matchDetails
            });
            continue;
          }
        }

        // Match by payer name (improved matching)
        if (pattern_type === 'payer' && payer_name) {
          const payerNormalized = normalizeText(payer_name);
          
          // Exact match = 100%
          if (payerNormalized === patternNormalized) {
            confidence = 100;
            matchDetails = `Точное совпадение плательщика: "${pattern_value}"`;
            suggestions.push({
              categoryId: expense_category_id,
              confidence,
              patternType: pattern_type,
              patternValue: pattern_value,
              priority: priority || 0,
              matchDetails
            });
            continue;
          }
          
          // Partial match
          if (payerNormalized.includes(patternNormalized)) {
            const matchLength = patternNormalized.length;
            const payerLength = payerNormalized.length;
            const matchRatio = matchLength / Math.max(payerLength, 1);
            
            // Base confidence: 60-80% depending on match ratio
            confidence = Math.round(60 + (matchRatio * 20));
            confidence = Math.min(confidence, 80); // Cap at 80% for payer matches
            
            matchDetails = `Совпадение плательщика: "${pattern_value}" найдено в "${payer_name}"`;
            suggestions.push({
              categoryId: expense_category_id,
              confidence,
              patternType: pattern_type,
              patternValue: pattern_value,
              priority: priority || 0,
              matchDetails
            });
            continue;
          }
        }
      }

      // Sort by confidence (descending), then by priority (descending)
      suggestions.sort((a, b) => {
        if (b.confidence !== a.confidence) {
          return b.confidence - a.confidence;
        }
        return b.priority - a.priority;
      });

      // Remove duplicates (same categoryId) - keep only the best match for each category
      const uniqueSuggestions = [];
      const seenCategories = new Set();
      for (const suggestion of suggestions) {
        if (!seenCategories.has(suggestion.categoryId)) {
          seenCategories.add(suggestion.categoryId);
          uniqueSuggestions.push(suggestion);
        }
      }

      // If no suggestions found from rules, try OpenAI (if enabled)
      if (uniqueSuggestions.length === 0 && openAIService.enabled) {
        try {
          const categories = await expenseCategoryService.listCategories();
          const validCategoryIds = new Set(categories.map(cat => cat.id));
          
          const aiResult = await openAIService.categorizeExpense(
            {
              id: paymentRecord.id || null,
              description,
              payer_name,
              category,
              amount: paymentRecord.amount || 0,
              currency: paymentRecord.currency || 'PLN'
            },
            categories
          );

          // Double-check: ensure categoryId exists in database (even though openAIService validates)
          if (aiResult.categoryId && 
              aiResult.confidence > 50 && 
              validCategoryIds.has(aiResult.categoryId)) {
            logger.info('OpenAI suggested category', {
              categoryId: aiResult.categoryId,
              confidence: aiResult.confidence,
              reasoning: aiResult.reasoning
            });

            uniqueSuggestions.push({
              categoryId: aiResult.categoryId,
              confidence: aiResult.confidence,
              patternType: 'ai',
              patternValue: 'AI Analysis',
              priority: 0,
              matchDetails: `AI предложение: ${aiResult.reasoning || 'На основе анализа описания'}`
            });
          } else if (aiResult.categoryId && !validCategoryIds.has(aiResult.categoryId)) {
            logger.warn('OpenAI returned invalid categoryId, ignoring', {
              invalidCategoryId: aiResult.categoryId,
              validCategoryIds: Array.from(validCategoryIds),
              reasoning: aiResult.reasoning
            });
          }
        } catch (aiError) {
          logger.warn('OpenAI categorization failed, continuing with rule-based suggestions', {
            error: aiError.message
          });
        }
      }

      // Return top N suggestions
      return uniqueSuggestions.slice(0, limit);
    } catch (error) {
      logger.error('Failed to find category suggestions:', error);
      return [];
    }
  }
}

module.exports = ExpenseCategoryMappingService;

