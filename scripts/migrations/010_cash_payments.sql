-- Migration: Hybrid Cash Payments Foundation
-- Date: 2025-11-23
-- Description: Creates cash_payments + audit tables, extends proformas with cash aggregates,
--              links P&L revenue entries to cash payments and seeds a dedicated revenue category.

-- Step 1: cash_payments table (core storage for hybrid cash records)
CREATE TABLE IF NOT EXISTS cash_payments (
  id BIGSERIAL PRIMARY KEY,
  deal_id BIGINT NOT NULL,
  proforma_id TEXT REFERENCES proformas(id) ON DELETE SET NULL,
  proforma_fullnumber VARCHAR(255),
  cash_expected_amount NUMERIC(15, 2) NOT NULL DEFAULT 0,
  cash_received_amount NUMERIC(15, 2),
  currency VARCHAR(3) NOT NULL DEFAULT 'PLN',
  amount_pln NUMERIC(15, 2),
  status VARCHAR(32) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'pending_confirmation', 'received', 'refunded', 'cancelled')),
  source VARCHAR(32) NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'crm', 'stripe')),
  expected_date DATE,
  confirmed_at TIMESTAMP WITH TIME ZONE,
  confirmed_by VARCHAR(255),
  created_by VARCHAR(255),
  note TEXT,
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE cash_payments IS 'Hybrid cash payments linked to deals/proformas (expected vs received amounts).';
COMMENT ON COLUMN cash_payments.deal_id IS 'Pipedrive deal ID that initiated the cash expectation.';
COMMENT ON COLUMN cash_payments.cash_expected_amount IS 'Amount of cash we expect from the client (currency-native).';
COMMENT ON COLUMN cash_payments.cash_received_amount IS 'Factually received cash amount (currency-native).';
COMMENT ON COLUMN cash_payments.amount_pln IS 'Cash amount converted to PLN for reporting.';

CREATE INDEX IF NOT EXISTS idx_cash_payments_deal_id ON cash_payments(deal_id);
CREATE INDEX IF NOT EXISTS idx_cash_payments_proforma_id ON cash_payments(proforma_id);
CREATE INDEX IF NOT EXISTS idx_cash_payments_status ON cash_payments(status);

-- Maintain updated_at automatically
CREATE OR REPLACE FUNCTION update_cash_payments_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_update_cash_payments_updated_at ON cash_payments;
CREATE TRIGGER tr_update_cash_payments_updated_at
  BEFORE UPDATE ON cash_payments
  FOR EACH ROW
  EXECUTE FUNCTION update_cash_payments_updated_at();

-- Step 2: cash_payment_events (audit trail)
CREATE TABLE IF NOT EXISTS cash_payment_events (
  id BIGSERIAL PRIMARY KEY,
  cash_payment_id BIGINT NOT NULL REFERENCES cash_payments(id) ON DELETE CASCADE,
  event_type VARCHAR(64) NOT NULL,
  source VARCHAR(32),
  payload JSONB,
  created_by VARCHAR(255),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE cash_payment_events IS 'Audit log for any mutation on cash payments (create/update/confirm/refund).';
COMMENT ON COLUMN cash_payment_events.payload IS 'JSON snapshot of input payload / state delta.';

CREATE INDEX IF NOT EXISTS idx_cash_payment_events_payment_id
  ON cash_payment_events(cash_payment_id);

-- Step 3: cash_refunds (explicit history of returned cash)
CREATE TABLE IF NOT EXISTS cash_refunds (
  id BIGSERIAL PRIMARY KEY,
  cash_payment_id BIGINT NOT NULL REFERENCES cash_payments(id) ON DELETE CASCADE,
  amount NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  currency VARCHAR(3) NOT NULL DEFAULT 'PLN',
  reason TEXT,
  status VARCHAR(32) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processed', 'cancelled')),
  processed_by VARCHAR(255),
  processed_at TIMESTAMP WITH TIME ZONE,
  note TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE cash_refunds IS 'History of cash refunds/returns tied to a cash payment.';

CREATE INDEX IF NOT EXISTS idx_cash_refunds_payment_id
  ON cash_refunds(cash_payment_id);

-- Step 4: extend proformas with cash aggregates (currency + PLN)
ALTER TABLE proformas
  ADD COLUMN IF NOT EXISTS payments_total_cash NUMERIC(15, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payments_total_cash_pln NUMERIC(15, 2);

COMMENT ON COLUMN proformas.payments_total_cash IS 'Sum of confirmed cash payments in invoice currency.';
COMMENT ON COLUMN proformas.payments_total_cash_pln IS 'Sum of confirmed cash payments converted to PLN.';

-- Step 5: link pnl_revenue_entries to cash payments (if table exists)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_name = 'pnl_revenue_entries'
      AND table_schema = 'public'
  ) THEN
    EXECUTE $sql$
      ALTER TABLE pnl_revenue_entries
        ADD COLUMN IF NOT EXISTS cash_payment_id BIGINT REFERENCES cash_payments(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS cash_amount NUMERIC(15, 2);
    $sql$;

    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_pnl_revenue_entries_cash_payment_id ON pnl_revenue_entries(cash_payment_id);';

    EXECUTE 'COMMENT ON COLUMN pnl_revenue_entries.cash_payment_id IS ''Reference to cash_payments.id when entry originates from cash confirmation.'';';
    EXECUTE 'COMMENT ON COLUMN pnl_revenue_entries.cash_amount IS ''Amount (currency-native) that was recognized as cash revenue.'';';
  END IF;
END $$;

-- Step 6: No new revenue category is created.
-- Supabase already contains category "Приходы — Наличные"; cash workflow reuses it.

-- (Comments for pnl_revenue_entries columns are applied inside the DO block to avoid dependency on table existence.)
