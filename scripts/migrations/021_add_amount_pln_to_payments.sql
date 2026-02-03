-- Migration: Add amount_pln and currency_exchange columns to payments table
-- Date: 2026-02-03
-- Description: Adds amount_pln and currency_exchange columns to payments table for storing PLN-converted amounts and exchange rates

-- Add amount_pln column to payments table
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS amount_pln NUMERIC(15, 2);

COMMENT ON COLUMN payments.amount_pln IS 'Payment amount converted to PLN for reporting. Calculated when payment is loaded into database.';

-- Add currency_exchange column to payments table (if not exists)
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS currency_exchange NUMERIC(10, 6);

COMMENT ON COLUMN payments.currency_exchange IS 'Exchange rate used to convert payment amount to PLN. Stored when payment is loaded into database.';

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_payments_amount_pln ON payments(amount_pln) WHERE amount_pln IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payments_currency_exchange ON payments(currency_exchange) WHERE currency_exchange IS NOT NULL;
