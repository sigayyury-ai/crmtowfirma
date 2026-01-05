-- Migration: Create stripe_payment_locks table for distributed locks
-- Purpose: Prevent race conditions when creating multiple checkout sessions for the same deal
-- Date: 2025-01-05

CREATE TABLE IF NOT EXISTS stripe_payment_locks (
  id BIGSERIAL PRIMARY KEY,
  lock_key VARCHAR(255) NOT NULL UNIQUE,
  lock_id VARCHAR(255) NOT NULL,
  deal_id VARCHAR(255) NOT NULL,
  lock_type VARCHAR(100) NOT NULL DEFAULT 'payment_creation',
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Indexes for performance
  CONSTRAINT stripe_payment_locks_lock_key_unique UNIQUE (lock_key)
);

-- Index for cleanup queries
CREATE INDEX IF NOT EXISTS idx_stripe_payment_locks_expires_at 
  ON stripe_payment_locks(expires_at);

-- Index for deal_id lookups
CREATE INDEX IF NOT EXISTS idx_stripe_payment_locks_deal_id 
  ON stripe_payment_locks(deal_id);

-- Index for lock_type queries
CREATE INDEX IF NOT EXISTS idx_stripe_payment_locks_lock_type 
  ON stripe_payment_locks(lock_type);

-- Add comment
COMMENT ON TABLE stripe_payment_locks IS 'Distributed locks for preventing race conditions in Stripe payment processing';
COMMENT ON COLUMN stripe_payment_locks.lock_key IS 'Unique key for the lock (deal_id + lock_type)';
COMMENT ON COLUMN stripe_payment_locks.lock_id IS 'Unique identifier for this specific lock instance';
COMMENT ON COLUMN stripe_payment_locks.deal_id IS 'Pipedrive deal ID';
COMMENT ON COLUMN stripe_payment_locks.lock_type IS 'Type of lock (payment_creation, webhook_processing, etc.)';
COMMENT ON COLUMN stripe_payment_locks.expires_at IS 'When the lock expires (auto-cleanup)';

