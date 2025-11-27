-- Migration: Payment ↔ Product links
-- Date: 2025-11-27
-- Description: Creates payment_product_links table for manual association of bank payments with VAT Margin products.

-- Ensure pgcrypto is available for UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Core table storing the manual association between a bank payment and a product
CREATE TABLE IF NOT EXISTS payment_product_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id BIGINT NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  direction VARCHAR(16),
  linked_by VARCHAR(255),
  linked_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE payment_product_links IS 'Manual link between bank payments and VAT Margin products (for hybrid/manual scenarios).';
COMMENT ON COLUMN payment_product_links.payment_id IS 'payments.id that was manually linked to a product';
COMMENT ON COLUMN payment_product_links.product_id IS 'products.id that receives the manual payment attribution';
COMMENT ON COLUMN payment_product_links.direction IS 'Optional hint if payment is incoming/outgoing (in/out)';
COMMENT ON COLUMN payment_product_links.linked_by IS 'User identifier that performed the linking (email/login/etc).';

-- Make sure each payment can only be linked to one product simultaneously
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_product_links_payment_id
  ON payment_product_links(payment_id);

-- Indexes to speed up lookup by product and by product+date
CREATE INDEX IF NOT EXISTS idx_payment_product_links_product_id
  ON payment_product_links(product_id);

CREATE INDEX IF NOT EXISTS idx_payment_product_links_product_date
  ON payment_product_links(product_id, linked_at DESC);

