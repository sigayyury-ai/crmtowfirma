-- Stores raw leads from all sources (SendPulse, Pipedrive, etc.)
CREATE TABLE IF NOT EXISTS mql_leads (
    id SERIAL PRIMARY KEY,
    source TEXT NOT NULL, -- 'sendpulse' | 'pipedrive'
    external_id TEXT NOT NULL,
    email TEXT,
    username TEXT,
    first_seen_month DATE NOT NULL,
    channel_bucket TEXT, -- e.g. Organic search, Paid social, etc.
    payload JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (source, external_id)
);

-- Aggregated monthly snapshot for all metrics required by the dashboard
CREATE TABLE IF NOT EXISTS mql_monthly_snapshots (
    id SERIAL PRIMARY KEY,
    year INTEGER NOT NULL,
    month INTEGER NOT NULL,
    sendpulse_mql INTEGER DEFAULT 0,
    pipedrive_mql INTEGER DEFAULT 0,
    combined_mql INTEGER DEFAULT 0,
    won_deals INTEGER DEFAULT 0,
    repeat_deals INTEGER DEFAULT 0,
    closed_deals INTEGER DEFAULT 0,
    marketing_expense NUMERIC(14, 2) DEFAULT 0,
    subscribers INTEGER DEFAULT 0,
    new_subscribers INTEGER DEFAULT 0,
    cost_per_subscriber NUMERIC(14, 2) DEFAULT 0,
    cost_per_mql NUMERIC(14, 2) DEFAULT 0,
    cost_per_deal NUMERIC(14, 2) DEFAULT 0,
    channel_breakdown JSONB DEFAULT '{}'::jsonb,
    pipedrive_sync_at TIMESTAMPTZ,
    sendpulse_sync_at TIMESTAMPTZ,
    pnl_sync_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (year, month)
);

CREATE INDEX IF NOT EXISTS idx_mql_leads_first_seen ON mql_leads (first_seen_month);
CREATE INDEX IF NOT EXISTS idx_mql_snapshots_year_month ON mql_monthly_snapshots (year, month);


