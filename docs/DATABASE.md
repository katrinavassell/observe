# Database Schema Reference

PostgreSQL with support for standard `pg` driver or `@neondatabase/serverless` (selected via `DB_DRIVER` env var). Data isolation is enforced at the application level -- all queries filter by `user_id` (visitor session ID).

## Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                     CORE                                             │
│  ┌─────────────────┐  ┌──────────────┐  ┌───────────────┐          │
│  │ observe_events  │  │   accounts   │  │ organizations │          │
│  │ (unified store) │  │              │  │ + members     │          │
│  └─────────────────┘  └──────────────┘  └───────────────┘          │
│  ┌─────────────────┐  ┌──────────────┐  ┌───────────────┐          │
│  │  sdk_api_keys   │  │ integrations │  │  alert_rules  │          │
│  └─────────────────┘  └──────────────┘  └───────────────┘          │
│  ┌─────────────────┐  ┌──────────────┐  ┌───────────────┐          │
│  │  proxy_cache    │  │ simulations  │  │  ai_insights  │          │
│  └─────────────────┘  └──────────────┘  └───────────────┘          │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                     LEGACY (Pricing Analyzer)                        │
│  ┌───────────┐  ┌──────────────┐  ┌───────────────┐                │
│  │   plans   │  │  customers   │  │ subscriptions │                │
│  └───────────┘  └──────────────┘  └───────────────┘                │
│  ┌───────────────┐  ┌───────────────┐  ┌────────────────┐          │
│  │ usage_records │  │ cost_records  │  │user_data_status│          │
│  └───────────────┘  └───────────────┘  └────────────────┘          │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                     SUPPORTING                                       │
│  ┌────────────────┐  ┌──────────────────┐  ┌─────────────────┐     │
│  │tanso_customers │  │inference_profiles│  │integration_reqs │     │
│  └────────────────┘  └──────────────────┘  └─────────────────┘     │
│  ┌────────────────┐  ┌──────────────────┐  ┌─────────────────┐     │
│  │referral_codes  │  │   referrals      │  │referral_credits │     │
│  └────────────────┘  └──────────────────┘  └─────────────────┘     │
│  ┌────────────────┐  ┌──────────────────┐                           │
│  │password_reset  │  │   sessions       │                           │
│  │   _tokens      │  │  (express-sess)  │                           │
│  └────────────────┘  └──────────────────┘                           │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Core Tables

### observe_events

The unified event store. All data (CSV, Stripe, sample, SDK, proxy) flows through here.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | SERIAL | PK | Internal ID |
| `user_id` | TEXT | NOT NULL | Visitor session owner |
| `customer_id` | TEXT | NOT NULL, DEFAULT 'unknown' | Customer identifier |
| `feature_key` | TEXT | NOT NULL, DEFAULT 'unknown' | Feature key |
| `event_name` | TEXT | NOT NULL, DEFAULT 'usage' | Event type |
| `timestamp` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | When the event occurred |
| `cost_amount` | NUMERIC(12,4) | NOT NULL, DEFAULT 0 | Cost incurred |
| `cost_unit` | TEXT | DEFAULT 'usd' | Currency unit |
| `revenue_amount` | NUMERIC(12,4) | NOT NULL, DEFAULT 0 | Revenue attributed |
| `usage_units` | NUMERIC(12,4) | NOT NULL, DEFAULT 0 | Quantity consumed |
| `model` | TEXT | NULL | AI model name |
| `model_provider` | TEXT | NULL | AI provider |
| `source` | TEXT | NOT NULL, DEFAULT 'csv' | `csv`, `stripe`, `sample`, `sdk`, `proxy` |
| `granularity` | TEXT | NOT NULL, DEFAULT 'monthly_aggregate' | `event`, `daily_aggregate`, `monthly_aggregate` |
| `properties` | JSONB | DEFAULT '{}' | Flexible metadata |
| `is_inferred` | BOOLEAN | NOT NULL, DEFAULT false | Whether cost was inferred from patterns |
| `inference_method` | TEXT | NULL | How cost was inferred |
| `inference_confidence` | NUMERIC(3,2) | NULL | Confidence score (0-1) |
| `inferred_from_source` | TEXT | NULL | Source event used for inference |
| `original_event_id` | INTEGER | NULL | Link to original event if inferred |
| `idempotency_key` | TEXT | NULL | Deduplicate retries |
| `request_body` | JSONB | NULL | Proxy request body (for request explorer) |
| `response_body` | JSONB | NULL | Proxy response body |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | Record creation |

**Indexes:**
```sql
CREATE INDEX idx_observe_events_user_ts ON observe_events(user_id, timestamp DESC);
CREATE INDEX idx_observe_events_user_feature ON observe_events(user_id, feature_key);
CREATE INDEX idx_observe_events_source ON observe_events(user_id, source);
CREATE INDEX idx_observe_events_inferred ON observe_events(user_id, is_inferred) WHERE is_inferred = true;
CREATE UNIQUE INDEX idx_observe_events_idempotency ON observe_events(user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
```

---

### accounts

User accounts for authentication.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | SERIAL | PK | Internal ID |
| `email` | TEXT | UNIQUE, NOT NULL | Email address |
| `password_hash` | TEXT | NOT NULL | Legacy column; new rows store `'supabase-managed'` — auth is handled by Supabase |
| `name` | TEXT | NULL | Display name |
| `visitor_id` | TEXT | UNIQUE | Linked visitor session |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | Created |
| `updated_at` | TIMESTAMPTZ | DEFAULT NOW() | Updated |

---

### organizations

Teams that share data access.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | SERIAL | PK | Internal ID |
| `name` | TEXT | NOT NULL, DEFAULT 'My Team' | Team name |
| `owner_visitor_id` | TEXT | NOT NULL | Team owner |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Created |

### organization_members

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | SERIAL | PK | Internal ID |
| `org_id` | INTEGER | FK → organizations | Organization |
| `visitor_id` | TEXT | NULL | Visitor ID (set on join) |
| `invited_email` | TEXT | NULL | Email used for invite |
| `invite_token` | TEXT | UNIQUE | Invite link token |
| `role` | TEXT | NOT NULL, DEFAULT 'viewer' | `admin` or `viewer` |
| `status` | TEXT | NOT NULL, DEFAULT 'pending' | `pending` or `active` |
| `joined_at` | TIMESTAMPTZ | NULL | When they accepted |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Created |

### visitor_org_map

Maps visitors to their organization for data sharing.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `visitor_id` | TEXT | PK | Visitor ID |
| `org_id` | INTEGER | FK → organizations | Organization |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Created |

---

### sdk_api_keys

API keys for programmatic event ingestion via `/events/ingest`.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | SERIAL | PK | Internal ID |
| `user_id` | TEXT | NOT NULL | Owner |
| `key_hash` | TEXT | UNIQUE, NOT NULL | SHA-256 hash of key |
| `key_prefix` | TEXT | NOT NULL | First 8 chars for display |
| `name` | TEXT | NOT NULL, DEFAULT 'default' | Key name |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | Created |
| `last_used_at` | TIMESTAMPTZ | NULL | Last usage |
| `revoked_at` | TIMESTAMPTZ | NULL | Revocation time |

**Indexes:**
```sql
CREATE INDEX idx_sdk_api_keys_hash ON sdk_api_keys(key_hash) WHERE revoked_at IS NULL;
```

---

### integrations

Connected API key providers (OpenAI, Anthropic).

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | SERIAL | PK | Internal ID |
| `user_id` | TEXT | NOT NULL | Owner |
| `provider` | TEXT | NOT NULL | `openai`, `anthropic` |
| `api_key_prefix` | TEXT | NOT NULL | First chars for display |
| `has_usage_access` | BOOLEAN | DEFAULT false | Can read usage data |
| `connected_at` | TIMESTAMPTZ | DEFAULT NOW() | Connected |
| `last_synced_at` | TIMESTAMPTZ | NULL | Last usage sync |

UNIQUE(user_id, provider)

---

### alert_rules

Threshold-based cost alert definitions.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | SERIAL | PK | Internal ID |
| `user_id` | TEXT | NOT NULL | Owner |
| `name` | TEXT | NOT NULL | Alert name |
| `metric` | TEXT | NOT NULL | Metric to monitor |
| `operator` | TEXT | NOT NULL | `>`, `<`, `>=`, `<=` |
| `threshold` | NUMERIC(12,4) | NOT NULL | Threshold value |
| `email` | TEXT | NOT NULL | Notification email |
| `enabled` | BOOLEAN | DEFAULT true | Active flag |
| `cooldown_minutes` | INTEGER | DEFAULT 60 | Min time between alerts |
| `last_triggered_at` | TIMESTAMPTZ | NULL | Last trigger time |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | Created |

---

### proxy_cache

Cached proxy responses to reduce AI costs on repeated requests.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | SERIAL | PK | Internal ID |
| `user_id` | TEXT | NOT NULL | Owner |
| `cache_key` | TEXT | NOT NULL | Lookup key |
| `model` | TEXT | NOT NULL | Model used |
| `request_hash` | TEXT | NOT NULL | Hash of request body |
| `response_body` | JSONB | NOT NULL | Cached response |
| `tokens_saved` | INTEGER | DEFAULT 0 | Tokens saved by cache hit |
| `cost_saved` | NUMERIC(12,4) | DEFAULT 0 | Cost saved |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | Created |
| `expires_at` | TIMESTAMPTZ | NULL | Expiration |

UNIQUE(user_id, cache_key)

---

### simulations

Pricing simulation definitions and results.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | SERIAL | PK | Internal ID |
| `user_id` | TEXT | NOT NULL | Owner |
| `name` | TEXT | NOT NULL | Simulation name |
| `status` | TEXT | DEFAULT 'draft' | `draft`, `running`, `completed`, `rolled_out` |
| `segment_name` | TEXT | NULL | Segment used |
| `time_range` | JSONB | DEFAULT '{}' | Date range |
| `scenarios` | JSONB | DEFAULT '[]' | Scenario definitions + results |
| `results` | JSONB | NULL | Overall results |
| `customer_impacts` | JSONB | NULL | Per-customer impact |
| `feature_analysis` | JSONB | NULL | Per-feature impact |
| `margin_impact` | JSONB | NULL | Margin summary |
| `confidence_score` | NUMERIC(5,2) | NULL | 0-100 confidence |
| `key_insight` | TEXT | NULL | Primary insight |
| `winning_scenario_id` | TEXT | NULL | Selected winner |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | Created |
| `updated_at` | TIMESTAMPTZ | DEFAULT NOW() | Updated |

---

### ai_insights

AI-generated insight records.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | SERIAL | PK | Internal ID |
| `user_id` | TEXT | NOT NULL | Owner |
| `insight_type` | TEXT | NOT NULL | `margin_alert`, `pricing_opportunity`, etc. |
| `title` | TEXT | NOT NULL | Headline |
| `description` | TEXT | NOT NULL | Detailed text |
| `severity` | TEXT | DEFAULT 'info' | `critical`, `warning`, `info`, `positive` |
| `feature_key` | TEXT | NULL | Related feature |
| `customer_id` | TEXT | NULL | Related customer |
| `metadata` | JSONB | DEFAULT '{}' | Extra data |
| `tokens_used` | INTEGER | NULL | Tokens consumed |
| `cost_usd` | NUMERIC(10,6) | NULL | Generation cost |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | Created |

---

### inference_profiles

Learned distribution patterns from SDK data, used to infer costs for events missing cost data.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | SERIAL | PK | Internal ID |
| `user_id` | TEXT | NOT NULL | Owner |
| `profile_type` | TEXT | NOT NULL | Type of profile |
| `scope_key` | TEXT | NOT NULL | Scope identifier |
| `distribution` | JSONB | NOT NULL, DEFAULT '{}' | Distribution data |
| `sample_count` | INTEGER | NOT NULL, DEFAULT 0 | Samples collected |
| `time_window_start` | TIMESTAMPTZ | NULL | Window start |
| `time_window_end` | TIMESTAMPTZ | NULL | Window end |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | Created |

UNIQUE(user_id, profile_type, scope_key)

---

## Legacy Tables (Pricing Analyzer)

These tables are maintained for backwards compatibility with the pricing analyzer. New data is dual-written to both legacy tables and `observe_events`.

### plans

| Column | Type | Description |
|--------|------|-------------|
| `id` | SERIAL | PK |
| `user_id` | TEXT | Owner |
| `plan_id` | TEXT | External plan ID |
| `name` | TEXT | Plan name |
| `price_amount` | DECIMAL(10,2) | Price per period |
| `interval_months` | INTEGER | 1=monthly, 12=annual |
| `billing_model` | TEXT | `recurring`, `usage_based`, `hybrid` |
| `api_calls_limit` | INTEGER | API call limit (nullable) |
| `tokens_limit` | INTEGER | Token limit (nullable) |
| `created_at` | TIMESTAMPTZ | Created |
| `updated_at` | TIMESTAMPTZ | Updated |

UNIQUE(user_id, plan_id)

### customers

| Column | Type | Description |
|--------|------|-------------|
| `id` | SERIAL | PK |
| `user_id` | TEXT | Owner |
| `customer_id` | TEXT | External customer ID |
| `name` | TEXT | Customer name |
| `email` | TEXT | Email (nullable) |
| `segment` | TEXT | Segment (nullable) |
| `created_at` | TIMESTAMPTZ | Created |
| `updated_at` | TIMESTAMPTZ | Updated |

UNIQUE(user_id, customer_id)

### subscriptions

| Column | Type | Description |
|--------|------|-------------|
| `id` | SERIAL | PK |
| `user_id` | TEXT | Owner |
| `subscription_id` | TEXT | External subscription ID |
| `customer_id` | TEXT | Customer reference |
| `plan_id` | TEXT | Plan reference |
| `is_active` | BOOLEAN | Active flag |
| `current_period_start` | TIMESTAMPTZ | Period start |
| `current_period_end` | TIMESTAMPTZ | Period end |
| `cancelled_at` | TIMESTAMPTZ | Cancellation date |
| `previous_mrr` | DECIMAL(10,2) | Previous MRR |
| `mrr_override` | DECIMAL(10,2) | Manual MRR override |
| `created_at` | TIMESTAMPTZ | Created |
| `updated_at` | TIMESTAMPTZ | Updated |

UNIQUE(user_id, subscription_id)

### usage_records

| Column | Type | Description |
|--------|------|-------------|
| `id` | SERIAL | PK |
| `user_id` | TEXT | Owner |
| `customer_id` | TEXT | Customer reference |
| `metric_key` | TEXT | Metric name |
| `metric_value` | DECIMAL(12,2) | Usage value |
| `metric_limit` | DECIMAL(12,2) | Limit (nullable) |
| `period_start` | TIMESTAMPTZ | Period start |
| `period_end` | TIMESTAMPTZ | Period end |
| `created_at` | TIMESTAMPTZ | Created |

### cost_records

| Column | Type | Description |
|--------|------|-------------|
| `id` | SERIAL | PK |
| `user_id` | TEXT | Owner |
| `customer_id` | TEXT | Customer (nullable for aggregate costs) |
| `cost_type` | TEXT | Cost category |
| `amount` | DECIMAL(10,2) | Cost amount |
| `period_start` | TIMESTAMPTZ | Period start |
| `period_end` | TIMESTAMPTZ | Period end |
| `created_at` | TIMESTAMPTZ | Created |

### user_data_status

| Column | Type | Description |
|--------|------|-------------|
| `id` | SERIAL | PK |
| `user_id` | TEXT | UNIQUE per visitor |
| `data_mode` | TEXT | `none`, `sample`, `user` |
| `created_at` | TIMESTAMPTZ | Created |
| `updated_at` | TIMESTAMPTZ | Updated |

---

## Supporting Tables

### tanso_customers

Maps visitor IDs to Tanso billing customer IDs.

| Column | Type | Description |
|--------|------|-------------|
| `id` | SERIAL | PK |
| `visitor_id` | TEXT | UNIQUE, NOT NULL |
| `tanso_customer_id` | TEXT | Tanso customer ID |
| `email` | TEXT | Email |
| `created_at` | TIMESTAMPTZ | Created |

### password_reset_tokens

| Column | Type | Description |
|--------|------|-------------|
| `id` | SERIAL | PK |
| `account_id` | INTEGER | FK → accounts |
| `token_hash` | TEXT | Hashed token |
| `expires_at` | TIMESTAMPTZ | Expiration |
| `used_at` | TIMESTAMPTZ | When used |
| `created_at` | TIMESTAMPTZ | Created |

### integration_requests

Interest capture for future integrations.

| Column | Type | Description |
|--------|------|-------------|
| `id` | SERIAL | PK |
| `user_id` | TEXT | Owner |
| `integration_name` | TEXT | Requested integration |
| `request_type` | TEXT | DEFAULT 'notify' |
| `created_at` | TIMESTAMPTZ | Created |

UNIQUE(user_id, integration_name)

### referral_codes

| Column | Type | Description |
|--------|------|-------------|
| `id` | SERIAL | PK |
| `user_id` | TEXT | UNIQUE |
| `code` | TEXT | UNIQUE referral code |
| `created_at` | TIMESTAMPTZ | Created |

### referrals

| Column | Type | Description |
|--------|------|-------------|
| `id` | SERIAL | PK |
| `referrer_user_id` | TEXT | Who referred |
| `referred_user_id` | TEXT | UNIQUE, who was referred |
| `referral_code` | TEXT | Code used |
| `status` | TEXT | DEFAULT 'pending' |
| `credited_at` | TIMESTAMPTZ | When credit applied |
| `created_at` | TIMESTAMPTZ | Created |

### referral_credits

| Column | Type | Description |
|--------|------|-------------|
| `id` | SERIAL | PK |
| `user_id` | TEXT | Owner |
| `credit_type` | TEXT | DEFAULT 'promo_month' |
| `amount` | INTEGER | DEFAULT 1 |
| `source_referral_id` | INTEGER | FK → referrals |
| `promo_code` | TEXT | Stripe promo code |
| `stripe_promo_id` | TEXT | Stripe promo ID |
| `used_at` | TIMESTAMPTZ | When used |
| `created_at` | TIMESTAMPTZ | Created |

---

## Table Creation

Tables are created at server startup using `CREATE TABLE IF NOT EXISTS` and `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` for migrations. No migration framework -- the SQL runs directly against the `pg` Pool in `server/index.ts`.
