-- Stripe events storage: line items, summaries, participants, aggregation logs
create table if not exists stripe_event_items (
  id uuid primary key default gen_random_uuid(),
  line_item_id text not null,
  session_id text not null references stripe_payments(session_id) on delete cascade,
  event_key text not null,
  event_label text not null,
  currency text not null default 'PLN',
  amount numeric(18,2) not null,
  amount_pln numeric(18,2) not null,
  payment_status text not null,
  refund_status text,
  customer_id text,
  customer_email text,
  customer_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(line_item_id)
);

create index if not exists stripe_event_items_event_key_idx on stripe_event_items (event_key);
create index if not exists stripe_event_items_session_id_idx on stripe_event_items (session_id);
create index if not exists stripe_event_items_payment_status_idx on stripe_event_items (payment_status);
create index if not exists stripe_event_items_updated_at_idx on stripe_event_items (updated_at);

create table if not exists stripe_event_summary (
  event_key text primary key,
  event_label text not null,
  currency text not null,
  gross_revenue numeric(18,2) not null default 0,
  gross_revenue_pln numeric(18,2) not null default 0,
  payments_count integer not null default 0,
  participants_count integer not null default 0,
  refunds_count integer not null default 0,
  warnings text[] not null default '{}',
  last_payment_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists stripe_event_participants (
  id uuid primary key default gen_random_uuid(),
  event_key text not null references stripe_event_summary(event_key) on delete cascade,
  participant_id text not null,
  display_name text,
  email text,
  currency text not null,
  total_amount numeric(18,2) not null,
  total_amount_pln numeric(18,2) not null,
  payments_count integer not null,
  refund_amount_pln numeric(18,2) not null default 0,
  updated_at timestamptz not null default now(),
  unique(event_key, participant_id)
);

create index if not exists stripe_event_participants_event_key_idx on stripe_event_participants (event_key);
create index if not exists stripe_event_participants_email_idx on stripe_event_participants (email);

create table if not exists stripe_event_aggregation_jobs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running',
  processed_sessions integer not null default 0,
  detected_refunds integer not null default 0,
  error_message text
);

create index if not exists stripe_event_aggregation_jobs_started_at_idx on stripe_event_aggregation_jobs (started_at);

