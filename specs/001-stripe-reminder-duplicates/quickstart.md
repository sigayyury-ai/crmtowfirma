# Quickstart: Защита от дубликатов напоминаний для Stripe платежей

**Feature**: 001-stripe-reminder-duplicates  
**Date**: 2026-01-11

## Overview

Система предотвращает отправку повторных напоминаний о втором платеже для Stripe платежей путем логирования всех отправленных напоминаний в базу данных и проверки истории перед каждой отправкой.

## Key Concepts

### Reminder Log Record
Запись в таблице `stripe_reminder_logs`, которая создается после успешной отправки напоминания через SendPulse. Содержит информацию о сделке, дате второго платежа, сессии Stripe и метаданных отправки.

### Duplicate Prevention
Защита от дубликатов работает на двух уровнях:
1. **История напоминаний**: Если напоминание уже было отправлено для комбинации `deal_id` + `second_payment_date`, оно не будет отправлено снова
2. **Статус оплаты**: Если второй платеж уже оплачен (>=90% от ожидаемой суммы), напоминание не отправляется независимо от истории

### Unique Constraint
Уникальный индекс на `(deal_id, second_payment_date)` гарантирует, что для каждой комбинации сделки и даты второго платежа может быть создана только одна запись в логах.

## Usage Flow

### 1. Creating Reminder Tasks

When `findReminderTasks()` is called:
1. System finds deals needing reminders
2. For each deal, checks `wasReminderSentEver(dealId, secondPaymentDate)`
3. If reminder was already sent, task is skipped
4. If not sent, task is added to list

### 2. Processing Reminders

When `processAllReminders()` is called:
1. System gets list of reminder tasks
2. For each task:
   - Checks payment status (if paid, skip)
   - Checks reminder history again (if sent, skip)
   - Sends reminder via SendPulse
   - If successful, creates log record via `persistReminderLog()`

### 3. Checking History

Method `wasReminderSentEver(dealId, secondPaymentDate)`:
1. Checks in-memory cache first (performance optimization)
2. Queries database: `SELECT id FROM stripe_reminder_logs WHERE deal_id = ? AND second_payment_date = ? LIMIT 1`
3. Returns `true` if record exists, `false` otherwise

### 4. Logging Reminder

Method `persistReminderLog()`:
1. Creates record with deal_id, second_payment_date, session_id, sendpulse_id, etc.
2. Inserts into `stripe_reminder_logs` table
3. Handles uniqueness violations gracefully (if concurrent insert occurs)

## Example Scenarios

### Scenario 1: First Reminder

**Given**: Deal #1234, second payment date 2026-01-15, no previous reminders  
**When**: Cron runs and processes reminders  
**Then**: 
- `wasReminderSentEver()` returns `false`
- Payment status checked (not paid)
- Reminder sent via SendPulse
- Log record created

### Scenario 2: Duplicate Prevention

**Given**: Deal #1234, second payment date 2026-01-15, reminder already sent yesterday  
**When**: Cron runs today  
**Then**:
- `wasReminderSentEver()` returns `true`
- Task skipped, no reminder sent

### Scenario 3: Payment Already Paid

**Given**: Deal #1234, second payment date 2026-01-15, payment already paid (>=90%)  
**When**: Cron runs  
**Then**:
- Payment status check returns "paid"
- Task skipped, no reminder sent (regardless of history)

### Scenario 4: Second Payment Date Changed

**Given**: Deal #1234, previous reminder sent for date 2026-01-15, date changed to 2026-01-20  
**When**: Cron runs  
**Then**:
- `wasReminderSentEver()` for new date (2026-01-20) returns `false`
- New reminder can be sent for new date

## Database Schema

```sql
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

CREATE UNIQUE INDEX IF NOT EXISTS uq_stripe_reminder_logs_unique
ON public.stripe_reminder_logs(deal_id, second_payment_date);
```

## Integration Points

### Service Methods

**`SecondPaymentSchedulerService`**:
- `wasReminderSentEver(dealId, secondPaymentDate)` - Check if reminder was ever sent
- `persistReminderLog(logData)` - Save reminder log record after successful send

### Existing Methods Modified

- `findReminderTasks()` - Add history check before adding tasks
- `processAllReminders()` - Add history and payment status checks before sending
- `sendReminder()` - Add log persistence after successful SendPulse delivery

## Testing

### Manual Testing

1. Send reminder for Deal #1234 with date 2026-01-15
2. Verify log record created in database
3. Try to send reminder again for same deal and date
4. Verify reminder is skipped (history check)

### Script Testing

Use diagnostic scripts to verify:
- Reminder history queries work correctly
- Unique constraint prevents duplicates
- Payment status checks work correctly

## Troubleshooting

### Issue: Reminder sent but no log record

**Check**: SendPulse delivery status, database connection, error logs  
**Solution**: Check if SendPulse delivery actually succeeded, verify database is accessible

### Issue: Duplicate reminders still sent

**Check**: Unique index exists, history check is called, payment status check works  
**Solution**: Verify unique constraint is created, check that `wasReminderSentEver()` is called in both places

### Issue: Reminders not sent even when payment not paid

**Check**: History check logic, payment status calculation  
**Solution**: Verify payment status calculation (>=90% threshold), check history query logic


