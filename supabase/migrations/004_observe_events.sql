-- Migration: Feature Economics - observe_events table
-- This table is a unified event log for feature-level cost, revenue, and usage tracking.
-- All upload/sync endpoints dual-write into this table; all clear endpoints delete from it.

CREATE TABLE IF NOT EXISTS observe_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  customer_id TEXT NOT NULL DEFAULT 'unknown',
  feature_key TEXT NOT NULL DEFAULT 'unknown',
  event_name TEXT NOT NULL DEFAULT 'usage',
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cost_amount NUMERIC(12, 4) NOT NULL DEFAULT 0,
  cost_unit TEXT DEFAULT 'usd',
  revenue_amount NUMERIC(12, 4) NOT NULL DEFAULT 0,
  usage_units NUMERIC(12, 4) NOT NULL DEFAULT 0,
  model TEXT,
  model_provider TEXT,
  source TEXT NOT NULL DEFAULT 'csv',
  granularity TEXT NOT NULL DEFAULT 'monthly_aggregate',
  properties JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_observe_events_user_ts ON observe_events (user_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_observe_events_user_feature ON observe_events (user_id, feature_key);
CREATE INDEX IF NOT EXISTS idx_observe_events_user_customer ON observe_events (user_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_observe_events_user_model ON observe_events (user_id, model) WHERE model IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_observe_events_user_source ON observe_events (user_id, source);
