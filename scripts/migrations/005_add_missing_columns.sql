-- Migration: Add Missing Columns
-- Date: 2025-11-19
-- Description: Adds invoice_number, receipt_number to stripe_payments and buyer_city to proforma_deletion_logs

-- Step 1: Add invoice_number column to stripe_payments table
ALTER TABLE stripe_payments 
  ADD COLUMN IF NOT EXISTS invoice_number VARCHAR(255);

-- Step 2: Add receipt_number column to stripe_payments table
ALTER TABLE stripe_payments 
  ADD COLUMN IF NOT EXISTS receipt_number VARCHAR(255);

-- Step 3: Add buyer_city column to proforma_deletion_logs table
ALTER TABLE proforma_deletion_logs 
  ADD COLUMN IF NOT EXISTS buyer_city VARCHAR(255);

-- Step 4: Create indexes for performance (optional, but recommended)
CREATE INDEX IF NOT EXISTS idx_stripe_payments_invoice_number ON stripe_payments(invoice_number);
CREATE INDEX IF NOT EXISTS idx_stripe_payments_receipt_number ON stripe_payments(receipt_number);
CREATE INDEX IF NOT EXISTS idx_proforma_deletion_logs_buyer_city ON proforma_deletion_logs(buyer_city);

