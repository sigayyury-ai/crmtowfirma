-- SQL запросы для проверки структуры таблицы google_meet_reminders
-- Выполните эти запросы в Supabase SQL Editor

-- 1. Проверка существования таблицы и структуры
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_name = 'google_meet_reminders'
ORDER BY ordinal_position;

-- 2. Проверка индексов
SELECT 
    indexname,
    indexdef
FROM pg_indexes
WHERE tablename = 'google_meet_reminders';

-- 3. Проверка ограничений (constraints)
SELECT 
    conname AS constraint_name,
    contype AS constraint_type,
    pg_get_constraintdef(oid) AS constraint_definition
FROM pg_constraint
WHERE conrelid = 'google_meet_reminders'::regclass;

-- 4. Проверка комментариев
SELECT 
    obj_description('google_meet_reminders'::regclass, 'pg_class') AS table_comment;

SELECT 
    a.attname AS column_name,
    col_description(a.attrelid, a.attnum) AS column_comment
FROM pg_attribute a
WHERE a.attrelid = 'google_meet_reminders'::regclass
    AND a.attnum > 0
    AND NOT a.attisdropped
ORDER BY a.attnum;

-- 5. Тестовая вставка (опционально - для проверки работы)
-- INSERT INTO google_meet_reminders (
--     task_id,
--     event_id,
--     event_summary,
--     client_email,
--     contact_type,
--     meet_link,
--     meeting_time,
--     reminder_type,
--     scheduled_time
-- ) VALUES (
--     'test-' || extract(epoch from now())::text,
--     'test-event-id',
--     'Test Meeting',
--     'test@example.com',
--     'telegram',
--     'https://meet.google.com/test',
--     now() + interval '1 hour',
--     '30min',
--     now() + interval '30 minutes'
-- );

-- 6. Проверка статистики таблицы
SELECT 
    COUNT(*) AS total_rows,
    COUNT(*) FILTER (WHERE sent = false) AS pending_tasks,
    COUNT(*) FILTER (WHERE sent = true) AS sent_tasks
FROM google_meet_reminders;

