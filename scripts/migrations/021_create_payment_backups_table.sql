-- Migration: Create payment_backups table for pre-import snapshots
-- Auto-cleanup after 24 hours

CREATE TABLE IF NOT EXISTS payment_backups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id UUID REFERENCES payment_imports(id) ON DELETE CASCADE,
  backup_type TEXT NOT NULL DEFAULT 'pre_import', -- 'pre_import', 'manual'
  payments_count INTEGER NOT NULL DEFAULT 0,
  payments_data JSONB NOT NULL, -- Array of payment records
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
  deleted_at TIMESTAMPTZ
);

-- Index for cleanup job
CREATE INDEX IF NOT EXISTS idx_payment_backups_expires_at 
ON payment_backups(expires_at) 
WHERE deleted_at IS NULL;

-- Index for finding backup by import
CREATE INDEX IF NOT EXISTS idx_payment_backups_import_id 
ON payment_backups(import_id);

-- Comment
COMMENT ON TABLE payment_backups IS 'Pre-import payment snapshots for recovery. Auto-deleted after 24 hours.';
COMMENT ON COLUMN payment_backups.payments_data IS 'JSONB array of payment records with categories and proforma links';
