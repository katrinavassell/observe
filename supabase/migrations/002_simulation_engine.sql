-- =============================================================================
-- SIMULATION ENGINE SCHEMA
-- Adds pricing scenarios table for what-if simulations
-- =============================================================================

-- Pricing Scenarios (stores simulation configurations and results)
CREATE TABLE IF NOT EXISTS pricing_scenarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,

  -- Pricing model configuration
  pricing_model JSONB NOT NULL DEFAULT '{
    "type": "usage_based",
    "billingPeriod": "monthly",
    "growthRate": 0.05
  }'::jsonb,

  -- Simulation results (populated after running)
  results JSONB,

  -- Mark as baseline for comparison
  is_baseline BOOLEAN DEFAULT FALSE,

  -- Standard timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- INDEXES
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_pricing_scenarios_user_id
  ON pricing_scenarios(user_id);

CREATE INDEX IF NOT EXISTS idx_pricing_scenarios_baseline
  ON pricing_scenarios(user_id, is_baseline)
  WHERE is_baseline = true;

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================

ALTER TABLE pricing_scenarios ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own scenarios" ON pricing_scenarios
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own scenarios" ON pricing_scenarios
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own scenarios" ON pricing_scenarios
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own scenarios" ON pricing_scenarios
  FOR DELETE USING (auth.uid() = user_id);

-- =============================================================================
-- TRIGGER: Auto-update updated_at
-- =============================================================================

CREATE TRIGGER update_pricing_scenarios_updated_at
  BEFORE UPDATE ON pricing_scenarios
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
