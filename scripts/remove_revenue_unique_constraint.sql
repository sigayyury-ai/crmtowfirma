-- Migration: Remove unique constraint for revenue entries
-- Date: 2026-01-13
-- Description: Removes the unique constraint on revenue entries to allow multiple entries per category/month
--              This enables the same functionality for revenue categories with management_type='manual' as for expenses

-- Step 1: Drop the revenue-specific unique index from migration 004
DROP INDEX IF EXISTS pnl_manual_entries_revenue_unique;

-- Step 2: Add non-unique performance indexes for revenue entries
CREATE INDEX IF NOT EXISTS idx_pnl_manual_entries_revenue_category_year_month 
    ON pnl_manual_entries(category_id, year, month) 
    WHERE entry_type = 'revenue' AND category_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pnl_manual_entries_revenue_category_year 
    ON pnl_manual_entries(category_id, year) 
    WHERE entry_type = 'revenue' AND category_id IS NOT NULL;

-- Step 3: Add comments
COMMENT ON INDEX idx_pnl_manual_entries_revenue_category_year_month IS 
    'Non-unique index for querying all revenue entries for a category/month (allows multiple entries)';

COMMENT ON INDEX idx_pnl_manual_entries_revenue_category_year IS 
    'Index for querying all revenue entries for a category across a year (for aggregation)';


