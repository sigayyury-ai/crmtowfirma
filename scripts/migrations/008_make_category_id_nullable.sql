-- Migration: Make category_id nullable in pnl_manual_entries
-- Date: 2025-11-20
-- Description: Allows category_id to be NULL for expense entries (expense_category_id will be set instead)

-- Step 1: Drop the NOT NULL constraint on category_id
ALTER TABLE pnl_manual_entries
  ALTER COLUMN category_id DROP NOT NULL;

-- Step 2: Add a CHECK constraint to ensure that either category_id (for revenue) or expense_category_id (for expense) is set
ALTER TABLE pnl_manual_entries
  DROP CONSTRAINT IF EXISTS pnl_manual_entries_category_check;

ALTER TABLE pnl_manual_entries
  ADD CONSTRAINT pnl_manual_entries_category_check 
  CHECK (
    (entry_type = 'revenue' AND category_id IS NOT NULL AND expense_category_id IS NULL) OR
    (entry_type = 'expense' AND expense_category_id IS NOT NULL AND category_id IS NULL)
  );

-- Step 3: Add comment
COMMENT ON CONSTRAINT pnl_manual_entries_category_check ON pnl_manual_entries IS 
  'Ensures that revenue entries have category_id set and expense entries have expense_category_id set';




