-- ============================================================================
-- migrations/2026-05-11-tanso-leads.sql
--
-- Creates the `tanso_leads` table for the Margin Optimization action loop.
-- Persists leads captured by POST /api/v1/contact/tanso-implementation
-- when a user clicks "Talk to us about implementing this →" on a
-- MarginRecommendation card.
--
-- ⚠  RUN AGAINST STAGING/DEV FIRST.
--    Apply this migration to your Supabase dev or staging database before
--    merging the `hyperagent` branch. Verify the schema and a test insert
--    against staging before applying to production.
--
-- Apply via Supabase SQL editor (Database → SQL Editor), or via psql
-- against the dev/staging connection string:
--
--     psql $DEV_DATABASE_URL -f migrations/2026-05-11-tanso-leads.sql
--
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS tanso_leads (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email               TEXT NOT NULL,
  customer_name       TEXT,
  action_type         TEXT,
  action_payload      JSONB,
  recovered_dollars   NUMERIC(12, 2),
  recommendation_id   BIGINT,
  note                TEXT,
  source              TEXT NOT NULL DEFAULT 'observe_recommendation_cta',
  user_id             TEXT,        -- Clerk user id or anonymous visitor id
  account_id          BIGINT,      -- Observe account id when authenticated
  scheduled_for       TIMESTAMPTZ,
  ae_notified_at      TIMESTAMPTZ, -- (future) set when AE acknowledges
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tanso_leads_email
  ON tanso_leads (email);

CREATE INDEX IF NOT EXISTS idx_tanso_leads_account_id
  ON tanso_leads (account_id)
  WHERE account_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tanso_leads_created_at
  ON tanso_leads (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tanso_leads_recommendation_id
  ON tanso_leads (recommendation_id)
  WHERE recommendation_id IS NOT NULL;

-- updated_at trigger
CREATE OR REPLACE FUNCTION tanso_leads_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tanso_leads_set_updated_at ON tanso_leads;
CREATE TRIGGER trg_tanso_leads_set_updated_at
  BEFORE UPDATE ON tanso_leads
  FOR EACH ROW
  EXECUTE FUNCTION tanso_leads_set_updated_at();

COMMIT;

-- ============================================================================
-- Verification queries (run after applying)
-- ============================================================================
--
-- 1. Confirm the table exists with the expected columns:
--    \d tanso_leads
--
-- 2. Test insert (delete the row after):
--    INSERT INTO tanso_leads (email, customer_name, action_type)
--    VALUES ('test@example.com', 'Test Customer', 'raise_rate')
--    RETURNING id;
--
-- 3. Confirm indexes are in place:
--    SELECT indexname FROM pg_indexes WHERE tablename = 'tanso_leads';
--
-- 4. Cleanup test row:
--    DELETE FROM tanso_leads WHERE email = 'test@example.com';
--
-- ============================================================================
