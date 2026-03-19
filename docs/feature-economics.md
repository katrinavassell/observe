# Feature Economics

The core value of Observe: see which features make money and which don't.

## Features Page (`/features`)

Shows every feature in your data with:

| Column | What It Shows |
|--------|--------------|
| Feature | The feature key (e.g., `api_requests`, `pdf_generation`) |
| Usage | Total units consumed across all customers |
| Cost | Total cost to serve this feature |
| Revenue | Total revenue attributed to this feature |
| Margin % | `(revenue - cost) / revenue × 100` |
| Status | Badge based on margin threshold |

### Margin Status Badges

| Badge | Condition | What It Means |
|-------|-----------|---------------|
| **Negative** (red) | margin < 0% | You're losing money on this feature |
| **Low** (amber) | 0–20% margin | Barely breaking even |
| **Profitable** (green) | 20–50% margin | Healthy margin |
| **High** (blue) | > 50% margin | Strong margin |

### How features are identified

Features come from the `feature_key` field on events. When you upload data:

- **Cost CSVs:** The `provider` column becomes the feature key (e.g., `openai`, `aws`)
- **Usage CSVs:** The `metric_key` column becomes the feature key (e.g., `api_requests`)
- **Stripe sync:** Subscription events use `subscription` as the feature key
- **Sample data:** Pre-populated with realistic feature keys

You control the granularity. If your cost CSV has `openai` as the provider, that's one feature. If you break it down to `ai_summarization` and `ai_classification`, those are two features with separate margins.

## Feature Detail Page (`/features/:key`)

Click any feature to see:

- **Margin over time** — monthly chart showing cost, revenue, and margin %
- **Top customers** — who uses this feature the most and at what cost
- **Model breakdown** — if the feature uses AI models, which ones and at what cost
- **Events** — recent events for this feature

## Models Page (`/models`)

Dedicated view for AI model costs:

| Column | What It Shows |
|--------|--------------|
| Model | Model name (e.g., `gpt-4o`, `claude-sonnet-4`) |
| Provider | `openai`, `anthropic`, etc. |
| Total Cost | Sum of all costs for this model |
| Requests | Number of events/calls |
| Cost per Request | Average cost per call |
| % of Total | This model's share of total AI spend |

This page only appears in navigation when you have events with the `model` field populated.

## Customers Page (`/customers`)

Per-customer profitability:

| Column | What It Shows |
|--------|--------------|
| Customer | Name |
| Revenue | Total revenue from this customer |
| Cost | Total cost to serve this customer |
| Margin % | Per-customer margin |
| Status | Margin badge |
| Top Features | Most-used features by this customer |

### Customer Detail (`/customers/:id`)

Click a customer to see:
- **Margin over time** — monthly trend
- **Feature breakdown** — cost and revenue per feature for this customer
- **Recent events** — latest activity

## Margin Calculation

Margins are calculated from `observe_events` aggregations:

```
revenue = SUM(revenue_amount) WHERE feature_key = X
cost    = SUM(cost_amount) WHERE feature_key = X
margin  = revenue - cost
margin% = (margin / revenue) × 100
```

If a feature has costs but no revenue (e.g., `infrastructure`), margin is negative. If a feature has revenue but no costs (e.g., Stripe-only data), margin shows as "—" with a prompt to add cost data.

## Tips

- **Start with costs.** Revenue from Stripe is usually at the subscription level. The real insight comes when you upload feature-level costs and see which features eat your margin.
- **Be specific with feature keys.** `openai` as a feature is useful. `ai_summarization` and `ai_classification` as separate features is more useful.
- **Look for negative margins first.** Sort by margin ascending — the worst offenders are your biggest opportunities.
