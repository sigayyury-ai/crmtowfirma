-- Migration: Receipts Inbox Tables
-- Date: 2026-01-12
-- Description: Creates tables for receipt uploads, extractions, and payment links

-- Step 1: receipt_uploads table (core storage for uploaded documents)
CREATE TABLE IF NOT EXISTS receipt_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  storage_bucket TEXT,
  storage_path TEXT,
  original_filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  uploaded_by TEXT,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'uploaded'
    CHECK (status IN ('uploaded', 'processing', 'matched', 'failed')),
  deleted_at TIMESTAMPTZ NULL
);

COMMENT ON TABLE receipt_uploads IS 'Uploaded receipt/invoice documents (HEIC/JPG/PDF)';
COMMENT ON COLUMN receipt_uploads.storage_bucket IS 'Supabase Storage bucket name';
COMMENT ON COLUMN receipt_uploads.storage_path IS 'Path to file in storage bucket';
COMMENT ON COLUMN receipt_uploads.status IS 'Current processing status: uploaded, processing, matched, failed';

CREATE INDEX IF NOT EXISTS idx_receipt_uploads_uploaded_at ON receipt_uploads(uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_receipt_uploads_status ON receipt_uploads(status);
CREATE INDEX IF NOT EXISTS idx_receipt_uploads_deleted_at ON receipt_uploads(deleted_at) WHERE deleted_at IS NULL;

-- Step 2: receipt_extractions table (OCR/vision extraction results)
CREATE TABLE IF NOT EXISTS receipt_extractions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id UUID NOT NULL REFERENCES receipt_uploads(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'done', 'failed')),
  extracted_json JSONB DEFAULT '{}'::jsonb,
  error TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE receipt_extractions IS 'OCR/vision extraction results from receipt documents';
COMMENT ON COLUMN receipt_extractions.extracted_json IS 'Extracted fields: vendor, date, amount, currency, confidence, raw_text (optional)';

CREATE INDEX IF NOT EXISTS idx_receipt_extractions_receipt_id ON receipt_extractions(receipt_id);
CREATE INDEX IF NOT EXISTS idx_receipt_extractions_status ON receipt_extractions(status);

-- Maintain updated_at automatically
CREATE OR REPLACE FUNCTION update_receipt_extractions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_update_receipt_extractions_updated_at ON receipt_extractions;
CREATE TRIGGER tr_update_receipt_extractions_updated_at
  BEFORE UPDATE ON receipt_extractions
  FOR EACH ROW
  EXECUTE FUNCTION update_receipt_extractions_updated_at();

-- Step 3: receipt_payment_links table (confirmed links between receipts and payments)
CREATE TABLE IF NOT EXISTS receipt_payment_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id UUID NOT NULL REFERENCES receipt_uploads(id) ON DELETE CASCADE,
  payment_id BIGINT NOT NULL,
  linked_by TEXT,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(receipt_id)
);

COMMENT ON TABLE receipt_payment_links IS 'Confirmed links between receipt documents and bank payments';
COMMENT ON COLUMN receipt_payment_links.payment_id IS 'Reference to payments.id (BIGINT)';

CREATE INDEX IF NOT EXISTS idx_receipt_payment_links_receipt_id ON receipt_payment_links(receipt_id);
CREATE INDEX IF NOT EXISTS idx_receipt_payment_links_payment_id ON receipt_payment_links(payment_id);
CREATE INDEX IF NOT EXISTS idx_receipt_payment_links_linked_at ON receipt_payment_links(linked_at DESC);

