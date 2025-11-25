-- Migration: Allow negative amounts in pnl_manual_entries
-- Date: 2025-11-20
-- Description: Removes the CHECK constraint that prevents negative amounts (needed for tax refunds and other negative expense entries)

-- Step 1: Drop the existing CHECK constraint on amount_pln
ALTER TABLE pnl_manual_entries
  DROP CONSTRAINT IF EXISTS pnl_manual_entries_amount_pln_check;

-- Step 2: Add comment explaining that negative values are allowed for expenses (e.g., tax refunds)
COMMENT ON COLUMN pnl_manual_entries.amount_pln IS 
  'Amount in PLN. Negative values are allowed for expense entries (e.g., tax refunds). Revenue entries should be non-negative.';




