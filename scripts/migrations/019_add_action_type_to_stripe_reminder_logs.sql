-- Добавление поля action_type для различения типов действий:
-- 'session_created' - создание сессии
-- 'reminder_sent' - отправка напоминания

ALTER TABLE IF EXISTS public.stripe_reminder_logs
  ADD COLUMN IF NOT EXISTS action_type VARCHAR(32) DEFAULT 'reminder_sent';

-- Обновляем существующие записи
UPDATE public.stripe_reminder_logs
SET action_type = 'reminder_sent'
WHERE action_type IS NULL;

-- Устанавливаем NOT NULL после обновления
ALTER TABLE IF EXISTS public.stripe_reminder_logs
  ALTER COLUMN action_type SET NOT NULL;

-- Изменяем уникальный индекс, чтобы разрешить несколько записей для одной сделки и даты
-- (но с разными action_type)
DROP INDEX IF EXISTS uq_stripe_reminder_logs_unique;

CREATE UNIQUE INDEX IF NOT EXISTS uq_stripe_reminder_logs_unique
ON public.stripe_reminder_logs(deal_id, second_payment_date, action_type);

COMMENT ON COLUMN public.stripe_reminder_logs.action_type IS 'Тип действия: session_created (создание сессии) или reminder_sent (отправка напоминания)';


