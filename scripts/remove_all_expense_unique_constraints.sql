-- Migration: Remove ALL unique constraints for expense entries
-- Date: 2026-01-13
-- Description: Removes all unique constraints/indexes that prevent multiple expense entries per category/month

-- Step 1: Drop the old unique constraint from migration 003 (if it still exists)
DROP INDEX IF EXISTS pnl_manual_entries_category_id_year_month_key;
DROP INDEX IF EXISTS pnl_manual_entries_category_id_year_month_idx;
DROP INDEX IF EXISTS pnl_manual_entries_unique;

-- Also try to drop as constraint
ALTER TABLE pnl_manual_entries DROP CONSTRAINT IF EXISTS pnl_manual_entries_category_id_year_month_key;
ALTER TABLE pnl_manual_entries DROP CONSTRAINT IF EXISTS pnl_manual_entries_unique;

-- Step 2: Drop the expense-specific unique index from migration 004
DROP INDEX IF EXISTS pnl_manual_entries_expense_unique;

-- Step 3: Add non-unique performance indexes for expense entries
CREATE INDEX IF NOT EXISTS idx_pnl_manual_entries_expense_category_year_month 
    ON pnl_manual_entries(expense_category_id, year, month) 
    WHERE entry_type = 'expense';

CREATE INDEX IF NOT EXISTS idx_pnl_manual_entries_expense_category_year 
    ON pnl_manual_entries(expense_category_id, year) 
    WHERE entry_type = 'expense';

-- Step 4: Verify that revenue unique constraint still exists (should not be dropped)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes 
        WHERE indexname = 'pnl_manual_entries_revenue_unique'
    ) THEN
        RAISE WARNING 'Revenue unique index not found - revenue entries may not have uniqueness constraint';
    ELSE
        RAISE NOTICE 'Revenue unique index exists - OK';
    END IF;
END $$;

-- Step 5: Add comments
COMMENT ON INDEX idx_pnl_manual_entries_expense_category_year_month IS 
    'Non-unique index for querying all expense entries for a category/month (allows multiple entries)';

COMMENT ON INDEX idx_pnl_manual_entries_expense_category_year IS 
    'Index for querying all expense entries for a category across a year (for aggregation)';

