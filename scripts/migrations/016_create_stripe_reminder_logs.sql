-- Хранение фактов отправки напоминаний по Stripe платежам,
-- чтобы предотвратить отправку повторных напоминаний для одной и той же сделки и даты второго платежа

CREATE TABLE IF NOT EXISTS public.stripe_reminder_logs (
    id BIGSERIAL PRIMARY KEY,
    deal_id INTEGER NOT NULL,
    second_payment_date DATE NOT NULL,
    session_id TEXT NOT NULL,
    sent_date DATE NOT NULL DEFAULT CURRENT_DATE,
    sent_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    run_id UUID NULL,
    trigger_source VARCHAR(64) NULL,
    sendpulse_id VARCHAR(128) NULL,
    message_hash TEXT NULL
);

COMMENT ON TABLE public.stripe_reminder_logs IS 'Журнал отправленных напоминаний о вторых платежах по Stripe платежам';
COMMENT ON COLUMN public.stripe_reminder_logs.deal_id IS 'ID сделки в Pipedrive';
COMMENT ON COLUMN public.stripe_reminder_logs.second_payment_date IS 'Дата второго платежа из сделки (expected_close_date - 1 месяц)';
COMMENT ON COLUMN public.stripe_reminder_logs.session_id IS 'ID Stripe checkout session, для которой было отправлено напоминание';
COMMENT ON COLUMN public.stripe_reminder_logs.sent_date IS 'Календарный день, когда ушло напоминание (Europe/Warsaw)';
COMMENT ON COLUMN public.stripe_reminder_logs.sent_at IS 'Точное время отправки напоминания';
COMMENT ON COLUMN public.stripe_reminder_logs.run_id IS 'Run ID cron-циклов (scheduler)';
COMMENT ON COLUMN public.stripe_reminder_logs.trigger_source IS 'Источник запуска cron (cron_stripe_reminder, manual и т.п.)';
COMMENT ON COLUMN public.stripe_reminder_logs.sendpulse_id IS 'ID контакта в SendPulse, которому отправили сообщение';

-- Уникальность: одно напоминание на сделку/дату второго платежа (навсегда, не только на один день)
-- Это предотвращает отправку повторных напоминаний даже если cron запускается на разные дни
CREATE UNIQUE INDEX IF NOT EXISTS uq_stripe_reminder_logs_unique
ON public.stripe_reminder_logs(deal_id, second_payment_date);

-- Индексы для быстрого поиска
CREATE INDEX IF NOT EXISTS idx_stripe_reminder_logs_deal_id 
ON public.stripe_reminder_logs(deal_id);

CREATE INDEX IF NOT EXISTS idx_stripe_reminder_logs_sent_at 
ON public.stripe_reminder_logs(sent_at);

CREATE INDEX IF NOT EXISTS idx_stripe_reminder_logs_session_id 
ON public.stripe_reminder_logs(session_id);


