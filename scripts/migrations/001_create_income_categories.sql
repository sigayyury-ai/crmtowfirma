-- Migration: Create Income Categories Support
-- Date: 2025-11-18
-- Description: Creates pnl_revenue_categories table and adds income_category_id columns to payments tables

-- Step 1: Create pnl_revenue_categories table
CREATE TABLE IF NOT EXISTS pnl_revenue_categories (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  description TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Step 2: Add income_category_id to payments table
ALTER TABLE payments 
  ADD COLUMN IF NOT EXISTS income_category_id INTEGER 
  REFERENCES pnl_revenue_categories(id) ON DELETE SET NULL;

-- Step 3: Add income_category_id to stripe_payments table
ALTER TABLE stripe_payments 
  ADD COLUMN IF NOT EXISTS income_category_id INTEGER 
  REFERENCES pnl_revenue_categories(id) ON DELETE SET NULL;

-- Step 4: Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_payments_income_category ON payments(income_category_id);
CREATE INDEX IF NOT EXISTS idx_stripe_payments_income_category ON stripe_payments(income_category_id);







