# Data Model: Stripe Reminder Logs

**Feature**: 001-stripe-reminder-duplicates  
**Date**: 2026-01-11

## Entity: Stripe Reminder Log

Represents a record of a successfully sent reminder notification for a Stripe payment deal. Used to prevent duplicate reminders and provide audit trail.

### Attributes

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| `id` | BIGSERIAL | PRIMARY KEY | Auto-incrementing unique identifier |
| `deal_id` | INTEGER | NOT NULL | Pipedrive deal ID |
| `second_payment_date` | DATE | NOT NULL | Date of second payment from deal (expected_close_date - 1 month) |
| `session_id` | TEXT | NOT NULL | Stripe checkout session ID that the reminder was for |
| `sent_date` | DATE | NOT NULL, DEFAULT CURRENT_DATE | Calendar day when reminder was sent (Europe/Warsaw timezone) |
| `sent_at` | TIMESTAMP WITH TIME ZONE | NOT NULL, DEFAULT NOW() | Exact timestamp when reminder was sent |
| `run_id` | UUID | NULL | Run ID from cron scheduler for correlation |
| `trigger_source` | VARCHAR(64) | NULL | Source of trigger (cron_stripe_reminder, manual, etc.) |
| `sendpulse_id` | VARCHAR(128) | NULL | SendPulse contact ID that received the reminder |
| `message_hash` | TEXT | NULL | Optional hash of message content for future deduplication |

### Relationships

- **One-to-Many with Deal**: Multiple reminder logs can exist for the same `deal_id` if `second_payment_date` changes
- **One-to-One with Stripe Session**: Each log references one `session_id` (but session can have multiple logs if date changes)

### Validation Rules

1. `deal_id` must reference a valid Pipedrive deal
2. `second_payment_date` must be a valid date
3. `session_id` must reference a valid Stripe checkout session
4. `sent_date` must be in Europe/Warsaw timezone
5. `sent_at` must be >= `sent_date` (timestamp is more precise than date)

### State Transitions

**Creation Flow**:
1. Reminder task created → Check history → If not sent, proceed
2. Payment status checked → If paid, skip
3. SendPulse message sent → If successful, create log record
4. Log record created → Unique constraint prevents duplicates

**No state transitions** - records are immutable once created (append-only log)

### Uniqueness Constraints

**Primary Constraint**: `(deal_id, second_payment_date)` - ensures only one reminder is ever sent for a specific deal and second payment date combination, regardless of calendar day.

**Rationale**: Since cron runs once per day, preventing duplicates only within a single day is insufficient. Once a reminder is sent for a deal and second payment date, it should never be sent again for that combination, even if cron runs on subsequent days.

### Indexes

1. **Primary Key**: `id` (automatic)
2. **Unique Index**: `(deal_id, second_payment_date)` - prevents duplicates
3. **Lookup Index**: `deal_id` - for quick queries by deal
4. **Audit Index**: `sent_at` - for time-based audit queries

### Query Patterns

**Common Queries**:
1. Check if reminder sent: `SELECT id FROM stripe_reminder_logs WHERE deal_id = ? AND second_payment_date = ? LIMIT 1`
2. Get all reminders for deal: `SELECT * FROM stripe_reminder_logs WHERE deal_id = ? ORDER BY sent_at DESC`
3. Audit query: `SELECT * FROM stripe_reminder_logs WHERE sent_at BETWEEN ? AND ? ORDER BY sent_at DESC`

### Data Retention

- Records are permanent (append-only log)
- No automatic deletion
- Can be archived manually if needed for compliance


