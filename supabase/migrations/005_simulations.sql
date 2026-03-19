CREATE TABLE IF NOT EXISTS simulations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  segment_name TEXT,
  time_range JSONB,
  scenarios JSONB DEFAULT '[]',
  summary_table JSONB,
  customer_impacts JSONB,
  feature_analysis JSONB,
  margin_impact JSONB,
  confidence_score INTEGER,
  key_insight TEXT,
  winning_scenario_id TEXT,
  rolled_out_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_simulations_user ON simulations (user_id, created_at DESC);
