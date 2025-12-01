-- Добавление колонки payment_schedule в таблицу stripe_payments
-- Эта колонка хранит график платежей: '50/50' или '100%'

-- Проверяем существование колонки перед добавлением
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'stripe_payments' 
        AND column_name = 'payment_schedule'
    ) THEN
        ALTER TABLE public.stripe_payments
        ADD COLUMN payment_schedule VARCHAR(10) NULL;
        
        COMMENT ON COLUMN public.stripe_payments.payment_schedule IS 'График платежей: 50/50 или 100%';
    END IF;
END $$;

