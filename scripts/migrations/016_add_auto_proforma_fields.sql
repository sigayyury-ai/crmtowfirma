-- Migration: Add auto_proforma_id and auto_proforma_fullnumber columns
-- Date: 2025-12-04
-- Description: Adds auto_proforma_id and auto_proforma_fullnumber columns to payments table for suggested proforma matches

-- Step 1: Add auto_proforma_id column to payments table
ALTER TABLE payments 
  ADD COLUMN IF NOT EXISTS auto_proforma_id TEXT REFERENCES proformas(id) ON DELETE SET NULL;

-- Step 2: Add auto_proforma_fullnumber column to payments table
ALTER TABLE payments 
  ADD COLUMN IF NOT EXISTS auto_proforma_fullnumber VARCHAR(255);

-- Step 3: Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_payments_auto_proforma_id ON payments(auto_proforma_id) WHERE auto_proforma_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payments_auto_proforma_fullnumber ON payments(auto_proforma_fullnumber) WHERE auto_proforma_fullnumber IS NOT NULL;

-- Step 4: Add comments
COMMENT ON COLUMN payments.auto_proforma_id IS 'Suggested proforma ID from automatic matching. User must manually approve to link.';
COMMENT ON COLUMN payments.auto_proforma_fullnumber IS 'Suggested proforma full number from automatic matching. User must manually approve to link.';

