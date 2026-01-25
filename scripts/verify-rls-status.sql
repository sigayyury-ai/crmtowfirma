-- SQL запросы для проверки статуса Row Level Security (RLS) на таблицах
-- Выполните эти запросы в Supabase SQL Editor после применения миграции 018

-- 1. Проверка статуса RLS на всех таблицах из списка ошибок
SELECT 
    schemaname,
    tablename,
    rowsecurity AS rls_enabled
FROM pg_tables
WHERE schemaname = 'public'
    AND tablename IN (
        'cash_payments',
        'categorization_rules',
        'proforma_products',
        'payment_matching_history',
        'proformas',
        'product_links',
        'proforma_deletion_logs',
        'products',
        'payment_imports',
        'stripe_documents',
        'stripe_payment_deletions',
        'pnl_manual_entries',
        'pnl_revenue_categories',
        'expense_category_mappings',
        'cash_payment_events',
        'stripe_payment_test_runs',
        'cash_refunds',
        'google_meet_reminders',
        'stripe_payments',
        'payment_product_links',
        'hidden_cron_tasks',
        'stripe_event_items',
        'stripe_event_summary',
        'stripe_event_participants',
        'stripe_event_aggregation_jobs',
        'proforma_reminder_logs',
        'mql_leads',
        'mql_monthly_snapshots',
        'proforma_adjustments',
        'payments',
        'stripe_payment_locks',
        'stripe_reminder_logs'
    )
ORDER BY tablename;

-- 2. Проверка таблиц, где RLS НЕ включен (должно быть пусто после миграции)
SELECT 
    schemaname,
    tablename,
    rowsecurity AS rls_enabled
FROM pg_tables
WHERE schemaname = 'public'
    AND tablename IN (
        'cash_payments',
        'categorization_rules',
        'proforma_products',
        'payment_matching_history',
        'proformas',
        'product_links',
        'proforma_deletion_logs',
        'products',
        'payment_imports',
        'stripe_documents',
        'stripe_payment_deletions',
        'pnl_manual_entries',
        'pnl_revenue_categories',
        'expense_category_mappings',
        'cash_payment_events',
        'stripe_payment_test_runs',
        'cash_refunds',
        'google_meet_reminders',
        'stripe_payments',
        'payment_product_links',
        'hidden_cron_tasks',
        'stripe_event_items',
        'stripe_event_summary',
        'stripe_event_participants',
        'stripe_event_aggregation_jobs',
        'proforma_reminder_logs',
        'mql_leads',
        'mql_monthly_snapshots',
        'proforma_adjustments',
        'payments',
        'stripe_payment_locks',
        'stripe_reminder_logs'
    )
    AND rowsecurity = false
ORDER BY tablename;

-- 3. Подсчет таблиц с включенным RLS
SELECT 
    COUNT(*) AS total_tables,
    COUNT(*) FILTER (WHERE rowsecurity = true) AS rls_enabled_count,
    COUNT(*) FILTER (WHERE rowsecurity = false) AS rls_disabled_count
FROM pg_tables
WHERE schemaname = 'public'
    AND tablename IN (
        'cash_payments',
        'categorization_rules',
        'proforma_products',
        'payment_matching_history',
        'proformas',
        'product_links',
        'proforma_deletion_logs',
        'products',
        'payment_imports',
        'stripe_documents',
        'stripe_payment_deletions',
        'pnl_manual_entries',
        'pnl_revenue_categories',
        'expense_category_mappings',
        'cash_payment_events',
        'stripe_payment_test_runs',
        'cash_refunds',
        'google_meet_reminders',
        'stripe_payments',
        'payment_product_links',
        'hidden_cron_tasks',
        'stripe_event_items',
        'stripe_event_summary',
        'stripe_event_participants',
        'stripe_event_aggregation_jobs',
        'proforma_reminder_logs',
        'mql_leads',
        'mql_monthly_snapshots',
        'proforma_adjustments',
        'payments',
        'stripe_payment_locks',
        'stripe_reminder_logs'
    );

-- 4. Проверка RLS политик (если они были созданы)
SELECT 
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual,
    with_check
FROM pg_policies
WHERE schemaname = 'public'
    AND tablename IN (
        'cash_payments',
        'categorization_rules',
        'proforma_products',
        'payment_matching_history',
        'proformas',
        'product_links',
        'proforma_deletion_logs',
        'products',
        'payment_imports',
        'stripe_documents',
        'stripe_payment_deletions',
        'pnl_manual_entries',
        'pnl_revenue_categories',
        'expense_category_mappings',
        'cash_payment_events',
        'stripe_payment_test_runs',
        'cash_refunds',
        'google_meet_reminders',
        'stripe_payments',
        'payment_product_links',
        'hidden_cron_tasks',
        'stripe_event_items',
        'stripe_event_summary',
        'stripe_event_participants',
        'stripe_event_aggregation_jobs',
        'proforma_reminder_logs',
        'mql_leads',
        'mql_monthly_snapshots',
        'proforma_adjustments',
        'payments',
        'stripe_payment_locks',
        'stripe_reminder_logs'
    )
ORDER BY tablename, policyname;





