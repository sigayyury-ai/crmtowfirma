-- Хранение фактов отправки напоминаний по проформам,
-- чтобы cron не отправлял одно и то же сообщение несколько раз в день

CREATE TABLE IF NOT EXISTS public.proforma_reminder_logs (
    id BIGSERIAL PRIMARY KEY,
    deal_id INTEGER NOT NULL,
    second_payment_date DATE NOT NULL,
    sent_date DATE NOT NULL DEFAULT CURRENT_DATE,
    sent_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    run_id UUID NULL,
    trigger_source VARCHAR(64) NULL,
    sendpulse_id VARCHAR(128) NULL,
    proforma_number TEXT NULL,
    message_hash TEXT NULL
);

COMMENT ON TABLE public.proforma_reminder_logs IS 'Журнал отправленных напоминаний о вторых платежах по проформам';
COMMENT ON COLUMN public.proforma_reminder_logs.second_payment_date IS 'Дата второго платежа из сделки';
COMMENT ON COLUMN public.proforma_reminder_logs.sent_date IS 'Календарный день, когда ушло напоминание (Europe/Warsaw)';
COMMENT ON COLUMN public.proforma_reminder_logs.run_id IS 'Run ID cron-циклов (scheduler)';
COMMENT ON COLUMN public.proforma_reminder_logs.trigger_source IS 'Источник запуска cron (cron_proforma_reminder, manual и т.п.)';
COMMENT ON COLUMN public.proforma_reminder_logs.sendpulse_id IS 'ID контакта в SendPulse, которому отправили сообщение';

-- Уникальность: одно напоминание на сделку/дату платежа/день
CREATE UNIQUE INDEX IF NOT EXISTS uq_proforma_reminder_logs_unique_per_day
ON public.proforma_reminder_logs(deal_id, second_payment_date, sent_date);


