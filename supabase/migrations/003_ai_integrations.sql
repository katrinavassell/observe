-- AI Integrations tables for storing OpenAI and Anthropic connection data
-- Run this in your Supabase SQL Editor

-- OpenAI Integrations table
CREATE TABLE IF NOT EXISTS openai_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  api_key_prefix TEXT NOT NULL,
  has_usage_access BOOLEAN NOT NULL DEFAULT false,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_openai_integrations_user_id ON openai_integrations(user_id);

-- Enable RLS
ALTER TABLE openai_integrations ENABLE ROW LEVEL SECURITY;

-- RLS policies - users can only access their own integration
CREATE POLICY "Users can view own openai_integrations" ON openai_integrations
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own openai_integrations" ON openai_integrations
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own openai_integrations" ON openai_integrations
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own openai_integrations" ON openai_integrations
  FOR DELETE USING (auth.uid() = user_id);

-- Trigger for updated_at
CREATE TRIGGER update_openai_integrations_updated_at
  BEFORE UPDATE ON openai_integrations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Anthropic Integrations table
CREATE TABLE IF NOT EXISTS anthropic_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  api_key_prefix TEXT NOT NULL,
  has_usage_access BOOLEAN NOT NULL DEFAULT false,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_anthropic_integrations_user_id ON anthropic_integrations(user_id);

-- Enable RLS
ALTER TABLE anthropic_integrations ENABLE ROW LEVEL SECURITY;

-- RLS policies - users can only access their own integration
CREATE POLICY "Users can view own anthropic_integrations" ON anthropic_integrations
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own anthropic_integrations" ON anthropic_integrations
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own anthropic_integrations" ON anthropic_integrations
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own anthropic_integrations" ON anthropic_integrations
  FOR DELETE USING (auth.uid() = user_id);

-- Trigger for updated_at
CREATE TRIGGER update_anthropic_integrations_updated_at
  BEFORE UPDATE ON anthropic_integrations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
