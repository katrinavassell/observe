# Feature Economics

The core value of Observe: see which features make money and which don't.

## Analytics Dashboard (`/`)

The home page shows an overview of your revenue, costs, and margins with:

- **Summary metrics** -- total revenue, total cost, overall margin
- **Trend charts** -- MRR over time, cost breakdown
- **Customer P&L** -- per-customer profitability breakdown
- **Margin alerts** -- features or customers with concerning margin trends

### Margin Status Badges

| Badge | Condition | What It Means |
|-------|-----------|---------------|
| **Negative** (red) | margin < 0% | You're losing money on this feature |
| **Low** (amber) | 0-20% margin | Barely breaking even |
| **Profitable** (green) | 20-50% margin | Healthy margin |
| **High** (blue) | > 50% margin | Strong margin |

### How features are identified

Features come from the `feature_key` field on events. When you upload data:

- **Cost CSVs:** The `provider` column becomes the feature key (e.g., `openai`, `aws`)
- **Usage CSVs:** The `metric_key` column becomes the feature key (e.g., `api_requests`)
- **Stripe sync:** Subscription events use `subscription` as the feature key
- **AI provider sync:** Events use the model name or a provider-level key
- **SDK/Proxy:** You set the feature key when sending events

You control the granularity. If your cost CSV has `openai` as the provider, that's one feature. If you break it down to `ai_summarization` and `ai_classification`, those are two features with separate margins.

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

## Events Page (`/events`)

Browse the raw event stream with filtering by source, feature, customer, and time range.

## Margin Calculation

Margins are calculated from `observe_events` aggregations:

```
revenue = SUM(revenue_amount) WHERE feature_key = X
cost    = SUM(cost_amount) WHERE feature_key = X
margin  = revenue - cost
margin% = (margin / revenue) x 100
```

If a feature has costs but no revenue (e.g., `infrastructure`), margin is negative. If a feature has revenue but no costs (e.g., Stripe-only data), margin shows as "-" with a prompt to add cost data.

## Tips

- **Start with costs.** Revenue from Stripe is usually at the subscription level. The real insight comes when you upload feature-level costs and see which features eat your margin.
- **Be specific with feature keys.** `openai` as a feature is useful. `ai_summarization` and `ai_classification` as separate features is more useful.
- **Look for negative margins first.** Sort by margin ascending -- the worst offenders are your biggest opportunities.
- **Set up alerts.** Use the Alerts page to get notified when costs exceed thresholds.
