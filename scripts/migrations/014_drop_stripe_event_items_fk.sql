-- Remove FK to stripe_payments so events account sessions can be stored
alter table if exists stripe_event_items
  drop constraint if exists stripe_event_items_session_id_fkey;

-- Ensure session_id remains indexed for lookups
create index if not exists stripe_event_items_session_id_idx on stripe_event_items (session_id);

