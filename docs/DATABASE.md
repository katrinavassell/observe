# Database Schema Reference

PostgreSQL database hosted by Replit. Data isolation is enforced at the application level — all queries filter by `user_id` (visitor session ID).

## Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     OBSERVE (New)                             │
│                                                              │
│  ┌─────────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │ observe_events  │  │ simulations  │  │  ai_insights  │  │
│  │ (unified store) │  │              │  │               │  │
│  └─────────────────┘  └──────────────┘  └───────────────┘  │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                     LEGACY (Existing)                         │
│                                                              │
│  ┌───────────┐  ┌──────────────┐  ┌───────────────┐        │
│  │   plans   │  │  customers   │  │ subscriptions │        │
│  └───────────┘  └──────────────┘  └───────────────┘        │
│                                                              │
│  ┌───────────────┐  ┌───────────────┐  ┌────────────────┐  │
│  │ usage_records │  │ cost_records  │  │user_data_status│  │
│  └───────────────┘  └───────────────┘  └────────────────┘  │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                     INFRASTRUCTURE                           │
│  ┌──────────────┐                                           │
│  │   sessions   │  (express-session, auto-created)          │
│  └──────────────┘                                           │
└─────────────────────────────────────────────────────────────┘
```

---

## New Tables (Observe)

### observe_events

The unified event store. All data (CSV, Stripe, sample, future SDK) flows through here.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PK, DEFAULT gen_random_uuid() | Internal ID |
| `user_id` | TEXT | NOT NULL | Visitor session owner |
| `customer_id` | TEXT | NOT NULL | Customer identifier |
| `feature_key` | TEXT | NOT NULL, DEFAULT 'unknown' | Feature (e.g., `api_requests`, `pdf_generation`) |
| `event_name` | TEXT | NOT NULL, DEFAULT 'usage' | Event type (`usage`, `cost`, `revenue`, `inference`) |
| `timestamp` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | When the event occurred |
| `cost_amount` | DECIMAL(12,4) | DEFAULT 0 | Cost incurred |
| `cost_unit` | TEXT | DEFAULT 'usd' | `usd` or `credits` |
| `revenue_amount` | DECIMAL(12,4) | DEFAULT 0 | Revenue attributed |
| `usage_units` | DECIMAL(12,4) | DEFAULT 0 | Quantity consumed |
| `model` | TEXT | NULL | AI model name |
| `model_provider` | TEXT | NULL | AI provider |
| `source` | TEXT | NOT NULL, DEFAULT 'csv' | `csv`, `stripe`, `sample`, `sdk` |
| `granularity` | TEXT | NOT NULL, DEFAULT 'monthly_aggregate' | `event`, `daily_aggregate`, `monthly_aggregate` |
| `properties` | JSONB | DEFAULT '{}' | Flexible metadata |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Record creation |

**Indexes:**
```sql
CREATE INDEX idx_observe_events_user_ts ON observe_events (user_id, timestamp DESC);
CREATE INDEX idx_observe_events_user_feature ON observe_events (user_id, feature_key);
CREATE INDEX idx_observe_events_user_customer ON observe_events (user_id, customer_id);
CREATE INDEX idx_observe_events_user_model ON observe_events (user_id, model) WHERE model IS NOT NULL;
CREATE INDEX idx_observe_events_user_source ON observe_events (user_id, source);
```

---

### simulations

Pricing simulation definitions, scenarios, and results.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PK, DEFAULT gen_random_uuid() | Internal ID |
| `user_id` | TEXT | NOT NULL | Visitor session owner |
| `name` | TEXT | NOT NULL | Simulation name |
| `status` | TEXT | NOT NULL, DEFAULT 'draft' | `draft`, `running`, `completed`, `rolled_out` |
| `segment_name` | TEXT | NULL | Segment used |
| `time_range` | JSONB | NULL | `{start, end}` date range |
| `scenarios` | JSONB | DEFAULT '[]' | Scenario definitions + results |
| `summary_table` | JSONB | NULL | Side-by-side comparison data |
| `customer_impacts` | JSONB | NULL | Per-customer impact analysis |
| `feature_analysis` | JSONB | NULL | Per-feature margin impact |
| `margin_impact` | JSONB | NULL | Overall margin summary |
| `confidence_score` | INTEGER | NULL | 0–100 confidence |
| `key_insight` | TEXT | NULL | Primary insight text |
| `winning_scenario_id` | TEXT | NULL | Selected winner |
| `rolled_out_at` | TIMESTAMPTZ | NULL | Rollout timestamp |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Creation |
| `updated_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Last update |

**Indexes:**
```sql
CREATE INDEX idx_simulations_user ON simulations (user_id, created_at DESC);
```

---

### ai_insights

AI-generated insights stored for reference.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PK, DEFAULT gen_random_uuid() | Internal ID |
| `user_id` | TEXT | NOT NULL | Visitor session owner |
| `insight_type` | TEXT | NOT NULL | `margin_alert`, `pricing_opportunity`, `cost_optimization`, `customer_risk` |
| `title` | TEXT | NOT NULL | Insight headline |
| `description` | TEXT | NOT NULL | Detailed description |
| `severity` | TEXT | DEFAULT 'info' | `critical`, `warning`, `info`, `positive` |
| `feature_key` | TEXT | NULL | Related feature |
| `customer_id` | TEXT | NULL | Related customer |
| `metadata` | JSONB | DEFAULT '{}' | Extra data |
| `tokens_used` | INTEGER | NULL | OpenAI tokens consumed |
| `cost_usd` | DECIMAL(10,6) | NULL | Cost of this generation |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Creation |

**Indexes:**
```sql
CREATE INDEX idx_insights_user ON ai_insights (user_id, created_at DESC);
```

---

## Legacy Tables (Existing)

These tables are maintained for backwards compatibility with the pricing analyzer. New data is dual-written to both legacy tables and `observe_events`.

### plans

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | PK |
| `user_id` | TEXT | Owner |
| `plan_id` | TEXT | External plan ID |
| `name` | TEXT | Plan name |
| `price_amount` | DECIMAL(10,2) | Price per period |
| `interval_months` | INTEGER | 1=monthly, 12=annual |
| `billing_model` | TEXT | `recurring`, `usage_based`, `hybrid` |
| `created_at` | TIMESTAMPTZ | Created |
| `updated_at` | TIMESTAMPTZ | Updated |

UNIQUE(user_id, plan_id)

### customers

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | PK |
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
| `id` | UUID | PK |
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
| `id` | UUID | PK |
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
| `id` | UUID | PK |
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
| `user_id` | TEXT | PK (unique per visitor) |
| `data_mode` | TEXT | `none`, `sample`, `user` |
| `created_at` | TIMESTAMPTZ | Created |
| `updated_at` | TIMESTAMPTZ | Updated |

---

## Table Creation

Tables are created at server startup using `CREATE TABLE IF NOT EXISTS`. No migration framework — the SQL runs directly against the `pg` Pool in `server/index.ts`.
