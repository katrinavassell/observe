# Data Sources & Granularity

## How Imported Data Becomes Events

All data in Observe lives in the `observe_events` table. Each import source writes events with specific `source` and `granularity` tags so you can always trace where data came from.

## Import Sources

### Stripe Sync
| Field | Value |
|-------|-------|
| `source` | `stripe` |
| `granularity` | `monthly_aggregate` |
| `feature_key` | `subscription` |
| `event_name` | `revenue` |
| `revenue_amount` | Subscription MRR |

Stripe gives you **revenue data**. To see margins, pair it with cost data from CSV upload.

### CSV — Revenue
| Field | Value |
|-------|-------|
| `source` | `csv` |
| `granularity` | `monthly_aggregate` |
| `feature_key` | `subscription` |
| `event_name` | `revenue` |
| `revenue_amount` | From mapped column |

### CSV — Costs
| Field | Value |
|-------|-------|
| `source` | `csv` |
| `granularity` | `monthly_aggregate` |
| `feature_key` | Provider/category from mapped column |
| `event_name` | `cost` |
| `cost_amount` | From mapped column |
| `model` | If AI cost CSV includes model column |

### CSV — Usage
| Field | Value |
|-------|-------|
| `source` | `csv` |
| `granularity` | `monthly_aggregate` |
| `feature_key` | Metric key from mapped column |
| `event_name` | `usage` |
| `usage_units` | From mapped column |

### Sample Data
| Field | Value |
|-------|-------|
| `source` | `sample` |
| `granularity` | `monthly_aggregate` |
| Various | Realistic feature/model/customer data |

## Granularity Levels

| Level | Meaning | Typical Source |
|-------|---------|---------------|
| `monthly_aggregate` | One row per customer per feature per month | CSV uploads, Stripe sync, sample data |
| `daily_aggregate` | One row per customer per feature per day | (Future) detailed CSV imports |
| `event` | A single occurrence | SDK ingestion, proxy mode |

Aggregation queries in the dashboard work across all granularity levels — they just SUM the amounts. Finer granularity means more detail on timeseries charts.

## Data Completeness

For full margin visibility, you need both **revenue** and **cost** data for the same features/customers:

| What You Have | What You See |
|--------------|-------------|
| Revenue only (Stripe) | MRR, customer list, plan breakdown — no margins |
| Costs only (CSV) | Cost breakdown by feature/model — no margins |
| Revenue + Costs | Full margins by feature, customer, and model |
| Revenue + Costs + Usage | Margins plus usage volumes and per-unit economics |

The app shows contextual prompts when data is incomplete — e.g., "Add cost data to see margins" on the Features page when only revenue data exists.
