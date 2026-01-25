-- Migration: Add checkout_url to stripe_payments
-- Date: 2026-01-05
-- Description: Adds checkout_url column to stripe_payments table for storing Stripe Checkout Session URLs

-- Add checkout_url column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_name = 'stripe_payments' 
    AND column_name = 'checkout_url'
  ) THEN
    ALTER TABLE stripe_payments 
    ADD COLUMN checkout_url TEXT;
    
    COMMENT ON COLUMN stripe_payments.checkout_url IS 'Stripe Checkout Session URL for payment notifications';
  END IF;
END $$;





