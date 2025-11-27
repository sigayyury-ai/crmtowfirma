-- Migration: Cash Summary Monthly View
-- Date: 2025-11-23
-- Description: Adds product linkage to cash_payments and creates materialized view cash_summary_monthly
--              for aggregating hybrid cash metrics per product/month/currency.

-- Step 1: Ensure cash_payments can reference products directly
ALTER TABLE cash_payments
  ADD COLUMN IF NOT EXISTS product_id BIGINT REFERENCES products(id) ON DELETE SET NULL;

COMMENT ON COLUMN cash_payments.product_id IS 'Optional reference to products.id for direct cash → product mapping.';

CREATE INDEX IF NOT EXISTS idx_cash_payments_product_id ON cash_payments(product_id);

-- Step 2: Create / replace materialized view with monthly aggregates
DROP MATERIALIZED VIEW IF EXISTS cash_summary_monthly;

CREATE MATERIALIZED VIEW cash_summary_monthly AS
WITH payment_product AS (
  SELECT
    cp.id,
    cp.deal_id,
    cp.currency,
    cp.cash_expected_amount,
    cp.cash_received_amount,
    cp.amount_pln,
    cp.status,
    cp.confirmed_at,
    cp.expected_date,
    cp.created_at,
    cp.proforma_id,
    cp.source,
    COALESCE(cp.product_id, fallback.product_id) AS resolved_product_id,
    COALESCE(direct_product.name, fallback.product_name, 'Unassigned cash') AS resolved_product_name,
    date_trunc(
      'month',
      COALESCE(
        cp.confirmed_at,
        (cp.expected_date)::timestamp,
        (pr.issued_at)::timestamp,
        cp.created_at
      )
    )::date AS period_month,
    CASE
      WHEN cp.amount_pln IS NOT NULL THEN cp.amount_pln
      WHEN cp.currency = 'PLN' THEN cp.cash_expected_amount
      ELSE NULL
    END AS expected_amount_pln
  FROM cash_payments cp
  LEFT JOIN proformas pr ON pr.id = cp.proforma_id
  LEFT JOIN products direct_product ON direct_product.id = cp.product_id
  LEFT JOIN LATERAL (
    SELECT
      pp.product_id,
      COALESCE(prod2.name, pp.name) AS product_name
    FROM proforma_products pp
    LEFT JOIN products prod2 ON prod2.id = pp.product_id
    WHERE cp.proforma_id IS NOT NULL
      AND pp.proforma_id = cp.proforma_id
    ORDER BY pp.product_id NULLS LAST, pp.id
    LIMIT 1
  ) AS fallback ON true
)
SELECT
  period_month,
  resolved_product_id AS product_id,
  resolved_product_name AS product_name,
  currency,
  SUM(cash_expected_amount) AS expected_total,
  SUM(
    CASE
      WHEN status = 'received'
        THEN COALESCE(cash_received_amount, cash_expected_amount)
      ELSE 0
    END
  ) AS received_total,
  SUM(
    CASE
      WHEN status IN ('pending', 'pending_confirmation')
        THEN GREATEST(cash_expected_amount - COALESCE(cash_received_amount, 0), 0)
      ELSE 0
    END
  ) AS pending_total,
  SUM(
    CASE
      WHEN status = 'refunded'
        THEN COALESCE(cash_received_amount, cash_expected_amount)
      ELSE 0
    END
  ) AS refunded_total,
  SUM(COALESCE(expected_amount_pln, 0)) AS expected_total_pln,
  SUM(
    CASE
      WHEN status = 'received'
        THEN COALESCE(expected_amount_pln, 0)
      ELSE 0
    END
  ) AS received_total_pln,
  SUM(
    CASE
      WHEN status IN ('pending', 'pending_confirmation')
        THEN COALESCE(expected_amount_pln, 0)
      ELSE 0
    END
  ) AS pending_total_pln,
  SUM(
    CASE
      WHEN status = 'refunded'
        THEN COALESCE(expected_amount_pln, 0)
      ELSE 0
    END
  ) AS refunded_total_pln,
  COUNT(*) AS payments_count,
  COUNT(*) FILTER (WHERE status IN ('pending', 'pending_confirmation')) AS pending_count,
  COUNT(*) FILTER (WHERE status = 'received') AS received_count,
  COUNT(*) FILTER (WHERE status = 'refunded') AS refunded_count,
  MAX(COALESCE(confirmed_at, (expected_date)::timestamp, created_at)) AS last_activity_at
FROM payment_product
GROUP BY period_month, resolved_product_id, resolved_product_name, currency;

COMMENT ON MATERIALIZED VIEW cash_summary_monthly IS 'Monthly aggregated stats for hybrid cash payments grouped by product and currency.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_cash_summary_monthly_key
  ON cash_summary_monthly (
    period_month,
    COALESCE(product_id, -1),
    currency
  );

CREATE INDEX IF NOT EXISTS idx_cash_summary_monthly_product
  ON cash_summary_monthly (COALESCE(product_id, -1), period_month);
