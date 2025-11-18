const supabase = require('../supabaseClient');
const logger = require('../../utils/logger');

/**
 * Service for managing PNL expense categories
 */
class ExpenseCategoryService {
  constructor() {
    this.tableName = 'pnl_expense_categories';
  }

  /**
   * List all expense categories
   * @returns {Promise<Array>} Array of category objects ordered by display_order
   */
  async listCategories() {
    try {
      // First check if display_order column exists
      const { data, error } = await supabase
        .from(this.tableName)
        .select('*');

      if (error) {
        logger.error('Error listing expense categories:', error);
        throw error;
      }

      // Sort by display_order if it exists, otherwise by name
      const categories = (data || []).sort((a, b) => {
        // If display_order exists, use it
        if (a.display_order !== undefined && b.display_order !== undefined) {
          if (a.display_order !== b.display_order) {
            return a.display_order - b.display_order;
          }
        }
        // Secondary sort by name
        return (a.name || '').localeCompare(b.name || '');
      });

      return categories;
    } catch (error) {
      logger.error('Failed to list expense categories:', error);
      throw error;
    }
  }

  /**
   * Get a single category by ID
   * @param {number} id - Category ID
   * @returns {Promise<Object|null>} Category object or null if not found
   */
  async getCategoryById(id) {
    try {
      const { data, error } = await supabase
        .from(this.tableName)
        .select('*')
        .eq('id', id)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          // Not found
          return null;
        }
        logger.error('Error getting expense category by ID:', error);
        throw error;
      }

      return data;
    } catch (error) {
      logger.error('Failed to get expense category by ID:', error);
      throw error;
    }
  }

  /**
   * Create a new expense category
   * @param {Object} categoryData - Category data
   * @param {string} categoryData.name - Category name (required, unique)
   * @param {string} [categoryData.description] - Category description (optional)
   * @param {string} [categoryData.management_type] - Management type ('auto' or 'manual', default: 'auto')
   * @returns {Promise<Object>} Created category object
   */
  async createCategory(categoryData) {
    try {
      // Validate required fields
      if (!categoryData.name || typeof categoryData.name !== 'string' || categoryData.name.trim().length === 0) {
        throw new Error('Category name is required and must be a non-empty string');
      }

      if (categoryData.name.length > 255) {
        throw new Error('Category name must not exceed 255 characters');
      }

      // Prepare insert data
      const insertData = {
        name: categoryData.name.trim(),
        description: categoryData.description?.trim() || null
      };
      
      // Only add management_type if provided (column may not exist)
      if (categoryData.management_type !== undefined) {
        insertData.management_type = categoryData.management_type === 'manual' ? 'manual' : 'auto';
      }

      // Try to set display_order if column exists
      try {
        const { data: maxOrderData, error: maxOrderError } = await supabase
          .from(this.tableName)
          .select('display_order')
          .order('display_order', { ascending: false })
          .limit(1)
          .single();

        if (!maxOrderError && maxOrderData) {
          const maxOrder = maxOrderData.display_order || 0;
          insertData.display_order = maxOrder + 1;
        }
      } catch (err) {
        // display_order column doesn't exist, skip it
        logger.debug('display_order column not available, skipping');
      }

      let { data, error } = await supabase
        .from(this.tableName)
        .insert(insertData)
        .select()
        .single();

      if (error) {
        // Check for column not found error (migration not run)
        if (error.code === '42703' && error.message?.includes('management_type')) {
          logger.warn('management_type column does not exist. Creating category without it.');
          // Remove management_type from insert and retry
          delete insertData.management_type;
          const retryResult = await supabase
            .from(this.tableName)
            .insert(insertData)
            .select()
            .single();
          
          if (retryResult.error) {
            if (retryResult.error.code === '23505') {
              throw new Error('Category with this name already exists');
            }
            logger.error('Error creating expense category (retry):', retryResult.error);
            throw retryResult.error;
          }
          
          data = retryResult.data;
          error = null;
        } else {
          // Check for unique constraint violation
          if (error.code === '23505') {
            throw new Error('Category with this name already exists');
          }
          logger.error('Error creating expense category:', error);
          throw error;
        }
      }

      logger.info(`Created expense category: ${data.name} (ID: ${data.id})`);
      return data;
    } catch (error) {
      logger.error('Failed to create expense category:', error);
      throw error;
    }
  }

  /**
   * Update an existing expense category
   * @param {number} id - Category ID
   * @param {Object} categoryData - Updated category data
   * @param {string} [categoryData.name] - Updated category name (optional)
   * @param {string} [categoryData.description] - Updated category description (optional)
   * @param {string} [categoryData.management_type] - Updated management type (optional)
   * @returns {Promise<Object>} Updated category object
   */
  async updateCategory(id, categoryData) {
    try {
      // Check if category exists
      const existing = await this.getCategoryById(id);
      if (!existing) {
        throw new Error('Category not found');
      }

      // Validate name if provided
      if (categoryData.name !== undefined) {
        if (typeof categoryData.name !== 'string' || categoryData.name.trim().length === 0) {
          throw new Error('Category name must be a non-empty string');
        }
        if (categoryData.name.length > 255) {
          throw new Error('Category name must not exceed 255 characters');
        }
      }

      const updateData = {
        updated_at: new Date().toISOString()
      };

      if (categoryData.name !== undefined) {
        updateData.name = categoryData.name.trim();
      }
      if (categoryData.description !== undefined) {
        updateData.description = categoryData.description?.trim() || null;
      }
      if (categoryData.management_type !== undefined) {
        // Validate management_type
        if (categoryData.management_type !== 'auto' && categoryData.management_type !== 'manual') {
          throw new Error('management_type must be either "auto" or "manual"');
        }
        // Only add management_type if column exists (migration may not be run yet)
        updateData.management_type = categoryData.management_type;
      }

      const { data, error } = await supabase
        .from(this.tableName)
        .update(updateData)
        .eq('id', id)
        .select()
        .single();

      if (error) {
        // Check for column not found error (migration not run)
        if (error.code === '42703' && error.message?.includes('management_type')) {
          logger.warn('management_type column does not exist. Please run migration 004_add_expense_categories.sql');
          // Remove management_type from update and retry
          delete updateData.management_type;
          const { data: retryData, error: retryError } = await supabase
            .from(this.tableName)
            .update(updateData)
            .eq('id', id)
            .select()
            .single();
          
          if (retryError) {
            if (retryError.code === '23505') {
              throw new Error('Category with this name already exists');
            }
            logger.error('Error updating expense category (retry):', retryError);
            throw retryError;
          }
          
          logger.info('Category updated without management_type (migration not run)');
          return retryData;
        }
        
        // Check for unique constraint violation
        if (error.code === '23505') {
          throw new Error('Category with this name already exists');
        }
        logger.error('Error updating expense category:', error);
        throw error;
      }

      logger.info(`Updated expense category: ${data.name} (ID: ${data.id})`);
      return data;
    } catch (error) {
      logger.error('Failed to update expense category:', error);
      throw error;
    }
  }

  /**
   * Delete an expense category
   * @param {number} id - Category ID
   * @returns {Promise<Object>} Deletion result
   */
  async deleteCategory(id) {
    try {
      // Check if category exists
      const existing = await this.getCategoryById(id);
      if (!existing) {
        throw new Error('Category not found');
      }

      // Check for associated payments
      const paymentsCount = await this.countPaymentsByCategory(id);
      if (paymentsCount > 0) {
        throw new Error(`Cannot delete category: ${paymentsCount} payment(s) are associated with this category`);
      }

      const { error } = await supabase
        .from(this.tableName)
        .delete()
        .eq('id', id);

      if (error) {
        logger.error('Error deleting expense category:', error);
        throw error;
      }

      logger.info(`Deleted expense category: ${existing.name} (ID: ${id})`);
      return { success: true, message: 'Category deleted successfully' };
    } catch (error) {
      logger.error('Failed to delete expense category:', error);
      throw error;
    }
  }

  /**
   * Count payments associated with a category
   * @param {number} categoryId - Category ID
   * @returns {Promise<number>} Count of associated payments
   */
  async countPaymentsByCategory(categoryId) {
    try {
      // Count bank payments
      const { count: bankCount, error: bankError } = await supabase
        .from('payments')
        .select('*', { count: 'exact', head: true })
        .eq('expense_category_id', categoryId);

      if (bankError) {
        logger.error('Error counting bank payments by category:', bankError);
        throw bankError;
      }

      // Count manual entries
      const { count: manualCount, error: manualError } = await supabase
        .from('pnl_manual_entries')
        .select('*', { count: 'exact', head: true })
        .eq('expense_category_id', categoryId);

      if (manualError) {
        logger.error('Error counting manual entries by category:', manualError);
        throw manualError;
      }

      return (bankCount || 0) + (manualCount || 0);
    } catch (error) {
      logger.error('Failed to count payments by category:', error);
      throw error;
    }
  }

  /**
   * Reorder a category (move up or down)
   * @param {number} categoryId - Category ID to reorder
   * @param {string} direction - 'up' or 'down'
   * @returns {Promise<Object>} Updated category object
   */
  async reorderCategory(categoryId, direction) {
    try {
      if (direction !== 'up' && direction !== 'down') {
        throw new Error('Direction must be "up" or "down"');
      }

      // Get current category
      const currentCategory = await this.getCategoryById(categoryId);
      if (!currentCategory) {
        throw new Error('Category not found');
      }

      // Check if display_order column exists
      if (currentCategory.display_order === undefined) {
        throw new Error('Category ordering is not available. Please run migration to add display_order column.');
      }

      // Get all categories ordered by display_order
      const allCategories = await this.listCategories();

      // Find current category index in sorted list
      const currentIndex = allCategories.findIndex(cat => cat.id === categoryId);
      if (currentIndex === -1) {
        throw new Error('Category not found in list');
      }

      // Calculate target index
      const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;

      // Check boundaries
      if (targetIndex < 0 || targetIndex >= allCategories.length) {
        throw new Error(`Cannot move category ${direction === 'up' ? 'up' : 'down'}: already at ${direction === 'up' ? 'top' : 'bottom'}`);
      }

      // Get category to swap with
      const swapCategory = allCategories[targetIndex];
      if (!swapCategory) {
        throw new Error(`Cannot move category ${direction === 'up' ? 'up' : 'down'}: already at ${direction === 'up' ? 'top' : 'bottom'}`);
      }

      // Get display_order values (handle NULL as 0 for comparison, but preserve NULL in DB)
      const currentOrder = currentCategory.display_order ?? null;
      const swapOrder = swapCategory.display_order ?? null;

      // Update both categories in a transaction-like manner
      const { error: error1 } = await supabase
        .from(this.tableName)
        .update({ 
          display_order: swapOrder,
          updated_at: new Date().toISOString()
        })
        .eq('id', categoryId);

      if (error1) {
        logger.error('Error updating category order:', error1);
        throw error1;
      }

      const { error: error2 } = await supabase
        .from(this.tableName)
        .update({ 
          display_order: currentOrder,
          updated_at: new Date().toISOString()
        })
        .eq('id', swapCategory.id);

      if (error2) {
        logger.error('Error updating swap category order:', error2);
        throw error2;
      }

      // Return updated category
      const updatedCategory = await this.getCategoryById(categoryId);
      logger.info(`Reordered expense category: ${updatedCategory.name} (ID: ${categoryId}) ${direction}`);
      return updatedCategory;
    } catch (error) {
      logger.error('Failed to reorder expense category:', error);
      throw error;
    }
  }
}

module.exports = ExpenseCategoryService;

