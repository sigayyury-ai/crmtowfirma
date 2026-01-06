-- Migration: Create stripe_payment_test_runs table for auto-test results
-- Purpose: Store test run results for Stripe payment auto-tests
-- Date: 2025-01-05

CREATE TABLE IF NOT EXISTS stripe_payment_test_runs (
  id BIGSERIAL PRIMARY KEY,
  run_id VARCHAR(255) NOT NULL UNIQUE,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ,
  duration_seconds NUMERIC(10, 2),
  total_tests INTEGER NOT NULL DEFAULT 0,
  passed_tests INTEGER NOT NULL DEFAULT 0,
  failed_tests INTEGER NOT NULL DEFAULT 0,
  skipped_tests INTEGER NOT NULL DEFAULT 0,
  test_results JSONB,
  errors JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Indexes for performance
  CONSTRAINT stripe_payment_test_runs_run_id_unique UNIQUE (run_id)
);

-- Index for time-based queries
CREATE INDEX IF NOT EXISTS idx_stripe_payment_test_runs_start_time 
  ON stripe_payment_test_runs(start_time DESC);

-- Index for filtering by status
CREATE INDEX IF NOT EXISTS idx_stripe_payment_test_runs_failed 
  ON stripe_payment_test_runs(failed_tests) 
  WHERE failed_tests > 0;

-- Add comment
COMMENT ON TABLE stripe_payment_test_runs IS 'Test run results for Stripe payment auto-tests';
COMMENT ON COLUMN stripe_payment_test_runs.run_id IS 'Unique identifier for this test run';
COMMENT ON COLUMN stripe_payment_test_runs.test_results IS 'JSON array of individual test results';
COMMENT ON COLUMN stripe_payment_test_runs.errors IS 'JSON array of errors encountered during test run';

