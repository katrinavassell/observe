# Connecting Data Sources

Observe needs two types of data to show margins: **revenue** (what you charge) and **costs** (what you spend). Usage data is optional but enriches the picture.

## Stripe

### What it imports
- Customers (name, email)
- Subscriptions (plan, status, MRR)
- Plans/prices (name, amount, interval)

### How to connect
1. Go to **Data Sources**
2. Click **Connect Stripe**
3. On Replit: the native Stripe integration connects automatically
4. Click **Sync** to pull your data

### What you get
Revenue data for all your customers. Events are created with `source: stripe` and tied to each customer's subscription.

### Limitations
- Stripe gives you revenue, not costs. Upload a cost CSV to see margins.
- Syncs up to 100 customers, subscriptions, and products per sync.

---

## CSV Upload

### Revenue CSV

Upload customers, plans, and subscriptions from any billing system.

**Expected format:**
```
customer_id,customer_name,email,plan_id,plan_name,price_amount,is_active
cus_001,Acme Corp,billing@acme.com,pro,Professional,99,true
cus_002,StartupCo,admin@startup.io,starter,Starter,29,true
```

The column mapper lets you map your headers to Observe's fields. At minimum you need: `customer_id`, `plan_id`, `price_amount`.

### Cost CSV

Upload infrastructure or AI model costs.

**Expected format:**
```
month,customer_id,provider,cost
2026-01,cus_001,openai,245.00
2026-01,cus_001,aws,89.50
2026-02,cus_001,openai,312.00
```

- `customer_id` is optional — omit it for aggregate costs that get allocated proportionally
- `provider` maps to `feature_key` in the events table (e.g., `openai`, `anthropic`, `aws`, `infrastructure`)
- `month` format: `YYYY-MM`

**For AI model-level tracking**, include model details:
```
month,customer_id,provider,model,cost,requests
2026-01,cus_001,openai,gpt-4o,180.00,12000
2026-01,cus_001,openai,gpt-4o-mini,65.00,45000
2026-01,cus_001,anthropic,claude-sonnet-4,120.00,8000
```

### Usage CSV

Upload per-feature usage volumes.

**Expected format:**
```
month,customer_id,metric_key,metric_value,metric_limit
2026-01,cus_001,api_requests,45000,100000
2026-01,cus_001,pdf_generation,1200,5000
```

---

## Sample Data

Click **Load Sample Data** on the Data Sources page. This generates:

| Data | Details |
|------|---------|
| 5 customers | Acme Corp, TechStart, Global Solutions, Startup Labs, Enterprise Co |
| 3 plans | Starter ($29), Professional ($99), Enterprise ($299) |
| 5 features | api_requests, pdf_generation, ai_summarization, image_generation, search |
| 4 AI models | gpt-4o, gpt-4o-mini, claude-sonnet-4, dall-e-3 |
| 6 months | Historical data with realistic cost/revenue patterns |

Sample data is tagged with `source: sample` so you can distinguish it from real imports.

---

## How Data Flows

All imported data is written to the `observe_events` table regardless of source:

```
Stripe Sync  → observe_events (source: 'stripe')
CSV Upload   → observe_events (source: 'csv')
Sample Data  → observe_events (source: 'sample')
```

Each event has a `granularity` field:
- `event` — a single occurrence (future SDK events)
- `daily_aggregate` — one row per day
- `monthly_aggregate` — one row per month (most CSV imports)

## Clearing Data

On the Data Sources page, each section has a **Clear** button. Clearing removes data from both the legacy tables and `observe_events`.

**Clear All** removes everything and resets your session to empty state.
