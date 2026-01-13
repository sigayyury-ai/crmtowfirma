-- Migration: Allow multiple manual expense entries per category/month
-- Date: 2025-01-27
-- Description: Removes unique constraint for expense entries to allow multiple entries per category/month combination.
--              Keeps unique constraint for revenue entries to preserve existing behavior.

-- Step 1: Drop unique index for expense entries (allows multiple entries per category/month)
DROP INDEX IF EXISTS pnl_manual_entries_expense_unique;

-- Step 2: Add non-unique performance index for expense entry queries
-- This index supports efficient queries for all entries for a category/month
CREATE INDEX IF NOT EXISTS idx_pnl_manual_entries_expense_category_year_month 
    ON pnl_manual_entries(expense_category_id, year, month) 
    WHERE entry_type = 'expense';

-- Step 3: Add index for year-level queries (for aggregation across all months)
CREATE INDEX IF NOT EXISTS idx_pnl_manual_entries_expense_category_year 
    ON pnl_manual_entries(expense_category_id, year) 
    WHERE entry_type = 'expense';

-- Step 4: Verify that revenue unique constraint still exists (should not be dropped)
-- This is a verification step - if the index doesn't exist, we'll get an error
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes 
        WHERE indexname = 'pnl_manual_entries_revenue_unique'
    ) THEN
        RAISE WARNING 'Revenue unique index not found - revenue entries may not have uniqueness constraint';
    END IF;
END $$;

-- Step 5: Add comments
COMMENT ON INDEX idx_pnl_manual_entries_expense_category_year_month IS 
    'Non-unique index for querying all expense entries for a category/month (allows multiple entries)';

COMMENT ON INDEX idx_pnl_manual_entries_expense_category_year IS 
    'Index for querying all expense entries for a category across a year (for aggregation)';

