-- Migration: Add manual entries support for PNL report
-- Adds management_type field to categories and creates pnl_manual_entries table

-- 1. Add management_type column to pnl_revenue_categories
ALTER TABLE pnl_revenue_categories
ADD COLUMN IF NOT EXISTS management_type VARCHAR(10) DEFAULT 'auto' CHECK (management_type IN ('auto', 'manual'));

-- Set all existing categories to 'auto' (explicit, even though it's default)
UPDATE pnl_revenue_categories
SET management_type = 'auto'
WHERE management_type IS NULL;

-- 2. Create pnl_manual_entries table
CREATE TABLE IF NOT EXISTS pnl_manual_entries (
    id SERIAL PRIMARY KEY,
    category_id INTEGER NOT NULL REFERENCES pnl_revenue_categories(id) ON DELETE CASCADE,
    year INTEGER NOT NULL CHECK (year >= 2020 AND year <= 2030),
    month INTEGER NOT NULL CHECK (month >= 1 AND month <= 12),
    amount_pln NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (amount_pln >= 0),
    currency_breakdown JSONB,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(category_id, year, month)
);

-- 3. Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_pnl_manual_entries_category_year 
    ON pnl_manual_entries(category_id, year);

CREATE INDEX IF NOT EXISTS idx_pnl_manual_entries_category_year_month 
    ON pnl_manual_entries(category_id, year, month);

-- 4. Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_pnl_manual_entries_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 5. Create trigger to auto-update updated_at
DROP TRIGGER IF EXISTS trigger_update_pnl_manual_entries_updated_at ON pnl_manual_entries;
CREATE TRIGGER trigger_update_pnl_manual_entries_updated_at
    BEFORE UPDATE ON pnl_manual_entries
    FOR EACH ROW
    EXECUTE FUNCTION update_pnl_manual_entries_updated_at();

-- 6. Add comment to table
COMMENT ON TABLE pnl_manual_entries IS 'Manual entries for PNL report categories with manual management type';
COMMENT ON COLUMN pnl_manual_entries.category_id IS 'Reference to pnl_revenue_categories';
COMMENT ON COLUMN pnl_manual_entries.year IS 'Year for the entry (2020-2030)';
COMMENT ON COLUMN pnl_manual_entries.month IS 'Month for the entry (1-12)';
COMMENT ON COLUMN pnl_manual_entries.amount_pln IS 'Amount in PLN';
COMMENT ON COLUMN pnl_manual_entries.currency_breakdown IS 'Optional JSON breakdown by currency';
COMMENT ON COLUMN pnl_manual_entries.notes IS 'Optional notes for the entry';



