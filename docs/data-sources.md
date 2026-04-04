# Connecting Data Sources

Observe needs two types of data to show margins: **revenue** (what you charge) and **costs** (what you spend). Usage data is optional but enriches the picture.

The Data Sources page is organized into three sections:

1. **Live Tracking** -- proxy and SDK for real-time cost capture
2. **Revenue** -- Stripe integration for subscription and payment data
3. **Import Historical Data** -- CSV upload and AI provider sync (collapsed by default)

Every data point in Observe carries a **source badge** so you can see where it came from: `Proxy`, `SDK`, `CSV Import`, `Stripe`, `Integration`, or `Sample`.

---

## Live Tracking (Proxy + SDK)

For real-time event ingestion from your application:

- **Proxy mode** -- point your OpenAI/Anthropic client at Observe. Events logged automatically with `source: proxy`.
- **SDK** -- use `@tanso/observe` with `Observe.configure()` + `identify()` + `wrap()`. Events logged with `source: sdk`.
- **HTTP API** -- `POST /events/ingest` with an SDK key. Events logged with `source: sdk`.

Generate SDK keys under **Data Sources > API Keys** in the dashboard.

---

## Revenue (Stripe)

### What it imports
- Customers (name, email)
- Subscriptions (plan, status, MRR)
- Plans/prices (name, amount, interval)

### How to connect
1. Go to **Data Sources**
2. Click **Connect Stripe**
3. Enter your Stripe secret key (or use the Stripe integration if configured)
4. Click **Sync** to pull your data

### What you get
Revenue data for all your customers. Events are created with `source: stripe` and tied to each customer's subscription.

### Limitations
- Stripe gives you revenue, not costs. Upload a cost CSV or connect an AI provider to see margins.
- Syncs up to 100 customers, subscriptions, and products per sync.

---

## Import Historical Data (collapsed)

This section is collapsed by default on the Data Sources page. Expand it to access CSV uploads and AI provider integrations.

### AI Provider Integration (OpenAI / Anthropic)

#### What it imports
- Usage data (API calls, tokens consumed)
- Cost data (calculated from token usage and model pricing)

#### How to connect
1. Go to **Data Sources**
2. Expand **Import Historical Data**
3. Click **Connect** on OpenAI or Anthropic
4. Enter your API key
5. Click **Sync** to pull usage data

#### What you get
Cost and usage events with `source: integration`. Model, token counts, and costs are automatically calculated.

### CSV Upload

#### Revenue CSV

Upload customers, plans, and subscriptions from any billing system.

**Expected format:**
```
customer_id,customer_name,email,plan_id,plan_name,price_amount,is_active
cus_001,Acme Corp,billing@acme.com,pro,Professional,99,true
cus_002,StartupCo,admin@startup.io,starter,Starter,29,true
```

The column mapper lets you map your headers to Observe's fields. At minimum you need: `customer_id`, `plan_id`, `price_amount`.

#### Cost CSV

Upload infrastructure or AI model costs.

**Expected format:**
```
month,customer_id,provider,cost
2026-01,cus_001,openai,245.00
2026-01,cus_001,aws,89.50
2026-02,cus_001,openai,312.00
```

- `customer_id` is optional -- omit it for aggregate costs that get allocated proportionally
- `provider` maps to `feature_key` in the events table (e.g., `openai`, `anthropic`, `aws`, `infrastructure`)
- `month` format: `YYYY-MM`

**For AI model-level tracking**, include model details:
```
month,customer_id,provider,model,cost,requests
2026-01,cus_001,openai,gpt-4o,180.00,12000
2026-01,cus_001,openai,gpt-4o-mini,65.00,45000
2026-01,cus_001,anthropic,claude-sonnet-4,120.00,8000
```

#### Usage CSV

Upload per-feature usage volumes.

**Expected format:**
```
month,customer_id,metric_key,metric_value,metric_limit
2026-01,cus_001,api_requests,45000,100000
2026-01,cus_001,pdf_generation,1200,5000
```

---

## Sample Data

Click **Load Sample Data** on the Data Sources page. This generates realistic customers, plans, features, AI models, and months of historical data.

Sample data is tagged with `source: sample` so you can distinguish it from real imports.

---

## How Data Flows

All imported data is written to the `observe_events` table regardless of source:

```
AI Provider Sync → observe_events (source: 'integration')
Stripe Sync      → observe_events (source: 'stripe')
CSV Upload       → observe_events (source: 'csv')
SDK / HTTP API   → observe_events (source: 'sdk')
Proxy            → observe_events (source: 'proxy')
Sample Data      → observe_events (source: 'sample')
```

Each event has a `granularity` field:
- `event` -- a single occurrence (SDK, proxy events)
- `daily_aggregate` -- one row per day
- `monthly_aggregate` -- one row per month (most CSV imports)

## Clearing Data

On the Data Sources page, each section has a **Clear** button. Clearing removes data from both the legacy tables and `observe_events`.

**Clear All** removes everything and resets your session to empty state.
