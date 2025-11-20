-- Migration: Add buyer_country column to proforma_deletion_logs
-- Date: 2025-11-20
-- Description: Adds buyer_country column to proforma_deletion_logs table for tracking buyer country in deletion logs

-- Step 1: Add buyer_country column to proforma_deletion_logs table
ALTER TABLE proforma_deletion_logs 
  ADD COLUMN IF NOT EXISTS buyer_country VARCHAR(255);

-- Step 2: Create index for performance (optional, but recommended)
CREATE INDEX IF NOT EXISTS idx_proforma_deletion_logs_buyer_country ON proforma_deletion_logs(buyer_country);

