-- Stripe Integrations table for storing API keys securely
-- Run this in your Supabase SQL Editor

CREATE TABLE IF NOT EXISTS stripe_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  encrypted_api_key TEXT NOT NULL,
  account_id TEXT,
  account_name TEXT,
  is_live_mode BOOLEAN NOT NULL DEFAULT false,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_sync_at TIMESTAMPTZ,
  sync_status TEXT DEFAULT 'idle',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_stripe_integrations_user_id ON stripe_integrations(user_id);

-- Enable RLS
ALTER TABLE stripe_integrations ENABLE ROW LEVEL SECURITY;

-- RLS policies - users can only access their own integration
CREATE POLICY "Users can view own stripe_integrations" ON stripe_integrations
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own stripe_integrations" ON stripe_integrations
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own stripe_integrations" ON stripe_integrations
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own stripe_integrations" ON stripe_integrations
  FOR DELETE USING (auth.uid() = user_id);

-- Trigger for updated_at
CREATE TRIGGER update_stripe_integrations_updated_at
  BEFORE UPDATE ON stripe_integrations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
