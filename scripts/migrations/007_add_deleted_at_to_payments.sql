-- Добавить колонку deleted_at в таблицу payments для мягкого удаления
ALTER TABLE payments 
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;

-- Создать индекс для производительности (опционально)
CREATE INDEX IF NOT EXISTS idx_payments_deleted_at ON payments(deleted_at) WHERE deleted_at IS NOT NULL;

-- Комментарий к колонке
COMMENT ON COLUMN payments.deleted_at IS 'Timestamp when payment was soft-deleted. NULL means payment is active.';




