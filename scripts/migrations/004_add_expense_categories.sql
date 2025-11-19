-- Migration: Add expense categories support for PNL report
-- Adds management_type to expense categories, updates manual_entries, adds expense_category_id to payments, creates mappings table

-- 1. Add management_type column to pnl_expense_categories
ALTER TABLE pnl_expense_categories
ADD COLUMN IF NOT EXISTS management_type VARCHAR(10) DEFAULT 'auto' CHECK (management_type IN ('auto', 'manual'));

-- Set all existing categories to 'auto' (explicit, even though it's default)
UPDATE pnl_expense_categories
SET management_type = 'auto'
WHERE management_type IS NULL;

-- 2. Add display_order column to pnl_expense_categories (optional, for sorting)
ALTER TABLE pnl_expense_categories
ADD COLUMN IF NOT EXISTS display_order INTEGER;

-- 3. Add expense_category_id column to payments table
ALTER TABLE payments
ADD COLUMN IF NOT EXISTS expense_category_id INTEGER REFERENCES pnl_expense_categories(id) ON DELETE SET NULL;

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_payments_expense_category ON payments(expense_category_id);

-- 4. Update pnl_manual_entries table for expense support
-- Add entry_type column
ALTER TABLE pnl_manual_entries
ADD COLUMN IF NOT EXISTS entry_type VARCHAR(10) DEFAULT 'revenue' CHECK (entry_type IN ('revenue', 'expense'));

-- Update existing entries to 'revenue'
UPDATE pnl_manual_entries
SET entry_type = 'revenue'
WHERE entry_type IS NULL;

-- Add expense_category_id column
ALTER TABLE pnl_manual_entries
ADD COLUMN IF NOT EXISTS expense_category_id INTEGER REFERENCES pnl_expense_categories(id) ON DELETE CASCADE;

-- Drop old unique constraint if exists (may have different name)
DO $$
BEGIN
    -- Try to drop the old unique constraint/index
    DROP INDEX IF EXISTS pnl_manual_entries_category_id_year_month_key;
    DROP INDEX IF EXISTS pnl_manual_entries_category_id_year_month_idx;
    DROP INDEX IF EXISTS pnl_manual_entries_unique;
    -- Also try to drop constraint if it exists
    ALTER TABLE pnl_manual_entries DROP CONSTRAINT IF EXISTS pnl_manual_entries_category_id_year_month_key;
EXCEPTION
    WHEN OTHERS THEN
        -- Ignore errors if constraint/index doesn't exist
        NULL;
END $$;

-- Create partial unique indexes for revenue and expense entries separately
-- This is more reliable than COALESCE for Supabase upsert
CREATE UNIQUE INDEX IF NOT EXISTS pnl_manual_entries_revenue_unique 
    ON pnl_manual_entries(category_id, year, month) 
    WHERE entry_type = 'revenue' AND category_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS pnl_manual_entries_expense_unique 
    ON pnl_manual_entries(expense_category_id, year, month) 
    WHERE entry_type = 'expense' AND expense_category_id IS NOT NULL;

-- 5. Create expense_category_mappings table for automatic category detection
CREATE TABLE IF NOT EXISTS expense_category_mappings (
    id SERIAL PRIMARY KEY,
    pattern_type VARCHAR(20) NOT NULL CHECK (pattern_type IN ('category', 'description', 'payer')),
    pattern_value VARCHAR(255) NOT NULL,
    expense_category_id INTEGER NOT NULL REFERENCES pnl_expense_categories(id) ON DELETE CASCADE,
    priority INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(pattern_type, pattern_value)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_expense_category_mappings_category 
    ON expense_category_mappings(expense_category_id);

CREATE INDEX IF NOT EXISTS idx_expense_category_mappings_priority 
    ON expense_category_mappings(priority DESC);

-- Add comments
COMMENT ON TABLE expense_category_mappings IS 'Mappings for automatic expense category detection from CSV imports';
COMMENT ON COLUMN expense_category_mappings.pattern_type IS 'Type of pattern: category (from CSV), description (keywords), payer (payer name)';
COMMENT ON COLUMN expense_category_mappings.pattern_value IS 'Pattern value to match (exact for category, partial for description/payer)';
COMMENT ON COLUMN expense_category_mappings.priority IS 'Priority for applying mappings (higher = applied first)';

