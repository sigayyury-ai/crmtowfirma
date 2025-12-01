-- Создание таблицы для хранения скрытых задач cron
-- Эта таблица используется для отслеживания задач, которые были удалены из очереди пользователем

CREATE TABLE IF NOT EXISTS public.hidden_cron_tasks (
    id BIGSERIAL PRIMARY KEY,
    deal_id INTEGER NOT NULL,
    task_type VARCHAR(50) NOT NULL,
    second_payment_date DATE NOT NULL,
    hidden_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Уникальный индекс для предотвращения дубликатов
    UNIQUE(deal_id, task_type, second_payment_date)
);

-- Комментарии к таблице и колонкам
COMMENT ON TABLE public.hidden_cron_tasks IS 'Таблица для хранения скрытых задач cron, удаленных пользователем из очереди';
COMMENT ON COLUMN public.hidden_cron_tasks.deal_id IS 'ID сделки в Pipedrive';
COMMENT ON COLUMN public.hidden_cron_tasks.task_type IS 'Тип задачи: stripe_second_payment, proforma_reminder, manual_rest';
COMMENT ON COLUMN public.hidden_cron_tasks.second_payment_date IS 'Дата второго платежа (для идентификации конкретной задачи)';
COMMENT ON COLUMN public.hidden_cron_tasks.hidden_at IS 'Дата и время скрытия задачи';

-- Индекс для быстрого поиска скрытых задач
CREATE INDEX IF NOT EXISTS idx_hidden_cron_tasks_lookup 
ON public.hidden_cron_tasks(deal_id, task_type, second_payment_date);

