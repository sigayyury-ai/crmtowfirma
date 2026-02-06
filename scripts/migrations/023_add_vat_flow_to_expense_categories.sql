-- Migration: Add VAT flow to expense categories and optional override on payments
-- Feature: 018-accounting-foundation-vat-flows
-- Date: 2026-02-06
-- Description: vat_flow on pnl_expense_categories (margin_scheme | general);
--               optional vat_flow_override on payments for expense classification.

-- 1. Add vat_flow to pnl_expense_categories
ALTER TABLE pnl_expense_categories
  ADD COLUMN IF NOT EXISTS vat_flow VARCHAR(20) DEFAULT 'general';

-- Constrain allowed values
ALTER TABLE pnl_expense_categories
  DROP CONSTRAINT IF EXISTS pnl_expense_categories_vat_flow_check;
ALTER TABLE pnl_expense_categories
  ADD CONSTRAINT pnl_expense_categories_vat_flow_check
  CHECK (vat_flow IN ('margin_scheme', 'general'));

-- Backfill existing rows
UPDATE pnl_expense_categories
SET vat_flow = 'general'
WHERE vat_flow IS NULL OR vat_flow NOT IN ('margin_scheme', 'general');

-- Make NOT NULL after backfill
ALTER TABLE pnl_expense_categories
  ALTER COLUMN vat_flow SET DEFAULT 'general';
ALTER TABLE pnl_expense_categories
  ALTER COLUMN vat_flow SET NOT NULL;

COMMENT ON COLUMN pnl_expense_categories.vat_flow IS 'Default VAT flow for expenses in this category when not product-linked: margin_scheme (Art. 119) or general (ordinary deductible VAT).';

-- 2. Add vat_flow_override to payments (nullable; only used when direction = out)
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS vat_flow_override VARCHAR(20);

ALTER TABLE payments
  DROP CONSTRAINT IF EXISTS payments_vat_flow_override_check;
ALTER TABLE payments
  ADD CONSTRAINT payments_vat_flow_override_check
  CHECK (vat_flow_override IS NULL OR vat_flow_override IN ('margin_scheme', 'general'));

COMMENT ON COLUMN payments.vat_flow_override IS 'Optional override for effective VAT flow (margin_scheme | general). Only for direction=out. NULL = use rule (product link -> category -> default general).';

-- 3. Index for filtering expenses by category vat_flow (reports)
CREATE INDEX IF NOT EXISTS idx_pnl_expense_categories_vat_flow
  ON pnl_expense_categories(vat_flow);

-- Optional: index for filtering payments by vat_flow_override when present
CREATE INDEX IF NOT EXISTS idx_payments_vat_flow_override
  ON payments(vat_flow_override) WHERE vat_flow_override IS NOT NULL AND direction = 'out';
