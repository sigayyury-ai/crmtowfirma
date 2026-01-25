-- Migration: Facebook Ads Expenses Integration
-- Date: 2025-01-XX
-- Description: Creates tables for Facebook Ads expenses, campaign mappings, and import batches.

-- Ensure pgcrypto is available for UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Table 1: facebook_ads_campaign_mappings
-- Stores mapping of Facebook Ads campaign names to products
CREATE TABLE IF NOT EXISTS facebook_ads_campaign_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_name TEXT NOT NULL,
  campaign_name_normalized TEXT NOT NULL,
  product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_by VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE facebook_ads_campaign_mappings IS 'Mapping of Facebook Ads campaign names to products for expense attribution.';
COMMENT ON COLUMN facebook_ads_campaign_mappings.campaign_name IS 'Original campaign name from CSV file';
COMMENT ON COLUMN facebook_ads_campaign_mappings.campaign_name_normalized IS 'Normalized campaign name for matching (lowercase, trimmed, special chars removed)';
COMMENT ON COLUMN facebook_ads_campaign_mappings.product_id IS 'Product ID that receives the campaign expenses';
COMMENT ON COLUMN facebook_ads_campaign_mappings.created_by IS 'User identifier that created the mapping';

-- Indexes for facebook_ads_campaign_mappings
CREATE INDEX IF NOT EXISTS idx_facebook_ads_mappings_campaign 
  ON facebook_ads_campaign_mappings(campaign_name_normalized);

CREATE INDEX IF NOT EXISTS idx_facebook_ads_mappings_product 
  ON facebook_ads_campaign_mappings(product_id);

-- Unique constraint: one campaign can map to one product, but multiple campaigns can map to same product
CREATE UNIQUE INDEX IF NOT EXISTS idx_facebook_ads_mappings_unique
  ON facebook_ads_campaign_mappings(campaign_name_normalized, product_id);

-- Table 2: facebook_ads_expenses
-- Stores cumulative expenses by campaign and reporting period
CREATE TABLE IF NOT EXISTS facebook_ads_expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_name TEXT NOT NULL,
  campaign_name_normalized TEXT NOT NULL,
  product_id BIGINT REFERENCES products(id) ON DELETE SET NULL,
  report_start_date DATE NOT NULL,
  report_end_date DATE NOT NULL,
  amount_pln NUMERIC(12, 2) NOT NULL,
  currency VARCHAR(3) DEFAULT 'PLN',
  is_campaign_active BOOLEAN DEFAULT TRUE,
  import_batch_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE facebook_ads_expenses IS 'Cumulative Facebook Ads expenses by campaign and reporting period.';
COMMENT ON COLUMN facebook_ads_expenses.campaign_name IS 'Original campaign name from CSV';
COMMENT ON COLUMN facebook_ads_expenses.campaign_name_normalized IS 'Normalized campaign name for linking with mappings';
COMMENT ON COLUMN facebook_ads_expenses.product_id IS 'Product ID (from mapping, can be NULL if mapping not created)';
COMMENT ON COLUMN facebook_ads_expenses.report_start_date IS 'Start date of reporting period (YYYY-MM-DD)';
COMMENT ON COLUMN facebook_ads_expenses.report_end_date IS 'End date of reporting period (YYYY-MM-DD)';
COMMENT ON COLUMN facebook_ads_expenses.amount_pln IS 'Cumulative expense amount in PLN for the entire period';
COMMENT ON COLUMN facebook_ads_expenses.is_campaign_active IS 'Campaign status: false if expenses did not change between imports';
COMMENT ON COLUMN facebook_ads_expenses.import_batch_id IS 'Import batch ID for grouping imports';

-- Indexes for facebook_ads_expenses
CREATE INDEX IF NOT EXISTS idx_facebook_ads_expenses_campaign 
  ON facebook_ads_expenses(campaign_name_normalized);

CREATE INDEX IF NOT EXISTS idx_facebook_ads_expenses_product 
  ON facebook_ads_expenses(product_id);

CREATE INDEX IF NOT EXISTS idx_facebook_ads_expenses_dates 
  ON facebook_ads_expenses(report_start_date, report_end_date);

-- Unique constraint: prevent duplicates by campaign + period
CREATE UNIQUE INDEX IF NOT EXISTS idx_facebook_ads_expenses_unique
  ON facebook_ads_expenses(campaign_name_normalized, report_start_date, report_end_date);

-- Table 3: facebook_ads_import_batches
-- Stores import batch information for audit and rollback
CREATE TABLE IF NOT EXISTS facebook_ads_import_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name TEXT NOT NULL,
  file_hash TEXT,
  total_rows INTEGER DEFAULT 0,
  processed_rows INTEGER DEFAULT 0,
  mapped_rows INTEGER DEFAULT 0,
  unmapped_rows INTEGER DEFAULT 0,
  errors JSONB DEFAULT '[]'::jsonb,
  imported_by VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE facebook_ads_import_batches IS 'Import batch tracking for Facebook Ads CSV imports.';
COMMENT ON COLUMN facebook_ads_import_batches.file_name IS 'Name of uploaded CSV file';
COMMENT ON COLUMN facebook_ads_import_batches.file_hash IS 'SHA256 hash of file content to prevent duplicate imports';
COMMENT ON COLUMN facebook_ads_import_batches.total_rows IS 'Total number of rows in CSV file';
COMMENT ON COLUMN facebook_ads_import_batches.processed_rows IS 'Number of successfully processed rows';
COMMENT ON COLUMN facebook_ads_import_batches.mapped_rows IS 'Number of rows with existing mappings';
COMMENT ON COLUMN facebook_ads_import_batches.unmapped_rows IS 'Number of rows without mappings';
COMMENT ON COLUMN facebook_ads_import_batches.errors IS 'Array of error objects from import processing';
COMMENT ON COLUMN facebook_ads_import_batches.imported_by IS 'User identifier that performed the import';

-- Indexes for facebook_ads_import_batches
CREATE INDEX IF NOT EXISTS idx_facebook_ads_import_batches_hash 
  ON facebook_ads_import_batches(file_hash);

CREATE INDEX IF NOT EXISTS idx_facebook_ads_import_batches_created 
  ON facebook_ads_import_batches(created_at DESC);

-- Add foreign key for import_batch_id in expenses table
ALTER TABLE facebook_ads_expenses
  ADD CONSTRAINT fk_facebook_ads_expenses_import_batch
  FOREIGN KEY (import_batch_id)
  REFERENCES facebook_ads_import_batches(id)
  ON DELETE SET NULL;


