#!/usr/bin/env node

/**
 * Script to update all payments without category to "На счет" category
 * Creates the category if it doesn't exist
 */

const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');

const CATEGORY_NAME = 'На счет';

async function updatePaymentsToAccountCategory() {
  logger.info('Starting update of payments to "На счет" category...');

  try {
    // Step 1: Find or create "На счет" category
    logger.info('Looking for category "На счет"...');
    let { data: existingCategories, error: searchError } = await supabase
      .from('pnl_revenue_categories')
      .select('*')
      .ilike('name', CATEGORY_NAME)
      .limit(1);

    if (searchError) {
      logger.error('Error searching for category:', searchError);
      throw searchError;
    }

    let accountCategoryId;

    if (existingCategories && existingCategories.length > 0) {
      accountCategoryId = existingCategories[0].id;
      logger.info(`Found existing category "На счет" with ID: ${accountCategoryId}`);
    } else {
      // Create the category
      logger.info('Category "На счет" not found, creating it...');
      
      // Get max display_order
      const { data: maxOrderData } = await supabase
        .from('pnl_revenue_categories')
        .select('display_order')
        .order('display_order', { ascending: false })
        .limit(1)
        .single();

      const maxOrder = maxOrderData?.display_order || 0;
      const newOrder = maxOrder + 1;

      const { data: newCategory, error: createError } = await supabase
        .from('pnl_revenue_categories')
        .insert({
          name: CATEGORY_NAME,
          description: 'Платежи на счет',
          display_order: newOrder
        })
        .select()
        .single();

      if (createError) {
        logger.error('Error creating category:', createError);
        throw createError;
      }

      accountCategoryId = newCategory.id;
      logger.info(`Created category "На счет" with ID: ${accountCategoryId}`);
    }

    // Step 2: Count payments without category
    const { count: bankPaymentsCount } = await supabase
      .from('payments')
      .select('*', { count: 'exact', head: true })
      .is('income_category_id', null);

    const { count: stripePaymentsCount } = await supabase
      .from('stripe_payments')
      .select('*', { count: 'exact', head: true })
      .is('income_category_id', null);

    logger.info(`Found ${bankPaymentsCount || 0} bank payments and ${stripePaymentsCount || 0} Stripe payments without category`);

    // Step 3: Update bank payments
    if (bankPaymentsCount > 0) {
      logger.info(`Updating ${bankPaymentsCount} bank payments...`);
      const { error: updateBankError } = await supabase
        .from('payments')
        .update({ income_category_id: accountCategoryId })
        .is('income_category_id', null);

      if (updateBankError) {
        logger.error('Error updating bank payments:', updateBankError);
        throw updateBankError;
      }
      logger.info(`✓ Updated ${bankPaymentsCount} bank payments`);
    }

    // Step 4: Skip Stripe payments - they will be handled separately
    logger.info(`Skipping ${stripePaymentsCount || 0} Stripe payments (will be handled separately)`);

    logger.info('✅ Successfully updated bank payments to "На счет" category');
    logger.info(`Total updated: ${bankPaymentsCount || 0} bank payments`);

  } catch (error) {
    logger.error('Failed to update payments:', error);
    throw error;
  }
}

// Run if executed directly
if (require.main === module) {
  updatePaymentsToAccountCategory()
    .then(() => {
      logger.info('Script completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('Script failed:', error);
      process.exit(1);
    });
}

module.exports = { updatePaymentsToAccountCategory };

