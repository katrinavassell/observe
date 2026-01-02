# Database Schema Reference

This document describes the Supabase PostgreSQL database schema for the Tanso metrics dashboard.

## Overview

The database uses Row Level Security (RLS) to isolate data per user. All tables reference `auth.users(id)` and restrict access to the authenticated user's data.

```
┌─────────────┐     ┌──────────────┐     ┌───────────────┐
│   plans     │     │  customers   │     │ subscriptions │
│             │     │              │◄────│               │
│  plan_id    │◄────│  customer_id │     │  customer_id  │
└─────────────┘     └──────────────┘     │  plan_id      │
                                         └───────────────┘
                           │                     │
                           ▼                     ▼
                    ┌──────────────┐     ┌───────────────┐
                    │usage_records │     │ cost_records  │
                    │  customer_id │     │  customer_id  │
                    └──────────────┘     └───────────────┘
```

---

## Tables

### plans

Pricing tiers/plans that customers can subscribe to.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PK, DEFAULT gen_random_uuid() | Internal ID |
| `user_id` | UUID | NOT NULL, FK → auth.users(id) | Owner |
| `plan_id` | TEXT | NOT NULL | External plan identifier (e.g., Stripe price ID) |
| `name` | TEXT | NOT NULL | Plan display name |
| `price_amount` | DECIMAL(10,2) | DEFAULT 0 | Price per billing period |
| `interval_months` | INTEGER | DEFAULT 1 | Billing interval (1=monthly, 12=annual) |
| `billing_model` | TEXT | DEFAULT 'recurring' | 'recurring', 'usage_based', 'hybrid' |
| `api_calls_limit` | INTEGER | NULL | API call limit (if applicable) |
| `tokens_limit` | INTEGER | NULL | Token limit (if applicable) |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | DEFAULT NOW() | Last update timestamp |

**Constraints:**
- UNIQUE(user_id, plan_id)

---

### customers

Customer accounts imported from Stripe or CSV.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PK, DEFAULT gen_random_uuid() | Internal ID |
| `user_id` | UUID | NOT NULL, FK → auth.users(id) | Owner |
| `customer_id` | TEXT | NOT NULL | External customer ID (e.g., Stripe cus_xxx) |
| `name` | TEXT | NOT NULL | Customer name |
| `email` | TEXT | NULL | Customer email |
| `segment` | TEXT | NULL | Customer segment (e.g., 'enterprise', 'startup') |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | DEFAULT NOW() | Last update timestamp |

**Constraints:**
- UNIQUE(user_id, customer_id)

---

### subscriptions

Active and historical subscriptions linking customers to plans.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PK, DEFAULT gen_random_uuid() | Internal ID |
| `user_id` | UUID | NOT NULL, FK → auth.users(id) | Owner |
| `subscription_id` | TEXT | NOT NULL | External subscription ID |
| `customer_id` | TEXT | NOT NULL | Reference to customers.customer_id |
| `plan_id` | TEXT | NOT NULL | Reference to plans.plan_id |
| `is_active` | BOOLEAN | DEFAULT true | Active subscription flag |
| `current_period_start` | TIMESTAMPTZ | NULL | Current billing period start |
| `current_period_end` | TIMESTAMPTZ | NULL | Current billing period end |
| `cancelled_at` | TIMESTAMPTZ | NULL | Cancellation date (if cancelled) |
| `previous_mrr` | DECIMAL(10,2) | NULL | Previous period MRR (for movement calc) |
| `mrr_override` | DECIMAL(10,2) | NULL | Manual MRR override |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | DEFAULT NOW() | Last update timestamp |

**Constraints:**
- UNIQUE(user_id, subscription_id)
- FK(user_id, customer_id) → customers(user_id, customer_id)
- FK(user_id, plan_id) → plans(user_id, plan_id)

---

### usage_records

Usage metrics for metered billing and analytics.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PK, DEFAULT gen_random_uuid() | Internal ID |
| `user_id` | UUID | NOT NULL, FK → auth.users(id) | Owner |
| `customer_id` | TEXT | NOT NULL | Customer reference |
| `metric_key` | TEXT | NOT NULL | Metric name (e.g., 'api_calls', 'tokens') |
| `metric_value` | DECIMAL(12,2) | NOT NULL | Usage value |
| `metric_limit` | DECIMAL(12,2) | NULL | Usage limit (if applicable) |
| `period_start` | TIMESTAMPTZ | NOT NULL | Period start date |
| `period_end` | TIMESTAMPTZ | NOT NULL | Period end date |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | Creation timestamp |

---

### cost_records

Cost data for margin calculations.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PK, DEFAULT gen_random_uuid() | Internal ID |
| `user_id` | UUID | NOT NULL, FK → auth.users(id) | Owner |
| `customer_id` | TEXT | NULL | Customer reference (NULL for aggregate costs) |
| `cost_type` | TEXT | NOT NULL | Cost category (e.g., 'api_costs', 'infrastructure') |
| `amount` | DECIMAL(10,2) | NOT NULL | Cost amount |
| `period_start` | TIMESTAMPTZ | NOT NULL | Period start date |
| `period_end` | TIMESTAMPTZ | NOT NULL | Period end date |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | Creation timestamp |

---

### user_data_status

Tracks the current data state for each user.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PK, DEFAULT gen_random_uuid() | Internal ID |
| `user_id` | UUID | NOT NULL, FK → auth.users(id), UNIQUE | Owner |
| `data_mode` | TEXT | DEFAULT 'none' | 'none', 'sample', or 'user' |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | DEFAULT NOW() | Last update timestamp |

---

### integration_requests

Tracks user interest in integrations.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PK, DEFAULT gen_random_uuid() | Internal ID |
| `user_id` | UUID | NOT NULL, FK → auth.users(id) | Owner |
| `integration_name` | TEXT | NOT NULL | Integration name (e.g., 'openai', 'anthropic') |
| `request_type` | TEXT | DEFAULT 'notify' | 'notify' or 'request' |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | Creation timestamp |

**Constraints:**
- UNIQUE(user_id, integration_name)

---

### pricing_scenarios

Stores pricing simulation configurations and results.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PK, DEFAULT gen_random_uuid() | Internal ID |
| `user_id` | UUID | NOT NULL, FK → auth.users(id) | Owner |
| `name` | TEXT | NOT NULL | Scenario name |
| `description` | TEXT | NULL | Scenario description |
| `pricing_model` | JSONB | NOT NULL | Pricing configuration |
| `results` | JSONB | NULL | Simulation results |
| `is_baseline` | BOOLEAN | DEFAULT false | Baseline scenario flag |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | DEFAULT NOW() | Last update timestamp |

---

## Indexes

```sql
-- Performance indexes
CREATE INDEX idx_plans_user_id ON plans(user_id);
CREATE INDEX idx_customers_user_id ON customers(user_id);
CREATE INDEX idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX idx_subscriptions_customer_id ON subscriptions(user_id, customer_id);
CREATE INDEX idx_usage_records_user_id ON usage_records(user_id);
CREATE INDEX idx_usage_records_customer_id ON usage_records(user_id, customer_id);
CREATE INDEX idx_usage_records_period ON usage_records(user_id, period_start, period_end);
CREATE INDEX idx_cost_records_user_id ON cost_records(user_id);
CREATE INDEX idx_cost_records_period ON cost_records(user_id, period_start, period_end);
CREATE INDEX idx_pricing_scenarios_user_id ON pricing_scenarios(user_id);
CREATE INDEX idx_pricing_scenarios_baseline ON pricing_scenarios(user_id, is_baseline) WHERE is_baseline = true;
```

---

## Row Level Security (RLS)

All tables have RLS enabled with policies that restrict access to the authenticated user's own data:

```sql
-- Example policy pattern (applied to all tables)
CREATE POLICY "Users can view own data" ON table_name
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own data" ON table_name
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own data" ON table_name
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own data" ON table_name
  FOR DELETE USING (auth.uid() = user_id);
```

---

## Functions

### clear_user_data()

Deletes all data for the current user. Called when switching data modes.

```sql
CREATE OR REPLACE FUNCTION clear_user_data()
RETURNS void AS $$
BEGIN
  DELETE FROM usage_records WHERE user_id = auth.uid();
  DELETE FROM cost_records WHERE user_id = auth.uid();
  DELETE FROM subscriptions WHERE user_id = auth.uid();
  DELETE FROM customers WHERE user_id = auth.uid();
  DELETE FROM plans WHERE user_id = auth.uid();
  UPDATE user_data_status SET data_mode = 'none' WHERE user_id = auth.uid();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

---

## Triggers

### update_updated_at_column()

Automatically updates `updated_at` timestamp on row updates.

```sql
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Applied to: plans, customers, subscriptions, user_data_status, pricing_scenarios
```

---

## Schema Files

- **Main schema:** `supabase/schema.sql`
- **Migrations:**
  - `supabase/migrations/001_stripe_integrations.sql`
  - `supabase/migrations/002_simulation_engine.sql`
