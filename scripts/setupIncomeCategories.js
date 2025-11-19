#!/usr/bin/env node

/**
 * Setup script for PNL Income Categories
 * Creates pnl_revenue_categories table and adds income_category_id columns to payments tables
 */

const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');

async function setupIncomeCategories() {
  logger.info('Starting income categories database setup...');

  try {
    // Step 1: Check if pnl_revenue_categories table exists
    logger.info('Checking pnl_revenue_categories table...');
    const checkTable = await supabase.from('pnl_revenue_categories').select('id').limit(1);
    if (checkTable.error && checkTable.error.code === 'PGRST205') {
      logger.warn('⚠ Table pnl_revenue_categories does not exist.');
      logger.warn('Please create it manually in Supabase SQL Editor:');
      logger.warn('');
      logger.warn('CREATE TABLE IF NOT EXISTS pnl_revenue_categories (');
      logger.warn('  id SERIAL PRIMARY KEY,');
      logger.warn('  name VARCHAR(255) NOT NULL UNIQUE,');
      logger.warn('  description TEXT,');
      logger.warn('  created_at TIMESTAMP DEFAULT NOW(),');
      logger.warn('  updated_at TIMESTAMP DEFAULT NOW()');
      logger.warn(');');
      logger.warn('');
    } else {
      logger.info('✓ pnl_revenue_categories table exists');
    }

    // Step 2: Check income_category_id in payments table
    logger.info('Checking income_category_id column in payments table...');
    const checkPaymentsColumn = await supabase.from('payments').select('income_category_id').limit(1);
    if (checkPaymentsColumn.error && checkPaymentsColumn.error.code === '42703') {
      logger.warn('⚠ Column income_category_id does not exist in payments table.');
      logger.warn('Please add it manually in Supabase SQL Editor:');
      logger.warn('');
      logger.warn('ALTER TABLE payments');
      logger.warn('  ADD COLUMN IF NOT EXISTS income_category_id INTEGER');
      logger.warn('  REFERENCES pnl_revenue_categories(id) ON DELETE SET NULL;');
      logger.warn('');
    } else {
      logger.info('✓ income_category_id column exists in payments table');
    }

    // Step 3: Check income_category_id in stripe_payments table
    logger.info('Checking income_category_id column in stripe_payments table...');
    const checkStripeColumn = await supabase.from('stripe_payments').select('income_category_id').limit(1);
    if (checkStripeColumn.error && checkStripeColumn.error.code === '42703') {
      logger.warn('⚠ Column income_category_id does not exist in stripe_payments table.');
      logger.warn('Please add it manually in Supabase SQL Editor:');
      logger.warn('');
      logger.warn('ALTER TABLE stripe_payments');
      logger.warn('  ADD COLUMN IF NOT EXISTS income_category_id INTEGER');
      logger.warn('  REFERENCES pnl_revenue_categories(id) ON DELETE SET NULL;');
      logger.warn('');
    } else {
      logger.info('✓ income_category_id column exists in stripe_payments table');
    }

    // Step 4: Note about indexes
    logger.info('Note: Create indexes manually in Supabase SQL Editor if needed:');
    logger.info('');
    logger.info('CREATE INDEX IF NOT EXISTS idx_payments_income_category ON payments(income_category_id);');
    logger.info('CREATE INDEX IF NOT EXISTS idx_stripe_payments_income_category ON stripe_payments(income_category_id);');
    logger.info('');

    logger.info('Database setup verification complete!');
    logger.info('Note: Some operations require manual execution in Supabase SQL Editor.');
    logger.info('Please run the SQL statements shown above if tables/columns/indexes are missing.');

  } catch (error) {
    logger.error('Error during database setup:', error);
    throw error;
  }
}

// Run if executed directly
if (require.main === module) {
  setupIncomeCategories()
    .then(() => {
      logger.info('Setup completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('Setup failed:', error);
      process.exit(1);
    });
}

module.exports = { setupIncomeCategories };

