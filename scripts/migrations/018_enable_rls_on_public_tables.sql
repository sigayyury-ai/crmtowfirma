-- Migration: Enable Row Level Security (RLS) on all public tables
-- Purpose: Fix security linter errors - enable RLS on tables exposed via PostgREST API
-- Date: 2025-01-XX
-- Description: Enables RLS on all public tables to prevent unauthorized access through PostgREST API.
--              Service role key will still have full access as it bypasses RLS.

-- Enable RLS on all tables that were flagged by the security linter

-- Cash payments and related tables
ALTER TABLE IF EXISTS cash_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS cash_payment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS cash_refunds ENABLE ROW LEVEL SECURITY;

-- Categorization and rules
ALTER TABLE IF EXISTS categorization_rules ENABLE ROW LEVEL SECURITY;

-- Proforma tables
ALTER TABLE IF EXISTS proformas ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS proforma_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS proforma_deletion_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS proforma_reminder_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS proforma_adjustments ENABLE ROW LEVEL SECURITY;

-- Payment tables
ALTER TABLE IF EXISTS payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS payment_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS payment_matching_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS payment_product_links ENABLE ROW LEVEL SECURITY;

-- Product tables
ALTER TABLE IF EXISTS products ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS product_links ENABLE ROW LEVEL SECURITY;

-- Stripe tables
ALTER TABLE IF EXISTS stripe_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS stripe_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS stripe_payment_deletions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS stripe_payment_locks ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS stripe_payment_test_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS stripe_reminder_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS stripe_event_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS stripe_event_summary ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS stripe_event_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS stripe_event_aggregation_jobs ENABLE ROW LEVEL SECURITY;

-- PNL tables
ALTER TABLE IF EXISTS pnl_manual_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS pnl_revenue_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS expense_category_mappings ENABLE ROW LEVEL SECURITY;

-- Other tables
ALTER TABLE IF EXISTS google_meet_reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS hidden_cron_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS mql_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS mql_monthly_snapshots ENABLE ROW LEVEL SECURITY;

-- Note: With RLS enabled, these tables are now protected from unauthorized access
-- through PostgREST API. The service role key (used by server-side code) will
-- continue to have full access as it bypasses RLS policies.
--
-- If you need to allow specific access patterns through PostgREST API in the future,
-- you can create RLS policies using CREATE POLICY statements.





