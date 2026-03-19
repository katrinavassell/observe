# Features API

## Get Feature Detail

```
GET /api/features/:key
```

Returns aggregated metrics and monthly timeseries for a single feature.

### Path Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `key` | string | Feature key (e.g., `api_requests`, `ai_summarization`) |

### Response

```json
{
  "feature_key": "ai_summarization",
  "total_cost": 2340.00,
  "total_revenue": 1100.00,
  "total_usage": 12000,
  "margin_pct": -112.7,
  "margin_status": "negative",
  "timeseries": [
    { "month": "2026-01", "cost": 380.00, "revenue": 180.00, "usage": 2000, "margin_pct": -111.1 },
    { "month": "2026-02", "cost": 410.00, "revenue": 190.00, "usage": 2100, "margin_pct": -115.8 }
  ],
  "top_customers": [
    { "customer_id": "cus_001", "customer_name": "Acme Corp", "cost": 890.00, "revenue": 420.00, "usage": 4500 },
    { "customer_id": "cus_003", "customer_name": "Global Solutions", "cost": 650.00, "revenue": 310.00, "usage": 3200 }
  ],
  "models": [
    { "model": "gpt-4o", "cost": 1800.00, "requests": 8000 },
    { "model": "gpt-4o-mini", "cost": 540.00, "requests": 4000 }
  ]
}
```

The `models` array is only present if events for this feature have the `model` field populated.
