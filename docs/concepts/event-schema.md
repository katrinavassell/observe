# Event Schema

Every piece of data in Observe flows through a single table: `observe_events`. Whether it comes from Stripe, a CSV upload, sample data, or (eventually) a real-time SDK, it becomes an event.

## Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | UUID | auto | Primary key |
| `user_id` | text | auto | Session owner (set by backend) |
| `customer_id` | text | yes | Which customer this event belongs to |
| `feature_key` | text | yes | Which feature (e.g., `api_requests`, `pdf_generation`) |
| `event_name` | text | yes | Type of event (`usage`, `cost`, `revenue`, `inference`) |
| `timestamp` | timestamptz | yes | When the event occurred |
| `cost_amount` | decimal | no | Cost incurred (in `cost_unit`) |
| `cost_unit` | text | no | `usd` or `credits` (default: `usd`) |
| `revenue_amount` | decimal | no | Revenue attributed |
| `usage_units` | decimal | no | Quantity consumed |
| `model` | text | no | AI model name (e.g., `gpt-4o`, `claude-sonnet-4`) |
| `model_provider` | text | no | AI provider (e.g., `openai`, `anthropic`) |
| `source` | text | yes | Where this data came from |
| `granularity` | text | yes | Time granularity of this record |
| `properties` | jsonb | no | Arbitrary metadata |

## Source Values

| Value | Meaning |
|-------|---------|
| `csv` | Uploaded via CSV file |
| `stripe` | Synced from Stripe |
| `sample` | Generated sample data |
| `sdk` | (Future) Ingested via SDK |

## Granularity Values

| Value | Meaning |
|-------|---------|
| `event` | A single occurrence (e.g., one API call) |
| `daily_aggregate` | One row per day |
| `monthly_aggregate` | One row per month |

Most CSV imports are `monthly_aggregate`. Future SDK events will be `event` granularity.

## Examples

**A monthly cost record from CSV:**
```json
{
  "customer_id": "cus_001",
  "feature_key": "openai",
  "event_name": "cost",
  "timestamp": "2026-01-31T23:59:59Z",
  "cost_amount": 245.00,
  "model": "gpt-4o",
  "model_provider": "openai",
  "source": "csv",
  "granularity": "monthly_aggregate"
}
```

**A subscription revenue event from Stripe:**
```json
{
  "customer_id": "cus_001",
  "feature_key": "subscription",
  "event_name": "revenue",
  "timestamp": "2026-03-01T00:00:00Z",
  "revenue_amount": 299.00,
  "source": "stripe",
  "granularity": "monthly_aggregate"
}
```

**An AI Insights call (internal tracking):**
```json
{
  "customer_id": "_system",
  "feature_key": "ai_insights",
  "event_name": "inference",
  "timestamp": "2026-03-19T14:30:00Z",
  "cost_amount": 0.003,
  "model": "gpt-4o-mini",
  "model_provider": "openai",
  "source": "sdk",
  "granularity": "event"
}
```
