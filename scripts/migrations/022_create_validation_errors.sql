-- Migration: Validation Errors Table
-- Date: 2026-02-02
-- Description: Creates table for storing validation errors and warnings during payment session creation and processing

-- Ensure pgcrypto is available for UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Table: validation_errors
-- Purpose: Хранение ошибок валидации данных при создании сессий и обработке платежей
CREATE TABLE IF NOT EXISTS validation_errors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id TEXT NOT NULL,
  process_type VARCHAR(50) NOT NULL
    CHECK (process_type IN ('session_creation', 'payment_processing', 'webhook_processing')),
  process_id UUID NULL,
  errors JSONB NOT NULL DEFAULT '[]'::jsonb,
  data JSONB NULL,
  field_errors JSONB NULL DEFAULT '{}'::jsonb,
  missing_fields TEXT[] NULL DEFAULT '{}'::text[],
  invalid_fields TEXT[] NULL DEFAULT '{}'::text[],
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'resolved', 'ignored', 'warning')),
  severity VARCHAR(10) NOT NULL DEFAULT 'error'
    CHECK (severity IN ('error', 'warning')),
  resolved_at TIMESTAMPTZ NULL,
  resolved_by VARCHAR(255) NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE validation_errors IS 'Хранение ошибок и предупреждений валидации данных при создании платежных сессий и обработке платежей';
COMMENT ON COLUMN validation_errors.deal_id IS 'ID сделки в Pipedrive';
COMMENT ON COLUMN validation_errors.process_type IS 'Тип процесса: session_creation, payment_processing, webhook_processing';
COMMENT ON COLUMN validation_errors.process_id IS 'ID процесса (для связи с process_states, если будет создана)';
COMMENT ON COLUMN validation_errors.errors IS 'Массив ошибок валидации: [{field, message, code, severity?}]';
COMMENT ON COLUMN validation_errors.data IS 'Данные, которые не прошли валидацию (для отладки)';
COMMENT ON COLUMN validation_errors.field_errors IS 'Ошибки по полям: {"field": "error_message"}';
COMMENT ON COLUMN validation_errors.missing_fields IS 'Список недостающих обязательных полей';
COMMENT ON COLUMN validation_errors.invalid_fields IS 'Список полей с некорректными значениями';
COMMENT ON COLUMN validation_errors.status IS 'Статус обработки ошибки: pending, resolved, ignored, warning';
COMMENT ON COLUMN validation_errors.severity IS 'Уровень серьезности: error (блокирует создание сессии) или warning (не блокирует)';
COMMENT ON COLUMN validation_errors.resolved_at IS 'Время разрешения ошибки';
COMMENT ON COLUMN validation_errors.resolved_by IS 'Кто разрешил ошибку (user identifier)';

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_validation_errors_deal_id 
  ON validation_errors(deal_id);

CREATE INDEX IF NOT EXISTS idx_validation_errors_process_type 
  ON validation_errors(process_type);

CREATE INDEX IF NOT EXISTS idx_validation_errors_status 
  ON validation_errors(status) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_validation_errors_severity 
  ON validation_errors(severity);

CREATE INDEX IF NOT EXISTS idx_validation_errors_created_at 
  ON validation_errors(created_at DESC);

-- Composite index for common queries: deal_id + status + severity
CREATE INDEX IF NOT EXISTS idx_validation_errors_deal_status_severity 
  ON validation_errors(deal_id, status, severity) WHERE status = 'pending';

-- Maintain updated_at automatically
CREATE OR REPLACE FUNCTION update_validation_errors_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_update_validation_errors_updated_at ON validation_errors;
CREATE TRIGGER tr_update_validation_errors_updated_at
  BEFORE UPDATE ON validation_errors
  FOR EACH ROW
  EXECUTE FUNCTION update_validation_errors_updated_at();
